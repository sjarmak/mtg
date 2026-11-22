/** Bloodcrazed Goblin's hand-authored conditional combat restriction. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  enabledWhile: { kind: 'opponentUndamagedThisTurn' as const },
  modification: { kind: 'cantAttack' as const },
};

const BLOODCRAZED_GOBLIN = {
  kind: 'creature' as const,
  id: 'tst-bloodcrazed-goblin',
  name: 'Bloodcrazed Goblin',
  rarity: 'common' as const,
  set: { code: 'M11', collectorNumber: 125 },
  colors: ['R'] as const,
  manaCost: { R: 1 },
  power: 2,
  toughness: 2,
  subtypes: ['Goblin', 'Berserker'],
  abilities: [ABILITY],
};

describe('Bloodcrazed Goblin authoring', () => {
  it('prints the restriction as the exact unless sentence', () => {
    expect(renderOracleText(parseCard(BLOODCRAZED_GOBLIN))).toBe(
      "Bloodcrazed Goblin can't attack unless an opponent has been dealt damage this turn.",
    );
  });

  it('keeps the turn-history condition outside generator output', () => {
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });
});
