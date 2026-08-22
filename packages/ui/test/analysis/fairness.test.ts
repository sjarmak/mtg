// @vitest-environment jsdom
/**
 * The answer, over documents a real sweep produced.
 *
 * Every fixture here is `tools/analysis-run.ts` output — the same function
 * `npm run analyze` calls — so the verdicts asserted below were computed by
 * `@mtg/metrics` over games `@mtg/sim` played, not written by hand. The three
 * verdicts are all covered because the four fixtures happen to hold all three:
 * `run-a` is unfair on one pair, `run-b` passes everything it judged but
 * cannot judge the cards question, and `run-sparse` judged nothing at all.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FairnessPanel, NOT_ASKED, findingText, verdictTone } from '../../src/routes/analysis/fairness';
import { readAnalysisRun } from '../../src/routes/analysis/read';
import type { AnalysisRun, RunFairnessReading, RunFinding } from '../../src/routes/analysis/model';
import { FAIRNESS_QUESTIONS } from '../../src/routes/analysis/model';
import { fixtureJson, loadRun } from './support/fixtures';

afterEach(cleanup);

const UNFAIR = loadRun('run-a');
const CLEAN = loadRun('run-b');
const SPARSE = loadRun('run-sparse');

function panel(run: AnalysisRun): void {
  render(
    h(FairnessPanel, {
      fairness: run.fairness,
      about: run.label,
      games: run.health.games,
      distinctGames: run.health.distinctGames,
    }),
  );
}

function markup(run: AnalysisRun): string {
  return renderToStaticMarkup(
    h(FairnessPanel, {
      fairness: run.fairness,
      about: run.label,
      games: run.health.games,
      distinctGames: run.health.distinctGames,
    }),
  );
}

describe('the documents carry a verdict the producer computed', () => {
  it('reads back through the untrusted-JSON reader, fairness block and all', () => {
    // The fixtures are read through `readAnalysisRun` by `loadRun`, so this
    // asserts the seam rather than the file: a producer that stopped writing a
    // field the reader requires fails here.
    expect(UNFAIR.fairness.verdict).toBe('unfair');
    expect(CLEAN.fairness.verdict).toBe('unjudged');
    expect(SPARSE.fairness.verdict).toBe('unjudged');
  });

  it('always carries all four questions, in order, on every run', () => {
    for (const run of [UNFAIR, CLEAN, SPARSE]) {
      expect(run.fairness.readings.map((reading) => reading.question)).toEqual([...FAIRNESS_QUESTIONS]);
    }
  });

  it('names every gate a reading claims, and claims every gate', () => {
    for (const run of [UNFAIR, CLEAN, SPARSE]) {
      const claimed = run.fairness.readings.flatMap((reading) => reading.gates);
      expect([...claimed].sort()).toEqual([...run.health.gates.map((gate) => gate.id)].sort());
      expect(run.fairness.unattributed).toEqual([]);
    }
  });
});

describe('the verdict block', () => {
  it('leads with the question and its answer', () => {
    panel(UNFAIR);
    // Scoped to the verdict block: the reading that failed carries the same
    // word on its own badge, and the headline is the one a reader sees first.
    const verdict = within(screen.getByLabelText('Verdict'));
    expect(verdict.getByText('Is the set fair?')).toBeTruthy();
    expect(verdict.getByText('not fair')).toBeTruthy();
  });

  it('names the evidence behind the word, because fair over 90 games is not fair', () => {
    panel(UNFAIR);
    expect(screen.getByText(/5,400 games, 5,400 distinct trajectories/)).toBeTruthy();
  });

  it('is never green over a verdict that is not a pass', () => {
    expect(verdictTone('fair')).toBe('positive');
    expect(verdictTone('unfair')).toBe('negative');
    expect(verdictTone('unjudged')).toBe('pending');
  });

  it('says what would buy the evidence when nothing could be judged', () => {
    panel(SPARSE);
    expect(screen.getByText(/Not judged is not a pass/)).toBeTruthy();
    expect(screen.getByText(/npm run analyze/)).toBeTruthy();
  });
});

describe('the four readings', () => {
  it('draws all four whether or not they had anything to say', () => {
    panel(CLEAN);
    for (const reading of CLEAN.fairness.readings) {
      expect(screen.getByLabelText(reading.asks), reading.question).toBeTruthy();
    }
  });

  it('blames the question that failed and leaves the others alone', () => {
    const text = markup(UNFAIR);
    const balance = UNFAIR.fairness.readings.find((reading) => reading.question === 'balance');
    const shape = UNFAIR.fairness.readings.find((reading) => reading.question === 'shape');
    expect(balance?.verdict).toBe('unfair');
    expect(shape?.verdict).toBe('fair');
    expect(text).toContain('11 of 12 gates passed');
  });

  it('says why a gate could not be measured rather than calling the run fair anyway', () => {
    // The frozen set carries no activated or triggered ability, so both usage
    // gates are emitted and both are `notApplicable`. Nothing to measure is not
    // a pass: the question comes back unjudged and each row says which gate and
    // why, which is the difference between "0 of 2" and an answer.
    const cards = CLEAN.fairness.readings.find((reading) => reading.question === 'cards');
    expect(cards?.verdict).toBe('unjudged');
    expect(cards?.unjudged.map((entry) => entry.status)).toEqual(['notApplicable', 'notApplicable']);
    panel(CLEAN);
    expect(screen.getAllByText('nothing to measure').length).toBe(2);
    expect(screen.getAllByText(/0 of 90 pool cards carry an activated ability/).length).toBe(2);
  });

  it('says a question was never asked rather than printing zero of zero', () => {
    // Hand-built: every producer here derives an ability pool from the set, so
    // the ability gates are always emitted even when the answer is "nothing to
    // measure", and no fixture reaches a question with no gates at all. The
    // branch is still the one a question dropped from `@mtg/metrics` would take,
    // and "0 of 0 gates passed" is the sentence it exists to prevent.
    const cards = CLEAN.fairness.readings.find((reading) => reading.question === 'cards');
    expect(cards).toBeDefined();
    if (cards === undefined) return;
    const silent: RunFairnessReading = { ...cards, gates: [], passed: 0, findings: [], unjudged: [] };
    render(
      h(FairnessPanel, {
        fairness: { ...CLEAN.fairness, readings: [silent] },
        about: CLEAN.label,
        games: CLEAN.health.games,
        distinctGames: CLEAN.health.distinctGames,
      }),
    );
    expect(screen.getByText(NOT_ASKED)).toBeTruthy();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });
});

describe('a miss is a number in the units the gate measures', () => {
  const finding = UNFAIR.fairness.findings[0];

  it('carries both sides of the comparison and the distance between them', () => {
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(finding.distance).toBeCloseTo(Math.abs(finding.measured - finding.required), 10);
  });

  it('reads as a sentence a designer can act on', () => {
    panel(UNFAIR);
    expect(screen.getByText(/Measured 0\.397 against 0\.400, missing it by 0\.003/)).toBeTruthy();
  });

  it('says when the miss is smaller than the dice move the statistic', () => {
    // 0.003 against a per-pair seed deviation of 0.02: a real gate failure,
    // and one another seed could put on the other side of the line.
    expect(finding?.withinNoise).toBe(true);
    panel(UNFAIR);
    expect(screen.getByText(/another seed could put it either side/)).toBeTruthy();
    expect(screen.getByText('inside the noise')).toBeTruthy();
  });

  it('does not say it when the dice cannot explain the miss', () => {
    const wide: RunFinding = {
      gate: 'balance.spread',
      question: 'balance',
      label: 'win-rate spread across pairs',
      measured: 0.6,
      required: 0.3,
      distance: 0.3,
      noise: 0.02,
      withinNoise: false,
      detail: 'synthetic',
    };
    expect(findingText(wide)).not.toContain('either side');
    expect(findingText(wide)).toContain('missing it by 0.300');
  });
});

describe('a gate no question reads', () => {
  it('costs the run its verdict rather than being tidied away', () => {
    // Hand-built: no producer in this repository emits an unclaimed gate, which
    // is exactly why the state has to be tested rather than waited for.
    const stranger = {
      ...JSON.parse(JSON.stringify(CLEAN)),
      fairness: { ...CLEAN.fairness, unattributed: ['velocity.median'] },
    } as AnalysisRun;
    render(
      h(FairnessPanel, {
        fairness: stranger.fairness,
        about: stranger.label,
        games: stranger.health.games,
        distinctGames: stranger.health.distinctGames,
      }),
    );
    expect(screen.getByLabelText('Gates no question reads')).toBeTruthy();
    expect(screen.getByText(/velocity\.median/)).toBeTruthy();
  });
});

describe('the reader refuses a document it cannot trust', () => {
  /** The file as written, not the narrowed run: the reader takes the wire. */
  function raw(): { fairness: { readings: readonly unknown[]; verdict: string } } {
    return fixtureJson('run-b') as { fairness: { readings: readonly unknown[]; verdict: string } };
  }

  it('names the field when the fairness block is missing', () => {
    const document: Record<string, unknown> = { ...raw() };
    delete document['fairness'];
    expect(() => readAnalysisRun(document)).toThrow(/fairness.*missing/);
  });

  it('refuses a block that dropped one of the four questions', () => {
    const document = raw();
    const short = {
      ...document,
      fairness: { ...document.fairness, readings: document.fairness.readings.slice(0, 3) },
    };
    expect(() => readAnalysisRun(short)).toThrow(/four questions in order/);
  });

  it('refuses a verdict it does not know', () => {
    const document = raw();
    const bad = { ...document, fairness: { ...document.fairness, verdict: 'probably' } };
    expect(() => readAnalysisRun(bad)).toThrow(/unknown fairness verdict/);
  });

  it('refuses a gate whose band is not two numbers', () => {
    const document = fixtureJson('run-b') as { health: { gates: readonly Record<string, unknown>[] } };
    const gates = document.health.gates.map((gate, index) =>
      index === 0 ? { ...gate, band: { min: null } } : gate,
    );
    expect(() => readAnalysisRun({ ...document, health: { ...document.health, gates } })).toThrow(
      /band\.max.*missing/,
    );
  });
});
