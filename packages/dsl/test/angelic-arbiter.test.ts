/** Angelic Arbiter's two live, conditional player restrictions. */
import { describe, expect, it } from 'vitest';
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const CANT_ATTACK = {
  kind: 'staticPlayerRule' as const,
  players: 'eachOpponent' as const,
  rule: 'cantAttackWithCreaturesIfCastSpellThisTurn' as const,
};

const CANT_CAST = {
  kind: 'staticPlayerRule' as const,
  players: 'eachOpponent' as const,
  rule: 'cantCastSpellsIfAttackedWithCreatureThisTurn' as const,
};

const ANGELIC_ARBITER = {
  kind: 'creature' as const,
  id: 'tst-angelic-arbiter',
  name: 'Angelic Arbiter',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 4 },
  colors: ['W'] as const,
  manaCost: { generic: 5, W: 2 },
  power: 5,
  toughness: 6,
  subtypes: ['Angel'],
  keywords: ['flying'] as const,
  abilities: [CANT_ATTACK, CANT_CAST],
};

describe('Angelic Arbiter authoring', () => {
  it('parses and prints the exact current Oracle text', () => {
    expect(AbilitySchema.safeParse(CANT_ATTACK).success).toBe(true);
    expect(AbilitySchema.safeParse(CANT_CAST).success).toBe(true);
    expect(renderOracleText(parseCard(ANGELIC_ARBITER))).toBe(
      "Flying\nEach opponent who cast a spell this turn can't attack with creatures.\n" +
        "Each opponent who attacked with a creature this turn can't cast spells.",
    );
  });

  it('keeps both rule-changing abilities outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(CANT_ATTACK).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(CANT_CAST).success).toBe(false);
  });

  it('rejects invented player scopes, rule names, and extra keys', () => {
    expect(AbilitySchema.safeParse({ ...CANT_ATTACK, players: 'allPlayers' }).success).toBe(false);
    expect(AbilitySchema.safeParse({ ...CANT_ATTACK, rule: 'cantAttack' }).success).toBe(false);
    expect(AbilitySchema.safeParse({ ...CANT_ATTACK, duration: 'forever' }).success).toBe(false);
  });
});
