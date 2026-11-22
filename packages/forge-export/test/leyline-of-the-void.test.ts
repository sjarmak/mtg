/** Source-attested Forge parity for M11 Leyline of the Void. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Leyline of the Void Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-101-leyline-of-the-void-forge',
      name: 'Leyline of the Void',
      rarity: 'rare',
      set: { code: 'M11', collectorNumber: 101 },
      manaCost: { generic: 2, B: 2 },
      colors: ['B'],
      openingHandAction: { kind: 'beginOnBattlefield' },
      abilities: [
        {
          kind: 'staticPlayerRule',
          players: 'eachOpponent',
          rule: 'cardsToGraveyardAreExiled',
        },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Leyline of the Void',
        'ManaCost:2 B B',
        'Types:Enchantment',
        'K:MayEffectFromOpeningHand:FromHand',
        'SVar:FromHand:DB$ ChangeZone | Defined$ Self | Origin$ Hand | Destination$ Battlefield | SpellDescription$ If CARDNAME is in your opening hand, you may begin the game with it on the battlefield.',
        "R:Event$ Moved | ActiveZones$ Battlefield | Destination$ Graveyard | ValidCard$ Card.!token+OppOwn | ReplaceWith$ Exile | Description$ If a card would be put into an opponent's graveyard from anywhere, exile it instead.",
        'SVar:Exile:DB$ ChangeZone | Hidden$ True | Origin$ All | Destination$ Exile | Defined$ ReplacedCard',
        'SVar:NonStackingEffect:True',
        "Oracle:If Leyline of the Void is in your opening hand, you may begin the game with it on the battlefield.\\nIf a card would be put into an opponent's graveyard from anywhere, exile it instead.",
        '',
      ].join('\n'),
    );
  });
});
