/** Exact source-attested same-name nonland-pair activation cost for RTR #52. */
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const SPHINX = {
  kind: 'creature' as const,
  id: 'rtr-052-sphinx-of-the-chimes',
  name: 'Sphinx of the Chimes',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 52 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  subtypes: ['Sphinx'],
  power: 5,
  toughness: 6,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'activated' as const,
      cost: {
        mana: {},
        discardMatching: {
          count: 2 as const,
          filter: 'nonland' as const,
          relation: 'sameName' as const,
        },
      },
      effects: [{ kind: 'drawCards' as const, count: 4, target: { kind: 'noTarget' as const } }],
    },
  ],
};

describe('RTR #52 Sphinx of the Chimes', () => {
  it('renders current Oracle exactly and in source order', () => {
    expect(renderOracleText(parseCard(SPHINX as unknown as CardInput))).toBe(
      'Flying\nDiscard two nonland cards with the same name: Draw four cards.',
    );
  });

  it('keeps the typed cost bundle hand-authored and source-narrow', () => {
    const card = parseCard(SPHINX as unknown as CardInput);
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
    expect(safeParseCard(SPHINX as unknown as CardInput).ok).toBe(true);

    const wrongCount = structuredClone(SPHINX) as unknown as Record<string, unknown>;
    const abilities = wrongCount.abilities as Array<{ cost: { discardMatching: { count: number } } }>;
    abilities[0]!.cost.discardMatching.count = 3;
    expect(safeParseCard(wrongCount as unknown as CardInput).ok).toBe(false);

    const widenedFilter = structuredClone(SPHINX) as unknown as Record<string, unknown>;
    const widenedAbilities = widenedFilter.abilities as Array<{
      cost: { discardMatching: { filter: string } };
    }>;
    widenedAbilities[0]!.cost.discardMatching.filter = 'creature';
    expect(safeParseCard(widenedFilter as unknown as CardInput).ok).toBe(false);
  });
});
