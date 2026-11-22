/** Exact native shape for RTR #78, Stab Wound. */
import { describe, expect, it } from 'vitest';
import {
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  TRIGGER_CONDITIONS,
  validateCard,
} from '@mtg/dsl';

const STAB_WOUND_INPUT = {
  kind: 'enchantment',
  id: 'rtr-078-stab-wound',
  name: 'Stab Wound',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 78 },
  manaCost: { generic: 2, B: 1 },
  colors: ['B'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [{ kind: 'statBonus', power: -2, toughness: -2 }],
    printedModificationsBeforeAbilities: true,
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      effects: [{ kind: 'loseLife', amount: 2, target: { kind: 'triggeringPlayer' } }],
    },
  ],
} as const;

describe('Stab Wound in the DSL', () => {
  it('prints the current Oracle text in exact order', () => {
    const card = parseCard(STAB_WOUND_INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Enchant creature\nEnchanted creature gets -2/-2.\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 2 life.",
    );
  });

  it('keeps the attachment-relative trigger hand-authored', () => {
    const ability = STAB_WOUND_INPUT.abilities[0];
    expect(TRIGGER_CONDITIONS).toContain('beginningOfEachPlayersUpkeep');
    expect(MODEL_TRIGGER_CONDITIONS as readonly string[]).not.toContain('beginningOfEachPlayersUpkeep');
    expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
  });

  it('refuses the attachment-relative trigger on a source with no creature host', () => {
    const result = safeParseCard({
      kind: 'creature',
      id: 'tst-stab-wound-invalid-source',
      name: 'Invalid Wound Source',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 2, B: 1 },
      colors: ['B'],
      subtypes: ['Zombie'],
      keywords: [],
      power: 2,
      toughness: 2,
      abilities: STAB_WOUND_INPUT.abilities,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
            path: 'abilities[0].condition',
          }),
        ]),
      }),
    );
  });
});
