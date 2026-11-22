import { expect, it } from 'vitest';
import { runPhysicalCubeDraft } from '../src/physical-cube-draft';

const cards = Array.from({ length: 600 }, (_, i) => ({ physicalId: String(i), payload: i }));
const options = { seed: 'advisor/observable', humanSeatIds: ['seat-1'], score: () => 0 };

it('records only packs actually presented to human seats, including the current choice', () => {
  const first = runPhysicalCubeDraft(cards, options);
  expect(first.observations).toEqual(first.owed);
  let picks: string[] = [];
  let draft = first;
  for (let i = 0; i < 9; i += 1) {
    picks = [...picks, draft.owed[0]!.cards[0]!.physicalId];
    draft = runPhysicalCubeDraft(cards, { ...options, picks: { 'seat-1': picks } });
  }
  expect(draft.observations).toHaveLength(10);
  expect(draft.observations.map((o) => o.pickNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(draft.observations.every((o) => o.seatId === 'seat-1')).toBe(true);
  expect(draft.observations[0]).toEqual(first.owed[0]);
  const initial = new Set(first.owed[0]!.cards.map((c) => c.physicalId));
  expect(draft.observations[8]!.cards.every((c) => initial.has(c.physicalId))).toBe(true);
  expect(
    draft.observations
      .flatMap((o) => o.cards)
      .some((c) => draft.undealt.some((hidden) => hidden.physicalId === c.physicalId)),
  ).toBe(false);
});
