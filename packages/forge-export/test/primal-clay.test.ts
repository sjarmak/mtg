import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const PRIMAL_CLAY = parseCard({
  kind: 'creature',
  id: 'm13-primal-clay',
  name: 'Primal Clay',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 210 },
  manaCost: { generic: 4 },
  artifact: true,
  subtypes: ['Shapeshifter'],
  power: 0,
  toughness: 0,
  entryReplacement: {
    kind: 'entersAsCharacteristicChoice',
    modes: [
      { power: 3, toughness: 3 },
      { power: 2, toughness: 2, addKeywords: ['flying'] },
      { power: 1, toughness: 6, addSubtypes: ['Wall'], addKeywordAbilities: [{ kind: 'defender' }] },
    ],
  },
});

describe('Primal Clay at the Forge parity boundary', () => {
  it('emits the source-proven copy-layer GenericChoice script', () => {
    const result = transpileCardScript(PRIMAL_CLAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lines).toEqual(
      expect.arrayContaining([
        'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | Layer$ Copy | ReplacementResult$ Updated | ReplaceWith$ EntryCharacteristicsChoice | Description$ As CARDNAME enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types.',
        'SVar:EntryCharacteristicsChoice:DB$ GenericChoice | Defined$ You | Choices$ EntryCharacteristics1,EntryCharacteristics2,EntryCharacteristics3',
        'SVar:EntryCharacteristics1:DB$ Clone | Defined$ Self | SetPower$ 3 | SetToughness$ 3 | SpellDescription$ CARDNAME is 3/3.',
        'SVar:EntryCharacteristics2:DB$ Clone | Defined$ Self | SetPower$ 2 | SetToughness$ 2 | AddKeywords$ Flying | SpellDescription$ CARDNAME is 2/2 with flying.',
        'SVar:EntryCharacteristics3:DB$ Clone | Defined$ Self | SetPower$ 1 | SetToughness$ 6 | AddTypes$ Wall | AddKeywords$ Defender | SpellDescription$ CARDNAME is 1/6 with defender and is a Wall in addition to its other types.',
      ]),
    );
  });
});
