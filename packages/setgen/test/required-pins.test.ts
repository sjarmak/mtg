import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CardKind } from '@mtg/dsl';
import type { CurveBucket, SkeletonLiteProfile } from '@mtg/design-data';
import { DEFAULT_SLICE_TARGET_SIZE, deriveSkeletonLite } from '@mtg/design-data';
import { createFixtureProvider } from '@mtg/llm';
import type {
  Allocation,
  GenerationResult,
  RequiredCardInput,
  Rng,
  SetBrief,
  SetBriefInput,
  Slot,
} from '@mtg/setgen';
import {
  allocateSlots,
  derivePins,
  generateSet,
  parseBrief,
  pinRequiredCards,
  reserveRequiredCards,
  slotId,
  UnplaceableRequiredCardsError,
} from '@mtg/setgen';
import { COLORLESS_MECHANIC, scriptedTransport, TEST_BRIEF } from './helpers';

/**
 * A required card can pin its rarity and its mana value.
 *
 * the set design document, decision 18 makes the named list the
 * required-cards input a brief carries, and the sentence that list is written in
 * is "Moonblade is a mythic four-drop". Name, pool and card kind carry the
 * first half of that sentence; rarity and cost are the rest of it.
 *
 * Both stay optional: a designer writes names first and details later (decision
 * 1, "the list leads"), so a brief that states neither has to allocate the set it
 * allocated before either pin existed. That no-op is the regression nobody would
 * notice, and it is pinned first below.
 */

const FLAGSHIP_SIZE = 250;

/**
 * A size the skeleton builds no rare group at.
 *
 * The rare tier is derived, not constant: `SLICE_RARITIES` carries it, and
 * `rarityBudget` prints it only where the pool seats the profile's
 * `rareCyclesMin` cycles. So "a rarity with no tier" is now a property of a
 * size rather than of the vocabulary, and the tests that measure a refusal say
 * which size they are measuring at.
 */
const TWO_TIER_SIZE = DEFAULT_SLICE_TARGET_SIZE;

function briefFor(requiredCards: readonly RequiredCardInput[], targetSize = FLAGSHIP_SIZE): SetBriefInput {
  return {
    ...TEST_BRIEF,
    targetSize,
    mechanics: [...TEST_BRIEF.mechanics, COLORLESS_MECHANIC],
    requiredCards: [...requiredCards],
  };
}

function allocate(requiredCards: readonly RequiredCardInput[], targetSize = FLAGSHIP_SIZE): Allocation {
  return allocateSlots(parseBrief(briefFor(requiredCards, targetSize)));
}

const baseline = allocate([]);

/** Cards per pool and cards per rarity: the census a pin may not move. */
function census(allocation: Allocation): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of allocation.slots) {
    const pool = `pool:${slot.color ?? 'colorless'}`;
    const rarity = `rarity:${slot.rarity}`;
    counts[pool] = (counts[pool] ?? 0) + 1;
    counts[rarity] = (counts[rarity] ?? 0) + 1;
  }
  return counts;
}

function reservedIn(allocation: Allocation): Slot[] {
  return allocation.slots.filter((slot) => slot.requiredCard !== undefined);
}

function named(count: number, card: Omit<RequiredCardInput, 'name'>, prefix = 'Named'): RequiredCardInput[] {
  return Array.from({ length: count }, (_unused, index) => ({
    ...card,
    name: `${prefix} Card ${index + 1}`,
  }));
}

describe('the brief boundary takes a rarity and a mana value', () => {
  it('carries both through to the parsed card', () => {
    const brief = parseBrief(briefFor([{ name: 'Moonblade', rarity: 'rare', manaValue: 4 }]));
    expect(brief.requiredCards[0]?.rarity).toBe('rare');
    expect(brief.requiredCards[0]?.manaValue).toBe(4);
  });

  // Typed as unknown on purpose: a brief arrives as JSON from a file or a CLI,
  // so the compiler is not the thing that keeps a bad pin out.
  it('refuses a rarity outside the DSL vocabulary', () => {
    const withRarity = (rarity: unknown): unknown => ({
      ...TEST_BRIEF,
      requiredCards: [{ name: 'Moonblade', rarity }],
    });
    expect(parseBrief(withRarity('mythic')).requiredCards[0]?.rarity).toBe('mythic');
    expect(() => parseBrief(withRarity('Common'))).toThrow();
  });

  it('refuses a mana value that is not a whole number of mana', () => {
    const withValue = (manaValue: unknown): unknown => ({
      ...TEST_BRIEF,
      requiredCards: [{ name: 'Moonblade', manaValue }],
    });
    expect(() => parseBrief(withValue(-1))).toThrow();
    expect(() => parseBrief(withValue(2.5))).toThrow();
    expect(() => parseBrief(withValue('4'))).toThrow();
  });

  it('takes zero, which is what the cheapest artifact in a set costs', () => {
    expect(parseBrief(briefFor([{ name: 'Bogslime Jelly', manaValue: 0 }])).requiredCards[0]?.manaValue).toBe(
      0,
    );
  });

  /**
   * Taking the number is not printing the card, and after `mtg-nhyv.79` that
   * distinction is the generator's whole free-spell rule.
   *
   * `@mtg/dsl` used to refuse a mana value of 0 outright as `MANA_COST_ZERO`,
   * which put a statement about what a *generator* prints inside the validator
   * that says what the *kernel* runs. The kernel runs it: it offers, pays and
   * resolves a {0} spell from a board with no mana at all
   * (`kernel/test/free-spell.test.ts`). So the refusal has to be here, and these
   * two pin it end to end - no slot in a whole allocation opens below 1, and a
   * brief that asks for a free card is refused by name with the card in the
   * message.
   */
  it('allocates no slot that would take a free card', () => {
    const floor = Math.min(...baseline.slots.map((slot) => slot.manaValueMin));
    expect(baseline.slots.length).toBeGreaterThan(0);
    expect(floor).toBeGreaterThanOrEqual(1);
  });

  it('refuses a pin at zero, because a pin narrows a window and never opens one', () => {
    expect(() => allocate([{ name: 'Bogslime Jelly', manaValue: 0 }])).toThrow(UnplaceableRequiredCardsError);
    expect(() => allocate([{ name: 'Bogslime Jelly', manaValue: 0 }])).toThrow(
      /"Bogslime Jelly" \(MV 0\): no slot in the set matches/,
    );
  });
});

describe('a list that states neither allocates the set it always allocated', () => {
  const bare = allocate(named(12, {}));

  it('leaves every slot exactly as the skeleton derived it', () => {
    expect(bare.slots.map(({ requiredCard: _unused, ...rest }) => rest)).toStrictEqual(baseline.slots);
  });

  it('leaves the reserved slots the cost windows the skeleton gave them', () => {
    const windows = reservedIn(bare).filter((slot) => slot.manaValueMin !== slot.manaValueMax);
    expect(windows.length).toBeGreaterThan(0);
  });
});

/**
 * The slot predicate, walked over slots this file builds rather than over a
 * derived skeleton: the question is which slot the pins pass over, and a
 * hand-built handful makes that the only thing in the frame.
 */
const unshuffled: Rng = () => 0.999999;

interface SeatInput {
  readonly rarity: 'common' | 'uncommon';
  readonly cardKind: CardKind;
  readonly manaValueMin: number;
  readonly manaValueMax: number;
}

function seat(index: number, input: SeatInput): Slot {
  return {
    id: slotId(input.rarity, 'R', index + 1),
    index,
    collectorNumber: index + 1,
    rarity: input.rarity,
    color: 'R',
    cardKind: input.cardKind,
    role: input.cardKind === 'creature' ? 'creature' : 'filler',
    manaValueMin: input.manaValueMin,
    manaValueMax: input.manaValueMax,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
}

function briefRequiring(requiredCards: SetBriefInput['requiredCards']): SetBrief {
  return parseBrief({ ...TEST_BRIEF, requiredCards });
}

describe('the slot predicate honors both pins', () => {
  const twoDrop = seat(0, { rarity: 'uncommon', cardKind: 'creature', manaValueMin: 2, manaValueMax: 2 });
  const commonFourDrop = seat(1, {
    rarity: 'common',
    cardKind: 'creature',
    manaValueMin: 4,
    manaValueMax: 4,
  });
  const fourDrop = seat(2, { rarity: 'uncommon', cardKind: 'creature', manaValueMin: 4, manaValueMax: 5 });

  it('passes over the wrong cost and the wrong rarity to reach the slot that is both', () => {
    const { slots } = pinRequiredCards(
      [twoDrop, commonFourDrop, fourDrop],
      briefRequiring([{ name: 'Moonblade', rarity: 'uncommon', manaValue: 4 }]),
      unshuffled,
    );
    expect(slots.map((slot) => slot.requiredCard?.name)).toStrictEqual([undefined, undefined, 'Moonblade']);
  });

  it('narrows the reserved slot to the stated cost, so the printed card owes it exactly', () => {
    const { slots } = pinRequiredCards(
      [fourDrop],
      briefRequiring([{ name: 'Moonblade', manaValue: 4 }]),
      unshuffled,
    );
    expect([slots[0]?.manaValueMin, slots[0]?.manaValueMax]).toStrictEqual([4, 4]);
  });

  it('leaves the window alone when the card states no cost', () => {
    const { slots } = pinRequiredCards([fourDrop], briefRequiring([{ name: 'Moonblade' }]), unshuffled);
    expect([slots[0]?.manaValueMin, slots[0]?.manaValueMax]).toStrictEqual([4, 5]);
  });

  it('names the card, its rarity and its cost when nothing matches', () => {
    expect(() =>
      pinRequiredCards(
        [twoDrop],
        briefRequiring([{ name: 'Moonblade', rarity: 'uncommon', cardKind: 'creature', manaValue: 4 }]),
        unshuffled,
      ),
    ).toThrow(/"Moonblade" \(uncommon creature MV 4\): no slot in the set matches/);
  });
});

describe('the skeleton derives with the stated rarity already subtracted', () => {
  const group = baseline.slots.filter((slot) => slot.rarity === 'uncommon' && slot.color === null);
  const derived = group.filter((slot) => slot.cardKind === 'artifact').length;
  // The whole group, rather than a fixed surplus over `derived`. The colorless
  // pool takes the indivisible remainder at every tier, so its size moves
  // whenever the rarity split does, and a hardcoded `derived + 4` outgrew the
  // uncommon colorless pool the day the rare tier took its share of the set.
  const wanted = group.length;
  const allocation = allocate(
    named(wanted, { color: 'colorless', cardKind: 'artifact', rarity: 'uncommon' }),
  );

  it('the skeleton alone allocates fewer uncommon artifact slots than the list names', () => {
    expect(derived).toBeLessThan(wanted);
  });

  it('reserves an uncommon colorless artifact for every named card', () => {
    const reserved = reservedIn(allocation);
    expect(reserved).toHaveLength(wanted);
    expect(
      reserved.every(
        (slot) => slot.rarity === 'uncommon' && slot.color === null && slot.cardKind === 'artifact',
      ),
    ).toBe(true);
  });

  it('buys them inside the uncommon half of the pool, so the census does not move', () => {
    expect(census(allocation)).toStrictEqual(census(baseline));
    expect(allocation.slots).toHaveLength(FLAGSHIP_SIZE);
  });

  it('says in a note which rarity it bought in and why', () => {
    expect(
      allocation.notes.some((note) => note.startsWith('uncommon colorless:') && note.includes('at uncommon')),
    ).toBe(true);
  });
});

describe('the skeleton derives with the stated mana value already subtracted', () => {
  const isFourDrop = (slot: Slot): boolean =>
    slot.color === 'R' &&
    slot.cardKind === 'creature' &&
    slot.rarity === 'uncommon' &&
    slot.manaValueMin <= 4 &&
    slot.manaValueMax >= 4;
  const derived = baseline.slots.filter(isFourDrop).length;
  const wanted = derived + 3;
  const allocation = allocate(
    named(wanted, { color: 'R', cardKind: 'creature', rarity: 'uncommon', manaValue: 4 }),
  );

  it('the skeleton alone allocates fewer uncommon red four-drops than the list names', () => {
    expect(derived).toBeLessThan(wanted);
  });

  it('seats every named card on an uncommon red creature costing exactly four', () => {
    const reserved = reservedIn(allocation);
    expect(reserved).toHaveLength(wanted);
    expect(
      reserved.every(
        (slot) =>
          slot.color === 'R' &&
          slot.rarity === 'uncommon' &&
          slot.cardKind === 'creature' &&
          slot.manaValueMin === 4 &&
          slot.manaValueMax === 4,
      ),
    ).toBe(true);
  });

  it('pays for them out of the same color and rarity, leaving the census alone', () => {
    expect(census(allocation)).toStrictEqual(census(baseline));
    expect(allocation.slots).toHaveLength(FLAGSHIP_SIZE);
  });

  it('keeps the uncommon red body count exactly where the skeleton put it', () => {
    const bodies = (source: Allocation): number =>
      source.slots.filter(
        (slot) => slot.color === 'R' && slot.rarity === 'uncommon' && slot.cardKind === 'creature',
      ).length;
    expect(bodies(allocation)).toBe(bodies(baseline));
  });

  it('says in a note which bucket gave the body up', () => {
    expect(
      allocation.notes.some(
        (note) => note.includes('moved to MV') && note.includes('names a creature at MV 4'),
      ),
    ).toBe(true);
  });
});

/**
 * Three sentences the derived skeleton is too well-behaved to put a question to.
 *
 * A 250-card profile's curve buckets happen to sort the same way by their cheap
 * end as by their dear end, and it allocates no group whose donor buckets tie.
 * So these run `reserveRequiredCards` against a profile with one group bent into
 * the shape that separates the readings, which is the only way the choice each
 * sentence describes is the thing being measured.
 */
function withRedUncommonCurve(creatureCurve: readonly CurveBucket[]): SkeletonLiteProfile {
  const profile = deriveSkeletonLite({ targetSize: FLAGSHIP_SIZE });
  const creatures = creatureCurve.reduce((sum, bucket) => sum + bucket.count, 0);
  return {
    ...profile,
    colors: {
      ...profile.colors,
      R: {
        ...profile.colors.R,
        uncommon: { ...profile.colors.R.uncommon, creatures, creatureCurve },
      },
    },
  };
}

function redUncommonCurve(profile: SkeletonLiteProfile): readonly CurveBucket[] {
  return profile.colors.R.uncommon.creatureCurve;
}

describe('the pass reads the curve the way the finished set will be measured', () => {
  it('spends the bucket that runs out soonest, so overlapping buckets seat both values', () => {
    const profile = withRedUncommonCurve([
      { mvMin: 1, mvMax: 3, count: 1 },
      { mvMin: 2, mvMax: 2, count: 1 },
    ]);
    const brief = parseBrief(
      briefFor([
        { name: 'Brigand', color: 'R', cardKind: 'creature', rarity: 'uncommon', manaValue: 2 },
        { name: 'Marauder', color: 'R', cardKind: 'creature', rarity: 'uncommon', manaValue: 3 },
      ]),
    );
    const reserved = reserveRequiredCards(profile, brief);

    expect(redUncommonCurve(reserved.profile)).toStrictEqual(redUncommonCurve(profile));
    expect(reserved.notes).toStrictEqual([]);
  });

  it('takes the body off the dearest bucket when two have the same to spare', () => {
    const profile = withRedUncommonCurve([
      { mvMin: 1, mvMax: 1, count: 1 },
      { mvMin: 3, mvMax: 3, count: 0 },
      { mvMin: 5, mvMax: 5, count: 1 },
    ]);
    const brief = parseBrief(
      briefFor([{ name: 'Direhorn', color: 'R', cardKind: 'creature', rarity: 'uncommon', manaValue: 3 }]),
    );

    expect(redUncommonCurve(reserveRequiredCards(profile, brief).profile)).toStrictEqual([
      { mvMin: 1, mvMax: 1, count: 1 },
      { mvMin: 3, mvMax: 3, count: 1 },
      { mvMin: 5, mvMax: 5, count: 0 },
    ]);
  });

  /**
   * The same demand at a tier the skeleton does build is bought, which is what
   * makes the untouched profile above a decision rather than an accident.
   */
  it('buys nothing at all for a rarity the skeleton builds no group for', () => {
    const profile = deriveSkeletonLite({ targetSize: TWO_TIER_SIZE });
    expect(profile.rarityTotals.rare).toBe(0);
    const gear = named(10, { color: 'colorless', cardKind: 'artifact' });
    const rare = parseBrief(
      briefFor(
        gear.map((card) => ({ ...card, rarity: 'rare' as const })),
        TWO_TIER_SIZE,
      ),
    );
    const uncommon = parseBrief(
      briefFor(
        gear.map((card) => ({ ...card, rarity: 'uncommon' as const })),
        TWO_TIER_SIZE,
      ),
    );

    expect(reserveRequiredCards(profile, rare).profile).toStrictEqual(profile);
    expect(reserveRequiredCards(profile, rare).notes).toStrictEqual([]);
    expect(reserveRequiredCards(profile, uncommon).notes.length).toBeGreaterThan(0);
  });
});

/**
 * The rare tier, from the brief's side.
 *
 * Moonblade is the case `mtg-bc2.26.4` was opened for: decision 5 puts
 * marquee gear in the colorless pool and decision 12 makes the named weapons
 * marquee cards, and until the skeleton derived a rare tier this brief
 * was refused by name. The refusal did not go away — it moved onto the set size,
 * which is where the derivation put it.
 */
describe('a required card can now be a rare', () => {
  const sword: RequiredCardInput = {
    name: 'Moonblade',
    color: 'colorless',
    cardKind: 'artifact',
    rarity: 'rare',
  };
  const allocation = allocate([sword]);

  it('seats it on a rare colorless artifact the skeleton derived', () => {
    const reserved = reservedIn(allocation);
    expect(reserved).toHaveLength(1);
    expect(reserved[0]?.rarity).toBe('rare');
    expect(reserved[0]?.color).toBeNull();
    expect(reserved[0]?.cardKind).toBe('artifact');
  });

  it('leaves the color balance and the rarity split where it found them', () => {
    expect(census(allocation)).toStrictEqual(census(baseline));
    expect(allocation.slots).toHaveLength(FLAGSHIP_SIZE);
  });

  it('gives the rare slots ids of their own, so a slot code still names one card', () => {
    const rares = allocation.slots.filter((slot) => slot.rarity === 'rare');
    expect(rares.length).toBeGreaterThan(0);
    expect(rares.every((slot) => slot.id.startsWith('R'))).toBe(true);
    expect(new Set(allocation.slots.map((slot) => slot.id)).size).toBe(allocation.slots.length);
  });
});

describe('what a pin will not buy', () => {
  it('refuses a rarity the generator has no tier for at this size, by name', () => {
    expect(deriveSkeletonLite({ targetSize: TWO_TIER_SIZE }).rarityTotals.rare).toBe(0);
    expect(() => allocate([{ name: 'Moonblade', rarity: 'rare' }], TWO_TIER_SIZE)).toThrow(
      /"Moonblade" \(rare\): no slot in the set matches/,
    );
  });

  it('refuses a mana value the color curve never allocated, rather than widening it', () => {
    expect(() =>
      allocate([{ name: 'Demon Dragon', color: 'R', cardKind: 'creature', manaValue: 9 }]),
    ).toThrow(/"Demon Dragon" \(R creature MV 9\): no slot in the set matches/);
  });

  it('refuses a combination whose parts each exist and whose whole does not', () => {
    expect(() =>
      allocate([{ name: 'Vantan Shield', color: 'colorless', cardKind: 'artifact', manaValue: 1 }]),
    ).toThrow(/"Vantan Shield" \(colorless artifact MV 1\): no slot in the set matches/);
  });

  it('refuses more cards at a rarity than that rarity holds', () => {
    const uncommons = baseline.slots.filter((slot) => slot.rarity === 'uncommon').length;
    expect(() => allocate(named(uncommons + 1, { rarity: 'uncommon' }))).toThrow(
      /the brief requires 1 card\(s\) the skeleton has no slot for/,
    );
  });
});

/** Findings that say the printed set does not match the skeleton it was built from. */
const SKELETON_CODES = [
  'CREATURE_SHARE_BAND',
  'CURVE_MISMATCH',
  'RARITY_DISTRIBUTION',
  'REQUIRED_CARD_MISSING',
  'SLOT_COLOR_MISMATCH',
  'SLOT_KIND_MISMATCH',
  'SLOT_MANA_VALUE_MISS',
  'SLOT_UNFILLED',
];

async function generate(requiredCards: readonly RequiredCardInput[]): Promise<GenerationResult> {
  const brief = parseBrief(briefFor(requiredCards));
  const allocation = allocateSlots(brief);
  const provider = createFixtureProvider({
    dir: mkdtempSync(join(tmpdir(), 'setgen-pins-')),
    record: true,
    delegate: scriptedTransport({ slots: allocation.slots }),
  });
  return generateSet({ provider, brief, critique: false, maxRetryRounds: 0 });
}

/**
 * Thirty pinned cards, spread the way the flagship list is spread: gear split
 * between uncommon and rare, monsters at common with a stated cost, bosses at
 * uncommon. The finished set still has to measure as the skeleton it was
 * derived from.
 *
 * The gear was six uncommons until the rare tier landed, and it stopped fitting:
 * the colorless pool holds the indivisible remainder at each tier, so its
 * uncommon half shrank as its rare half appeared. Splitting the gear is the
 * flagship's own shape rather than a repair — decision 5 puts marquee gear in
 * the colorless pool and decision 12 makes the named weapons marquee cards,
 * which is a rare-tier sentence.
 */
const THIRTY: readonly RequiredCardInput[] = [
  ...named(3, { color: 'colorless', cardKind: 'artifact', rarity: 'uncommon' }, 'Gear'),
  ...named(3, { color: 'colorless', cardKind: 'artifact', rarity: 'rare' }, 'Marquee Gear'),
  ...(['W', 'U', 'B', 'R', 'G'] as const).flatMap((color) =>
    named(4, { color, cardKind: 'creature', rarity: 'common', manaValue: 3 }, `${color} Monster`),
  ),
  ...(['W', 'U', 'B', 'R'] as const).flatMap((color) =>
    named(1, { color, cardKind: 'creature', rarity: 'uncommon' }, `${color} Boss`),
  ),
];

describe('thirty pinned cards leave the census where they found it', () => {
  const allocation = allocate(THIRTY);

  it('seats all thirty at the rarity, pool and cost each one stated', () => {
    const reserved = reservedIn(allocation);
    expect(reserved).toHaveLength(THIRTY.length);
    for (const slot of reserved) {
      const card = slot.requiredCard;
      expect(card).toBeDefined();
      if (card === undefined) continue;
      expect(slot.rarity).toBe(card.rarity);
      expect(slot.cardKind).toBe(card.cardKind);
      if (card.manaValue === undefined) continue;
      expect([slot.manaValueMin, slot.manaValueMax]).toStrictEqual([card.manaValue, card.manaValue]);
    }
  });

  it('moves neither the color balance nor the rarity split', () => {
    expect(census(allocation)).toStrictEqual(census(baseline));
    expect(allocation.slots).toHaveLength(FLAGSHIP_SIZE);
  });

  it('prints a set that still conforms to the skeleton it was derived from', async () => {
    const result = await generate(THIRTY);
    const offending = result.report.findings
      .filter((item) => SKELETON_CODES.includes(item.code))
      .map((item) => `${item.code}: ${item.message}`);
    expect(offending).toStrictEqual([]);

    const printed = new Set(result.cards.map((card) => card.name));
    expect(THIRTY.filter((card) => !printed.has(card.name))).toStrictEqual([]);
  });

  it('earns no kind of finding the same set without a list does not', async () => {
    const withPins = await generate(THIRTY);
    const without = await generate([]);
    const known = new Set(without.report.findings.map((item) => item.code));

    expect(
      [...new Set(withPins.report.findings.map((item) => item.code))].filter((code) => !known.has(code)),
    ).toStrictEqual([]);
  });
});

/**
 * The derivation over the pins, at more than one size.
 *
 * `mtg-mj5m`: a rarity hand-written for one set size refuses the whole brief at
 * another, because the skeleton derives its rare tier per size. `derivePins`
 * reads a stated rarity as a ceiling and seats the card at the highest tier at
 * or below it that this size holds, then gives up the mana value if no rarity on
 * the ladder seats the card with it. The flagship's own table lives beside its
 * brief; these are the properties, stated on cards this file invents.
 */
describe('derivePins seats a stated pin where the size can hold it', () => {
  const MARQUEE: readonly RequiredCardInput[] = [
    ...named(2, { color: 'colorless', cardKind: 'artifact', rarity: 'rare' }, 'Marquee Gear'),
    ...named(1, { color: 'R', cardKind: 'creature', rarity: 'rare', manaValue: 5 }, 'Boss'),
  ];

  function derivedAt(size: number, cards: readonly RequiredCardInput[] = MARQUEE): SetBrief {
    return derivePins(parseBrief(briefFor(cards, size))).brief;
  }

  it('leaves a brief alone when every stated pin fits', () => {
    const stated = parseBrief(briefFor(MARQUEE, FLAGSHIP_SIZE));
    const derived = derivePins(stated);
    expect(derived.notes).toStrictEqual([]);
    expect(derived.brief.requiredCards).toStrictEqual(stated.requiredCards);
  });

  it('seats a rare one tier down at a size with no rare tier, and names every move', () => {
    const derived = derivePins(parseBrief(briefFor(MARQUEE, TWO_TIER_SIZE)));
    expect(deriveSkeletonLite({ targetSize: TWO_TIER_SIZE }).rarityTotals.rare).toBe(0);
    expect(derived.brief.requiredCards.map((card) => card.rarity)).toStrictEqual([
      'uncommon',
      'uncommon',
      'uncommon',
    ]);
    expect(derived.notes).toHaveLength(3);
    expect(derived.notes.every((note) => note.includes('rarity rare -> uncommon'))).toBe(true);
  });

  it('treats engine-only mythic as a ceiling and keeps the generator inside slice tiers', () => {
    const derived = derivePins(
      parseBrief(briefFor([{ name: 'Mythic Reference', rarity: 'mythic', cardKind: 'creature' }])),
    );
    expect(derived.brief.requiredCards[0]?.rarity).toBe('rare');
    expect(derived.notes).toEqual([expect.stringContaining('rarity mythic -> rare')]);
    expect(allocateSlots(derived.brief).slots.map((slot) => slot.rarity)).not.toContain('mythic');
  });

  it('allocates at every size it derives for', () => {
    for (const size of [TWO_TIER_SIZE, 125, 200, FLAGSHIP_SIZE]) {
      expect(allocateSlots(derivedAt(size)).slots, `size ${size}`).toHaveLength(size);
    }
  });

  it('never promotes above the stated rarity', () => {
    // A common that will not fit is refused rather than printed at uncommon:
    // moving a card up is a design decision the brief did not make.
    const commons = named(200, { rarity: 'common', color: 'W', cardKind: 'creature' }, 'Filler');
    expect(() => derivePins(parseBrief(briefFor(commons, FLAGSHIP_SIZE)))).toThrow(
      UnplaceableRequiredCardsError,
    );
  });

  it('gives up the mana value only when no rarity on the ladder seats the card', () => {
    // A cost outside every bucket the pool has at any tier: the rarity ladder
    // runs out first, and what is left to give is the number. A cost some other
    // tier covers moves tier instead, which is the case above.
    const impossible = named(
      1,
      { color: 'G', cardKind: 'creature', rarity: 'rare', manaValue: 12 },
      'Colossus',
    );
    const derived = derivePins(parseBrief(briefFor(impossible, FLAGSHIP_SIZE)));
    const seated = derived.brief.requiredCards[0];
    expect(seated?.rarity).toBe('rare');
    expect(seated?.manaValue).toBeUndefined();
    expect(derived.notes[0]).toContain('mana value 12 -> unstated');
  });

  it('is a pure function of the brief and the size', () => {
    expect(derivedAt(FLAGSHIP_SIZE).requiredCards).toStrictEqual(derivedAt(FLAGSHIP_SIZE).requiredCards);
  });
});
