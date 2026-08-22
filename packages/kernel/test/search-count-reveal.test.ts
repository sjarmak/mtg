/**
 * The three words a search learned after `library.test.ts` was written: how
 * many cards it takes, whether it shows them, and whether they arrive tapped.
 *
 * A file of its own rather than a fourth `describe` next door, because the
 * claims are about a *different shape of resolution*. `library.test.ts` proves
 * that one search is one pause: the menu, the move, the shuffle, the redaction
 * and the replay all read one answer. A search for more than one card is
 * several pauses and one record, and every assertion below is about the seam
 * between them — that the second question is asked at all, that it is asked
 * about the candidates *after* the card just taken (offering the whole list
 * again would let one answer take one card twice), that nothing moves until the
 * last answer, and that the log still reports one search and one shuffle no
 * matter how many questions it took.
 *
 * The count is an `Amount`, so a numeral and "X, where X is the number of lands
 * you control" are one field. M13's mass-ramp sorcery is why: its count is read
 * off the board as the effect applies, which is the timing `evaluateAmount` already
 * gives every other computed number in the DSL, and a second variable idiom
 * beside the one that exists would be a second thing to keep in agreement.
 */
import { describe, expect, it } from 'vitest';
import type { CardFilter } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import { eventsOfType, pendingDecision, scenario, seatEvent, validateAction } from '@mtg/kernel';
import { creature, FOREST, ISLAND, lands, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const BASIC_LAND: CardFilter = { cardTypes: ['land'], supertypes: ['basic'] };

/** "Search your library for up to two Forest cards, put them onto the battlefield tapped." */
const RANGERS_PATH = sorcery(
  'Errand of Two Paths',
  [{ kind: 'searchLibrary', filter: { subtypes: ['Forest'] }, count: 2, destination: 'battlefieldTapped' }],
  { generic: 3, G: 1 },
);

/** Sylvan Ranger's clause without its creature: one card, revealed, to hand. */
const REVEALING = sorcery(
  'Errand in the Open',
  [{ kind: 'searchLibrary', filter: BASIC_LAND, reveal: true, destination: 'hand' }],
  { G: 1 },
);

/** M13's mass-ramp clause: as many cards as the caster has lands. */
const MASS_RAMP = sorcery(
  'Errand Without End',
  [
    {
      kind: 'searchLibrary',
      filter: BASIC_LAND,
      count: { kind: 'countMatching', filter: { cardTypes: ['land'] } },
      destination: 'battlefieldTapped',
    },
  ],
  { generic: 1, G: 1 },
);

function bench(count: number) {
  return Array.from({ length: count }, (_, index) => creature(`Bench ${String(index + 1)}`, 1, 1));
}

function board(spell: ReturnType<typeof sorcery>, forests: number, libraryForests: number) {
  return scenario({
    battlefield: lands(FOREST, forests).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[spell], []],
    libraries: [[...bench(2), ...lands(FOREST, libraryForests), ...lands(ISLAND, 1)], bench(6)],
    seed: `search/${spell.name}`,
  });
}

function cast(start: ReduceResult, name: string, targets: readonly (Target | null)[] = [null]) {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: [...targets],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

/** The cards the pending search is offering, or a loud failure. */
function offered(state: GameState): readonly ObjectId[] {
  const decision = pendingDecision(state);
  if (decision?.kind !== 'searchLibrary') throw new Error('a search was not pending');
  return decision.cards;
}

function searching(state: GameState): boolean {
  return pendingDecision(state)?.kind === 'searchLibrary';
}

function take(current: ReduceResult, found: ObjectId | null): ReduceResult {
  return apply(current, { type: 'searchLibrary', player: 0, found });
}

function nameOf(state: GameState, oid: ObjectId): string {
  return state.objects[oid]?.card.name ?? 'gone';
}

describe('a search that takes more than one card', () => {
  it('asks again, about the candidates after the one just taken', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const first = offered(asked.state);
    expect(first.map((oid) => nameOf(asked.state, oid))).toEqual(['Forest', 'Forest', 'Forest']);

    const taken = first[1];
    if (taken === undefined) throw new Error('the rig was built wrong');
    const again = take(asked, taken);

    expect(offered(again.state)).toEqual([first[2]]);
    // The card already taken is not on the menu a second time, and neither is
    // the one before it: `selectionPool`'s rule, so that two answers naming the
    // same pair in the other order are one route rather than two.
    expect(offered(again.state)).not.toContain(taken);
    expect(offered(again.state)).not.toContain(first[0]);
  });

  it('moves nothing until the last answer, then moves everything at once', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const first = offered(asked.state);
    const one = first[0];
    const two = first[1];
    if (one === undefined || two === undefined) throw new Error('the rig was built wrong');
    const librarySize = asked.state.players[0].library.length;

    const midway = take(asked, one);
    expect(midway.state.objects[one]?.zone).toBe('library');
    expect(midway.state.players[0].library).toHaveLength(librarySize);
    expect(eventsOfType(midway.events, 'librarySearched')).toHaveLength(0);

    const done = take(midway, two);
    expect(done.state.objects[one]?.zone).toBe('battlefield');
    expect(done.state.objects[two]?.zone).toBe('battlefield');
    expect(done.state.players[0].library).toHaveLength(librarySize - 2);
    expect(searching(done.state)).toBe(false);
  });

  it('reports one search and one shuffle however many questions it took', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const first = offered(asked.state);
    const before = asked.events.length;
    const one = first[0];
    const two = first[1];
    if (one === undefined || two === undefined) throw new Error('the rig was built wrong');
    const done = take(take(asked, one), two);
    const since = done.events.slice(before);

    expect(eventsOfType(since, 'librarySearched')).toEqual([
      { type: 'librarySearched', player: 0, found: true },
    ]);
    expect(eventsOfType(since, 'libraryShuffled')).toHaveLength(1);
  });

  it('ends early when the searcher stops, and keeps what was already taken', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const one = offered(asked.state)[0];
    if (one === undefined) throw new Error('the rig was built wrong');
    const done = take(take(asked, one), null);

    expect(done.state.objects[one]?.zone).toBe('battlefield');
    expect(searching(done.state)).toBe(false);
    expect(eventsOfType(done.events, 'librarySearched').at(-1)).toEqual({
      type: 'librarySearched',
      player: 0,
      found: true,
    });
  });

  it('stops asking when the candidates run out before the count does', () => {
    const asked = cast(board(RANGERS_PATH, 4, 1), RANGERS_PATH.name);
    const only = offered(asked.state);
    expect(only).toHaveLength(1);
    const one = only[0];
    if (one === undefined) throw new Error('the rig was built wrong');

    const done = take(asked, one);
    expect(searching(done.state)).toBe(false);
    expect(done.state.objects[one]?.zone).toBe('battlefield');
  });

  it('finds nothing at the first question and takes the whole search with it', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const librarySize = asked.state.players[0].library.length;
    const done = take(asked, null);

    expect(searching(done.state)).toBe(false);
    expect(done.state.players[0].library).toHaveLength(librarySize);
    expect(eventsOfType(done.events, 'librarySearched').at(-1)).toEqual({
      type: 'librarySearched',
      player: 0,
      found: false,
    });
  });
});

describe('a search whose count is read off the board', () => {
  it('takes as many cards as the caster controls lands, counted as it resolves', () => {
    const asked = cast(board(MASS_RAMP, 2, 5), MASS_RAMP.name);
    const first = offered(asked.state);
    let current = asked;
    const taken: ObjectId[] = [];
    for (let step = 0; step < 4; step += 1) {
      if (!searching(current.state)) break;
      const next = offered(current.state)[0];
      if (next === undefined) break;
      current = take(current, next);
      taken.push(next);
    }

    // Two Forests paid for the spell and they are still lands, so the count is
    // two — not the five the library could have given.
    expect(taken).toHaveLength(2);
    expect(taken).toEqual([first[0], first[1]]);
    expect(taken.map((oid) => current.state.objects[oid]?.zone)).toEqual(['battlefield', 'battlefield']);
    expect(searching(current.state)).toBe(false);
  });
});

describe('a search that puts what it finds onto the battlefield tapped', () => {
  it('taps the arriving card, and the untapped destination leaves it untapped', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const first = offered(asked.state);
    const one = first[0];
    const two = first[1];
    if (one === undefined || two === undefined) throw new Error('the rig was built wrong');
    const done = take(take(asked, one), two);
    expect(done.state.objects[one]?.tapped).toBe(true);
    expect(done.state.objects[two]?.tapped).toBe(true);

    const untapped = sorcery(
      'Errand of One Path',
      [{ kind: 'searchLibrary', filter: { subtypes: ['Forest'] }, destination: 'battlefield' }],
      { G: 1 },
    );
    const other = cast(board(untapped, 2, 3), untapped.name);
    const found = offered(other.state)[0];
    if (found === undefined) throw new Error('the rig was built wrong');
    expect(take(other, found).state.objects[found]?.tapped).toBe(false);
  });

  it('leaves the card a permanent of its controller, tapped or not', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const one = offered(asked.state)[0];
    if (one === undefined) throw new Error('the rig was built wrong');
    const done = take(take(asked, one), null);
    expect(done.state.battlefield).toContain(one);
    expect(done.state.objects[one]?.controller).toBe(0);
    expect(done.state.players[1].hand).not.toContain(one);
  });
});

describe('a search that reveals what it found', () => {
  it('names the cards in an event both seats read', () => {
    const asked = cast(board(REVEALING, 2, 3), REVEALING.name);
    const found = offered(asked.state)[0];
    if (found === undefined) throw new Error('the rig was built wrong');
    const done = take(asked, found);

    const revealed = eventsOfType(done.events, 'librarySearchRevealed');
    expect(revealed).toEqual([{ type: 'librarySearchRevealed', player: 0, oids: [found] }]);
    // CR 701.16a: the reveal is the whole of the effect on hidden information,
    // so it passes to both seats unredacted where the search itself does not.
    for (const [index, event] of revealed.entries()) {
      expect(seatEvent(event, 0, 'search-view', index)).toEqual(event);
      expect(seatEvent(event, 1, 'search-view', index)).toEqual(event);
    }
    expect(done.state.objects[found]?.zone).toBe('hand');
  });

  it('reveals nothing when the search found nothing', () => {
    const asked = cast(board(REVEALING, 2, 3), REVEALING.name);
    const done = take(asked, null);
    expect(eventsOfType(done.events, 'librarySearchRevealed')).toHaveLength(0);
  });

  it('is silent on a search whose card does not print the word', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const one = offered(asked.state)[0];
    if (one === undefined) throw new Error('the rig was built wrong');
    const done = take(take(asked, one), null);
    expect(eventsOfType(done.events, 'librarySearchRevealed')).toHaveLength(0);
  });
});

describe('the answers a multi-card search refuses', () => {
  it('refuses a card the first answer already took', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const first = offered(asked.state);
    const one = first[0];
    if (one === undefined) throw new Error('the rig was built wrong');
    const again = take(asked, one);
    expect(validateAction(again.state, { type: 'searchLibrary', player: 0, found: one })).not.toBeNull();
  });

  it('refuses the seat that is not searching, at every question', () => {
    const asked = cast(board(RANGERS_PATH, 4, 3), RANGERS_PATH.name);
    const one = offered(asked.state)[0];
    if (one === undefined) throw new Error('the rig was built wrong');
    const again = take(asked, one);
    expect(validateAction(again.state, { type: 'searchLibrary', player: 1, found: null })).not.toBeNull();
  });
});
