/** Maintained bot coverage for every bounded top-library decision. */
import { describe, expect, it } from 'vitest';
import { scenario, type AgentView, type Decision } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy, randomBot } from '@mtg/sim';

const STATE = scenario().state;

const DECISIONS: readonly Decision[] = [
  {
    kind: 'topLibraryOrder',
    player: 0,
    cards: ['o1'],
    options: [{ type: 'orderTopLibrary', player: 0, cards: ['o1'] }],
    complete: true,
  },
  {
    kind: 'topLibrarySelect',
    player: 0,
    cards: ['o1'],
    eligible: ['o1'],
    options: [{ type: 'selectFromTopLibrary', player: 0, chosen: 'o1', rest: [] }],
    complete: true,
  },
  {
    kind: 'topLibraryPartition',
    player: 0,
    cards: ['o1'],
    options: [{ type: 'separateTopLibraryPiles', player: 0, first: ['o1'], second: [] }],
    complete: true,
  },
  {
    kind: 'topLibraryPile',
    player: 0,
    piles: [['o1'], []],
    options: [{ type: 'chooseTopLibraryPile', player: 0, pile: 0 }],
    complete: true,
  },
];

describe('top-library bot parity', () => {
  it.each(DECISIONS)('answers $kind through both maintained policies', (decision) => {
    const view: AgentView = {
      state: observeState(STATE, 0, 'test/top-library.test.ts:42'),
      player: 0,
      decision,
    };
    expect(decideGreedy(view, DEFAULT_GREEDY_CONFIG)).toEqual(decision.options[0]);
    expect(randomBot(`top-library-${decision.kind}`, 'top-library-seed').decide(view)).toEqual(
      decision.options[0],
    );
  });
});
