/**
 * The fixture provider: replays recorded responses keyed by a stable hash of
 * (system, prompt, schema).
 *
 * This is the only provider tests and CI may use — runs are hermetic (no
 * network) and free (no spend). With `FIXTURE_RECORD=1` it delegates to a live
 * transport and writes what came back; otherwise a missing key is a hard error
 * unless an older request differs only by additive answer-schema vocabulary
 * and its answer validates under both contracts. There is never a silent live
 * call.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { BudgetGuard } from '../budget';
import { FixtureMissingError, LlmConfigError, LlmTransportError } from '../errors';
import { createProvider } from '../core';
import { extractJsonValue } from '../json';
import { fixtureKey, isStrictlyAdditiveSchemaWidening } from '../schema';
import type { CostCheck, JsonSchema, LlmProvider, LlmTransport, RawRequest, RawResponse } from '../types';

export const DEFAULT_FIXTURE_DIR = 'fixtures/llm';
export const FIXTURE_RECORD_ENV = 'FIXTURE_RECORD';
export const FIXTURE_DIR_ENV = 'MTG_LLM_FIXTURE_DIR';

const CostSourceSchema = z.enum(['reported', 'estimated', 'unknown']);

/**
 * The reconciliation as recorded, and why it is optional.
 *
 * Fixtures recorded before `reconcileCost` existed carry the dollars and the
 * usage and no verdict, and re-deriving one on read would be a guess: the
 * cache-write TTL that priced the original call is not in the file, and pricing
 * a 1-hour write at the 5-minute default would contradict every honest call in
 * the corpus. So an older recording replays as `unchecked` — which is what it
 * is — and a recording made from here on carries the verdict its live call got.
 */
const CostCheckSchema = z.object({
  reportedUsd: z.number().nullable(),
  pricedUsd: z.number().nullable(),
  usageMeasured: z.boolean(),
  agreement: z.enum(['corroborated', 'unchecked', 'contradicted']),
  detail: z.string(),
});

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
});

const RecordedFixtureSchema = z.object({
  key: z.string().min(1),
  recordedAt: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  request: z.object({
    system: z.string(),
    prompt: z.string(),
    schema: z.record(z.string(), z.unknown()),
  }),
  response: z.object({
    text: z.string(),
    structured: z.unknown().optional(),
    usage: UsageSchema,
    costUsd: z.number().nonnegative(),
    costSource: CostSourceSchema,
    costCheck: CostCheckSchema.optional(),
  }),
});

export type RecordedFixture = z.infer<typeof RecordedFixtureSchema>;

export interface FixtureTransportOptions {
  /** Directory holding `<key>.json` files. */
  readonly dir?: string;
  /** Force record mode; defaults to `FIXTURE_RECORD=1`. */
  readonly record?: boolean;
  /** Live transport used only in record mode. A thunk defers construction. */
  readonly delegate?: LlmTransport | (() => LlmTransport);
  /** Label stored in fixtures written without a delegate model. */
  readonly model?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Observes the stable key for every fixture served, including repeats. */
  readonly onCall?: (key: string) => void;
}

export interface FixtureProviderOptions extends FixtureTransportOptions {
  readonly budget?: BudgetGuard;
  readonly maxAttempts?: number;
  readonly defaultMaxTokens?: number;
}

export function fixturePath(dir: string, key: string): string {
  return join(dir, `${key}.json`);
}

function recordedValue(fixture: RecordedFixture): unknown | undefined {
  if (fixture.response.structured !== undefined) return fixture.response.structured;
  const extracted = extractJsonValue(fixture.response.text);
  return extracted.ok ? extracted.value : undefined;
}

const OUTPUT_CONTRACT_PREFIX =
  '<output_contract>\nReturn a single JSON value that validates against this JSON Schema:\n';
const OUTPUT_CONTRACT_SUFFIX =
  '\nReturn only that JSON value. No prose, no explanation, no markdown fences.\n</output_contract>';

/**
 * The task-and-retry portion of a completion prompt, with its generated schema
 * block replaced by one stable marker.
 *
 * `runCompletion` embeds the JSON Schema in the prompt it hands this transport.
 * Comparing that whole prompt made the additive-schema fallback below
 * unreachable for real completion requests: the schema widening necessarily
 * changed both `request.schema` and `request.prompt`. Match only the exact
 * wrapper `buildAttemptPrompt` emits, and leave arbitrary prompts byte-sensitive.
 */
function promptWithoutGeneratedContract(prompt: string): string | null {
  const start = prompt.indexOf(OUTPUT_CONTRACT_PREFIX);
  if (start < 0 || prompt.indexOf(OUTPUT_CONTRACT_PREFIX, start + 1) >= 0) return null;
  const contentStart = start + OUTPUT_CONTRACT_PREFIX.length;
  const end = prompt.indexOf(OUTPUT_CONTRACT_SUFFIX, contentStart);
  if (end < 0 || prompt.indexOf(OUTPUT_CONTRACT_SUFFIX, end + 1) >= 0) return null;
  return `${prompt.slice(0, contentStart)}<schema>${prompt.slice(end)}`;
}

function sameFixturePrompt(recorded: string, requested: string): boolean {
  if (recorded === requested) return true;
  const recordedTask = promptWithoutGeneratedContract(recorded);
  return recordedTask !== null && recordedTask === promptWithoutGeneratedContract(requested);
}

function compatibleFixture(dir: string, request: RawRequest): RecordedFixture | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[0-9a-f]{32}\.json$/.test(entry.name))
    .map((entry) => readFixture(join(dir, entry.name)))
    .filter(
      (fixture) =>
        fixture.request.system === request.system &&
        sameFixturePrompt(fixture.request.prompt, request.prompt) &&
        isStrictlyAdditiveSchemaWidening(fixture.request.schema, request.jsonSchema),
    )
    .filter((fixture) => {
      const value = recordedValue(fixture);
      if (value === undefined) return false;
      try {
        return (
          z.fromJSONSchema(fixture.request.schema).safeParse(value).success &&
          z.fromJSONSchema(request.jsonSchema).safeParse(value).success
        );
      } catch {
        return false;
      }
    });
  const maximal = candidates.filter((candidate) =>
    candidates.every(
      (other) =>
        other.key === candidate.key ||
        !isStrictlyAdditiveSchemaWidening(candidate.request.schema, other.request.schema),
    ),
  );
  if (maximal.length > 1) {
    throw new LlmTransportError(
      'fixture',
      `multiple incomparable older fixtures match this additive schema widening: ${maximal.map(({ key }) => key).join(', ')}`,
    );
  }
  return maximal[0] ?? null;
}

export function createFixtureTransport(options: FixtureTransportOptions = {}): LlmTransport {
  const env = options.env ?? process.env;
  const dir = options.dir ?? env[FIXTURE_DIR_ENV] ?? DEFAULT_FIXTURE_DIR;
  const recording = options.record ?? env[FIXTURE_RECORD_ENV] === '1';
  const model = options.model ?? 'fixture';

  let delegate: LlmTransport | undefined;
  const resolveDelegate = (): LlmTransport => {
    if (delegate !== undefined) return delegate;
    if (options.delegate === undefined) {
      throw new LlmConfigError(
        `${FIXTURE_RECORD_ENV}=1 requires a live delegate transport to record from; ` +
          'pass `delegate` to createFixtureProvider or use resolveProvider(), which supplies one.',
      );
    }
    delegate = typeof options.delegate === 'function' ? options.delegate() : options.delegate;
    return delegate;
  };

  return {
    name: 'fixture',
    model,
    async send(request: RawRequest): Promise<RawResponse> {
      const key = fixtureKey({
        system: request.system,
        prompt: request.prompt,
        jsonSchema: request.jsonSchema,
      });
      const path = fixturePath(dir, key);

      if (recording) {
        const live = resolveDelegate();
        const response = await live.send(request);
        writeFixture(path, buildFixture(key, live.name, request, response));
        options.onCall?.(key);
        return response;
      }

      const fixture = existsSync(path) ? readFixture(path) : compatibleFixture(dir, request);
      if (fixture === null) throw new FixtureMissingError(key, path);
      const response = toRawResponse(fixture);
      options.onCall?.(fixture.key);
      return response;
    },
  };
}

export function createFixtureProvider(options: FixtureProviderOptions = {}): LlmProvider {
  return createProvider(createFixtureTransport(options), {
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    ...(options.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: options.defaultMaxTokens }),
  });
}

/** Read and validate a fixture file. Exported so tooling can lint a fixtures dir. */
export function readFixture(path: string): RecordedFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    throw new LlmTransportError('fixture', `fixture ${path} is not readable JSON`, {
      cause: error,
    });
  }
  const result = RecordedFixtureSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmTransportError(
      'fixture',
      `fixture ${path} does not match the fixture schema: ${result.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

export function writeFixture(path: string, fixture: RecordedFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
}

/** Build the on-disk record for a live response. Exported for recording tools. */
export function buildFixture(
  key: string,
  provider: string,
  request: RawRequest,
  response: RawResponse,
): RecordedFixture {
  return {
    key,
    recordedAt: new Date().toISOString(),
    provider,
    model: response.model,
    request: {
      system: request.system,
      prompt: request.prompt,
      schema: request.jsonSchema as Record<string, unknown>,
    },
    response: {
      text: response.text,
      ...(response.structured === undefined ? {} : { structured: response.structured }),
      usage: response.usage,
      costUsd: response.costUsd,
      costSource: response.costSource,
      costCheck: response.costCheck,
    },
  };
}

/** A recording made before the reconciliation existed; see `CostCheckSchema`. */
const UNRECONCILED: CostCheck = {
  reportedUsd: null,
  pricedUsd: null,
  usageMeasured: false,
  agreement: 'unchecked',
  detail:
    'this fixture was recorded before the reported bill was checked against the price table, ' +
    'and the file does not carry the cache-write TTL the original call was priced at. Re-record it to check it.',
};

function toRawResponse(fixture: RecordedFixture): RawResponse {
  const { response } = fixture;
  return {
    text: response.text,
    ...(response.structured === undefined ? {} : { structured: response.structured }),
    usage: response.usage,
    costUsd: response.costUsd,
    costSource: response.costSource,
    costCheck: response.costCheck ?? UNRECONCILED,
    model: fixture.model,
  };
}

/** The key a given request resolves to — useful for authoring fixtures by hand. */
export function keyForRequest(input: {
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: JsonSchema;
}): string {
  return fixtureKey(input);
}
