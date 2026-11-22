/** A mandatory, non-targeted controlled-permanent choice made during resolution. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const RETURN_CREATURE = {
  kind: 'chooseFromBattlefield',
  filter: { cardTypes: ['creature'] },
  destination: 'hand',
} as const;

const PRIMADOX_INPUT = {
  kind: 'creature',
  id: 'm13-188-roaring-primadox',
  name: 'Roaring Primadox',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 188 },
  manaCost: { generic: 3, G: 1 },
  colors: ['G'],
  subtypes: ['Beast'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [RETURN_CREATURE],
    },
  ],
} as unknown as CardInput;

describe('chooseFromBattlefield schema', () => {
  it('accepts the source-attested controlled-permanent hand return', () => {
    expect(CardEffectSchema.parse(RETURN_CREATURE)).toEqual(RETURN_CREATURE);
  });

  it('requires a checked permanent filter and the one implemented destination', () => {
    expect(CardEffectSchema.safeParse({ ...RETURN_CREATURE, filter: {} }).success).toBe(true);
    expect(CardEffectSchema.safeParse({ ...RETURN_CREATURE, destination: 'graveyard' }).success).toBe(false);
    expect(CardEffectSchema.safeParse({ ...RETURN_CREATURE, filter: { cardTypes: ['spell'] } }).success).toBe(
      false,
    );
  });

  it('stays hand-authored and outside the generator output space', () => {
    expect(ModelEffectSchema.safeParse(RETURN_CREATURE).success).toBe(false);
  });
});

describe('chooseFromBattlefield Oracle text', () => {
  it('prints Roaring Primadox exactly without turning the choice into a target', () => {
    const card = parseCard(PRIMADOX_INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "At the beginning of your upkeep, return a creature you control to its owner's hand.",
    );
    expect(renderOracleText(card)).not.toContain('target');
  });
});
