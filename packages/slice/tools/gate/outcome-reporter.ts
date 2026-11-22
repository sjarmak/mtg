/**
 * The one thing the exit code does not say: whether the red was asserted or
 * merely timed out.
 *
 * `verdict.ts` will only write a red base verdict down when at least one failed
 * file failed an assertion, because on this box a wave of parallel lanes turns
 * vitest's budgets into a queueing measurement and a memoized red would abort
 * every later lane on that sha. Making that call needs the run's modules, which
 * exist only inside the run, so it is taken here and handed out as data.
 *
 * It is a fifth reporter rather than more of an existing one for the reason the
 * other four are separate: each answers one question. `reporter.ts` explains a
 * timeout, `rpc-timeout.ts` decides whether a lost channel may be an exit code,
 * `unaccounted.ts` asks whether every collected file came back, and this one
 * writes down what the caller outside the process needs and cannot see.
 *
 * It is inert unless `MTG_GATE_OUTCOME` names a path, so every ordinary run is
 * unaffected: no file, no output, no change to the exit code in either
 * direction. `redShapeOf` is imported from `reporter.ts` rather than copied,
 * because the subtlety it carries — a failure with one ordinary error beside
 * one timeout is an ordinary failure — is exactly the kind that diverges when
 * it exists twice.
 */
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Reporter, TestModule } from 'vitest/node';
import { loadSource } from '../test-load/load-source';
import { redShapeOf } from '../test-load/reporter';
import { classifyTimeoutOnly } from '../test-load/timeout-only';
import { type LoadAttribution, attributeLoad } from './load';

/** What the gate reads back out of a finished run. */
export interface GateOutcomeFile {
  readonly redFiles: readonly string[];
  readonly timeoutOnlyFiles: readonly string[];
  readonly selectedTestFiles: readonly string[];
  /**
   * What the run itself attributed its red files to, so a stored verdict keeps
   * the attribution its own output printed (`mtg-tgsol`). `null` on a green run,
   * when the load reporter is not in this run, and when nothing was sampled.
   */
  readonly load: LoadAttribution | null;
}

export default class GateOutcomeReporter implements Reporter {
  onTestRunEnd(modules: readonly TestModule[]): void {
    const target = process.env.MTG_GATE_OUTCOME;
    if (target === undefined || target === '') return;
    const shapes = modules.map(redShapeOf);
    const verdict = classifyTimeoutOnly(shapes);
    const redFiles = shapes.filter((shape) => shape.state === 'failed').map((shape) => shape.moduleId);
    const selectedTestFiles = modules.map((module) => relative(process.cwd(), module.moduleId)).sort();
    const timeoutOnlyFiles =
      verdict.kind === 'timeout-only' ? verdict.modules.map((module) => module.moduleId) : [];
    const source = loadSource();
    const load =
      source === null ? null : attributeLoad(source.timeouts(), source.machine(), redFiles, timeoutOnlyFiles);
    const outcome: GateOutcomeFile = { redFiles, timeoutOnlyFiles, selectedTestFiles, load };
    writeFileSync(target, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
  }
}
