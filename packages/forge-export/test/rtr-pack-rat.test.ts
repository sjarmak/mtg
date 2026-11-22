/** Source-attested Forge parity for RTR Pack Rat. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const PACK_RAT_INPUT = {
  kind: 'creature' as const,
  id: 'rtr-073-pack-rat-forge',
  name: 'Pack Rat',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 73 },
  colors: ['B' as const],
  manaCost: { generic: 1, B: 1 },
  power: 0,
  toughness: 0,
  subtypes: ['Rat'],
  characteristicPowerToughness: { kind: 'controlledSubtype' as const, subtype: 'Rat' },
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { generic: 2, B: 1 }, discard: 1 },
      effects: [{ kind: 'createTokenCopyOfSelf' as const }],
    },
  ],
};

describe('Pack Rat Forge export', () => {
  it('matches the installed count and self-copy script', () => {
    expect(mustTranspile(parseCard(PACK_RAT_INPUT))).toBe(
      [
        'Name:Pack Rat',
        'ManaCost:1 B',
        'Types:Creature Rat',
        'PT:*/*',
        "S:Mode$ Continuous | CharacteristicDefining$ True | SetPower$ X | SetToughness$ X | Description$ CARDNAME's power and toughness are each equal to the number of Rats you control.",
        "A:AB$ CopyPermanent | Cost$ 2 B Discard<1/Card> | Defined$ Self | SpellDescription$ Create a token that's a copy of CARDNAME.",
        'SVar:X:Count$Valid Rat.YouCtrl',
        'SVar:BuffedBy:Rat',
        'SVar:NoZeroToughnessAI:True',
        'DeckHints:Type$Rat',
        "Oracle:Pack Rat's power and toughness are each equal to the number of Rats you control.\\n{2}{B}, Discard a card: Create a token that's a copy of this creature.",
        '',
      ].join('\n'),
    );
  });
});
