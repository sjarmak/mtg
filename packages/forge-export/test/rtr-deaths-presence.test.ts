/** Source-attested Forge parity for RTR Death's Presence. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const DEATHS_PRESENCE = parseCard({
  kind: 'enchantment',
  id: 'rtr-121-deaths-presence-forge',
  name: "Death's Presence",
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 121 },
  colors: ['G'],
  manaCost: { generic: 5, G: 1 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'controlledCreatureDies',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: { kind: 'triggeringCreaturePower' },
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
  ],
});

describe("RTR #121 Death's Presence Forge export", () => {
  /**
   * Source: Card-Forge/forge at 7ba1a39343d6ea7e96e153d0fd7f532ad39863c4,
   * `forge-gui/res/cardsfolder/d/deaths_presence.txt`.
   */
  it('writes the controlled-creature death trigger and departing power protocol', () => {
    const script = mustTranspile(DEATHS_PRESENCE);

    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.YouCtrl | TriggerZones$ Battlefield | Execute$ Trig1Effect1',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ PutCounter | ValidTgts$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ TriggeredCreaturePower',
    );
    expect(script).toContain('SVar:TriggeredCreaturePower:TriggeredCard$CardPower');
  });
});
