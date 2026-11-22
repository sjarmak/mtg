/** Source-attested Forge parity for M11 Jace's Erasure. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe("Jace's Erasure Forge export", () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm11-059-jaces-erasure-forge',
      name: "Jace's Erasure",
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 59 },
      manaCost: { generic: 1, U: 1 },
      colors: ['U'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'youDrawCard',
          optional: true,
          effects: [{ kind: 'millCards', count: 1, target: { kind: 'targetPlayer' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        "Name:Jace's Erasure",
        'ManaCost:1 U',
        'Types:Enchantment',
        'T:Mode$ Drawn | ValidCard$ Card.YouCtrl | TriggerZones$ Battlefield | Execute$ Trig1Effect1 | OptionalDecider$ You | TriggerDescription$ Whenever you draw a card, you may have target player mill a card.',
        'SVar:Trig1Effect1:DB$ Mill | NumCards$ 1 | ValidTgts$ Player',
        'DeckHas:Ability$Mill',
        'Oracle:Whenever you draw a card, you may have target player mill a card.',
        '',
      ].join('\n'),
    );
  });
});
