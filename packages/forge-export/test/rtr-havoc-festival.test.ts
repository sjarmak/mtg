/** Installed Forge 2.0.14 parity for RTR Havoc Festival. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const HAVOC_FESTIVAL = parseCard({
  kind: 'enchantment',
  id: 'rtr-166-havoc-festival-forge',
  name: 'Havoc Festival',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 166 },
  manaCost: { generic: 4, B: 1, R: 1 },
  colors: ['B', 'R'],
  abilities: [
    { kind: 'staticGameRule', rule: 'playersCantGainLife' },
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      effects: [
        {
          kind: 'loseLife',
          amount: 0,
          amountFrom: 'triggeringPlayerLifeHalfRoundedUp',
          target: { kind: 'triggeringPlayer' },
        },
      ],
    },
  ],
});

describe('Havoc Festival Forge export', () => {
  it('emits the installed global rule, each-upkeep trigger, and HalfUp payload exactly', () => {
    expect(mustTranspile(HAVOC_FESTIVAL)).toBe(
      [
        'Name:Havoc Festival',
        'ManaCost:4 B R',
        'Types:Enchantment',
        "S:Mode$ CantGainLife | ValidPlayer$ Player | Description$ Players can't gain life.",
        "T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Player | TriggerZones$ Battlefield | Execute$ Trig2Effect1 | TriggerDescription$ At the beginning of each player's upkeep, that player loses half their life, rounded up.",
        'SVar:Trig2Effect1:DB$ LoseLife | Defined$ TriggeredPlayer | LifeAmount$ HavocX',
        'SVar:HavocX:TriggeredPlayer$LifeTotal/HalfUp',
        "Oracle:Players can't gain life.\\nAt the beginning of each player's upkeep, that player loses half their life, rounded up.",
        '',
      ].join('\n'),
    );
  });
});
