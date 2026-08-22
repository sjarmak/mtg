/**
 * An Aura's clause is ruled on by the color pie and by the set's own signature.
 *
 * It was not. `cardSubjects` read a card's keywords, its effects and its
 * abilities, and an Aura carries its clause in none of the three: `card.aura`
 * is a fourth list, so a green Aura granting flying passed `checkCardPie`
 * while an identical static grant on a blanket enchantment failed it, and
 * `offSignatureSubjects` — which reads the same function — never saw a single
 * Aura in a set. The hole was open for as long as `aura` existed and is the
 * same shape as `mtg-bfj6`'s equip hole, so it is tested the same way: assert
 * the pie's own verdict first, so the test says what it means if a future
 * edition moves a row.
 */
import { describe, expect, it } from 'vitest';
import { classify } from '@mtg/design-data';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { ColorSignature, Slot } from '@mtg/setgen';
import { checkCardPie } from '../src/validate/pie';
import { offSignatureSubjects } from '../src/validate/signature';

function auraCard(overrides: Partial<CardInput> & { aura: unknown }): Card {
  return parseCard({
    kind: 'enchantment',
    id: 'tst-aura',
    name: 'Test Aura',
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: ['Aura'],
    ...overrides,
  } as CardInput);
}

/** `checkCardPie` blames a slot for the card it printed; only the id is read. */
const SLOT: Slot = {
  id: 'CG01',
  index: 0,
  collectorNumber: 1,
  rarity: 'common',
  color: 'G',
  cardKind: 'enchantment',
  role: 'aura',
  manaValueMin: 2,
  manaValueMax: 2,
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  auraModifications: [],
  triggerConditions: [],
  mechanics: [],
  archetypes: [],
  signpost: false,
};

describe('an Aura against the color pie', () => {
  it('fails a keyword its color may not print', () => {
    // Green flying is tertiary rather than off-pie, so the keyword that makes
    // the point here is one green never prints at all.
    expect(classify('firstStrike', 'G').verdict).toBe('fail');
    const card = auraCard({
      aura: { enchant: 'creature', modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
    });
    expect(checkCardPie(SLOT, card).map((item) => item.code)).toStrictEqual(['OFF_PIE']);
  });

  it('passes a keyword its color prints', () => {
    expect(classify('trample', 'G').verdict).not.toBe('fail');
    const card = auraCard({
      aura: { enchant: 'creature', modifications: [{ kind: 'grantKeyword', keyword: 'trample' }] },
    });
    expect(checkCardPie(SLOT, card)).toStrictEqual([]);
  });

  it('rules on the second modification, not only the first', () => {
    // The clause is a list of up to two and the reader flat-maps it. Reading
    // only `modifications[0]` would let a legal grant carry an illegal one.
    const card = auraCard({
      aura: {
        enchant: 'creature',
        modifications: [
          { kind: 'statBonus', power: 2, toughness: 0 },
          { kind: 'grantKeyword', keyword: 'firstStrike' },
        ],
      },
    });
    expect(checkCardPie(SLOT, card).map((item) => item.code)).toStrictEqual(['OFF_PIE']);
  });

  it('names no subject for a stat change or a landwalk grant', () => {
    // The pie's rows are `KEYWORDS` and `EFFECT_KINDS`. "+2/+0" is neither, and
    // neither is forestwalk, so both are silent rather than off-pie.
    const stats = auraCard({
      aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: -2, toughness: -2 }] },
    });
    const walk = auraCard({
      aura: { enchant: 'creature', modifications: [{ kind: 'grantLandwalk', landType: 'Island' }] },
    });
    expect(checkCardPie(SLOT, stats)).toStrictEqual([]);
    expect(checkCardPie(SLOT, walk)).toStrictEqual([]);
  });

  it('refuses a colorless Aura the keyword an equip clause would be allowed', () => {
    // The equip allowance is Equipment's colorless convention, not a general
    // rule about granting a keyword to another permanent. An Aura has no such
    // convention, so a colorless one granting menace is off-pie.
    const card = auraCard({
      manaCost: { generic: 2 },
      colors: [],
      aura: { enchant: 'creature', modifications: [{ kind: 'grantKeyword', keyword: 'menace' }] },
    });
    expect(checkCardPie(SLOT, card).map((item) => item.code)).toStrictEqual(['OFF_PIE']);
  });
});

describe('an Aura against the set’s color signature', () => {
  it('reports a keyword the set declares absent from the Aura’s color', () => {
    const signatures: readonly ColorSignature[] = [{ color: 'G', absent: ['flying'] }];
    const card = auraCard({
      aura: { enchant: 'creature', modifications: [{ kind: 'grantKeyword', keyword: 'flying' }] },
    });
    expect(offSignatureSubjects([card], signatures).map((item) => item.subject)).toStrictEqual(['flying']);
  });
});
