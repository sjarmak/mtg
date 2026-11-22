/** Source-attested Forge parity for RTR Rest in Peace. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Rest in Peace Forge export', () => {
  it('emits the installed Forge card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'rtr-018-rest-in-peace-forge',
      name: 'Rest in Peace',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 18 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          printedSourceReference: 'thisEnchantment',
          effects: [{ kind: 'exileGraveyard', whose: 'each' }],
        },
        {
          kind: 'staticPlayerRule',
          players: 'eachPlayer',
          rule: 'cardsOrTokensToGraveyardAreExiled',
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Rest in Peace',
        'ManaCost:1 W',
        'Types:Enchantment',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters, exile all graveyards.',
        'SVar:Trig1Effect1:DB$ ChangeZoneAll | ChangeType$ Card | Origin$ Graveyard | Destination$ Exile',
        'R:Event$ Moved | ActiveZones$ Battlefield | Destination$ Graveyard | ValidCard$ Card | ReplaceWith$ Exile | Description$ If a card or token would be put into a graveyard from anywhere, exile it instead.',
        'SVar:Exile:DB$ ChangeZone | Hidden$ True | Origin$ All | Destination$ Exile | Defined$ ReplacedCard',
        'Oracle:When this enchantment enters, exile all graveyards.\\nIf a card or token would be put into a graveyard from anywhere, exile it instead.',
        '',
      ].join('\n'),
    );
  });
});
