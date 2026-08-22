/**
 * The provider seam's vocabulary.
 *
 * Two layers live here. `LlmTransport` is the thin, per-backend layer: one
 * request in, one raw response out, no retries and no validation. `LlmProvider`
 * is what feature code sees: schema in, typed value out, with retries, budget
 * enforcement, and cost accounting owned by shared code (ZFC — judgment goes to
 * the model, policy stays in code).
 */
import type { ZodType } from 'zod';
import type { BudgetGuard } from './budget';

export const PROVIDER_NAMES = ['fixture', 'claude-cli', 'anthropic-api'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** A JSON Schema document, as produced from a Zod schema. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

/**
 * Where a cost figure came from. `reported` is the backend's own number,
 * `estimated` is computed from a local price table, `unknown` means we have no
 * basis for one — never a silent zero.
 */
export type CostSource = 'reported' | 'estimated' | 'unknown';

export function worstCostSource(sources: readonly CostSource[]): CostSource {
  if (sources.length === 0) return 'unknown';
  if (sources.includes('unknown')) return 'unknown';
  if (sources.includes('estimated')) return 'estimated';
  return 'reported';
}

/**
 * Whether the two independent accounts of one call's dollars line up.
 *
 * `corroborated` — the backend reported a figure and the local price table,
 * applied to the usage the *same response* carried, agrees with it. That is the
 * only state in which a reported dollar figure is a checkable number rather
 * than an assertion.
 *
 * `unchecked` — only one account exists, so there is nothing to compare. No
 * reported figure (the Messages API sends token counts and no dollars), or no
 * price for the model. Not a fault; the number is as good as its one source.
 *
 * `contradicted` — both accounts exist and they disagree, or dollars arrived
 * against a usage block the response never sent. One of the two numbers is
 * wrong and this layer cannot say which, so it must say both.
 */
export type CostAgreement = 'corroborated' | 'unchecked' | 'contradicted';

const AGREEMENT_SEVERITY: Readonly<Record<CostAgreement, number>> = {
  corroborated: 0,
  unchecked: 1,
  contradicted: 2,
};

/**
 * The two accounts of one call's spend, kept apart on purpose.
 *
 * Recording a single `costUsd` is what let a call bill $0.65903 against four
 * zero token counts and read as settled: the dollars and the volume came from
 * different fields of the same envelope, nothing ever compared them, and the
 * memo published the sum. Keeping both numbers and a verdict costs three
 * fields and makes the printed total traceable — every figure derived from a
 * `contradicted` check is a figure somebody has to look at.
 */
export interface CostCheck {
  /** The backend's own figure, or `null` when it reported none. */
  readonly reportedUsd: number | null;
  /** The local price table's value of this response's usage, or `null` when unpriced. */
  readonly pricedUsd: number | null;
  /**
   * Whether the response carried a usage block at all.
   *
   * Four zeros and an absent block are the same `TokenUsage` and are not the
   * same fact: one is a call that burned nothing, the other is a call nobody
   * measured. Only this flag tells them apart.
   */
  readonly usageMeasured: boolean;
  readonly agreement: CostAgreement;
  /** One sentence naming the numbers, for an error or a report. */
  readonly detail: string;
}

/** A call nothing is known about: no report, no price, no measurement. */
export const UNCHECKED_COST: CostCheck = {
  reportedUsd: null,
  pricedUsd: null,
  usageMeasured: false,
  agreement: 'unchecked',
  detail: 'no cost was reported and no price table covers this call',
};

/**
 * The worst of several checks — what a multi-attempt completion or a whole run
 * has to answer for. One contradicted attempt contradicts the total it is
 * summed into, so the aggregate can never be better than its worst part.
 */
export function worstAgreement(checks: readonly CostCheck[]): CostAgreement {
  if (checks.length === 0) return 'unchecked';
  let worst: CostAgreement = 'corroborated';
  for (const check of checks) {
    if (AGREEMENT_SEVERITY[check.agreement] > AGREEMENT_SEVERITY[worst]) worst = check.agreement;
  }
  return worst;
}

/**
 * What a completion burned, whether or not it produced a value.
 *
 * `costUsd` is `null` when no attempt could be priced at all — the `claude-cli`
 * transport reports `costSource: 'unknown'` whenever its envelope carries no
 * `total_cost_usd`, and a `0` there reads as a free call rather than an
 * unpriced one. When some attempts were priced and others were not, the number
 * is the sum of the priced ones and `costSource` is `'unknown'`, which makes it
 * a floor rather than the bill.
 *
 * `CompletionMeta` keeps its `costUsd: number` for the success path: it is read
 * by feature packages that sum it, and widening it is a change of its own.
 */
export interface CompletionSpend {
  /** Summed across every attempt, including the ones that failed validation. */
  readonly usage: TokenUsage;
  /** Dollars, or `null` when nothing in this completion could be priced. */
  readonly costUsd: number | null;
  readonly costSource: CostSource;
  /** Whether `costUsd` survived being checked against the price table. */
  readonly costAgreement: CostAgreement;
}

/** What a completion's accounting is worth, treating an absent check as unchecked. */
export function costAgreementOf(meta: Pick<CompletionMeta, 'costAgreement'>): CostAgreement {
  return meta.costAgreement ?? 'unchecked';
}

/** A completion nobody metered: no attempt is known to have been billed. */
export const UNKNOWN_SPEND: CompletionSpend = {
  usage: ZERO_USAGE,
  costUsd: null,
  costSource: 'unknown',
  costAgreement: 'unchecked',
};

export function completionSpend(
  usage: TokenUsage,
  costUsd: number,
  sources: readonly CostSource[],
  checks: readonly CostCheck[] = [],
): CompletionSpend {
  const priced = sources.some((source) => source !== 'unknown');
  return {
    usage,
    costUsd: priced ? costUsd : null,
    costSource: worstCostSource(sources),
    costAgreement: worstAgreement(checks),
  };
}

/** One backend call, fully resolved: the prompt already carries the schema contract. */
export interface RawRequest {
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: JsonSchema;
  readonly maxTokens: number;
  readonly temperature?: number;
}

/** One backend response, unvalidated against the caller's schema. */
export interface RawResponse {
  readonly text: string;
  /** Provider-native structured output, when the backend produced one. */
  readonly structured?: unknown;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly costSource: CostSource;
  /**
   * Both accounts of `costUsd` and whether they agree. See `CostCheck`.
   *
   * Optional because a hand-written stub in a test has genuinely reconciled
   * nothing, and `UNCHECKED_COST` says exactly that. It is optional in the one
   * direction that cannot lie: an absent check reads as "nobody compared",
   * never as "compared and agreed", so the failure mode of forgetting it is a
   * report that admits it does not know. Every transport in `providers/` does
   * fill it, and `test/cost-check.test.ts` fails if one stops.
   */
  readonly costCheck?: CostCheck;
  readonly model: string;
}

/** The check a response carried, or the honest absence of one. */
export function costCheckOf(response: Pick<RawResponse, 'costCheck'>): CostCheck {
  return response.costCheck ?? UNCHECKED_COST;
}

export interface LlmTransport {
  readonly name: ProviderName;
  readonly model: string;
  send(request: RawRequest): Promise<RawResponse>;
}

export interface CompletionRequest<T> {
  readonly system: string;
  readonly prompt: string;
  readonly schema: ZodType<T>;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** One failed attempt, kept so an exhausted retry loop is debuggable. */
export interface AttemptRecord {
  readonly attempt: number;
  readonly rawText: string;
  readonly issues: readonly string[];
}

export interface CompletionMeta {
  readonly provider: ProviderName;
  readonly model: string;
  /** Summed across every attempt, including the ones that failed validation. */
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly costSource: CostSource;
  /**
   * Whether `costUsd` survived being checked against the price table, worst
   * attempt first. A `contradicted` completion still returns its value — the
   * answer is fine, the accounting is not — and any total this feeds is a
   * number somebody has to look at rather than one they can quote.
   *
   * Optional for the same reason `RawResponse.costCheck` is, and absent means
   * `unchecked`: read it through `costAgreementOf`.
   */
  readonly costAgreement?: CostAgreement;
  /** Per-attempt detail behind `costAgreement`, in attempt order. */
  readonly costChecks?: readonly CostCheck[];
  readonly attempts: number;
  readonly durationMs: number;
}

export interface CompletionResult<T> {
  readonly value: T;
  /** The accepted attempt's raw text, before parsing. */
  readonly raw: string;
  readonly meta: CompletionMeta;
}

export interface LlmProvider {
  readonly name: ProviderName;
  readonly model: string;
  /**
   * The ceiling this provider spends against: asserted before every backend
   * attempt and recorded into the moment one comes back, including attempts
   * that go on to fail validation. A completion that raises instead of
   * returning therefore has no `CompletionMeta`, and this guard is the only
   * account of what it cost.
   */
  readonly budget: BudgetGuard;
  complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>>;
}
