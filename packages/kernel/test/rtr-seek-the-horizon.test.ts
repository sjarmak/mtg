/** RTR #134: three public basic-land choices committed through one search. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, seatEvent, validateAction } from '@mtg/kernel';
import { creature, FOREST, ISLAND, lands, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const CARD = sorcery(
  'Seek the Horizon',
  [
    {
      kind: 'searchLibrary',
      filter: { cardTypes: ['land'], supertypes: ['basic'] },
      count: 3,
      reveal: true,
      destination: 'hand',
    },
  ],
  { generic: 3, G: 1 },
);

const NONBASIC: Card = parseCard({
  kind: 'land',
  id: 'rtr-seek-nonbasic',
  name: 'Horizon Outpost',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 976 },
  subtypes: ['Gate'],
  producesMana: ['G'],
});

function board(): ReduceResult {
  return scenario({
    battlefield: lands(FOREST, 4).map((card) => ({ card, controller: 0 as const })),
    hands: [[CARD], []],
    libraries: [
      [creature('Horizon Beast', 2, 2), NONBASIC, ...lands(FOREST, 2), ...lands(ISLAND, 2)],
      [...lands(FOREST, 2)],
    ],
    seed: 'rtr/seek-the-horizon',
  });
}

function cast(start: ReduceResult): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, CARD.name),
    targets: [null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function offered(state: GameState): readonly ObjectId[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'searchLibrary') throw new Error('Seek the Horizon search is not pending');
  return decision.cards;
}

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

describe('RTR Seek the Horizon in the kernel', () => {
  it('offers only its controller basic lands, then reveals and moves three before one shuffle', () => {
    const asked = cast(board());
    const first = offered(asked.state);
    expect(first.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      'Forest',
      'Forest',
      'Island',
      'Island',
    ]);
    const nonbasic = Object.values(asked.state.objects).find(
      (object) => object.card.name === NONBASIC.name,
    )?.oid;
    if (nonbasic === undefined) throw new Error('the nonbasic control card is absent');
    expect(validateAction(asked.state, { type: 'searchLibrary', player: 0, found: nonbasic })).not.toBeNull();

    const one = first[0];
    const two = first[1];
    if (one === undefined || two === undefined) throw new Error('the search offered fewer than two basics');
    const midway = take(take(asked, one), two);
    const three = offered(midway.state)[0];
    if (three === undefined) throw new Error('the search offered no third basic');
    const done = take(midway, three);

    expect([one, two, three].map((oid) => done.state.objects[oid]?.zone)).toEqual(['hand', 'hand', 'hand']);
    expect(eventsOfType(done.events, 'librarySearched')).toEqual([
      { type: 'librarySearched', player: 0, found: true },
    ]);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
    const reveal = eventsOfType(done.events, 'librarySearchRevealed');
    expect(reveal).toEqual([{ type: 'librarySearchRevealed', player: 0, oids: [one, two, three] }]);
    expect(seatEvent(reveal[0]!, 1, 'rtr-seek', 0)).toEqual(reveal[0]);
  });

  it('may stop early and reveals exactly the basics already selected', () => {
    const asked = cast(board());
    const first = offered(asked.state)[0];
    if (first === undefined) throw new Error('the search offered no basic land');
    const done = take(take(asked, first), null);

    expect(done.state.objects[first]?.zone).toBe('hand');
    expect(pendingDecision(done.state)?.kind).not.toBe('searchLibrary');
    expect(eventsOfType(done.events, 'librarySearchRevealed')).toEqual([
      { type: 'librarySearchRevealed', player: 0, oids: [first] },
    ]);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });
});
