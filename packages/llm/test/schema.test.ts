/**
 * Schema conversion, fixture keys, JSON extraction, and the price table — the
 * deterministic parts every provider depends on.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmConfigError } from '../src/errors';
import { extractJsonValue } from '../src/json';
import {
  CACHE_WRITE_MULTIPLIERS,
  DEFAULT_CACHE_TTL,
  estimateCostUsd,
  priceFor,
} from '../src/providers/pricing';
import { asObjectSchema, fixtureKey, formatIssues, toJsonSchema } from '../src/schema';
import { addUsage, totalTokens, worstCostSource, ZERO_USAGE } from '../src/types';

const CardSchema = z.object({
  name: z.string().min(1),
  color: z.enum(['W', 'U', 'B', 'R', 'G']),
  effects: z.array(z.enum(['dealDamage', 'drawCards', 'gainLife'])),
});

describe('toJsonSchema', () => {
  it('emits a JSON Schema object without meta keys', () => {
    const schema = toJsonSchema(CardSchema);

    expect(schema['type']).toBe('object');
    expect(schema['$schema']).toBeUndefined();
    expect(JSON.stringify(schema)).toContain('dealDamage');
  });

  it('reports an unrepresentable schema as a configuration error', () => {
    expect(() => toJsonSchema(z.object({ when: z.date() }))).toThrow(LlmConfigError);
  });
});

describe('asObjectSchema', () => {
  it('leaves an object schema alone', () => {
    const schema = toJsonSchema(CardSchema);
    const envelope = asObjectSchema(schema);

    expect(envelope.wrapped).toBe(false);
    expect(envelope.schema).toBe(schema);
  });

  it('wraps a non-object schema under a single value property', () => {
    const envelope = asObjectSchema(toJsonSchema(z.array(z.string())));

    expect(envelope.wrapped).toBe(true);
    expect(envelope.schema['type']).toBe('object');
    expect(envelope.schema['required']).toEqual(['value']);
  });
});

describe('fixtureKey', () => {
  const base = { system: 's', prompt: 'p', jsonSchema: toJsonSchema(CardSchema) };

  it('is stable across calls and insensitive to key order', () => {
    const reordered = {
      ...base,
      jsonSchema: Object.fromEntries(Object.entries(base.jsonSchema).reverse()),
    };

    expect(fixtureKey(base)).toBe(fixtureKey(base));
    expect(fixtureKey(base)).toBe(fixtureKey(reordered));
    expect(fixtureKey(base)).toHaveLength(32);
  });

  it('changes when any part of the request identity changes', () => {
    expect(fixtureKey({ ...base, prompt: 'p2' })).not.toBe(fixtureKey(base));
    expect(fixtureKey({ ...base, system: 's2' })).not.toBe(fixtureKey(base));
    expect(fixtureKey({ ...base, jsonSchema: { type: 'string' } })).not.toBe(fixtureKey(base));
  });
});

describe('extractJsonValue', () => {
  it('reads bare JSON, fenced JSON, and JSON buried in prose', () => {
    expect(extractJsonValue('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJsonValue('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJsonValue('Sure!\n{"a":1}\nHope that helps.')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('is not fooled by braces inside strings', () => {
    const result = extractJsonValue('prefix {"a":"} not the end {"} suffix');
    expect(result).toEqual({ ok: true, value: { a: '} not the end {' } });
  });

  it('reports failure instead of throwing', () => {
    expect(extractJsonValue('   ')).toEqual({ ok: false, reason: 'response was empty' });
    const failure = extractJsonValue('no json here');
    expect(failure.ok).toBe(false);
  });
});

describe('formatIssues', () => {
  it('renders each issue with its path', () => {
    const parsed = CardSchema.safeParse({ name: '', color: 'Q', effects: ['mill'] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const issues = formatIssues(parsed.error);
    expect(issues.some((issue) => issue.startsWith('name:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('color:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('effects.0:'))).toBe(true);
  });
});

describe('usage accounting', () => {
  it('sums usage and totals tokens', () => {
    const a = { ...ZERO_USAGE, inputTokens: 10, outputTokens: 5 };
    const b = { ...ZERO_USAGE, inputTokens: 1, cacheReadInputTokens: 100 };

    expect(addUsage(a, b)).toEqual({
      inputTokens: 11,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 100,
    });
    expect(totalTokens(addUsage(a, b))).toBe(116);
  });

  it('degrades cost confidence to the weakest source', () => {
    expect(worstCostSource(['reported', 'reported'])).toBe('reported');
    expect(worstCostSource(['reported', 'estimated'])).toBe('estimated');
    expect(worstCostSource(['estimated', 'unknown'])).toBe('unknown');
    expect(worstCostSource([])).toBe('unknown');
  });
});

describe('pricing', () => {
  it('matches dated model ids by prefix', () => {
    expect(priceFor('claude-haiku-4-5')?.inputPerMTok).toBe(1);
    expect(priceFor('claude-haiku-4-5-20251001')?.outputPerMTok).toBe(5);
    expect(priceFor('gpt-nonsense')).toBeUndefined();
  });

  it('prices cache writes at 1.25x and cache reads at 0.1x input by default', () => {
    const estimate = estimateCostUsd('claude-haiku-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    });

    expect(estimate.source).toBe('estimated');
    expect(estimate.costUsd).toBeCloseTo(1 + 1.25 + 0.1, 10);
  });

  // A 1-hour cache is not a 5-minute cache with a longer life: the write costs
  // 2x the input rate instead of 1.25x. Pricing a long-TTL run at the default
  // understates the cache-creation line by 60%, which on a caching-heavy run is
  // most of the bill (the recorded Tideglass fixtures: $24.64 actual vs $17.89).
  it('prices a one-hour cache write at 2x input', () => {
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 0,
    };

    expect(estimateCostUsd('claude-haiku-4-5', usage, '5m').costUsd).toBeCloseTo(1.25, 10);
    expect(estimateCostUsd('claude-haiku-4-5', usage, '1h').costUsd).toBeCloseTo(2, 10);
    expect(CACHE_WRITE_MULTIPLIERS[DEFAULT_CACHE_TTL]).toBe(1.25);
  });

  it('returns an unknown source for an unpriced model', () => {
    expect(estimateCostUsd('mystery-model', ZERO_USAGE)).toEqual({ costUsd: 0, source: 'unknown' });
  });
});
