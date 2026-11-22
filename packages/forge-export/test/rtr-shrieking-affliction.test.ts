/** Installed Forge parity for RTR Shrieking Affliction. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const SHRIEKING_AFFLICTION = parseCard({
  kind: 'enchantment',
  id: 'rtr-76-shrieking-affliction-forge',
  name: 'Shrieking Affliction',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 76 },
  manaCost: { B: 1 },
  colors: ['B'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      triggeringPlayerIsOpponent: true,
      triggeringPlayerHandAtMost: 1,
      effects: [{ kind: 'loseLife', amount: 3, target: { kind: 'triggeringPlayer' } }],
    },
  ],
});

describe('Shrieking Affliction Forge export', () => {
  it('emits the installed opponent phase, hand check, and TriggeredPlayer payload exactly', () => {
    expect(mustTranspile(SHRIEKING_AFFLICTION)).toBe(
      [
        'Name:Shrieking Affliction',
        'ManaCost:B',
        'Types:Enchantment',
        "T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Opponent | CheckSVar$ CardsInHand | SVarCompare$ LE1 | Execute$ Trig1Effect1 | TriggerZones$ Battlefield | TriggerDescription$ At the beginning of each opponent's upkeep, if that player has one or fewer cards in hand, they lose 3 life.",
        'SVar:Trig1Effect1:DB$ LoseLife | Defined$ TriggeredPlayer | LifeAmount$ 3',
        'SVar:CardsInHand:Count$ValidHand Card.ActivePlayerCtrl',
        "Oracle:At the beginning of each opponent's upkeep, if that player has one or fewer cards in hand, they lose 3 life.",
        '',
      ].join('\n'),
    );
  });
});
