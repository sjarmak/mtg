/** Source-attested Forge parity for M11 Sorcerer's Strongbox. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe("Sorcerer's Strongbox Forge export", () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm11-213-sorcerers-strongbox-forge',
      name: "Sorcerer's Strongbox",
      rarity: 'uncommon',
      set: { code: 'M11', collectorNumber: 213 },
      manaCost: { generic: 4 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: true },
          effects: [
            {
              kind: 'flipCoin',
              winEffects: [
                { kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } },
                { kind: 'drawCards', count: 3, target: { kind: 'noTarget' } },
              ],
            },
          ],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        "Name:Sorcerer's Strongbox",
        'ManaCost:4',
        'Types:Artifact',
        'A:AB$ FlipCoin | Cost$ 2 T | WinSubAbility$ DBSac | SpellDescription$ Flip a coin. If you win the flip, sacrifice CARDNAME and draw three cards.',
        'SVar:DBSac:DB$ Sacrifice | SubAbility$ DBDraw',
        'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 3',
        "Oracle:{2}, {T}: Flip a coin. If you win the flip, sacrifice Sorcerer's Strongbox and draw three cards.",
        '',
      ].join('\n'),
    );
  });
});
