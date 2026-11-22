import { describe, expect, it } from 'vitest';
import { greedyBot } from '../src/greedy-bot';
import { FIXTURE_DECK_GW, FIXTURE_DECK_RW } from '../src/fixtures';
import { centeredBranchAdvantages, learnedBranchExamplesFromGame } from '../src/learned-branch-dataset';

describe('counterfactual branch dataset', () => {
  it('labels both candidates by their centered within-decision utility difference', () => {
    const [chosen, alternative] = centeredBranchAdvantages(0.8, -0.4);
    expect(chosen).toBeCloseTo(0.6);
    expect(alternative).toBeCloseTo(-0.6);
    expect(centeredBranchAdvantages(-1, 1)).toEqual([-1, 1]);
    expect(centeredBranchAdvantages(0.25, 0.25)).toEqual([0, 0]);
  });

  it('adds exactly one deterministic continuation per sampled baseline decision', () => {
    const project = () =>
      learnedBranchExamplesFromGame({
        episodeId: 'branch-dataset-test',
        setup: {
          seed: 'branch-dataset-test',
          decks: [FIXTURE_DECK_RW, FIXTURE_DECK_GW],
          startingPlayer: 0,
          maximumTurns: 40,
        },
        reference: [greedyBot('left'), greedyBot('right')],
        sampleEvery: 1,
        maximumBranches: 2,
      });

    const first = project();
    const second = project();

    expect(first).toEqual(second);
    expect(first.cost.branchRollouts).toBe(2);
    expect(first.cost.sampledDecisions).toBe(2);
    expect(first.cost.eligibleDecisions).toBeGreaterThanOrEqual(2);
    expect(first.preferenceExamples.length).toBeGreaterThan(0);
    expect(first.advantageExamples.length % 2).toBe(0);
    for (let index = 0; index < first.advantageExamples.length; index += 2) {
      const chosen = first.advantageExamples[index];
      const alternative = first.advantageExamples[index + 1];
      expect(chosen?.episodeId).toBe(alternative?.episodeId);
      expect(chosen?.sequence).toBe(alternative?.sequence);
      expect(chosen?.return).toBeCloseTo(-(alternative?.return ?? Number.NaN));
    }
  });

  it('spends no branch rollout when a calibration candidate agrees with the reference', () => {
    const reference = [greedyBot('left'), greedyBot('right')] as const;
    const projection = learnedBranchExamplesFromGame({
      episodeId: 'branch-dataset-agreement',
      setup: {
        seed: 'branch-dataset-agreement',
        decks: [FIXTURE_DECK_RW, FIXTURE_DECK_GW],
        startingPlayer: 0,
        maximumTurns: 40,
      },
      reference,
      challenger: reference,
      sampleEvery: 1,
      maximumBranches: 2,
    });

    expect(projection.cost.branchRollouts).toBe(0);
    expect(projection.cost.sampledDecisions).toBe(0);
    expect(projection.advantageExamples).toEqual([]);
  });
});
