/** Platinum Angel's paired, live game-result rule. */
import { describe, expect, it } from 'vitest';
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const GAME_RULE = {
  kind: 'staticGameRule' as const,
  rule: 'controllerCantLoseAndOpponentsCantWin' as const,
};

const PLATINUM_ANGEL = {
  kind: 'creature' as const,
  id: 'm11-212-platinum-angel',
  name: 'Platinum Angel',
  rarity: 'mythic' as const,
  set: { code: 'M11', collectorNumber: 212 },
  colors: [],
  manaCost: { generic: 7 },
  artifact: true,
  power: 4,
  toughness: 4,
  subtypes: ['Angel'],
  keywords: ['flying'] as const,
  abilities: [GAME_RULE],
};

describe('Platinum Angel authoring', () => {
  it('parses and prints the exact current Oracle text', () => {
    expect(AbilitySchema.safeParse(GAME_RULE).success).toBe(true);
    expect(renderOracleText(parseCard(PLATINUM_ANGEL))).toBe(
      "Flying\nYou can't lose the game and your opponents can't win the game.",
    );
  });

  it('keeps the hand-authored game rule outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(GAME_RULE).success).toBe(false);
  });

  it('rejects invented game rules and extra keys', () => {
    expect(AbilitySchema.safeParse({ ...GAME_RULE, rule: 'controllerCantLose' }).success).toBe(false);
    expect(AbilitySchema.safeParse({ ...GAME_RULE, players: 'eachOpponent' }).success).toBe(false);
  });
});
