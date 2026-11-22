/** Leyline of Sanctity's opening action and controller-scoped player hexproof. */
import { describe, expect, it } from 'vitest';
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const PLAYER_HEXPROOF = {
  kind: 'staticPlayerRule' as const,
  players: 'controller' as const,
  rule: 'hasHexproof' as const,
};

const LEYLINE_OF_SANCTITY = {
  kind: 'enchantment' as const,
  id: 'm11-21-leyline-of-sanctity',
  name: 'Leyline of Sanctity',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 21 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'] as const,
  openingHandAction: { kind: 'beginOnBattlefield' as const },
  abilities: [PLAYER_HEXPROOF],
};

describe('Leyline of Sanctity authoring', () => {
  it('parses and prints both current Oracle clauses exactly', () => {
    expect(AbilitySchema.safeParse(PLAYER_HEXPROOF).success).toBe(true);
    expect(renderOracleText(parseCard(LEYLINE_OF_SANCTITY))).toBe(
      'If Leyline of Sanctity is in your opening hand, you may begin the game with it on the battlefield.\n' +
        "You have hexproof. (You can't be the target of spells or abilities your opponents control.)",
    );
  });

  it('keeps player hexproof outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(PLAYER_HEXPROOF).success).toBe(false);
  });

  it('rejects invented fields and unsupported player-rule pairings', () => {
    expect(AbilitySchema.safeParse({ ...PLAYER_HEXPROOF, duration: 'forever' }).success).toBe(false);
    expect(() =>
      parseCard({
        ...LEYLINE_OF_SANCTITY,
        abilities: [{ ...PLAYER_HEXPROOF, players: 'eachOpponent' }],
      }),
    ).toThrow(/hasHexproof.*controller|controller.*hasHexproof/iu);
    expect(() =>
      parseCard({
        ...LEYLINE_OF_SANCTITY,
        abilities: [
          {
            kind: 'staticPlayerRule',
            players: 'controller',
            rule: 'cantAttackWithCreaturesIfCastSpellThisTurn',
          },
        ],
      }),
    ).toThrow(/eachOpponent|opponent/iu);
  });
});
