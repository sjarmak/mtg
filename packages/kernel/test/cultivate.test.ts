/** Cultivate's completed search followed by its destination assignment. */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { FOREST, ISLAND, lands, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const CULTIVATE = sorcery(
  'Cultivate',
  [
    {
      kind: 'searchLibrary',
      filter: { cardTypes: ['land'], supertypes: ['basic'] },
      count: 2,
      reveal: true,
      destination: { kind: 'oneAndRest', one: 'battlefieldTapped', rest: 'hand' },
    },
  ],
  { generic: 2, G: 1 },
);

function board(libraryLands: number) {
  return scenario({
    battlefield: lands(FOREST, 3).map((card) => ({ card, controller: 0 as const })),
    hands: [[CULTIVATE], []],
    libraries: [[...lands(FOREST, libraryLands), ...lands(ISLAND, 1)], [...lands(ISLAND, 6)]],
    seed: `cultivate/${String(libraryLands)}`,
  });
}

function cast(start: ReduceResult, targets: readonly (Target | null)[] = [null]) {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, CULTIVATE.name),
    targets: [...targets],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function offered(state: GameState): readonly ObjectId[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'searchLibrary') throw new Error('Cultivate search is not pending');
  return decision.cards;
}

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

function assign(current: ReduceResult, one: ObjectId): ReduceResult {
  return apply(current, { type: 'chooseSearchDestination', player: 0, one });
}

describe('Cultivate', () => {
  it('searches and reveals together, then lets its controller assign one found card to the tapped destination', () => {
    const asked = cast(board(2));
    const first = offered(asked.state);
    const one = first[0];
    const other = first[1];
    if (one === undefined || other === undefined) throw new Error('Cultivate rig has fewer than two lands');
    const selected = take(take(asked, one), other);
    const destination = pendingDecision(selected.state) as unknown as {
      readonly kind: string;
      readonly cards: readonly ObjectId[];
    };

    expect(destination.kind).toBe('searchDestination');
    expect(destination.cards).toEqual([one, other]);
    expect(selected.state.objects[one]?.zone).toBe('library');
    expect(selected.state.objects[other]?.zone).toBe('library');
    expect(eventsOfType(selected.events, 'librarySearchRevealed').at(-1)?.oids).toEqual([one, other]);

    const done = assign(selected, other);
    expect(done.state.objects[other]?.zone).toBe('battlefield');
    expect(done.state.objects[other]?.tapped).toBe(true);
    expect(done.state.objects[one]?.zone).toBe('hand');
    expect(eventsOfType(done.events, 'librarySearched')).toHaveLength(1);
    expect(eventsOfType(done.events, 'libraryShuffled')).toHaveLength(1);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });

  it('refuses to assign a card the search did not find', () => {
    const asked = cast(board(2));
    const first = offered(asked.state);
    const one = first[0];
    const other = first[1];
    const outsider = first[2];
    if (one === undefined || other === undefined || outsider === undefined) {
      throw new Error('Cultivate rig has fewer than three lands');
    }
    const selected = take(take(asked, one), other);
    expect(
      validateAction(selected.state, {
        type: 'chooseSearchDestination',
        player: 0,
        one: outsider,
      }),
    ).not.toBeNull();
  });

  it('puts a lone found card into the one destination without an empty assignment question', () => {
    const asked = cast(board(0));
    const only = offered(asked.state)[0];
    if (only === undefined) throw new Error('Cultivate rig has no Island');
    const done = take(asked, only);
    expect(done.state.objects[only]?.zone).toBe('battlefield');
    expect(done.state.objects[only]?.tapped).toBe(true);
    expect(pendingDecision(done.state)?.kind).toBe('priority');
  });
});
