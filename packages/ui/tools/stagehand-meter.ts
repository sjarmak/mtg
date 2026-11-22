/**
 * The Stagehand path's spend meter (`--max-usd`, `mtg-onjme.2`): a thin log
 * over `@mtg/llm`'s `BudgetGuard`, which owns the ceiling.
 *
 * One guard carries both of the armed path's calls. The `observe()` model call
 * goes through an `@mtg/llm` provider built on this guard, which asserts the
 * ceiling before every backend attempt and records what each one cost (the
 * `claude-cli` transport reports its own dollars). Jev's `evaluate` is not an
 * `@mtg/llm` call, so `meterJev` in `stagehand-runner.ts` asserts and records
 * against the same guard by hand, priced from `stagehand-price-table.ts`.
 *
 * What this adds on top of the guard is the per-step story the run report
 * needs: which step spent what, and whether the run stopped because the guard
 * refused. The refusal is remembered here rather than read off the error a
 * step catches, because an error thrown inside Stagehand's `ClientLLM.generate`
 * callback reaches `observe()`'s caller rewrapped, and an `instanceof` check
 * there would miss it.
 *
 * Per-call records are the guard's snapshot before a call subtracted from the
 * one after, which counts attempts that failed validation too (they spent, and
 * raise without a `CompletionMeta`). That assumes calls do not overlap, which
 * holds for the three steps: each awaits one `observe()`, then one Jev call.
 */
import { LlmBudgetExceededError } from '@mtg/llm';
import type { BudgetGuard, BudgetSnapshot } from '@mtg/llm';

/**
 * What a call's answer looked like, for the two questions a zero-candidate
 * step cannot otherwise answer: did the model say anything, and did it name
 * any elements. `mtg-5a89i`: a live run reported four calls, all billed, all
 * with output tokens, and every step still zero candidates — with no raw
 * answer recorded, nothing said whether the model found no elements or found
 * some that `observe()` then dropped.
 */
export interface CallDiagnostics {
  readonly rawText: string | null;
  readonly elementCount: number | null;
}

export interface MeterCallRecord {
  readonly step: string | null;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
  readonly rawText: string | null;
  readonly elementCount: number | null;
}

/** What the guard refused, and where the run was when it did. */
export interface CeilingRefusal {
  readonly maxUsd: number;
  readonly spentUsd: number;
  readonly step: string | null;
}

export class StagehandMeter {
  private step: string | null = null;
  private readonly log: MeterCallRecord[] = [];
  private refused: CeilingRefusal | null = null;

  constructor(readonly budget: BudgetGuard) {}

  /** Labels every call recorded until the next `setStep`, so the report can name which step spent what. */
  setStep(step: string | null): void {
    this.step = step;
  }

  snapshot(): BudgetSnapshot {
    return this.budget.snapshot();
  }

  callLog(): readonly MeterCallRecord[] {
    return this.log;
  }

  /** The guard's refusal, if any call on this run met one. */
  refusal(): CeilingRefusal | null {
    return this.refused;
  }

  /**
   * Runs one model call, logging what it spent under the current step. A
   * budget refusal is remembered before it is rethrown, so the runner can tell
   * a ceiling stop from a step failure whatever the error looks like by the
   * time it arrives.
   *
   * `diagnosticsOf` reads the call's own result for the raw answer and its
   * element count; omitted for a call (Jev's) that has neither. A call that
   * throws logs no diagnostics — the failure itself is the record.
   */
  async track<T>(
    modelId: string,
    call: () => Promise<T>,
    diagnosticsOf?: (result: T) => CallDiagnostics,
  ): Promise<T> {
    const before = this.budget.snapshot();
    let diagnostics: CallDiagnostics | null = null;
    try {
      const result = await call();
      diagnostics = diagnosticsOf?.(result) ?? null;
      return result;
    } catch (error) {
      if (error instanceof LlmBudgetExceededError) this.noteRefusal();
      throw error;
    } finally {
      this.logSince(modelId, before, diagnostics);
    }
  }

  private noteRefusal(): void {
    if (this.refused !== null) return;
    const snapshot = this.budget.snapshot();
    this.refused = {
      maxUsd: snapshot.limits.maxUsd ?? Number.POSITIVE_INFINITY,
      spentUsd: snapshot.spentUsd,
      step: this.step,
    };
  }

  private logSince(modelId: string, before: BudgetSnapshot, diagnostics: CallDiagnostics | null): void {
    const after = this.budget.snapshot();
    if (after.calls === before.calls) return;
    this.log.push({
      step: this.step,
      modelId,
      inputTokens: after.usage.inputTokens - before.usage.inputTokens,
      outputTokens: after.usage.outputTokens - before.usage.outputTokens,
      usd: after.spentUsd - before.spentUsd,
      rawText: diagnostics?.rawText ?? null,
      elementCount: diagnostics?.elementCount ?? null,
    });
  }
}
