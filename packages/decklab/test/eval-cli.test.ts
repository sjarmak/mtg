/**
 * The exit gate `eval-cli.ts` computes from a finished summary.
 *
 * `main` makes live model calls through `runEval`, and this suite must not:
 * the gate lives in `evalPassed`, a pure function of `EvalSummary` extracted
 * from `main` for exactly this reason (mtg-bc2.24.3). `main`'s own body is
 * left with nothing but `return evalPassed(result.summary) ? 0 : 1`, so
 * driving `evalPassed` over a constructed summary is driving the same
 * decision `process.exitCode` is set from — without paying for a run.
 *
 * Before this split the exit code was computed inline in `main` and nothing
 * exercised it except an actual paid run. The measurement itself
 * (`trace.test.ts`) and the clean case (`eval.test.ts`) were both tested; the
 * gate between "a finding was reported" and "the process exits non-zero" was
 * not.
 */
import { describe, expect, it } from 'vitest';
import type { EvalSummary } from '../src/eval';
import { evalPassed } from '../src/eval-cli';

/**
 * A summary that clears every clause: informed strictly beats baseline on
 * violations, matches or beats it on clean decks, nothing failed to build,
 * and every choice traced. Each test below breaks exactly one clause.
 */
const PASSING: EvalSummary = {
  scenarios: 1,
  informedFailures: 0,
  baselineFailures: 0,
  judgedScenarios: 1,
  tracing: { decks: 1, cleanDecks: 1, chosenEntries: 9, citedEntries: 9, findings: 0, derivedBasics: 24 },
  informedCleanDecks: 1,
  baselineCleanDecks: 1,
  informedViolations: 0,
  baselineViolations: 3,
  informedUnknownCards: 0,
  baselineUnknownCards: 0,
  informedIllegalCards: 0,
  baselineIllegalCards: 0,
  informedWins: 1,
  baselineWins: 0,
  ties: 0,
  informedMeanScore: 8,
  baselineMeanScore: 5,
};

describe('evalPassed', () => {
  it('passes a summary where informed wins on conformance and every choice traces', () => {
    expect(evalPassed(PASSING)).toBe(true);
  });

  // The bead's own case: a trace finding is not a `Violation` (see trace.ts's
  // docblock on why not), so it does not touch informedViolations or
  // informedCleanDecks. Without `held` in the gate this summary would pass.
  it('fails when the trace measurement reports a finding, even though conformance looks clean', () => {
    const summary: EvalSummary = {
      ...PASSING,
      tracing: { ...PASSING.tracing, findings: 1, cleanDecks: 0 },
    };
    expect(evalPassed(summary)).toBe(false);
  });

  it('fails when an informed build produced no deck at all', () => {
    const summary: EvalSummary = { ...PASSING, informedFailures: 1 };
    expect(evalPassed(summary)).toBe(false);
  });

  it('fails when the informed pipeline did not clear fewer violations than the baseline', () => {
    const summary: EvalSummary = { ...PASSING, informedViolations: 3, baselineViolations: 3 };
    expect(evalPassed(summary)).toBe(false);
  });

  it('fails when the informed pipeline built fewer clean decks than the baseline', () => {
    const summary: EvalSummary = { ...PASSING, informedCleanDecks: 0, baselineCleanDecks: 1 };
    expect(evalPassed(summary)).toBe(false);
  });
});
