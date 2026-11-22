/** Leyline of Anticipation's opening action and controller-scoped cast timing. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const FLASH_CASTING = {
  kind: 'staticPlayerRule' as const,
  players: 'controller' as const,
  rule: 'castSpellsAsThoughFlash' as const,
};

const LEYLINE_OF_ANTICIPATION = {
  kind: 'enchantment' as const,
  id: 'm11-61-leyline-of-anticipation',
  name: 'Leyline of Anticipation',
  rarity: 'rare' as const,
  set: { code: 'M11', collectorNumber: 61 },
  manaCost: { generic: 2, U: 2 },
  colors: ['U'] as const,
  openingHandAction: { kind: 'beginOnBattlefield' as const },
  abilities: [FLASH_CASTING],
};

describe('Leyline of Anticipation authoring', () => {
  it('parses and prints both current Oracle clauses exactly', () => {
    expect(AbilitySchema.safeParse(FLASH_CASTING).success).toBe(true);
    expect(renderOracleText(parseCard(LEYLINE_OF_ANTICIPATION))).toBe(
      'If Leyline of Anticipation is in your opening hand, you may begin the game with it on the battlefield.\n' +
        'You may cast spells as though they had flash.',
    );
  });

  it('keeps flash-casting permission outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(FLASH_CASTING).success).toBe(false);
  });

  it('rejects invented fields and an opponent-scoped permission', () => {
    expect(AbilitySchema.safeParse({ ...FLASH_CASTING, cardTypes: ['creature'] }).success).toBe(false);
    expect(() =>
      parseCard({
        ...LEYLINE_OF_ANTICIPATION,
        abilities: [{ ...FLASH_CASTING, players: 'eachOpponent' }],
      }),
    ).toThrow(/castSpellsAsThoughFlash.*controller|controller.*castSpellsAsThoughFlash/iu);
  });
});
