/** Source-attested Forge parity for RTR Crosstown Courier. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const CROSSTOWN_COURIER = parseCard({
  kind: 'creature',
  id: 'rtr-034-crosstown-courier-forge',
  name: 'Crosstown Courier',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 34 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Vedalken'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      printedSourceReference: 'thisCreature',
      effects: [
        {
          kind: 'millCards',
          count: { kind: 'triggeringDamageAmount' },
          target: { kind: 'triggeringPlayer' },
        },
      ],
    },
  ],
});

describe('Crosstown Courier Forge export', () => {
  /**
   * Source: Card-Forge/forge revision 0c9f64ae0d46290523d17e6e6b2cc76331743a9e,
   * `forge-gui/res/cardsfolder/c/crosstown_courier.txt`.
   */
  it('matches the installed damage-linked mill script exactly', () => {
    expect(mustTranspile(CROSSTOWN_COURIER)).toBe(
      [
        'Name:Crosstown Courier',
        'ManaCost:1 U',
        'Types:Creature Vedalken',
        'PT:2/1',
        'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigMill | TriggerZones$ Battlefield | TriggerDescription$ Whenever CARDNAME deals combat damage to a player, that player mills that many cards.',
        'SVar:TrigMill:DB$ Mill | Defined$ TriggeredTarget | NumCards$ X',
        'SVar:X:TriggerCount$DamageAmount',
        'Oracle:Whenever Crosstown Courier deals combat damage to a player, that player mills that many cards.',
        '',
      ].join('\n'),
    );
  });
});
