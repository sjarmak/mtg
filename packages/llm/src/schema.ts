/**
 * Zod schema → JSON Schema, plus the stable fixture key derived from
 * (system, prompt, schema).
 *
 * Every provider needs the JSON Schema: it goes into the prompt contract, into
 * the `claude` CLI's `--json-schema` flag, and into the Anthropic tool
 * definition. A schema that cannot be expressed as JSON Schema is a
 * configuration error, surfaced at the call site rather than silently degraded.
 *
 * ## Two encodings, and why the choice is per caller
 *
 * `inline` repeats a reused subschema wherever it occurs. It is the default
 * because it is what all 180 recorded fixtures in this tree were made under.
 *
 * `ref` states each reused subschema once under `$defs`. `@mtg/dsl-coverage`
 * needs it and nothing else does yet: the DSL's effect vocabulary grew from 13
 * kinds to 37, so its translation schema — which carries the effect union and
 * the ability union — went from the ~70 KB it had been hand-collapsed to reach,
 * to 773,140 bytes. `claude-cli` passes the schema on argv against a 96,000-byte
 * ceiling and refused every call. With refs it is 29,723 bytes.
 *
 * The choice cannot be global, because the schema text is also printed into the
 * prompt under `<output_contract>`, and the prompt is half the fixture key.
 * Flipping a caller that has recordings moves every one of its keys and needs a
 * re-key (mtg-tsic). `@mtg/dsl-coverage` has no recorded corpus — its sampling
 * calls are live — so it can take the compact form for free, and setgen keeps
 * its recordings until something actually forces the move.
 *
 * `fixtureKey` hashes the *expanded* form either way (`inlineRefs`), so the half
 * of the key that comes from the schema is already encoding-independent. That
 * does not save the prompt half, but it halves what a future re-key has to
 * rewrite.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ZodType } from 'zod';
import { canonicalJson } from '@mtg/dsl';
import { inlineRefs } from './deref';
import { LlmConfigError } from './errors';
import { DEFAULT_SCHEMA_ENCODING } from './types';
import type { JsonSchema, SchemaEncoding } from './types';

/** Bumping this invalidates every recorded fixture on purpose. */
export const FIXTURE_KEY_VERSION = 1;

const DROPPED_KEYS = ['$schema', '$id'] as const;

export function toJsonSchema(
  schema: ZodType<unknown>,
  encoding: SchemaEncoding = DEFAULT_SCHEMA_ENCODING,
): JsonSchema {
  let produced: unknown;
  try {
    produced = z.toJSONSchema(schema, {
      io: 'output',
      ...(encoding === 'ref' ? { reused: 'ref' as const } : {}),
    });
  } catch (error: unknown) {
    throw new LlmConfigError(
      'schema cannot be represented as JSON Schema, so no provider can state the output contract. ' +
        'Replace the unrepresentable member (dates, functions, transforms) with a JSON-native one. ' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (produced === null || typeof produced !== 'object' || Array.isArray(produced)) {
    throw new LlmConfigError(`expected a JSON Schema object, got ${typeof produced}`);
  }
  const copy = { ...(produced as Record<string, unknown>) };
  for (const key of DROPPED_KEYS) delete copy[key];
  return copy;
}

/**
 * A JSON Schema for a top-level object, which is what tool-use forcing requires.
 * Non-object schemas are wrapped under a single `value` property; callers unwrap
 * with `unwrapObjectSchema`.
 */
export interface ObjectSchemaEnvelope {
  readonly schema: JsonSchema;
  readonly wrapped: boolean;
}

export const WRAPPER_PROPERTY = 'value';

export function asObjectSchema(jsonSchema: JsonSchema): ObjectSchemaEnvelope {
  if (jsonSchema['type'] === 'object') return { schema: jsonSchema, wrapped: false };
  return {
    wrapped: true,
    schema: {
      type: 'object',
      properties: { [WRAPPER_PROPERTY]: jsonSchema },
      required: [WRAPPER_PROPERTY],
      additionalProperties: false,
    },
  };
}

/**
 * Stable content hash of the request identity a fixture is keyed by.
 *
 * The schema is expanded before hashing, so the key names the contract rather
 * than the encoding zod happened to emit it in. See this file's header.
 */
export function fixtureKey(input: {
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: JsonSchema;
}): string {
  const canonical = canonicalJson({
    v: FIXTURE_KEY_VERSION,
    system: input.system,
    prompt: input.prompt,
    schema: inlineRefs(input.jsonSchema),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function additiveProperties(
  before: unknown,
  after: unknown,
  beforeSchema: Readonly<Record<string, unknown>>,
  afterSchema: Readonly<Record<string, unknown>>,
): boolean {
  if (
    typeof before !== 'object' ||
    before === null ||
    Array.isArray(before) ||
    typeof after !== 'object' ||
    after === null ||
    Array.isArray(after)
  ) {
    return false;
  }
  const beforeProperties = before as Readonly<Record<string, unknown>>;
  const afterProperties = after as Readonly<Record<string, unknown>>;
  const beforeKeys = Object.keys(beforeProperties);
  const afterKeys = Object.keys(afterProperties);
  if (!beforeKeys.every((key) => key in afterProperties)) return false;
  // With open object schemas, defining a formerly unconstrained property can
  // narrow the contract. Under `additionalProperties: false`, a new optional
  // property only admits values the old schema rejected.
  if (
    afterKeys.length > beforeKeys.length &&
    (beforeSchema['additionalProperties'] !== false || afterSchema['additionalProperties'] !== false)
  ) {
    return false;
  }
  return beforeKeys.every((key) => additiveNode(beforeProperties[key], afterProperties[key], key));
}

function additiveNode(before: unknown, after: unknown, parentKey: string | null): boolean {
  if (sameJson(before, after)) return true;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return false;
    if (parentKey === 'enum') {
      return before.every((member) => after.some((candidate) => sameJson(member, candidate)));
    }
    if (parentKey === 'oneOf' || parentKey === 'anyOf') {
      return (
        after.length >= before.length &&
        before.every((member, index) => additiveNode(member, after[index], parentKey))
      );
    }
    return false;
  }
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
    return false;
  }
  const beforeRecord = before as Readonly<Record<string, unknown>>;
  const afterRecord = after as Readonly<Record<string, unknown>>;
  const beforeKeys = Object.keys(beforeRecord).sort();
  if (!sameJson(beforeKeys, Object.keys(afterRecord).sort())) return false;
  return beforeKeys.every((key) =>
    key === 'properties'
      ? additiveProperties(beforeRecord[key], afterRecord[key], beforeRecord, afterRecord)
      : additiveNode(beforeRecord[key], afterRecord[key], key),
  );
}

/** True only when the new contract adds enum members, union arms, or closed-object optional properties. */
export function isStrictlyAdditiveSchemaWidening(before: JsonSchema, after: JsonSchema): boolean {
  return !sameJson(before, after) && additiveNode(before, after, null);
}

/** Human-readable issue lines from a failed `safeParse`. */
export function formatIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.');
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
