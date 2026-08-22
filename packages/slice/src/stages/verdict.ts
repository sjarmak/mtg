/**
 * Stage 4 — metrics to a verdict.
 *
 * The stage succeeds when it produces a verdict; the verdict itself is the
 * measurement, and whether a red band ends the run is the caller's policy
 * (`--metrics-gate`). What is not tolerated here is a run that produced no
 * gates at all: an empty gate list means the metrics harness did not see the
 * logs, which is a broken pipeline pretending to be a clean bill of health.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FormatHealth, GateResult } from '@mtg/metrics';
import {
  formatGates,
  formatHealth,
  healthFailures,
  healthNotApplicable,
  healthUnderSampled,
  healthWithinNoise,
  report,
} from '@mtg/metrics';
import type { SimGameLog } from '@mtg/sim';
import { failStage } from '../errors';

export type SliceVerdict = 'pass' | 'fail';

/**
 * Every gate, sorted into its status and reduced to one passed count.
 *
 * Mirrors `@mtg/metrics`'s own `report.ts` overview line: four ways to not
 * answer a gate, all four subtracted from the pass count. A status left out of
 * this arithmetic reads as green in the one line most people read, which is
 * exactly what this function replaces: `passed` used to be `gates.length -
 * failures.length - underSampled.length`, so a `notApplicable` gate (nothing
 * in the pool to measure) and a `withinNoise` gate (a miss the run's own dice
 * cannot be told apart from) both landed in the pass count by omission.
 */
export interface GateCensus {
  readonly failures: readonly GateResult[];
  readonly underSampled: readonly GateResult[];
  readonly notApplicable: readonly GateResult[];
  readonly withinNoise: readonly GateResult[];
  readonly passed: number;
}

export function censusGates(health: FormatHealth): GateCensus {
  const failures = healthFailures(health);
  const underSampled = healthUnderSampled(health);
  const notApplicable = healthNotApplicable(health);
  const withinNoise = healthWithinNoise(health);
  return {
    failures,
    underSampled,
    notApplicable,
    withinNoise,
    passed:
      health.gates.length - failures.length - underSampled.length - notApplicable.length - withinNoise.length,
  };
}

export interface VerdictStageResult {
  readonly verdict: SliceVerdict;
  readonly health: FormatHealth;
  readonly failures: readonly GateResult[];
  readonly underSampled: readonly GateResult[];
  readonly notApplicable: readonly GateResult[];
  readonly withinNoise: readonly GateResult[];
  readonly passed: number;
  readonly gatesText: string;
  readonly reportPath: string;
  readonly gatesPath: string;
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

export function runVerdictStage(
  logs: readonly SimGameLog[],
  label: string,
  outDir: string,
): VerdictStageResult {
  if (logs.length === 0) failStage('metrics', 'no game logs reached the metrics stage');

  const health = formatHealth(logs, { label });
  if (health.gates.length === 0) {
    failStage('metrics', `the gate suite produced no gates over ${logs.length} games`);
  }

  const census = censusGates(health);
  const reportPath = join(outDir, 'format-health.md');
  const gatesPath = join(outDir, 'gates.json');
  write(reportPath, report(health));
  write(gatesPath, `${JSON.stringify(health.gates, null, 2)}\n`);

  return {
    verdict: census.failures.length === 0 ? 'pass' : 'fail',
    health,
    failures: census.failures,
    underSampled: census.underSampled,
    notApplicable: census.notApplicable,
    withinNoise: census.withinNoise,
    passed: census.passed,
    gatesText: formatGates(health.gates),
    reportPath,
    gatesPath,
  };
}
