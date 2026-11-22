/** Forge parity for Worldfire's three ordered table-wide instructions. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Worldfire', () => {
  /**
   * Source: Card-Forge/forge, `forge-gui/res/cardsfolder/w/worldfire.txt`.
   */
  it('writes the shipped battlefield, hand, graveyard, and life chain', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm13-158',
      name: 'Worldfire',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 158 },
      manaCost: { generic: 6, R: 3 },
      colors: ['R'],
      effects: [
        {
          kind: 'exileTarget',
          scope: 'allPermanents',
          scopeFilter: {},
          target: { kind: 'noTarget' },
        },
        { kind: 'exileHandsAndGraveyards' },
        { kind: 'setLife', amount: 1, players: 'eachPlayer' },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Worldfire',
        'ManaCost:6 R R R',
        'Types:Sorcery',
        "A:SP$ ChangeZoneAll | ChangeType$ Permanent | Origin$ Battlefield | Destination$ Exile | SubAbility$ DBEffect1 | SpellDescription$ Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1.",
        'SVar:DBEffect1:DB$ ChangeZoneAll | Origin$ Hand | Destination$ Exile | ChangeType$ Card | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ ChangeZoneAll | Origin$ Graveyard | Destination$ Exile | ChangeType$ Card | SubAbility$ DBEffect3',
        'SVar:DBEffect3:DB$ SetLife | Defined$ Player | LifeAmount$ 1',
        "Oracle:Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1.",
        '',
      ].join('\n'),
    );
  });
});
