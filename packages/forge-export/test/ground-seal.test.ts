/** Source-attested Forge parity for M13 Ground Seal. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('Ground Seal Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm13-176-ground-seal-forge',
      name: 'Ground Seal',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 176 },
      manaCost: { generic: 1, G: 1 },
      colors: ['G'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
        { kind: 'staticGameRule', rule: 'cardsInGraveyardsCantBeTargets' },
      ],
    });

    expect(mustTranspile(card)).toBe(
      [
        'Name:Ground Seal',
        'ManaCost:1 G',
        'Types:Enchantment',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield, draw a card.',
        'SVar:Trig1Effect1:DB$ Draw | Defined$ You | NumCards$ 1',
        "S:Mode$ CantTarget | AffectedZone$ Graveyard | Description$ Cards in graveyards can't be the targets of spells or abilities.",
        'SVar:NonStackingEffect:True',
        "Oracle:When Ground Seal enters the battlefield, draw a card.\\nCards in graveyards can't be the targets of spells or abilities.",
        '',
      ].join('\n'),
    );
  });
});
