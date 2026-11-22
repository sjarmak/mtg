/** Omniscience's exact hand-authored free-cast permission. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const FREE_CAST_FROM_HAND = {
  kind: 'staticPlayerRule' as const,
  players: 'controller' as const,
  rule: 'castSpellsFromHandWithoutPayingManaCost' as const,
};

const OMNISCIENCE = {
  kind: 'enchantment' as const,
  id: 'm13-63-omniscience',
  name: 'Omniscience',
  rarity: 'mythic' as const,
  set: { code: 'M13', collectorNumber: 63 },
  manaCost: { generic: 7, U: 3 },
  colors: ['U'] as const,
  abilities: [FREE_CAST_FROM_HAND],
};

describe('Omniscience authoring', () => {
  it('parses and prints current Oracle exactly', () => {
    expect(AbilitySchema.safeParse(FREE_CAST_FROM_HAND).success).toBe(true);
    expect(renderOracleText(parseCard(OMNISCIENCE))).toBe(
      'You may cast spells from your hand without paying their mana costs.',
    );
  });

  it('keeps the broad permission outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(FREE_CAST_FROM_HAND).success).toBe(false);
  });

  it('rejects invented filters and an opponent-scoped permission', () => {
    expect(AbilitySchema.safeParse({ ...FREE_CAST_FROM_HAND, spellFilter: {} }).success).toBe(false);
    expect(() =>
      parseCard({
        ...OMNISCIENCE,
        abilities: [{ ...FREE_CAST_FROM_HAND, players: 'eachOpponent' }],
      }),
    ).toThrow(
      /castSpellsFromHandWithoutPayingManaCost.*controller|controller.*castSpellsFromHandWithoutPayingManaCost/iu,
    );
  });
});
