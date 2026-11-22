import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Roaring Primadox', () => {
  /** Source: Card-Forge/forge current `forge-gui/res/cardsfolder/r/roaring_primadox.txt`. */
  it('writes Forge mandatory controlled-creature battlefield choice grammar exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-188',
      name: 'Roaring Primadox',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 188 },
      manaCost: { generic: 3, G: 1 },
      colors: ['G'],
      subtypes: ['Beast'],
      power: 4,
      toughness: 4,
      abilities: [
        {
          kind: 'triggered',
          condition: 'beginningOfYourUpkeep',
          effects: [
            {
              kind: 'chooseFromBattlefield',
              filter: { cardTypes: ['creature'] },
              destination: 'hand',
            },
          ],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Roaring Primadox',
        'ManaCost:3 G',
        'Types:Creature Beast',
        'PT:4/4',
        "T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ At the beginning of your upkeep, return a creature you control to its owner's hand.",
        'SVar:Trig1Effect1:DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | Hidden$ True | Mandatory$ True | ChangeType$ Creature.YouCtrl | ChangeNum$ 1',
        "Oracle:At the beginning of your upkeep, return a creature you control to its owner's hand.",
        '',
      ].join('\n'),
    );
  });
});
