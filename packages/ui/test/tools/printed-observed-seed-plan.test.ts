import { expect, it } from 'vitest';
import { observedSeedsFromPlan, selectCoverageSeeds } from '../../tools/printed-observed-seed-plan';

it('greedily selects deterministic seeds by new deck coverage, then pool coverage', () => {
  const selected = selectCoverageSeeds(
    [
      { seed: 4, deckPrintingIds: ['a', 'b'], poolPrintingIds: ['a', 'b', 'p'] },
      { seed: 2, deckPrintingIds: ['b', 'c'], poolPrintingIds: ['b', 'c', 'q', 'r'] },
      { seed: 9, deckPrintingIds: ['d'], poolPrintingIds: ['d', 's', 't', 'u'] },
      { seed: 1, deckPrintingIds: ['d'], poolPrintingIds: ['d', 's', 't', 'u'] },
    ],
    { deckPrintingIds: ['a'], poolPrintingIds: ['a', 'p'] },
    3,
  );

  expect(selected.map((candidate) => candidate.seed)).toEqual([2, 1, 4]);
  expect(selected[0]).toMatchObject({ newDeckPrintings: 2, newPoolPrintings: 4 });
  expect(selected[1]).toMatchObject({ newDeckPrintings: 1, newPoolPrintings: 4 });
  expect(selected[2]).toMatchObject({ newDeckPrintings: 0, newPoolPrintings: 0 });
});

it('does not mutate candidates or manufacture gains from duplicate printing ids', () => {
  const candidates = [
    { seed: 7, deckPrintingIds: ['a', 'a'], poolPrintingIds: ['a', 'a'] },
    { seed: 8, deckPrintingIds: ['a'], poolPrintingIds: ['a'] },
  ] as const;

  expect(selectCoverageSeeds(candidates, { deckPrintingIds: [], poolPrintingIds: [] }, 2)).toEqual([
    { ...candidates[0], newDeckPrintings: 1, newPoolPrintings: 1 },
    { ...candidates[1], newDeckPrintings: 0, newPoolPrintings: 0 },
  ]);
  expect(candidates[0].deckPrintingIds).toEqual(['a', 'a']);
});

it('loads only a bounded distinct seed list from a matching plan mode', () => {
  const artifact = {
    schemaVersion: 1,
    kind: 'printed-observed-seed-plan',
    mode: 'sealed',
    selected: [{ seed: 9 }, { seed: 4 }],
  };
  expect(observedSeedsFromPlan(artifact, 'sealed')).toEqual([9, 4]);
  expect(() => observedSeedsFromPlan(artifact, 'draft')).toThrow('mode mismatch');
  expect(() =>
    observedSeedsFromPlan({ ...artifact, selected: [{ seed: 9 }, { seed: 9 }] }, 'sealed'),
  ).toThrow('unique');
});
