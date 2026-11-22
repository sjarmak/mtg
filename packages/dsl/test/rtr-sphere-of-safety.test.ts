/** RTR #24 as one closed, live enchantment-counted attack-tax capability. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

export const SPHERE_ATTACK_TAX = {
  kind: 'staticPlayerRule' as const,
  players: 'eachOpponent' as const,
  rule: 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments' as const,
};

const INPUT = {
  kind: 'enchantment' as const,
  id: 'rtr-024-sphere-of-safety',
  name: 'Sphere of Safety',
  rarity: 'uncommon' as const,
  set: { code: 'RTR', collectorNumber: 24 },
  colors: ['W' as const],
  manaCost: { generic: 4, W: 1 },
  abilities: [SPHERE_ATTACK_TAX],
};

describe('RTR Sphere of Safety DSL', () => {
  it('renders current Oracle exactly and remains outside model output', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.",
    );
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('refuses independently widened attack-tax parameters', () => {
    expect(
      safeParseCard({
        ...INPUT,
        abilities: [{ ...SPHERE_ATTACK_TAX, players: 'controller' }],
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...INPUT,
        abilities: [{ ...SPHERE_ATTACK_TAX, rule: 'attackControllerTaxedByControlledArtifacts' }],
      }).ok,
    ).toBe(false);
  });
});
