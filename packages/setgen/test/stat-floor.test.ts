/**
 * The stat floor: a printed body judged against its printed cost.
 *
 * `rate.ts`'s ceiling reads `evaluateCard`, a pricing table with no useful floor
 * (its own docblock argues that at length). A creature's body needs no pricing
 * table at all: power plus toughness against twice the mana value is arithmetic
 * over two numbers the card states, the same shape `mtg-*` power audit named as
 * the gap `rate.ts` left open. This file argues the cutoff and the exemption on
 * cards built here, the way `rare-templates.test.ts` argues the ceiling.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CreatureCard, Keyword } from '@mtg/dsl';
import { isCreature, parseCard } from '@mtg/dsl';
import type { Entry, Slot } from '@mtg/setgen';
import { STAT_FLOOR, checkStatFloor, statFloor } from '@mtg/setgen';

/** A slot built here rather than filtered out of a set's allocation. */
function slot(id: string, role: string): Slot {
  return {
    id,
    index: 0,
    collectorNumber: 0,
    rarity: 'common',
    color: null,
    cardKind: 'creature',
    role,
    manaValueMin: 2,
    manaValueMax: 4,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
}

interface CreatureSpec {
  readonly name: string;
  readonly generic: number;
  readonly power: number;
  readonly toughness: number;
  readonly keywords?: readonly Keyword[];
  readonly abilities?: readonly unknown[];
}

function creature(spec: CreatureSpec): CreatureCard {
  const card = parseCard({
    id: `fix-${spec.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name: spec.name,
    rarity: 'common',
    set: { code: 'FIX', collectorNumber: 1 },
    // An all-generic cost is colorless; `checkColorIdentity` requires the
    // declared colors to equal the colors the mana cost implies, and this
    // fixture cares about the numbers, not the pie.
    colors: [],
    kind: 'creature',
    subtypes: ['Bear'],
    keywords: [...(spec.keywords ?? [])],
    manaCost: { generic: spec.generic },
    power: spec.power,
    toughness: spec.toughness,
    effects: [],
    abilities: spec.abilities ?? [],
  });
  if (!isCreature(card)) throw new Error('creature() built a non-creature card');
  return card;
}

function entry(card: Card, id = 'XC01'): Entry {
  return { slot: slot(id, 'creature'), card };
}

const grantsFlying = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  modification: { kind: 'grantKeyword' as const, keyword: 'trample' as const },
};

describe('the arithmetic', () => {
  it('scores a body exactly at the two-power-per-mana baseline as zero', () => {
    // A 2/2 for two mana is a bear: the baseline itself.
    const bear = creature({ name: 'Fixture Bear', generic: 2, power: 2, toughness: 2 });
    expect(statFloor(bear)).toBe(0);
  });

  it('is negative when the body is under the baseline and positive when over it', () => {
    const light = creature({ name: 'Fixture Sparrow', generic: 2, power: 1, toughness: 1 });
    const heavy = creature({ name: 'Fixture Ogre', generic: 2, power: 4, toughness: 4 });
    expect(statFloor(light)).toBe(-2);
    expect(statFloor(heavy)).toBe(4);
  });
});

describe('checkStatFloor, on a creature with no text to buy the body back', () => {
  it('says nothing about a body exactly on the cutoff', () => {
    // A 3/3 for four: floor = 6 - 8 = -2, exactly `STAT_FLOOR`.
    const card = creature({ name: 'Fixture Cutoff', generic: 4, power: 3, toughness: 3 });
    expect(statFloor(card)).toBe(STAT_FLOOR);
    expect(checkStatFloor([entry(card)])).toStrictEqual([]);
  });

  it('fails a body one point past the cutoff', () => {
    // A 2/3 for four: floor = 5 - 8 = -3, one past `STAT_FLOOR`.
    const card = creature({ name: 'Fixture Past Cutoff', generic: 4, power: 2, toughness: 3 });
    expect(statFloor(card)).toBe(STAT_FLOOR - 1);
    const findings = checkStatFloor([entry(card, 'XC02')]);
    expect(findings.map((item) => item.code)).toStrictEqual(['STAT_BELOW_FLOOR']);
    expect(findings[0]?.slotIds).toStrictEqual(['XC02']);
  });

  /** The set's own Class B shape: a six-mana 4/5 deathtouch with nothing else. */
  it('fails the shape the audit named: an undersized body with one keyword', () => {
    const card = creature({
      name: 'Fixture Gloom-Maw',
      generic: 6,
      power: 4,
      toughness: 5,
      keywords: ['deathtouch'],
    });
    // MV 6, floor = 9 - 12 = -3.
    expect(statFloor(card)).toBe(-3);
    expect(checkStatFloor([entry(card)]).map((item) => item.code)).toStrictEqual(['STAT_BELOW_FLOOR']);
  });
});

describe('the exemption: a card that buys the difference back is not this finding', () => {
  // MV 7, floor = 9 - 14 = -5: well past the cutoff on its own.
  const undersized = { name: 'Fixture Undersized', generic: 7, power: 4, toughness: 5 };

  it('is silent on the same body carrying two keywords', () => {
    const card = creature({ ...undersized, keywords: ['deathtouch', 'trample'] });
    expect(statFloor(card)).toBeLessThan(STAT_FLOOR);
    expect(checkStatFloor([entry(card)])).toStrictEqual([]);
  });

  it('is silent on the same body carrying one printed ability', () => {
    const card = creature({ ...undersized, keywords: ['deathtouch'], abilities: [grantsFlying] });
    expect(statFloor(card)).toBeLessThan(STAT_FLOOR);
    expect(checkStatFloor([entry(card)])).toStrictEqual([]);
  });

  it('still fires with zero keywords and no ability', () => {
    const card = creature({ ...undersized, keywords: [] });
    expect(checkStatFloor([entry(card)]).map((item) => item.code)).toStrictEqual(['STAT_BELOW_FLOOR']);
  });
});

describe('what it does not read', () => {
  it('says nothing about a noncreature', () => {
    const spell = parseCard({
      id: 'fix-bolt',
      name: 'Fixture Bolt',
      rarity: 'common',
      set: { code: 'FIX', collectorNumber: 2 },
      colors: ['R'],
      kind: 'instant',
      manaCost: { generic: 0, R: 1 },
      effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
      abilities: [],
    });
    expect(checkStatFloor([entry(spell)])).toStrictEqual([]);
  });

  it('says nothing about a creature over the baseline', () => {
    const card = creature({ name: 'Fixture Bruiser', generic: 3, power: 5, toughness: 5 });
    expect(checkStatFloor([entry(card)])).toStrictEqual([]);
  });
});
