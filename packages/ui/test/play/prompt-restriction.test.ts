/**
 * What the three card-choosing prompts say the chooser may take.
 *
 * `mtg-7mrf`, then `mtg-la2p`. The sentence for a chooser's discard was
 * "revealed their hand, and You chooses 1 card for them to discard", which is
 * true and incomplete: a player resolving Duress reads it, looks at four
 * revealed cards, and finds two of them grayed out with nothing on screen saying
 * why. The picker is right -- it enumerates the kernel's `choosable` list, which
 * is the filtered subset -- so what was missing was prose rather than options.
 *
 * The search and the graveyard choice had the same gap said a different way.
 * Neither grays anything out; both count the cards that *match* and never say
 * what they match. "2 cards match" out of a forty-card library is a sentence
 * with a dangling predicate, and the player is left to remember the card's own
 * text to finish it.
 *
 * The phrase is `@mtg/dsl`'s `cardFilterPhrase`, the one the card face already
 * prints from the same filter. Threading it is the point: a second assembly of
 * "a noncreature, nonland card" in the UI would be a second chance for the
 * prompt and the card to disagree about one clause, which is the failure the
 * art-manifest keying had.
 *
 * The two later prompts read the filter off the *pending record* rather than
 * walking back to the source card the way the discard does. A search is usually
 * a permanent's triggered ability, so its `sourceOid` names a creature whose
 * effects a card-level walk does not reach; carrying the filter is one field and
 * one line at the pause, and it cannot disagree with the search the kernel
 * actually ran.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard, renderOracleText } from '@mtg/dsl';
import type { GameState } from '@mtg/kernel';
import { legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';

const NAMES: SeatNames = ['You', 'Bot'];

function spell(name: string, collectorNumber: number, filter: unknown): Card {
  return parseCard({
    kind: 'sorcery',
    id: `discard-restriction-${String(collectorNumber)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { B: 1 },
    colors: ['B'],
    effects: [
      {
        kind: 'chooseDiscard',
        count: 1,
        target: { kind: 'targetOpponent' },
        ...(filter === null ? {} : { filter }),
      },
    ],
  });
}

/** Duress: the reveal is whole and the choice is not. */
const DURESS = spell('Press the Point', 1, { excludeCardTypes: ['creature', 'land'] });
const UNFILTERED = spell('Take Something', 2, null);

const SWAMP = basicLand('Swamp', 'TST', 90);

const BEAR = parseCard({
  kind: 'creature',
  id: 'discard-restriction-bear',
  name: 'Thicket Bear',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 91 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Bear'],
  power: 2,
  toughness: 2,
});

/** The state paused on the discard question, with the spell already resolved. */
function asking(card: Card): GameState {
  let state = scenario({
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
    // Two cards the filter allows, so the kernel actually pauses to ask: with
    // one legal card and a count of one there is no choice to make and it takes
    // it (CR 701.8a, `awaitHandDiscard`'s third case).
    hands: [[card], [BEAR, DURESS, UNFILTERED, SWAMP]],
    seed: 'ui/discard-restriction',
  }).state;
  for (let step = 0; step < 12; step += 1) {
    const decision = pendingDecision(state);
    if (decision?.kind === 'handDiscard') return state;
    const cast = legalActions(state).find((action) => action.type === 'castSpell');
    const pass = legalActions(state).find((action) => action.type === 'passPriority');
    const next = cast ?? pass;
    if (next === undefined) throw new Error('the fixture ran out of legal actions');
    state = reduce(state, next).state;
  }
  throw new Error('the discard question never came up');
}

function explain(card: Card): string {
  const state = asking(card);
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('nothing is pending');
  return buildPrompt(state, decision, NAMES).explain;
}

describe('the discard prompt names the restriction', () => {
  it('says the filter in the card own printed words', () => {
    const said = explain(DURESS);
    expect(said).toContain('a noncreature, nonland card');
    // The same clause the face prints, rather than a second assembly of it.
    expect(renderOracleText(DURESS)).toContain('a noncreature, nonland card');
    // And the bare count is gone, which is the sentence the bead is about.
    expect(said).not.toContain('1 card');
  });

  it('keeps the count sentence when the card prints no filter', () => {
    // Nothing is grayed out in that picker, so there is no restriction to
    // name and inventing one would be worse than the count.
    expect(explain(UNFILTERED)).toContain('1 card');
  });
});

/** A sorcery whose whole text is one library search, so the pause is the first decision. */
function search(collectorNumber: number, filter: unknown): Card {
  return parseCard({
    kind: 'sorcery',
    id: `prompt-restriction-search-${String(collectorNumber)}`,
    name: `Search ${String(collectorNumber)}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { B: 1 },
    colors: ['B'],
    effects: [{ kind: 'searchLibrary', filter, count: 1, destination: 'hand' }],
  });
}

/** And one whose whole text is one graveyard choice. */
function fromGraveyard(collectorNumber: number, filter: unknown): Card {
  return parseCard({
    kind: 'sorcery',
    id: `prompt-restriction-graveyard-${String(collectorNumber)}`,
    name: `Raise ${String(collectorNumber)}`,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: { B: 1 },
    colors: ['B'],
    effects: [{ kind: 'chooseFromGraveyard', whose: 'you', filter, destination: 'hand' }],
  });
}

const SEARCH_CREATURES = search(3, { cardTypes: ['creature'] });
const SEARCH_ANYTHING = search(4, {});
const RAISE_CREATURES = fromGraveyard(5, { cardTypes: ['creature'] });

/**
 * The state paused on `kind`, with `card` cast out of a hand that holds it alone.
 *
 * The library and the graveyard are stocked with two matching cards each, for
 * the reason the discard fixture stocks two: one legal card and a count of one
 * is not a choice, and the kernel takes it without pausing.
 */
function pausedOn(card: Card, kind: 'searchLibrary' | 'graveyardChoice'): GameState {
  let state = scenario({
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
    ],
    hands: [[card], []],
    libraries: [[BEAR, BEAR, SWAMP, SWAMP], [SWAMP]],
    graveyards: [[BEAR, BEAR, SWAMP], []],
    seed: 'ui/prompt-restriction',
  }).state;
  for (let step = 0; step < 12; step += 1) {
    const decision = pendingDecision(state);
    if (decision?.kind === kind) return state;
    const cast = legalActions(state).find((action) => action.type === 'castSpell');
    const pass = legalActions(state).find((action) => action.type === 'passPriority');
    const next = cast ?? pass;
    if (next === undefined) throw new Error('the fixture ran out of legal actions');
    state = reduce(state, next).state;
  }
  throw new Error(`the ${kind} question never came up`);
}

function saidOn(card: Card, kind: 'searchLibrary' | 'graveyardChoice'): string {
  const state = pausedOn(card, kind);
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('nothing is pending');
  return buildPrompt(state, decision, NAMES).explain;
}

// `NAMES[0]` is the viewer, so every sentence below is in the second person
// (`verb`'s second arm). `seat-voice.test.ts` is where that choice is held.
describe('the search prompt names what the search is for', () => {
  it('finishes the sentence the count starts', () => {
    const said = saidOn(SEARCH_CREATURES, 'searchLibrary');
    expect(said).toContain('search the library for a creature card');
    // The count survives: it says how many the library actually holds, which
    // the restriction does not.
    expect(said).toMatch(/\d+ cards? match/);
    // The same clause the face prints, rather than a second assembly of it.
    expect(renderOracleText(SEARCH_CREATURES)).toContain('a creature card');
  });

  it('says nothing extra when the search restricts nothing', () => {
    // "searches the library for a card. 4 cards match" states a rule that
    // refuses nothing and makes the count read as a restriction it is not.
    const said = saidOn(SEARCH_ANYTHING, 'searchLibrary');
    expect(said).toContain('search the library.');
    expect(said).not.toContain('for a card');
  });
});

describe('the graveyard prompt names what may be taken', () => {
  it('puts the restriction where the bare noun was', () => {
    const said = saidOn(RAISE_CREATURES, 'graveyardChoice');
    expect(said).toContain('take a creature card out of a graveyard');
    expect(said).not.toContain('take a card out of a graveyard');
    expect(said).toMatch(/\d+ cards? match/);
  });
});
