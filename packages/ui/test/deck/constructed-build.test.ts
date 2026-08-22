/**
 * Constructed deckbuilding state: copies, the copy limit, and the mana base.
 *
 * The sealed builder's state is keyed by pool index because a pool holds
 * duplicates. This one is keyed by card id and holds a count, and every
 * assertion here is about that difference: a card goes in four times and no
 * more, cutting one copy leaves three, and the deck reads in pool order however
 * it was assembled.
 *
 * No card name is written down. The pool comes from the committed prototype set
 * and every subject is picked out of it by shape, so the file says nothing about
 * any particular card and stays a public document.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { isBasicLand, parseCard, setBasics } from '@mtg/dsl';
import { CONSTRUCTED_COPY_LIMIT, CONSTRUCTED_DECK_SIZE } from '@mtg/deckbuild';
import {
  addCopy,
  adjustBasics,
  basicsFor,
  buildFromCards,
  chosenCards,
  clearDeck,
  copiesOf,
  cutAll,
  cutCopy,
  deckFor,
  emptyBuild,
  resuggestBasics,
  selectable,
  spellCount,
} from '../../src/routes/deck/build';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

/** A card the pool pane would list, picked by position rather than by name. */
function subject(at = 0): Card {
  const card = selectable(SET)[at];
  if (card === undefined) throw new Error('the prototype set has no selectable card');
  return card;
}

/**
 * The pool with the set's five basics in it.
 *
 * The prototype set ships none, which is the ordinary case — `setBasics`
 * synthesizes them under the ids the art manifest uses. Listing them here makes
 * the pool the shape a staged pool document has, so the tests about hiding a
 * basic have a basic to hide.
 */
const POOL: readonly Card[] = [...SET, ...setBasics(SET)];

describe('counting copies', () => {
  it('starts empty over the whole pool', () => {
    const build = emptyBuild(SET);
    expect(build.counts).toEqual({});
    expect(build.basics).toBeNull();
    expect(spellCount(build)).toBe(0);
    expect(build.pool.length).toBe(SET.length);
  });

  it('adds a copy at a time and stops at the Constructed limit', () => {
    const card = subject();
    let build = emptyBuild(SET);
    for (let copy = 0; copy < CONSTRUCTED_COPY_LIMIT + 3; copy += 1) build = addCopy(build, card.id);
    expect(copiesOf(build, card.id)).toBe(CONSTRUCTED_COPY_LIMIT);
    expect(spellCount(build)).toBe(CONSTRUCTED_COPY_LIMIT);
  });

  it('cuts one copy at a time and forgets the card at zero rather than keeping a zero', () => {
    const card = subject();
    const three = [0, 1, 2].reduce((build) => addCopy(build, card.id), emptyBuild(SET));
    const two = cutCopy(three, card.id);
    expect(copiesOf(two, card.id)).toBe(2);
    const none = cutCopy(cutCopy(two, card.id), card.id);
    expect(none.counts).toEqual({});
    expect(cutCopy(none, card.id)).toBe(none);
  });

  it('cuts every copy in one gesture', () => {
    const card = subject();
    const four = [0, 1, 2, 3].reduce((build) => addCopy(build, card.id), emptyBuild(SET));
    expect(cutAll(four, card.id).counts).toEqual({});
    expect(cutAll(emptyBuild(SET), card.id).counts).toEqual({});
  });

  it('refuses a card the pool does not hold', () => {
    const build = emptyBuild(SET);
    expect(addCopy(build, 'no-such-card')).toBe(build);
  });

  it('refuses a Basic land, because the mana base panel counts those', () => {
    const basic = POOL.find(isBasicLand);
    if (basic === undefined) throw new Error('the pool has no basic land');
    const build = emptyBuild(POOL);
    expect(addCopy(build, basic.id)).toBe(build);
    expect(selectable(POOL).some((card) => card.id === basic.id)).toBe(false);
  });

  it('reads the deck in pool order however it was assembled', () => {
    const first = subject(0);
    const second = subject(1);
    const forward = addCopy(addCopy(emptyBuild(SET), first.id), second.id);
    const backward = addCopy(addCopy(emptyBuild(SET), second.id), first.id);
    expect(chosenCards(forward).map((card) => card.id)).toEqual([first.id, second.id]);
    expect(chosenCards(backward).map((card) => card.id)).toEqual([first.id, second.id]);
  });

  it('empties the deck without touching a counted mana base', () => {
    const built = addCopy(emptyBuild(POOL), subject().id);
    const counted = adjustBasics(built, 'U', 1);
    const cleared = clearDeck(counted);
    expect(cleared.counts).toEqual({});
    expect(cleared.basics).toEqual(counted.basics);
  });
});

describe('the deck the counts make', () => {
  it('is sixty cards short until it is sixty cards, and reports the target', () => {
    const build = [0, 1, 2, 3].reduce((current) => addCopy(current, subject().id), emptyBuild(POOL));
    const deck = deckFor(build);
    expect(deck.config.deckSize).toBe(CONSTRUCTED_DECK_SIZE);
    expect(deck.config.copyLimit).toBe(CONSTRUCTED_COPY_LIMIT);
    expect(deck.complete).toBe(false);
    expect(deck.spellCount).toBe(4);
    expect(deck.spellTarget).toBe(CONSTRUCTED_DECK_SIZE - deck.lands.length);
  });

  it('never reports an excess, because the state caps at four before the deck sees it', () => {
    let build = emptyBuild(POOL);
    for (let at = 0; at < 9; at += 1) {
      for (let copy = 0; copy < CONSTRUCTED_COPY_LIMIT; copy += 1) build = addCopy(build, subject(at).id);
    }
    expect(spellCount(build)).toBe(36);
    expect(deckFor(build).excesses).toEqual([]);
  });

  it('suggests a mana base and then prints the one that was counted out', () => {
    const build = [0, 1, 2, 3].reduce((current, at) => addCopy(current, subject(at).id), emptyBuild(POOL));
    const suggested = basicsFor(build);
    const counted = adjustBasics(build, 'U', 2);
    expect(basicsFor(counted).U).toBe(suggested.U + 2);
    expect(basicsFor(resuggestBasics(counted))).toEqual(suggested);
  });

  it('never counts a basic below zero', () => {
    const build = adjustBasics(emptyBuild(POOL), 'W', -99);
    expect(basicsFor(build).W).toBe(0);
  });
});

describe('starting from a list somebody already tuned', () => {
  it('takes the spells as copies and the basics as the counted base', () => {
    const card = subject();
    const basic = POOL.find(isBasicLand);
    if (basic === undefined) throw new Error('the pool has no basic land');
    const build = buildFromCards(POOL, [card, card, card, basic, basic, basic]);
    expect(copiesOf(build, card.id)).toBe(3);
    expect(build.basics).not.toBeNull();
    const color = basicsFor(build);
    expect(Object.values(color).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('leaves the base suggested when the list holds no land', () => {
    const card = subject();
    expect(buildFromCards(POOL, [card, card]).basics).toBeNull();
  });

  it('drops a card the pool does not hold rather than widening the pool', () => {
    const outsider = parseCard({
      kind: 'creature',
      id: 'zzz-outsider',
      name: 'Outsider',
      rarity: 'common',
      set: { code: 'ZZZ', collectorNumber: 1 },
      manaCost: { generic: 1 },
      colors: [],
      power: 1,
      toughness: 1,
    });
    const build = buildFromCards(SET, [outsider]);
    expect(build.counts).toEqual({});
    expect(build.pool.some((card) => card.id === outsider.id)).toBe(false);
  });
});
