/**
 * Local price table for cost estimation.
 *
 * The Messages API reports token counts but not dollars, so a run's spend has to
 * be computed here. Prices drift, so every figure derived from this table is
 * tagged `estimated`; a model missing from the table yields `unknown` rather
 * than a made-up zero, which would let a budget guard sail past its ceiling.
 *
 * Source of the rates below: the bundled `claude-api` skill, "Current Models"
 * table (cached 2026-06-24) for the per-million input/output rates, and its
 * prompt-caching section for the two cache multipliers — cache reads bill at
 * ~0.1x the base input rate, cache writes at 1.25x for the 5-minute TTL and 2x
 * for the 1-hour TTL. Re-read that skill before editing a number here; do not
 * patch a rate from memory.
 *
 * ## This table is also a check, not only an estimate
 *
 * A backend that reports its own dollars is not thereby trustworthy: reported
 * and priced are two independent derivations, and comparing them is the only
 * thing that makes either checkable. They do agree. Priced against the usage
 * the same response carried, at the 1-hour cache-write multiplier, this table
 * reproduces the `claude-cli` binary's own `total_cost_usd` exactly — to the
 * cent on the recorded envelopes in `test/fixtures/claude-cli/`, and to within
 * floating-point noise on whole recorded runs. So a disagreement is a fact
 * about the response rather than a rounding artifact, and `reconcileCost` in
 * `../reconcile.ts` is what turns that fact into something a report can print.
 */
import type { CostSource, TokenUsage } from '../types';

export interface ModelPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

/**
 * Cache-write TTL, because the write multiplier depends on it.
 *
 * A single write multiplier is not enough to reproduce a real bill: the same
 * token count costs 1.25x at 5 minutes and 2x at one hour, a 60% difference on
 * the cache-creation line, which for a caching-heavy run is most of the spend.
 */
export type CacheTtl = '5m' | '1h';

export const CACHE_WRITE_MULTIPLIERS: Readonly<Record<CacheTtl, number>> = {
  '5m': 1.25,
  '1h': 2,
};

export const CACHE_READ_MULTIPLIER = 0.1;

/** The API's own default TTL, so an unqualified estimate matches an unqualified call. */
export const DEFAULT_CACHE_TTL: CacheTtl = '5m';

/**
 * Cache-creation tokens split by the TTL each was written at.
 *
 * A single `CacheTtl` says "the whole write was at this TTL", which is a guess
 * whenever the backend actually told us. The `claude-cli` envelope does tell
 * us — `usage.cache_creation` carries `ephemeral_5m_input_tokens` and
 * `ephemeral_1h_input_tokens` side by side — and guessing wrong is not a
 * rounding error: the 249-card flagship set run priced at the 5-minute
 * default comes to $32.38 against a bill of $46.24, a 30% understatement,
 * because every one of its writes was at the 1-hour TTL.
 *
 * Tokens the split does not account for are priced at `DEFAULT_CACHE_TTL`, so a
 * backend that reports a partial breakdown is costed rather than dropped.
 */
export interface CacheWriteSplit {
  readonly ttl5m: number;
  readonly ttl1h: number;
}

export function isCacheWriteSplit(value: CacheTtl | CacheWriteSplit): value is CacheWriteSplit {
  return typeof value !== 'string';
}

/** Dollars per million input tokens for the cache-creation line of one usage record. */
function cacheWriteUnits(usage: TokenUsage, cacheWrite: CacheTtl | CacheWriteSplit): number {
  if (!isCacheWriteSplit(cacheWrite)) {
    return usage.cacheCreationInputTokens * CACHE_WRITE_MULTIPLIERS[cacheWrite];
  }
  const stated = cacheWrite.ttl5m + cacheWrite.ttl1h;
  const rest = Math.max(0, usage.cacheCreationInputTokens - stated);
  return (
    cacheWrite.ttl5m * CACHE_WRITE_MULTIPLIERS['5m'] +
    cacheWrite.ttl1h * CACHE_WRITE_MULTIPLIERS['1h'] +
    rest * CACHE_WRITE_MULTIPLIERS[DEFAULT_CACHE_TTL]
  );
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-mythos-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-6': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

export interface CostEstimate {
  readonly costUsd: number;
  readonly source: CostSource;
}

/**
 * Look up a price by model id. Dated ids (`claude-haiku-4-5-20251001`) fall back
 * to the longest matching prefix so a snapshot release still gets a real number.
 */
export function priceFor(model: string): ModelPrice | undefined {
  const exact = MODEL_PRICES[model];
  if (exact !== undefined) return exact;

  let best: ModelPrice | undefined;
  let bestLength = 0;
  for (const [id, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(id) && id.length > bestLength) {
      best = price;
      bestLength = id.length;
    }
  }
  return best;
}

/**
 * Value a usage record at table rates.
 *
 * `cacheWrite` picks the cache-write multiplier; it defaults to the API's own
 * 5-minute default. Pass `'1h'` when the request asked for the long TTL, or a
 * `CacheWriteSplit` when the backend reported the breakdown — otherwise the
 * estimate understates the cache-creation line by 60%.
 *
 * A model the table does not cover returns `costUsd: 0` under `source:
 * 'unknown'`, and the two halves have to be read together. The zero is not a
 * price; it is the absence of one, and a caller that reads `costUsd` without
 * `source` will sum unpriced calls into a total that looks free.
 */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  cacheWrite: CacheTtl | CacheWriteSplit = DEFAULT_CACHE_TTL,
): CostEstimate {
  const price = priceFor(model);
  if (price === undefined) return { costUsd: 0, source: 'unknown' };

  const input = usage.inputTokens * price.inputPerMTok;
  const written = cacheWriteUnits(usage, cacheWrite) * price.inputPerMTok;
  const cacheRead = usage.cacheReadInputTokens * price.inputPerMTok * CACHE_READ_MULTIPLIER;
  const output = usage.outputTokens * price.outputPerMTok;
  return { costUsd: (input + written + cacheRead + output) / 1_000_000, source: 'estimated' };
}
