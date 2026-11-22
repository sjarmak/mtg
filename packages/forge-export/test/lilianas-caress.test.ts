/** Source-attested Forge parity for M11 Liliana's Caress. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe("Liliana's Caress Forge export", () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-103-lilianas-caress-forge',
      name: "Liliana's Caress",
      rarity: 'uncommon',
      set: { code: 'M11', collectorNumber: 103 },
      manaCost: { generic: 1, B: 1 },
      colors: ['B'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'opponentDiscardsCard',
          effects: [{ kind: 'loseLife', amount: 2, target: { kind: 'triggeringPlayer' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        "Name:Liliana's Caress",
        'ManaCost:1 B',
        'Types:Enchantment',
        'T:Mode$ Discarded | ValidCard$ Card.OppOwn | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | TriggerDescription$ Whenever an opponent discards a card, that player loses 2 life.',
        'SVar:Trig1Effect1:DB$ LoseLife | Defined$ TriggeredCardController | LifeAmount$ 2',
        'Oracle:Whenever an opponent discards a card, that player loses 2 life.',
        '',
      ].join('\n'),
    );
  });
});
