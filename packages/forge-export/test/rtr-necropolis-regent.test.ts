/** Source-attested Forge parity for RTR Necropolis Regent. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const NECROPOLIS_REGENT = parseCard({
  kind: 'creature',
  id: 'rtr-071-necropolis-regent-forge',
  name: 'Necropolis Regent',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 71 },
  manaCost: { generic: 3, B: 3 },
  colors: ['B'],
  subtypes: ['Vampire'],
  power: 6,
  toughness: 5,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'controlledCreatureDealsCombatDamageToPlayer',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: { kind: 'triggeringDamageAmount' },
          target: { kind: 'triggeringCreature' },
        },
      ],
    },
  ],
});

describe('Necropolis Regent Forge export', () => {
  /**
   * Source: Card-Forge/forge revision 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/n/necropolis_regent.txt`.
   */
  it('matches the installed retained-source damage script exactly', () => {
    expect(mustTranspile(NECROPOLIS_REGENT)).toBe(
      [
        'Name:Necropolis Regent',
        'ManaCost:3 B B B',
        'Types:Creature Vampire',
        'PT:6/5',
        'K:Flying',
        'T:Mode$ DamageDone | ValidSource$ Creature.YouCtrl | ValidTarget$ Player | TriggerZones$ Battlefield | CombatDamage$ True | Execute$ TrigPutCounter | TriggerDescription$ Whenever a creature you control deals combat damage to a player, put that many +1/+1 counters on it.',
        'SVar:TrigPutCounter:DB$ PutCounter | Defined$ TriggeredSourceLKICopy | CounterType$ P1P1 | CounterNum$ X',
        'SVar:X:TriggerCount$DamageAmount',
        'Oracle:Flying\\nWhenever a creature you control deals combat damage to a player, put that many +1/+1 counters on it.',
        '',
      ].join('\n'),
    );
  });
});
