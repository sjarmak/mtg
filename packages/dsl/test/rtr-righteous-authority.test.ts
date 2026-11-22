/** Exact native shape for RTR #189, Righteous Authority. */
import { describe, expect, it } from 'vitest';
import {
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  ModelAuraSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  TRIGGER_CONDITIONS,
  validateCard,
} from '@mtg/dsl';

export const RIGHTEOUS_AUTHORITY_INPUT = {
  kind: 'enchantment',
  id: 'rtr-189-righteous-authority',
  name: 'Righteous Authority',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 189 },
  manaCost: { generic: 3, W: 1, U: 1 },
  colors: ['W', 'U'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'creature',
    modifications: [],
    enchantedControllerHandSizeBonus: true,
    printedModificationsBeforeAbilities: true,
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      enchantedControllerDrawStepAdditionalDraw: true,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'triggeringPlayer' } }],
    },
  ],
} as const;

describe('Righteous Authority in the DSL', () => {
  it('prints current Oracle text in exact order', () => {
    const card = parseCard(RIGHTEOUS_AUTHORITY_INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Enchant creature\nEnchanted creature gets +1/+1 for each card in its controller's hand.\nAt the beginning of the draw step of enchanted creature's controller, that player draws an additional card.",
    );
  });

  it('keeps both live attachment-relative capabilities outside model output', () => {
    const card = parseCard(RIGHTEOUS_AUTHORITY_INPUT);
    expect(TRIGGER_CONDITIONS).toContain('beginningOfEachPlayersUpkeep');
    expect(MODEL_TRIGGER_CONDITIONS as readonly string[]).not.toContain('beginningOfEachPlayersUpkeep');
    expect(ModelAuraSchema.safeParse(RIGHTEOUS_AUTHORITY_INPUT.aura).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('refuses the attachment-relative draw trigger without a creature Aura host', () => {
    const result = safeParseCard({
      kind: 'creature',
      id: 'tst-righteous-authority-invalid-source',
      name: 'Invalid Authority Source',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 3, W: 1, U: 1 },
      colors: ['W', 'U'],
      subtypes: ['Wizard'],
      keywords: [],
      power: 1,
      toughness: 1,
      abilities: RIGHTEOUS_AUTHORITY_INPUT.abilities,
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({ code: 'ABILITY_ILLEGAL_ON_CARD_TYPE' }),
        ]),
      }),
    );
  });

  it('does not widen triggering-player draws outside the atomic bundle', () => {
    const result = safeParseCard({
      ...RIGHTEOUS_AUTHORITY_INPUT,
      abilities: [
        {
          ...RIGHTEOUS_AUTHORITY_INPUT.abilities[0],
          enchantedControllerDrawStepAdditionalDraw: undefined,
        },
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
            path: 'abilities[0].effects[0].target.kind',
          }),
        ]),
      }),
    );
  });

  it.each([
    ['two cards', { kind: 'drawCards', count: 2, target: { kind: 'triggeringPlayer' } }],
    ['a chosen player', { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } }],
  ] as const)('refuses a bundle that draws %s', (_label, effect) => {
    const result = safeParseCard({
      ...RIGHTEOUS_AUTHORITY_INPUT,
      abilities: [{ ...RIGHTEOUS_AUTHORITY_INPUT.abilities[0], effects: [effect] }],
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
            path: 'abilities[0].enchantedControllerDrawStepAdditionalDraw',
          }),
        ]),
      }),
    );
  });
});
