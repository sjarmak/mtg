import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';

const SKULL_REND = {
  kind: 'sorcery',
  id: 'rtr-195-skull-rend-dsl',
  name: 'Skull Rend',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 195 },
  manaCost: { generic: 3, B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [
    { kind: 'dealDamage', amount: 2, target: { kind: 'noTarget' }, players: 'eachOpponent' },
    { kind: 'discardCards', count: 2, target: { kind: 'noTarget' }, players: 'eachOpponent', random: true },
  ],
} as const;

describe('RTR #195 Skull Rend', () => {
  it('renders both source-attested sentences in exact current Oracle order', () => {
    const card = parseCard(SKULL_REND);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Skull Rend deals 2 damage to each opponent. Those players each discard two cards at random.',
    );
  });

  it('keeps random discard outside the generator output vocabulary', () => {
    expect(ModelEffectSchema.safeParse(parseCard(SKULL_REND).effects[1]).success).toBe(false);
  });
});
