/**
 * `buildPrecon`: a deck list that was written down, turned into a legal deck.
 *
 * `build-manual.test.ts` next door holds the contract this sits on — a builder
 * that trims or pads somebody's picks is a builder they cannot trust. This file
 * holds the layer between a *file* and those picks, which is where a written
 * list goes wrong in its own ways: an id that no longer resolves, a payoff the
 * list stopped playing, and a curve that has to be measured rather than stated
 * or `resolveConfig` refuses the whole deck.
 *
 * The cards are invented here rather than read out of a set. The mechanism is
 * about counts and ids and knows nothing about any particular set, and a test
 * that borrowed a real set's cards would be testing the set.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PreconDeck, PreconFile } from '@mtg/deckbuild';
import {
  buildPrecon,
  curveOf,
  parsePreconFile,
  preconDeck,
  PreconError,
  resolvePreconSpells,
} from '@mtg/deckbuild';

function creature(index: number, manaValue: number): Card {
  return parseCard({
    kind: 'creature',
    id: `pre-${String(index)}`,
    name: `Understudy ${String(index)}`,
    rarity: 'common',
    set: { code: 'PRE', collectorNumber: index + 1 },
    manaCost: { generic: manaValue - 1, G: 1 },
    colors: ['G'],
    power: manaValue,
    toughness: manaValue,
  } satisfies CardInput);
}

/** Six distinct cards at mana values 1 through 6, which is a whole curve. */
const SET: readonly Card[] = Array.from({ length: 6 }, (_unused, index) => creature(index, index + 1));

/** 36 spells: six copies of each of the six, so every bucket holds six. */
const DECK_INPUT = {
  formatVersion: 1,
  setCode: 'PRE',
  decks: [
    {
      id: 'understudies',
      name: 'The Understudies',
      plan: 'Cast the six-drop.',
      payoff: 'pre-5',
      deckSize: 60,
      basics: { G: 24 },
      spells: SET.map((card) => ({ id: card.id, count: 6 })),
    },
  ],
} as const;

const FILE: PreconFile = parsePreconFile(DECK_INPUT);
const DECK: PreconDeck = preconDeck(FILE, 'understudies');

describe('reading a precon file', () => {
  it('names the deck it does not hold rather than returning nothing', () => {
    expect(() => preconDeck(FILE, 'no-such-deck')).toThrow(PreconError);
    expect(() => preconDeck(FILE, 'no-such-deck')).toThrow(/it holds understudies/);
  });

  it('refuses a file that is not one, naming where', () => {
    expect(() => parsePreconFile({ formatVersion: 1, setCode: 'PRE', decks: [] })).toThrow(PreconError);
    expect(() => parsePreconFile({ formatVersion: 2, setCode: 'PRE', decks: [] })).toThrow(/formatVersion/);
  });

  it('refuses a count of zero, which is a card somebody meant to delete', () => {
    const spells = [{ id: 'pre-0', count: 0 }];
    expect(() => parsePreconFile({ ...DECK_INPUT, decks: [{ ...DECK, spells }] })).toThrow(PreconError);
  });
});

describe('resolving a list against a set', () => {
  it('expands each entry into its own copies, in list order', () => {
    const spells = resolvePreconSpells(DECK, SET);
    expect(spells).toHaveLength(36);
    expect(spells.slice(0, 6).map((card) => card.id)).toEqual(Array.from({ length: 6 }, () => 'pre-0'));
  });

  it('names every id the set does not print rather than building a short deck', () => {
    const spells = [...DECK.spells, { id: 'pre-absent', count: 2 }, { id: 'pre-also-absent', count: 1 }];
    const broken = { ...DECK, spells };
    expect(() => resolvePreconSpells(broken, SET)).toThrow(/2 card\(s\)/);
    expect(() => resolvePreconSpells(broken, SET)).toThrow(/pre-absent, pre-also-absent/);
  });

  it('refuses a list that names a payoff it does not play', () => {
    expect(() => resolvePreconSpells({ ...DECK, payoff: 'pre-0-but-cut' }, SET)).toThrow(/does not play it/);
  });
});

describe('the curve of a fixed list', () => {
  it('is measured off the cards rather than asked for', () => {
    expect(curveOf(resolvePreconSpells(DECK, SET))).toEqual({
      0: 0,
      1: 6,
      2: 6,
      3: 6,
      4: 6,
      5: 6,
      6: 6,
    });
  });

  it('collapses everything above the top bucket into it', () => {
    const huge = parseCard({
      kind: 'creature',
      id: 'pre-huge',
      name: 'Understudy Nine',
      rarity: 'rare',
      set: { code: 'PRE', collectorNumber: 99 },
      manaCost: { generic: 8, G: 1 },
      colors: ['G'],
      power: 9,
      toughness: 9,
    } satisfies CardInput);
    expect(curveOf([huge])[6]).toBe(1);
  });
});

describe('building it', () => {
  const built = buildPrecon(DECK, SET);

  it('is a legal 60 with the mana base the list counted out', () => {
    expect(built.deck).toHaveLength(60);
    expect(built.spells).toHaveLength(36);
    expect(built.lands).toHaveLength(24);
    expect(built.complete).toBe(true);
  });

  it('leaves the spell target equal to what the list plays, so nothing is short', () => {
    expect(built.spellTarget).toBe(36);
    expect(built.spellCount).toBe(36);
    expect(built.shortfalls.filter((shortfall) => shortfall.kind === 'spellSlots')).toEqual([]);
  });

  it('adds nothing to the picks: every spell in the deck is one the list named', () => {
    const named = new Set(DECK.spells.map((entry) => entry.id));
    for (const card of built.spells) expect(named.has(card.id)).toBe(true);
  });

  it('would refuse a 60-card list under the default curve, which is why one is measured', () => {
    // `resolveConfig` throws when a stated `targetCurve` does not sum to
    // `deckSize - landCount`, and its default histogram describes a 40-card
    // Limited deck. That is the trap `buildPrecon` exists to step over, and it
    // is checked rather than described.
    expect(() => buildPrecon({ ...DECK, deckSize: 40 }, SET)).toThrow(/targetCurve/);
  });
});
