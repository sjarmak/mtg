/**
 * Checking a reported bill against a priced one.
 *
 * A backend that reports dollars gives this repo a number nobody here derived,
 * and for a long time that number was simply recorded. It is not free of
 * error: on the flagship set corpus two of 151 recorded calls carry dollars
 * their own usage block cannot account for — one billing $0.65903 against four
 * zeros, one billing nine times what its tokens are worth — and both were
 * summed into a published total that read as settled.
 *
 * The check is cheap and exact. `providers/pricing.ts`, applied to the usage
 * the same response carried, reproduces the `claude-cli` binary's own
 * `total_cost_usd` to the cent on every call whose two fields are consistent.
 * So agreement is real evidence and a disagreement is a fact, not noise.
 *
 * What this module deliberately does not do is pick a winner. When the two
 * accounts disagree, this layer knows that one of them is wrong and cannot
 * know which — the price table can be stale and the envelope can be
 * incomplete — so it keeps both and says so. Somebody reading a report is in a
 * position to judge; a silent `??` in a transport is not.
 */
import { estimateCostUsd } from './providers/pricing';
import type { CacheTtl, CacheWriteSplit } from './providers/pricing';
import type { CostCheck, TokenUsage } from './types';

/**
 * How far apart two accounts of the same call may be before they disagree.
 *
 * The observed agreement is exact to floating-point noise, so this band is not
 * fitted to any real spread — it exists so that a cent of rounding somewhere
 * downstream cannot manufacture an alarm. A price table that has genuinely
 * drifted moves every call well outside it, which is the alarm firing
 * correctly rather than a false one.
 */
export const COST_AGREEMENT_TOLERANCE_USD = 0.0001;
export const COST_AGREEMENT_TOLERANCE_RATIO = 0.01;

function usd(value: number): string {
  return `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}

function withinTolerance(a: number, b: number): boolean {
  const gap = Math.abs(a - b);
  return gap <= Math.max(COST_AGREEMENT_TOLERANCE_USD, COST_AGREEMENT_TOLERANCE_RATIO * Math.max(a, b));
}

export interface ReconcileInput {
  readonly model: string;
  readonly usage: TokenUsage;
  /**
   * `false` when the response carried no usage block at all. The zeros in
   * `usage` are then a placeholder for an absent measurement, not a measured
   * absence, and dollars reported beside them cannot be checked by anything.
   */
  readonly usageMeasured: boolean;
  /** The backend's own figure, or `null` when it reported none. */
  readonly reportedUsd: number | null;
  /** The TTL, or the reported split, the cache writes were made at. */
  readonly cacheWrite?: CacheTtl | CacheWriteSplit;
}

/** Both accounts of one call's dollars, and a verdict on whether they agree. */
export function reconcileCost(input: ReconcileInput): CostCheck {
  const estimate =
    input.cacheWrite === undefined
      ? estimateCostUsd(input.model, input.usage)
      : estimateCostUsd(input.model, input.usage, input.cacheWrite);
  const pricedUsd = estimate.source === 'unknown' ? null : estimate.costUsd;
  const reportedUsd = input.reportedUsd;

  if (reportedUsd !== null && !input.usageMeasured) {
    return {
      reportedUsd,
      pricedUsd: null,
      usageMeasured: false,
      agreement: 'contradicted',
      detail:
        `the backend billed ${usd(reportedUsd)} and sent no usage block, so nothing measures what was bought. ` +
        'The dollars are recorded and the volume is not; do not read the token totals as covering this call.',
    };
  }
  if (reportedUsd === null || pricedUsd === null) {
    const only =
      reportedUsd === null
        ? pricedUsd === null
          ? 'neither the backend nor the price table produced a figure'
          : `only the price table produced a figure, ${usd(pricedUsd)}`
        : `only the backend produced a figure, ${usd(reportedUsd)}; no price table covers ${input.model}`;
    return {
      reportedUsd,
      pricedUsd,
      usageMeasured: input.usageMeasured,
      agreement: 'unchecked',
      detail: `${only}, so there is nothing to check it against`,
    };
  }
  if (withinTolerance(reportedUsd, pricedUsd)) {
    return {
      reportedUsd,
      pricedUsd,
      usageMeasured: input.usageMeasured,
      agreement: 'corroborated',
      detail: `the backend billed ${usd(reportedUsd)} and its own usage prices at ${usd(pricedUsd)}`,
    };
  }
  return {
    reportedUsd,
    pricedUsd,
    usageMeasured: input.usageMeasured,
    agreement: 'contradicted',
    detail:
      `the backend billed ${usd(reportedUsd)} and its own usage prices at ${usd(pricedUsd)}, ` +
      `a gap of ${usd(Math.abs(reportedUsd - pricedUsd))}. One of the two is wrong and this layer cannot say which.`,
  };
}

/** One line per check that is not corroborated, for a report or an error. */
export function describeCostChecks(checks: readonly CostCheck[]): string {
  return checks
    .filter((check) => check.agreement !== 'corroborated')
    .map((check) => `  ${check.agreement}: ${check.detail}`)
    .join('\n');
}

/**
 * Every billed token component, named.
 *
 * Printing `inputTokens` and `outputTokens` alone is the same class of error
 * this module exists for: on a prompt-cached run the fresh-input count is a
 * rounding error and the cache lines carry the volume, so those two fields
 * describe a call nobody made. The 249-card flagship set run printed "68 in
 * / 169574 out" against 1,847,881 cache writes and 798,248 cache reads.
 */
export function describeUsage(usage: TokenUsage): string {
  const billed =
    usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  return (
    `${grouped(billed)} billed — ${grouped(usage.inputTokens)} fresh input, ` +
    `${grouped(usage.cacheCreationInputTokens)} cache write, ` +
    `${grouped(usage.cacheReadInputTokens)} cache read, ${grouped(usage.outputTokens)} output`
  );
}

/**
 * Thousands separators, computed rather than delegated to `toLocaleString`:
 * these numbers land in CI artifacts that have to come out byte-identical
 * wherever they run, which rules out a locale-sensitive formatter.
 */
function grouped(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
