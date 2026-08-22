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
});
