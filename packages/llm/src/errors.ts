/**
 * Typed errors for `@mtg/llm`.
 *
 * Every failure mode of a model call gets its own class so callers can branch
 * on the failure instead of string-matching a message: schema validation that
 * exhausted its retries, a transport that died, a budget ceiling that refused
 * the call, a missing fixture, a misconfigured provider.
 */
import type { AttemptRecord, CompletionSpend, ProviderName } from './types';
import { UNKNOWN_SPEND } from './types';

export const LLM_ERROR_CODES = [
  'schema_validation',
  'transport',
  'refusal',
  'budget_exceeded',
  'fixture_missing',
  'provider_unavailable',
  'config',
] as const;

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

/** Base class for everything this package throws. */
export abstract class LlmError extends Error {
  abstract readonly code: LlmErrorCode;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export function isLlmError(value: unknown): value is LlmError {
  return value instanceof LlmError;
}

/**
 * Every attempt produced output the schema rejected. Carries each attempt's raw
 * output and issue list so a failed generation is debuggable without a rerun,
 * and the `spend` those attempts burned so it is not lost with the completion
 * that never returned a `CompletionMeta`.
 *
 * `spend` defaults to `UNKNOWN_SPEND` because this error is also constructed by
 * hand — by a test stub standing in for a provider — and such a caller has no
 * figure to give. `null` dollars there says so; a `0` would claim the attempts
 * were free.
 */
export class LlmSchemaValidationError extends LlmError {
  readonly code = 'schema_validation';

  constructor(
    readonly provider: ProviderName,
    readonly model: string,
    readonly attempts: readonly AttemptRecord[],
    readonly spend: CompletionSpend = UNKNOWN_SPEND,
  ) {
    super(
      `${provider} (${model}) failed schema validation after ${attempts.length} attempt(s), ` +
        `${formatSpend(spend)}:\n` +
        attempts.map(formatAttempt).join('\n'),
    );
  }
}

/**
 * A contradicted figure is named as one here rather than printed bare: the
 * whole point of keeping two accounts is that a number nobody can check does
 * not get to look like a number somebody did.
 */
function formatSpend(spend: CompletionSpend): string {
  if (spend.costUsd === null) return 'spend unknown';
  const checked = spend.costAgreement === 'contradicted' ? ', unreconciled' : '';
  return `spending $${spend.costUsd.toFixed(4)} (${spend.costSource}${checked})`;
}

function formatAttempt(attempt: AttemptRecord): string {
  const issues = attempt.issues.map((issue) => `      - ${issue}`).join('\n');
  return `  attempt ${attempt.attempt}:\n${issues}\n      raw: ${truncate(attempt.rawText, 400)}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… (${text.length} chars)`;
}

/** The underlying transport failed: non-zero exit, unparseable output, HTTP error. */
export class LlmTransportError extends LlmError {
  readonly code = 'transport';
  readonly exitCode: number | null;
  readonly httpStatus: number | null;
  readonly output: string | null;

  constructor(
    readonly provider: ProviderName,
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly exitCode?: number | null;
      readonly httpStatus?: number | null;
      readonly output?: string | null;
    },
  ) {
    super(`${provider}: ${message}`, { cause: options?.cause });
    this.exitCode = options?.exitCode ?? null;
    this.httpStatus = options?.httpStatus ?? null;
    this.output = options?.output ?? null;
  }
}

/** The model declined the request (safety classifiers or an explicit refusal). */
export class LlmRefusalError extends LlmError {
  readonly code = 'refusal';

  constructor(
    readonly provider: ProviderName,
    readonly model: string,
    readonly category: string | null,
  ) {
    super(`${provider} (${model}) refused the request${category === null ? '' : ` [${category}]`}`);
  }
}

/** A per-run ceiling refused the call. Thrown before the call is made. */
export class LlmBudgetExceededError extends LlmError {
  readonly code = 'budget_exceeded';

  constructor(
    readonly limit: 'usd' | 'tokens' | 'calls',
    readonly spent: number,
    readonly max: number,
  ) {
    super(
      `LLM budget exhausted: ${limit} ceiling ${max} reached (spent ${spent}). ` +
        'Raise the ceiling explicitly or start a new run; calls are refused, never silently continued.',
    );
  }
}

/** Replay mode found no recorded response for the computed key. */
export class FixtureMissingError extends LlmError {
  readonly code = 'fixture_missing';

  constructor(
    readonly key: string,
    readonly path: string,
  ) {
    super(`no fixture for key ${key} (expected ${path}), run with FIXTURE_RECORD=1 to record it`);
  }
}

/** No provider could be resolved from config or environment. */
export class LlmProviderUnavailableError extends LlmError {
  readonly code = 'provider_unavailable';

  constructor(readonly checked: readonly string[]) {
    super(
      'no LLM provider available. Choose one of:\n' +
        "  fixture       — set MTG_LLM_PROVIDER=fixture (replays packages' recorded responses; the only provider CI may use)\n" +
        '  claude-cli    — install the authenticated `claude` binary on PATH (or set MTG_LLM_CLAUDE_BINARY)\n' +
        '  anthropic-api — set ANTHROPIC_API_KEY\n' +
        `checked: ${checked.join(', ')}`,
    );
  }
}

/** The caller configured the provider in a way that cannot work. */
export class LlmConfigError extends LlmError {
  readonly code = 'config';
}
