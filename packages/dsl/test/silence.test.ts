/** Silence's hand-authored, turn-scoped casting rule. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';

const EFFECT = {
  kind: 'cantCastSpellsThisTurn' as const,
  players: 'eachOpponent' as const,
};

const SILENCE = {
  kind: 'instant' as const,
  id: 'tst-silence',
  name: 'Silence',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 30 },
  colors: ['W'] as const,
  manaCost: { W: 1 },
  effects: [EFFECT],
};

describe('Silence authoring', () => {
  it('parses and prints the exact current Oracle sentence', () => {
    expect(CardEffectSchema.safeParse(EFFECT).success).toBe(true);
    expect(CardEffectSchema.safeParse({ ...EFFECT, target: { kind: 'noTarget' } }).success).toBe(false);
    expect(renderOracleText(parseCard(SILENCE))).toBe("Your opponents can't cast spells this turn.");
  });

  it('keeps the rule-changing effect outside generator output', () => {
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });
});
