/**
 * `inlineRefs`, and the two properties the fixture corpus depends on: an
 * unchanged contract keeps its key across a change of encoding, and an
 * expansion that cannot terminate leaves the schema valid rather than
 * truncating it.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { inlineRefs } from '../src/deref';
import { fixtureKey, toJsonSchema } from '../src/schema';

const Point = z.object({ x: z.int(), y: z.int() });
const Segment = z.object({ from: Point, to: Point });

describe('inlineRefs', () => {
  it('expands a reused definition back into every place that named it', () => {
    const expanded = inlineRefs({
      type: 'object',
      properties: { a: { $ref: '#/$defs/pt' }, b: { $ref: '#/$defs/pt' } },
      $defs: { pt: { type: 'integer' } },
    });

    expect(expanded).toEqual({
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'integer' } },
    });
  });

  it('reproduces what the inlining mode itself emits', () => {
    const inline = z.toJSONSchema(Segment, { io: 'output' }) as Record<string, unknown>;
    const withRefs = z.toJSONSchema(Segment, { io: 'output', reused: 'ref' }) as Record<string, unknown>;
    for (const key of ['$schema', '$id']) {
      delete inline[key];
      delete withRefs[key];
    }

    expect(JSON.stringify(withRefs)).toContain('$ref');
    expect(inlineRefs(withRefs)).toEqual(inline);
  });

  it('leaves a schema with no definitions exactly as it was', () => {
    const schema = { type: 'object', properties: { x: { type: 'integer' } } };

    expect(inlineRefs(schema)).toBe(schema);
  });

  it('keeps a sibling keyword sitting beside a $ref', () => {
    const expanded = inlineRefs({
      type: 'object',
      properties: { a: { $ref: '#/$defs/pt', description: 'the first one' } },
      $defs: { pt: { type: 'integer' } },
    });

    expect(expanded['properties']).toEqual({
      a: { type: 'integer', description: 'the first one' },
    });
  });

  it('leaves a recursive reference alone rather than expanding forever', () => {
    const expanded = inlineRefs({
      $ref: '#/$defs/node',
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
    });

    expect(expanded).toEqual({
      type: 'object',
      properties: { next: { $ref: '#/$defs/node' } },
    });
  });

  it('leaves a reference it cannot resolve alone', () => {
    const schema = { $ref: 'https://example.invalid/s.json', $defs: { pt: { type: 'integer' } } };

    expect(inlineRefs(schema)).toEqual({ $ref: 'https://example.invalid/s.json' });
  });

  it('does not drop a nested definitions block it never read from', () => {
    const expanded = inlineRefs({
      type: 'object',
      properties: { a: { $ref: '#/$defs/pt' }, nested: { $defs: { other: { type: 'string' } } } },
      $defs: { pt: { type: 'integer' } },
    });

    expect(expanded['properties']).toEqual({
      a: { type: 'integer' },
      nested: { $defs: { other: { type: 'string' } } },
    });
  });
});

describe('fixtureKey', () => {
  it('is unchanged by whether the schema was emitted with refs or inlined', () => {
    const request = { system: 'a system prompt', prompt: 'a prompt' };

    expect(fixtureKey({ ...request, jsonSchema: toJsonSchema(Segment, 'ref') })).toBe(
      fixtureKey({ ...request, jsonSchema: toJsonSchema(Segment, 'inline') }),
    );
  });

  it('still moves when the contract itself changes', () => {
    const request = { system: 'a system prompt', prompt: 'a prompt' };
    const widened = z.object({ from: Point, to: Point, via: Point });

    expect(fixtureKey({ ...request, jsonSchema: toJsonSchema(Segment) })).not.toBe(
      fixtureKey({ ...request, jsonSchema: toJsonSchema(widened) }),
    );
  });
});

describe('toJsonSchema encoding', () => {
  it('inlines a reused subschema by default, which is what the recordings hold', () => {
    const emitted = JSON.stringify(toJsonSchema(Segment));

    expect(emitted).not.toContain('$ref');
    expect(emitted).not.toContain('$defs');
  });

  it('states a reused subschema once when asked for refs', () => {
    const emitted = JSON.stringify(toJsonSchema(Segment, 'ref'));

    expect(emitted).toContain('$ref');
    expect(emitted).toContain('$defs');
    expect(emitted.length).toBeLessThan(JSON.stringify(toJsonSchema(Segment)).length);
  });
});
