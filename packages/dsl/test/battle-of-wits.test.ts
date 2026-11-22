/** Exact hand-authored Battle of Wits vocabulary and printed text. */
import {
  AbilitySchema,
  ALL_EFFECT_KINDS,
  CardSchema,
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'triggered' as const,
  condition: 'beginningOfYourUpkeep' as const,
  interveningIf: { kind: 'controllerLibraryAtLeast' as const, atLeast: 200 },
  effects: [{ kind: 'winGame' as const }],
};

const BATTLE_OF_WITS = parseCard({
  kind: 'enchantment',
  id: 'm13-44-battle-of-wits',
  name: 'Battle of Wits',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 44 },
  manaCost: { generic: 3, U: 2 },
  colors: ['U'],
  abilities: [ABILITY],
});

describe('Battle of Wits in the DSL', () => {
  it('parses and prints the exact intervening-if Oracle text', () => {
    expect(validateCard(BATTLE_OF_WITS)).toEqual([]);
    expect(renderOracleText(BATTLE_OF_WITS)).toBe(
      'At the beginning of your upkeep, if you have 200 or more cards in your library, you win the game.',
    );
  });

  it('keeps alternate wins and intervening-if conditions hand-authored', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
    expect(
      ModelAbilitySchema.safeParse({
        ...ABILITY,
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      }).success,
    ).toBe(false);
    expect(ModelEffectSchema.safeParse({ kind: 'winGame' }).success).toBe(false);
    expect(ALL_EFFECT_KINDS).toContain('winGame');
    expect(UNPRICED_EFFECT_KINDS).toContain('winGame');
  });

  it('requires a positive integral library threshold', () => {
    expect(
      AbilitySchema.safeParse({
        ...ABILITY,
        interveningIf: { kind: 'controllerLibraryAtLeast', atLeast: 0 },
      }).success,
    ).toBe(false);
    expect(
      AbilitySchema.safeParse({
        ...ABILITY,
        interveningIf: { kind: 'controllerLibraryAtLeast', atLeast: 199.5 },
      }).success,
    ).toBe(false);
  });

  it('validates every intervening-if condition with the shared condition rules', () => {
    const invalid = CardSchema.parse({
      ...BATTLE_OF_WITS,
      abilities: [
        {
          ...ABILITY,
          interveningIf: { kind: 'controlsSubtype', subtype: 'not-a-subtype', atLeast: 21 },
        },
      ],
    });

    expect(validateCard(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CONDITION_THRESHOLD_OUT_OF_RANGE',
          path: 'abilities[0].interveningIf.atLeast',
        }),
        expect.objectContaining({
          code: 'INVALID_SUBTYPE',
          path: 'abilities[0].interveningIf.subtype',
        }),
      ]),
    );
  });
});
