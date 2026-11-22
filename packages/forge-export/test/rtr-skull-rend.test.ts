import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const SKULL_REND = parseCard({
  kind: 'sorcery',
  id: 'rtr-195-skull-rend-forge',
  name: 'Skull Rend',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 195 },
  manaCost: { generic: 3, B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [
    { kind: 'dealDamage', amount: 2, target: { kind: 'noTarget' }, players: 'eachOpponent' },
    { kind: 'discardCards', count: 2, target: { kind: 'noTarget' }, players: 'eachOpponent', random: true },
  ],
});

describe('RTR #195 Skull Rend Forge export', () => {
  it('matches the installed Forge script exactly', () => {
    expect(mustTranspile(SKULL_REND)).toBe(
      [
        'Name:Skull Rend',
        'ManaCost:3 B R',
        'Types:Sorcery',
        'A:SP$ DealDamage | Defined$ Player.Opponent | NumDmg$ 2 | SubAbility$ Effect1 | SpellDescription$ CARDNAME deals 2 damage to each opponent. Those players each discard two cards at random.',
        'SVar:Effect1:DB$ Discard | Defined$ Player.Opponent | NumCards$ 2 | Mode$ Random',
        'Oracle:Skull Rend deals 2 damage to each opponent. Those players each discard two cards at random.',
        '',
      ].join('\n'),
    );
  });
});
