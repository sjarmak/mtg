/** Exact attachment-relative tap trigger for RTR #32, Chronic Flooding. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, validateCard } from '../src/index';

export const CHRONIC_FLOODING_INPUT = {
  kind: 'enchantment',
  id: 'rtr-32-chronic-flooding',
  name: 'Chronic Flooding',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 32 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Aura'],
  aura: { enchant: 'land', modifications: [] },
  abilities: [
    {
      kind: 'triggered',
      condition: 'enchantedLandBecomesTapped',
      effects: [{ kind: 'millCards', count: 3, target: { kind: 'triggeringPlayer' } }],
    },
  ],
} as const;

describe('Chronic Flooding in the DSL', () => {
  it('prints current Oracle text in exact order', () => {
    const card = parseCard(CHRONIC_FLOODING_INPUT);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Enchant land\nWhenever enchanted land becomes tapped, its controller mills three cards.',
    );
  });

  it('keeps the trigger outside model output', () => {
    const card = parseCard(CHRONIC_FLOODING_INPUT);
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it.each([
    ['a creature Aura', { ...CHRONIC_FLOODING_INPUT.aura, enchant: 'creature' }],
    ['an ordinary enchantment', undefined],
  ] as const)('refuses the trigger on %s', (_label, aura) => {
    expect(safeParseCard({ ...CHRONIC_FLOODING_INPUT, aura })).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({ code: 'ABILITY_ILLEGAL_ON_CARD_TYPE', path: 'abilities[0].condition' }),
        ]),
      }),
    );
  });

  it.each([
    ['the wrong count', { kind: 'millCards', count: 2, target: { kind: 'triggeringPlayer' } }],
    ['the wrong player', { kind: 'millCards', count: 3, target: { kind: 'targetPlayer' } }],
    ['a decomposed effect', { kind: 'drawCards', count: 3, target: { kind: 'triggeringPlayer' } }],
  ])('refuses %s', (_label, effect) => {
    expect(
      safeParseCard({
        ...CHRONIC_FLOODING_INPUT,
        abilities: [{ ...CHRONIC_FLOODING_INPUT.abilities[0], effects: [effect] }],
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        violations: expect.arrayContaining([
          expect.objectContaining({ code: 'ABILITY_ILLEGAL_ON_CARD_TYPE', path: 'abilities[0].condition' }),
        ]),
      }),
    );
  });
});
