import { describe, expect, it } from 'vitest';
import { parseCard, setBasics } from '@mtg/dsl';
import { buildDeck } from '@mtg/deckbuild';
import { makeSyntheticPool } from './helpers/pool';

const DUAL = parseCard({
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

describe('nonbasic lands in Limited deck construction', () => {
  it('retains an opened on-pair dual as one land and two mana sources without treating it as Basic', () => {
    const pool = [DUAL, ...makeSyntheticPool(43, { palette: ['B', 'R'], setCode: 'M13' })];
    const result = buildDeck(pool);

    expect(result.colorPair).toEqual(['B', 'R']);
    expect(result.lands).toHaveLength(result.config.landCount);
    expect(result.lands.filter((card) => card.id === DUAL.id)).toHaveLength(1);
    expect(result.manaBase.reports.find((report) => report.color === 'B')?.sources).toBeGreaterThanOrEqual(1);
    expect(result.manaBase.reports.find((report) => report.color === 'R')?.sources).toBeGreaterThanOrEqual(1);
    expect(result.manaBase.landsByColor.B + result.manaBase.landsByColor.R).toBe(result.lands.length - 1);
    expect(result.manaBase.sourcesByColor.B + result.manaBase.sourcesByColor.R).toBeGreaterThan(
      result.lands.length,
    );
    expect(DUAL.supertypes).not.toContain('basic');
    expect(setBasics(pool).some((card) => card.id === DUAL.id)).toBe(false);
  });

  it('does not synthesize extra copies of an opened nonbasic land', () => {
    const pool = [DUAL, ...makeSyntheticPool(43, { palette: ['B', 'R'], setCode: 'M13' })];
    const first = buildDeck(pool);
    const second = buildDeck([...pool]);
    expect(first.lands.map((card) => card.id)).toEqual(second.lands.map((card) => card.id));
    expect(first.lands.filter((card) => card.id === DUAL.id)).toHaveLength(1);
  });
});
