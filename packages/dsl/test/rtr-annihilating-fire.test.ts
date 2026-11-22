import { describe, expect, it } from 'vitest';
import {
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

export const ANNIHILATING_FIRE_INPUT = {
  kind: 'instant',
  id: 'rtr-85-annihilating-fire',
  name: 'Annihilating Fire',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 85 },
  manaCost: { generic: 1, R: 2 },
  colors: ['R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: 3,
      target: { kind: 'anyTarget' },
      exileDamagedCreatureIfItWouldDieThisTurn: true,
    },
  ],
} as unknown as CardInput;

describe('RTR #85 Annihilating Fire', () => {
  it('renders both source-attested paragraphs in exact current Oracle order', () => {
    const card = parseCard(ANNIHILATING_FIRE_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Annihilating Fire deals 3 damage to any target. If a creature dealt damage this way would die this turn, exile it instead.',
    );
  });

  it('keeps the damage-linked death replacement outside the generator vocabulary', () => {
    const card = parseCard(ANNIHILATING_FIRE_INPUT);
    expect(ModelEffectSchema.safeParse(card.effects[0]).success).toBe(false);
  });

  it('refuses unattested sweep and unpreventable compositions', () => {
    for (const extra of [
      { scope: 'allPermanents', scopeFilter: { cardTypes: ['creature'] } },
      { preventable: false },
    ]) {
      const input = structuredClone(ANNIHILATING_FIRE_INPUT) as unknown as {
        effects: Record<string, unknown>[];
      };
      Object.assign(input.effects[0]!, extra);
      const parsed = safeParseCard(input);
      expect(parsed.ok).toBe(false);
      expect((parsed.ok ? [] : parsed.violations).map((violation) => violation.code)).toContain(
        'ILLEGAL_EFFECT_SCOPE',
      );
    }
  });
});
