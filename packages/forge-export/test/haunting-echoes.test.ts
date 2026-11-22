/** Forge parity for Haunting Echoes' remembered cross-zone name search. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('Haunting Echoes', () => {
  /**
   * Source: Card-Forge/forge at a8fbfd41d38c732b7204cfb17e75332d2483fb9e,
   * `forge-gui/res/cardsfolder/h/haunting_echoes.txt`.
   */
  it('writes the attested remembered graveyard move, name search, and cleanup chain', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm11-099',
      name: 'Haunting Echoes',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 99 },
      manaCost: { generic: 3, B: 2 },
      colors: ['B'],
      effects: [
        {
          kind: 'exileNonbasicGraveyardAndMatchingLibrary',
          target: { kind: 'targetPlayer' },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        'Name:Haunting Echoes',
        'ManaCost:3 B B',
        'Types:Sorcery',
        "A:SP$ ChangeZoneAll | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Player | ChangeType$ Card.nonBasic | RememberChanged$ True | SubAbility$ DBEffect1 | SpellDescription$ Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
        'SVar:DBEffect1:DB$ ChangeZone | Origin$ Library | DefinedPlayer$ Targeted | Destination$ Exile | ChangeType$ Card.sharesNameWith Remembered | ChangeNum$ X | Chooser$ You | Shuffle$ True | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True',
        'SVar:X:TargetedPlayer$CardsInLibrary',
        "Oracle:Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
        '',
      ].join('\n'),
    );
  });
});
