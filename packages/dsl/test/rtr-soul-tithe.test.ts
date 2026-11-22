/** Exact, Aura-bound upkeep toll for RTR #23, Soul Tithe. */
import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  ModelAuraSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '../src/index';

export const SOUL_TITHE_INPUT = {
  kind: 'enchantment',
  id: 'rtr-23-soul-tithe',
  name: 'Soul Tithe',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 23 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: { enchant: 'nonlandPermanent', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsEnchantedCreatureController: true,
      sacrificeEnchantedPermanentUnlessControllerPaysManaValue: true,
      effects: [],
    },
  ],
} as const;

describe('Soul Tithe in the DSL', () => {
  it('prints current Oracle text in exact order', () => {
    const card = parseCard(SOUL_TITHE_INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Enchant nonland permanent\nAt the beginning of the upkeep of enchanted permanent's controller, that player sacrifices it unless they pay {X}, where X is its mana value.",
    );
  });

  it('keeps the Aura restriction and dynamic toll outside model output', () => {
    const card = parseCard(SOUL_TITHE_INPUT);
    expect(ModelAuraSchema.safeParse(SOUL_TITHE_INPUT.aura).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it.each([
    ['a creature-only Aura', { ...SOUL_TITHE_INPUT.aura, enchant: 'creature' }],
    ['an ordinary enchantment', undefined],
  ] as const)('refuses the bundle on %s', (_label, aura) => {
    const result = safeParseCard({ ...SOUL_TITHE_INPUT, aura });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'TRIGGER_UNLESS_INVALID',
            path: 'abilities[0].sacrificeEnchantedPermanentUnlessControllerPaysManaValue',
          }),
        ]),
      }),
    );
  });

  it.each([
    ['ordinary effects', [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }]],
    ['an optional trigger', []],
  ] as const)('refuses decomposition through %s', (label, effects) => {
    const result = safeParseCard({
      ...SOUL_TITHE_INPUT,
      abilities: [
        {
          ...SOUL_TITHE_INPUT.abilities[0],
          effects,
          ...(label === 'an optional trigger' ? { optional: true } : {}),
        },
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([expect.objectContaining({ code: 'TRIGGER_UNLESS_INVALID' })]),
      }),
    );
  });
});
