/** Source-attested Forge parity for M13 Turn to Slag. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const TURN_TO_SLAG_INPUT = {
  kind: 'sorcery',
  id: 'm13-turn-to-slag-forge',
  name: 'Turn to Slag',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 153 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  effects: [
    { kind: 'dealDamage', amount: 5, target: { kind: 'targetCreature' } },
    {
      kind: 'destroyAttachedPermanents',
      target: { kind: 'thatCreature' },
      filter: { subtypes: ['Equipment'] },
    },
  ],
} as unknown as CardInput;

describe('Turn to Slag Forge export', () => {
  it('emits Forge current card source exactly', () => {
    expect(mustTranspile(parseCard(TURN_TO_SLAG_INPUT))).toBe(
      [
        'Name:Turn to Slag',
        'ManaCost:3 R R',
        'Types:Sorcery',
        'A:SP$ DealDamage | ValidTgts$ Creature | NumDmg$ 5 | SubAbility$ DBEffect1 | SpellDescription$ CARDNAME deals 5 damage to target creature. Destroy all Equipment attached to that creature.',
        'SVar:DBEffect1:DB$ DestroyAll | ValidCards$ Targeted.Equipment+Attached',
        'Oracle:Turn to Slag deals 5 damage to target creature. Destroy all Equipment attached to that creature.',
        '',
      ].join('\n'),
    );
  });
});
