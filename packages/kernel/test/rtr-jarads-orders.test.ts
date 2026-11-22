/** Jarad's Orders' exact search, reveal, destination assignment, and shuffle. */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { creature, FOREST, ISLAND, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

const FIRST = creature('First Find', 2, 2);
const SECOND = creature('Second Find', 3, 3);
const THIRD = creature('Third Find', 4, 4);
const ORDERS = sorcery(
  "Jarad's Orders",
  [
    {
      kind: 'searchLibrary',
      filter: { cardTypes: ['creature'] },
      count: 2,
      reveal: true,
      destination: {
        kind: 'oneToHandRestToGraveyard',
        one: 'hand',
      },
    },
  ],
  { generic: 2, B: 1, G: 1 },
);

function board(cards: readonly (typeof FIRST)[]) {
  return scenario({
    battlefield: [...lands(FOREST, 3), SWAMP].map((card) => ({ card, controller: 0 as const })),
    hands: [[ORDERS], []],
    libraries: [[...cards, ISLAND], lands(ISLAND, 6)],
    seed: `jarads-orders/${cards.map((card) => card.name).join('-')}`,
  });
}

function cast(start: ReduceResult): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, ORDERS.name),
    targets: [null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function offered(state: GameState): readonly ObjectId[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'searchLibrary') throw new Error("Jarad's Orders search is not pending");
  return decision.cards;
}

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

function assign(current: ReduceResult, one: ObjectId): ReduceResult {
  return apply(current, { type: 'chooseSearchDestination', player: 0, one });
}

describe("Jarad's Orders", () => {
  it('offers only creatures, reveals both before moving either, assigns one to hand, and mills the other', () => {
    const asked = cast(board([FIRST, SECOND, THIRD]));
    const candidates = offered(asked.state);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((oid) => asked.state.objects[oid]?.card.name)).toEqual([
      FIRST.name,
      SECOND.name,
      THIRD.name,
    ]);
    const first = candidates[0];
    const second = candidates[1];
    if (first === undefined || second === undefined)
      throw new Error('search rig has fewer than two creatures');

    const selected = take(take(asked, first), second);
    expect(pendingDecision(selected.state)?.kind).toBe('searchDestination');
    expect(selected.state.objects[first]?.zone).toBe('library');
    expect(selected.state.objects[second]?.zone).toBe('library');
    expect(eventsOfType(selected.events, 'librarySearchRevealed').at(-1)?.oids).toEqual([first, second]);

    const done = assign(selected, second);
    expect(done.state.objects[second]?.zone).toBe('hand');
    expect(done.state.objects[first]?.zone).toBe('graveyard');
    expect(eventsOfType(done.events, 'librarySearched')).toHaveLength(1);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('rejects assigning an unselected creature', () => {
    const asked = cast(board([FIRST, SECOND, THIRD]));
    const [first, second, outsider] = offered(asked.state);
    if (first === undefined || second === undefined || outsider === undefined) {
      throw new Error('search rig has fewer than three creatures');
    }
    const selected = take(take(asked, first), second);
    expect(
      validateAction(selected.state, {
        type: 'chooseSearchDestination',
        player: 0,
        one: outsider,
      }),
    ).not.toBeNull();
  });

  it('puts a lone found creature into hand without asking how to split one card', () => {
    const asked = cast(board([FIRST]));
    const only = offered(asked.state)[0];
    if (only === undefined) throw new Error('search rig has no creature');
    const done = take(asked, only);
    expect(done.state.objects[only]?.zone).toBe('hand');
    expect(pendingDecision(done.state)?.kind).toBe('priority');
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
  });

  it('may find nothing, moves nothing, and still shuffles exactly once', () => {
    const done = take(cast(board([FIRST])), null);
    expect(eventsOfType(done.events, 'librarySearchRevealed')).toHaveLength(0);
    expect(eventsOfType(done.events, 'librarySearched').at(-1)?.found).toBe(false);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });
});
