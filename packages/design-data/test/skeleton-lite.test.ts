import { describe, expect, it } from 'vitest';
import { apportion, COLORS, KEYWORDS, RARITIES } from '@mtg/dsl';
import {
  allGroupPlans,
  apportionPair,
  commonSlotsForColor,
  DEFAULT_SLICE_TARGET_SIZE,
  derivedCommonCreatureShare,
  derivedUncommonCreatureShare,
  deriveSkeletonLite,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  midpoint,
  rareMythicShares,
  roundHalfUp,
  seatFromTop,
  SKELETON_LITE,
  skeletonData,
  SLICE_RARITIES,
  totalSliceCards,
  totalSliceCreatures,
  totalSliceSpells,
  uncommonSlotsForColor,
} from '../src/index';
import type { SliceRarity } from '../src/index';

describe('the profile roundings', () => {
  it('rounds halves up and averages ranges', () => {
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(1.49)).toBe(1);
    expect(midpoint(6, 7)).toBe(6.5);
    expect(apportionPair(5, [1, 1])).toEqual([3, 2]);
  });
});

describe('skeleton-lite derivation', () => {
  const profile = SKELETON_LITE;

  it('is derived from the versioned play-booster profile, not hand-written', () => {
    expect(profile.profile).toBe('skeleton-lite');
    expect(profile.derivedFrom).toEqual({
      profile: 'play-booster-2024',
      version: 1,
      verifiedOn: '2026-08-09',
    });
    expect(profile.derivation.length).toBeGreaterThan(5);
  });

  it('allocates exactly the target set size', () => {
    expect(profile.setSize).toBe(DEFAULT_SLICE_TARGET_SIZE);
    expect(totalSliceCards(profile)).toBe(profile.setSize);
    expect(totalSliceCreatures(profile) + totalSliceSpells(profile)).toBe(profile.setSize);
  });

  it('splits rarities by booster slot weighting', () => {
    expect(profile.rarityTotals).toEqual({ common: 68, uncommon: 22, rare: 0 });
    expect(SLICE_RARITIES.reduce((sum, rarity) => sum + profile.rarityTotals[rarity], 0)).toBe(
      profile.setSize,
    );
  });

  it('holds the five colors exactly equal at each rarity', () => {
    expect(profile.perColorCards).toEqual({ common: 13, uncommon: 4, rare: 0 });
    for (const color of COLORS) {
      for (const rarity of SLICE_RARITIES) {
        expect(profile.colors[color][rarity].cards, `${color}/${rarity}`).toBe(profile.perColorCards[rarity]);
      }
    }
  });

  it('puts the indivisible remainder in the colorless pool', () => {
    expect(profile.colorless.common.cards).toBe(3);
    expect(profile.colorless.uncommon.cards).toBe(2);
    for (const rarity of SLICE_RARITIES) {
      const colored = profile.perColorCards[rarity] * COLORS.length;
      expect(colored + profile.colorless[rarity].cards).toBe(profile.rarityTotals[rarity]);
    }
  });

  it('keeps every group internally consistent', () => {
    for (const plan of allGroupPlans(profile)) {
      expect(plan.creatures + plan.spells).toBe(plan.cards);
      expect(plan.creatureCurve.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(plan.creatures);
      expect(plan.spellRoles).toHaveLength(plan.spells);
      const keywordTotal = plan.keywords.reduce((sum, entry) => sum + entry.count, 0);
      expect(keywordTotal).toBeLessThanOrEqual(plan.creatures);
      expect(plan.keywords.every((entry) => Number.isInteger(entry.count) && entry.count >= 0)).toBe(true);
    }
  });

  it('carries the play-booster creature bias into each color', () => {
    expect(profile.colors.W.common).toMatchObject({ creatures: 10, spells: 3 });
    expect(profile.colors.U.common).toMatchObject({ creatures: 7, spells: 6 });
    expect(profile.colors.B.common).toMatchObject({ creatures: 8, spells: 5 });
    expect(profile.colors.R.common).toMatchObject({ creatures: 8, spells: 5 });
    expect(profile.colors.G.common).toMatchObject({ creatures: 9, spells: 4 });
    // White stays the densest creature color and blue the thinnest, matching
    // the profile's 73% / 53% ordering.
    const shares = COLORS.map((color) => profile.colors[color].common.creatures);
    expect(Math.max(...shares)).toBe(profile.colors.W.common.creatures);
    expect(Math.min(...shares)).toBe(profile.colors.U.common.creatures);
  });

  it('scales keyword budgets into whole slots inside the pinned vocabulary', () => {
    expect(profile.colors.W.common.keywords).toEqual([
      { keyword: 'flying', count: 3 },
      { keyword: 'vigilance', count: 2 },
      { keyword: 'lifelink', count: 1 },
      { keyword: 'firstStrike', count: 0 },
    ]);
    const pinned = new Set<string>(KEYWORDS);
    for (const plan of allGroupPlans(profile)) {
      for (const entry of plan.keywords) {
        expect(pinned.has(entry.keyword)).toBe(true);
      }
    }
    expect(profile.derivation.some((note) => note.includes('doubleStrike'))).toBe(true);
  });

  it('takes spell roles from the profile slot list in order', () => {
    expect(profile.colors.W.common.spellRoles).toEqual([
      'removalCombatConditional',
      'removalExile',
      'combatTrick',
    ]);
    expect(profile.colors.G.common.spellRoles).toEqual([
      'fight',
      'bite',
      'combatTrickPump',
      'manaAcceleration',
    ]);
  });

  it('keeps the ten color pairs as matchups but prints no gold cards', () => {
    expect(profile.archetypePairs).toHaveLength(10);
    expect(profile.derivation.some((note) => note.includes('No multicolor slots'))).toBe(true);
  });

  it('overrides the NWO budget to 0.35, widening the source profile', () => {
    // `NWO_RED_FLAG_BUDGET` (this file's own override, not a passthrough of
    // `doc.data.complexity.nwoRedFlagBudget`) — see its docblock for why a
    // per-card-priced validator needs more room than the article's board-level
    // figure.
    expect(profile.nwoRedFlagBudget).toBe(0.35);
  });
});

/**
 * Sizes the derivation accepts, walked wherever a claim is made about all of
 * them. Both ends are the derivation's own: `MIN_SLICE_TARGET_SIZE` is where
 * the uncommon pool stops giving every color a card, `MAX_SLICE_TARGET_SIZE` is
 * the source profile's set size. A claim walked over this list is a claim about
 * every set `deriveSkeletonLite` will build, not about the sizes this file
 * happened to try.
 */
const LEGAL_SIZES = Array.from(
  { length: MAX_SLICE_TARGET_SIZE - MIN_SLICE_TARGET_SIZE + 1 },
  (_unused, index) => MIN_SLICE_TARGET_SIZE + index,
);

describe('the third tier, and the size that earns it', () => {
  const cycles = skeletonData().rarityRules.rareCyclesMin;

  it('prints every rarity the DSL is willing to carry', () => {
    expect([...SLICE_RARITIES]).toEqual(['common', 'uncommon', 'rare']);
    const printed = new Set<string>(SLICE_RARITIES);
    expect(RARITIES.filter((rarity) => !printed.has(rarity))).toEqual(['mythic']);
  });

  it('keeps every per-rarity record keyed by the tier list at every legal size', () => {
    for (const size of [MIN_SLICE_TARGET_SIZE, DEFAULT_SLICE_TARGET_SIZE, 200, 250]) {
      const derived = deriveSkeletonLite({ targetSize: size });
      const printed = [...SLICE_RARITIES].sort();
      expect(Object.keys(derived.rarityTotals).sort(), `size ${String(size)}`).toEqual(printed);
      expect(Object.keys(derived.perColorCards).sort(), `size ${String(size)}`).toEqual(printed);
      expect(Object.keys(derived.colorless).sort(), `size ${String(size)}`).toEqual(printed);
      for (const color of COLORS) {
        expect(Object.keys(derived.colors[color]).sort(), `size ${String(size)} ${color}`).toEqual(printed);
      }
    }
  });

  /**
   * The flagship number. the set design document, decision 3 asks
   * for roughly 250 cards, and decisions 8 and 12 make the named parts and the
   * named weapons the marquee cards; marquee gear is colorless (decision 5).
   * How many weapons the document does not settle - decision 12 says roughly
   * eight and the card list at line 96 says fifteen - and this assertion does
   * not need it settled. So the claim is not only that rares exist but that
   * four of them are in the pool Moonblade would be printed in.
   */
  it('gives a 250-card set a rare tier the marquee cards can live in', () => {
    const flagship = deriveSkeletonLite({ targetSize: 250 });
    expect(flagship.rarityTotals.rare).toBe(19);
    expect(flagship.perColorCards.rare).toBe(3);
    expect(flagship.colorless.rare.cards).toBe(4);
    expect(totalSliceCards(flagship)).toBe(250);
  });

  /**
   * The 9:3:1 split is the whole of the rare share, so the two tiers below it
   * shrink by exactly what the third one took. Nothing is invented and nothing
   * is lost.
   */
  it('pays for the rare tier out of the commons and uncommons, not out of the set size', () => {
    const flagship = deriveSkeletonLite({ targetSize: 250 });
    const twoTier = deriveSkeletonLite({ targetSize: DEFAULT_SLICE_TARGET_SIZE });
    expect(twoTier.rarityTotals.rare).toBe(0);
    expect(flagship.rarityTotals.common + flagship.rarityTotals.uncommon).toBe(250 - 19);
  });

  /**
   * The floor is the profile's, not a number chosen here: `rareCyclesMin` is
   * transcribed from Nuts & Bolts with its quote and its INFERRED marker, and a
   * tier that cannot seat that many cycles is folded back rather than printed
   * thin. Invert either half of the condition in `rarityBudget` and this fails.
   */
  it('prints a rare tier only where it seats the profile floor of cycles', () => {
    for (const size of LEGAL_SIZES) {
      const derived = deriveSkeletonLite({ targetSize: size });
      const perColor = derived.perColorCards.rare;
      const label = `size ${String(size)}`;
      if (derived.rarityTotals.rare === 0) {
        expect(perColor, label).toBe(0);
        expect(derived.colorless.rare.cards, label).toBe(0);
        continue;
      }
      expect(perColor, label).toBeGreaterThanOrEqual(cycles);
      expect(perColor * COLORS.length + derived.colorless.rare.cards, label).toBe(derived.rarityTotals.rare);
    }
  });

  /**
   * The tier is not monotonic in set size, and saying so is better than
   * implying a line the arithmetic does not draw. Largest remainder gives 123
   * cards ten rares, two per color; 124 cards nine, one per color, under the
   * floor; 125 cards ten again. One size in the whole accepted range falls into
   * that hole and it is 124.
   */
  it('drops the tier at 124 and prints it either side, which is what apportionment does', () => {
    expect(deriveSkeletonLite({ targetSize: 123 }).rarityTotals.rare).toBe(10);
    expect(deriveSkeletonLite({ targetSize: 124 }).rarityTotals.rare).toBe(0);
    expect(deriveSkeletonLite({ targetSize: 125 }).rarityTotals.rare).toBe(10);
    const noTier = LEGAL_SIZES.filter(
      (size) => deriveSkeletonLite({ targetSize: size }).rarityTotals.rare === 0,
    );
    expect(noTier.filter((size) => size > 122)).toEqual([124]);
  });

  /**
   * The one thing the derivation notes mark INFERRED about this tier: a rare
   * group is cut to the uncommon shape, not the common one. Nothing else in the
   * suite reads a rare group's insides, so the inference was a sentence with no
   * assertion under it.
   */
  it('cuts each rare group to the uncommon creature share, not the common one', () => {
    const flagship = deriveSkeletonLite({ targetSize: 250 });
    for (const color of COLORS) {
      const rare = flagship.colors[color].rare;
      expect(rare.creatures, `${color} rare`).toBe(
        roundHalfUp(rare.cards * derivedUncommonCreatureShare(color)),
      );
    }
    // Blue is where the two shares disagree over three cards, so the loop above
    // is not the same assertion five times: cut to the common share this group
    // would print two creatures and one spell.
    expect(flagship.colors.U.rare).toMatchObject({ cards: 3, creatures: 1, spells: 2 });
    expect(roundHalfUp(3 * derivedCommonCreatureShare('U'))).toBe(2);
    // Curve, keyword table and spell-slot list come off the color's common
    // tables, which is the rest of that note.
    expect(flagship.colors.U.rare.spellRoles).toEqual(['protectiveInstant', 'counterspell']);
  });

  it('says in a derivation note which of the two it did, and why', () => {
    const [thin] = deriveSkeletonLite({ targetSize: DEFAULT_SLICE_TARGET_SIZE }).derivation.filter((note) =>
      note.startsWith('Rare tier:'),
    );
    const [full] = deriveSkeletonLite({ targetSize: 250 }).derivation.filter((note) =>
      note.startsWith('Rare tier:'),
    );
    expect(thin).toContain('none');
    expect(thin).toContain(`rareCyclesMin of ${String(cycles)}`);
    expect(full).toContain('19 cards');
    expect(full).toContain('9:3:1');
  });
});

/**
 * `mtg-dkgd`: the colorless pool is a sixth pool, not a rounding error.
 *
 * The set owner found this by playing the flagship. A 253-card build printed
 * fifteen common artifacts, three uncommon and no rare at all, so the marquee
 * weapons the design of record calls for had nowhere to land and a legendary
 * sword the brief asked for at rare came out common (`mtg-pnc0`). The cause was
 * the order the two shares were taken in: the colored nominal rounded up to a
 * whole card per color and colorless kept whatever survived, which at 42 of the
 * tiers in the legal range was nothing.
 *
 * What follows is the fix stated as behavior rather than as arithmetic, so it
 * still means something if the arithmetic is rewritten. The sizes are named
 * where a person cares about them and swept where the claim is about all of
 * them.
 */
describe('what the colorless pool is owed', () => {
  const cycles = skeletonData().rarityRules.rareCyclesMin;

  /**
   * The two sizes the flagship is actually built at. 253 is the committed
   * fixture and 261 is `MAX_SLICE_TARGET_SIZE`; both printed zero rare
   * artifacts before this, which is the defect as it was reported.
   */
  it('gives the flagship sizes a colorless rare tier the weapons can land in', () => {
    for (const size of [253, MAX_SLICE_TARGET_SIZE]) {
      const derived = deriveSkeletonLite({ targetSize: size });
      const label = `size ${String(size)}`;
      expect(derived.rarityTotals.rare, label).toBeGreaterThan(0);
      expect(derived.colorless.rare.cards, label).toBe(5);
      expect(derived.perColorCards.rare, label).toBe(3);
      expect(totalSliceCards(derived), label).toBe(size);
    }
  });

  /**
   * The recorded runs. Two committed fixtures replay against the 75-card
   * build and the Tideglass Reach fixtures replay against the default, and a
   * derivation that moved either would cost a re-record of a paid run. The
   * guard is written to bind only where a pool is starved, so neither moves.
   */
  it('leaves the sizes the recorded fixtures were built at exactly where they were', () => {
    const small = deriveSkeletonLite({ targetSize: 75 });
    expect(small.perColorCards).toEqual({ common: 10, uncommon: 3, rare: 0 });
    expect(small.colorless.common.cards).toBe(6);
    expect(small.colorless.uncommon.cards).toBe(4);

    const slice = deriveSkeletonLite({ targetSize: DEFAULT_SLICE_TARGET_SIZE });
    expect(slice.perColorCards).toEqual({ common: 13, uncommon: 4, rare: 0 });
    expect(slice.colorless.common.cards).toBe(3);
    expect(slice.colorless.uncommon.cards).toBe(2);
  });

  /**
   * How many cards of a tier the profile means for the colorless pool, read off
   * the same numbers the derivation reads. The rare tier is weighted by the
   * uncommon table because the profile publishes no rare slot table, which is
   * the inference `DERIVATION_NOTES` already marks.
   */
  function colorlessShareOf(rarity: SliceRarity, total: number): number {
    const data = skeletonData();
    const colorless =
      rarity === 'common'
        ? data.colorless.common.creatures + data.colorless.common.spells
        : data.colorless.uncommon.creatures +
          midpoint(data.colorless.uncommon.noncreaturesMin, data.colorless.uncommon.noncreaturesMax);
    const slotsFor = rarity === 'common' ? commonSlotsForColor : uncommonSlotsForColor;
    const colored = COLORS.reduce((sum, color) => sum + slotsFor(color), 0);
    return (total * colorless) / (colored + colorless);
  }

  /**
   * The invariant, swept over every size the derivation accepts, in both
   * directions. A tier owed a whole card always prints one, which is the bug
   * fixed; a tier that prints none is always one too small to be owed one,
   * which is the only reason left. Before this the first half failed at 42
   * tiers, every size the flagship builds at among them.
   *
   * The tiers that still print none are real and worth naming: a rare tier is
   * ten cards at every size from 123 to 137 and the profile owes colorless
   * 0.94 of a card there, so it gets none. Paying it one anyway would leave
   * nine cards for five colors, one rare per color, under the profile's own
   * `rareCyclesMin` — the tier would stop existing to buy a single artifact.
   */
  it('prints a colorless card in every tier that is owed one, and only starves tiers owed none', () => {
    const starved: string[] = [];
    for (const size of LEGAL_SIZES) {
      const derived = deriveSkeletonLite({ targetSize: size });
      for (const rarity of SLICE_RARITIES) {
        const total = derived.rarityTotals[rarity];
        if (total === 0) continue;
        const label = `size ${String(size)} ${rarity}`;
        const owed = colorlessShareOf(rarity, total);
        if (owed >= 1) {
          expect(derived.colorless[rarity].cards, `${label} owed ${owed.toFixed(2)}`).toBeGreaterThanOrEqual(
            1,
          );
          continue;
        }
        if (derived.colorless[rarity].cards === 0) starved.push(label);
      }
    }
    expect(starved.every((label) => label.endsWith('rare') || label.endsWith('uncommon'))).toBe(true);
    // The 123..137 rare tiers, and only those, once the sizes below 75 are set
    // aside — no set this repo builds is smaller than the 75-card fixture.
    const big = starved.filter((label) => Number(label.split(' ')[1]) >= 75);
    expect(big).toHaveLength(13);
    expect(big.every((label) => label.endsWith('rare'))).toBe(true);
    expect(Math.floor((10 - 1) / COLORS.length)).toBeLessThan(cycles);
  });
});

/**
 * The fourth tier, priced rather than argued.
 *
 * `mtg-bc2.26.8` wants mythic. Whether the *skeleton* allocates one is settled
 * here instead of in a docblock: the profile splits its single rare-or-mythic
 * booster slot by `mythicOneInN`, so a mythic tier is that share of the rare
 * tier, and at no size the derivation accepts does that reach one card per
 * color — let alone the `rareCyclesMin` cycles the rare tier itself has to
 * clear. Raise `mythicOneInN` toward 1 in the profile and this fails, which is
 * the only thing that could make the answer different.
 *
 * "At no size the derivation accepts" is load-bearing and is measured twice:
 * once over every accepted size, and once against the size where the
 * arithmetic would turn, which is 448 cards and which the derivation refuses.
 */
describe('the tier the skeleton would not allocate', () => {
  it('cannot seat one mythic cycle at any legal target size', () => {
    const share = rareMythicShares().mythic;
    const floor = COLORS.length * skeletonData().rarityRules.rareCyclesMin;
    for (const size of LEGAL_SIZES) {
      const rare = deriveSkeletonLite({ targetSize: size }).rarityTotals.rare;
      expect(Math.floor(rare * share), `size ${String(size)}`).toBeLessThan(COLORS.length);
      expect(Math.floor(rare * share), `size ${String(size)}`).toBeLessThan(floor);
    }
  });

  /**
   * And the ceiling that makes the claim above a claim was not fitted to it.
   * Running the same booster weights past the ceiling, a seventh of the rare
   * tier first reaches a full color cycle at 448 cards, 187 past the largest
   * set the derivation will build.
   */
  it('would seat one at 448 cards, a size the derivation refuses', () => {
    const { booster } = skeletonData();
    const weights = [booster.common, booster.uncommon, booster.rareOrMythic];
    const share = rareMythicShares().mythic;
    const seatsACycle = (size: number): boolean => {
      const [, , rare = 0] = apportion(size, weights);
      return Math.floor(rare * share) >= COLORS.length;
    };
    const scanned = Array.from({ length: 2000 }, (_unused, index) => MIN_SLICE_TARGET_SIZE + index);
    expect(scanned.find(seatsACycle)).toBe(448);
    expect(MAX_SLICE_TARGET_SIZE).toBeLessThan(448);
    expect(() => deriveSkeletonLite({ targetSize: 448 })).toThrow(RangeError);
  });
});

describe('derivation determinism and range', () => {
  it('produces byte-identical output for identical inputs', () => {
    const first = deriveSkeletonLite();
    const second = deriveSkeletonLite({ targetSize: DEFAULT_SLICE_TARGET_SIZE });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(SKELETON_LITE));
  });

  it('sums to the requested size at any legal target', () => {
    for (const size of LEGAL_SIZES) {
      const derived = deriveSkeletonLite({ targetSize: size });
      expect(totalSliceCards(derived), `size ${size}`).toBe(size);
      for (const plan of allGroupPlans(derived)) {
        expect(plan.creatures + plan.spells, `size ${size}`).toBe(plan.cards);
        expect(
          plan.creatureCurve.reduce((sum, bucket) => sum + bucket.count, 0),
          `size ${size}`,
        ).toBe(plan.creatures);
        expect(plan.spellRoles.length, `size ${size}`).toBe(plan.spells);
      }
    }
  });

  it('refuses a target too small to give every color a card', () => {
    expect(() => deriveSkeletonLite({ targetSize: MIN_SLICE_TARGET_SIZE - 1 })).toThrow(RangeError);
    expect(() => deriveSkeletonLite({ targetSize: 90.5 })).toThrow(RangeError);
  });

  /**
   * And a target the source profile does not describe. Every count here is one
   * printed set's shape redistributed onto a smaller target; a larger target
   * hands the booster weights a set the document never measured, which is
   * extrapolation wearing an apportionment's clothes.
   */
  it('refuses a target larger than the profile it derives from', () => {
    expect(MAX_SLICE_TARGET_SIZE).toBe(skeletonData().setSize.total);
    expect(deriveSkeletonLite({ targetSize: MAX_SLICE_TARGET_SIZE }).setSize).toBe(MAX_SLICE_TARGET_SIZE);
    expect(() => deriveSkeletonLite({ targetSize: MAX_SLICE_TARGET_SIZE + 1 })).toThrow(RangeError);
  });
});

/**
 * Where a tier too small for its curve loses its buckets.
 *
 * Largest-remainder apportionment keeps the buckets with the biggest counts,
 * which for a two-creature group means two copies of the color's most common
 * mana value. That is the right answer for a group with no special brief and the
 * wrong one for the group `rarityRules.bombsMinRarity` names, and at 250 cards
 * it was what the whole rare tier got.
 */
describe('the walk that seats a total too small for its list', () => {
  it('fills from the last entry down and drops the front', () => {
    expect(seatFromTop(1, [1, 3, 3, 2])).toStrictEqual([0, 0, 0, 1]);
    expect(seatFromTop(2, [1, 3, 3, 2])).toStrictEqual([0, 0, 0, 2]);
    expect(seatFromTop(3, [1, 3, 3, 2])).toStrictEqual([0, 0, 1, 2]);
  });

  it('never seats more than an entry holds', () => {
    expect(seatFromTop(4, [2, 1, 1])).toStrictEqual([2, 1, 1]);
  });

  /**
   * The remainder branch. Both callers gate on a total smaller than the list,
   * so it is unreachable while every capacity is at least one; it exists
   * because a total function needs an answer, and the answer is the end the
   * rule protects rather than a dropped card.
   */
  it('puts a total the capacities cannot hold on the last entry', () => {
    expect(seatFromTop(5, [1, 1])).toStrictEqual([1, 4]);
    expect(seatFromTop(3, [])).toStrictEqual([]);
    expect(seatFromTop(0, [1, 2])).toStrictEqual([0, 0]);
  });

  /**
   * `@mtg/setgen`'s spell curve walks the same function, and a body converted
   * out of a bomb-tier spell slot crosses from that curve to this one. Two
   * copies of the walk would be two answers meeting on one card, so this checks
   * the creature curve is the walk rather than a second implementation of it.
   */
  it('is the walk the creature curve is seated by', () => {
    const template = skeletonData().colors.W.common.creatureCurve;
    const rare = deriveSkeletonLite({ targetSize: 250 }).colors.W.rare;
    expect(rare.creatures).toBeLessThan(template.length);
    expect(rare.creatureCurve.map((bucket) => bucket.count)).toStrictEqual(
      seatFromTop(
        rare.creatures,
        template.map((bucket) => bucket.count),
      ),
    );
  });
});

describe('the bomb tier is seated at the top of its curve', () => {
  const flagship = deriveSkeletonLite({ targetSize: 250 });

  it('gives each rare group the expensive end of its color own curve', () => {
    for (const color of COLORS) {
      const rare = flagship.colors[color].rare;
      const seated = rare.creatureCurve.filter((bucket) => bucket.count > 0);
      expect(seated.length, `${color} rare`).toBeGreaterThan(0);
      // Every seated bucket is at the top of the curve: nothing below a seated
      // bucket is seated, which is the whole shape of "from the top down".
      const lastEmpty = rare.creatureCurve.findLastIndex((bucket) => bucket.count === 0);
      const firstSeated = rare.creatureCurve.findIndex((bucket) => bucket.count > 0);
      expect(lastEmpty, `${color} rare`).toBeLessThan(firstSeated);
      // And the tier is genuinely expensive, which is the point of the change.
      const cheapest = rare.creatureCurve.find((bucket) => bucket.count > 0)?.mvMin ?? 0;
      expect(cheapest, `${color} rare`).toBeGreaterThanOrEqual(3);
    }
  });

  it('seats every card the group has, and no more', () => {
    for (const color of COLORS) {
      const rare = flagship.colors[color].rare;
      const seated = rare.creatureCurve.reduce((sum, bucket) => sum + bucket.count, 0);
      expect(seated, `${color} rare`).toBe(rare.creatures);
    }
  });

  /** The tiers the rule does not name keep the apportionment they always had. */
  it('leaves the tiers below the rule exactly where they were', () => {
    for (const color of COLORS) {
      const template = skeletonData().colors[color].common.creatureCurve;
      for (const tier of ['common', 'uncommon'] as const) {
        const group = flagship.colors[color][tier];
        const expected = apportion(
          group.creatures,
          template.map((bucket) => bucket.count),
        );
        expect(
          group.creatureCurve.map((bucket) => bucket.count),
          `${color} ${tier}`,
        ).toEqual(expected);
      }
    }
  });

  /**
   * The gate that keeps the change off every committed set: the sizes with no
   * rare tier are byte-identical, because the rule only ever reaches a group at
   * or above `bombsMinRarity` and those sizes allocate none.
   */
  it('changes nothing at a size that prints no rare tier', () => {
    const slice = deriveSkeletonLite({ targetSize: DEFAULT_SLICE_TARGET_SIZE });
    expect(slice.rarityTotals.rare).toBe(0);
    for (const color of COLORS) {
      expect(slice.colors[color].rare.creatures).toBe(0);
      expect(slice.colors[color].rare.creatureCurve.every((bucket) => bucket.count === 0)).toBe(true);
    }
  });
});
