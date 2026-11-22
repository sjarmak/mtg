import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const ANNIHILATING_FIRE = parseCard({
  kind: 'instant',
  id: 'rtr-85-annihilating-fire-forge',
  name: 'Annihilating Fire',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 85 },
  manaCost: { generic: 1, R: 2 },
  colors: ['R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: 3,
      target: { kind: 'anyTarget' },
      exileDamagedCreatureIfItWouldDieThisTurn: true,
    },
  ],
} as unknown as CardInput);

describe('RTR #85 Annihilating Fire Forge export', () => {
  it('exports the installed Forge remembered-damage death replacement exactly', () => {
    expect(mustTranspile(ANNIHILATING_FIRE)).toBe(
      [
        'Name:Annihilating Fire',
        'ManaCost:1 R R',
        'Types:Instant',
        'A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | RememberDamaged$ True | ReplaceDyingDefined$ Remembered.Creature | SubAbility$ DBCleanup | SpellDescription$ CARDNAME deals 3 damage to any target. If a creature dealt damage this way would die this turn, exile it instead.',
        'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
        'Oracle:Annihilating Fire deals 3 damage to any target. If a creature dealt damage this way would die this turn, exile it instead.',
        '',
      ].join('\n'),
    );
  });
});
