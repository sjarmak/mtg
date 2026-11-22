/** Leyline of the Void's opening action and opponent graveyard replacement. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const EXILE_OPPONENT_GRAVEYARD_CARDS = {
  kind: 'staticPlayerRule' as const,
  players: 'eachOpponent' as const,
  rule: 'cardsToGraveyardAreExiled' as const,
};

const LEYLINE_OF_THE_VOID = {
  kind: 'enchantment' as const,
  id: 'm11-101-leyline-of-the-void',
  name: 'Leyline of the Void',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 101 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'] as const,
  openingHandAction: { kind: 'beginOnBattlefield' as const },
  abilities: [EXILE_OPPONENT_GRAVEYARD_CARDS],
};

describe('Leyline of the Void authoring', () => {
  it('parses and prints both current Oracle clauses exactly', () => {
    expect(AbilitySchema.safeParse(EXILE_OPPONENT_GRAVEYARD_CARDS).success).toBe(true);
    expect(renderOracleText(parseCard(LEYLINE_OF_THE_VOID))).toBe(
      'If Leyline of the Void is in your opening hand, you may begin the game with it on the battlefield.\n' +
        "If a card would be put into an opponent's graveyard from anywhere, exile it instead.",
    );
  });

  it('keeps the replacement outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(EXILE_OPPONENT_GRAVEYARD_CARDS).success).toBe(false);
  });

  it('rejects scopes that would change which graveyards are affected', () => {
    expect(
      AbilitySchema.safeParse({ ...EXILE_OPPONENT_GRAVEYARD_CARDS, players: 'controller' }).success,
    ).toBe(true);
    expect(() =>
      parseCard({
        ...LEYLINE_OF_THE_VOID,
        abilities: [{ ...EXILE_OPPONENT_GRAVEYARD_CARDS, players: 'controller' }],
      }),
    ).toThrow(/cardsToGraveyardAreExiled requires the eachOpponent player scope/);
  });
});
