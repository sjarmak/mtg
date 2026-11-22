/** Rest in Peace's symmetric graveyard sweep and live replacement. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const REPLACE_GRAVEYARD_MOVES = {
  kind: 'staticPlayerRule' as const,
  players: 'eachPlayer' as const,
  rule: 'cardsOrTokensToGraveyardAreExiled' as const,
};

const REST_IN_PEACE = {
  kind: 'enchantment' as const,
  id: 'rtr-018-rest-in-peace',
  name: 'Rest in Peace',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 18 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'] as const,
  abilities: [
    {
      kind: 'triggered' as const,
      condition: 'selfEnters' as const,
      printedSourceReference: 'thisEnchantment' as const,
      effects: [{ kind: 'exileGraveyard' as const, whose: 'each' as const }],
    },
    REPLACE_GRAVEYARD_MOVES,
  ],
};

describe('Rest in Peace authoring', () => {
  it('parses and renders current Oracle ordering exactly', () => {
    expect(AbilitySchema.safeParse(REPLACE_GRAVEYARD_MOVES).success).toBe(true);
    expect(renderOracleText(parseCard(REST_IN_PEACE))).toBe(
      'When this enchantment enters, exile all graveyards.\n' +
        'If a card or token would be put into a graveyard from anywhere, exile it instead.',
    );
  });

  it('keeps both exact abilities outside generator output', () => {
    for (const ability of REST_IN_PEACE.abilities) {
      expect(ModelAbilitySchema.safeParse(ability).success).toBe(false);
    }
  });

  it('admits only the symmetric player scope for the token-inclusive rule', () => {
    expect(() =>
      parseCard({
        ...REST_IN_PEACE,
        abilities: [{ ...REPLACE_GRAVEYARD_MOVES, players: 'eachOpponent' as const }],
      }),
    ).toThrow(/cardsOrTokensToGraveyardAreExiled requires the eachPlayer player scope/);
  });
});
