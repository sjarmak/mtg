/** Source-attested Forge parity for M13 Hamletback Goliath. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const HAMLETBACK_GOLIATH = parseCard({
  kind: 'creature',
  id: 'm13-136-hamletback-goliath-forge',
  name: 'Hamletback Goliath',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 136 },
  colors: ['R'],
  manaCost: { generic: 6, R: 1 },
  subtypes: ['Giant', 'Warrior'],
  keywords: [],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'anotherCreatureEnters',
      optional: true,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: { kind: 'triggeringCreaturePower' },
          target: { kind: 'selfCreature' },
        },
      ],
    },
  ],
});

describe('Hamletback Goliath Forge export', () => {
  /**
   * Source: Card-Forge/forge at 7ba1a39343d6ea7e96e153d0fd7f532ad39863c4,
   * `forge-gui/res/cardsfolder/h/hamletback_goliath.txt`.
   */
  it('writes the other-creature trigger and TriggeredCard power protocol', () => {
    const script = mustTranspile(HAMLETBACK_GOLIATH);

    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | OptionalDecider$ You',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ TriggeredCreaturePower',
    );
    expect(script).toContain('SVar:TriggeredCreaturePower:TriggeredCard$CardPower');
  });
});
