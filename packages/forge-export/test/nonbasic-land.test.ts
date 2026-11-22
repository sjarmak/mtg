import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { forgeRarityCode, transpileCardScript } from '@mtg/forge-export';

const CHECKLAND = parseCard({
  kind: 'land',
  id: 'm13-dragonskull-summit',
  name: 'Dragonskull Summit',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 222 },
  producesMana: ['B', 'R'],
  entryReplacement: {
    kind: 'entersTappedUnlessControlsLandSubtype',
    landTypes: ['Swamp', 'Mountain'],
  },
});

const FETCH_LAND = parseCard({
  kind: 'land',
  id: 'm11-terramorphic-expanse',
  name: 'Terramorphic Expanse',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 228 },
  producesMana: [],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true, sacrificeSelf: true },
      effects: [
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['land'], supertypes: ['basic'] },
          destination: 'battlefieldTapped',
          count: 1,
        },
        { kind: 'shuffleLibrary' },
      ],
    },
  ],
});

describe('nonbasic land Forge boundary', () => {
  it('refuses a checkland until both its entry and mana semantics have a Forge mapping', () => {
    const result = transpileCardScript(CHECKLAND);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNMAPPED_NONBASIC_LAND', path: 'entryReplacement' }),
      ]),
    );
  });

  it('preserves a nonbasic land printing rarity instead of calling it a Basic-land slot', () => {
    expect(forgeRarityCode(CHECKLAND)).toBe('R');
  });

  it('keeps a mana-less fetch activation without inventing an intrinsic mana ability', () => {
    const result = transpileCardScript(FETCH_LAND);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines.some((line) => line.startsWith('A:AB$ Mana'))).toBe(false);
    expect(result.value.lines).toEqual(
      expect.arrayContaining([
        'A:AB$ ChangeZone | Cost$ T Sac<1/CARDNAME> | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic | ChangeNum$ 1 | Hidden$ True | Tapped$ True | ShuffleNonMandatory$ True | SubAbility$ Act1Effect2 | SpellDescription$ Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Shuffle your library.',
        'SVar:Act1Effect2:DB$ Shuffle | Defined$ You',
      ]),
    );
  });
});
