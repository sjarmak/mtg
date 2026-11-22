/** Ground Seal's hand-authored live targeting prohibition. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const CANT_TARGET_GRAVEYARD_CARDS = {
  kind: 'staticGameRule' as const,
  rule: 'cardsInGraveyardsCantBeTargets' as const,
};

const GROUND_SEAL = {
  kind: 'enchantment' as const,
  id: 'm13-176-ground-seal',
  name: 'Ground Seal',
  rarity: 'rare' as const,
  set: { code: 'M13', collectorNumber: 176 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'] as const,
  abilities: [
    {
      kind: 'triggered' as const,
      condition: 'selfEnters' as const,
      effects: [{ kind: 'drawCards' as const, count: 1, target: { kind: 'noTarget' as const } }],
    },
    CANT_TARGET_GRAVEYARD_CARDS,
  ],
};

describe('Ground Seal authoring', () => {
  it('parses and prints both current Oracle clauses exactly', () => {
    expect(AbilitySchema.safeParse(CANT_TARGET_GRAVEYARD_CARDS).success).toBe(true);
    expect(renderOracleText(parseCard(GROUND_SEAL))).toBe(
      "When Ground Seal enters the battlefield, draw a card.\nCards in graveyards can't be the targets of spells or abilities.",
    );
  });

  it('keeps the global prohibition outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(CANT_TARGET_GRAVEYARD_CARDS).success).toBe(false);
  });

  it('rejects invented zone and controller fields', () => {
    expect(AbilitySchema.safeParse({ ...CANT_TARGET_GRAVEYARD_CARDS, zone: 'graveyard' }).success).toBe(
      false,
    );
    expect(AbilitySchema.safeParse({ ...CANT_TARGET_GRAVEYARD_CARDS, players: 'eachPlayer' }).success).toBe(
      false,
    );
  });
});
