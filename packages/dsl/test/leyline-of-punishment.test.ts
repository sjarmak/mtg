/** Leyline of Punishment's opening action and two global prohibitions. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const CANT_GAIN_LIFE = {
  kind: 'staticGameRule' as const,
  rule: 'playersCantGainLife' as const,
};

const CANT_PREVENT_DAMAGE = {
  kind: 'staticGameRule' as const,
  rule: 'damageCantBePrevented' as const,
};

const LEYLINE_OF_PUNISHMENT = {
  kind: 'enchantment' as const,
  id: 'm11-148-leyline-of-punishment',
  name: 'Leyline of Punishment',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 148 },
  manaCost: { generic: 2, R: 2 },
  colors: ['R'] as const,
  openingHandAction: { kind: 'beginOnBattlefield' as const },
  abilities: [CANT_GAIN_LIFE, CANT_PREVENT_DAMAGE],
};

describe('Leyline of Punishment authoring', () => {
  it('parses and prints all three current Oracle clauses exactly', () => {
    expect(AbilitySchema.safeParse(CANT_GAIN_LIFE).success).toBe(true);
    expect(AbilitySchema.safeParse(CANT_PREVENT_DAMAGE).success).toBe(true);
    expect(renderOracleText(parseCard(LEYLINE_OF_PUNISHMENT))).toBe(
      'If Leyline of Punishment is in your opening hand, you may begin the game with it on the battlefield.\n' +
        "Players can't gain life.\n" +
        "Damage can't be prevented.",
    );
  });

  it('keeps both prohibitions outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(CANT_GAIN_LIFE).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(CANT_PREVENT_DAMAGE).success).toBe(false);
  });

  it('rejects invented scope fields on either global rule', () => {
    expect(AbilitySchema.safeParse({ ...CANT_GAIN_LIFE, players: 'eachPlayer' }).success).toBe(false);
    expect(AbilitySchema.safeParse({ ...CANT_PREVENT_DAMAGE, scope: 'allDamage' }).success).toBe(false);
  });
});
