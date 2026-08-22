/**
 * Zod schema → JSON Schema, plus the stable fixture key derived from
 * (system, prompt, schema).
 *
 * Every provider needs the JSON Schema: it goes into the prompt contract, into
 * the `claude` CLI's `--json-schema` flag, and into the Anthropic tool
 * definition. A schema that cannot be expressed as JSON Schema is a
 * configuration error, surfaced at the call site rather than silently degraded.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ZodType } from 'zod';
import { canonicalJson } from '@mtg/dsl';
import { LlmConfigError } from './errors';
import type { JsonSchema } from './types';

/** Bumping this invalidates every recorded fixture on purpose. */
export const FIXTURE_KEY_VERSION = 1;

const DROPPED_KEYS = ['$schema', '$id'] as const;

export function toJsonSchema(schema: ZodType<unknown>): JsonSchema {
  let produced: unknown;
  try {
    produced = z.toJSONSchema(schema, { io: 'output' });
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

/** Stable content hash of the request identity a fixture is keyed by. */
export function fixtureKey(input: {
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: JsonSchema;
}): string {
  const canonical = canonicalJson({
    v: FIXTURE_KEY_VERSION,
    system: input.system,
    prompt: input.prompt,
    schema: input.jsonSchema,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

/** Human-readable issue lines from a failed `safeParse`. */
export function formatIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.');
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
