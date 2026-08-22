import { describe, expect, it } from 'vitest';
import { COLORS } from '@mtg/dsl';
import {
  asFan,
  commonSlotsForColor,
  derivedCommonCreatureShare,
  isSkeletonKeyword,
  pinnedKeywordBudget,
  PLAY_BOOSTER_2024,
  rareMythicShares,
  skeletonCitation,
  SkeletonProfileDocumentSchema,
  skeletonData,
  totalCommonSlots,
  uncommonSlotsForColor,
  unpinnedKeywordNames,
} from '../src/index';

const doc = PLAY_BOOSTER_2024;
const data = skeletonData();

describe('play-booster-2024 profile document', () => {
  it('validates against its own schema when reparsed', () => {
    const result = SkeletonProfileDocumentSchema.safeParse(JSON.parse(JSON.stringify(doc)) as unknown);
    expect(result.success).toBe(true);
  });

  it('is versioned and dated', () => {
    expect(doc.version).toBe(1);
    expect(doc.profile).toBe('play-booster-2024');
    expect(doc.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has rarity counts that sum to the published total', () => {
    const { common, uncommon, rare, mythic, total } = data.setSize;
    expect(common).toBe(81);
    expect(uncommon).toBe(100);
    expect(rare).toBe(60);
    expect(mythic).toBe(20);
    expect(common + uncommon + rare + mythic).toBe(total);
    expect(total).toBe(261);
  });
});

describe('common slot arithmetic', () => {
  it('gives every color fifteen common slots', () => {
    for (const color of COLORS) {
      expect(commonSlotsForColor(color)).toBe(15);
    }
  });

  it('reconciles color plus colorless commons with the published set size', () => {
    expect(totalCommonSlots()).toBe(data.setSize.common);
  });

  it('has curve buckets summing to each color creature count', () => {
    for (const color of COLORS) {
      const profile = data.colors[color].common;
      const curveTotal = profile.creatureCurve.reduce((sum, bucket) => sum + bucket.count, 0);
      expect(curveTotal).toBe(profile.creatures);
    }
  });

  it('derives creature shares that disagree with the stated ones for B, R and G', () => {
    // The re-verification finding: the article states B/R/G percentages over a
    // denominator of 14 while its own slot tables give 15. The slot tables are
    // what sum to the published 81 commons, so the derived share is canonical.
    expect(derivedCommonCreatureShare('W')).toBeCloseTo(11 / 15, 10);
    expect(derivedCommonCreatureShare('U')).toBeCloseTo(8 / 15, 10);
    expect(derivedCommonCreatureShare('B')).toBeCloseTo(0.6, 10);
    expect(derivedCommonCreatureShare('R')).toBeCloseTo(0.6, 10);
    expect(derivedCommonCreatureShare('G')).toBeCloseTo(10 / 15, 10);

    expect(data.colors.B.common.creatureShare.stated).toBe(0.62);
    expect(data.colors.B.common.creatureShare.statedDenominator).toBe(14);
    expect(derivedCommonCreatureShare('B')).not.toBeCloseTo(data.colors.B.common.creatureShare.stated, 2);
  });

  it('collapses uncommon ranges to midpoints', () => {
    expect(uncommonSlotsForColor('W')).toBe(14);
    expect(uncommonSlotsForColor('U')).toBe(14);
    expect(uncommonSlotsForColor('B')).toBe(15);
    expect(uncommonSlotsForColor('R')).toBe(15);
    expect(uncommonSlotsForColor('G')).toBe(14);
  });
});

describe('keyword budgets', () => {
  it('only uses keyword names the schema recognizes', () => {
    for (const color of COLORS) {
      for (const name of Object.keys(data.colors[color].common.keywords)) {
        expect(isSkeletonKeyword(name)).toBe(true);
      }
    }
  });

  it('restricts white to the pinned slice vocabulary in canonical order', () => {
    expect(pinnedKeywordBudget('W')).toEqual([
      { keyword: 'flying', count: 3 },
      { keyword: 'vigilance', count: 2 },
      { keyword: 'lifelink', count: 1 },
      { keyword: 'firstStrike', count: 0.25 },
    ]);
    expect(unpinnedKeywordNames('W')).toEqual(['doubleStrike']);
  });

  it('drops blue keywords the slice engine cannot run', () => {
    expect(pinnedKeywordBudget('U')).toEqual([
      { keyword: 'flying', count: 3 },
      { keyword: 'vigilance', count: 1.5 },
    ]);
    expect(unpinnedKeywordNames('U').sort()).toEqual(['defender', 'flash', 'ward']);
  });

  it('keeps green haste at its fractional rotating-slot value', () => {
    const green = pinnedKeywordBudget('G');
    expect(green.find((entry) => entry.keyword === 'haste')).toEqual({ keyword: 'haste', count: 0.2 });
  });
});

describe('archetype and mechanic canon', () => {
  it('declares ten unique two-color pairs', () => {
    expect(data.archetypes.pairs).toHaveLength(10);
    expect(new Set(data.archetypes.pairs).size).toBe(10);
  });

  it('has a speed mix of three of each plus one flexible', () => {
    const { fast, medium, slow, flex } = data.archetypes.speedMix;
    expect([fast, medium, slow]).toEqual([3, 3, 3]);
    expect(flex).toBe(1);
    expect(fast + medium + slow + flex).toBe(data.archetypes.pairs.length);
  });

  it('has a novelty mix summing to the pair count', () => {
    const { novel, twist, traditional } = data.archetypes.noveltyMix;
    expect([novel, twist, traditional]).toEqual([2, 4, 4]);
    expect(novel + twist + traditional).toBe(data.archetypes.pairs.length);
  });

  it('bounds mechanic count at three to six', () => {
    expect(data.mechanics).toEqual({ min: 3, max: 6 });
  });

  it('places two signpost uncommons on each pair', () => {
    expect(data.multicolorUncommon.total).toBe(
      data.multicolorUncommon.perPair * data.archetypes.pairs.length,
    );
  });
});

describe('as-fan formula', () => {
  it('splits the rare-or-mythic slot six-to-one', () => {
    const shares = rareMythicShares();
    expect(shares.rare).toBeCloseTo(6 / 7, 10);
    expect(shares.mythic).toBeCloseTo(1 / 7, 10);
    expect(shares.rare + shares.mythic).toBeCloseTo(1, 10);
  });

  it('returns one copy per booster for a mechanic on a ninth of the commons', () => {
    expect(asFan({ common: 9 })).toBeCloseTo(1, 10);
  });

  it('keeps the removal density target and its era-legacy share separate', () => {
    expect(data.asFanTargets.removal).toBe(3);
    expect(data.asFanTargets.removalShareOfPack).toBe(0.2);

    // The 20% figure and the as-fan of 3 are both true, but of a 15-card draft
    // booster, not of this profile's 13-nonland-slot Play Booster model. The
    // citation records the mismatch so nobody silently derives one from the other.
    const draftBoosterCards = 15;
    expect(draftBoosterCards * data.asFanTargets.removalShareOfPack).toBeCloseTo(
      data.asFanTargets.removal,
      10,
    );
    const playBoosterNonlandSlots = data.booster.common + data.booster.uncommon + data.booster.rareOrMythic;
    expect(playBoosterNonlandSlots * data.asFanTargets.removalShareOfPack).toBeCloseTo(2.6, 10);
    expect(skeletonCitation('asFanTargets.removal')?.note).toContain('ERA MISMATCH');
  });

  it('is arithmetically consistent for a mixed-rarity mechanic', () => {
    // 7 commons / 7 uncommons / 3 rares. The source article's own worked example
    // prints 0.999 for the common term, which is 9/81 not 7/81 — see the
    // asFanTargets.mainMechanicMin citation note. We encode the formula, not
    // the example.
    const expected = (7 / 81) * 9 + (7 / 100) * 3 + (3 / 60) * (6 / 7);
    expect(asFan({ common: 7, uncommon: 7, rare: 3 })).toBeCloseTo(expected, 10);
  });

  it('treats a missing rarity as zero copies', () => {
    expect(asFan({})).toBe(0);
  });
});
