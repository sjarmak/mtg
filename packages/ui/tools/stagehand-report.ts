/**
 * The Stagehand path's per-run report, written into the artifacts directory
 * in the same evidence shape the CDP path already writes (screenshots,
 * `evidence.json`, `packages/ui/tools/live-journey.ts`'s existing `Page`
 * class) — one file naming, per step, its instruction, candidates, Jev
 * probabilities, chosen selector, pass/fail, and every call's tokens and
 * dollars, so a ceiling refusal or an unmatched Jev answer is legible from
 * the artifacts alone.
 *
 * The totals are the run's `BudgetGuard` snapshot, not a sum this file does.
 * `unreconciledCalls` sits beside the dollars on purpose: nonzero means some
 * call's reported dollars and its measured usage disagreed, or it billed with
 * no usage at all, so `spentUsd` is a figure to investigate rather than one to
 * quote (`mtg-onjme.2`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BudgetSnapshot, TokenUsage } from '@mtg/llm';
import type { MeterCallRecord } from './stagehand-meter';

export interface CandidateSummary {
  readonly selector: string;
  readonly description: string;
}

export interface StepReport {
  readonly step: string;
  readonly instruction: string;
  readonly candidates: readonly CandidateSummary[];
  readonly probabilities: Readonly<Record<string, number>>;
  readonly chosenSelector: string | null;
  readonly status: 'pass' | 'fail';
  readonly detail: string | null;
}

export interface RunReport {
  readonly maxUsd: number;
  readonly spentUsd: number;
  /** Calls whose dollars and usage could not both be right; nonzero means do not quote `spentUsd`. */
  readonly unreconciledCalls: number;
  readonly callCount: number;
  readonly usage: TokenUsage;
  readonly stoppedAtCeiling: boolean;
  readonly stoppedAfterStep: string | null;
  readonly steps: readonly StepReport[];
  readonly calls: readonly MeterCallRecord[];
}

/** The report's totals, read straight off the guard. */
export function spendOf(
  snapshot: BudgetSnapshot,
): Pick<RunReport, 'spentUsd' | 'unreconciledCalls' | 'callCount' | 'usage'> {
  return {
    spentUsd: snapshot.spentUsd,
    unreconciledCalls: snapshot.unreconciledCalls,
    callCount: snapshot.calls,
    usage: snapshot.usage,
  };
}

/** One line for the console: the dollars, and the reconciliation count beside them. */
export function spendLine(report: RunReport): string {
  const tokens = `${String(report.usage.inputTokens)} in / ${String(report.usage.outputTokens)} out`;
  const warning =
    report.unreconciledCalls === 0 ? '' : ' (do not quote the dollars: investigate the unreconciled calls)';
  return (
    `spent $${report.spentUsd.toFixed(4)} of $${report.maxUsd.toFixed(2)} over ${String(report.callCount)} call(s), ` +
    `${tokens} tokens, ${String(report.unreconciledCalls)} unreconciled${warning}`
  );
}

export async function writeReport(artifactsDir: string, report: RunReport): Promise<string> {
  await mkdir(artifactsDir, { recursive: true });
  const filePath = path.join(artifactsDir, 'stagehand-report.json');
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return filePath;
}
