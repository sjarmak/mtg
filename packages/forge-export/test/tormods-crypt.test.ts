/** Forge parity for M13 #219, Tormod's Crypt. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe("Tormod's Crypt", () => {
  /**
   * Source: Card-Forge/forge at 8fa4e6bd3f4dad0eec408db5f59baf883456cb83,
   * `forge-gui/res/cardsfolder/t/tormods_crypt.txt`.
   */
  it('writes the attested targeted whole-graveyard operation and paid source cost', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm13-219',
      name: "Tormod's Crypt",
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 219 },
      manaCost: { generic: 0 },
      colors: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
          effects: [{ kind: 'exileGraveyard', target: { kind: 'targetPlayer' } }],
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        "Name:Tormod's Crypt",
        'ManaCost:0',
        'Types:Artifact',
        "A:AB$ ChangeZoneAll | Cost$ T Sac<1/CARDNAME> | Origin$ Graveyard | Destination$ Exile | ValidTgts$ Player | ChangeType$ Card | SpellDescription$ Exile target player's graveyard.",
        "Oracle:{T}, Sacrifice Tormod's Crypt: Exile target player's graveyard.",
        '',
      ].join('\n'),
    );
  });
});
