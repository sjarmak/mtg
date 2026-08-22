/**
 * Per-run spend ceiling.
 *
 * The guard is checked *before* every backend call and updated after it, so a
 * run that reaches its ceiling refuses the next call with a typed error instead
 * of quietly continuing to spend. Ceilings are opt-in per limit: USD, total
 * tokens, and call count can each be set independently.
 */
import { LlmBudgetExceededError, LlmConfigError } from './errors';
import type { CostCheck, TokenUsage } from './types';
import { addUsage, totalTokens, ZERO_USAGE } from './types';

export interface BudgetLimits {
  readonly maxUsd?: number;
  readonly maxTokens?: number;
  readonly maxCalls?: number;
}

export interface BudgetSnapshot {
  readonly spentUsd: number;
  readonly usage: TokenUsage;
  readonly tokens: number;
  readonly calls: number;
  /**
   * Calls whose reported dollars and priced usage disagreed, or that billed
   * against no usage block at all.
   *
   * A ceiling is only as good as what it counts, and this is the count of calls
   * whose contribution to `spentUsd` and `usage` cannot both be right. Nonzero
   * means the totals below are a figure to investigate, not one to quote.
   */
  readonly unreconciledCalls: number;
  readonly limits: BudgetLimits;
}

export interface BudgetGuard {
  /** Throws `LlmBudgetExceededError` when any configured ceiling is already met. */
  assertAvailable(): void;
  record(entry: {
    readonly costUsd: number;
    readonly usage: TokenUsage;
    /** The reconciliation, when the transport produced one. */
    readonly costCheck?: CostCheck;
  }): void;
  snapshot(): BudgetSnapshot;
}

export function createBudgetGuard(limits: BudgetLimits = {}): BudgetGuard {
  assertPositive('maxUsd', limits.maxUsd);
  assertPositive('maxTokens', limits.maxTokens);
  assertPositive('maxCalls', limits.maxCalls);

  let spentUsd = 0;
  let usage: TokenUsage = ZERO_USAGE;
  let calls = 0;
  let unreconciledCalls = 0;

  return {
    assertAvailable(): void {
      if (limits.maxCalls !== undefined && calls >= limits.maxCalls) {
        throw new LlmBudgetExceededError('calls', calls, limits.maxCalls);
      }
      if (limits.maxUsd !== undefined && spentUsd >= limits.maxUsd) {
        throw new LlmBudgetExceededError('usd', spentUsd, limits.maxUsd);
      }
      const tokens = totalTokens(usage);
      if (limits.maxTokens !== undefined && tokens >= limits.maxTokens) {
        throw new LlmBudgetExceededError('tokens', tokens, limits.maxTokens);
      }
    },
    record(entry): void {
      if (!Number.isFinite(entry.costUsd) || entry.costUsd < 0) {
        throw new LlmConfigError(`transport reported a nonsensical cost: ${entry.costUsd}`);
      }
      spentUsd += entry.costUsd;
      usage = addUsage(usage, entry.usage);
      calls += 1;
      if (entry.costCheck?.agreement === 'contradicted') unreconciledCalls += 1;
    },
    snapshot(): BudgetSnapshot {
      return { spentUsd, usage, tokens: totalTokens(usage), calls, unreconciledCalls, limits };
    },
  };
}

/** A guard with no ceilings — accounting only. */
export function unlimitedBudget(): BudgetGuard {
  return createBudgetGuard();
}

function assertPositive(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new LlmConfigError(`${name} must be a positive finite number, got ${value}`);
  }
}
