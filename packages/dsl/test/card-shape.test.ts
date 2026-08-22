/**
 * The card-shape vocabulary, over hand-authored cards.
 *
 * Hand-authored on purpose: this file is the definition of what each shape
 * means, and a definition read off a committed set would say whatever that set
 * happens to contain — which is the exact defect `card-shape.ts` exists to
 * answer. The pools are read by `packages/setgen/tools/shape-census.ts` and by
 * the coverage ledger, both of which trust these meanings.
 */
import { describe, expect, it } from 'vitest';
import { CARD_SHAPES, cardShapes, missingShapes, parseCard, shapeCounts, shapesIn } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';

const BEAR: Card = parseCard({
  kind: 'creature',
  id: 'shp-bear',
  name: 'Plain Bear',
  rarity: 'common',
  set: { code: 'SHP', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  power: 2,
  toughness: 2,
});

const WALKER: Card = parseCard({
  kind: 'planeswalker',
  id: 'shp-walker',
  name: 'Walker of Shapes',
  rarity: 'mythic',
  set: { code: 'SHP', collectorNumber: 2 },
  manaCost: { generic: 3, W: 1 },
  colors: ['W'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      loyaltyCost: 1,
      cost: { mana: {} },
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    },
  ],
});

const AURA: Card = parseCard({
  kind: 'enchantment',
  id: 'shp-aura',
  name: 'Shape of Strength',
  rarity: 'common',
  set: { code: 'SHP', collectorNumber: 3 },
  manaCost: { W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }] },
});

const EQUIPMENT: Card = parseCard({
  kind: 'artifact',
  id: 'shp-blade',
  name: 'Shaping Blade',
  rarity: 'uncommon',
  set: { code: 'SHP', collectorNumber: 4 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      effects: [],
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
    },
  ],
});

/** A modal spell: its own `effects` is empty and every effect sits under a mode. */
const MODAL: Card = parseCard({
  kind: 'instant',
  id: 'shp-modal',
  name: 'Two Shapes',
  rarity: 'uncommon',
  set: { code: 'SHP', collectorNumber: 5 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  modes: [
    { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
    {
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: { name: 'Shape', power: 1, toughness: 1, colors: ['U'], subtypes: ['Illusion'] },
        },
      ],
    },
  ],
});

describe('card shapes', () => {
  it('reads one card as the shapes it has and no others', () => {
    expect(cardShapes(BEAR)).toStrictEqual(['creature']);
    expect(cardShapes(WALKER)).toStrictEqual(['planeswalker', 'activatedAbility', 'loyaltyAbility']);
    expect(cardShapes(AURA)).toStrictEqual(['aura']);
    expect(cardShapes(EQUIPMENT)).toStrictEqual(['artifact', 'equipment', 'activatedAbility']);
  });

  /**
   * The walk that reads `card.effects` alone is the one that is wrong, and a
   * modal card is where it is wrong: `checkEffects` refuses a card carrying both
   * lists, so a modal card's own is always empty.
   */
  it('credits a modal card with what its modes print', () => {
    expect(MODAL.effects).toStrictEqual([]);
    expect(cardShapes(MODAL)).toStrictEqual(['instant', 'modal', 'tokenMaker']);
  });

  it('separates an Aura from a blanket enchantment', () => {
    const blanket = parseCard({
      kind: 'enchantment',
      id: 'shp-blanket',
      name: 'Shape Everywhere',
      rarity: 'rare',
      set: { code: 'SHP', collectorNumber: 6 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'grantKeyword', keyword: 'haste' },
        },
      ],
    });
    expect(cardShapes(blanket)).toStrictEqual(['enchantment', 'staticAbility']);
    expect(cardShapes(AURA)).not.toContain('enchantment');
  });

  it('counts every shape in the vocabulary, including the ones no card has', () => {
    const counts = shapeCounts([BEAR, WALKER, AURA]);
    expect([...counts.keys()]).toStrictEqual([...CARD_SHAPES]);
    expect(counts.get('creature')).toBe(1);
    expect(counts.get('planeswalker')).toBe(1);
    expect(counts.get('equipment')).toBe(0);
  });

  it('reports a pool as the shapes in it, in vocabulary order', () => {
    expect(shapesIn([AURA, BEAR, WALKER])).toStrictEqual([
      'creature',
      'aura',
      'planeswalker',
      'activatedAbility',
      'loyaltyAbility',
    ]);
    expect(shapesIn([])).toStrictEqual([]);
  });

  /**
   * The whole reason the vocabulary is named rather than sampled: a gate states
   * what it needs and is told, in words, what the pool it was handed cannot
   * supply. `[]` is the pass.
   */
  it('names the stated shapes a pool cannot supply', () => {
    expect(missingShapes([BEAR, AURA], ['creature', 'aura'])).toStrictEqual([]);
    expect(missingShapes([BEAR, AURA], ['planeswalker', 'modal', 'creature'])).toStrictEqual([
      'planeswalker',
      'modal',
    ]);
    expect(missingShapes([], ['creature'])).toStrictEqual(['creature']);
  });
});
