import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Time Reversal', () => {
  /**
   * Source: Card-Forge/forge at e4664f05daaf77371ea951ed8ea85f705296619d,
   * `forge-gui/res/cardsfolder/t/time_reversal.txt`.
   */
  it('writes the attested multi-zone sweep, each-player draw, and stack exile', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm11-075',
      name: 'Time Reversal',
      rarity: 'mythic',
      set: { code: 'M11', collectorNumber: 75 },
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      effects: [
        { kind: 'shuffleHandsAndGraveyardsIntoLibraries' },
        { kind: 'drawCards', count: 7, players: 'eachPlayer', target: { kind: 'noTarget' } },
        { kind: 'exileThisSpell' },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Time Reversal',
        'ManaCost:3 U U',
        'Types:Sorcery',
        'A:SP$ ChangeZoneAll | ChangeType$ Card | Origin$ Hand,Graveyard | Destination$ Library | Shuffle$ True | UseAllOriginZones$ True | SubAbility$ DBEffect1 | SpellDescription$ Each player shuffles their hand and graveyard into their library, then draws seven cards. Exile CARDNAME.',
        'SVar:DBEffect1:DB$ Draw | NumCards$ 7 | Defined$ Player | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ ChangeZone | Origin$ Stack | Destination$ Exile',
        'Oracle:Each player shuffles their hand and graveyard into their library, then draws seven cards. Exile Time Reversal.',
        '',
      ].join('\n'),
    );
  });
});
