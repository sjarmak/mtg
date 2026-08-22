/**
 * A set's basic lands are a surface nobody printed.
 *
 * the flagship set's 75-card build contains no Plains, Island, Swamp,
 * Mountain or Forest. The deck builder mints them at build time instead, so a
 * game is played with five cards that exist in no card list — no art spec is
 * composed for them, no manifest key exists, and the governance check that is
 * supposed to make an unpainted surface impossible never sees them. A basic land
 * is on the battlefield for the whole game and is the most-looked-at card in any
 * deck, so this is the token blind spot one class over.
 *
 * The ids have to be the ids the deck builder mints, which is why this file
 * pins the derivation rather than a prefix: the set code is the pool's dominant
 * code, and `BAS` when there is no pool at all.
 */
import { describe, expect, it } from 'vitest';
import { BASIC_LAND_TYPES, FALLBACK_SET_CODE, dominantSetCode, parseCards, setBasics } from '../src/index';
import type { Card, CardInput } from '../src/index';

function spell(id: string, code: string): CardInput {
  return {
    kind: 'creature',
    id,
    name: 'Reefclan Harpooner',
    rarity: 'common',
    set: { code, collectorNumber: 4 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Merfolk'],
    power: 2,
    toughness: 2,
  };
}

function printedSwamp(code: string): CardInput {
  return {
    kind: 'land',
    id: `${code.toLowerCase()}-swamp`,
    name: 'Swamp',
    rarity: 'common',
    set: { code, collectorNumber: 60 },
    supertypes: ['basic'],
    basicLandType: 'Swamp',
    producesMana: ['B'],
  };
}

function cards(inputs: readonly CardInput[]): readonly Card[] {
  return parseCards([...inputs]);
}

describe('dominantSetCode', () => {
  it('takes the most common code in the list', () => {
    const list = cards([spell('xmp-one', 'XMP'), spell('xmp-two', 'XMP'), spell('tgr-one', 'TGR')]);
    expect(dominantSetCode(list)).toBe('XMP');
  });

  it('breaks a tie alphabetically, so the answer does not depend on order', () => {
    const list = cards([spell('xmp-one', 'XMP'), spell('tgr-one', 'TGR')]);
    expect(dominantSetCode(list)).toBe('TGR');
    expect(dominantSetCode([...list].reverse())).toBe('TGR');
  });

  it('falls back to BAS when there are no cards to read a code from', () => {
    expect(dominantSetCode([])).toBe(FALLBACK_SET_CODE);
    expect(FALLBACK_SET_CODE).toBe('BAS');
  });
});

describe('setBasics', () => {
  const list = cards([spell('xmp-one', 'XMP'), spell('xmp-two', 'XMP')]);

  it('yields all five, in BASIC_LAND_TYPES order', () => {
    expect(setBasics(list).map((card) => card.name)).toEqual([...BASIC_LAND_TYPES]);
  });

  it('mints the ids the deck builder mints, under the dominant set code', () => {
    expect(setBasics(list).map((card) => card.id)).toEqual([
      'xmp-plains',
      'xmp-island',
      'xmp-swamp',
      'xmp-mountain',
      'xmp-forest',
    ]);
  });

  it('uses the set code the cards carry rather than a hardcoded prefix', () => {
    const other = cards([spell('tgr-one', 'TGR')]);
    expect(setBasics(other).map((card) => card.id)).toContain('tgr-swamp');
  });

  it('returns the set’s own printing when it ships one, not a second Swamp', () => {
    const withSwamp = cards([spell('xmp-one', 'XMP'), printedSwamp('XMP')]);
    const swamp = setBasics(withSwamp).find((card) => card.name === 'Swamp');
    expect(swamp?.set.collectorNumber).toBe(60);
    expect(setBasics(withSwamp)).toHaveLength(5);
  });

  it('builds every basic through basicLand, so one place decides what the card is', () => {
    for (const card of setBasics(list)) {
      expect(card.kind).toBe('land');
      if (card.kind !== 'land') continue;
      expect(card.supertypes).toContain('basic');
      expect(card.producesMana).toHaveLength(1);
    }
  });
});
