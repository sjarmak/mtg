/** Phantom General's token-only anthem stays hand-authored and exact. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'static' as const,
  scope: 'creaturesYouControl' as const,
  filter: { token: true as const },
  modification: { kind: 'statBonus' as const, power: 1, toughness: 1 },
};

describe("Phantom General's token-only static scope", () => {
  it('parses and renders the source Oracle exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-16-phantom-general',
      name: 'Phantom General',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 16 },
      manaCost: { generic: 3, W: 1 },
      colors: ['W'],
      subtypes: ['Spirit', 'Soldier'],
      power: 2,
      toughness: 3,
      abilities: [ABILITY],
    });

    expect(renderOracleText(card)).toBe('Creature tokens you control get +1/+1.');
  });

  it('keeps the token predicate outside model output', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });
});
