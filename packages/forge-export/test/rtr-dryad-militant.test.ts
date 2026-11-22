/** Source-attested Forge parity for RTR Dryad Militant. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Dryad Militant Forge export', () => {
  it('emits the installed Forge card source semantics exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-214-dryad-militant-forge',
      name: 'Dryad Militant',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 214 },
      manaCost: { hybrid: { 'G/W': 1 } },
      printedHybridManaReminder: true,
      colors: ['G', 'W'],
      subtypes: ['Dryad', 'Soldier'],
      power: 2,
      toughness: 1,
      abilities: [
        {
          kind: 'staticPlayerRule',
          players: 'eachPlayer',
          rule: 'instantOrSorceryCardsToGraveyardAreExiled',
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Dryad Militant',
        'ManaCost:GW',
        'Types:Creature Dryad Soldier',
        'PT:2/1',
        'R:Event$ Moved | ActiveZones$ Battlefield | Destination$ Graveyard | ValidCard$ Instant,Sorcery | ReplaceWith$ Exile | Description$ If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead.',
        'SVar:Exile:DB$ ChangeZone | Hidden$ True | Origin$ All | Destination$ Exile | Defined$ ReplacedCard',
        'Oracle:If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead.',
        '',
      ].join('\n'),
    );
  });
});
