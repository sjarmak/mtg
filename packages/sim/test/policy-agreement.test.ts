/**
 * The agreement instrument's own arithmetic.
 *
 * Its value is diagnostic, so the two readings that must be exact are the ones
 * that anchor the scale: a candidate that *is* the reference scores 1, and a
 * candidate that ignores the state entirely does not. A reading between those
 * two is what tells a campaign verdict whether a losing candidate learned
 * something different or learned the same thing badly, and neither anchor being
 * right would make every reading in between unreadable.
 */
import { describe, expect, it } from 'vitest';
import type { Action, AgentView } from '@mtg/kernel';
import { playSimGame } from '../src/driver';
import { greedyBot, decideGreedy } from '../src/greedy-bot';
import { DEFAULT_GREEDY_CONFIG } from '../src/config';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '../src/fixtures';
import {
  candidateOwnsDecision,
  createPolicyAgreementRecorder,
  type PolicyAgreementReport,
} from '../src/policy-agreement';

function measure(candidate: (view: AgentView) => Action, games = 2): PolicyAgreementReport {
  const recorder = createPolicyAgreementRecorder();
  for (let index = 0; index < games; index += 1) {
    playSimGame({
      index,
      seed: `policy-agreement/test:${String(index)}`,
      decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
      startingPlayer: index % 2 === 0 ? 0 : 1,
      agents: [
        recorder.observe(greedyBot('left', DEFAULT_GREEDY_CONFIG), candidate),
        recorder.observe(greedyBot('right', DEFAULT_GREEDY_CONFIG), candidate),
      ],
      log: null,
    });
  }
  return recorder.report();
}

describe('policy agreement', () => {
  it('scores a candidate that is the reference at exactly one', () => {
    const report = measure((view) => decideGreedy(view, DEFAULT_GREEDY_CONFIG));
    expect(report.decisions).toBeGreaterThan(0);
    expect(report.agreement).toBe(1);
    expect(report.byKind.every((row) => row.agreement === 1)).toBe(true);
  });

  it('separates a state-blind candidate from the reference', () => {
    const report = measure((view) => {
      const first = view.decision.options[0];
      if (first === undefined) throw new Error('no options');
      return first;
    });
    expect(report.agreement).toBeLessThan(1);
    expect(report.uniformRandomAgreement).toBeGreaterThan(0);
    expect(report.uniformRandomAgreement).toBeLessThan(1);
    expect(report.meanOptions).toBeGreaterThan(1);
  });

  it('counts every candidate-owned decision exactly once, in one kind', () => {
    const report = measure((view) => decideGreedy(view, DEFAULT_GREEDY_CONFIG));
    const counted = report.byKind.reduce((total, row) => total + row.decisions, 0);
    expect(counted).toBe(report.decisions);
    expect(new Set(report.byKind.map((row) => row.kind)).size).toBe(report.byKind.length);
  });

  it('refuses to report a run in which the candidate owned nothing', () => {
    expect(() => createPolicyAgreementRecorder().report()).toThrow(
      'policy agreement observed no candidate-owned decision',
    );
  });

  it('admits exactly the decisions the learned bot does not delegate', () => {
    const recorder = createPolicyAgreementRecorder();
    const seen: boolean[] = [];
    playSimGame({
      index: 0,
      seed: 'policy-agreement/test/admission',
      decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
      startingPlayer: 0,
      agents: [
        recorder.observe(greedyBot('left', DEFAULT_GREEDY_CONFIG), (view) => {
          seen.push(candidateOwnsDecision(view));
          return decideGreedy(view, DEFAULT_GREEDY_CONFIG);
        }),
        recorder.observe(greedyBot('right', DEFAULT_GREEDY_CONFIG), (view) =>
          decideGreedy(view, DEFAULT_GREEDY_CONFIG),
        ),
      ],
      log: null,
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });
});
