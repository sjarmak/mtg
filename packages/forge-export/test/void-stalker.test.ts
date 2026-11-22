/** Void Stalker against Forge's current checked-in card script. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Void Stalker', () => {
  /**
   * Source: Card-Forge/forge master,
   * `forge-gui/res/cardsfolder/v/void_stalker.txt` (retrieved 2026-08-26).
   */
  it('writes the attested combined source-and-target library move', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-77',
      name: 'Void Stalker',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 77 },
      manaCost: { generic: 1, U: 1 },
      colors: ['U'],
      subtypes: ['Elemental'],
      power: 2,
      toughness: 1,
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2, U: 1 }, tapSelf: true },
          effects: [
            {
              kind: 'putSourceAndTargetOnOwnersLibrariesThenShuffle',
              target: { kind: 'targetCreature' },
            },
          ],
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Void Stalker',
        'ManaCost:1 U',
        'Types:Creature Elemental',
        'PT:2/1',
        "A:AB$ ChangeZone | Cost$ 2 U T | ValidTgts$ Creature | ThisDefinedAndTgts$ Self | Origin$ Battlefield | Destination$ Library | LibraryPosition$ 0 | Shuffle$ True | SpellDescription$ Put CARDNAME and target creature on top of their owners' libraries, then those players shuffle their libraries.",
        "Oracle:{2}{U}, {T}: Put this creature and target creature on top of their owners' libraries, then those players shuffle their libraries.",
        '',
      ].join('\n'),
    );
  });
});
