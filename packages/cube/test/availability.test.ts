/**
 * Drafting the finished list, which is the only thing that answers the question
 * the census cannot: will the archetype be there when the pod drafts this?
 *
 * The fixture is two deep colors, one color in the list but in no archetype, and
 * one color the list barely holds. That shape is what makes the measurement
 * falsifiable rather than merely produced: a predicate that ignores an
 * archetype's colors reports the same number for green as for azorius, and a
 * predicate that never checks whether the drafted cards make a deck reports
 * green at every seat.
 */
import { describe, expect, it } from 'vitest';
import { buildDeck } from '@mtg/deckbuild';
import { DEFAULT_PACKS_PER_SEAT, draftedPools, runDraft } from '@mtg/draft-export';
import {
  cubeBoosterRecipe,
  DEFAULT_AVAILABILITY_DRAFTS,
  DEFAULT_AVAILABILITY_SEED,
  measureAvailability,
} from '../src/availability';
import type { ArchetypeAvailability, AvailabilityMeasured, CubeAvailability } from '../src/availability';
import type { CubeCriteriaInput } from '../src/criteria';
import type { GeneratedSet } from '../src/set-pool';
import { candidateFromDslCard } from '../src/set-pool';
import { fixtureCriteria, fixturePool, balancedCube } from './support/fixture-cube';
import {
  CARDS_PER_FULL_COLOR,
  DRAFTABLE_SET,
  draftableCriteria,
  draftableEntries,
  draftablePool,
  draftableSet,
} from './support/draftable-cube';
import { validateCube } from '../src/validate';

/**
 * Three drafts rather than the default twenty-five: every case here asks whether
 * the measurement is *made* correctly, which three answers as well as
 * twenty-five and in a fifth of the time. The one case that needs a stable share
 * says so where it stands.
 */
const DRAFTS = 3;

const CRITERIA = draftableCriteria();
const ENTRIES = draftableEntries();
const POOL = draftablePool();

/** The pack this cube's stated cards per seat comes to over its three rounds. */
const PACK_SIZE = CRITERIA.cardsPerSeat / DEFAULT_PACKS_PER_SEAT;

function measure(drafts = DRAFTS, seed?: string): CubeAvailability {
  return measureAvailability(ENTRIES, CRITERIA, POOL.draftable, {
    drafts,
    ...(seed === undefined ? {} : { seed }),
  });
}

/** The measurement, refusing to test anything against a cube that was not drafted. */
function measured(availability: CubeAvailability): AvailabilityMeasured {
  if (availability.kind === 'unmeasured') {
    throw new Error(`expected a drafted cube, got: ${availability.reason}`);
  }
  return availability;
}

function assembledFor(availability: CubeAvailability, name: string): number {
  const archetype = measured(availability).archetypes.find((entry) => entry.name === name);
  if (archetype === undefined) throw new Error(`no archetype named ${name} was measured`);
  return archetype.assembled;
}

describe('drafting the finished list', () => {
  it('reports how often a seat could assemble each archetype, out of every seat that drafted', () => {
    const availability = measured(measure());

    expect(availability.seats).toBe(CRITERIA.seats);
    expect(availability.drafts).toBe(DRAFTS);
    expect(availability.seatDrafts).toBe(DRAFTS * CRITERIA.seats);
    for (const archetype of availability.archetypes) {
      expect(archetype.assembled).toBeLessThanOrEqual(availability.seatDrafts);
      expect(archetype.share).toBeCloseTo(archetype.assembled / availability.seatDrafts, 10);
    }
  });

  it('measures every stated archetype and nothing else', () => {
    expect(measured(measure()).archetypes.map((archetype) => archetype.name)).toStrictEqual(
      CRITERIA.archetypes.map((archetype) => archetype.name),
    );
  });

  it("judges a seat on the archetype's colors, so a color the list barely holds is barely available", () => {
    const availability = measure();
    const azorius = assembledFor(availability, 'azorius control');
    const green = assembledFor(availability, 'mono-green stompy');

    expect(azorius).toBeGreaterThan(0);
    expect(green).toBe(0);
    expect(azorius).toBeGreaterThan(green);
  });

  it('gives two archetypes in one pair of colors one number, because a draft cannot tell them apart', () => {
    const availability = measure();
    expect(assembledFor(availability, 'azorius tempo')).toBe(assembledFor(availability, 'azorius control'));
  });

  it('asks whether the drafted cards build a deck, not whether the seat saw the color', () => {
    // Green reaches seats — this is not the empty-pool short circuit answering.
    // What it cannot do is fill 23 spells, and that is the whole of why green
    // reads zero above.
    const pools = draftedPools(
      runDraft(DRAFTABLE_SET.cards, {
        seed: `${DEFAULT_AVAILABILITY_SEED}/0`,
        seats: CRITERIA.seats,
        packs: DEFAULT_PACKS_PER_SEAT,
        recipe: cubeBoosterRecipe(DRAFTABLE_SET.cards, PACK_SIZE),
      }),
    );
    const greenPerSeat = pools.map(
      (pool) => pool.filter((card) => card.kind !== 'land' && card.colors.includes('G')).length,
    );

    expect(greenPerSeat.every((held) => held > 0)).toBe(true);
    expect(greenPerSeat.every((held) => held < 23)).toBe(true);
  });
});

describe('the count every published share is a share of', () => {
  /**
   * Every other assertion in this file compares the count to itself: a share
   * against `assembled / seatDrafts`, a finding against the count it was made
   * from, one run against another run. All of that holds while the count is
   * twice what it should be, which is exactly the mutation that survived a green
   * suite (mtg-bc2.123). So this case derives the number instead of reading it:
   * one draft at a fixed seed, run here, each seat's pool narrowed to the
   * archetype's colors and offered to `buildDeck`, and the reported count
   * asserted against what those pods actually produced.
   */
  it('is the seats whose drafted pool built a deck, counted here rather than taken on trust', () => {
    const seed = 'cube/availability/anchor';
    const azorius = CRITERIA.archetypes[0];
    if (azorius === undefined) throw new Error('the fixture states no archetypes');

    const pools = draftedPools(
      runDraft(DRAFTABLE_SET.cards, {
        seed: `${seed}/0`,
        seats: CRITERIA.seats,
        packs: DEFAULT_PACKS_PER_SEAT,
        recipe: cubeBoosterRecipe(DRAFTABLE_SET.cards, PACK_SIZE),
      }),
    );
    const derived = pools.filter((pool) => {
      const castable = pool.filter(
        (card) => card.kind !== 'land' && card.colors.every((color) => azorius.colors.includes(color)),
      );
      return castable.length > 0 && buildDeck(castable).complete;
    }).length;

    // A number that can tell the measurement apart from a stuck one: some seats
    // assembled it and some did not.
    expect(derived).toBeGreaterThan(0);
    expect(derived).toBeLessThan(CRITERIA.seats);
    expect(assembledFor(measure(1, seed), azorius.name)).toBe(derived);
  });
});

describe('the deal a share is read against', () => {
  /**
   * The share alone is ambiguous: it falls as the cube's color count rises
   * whatever the list holds, so a designer reading 2.5% cannot tell a thin
   * archetype from a pod too shallow to field any archetype in a list this wide.
   * These cases hold the three numbers that separate those — the cards an
   * archetype can play, how many of them the pod deals a seat, and what a deck
   * needs — to the properties they are printed for, rather than to any literal.
   */
  const AZORIUS: NonNullable<CubeCriteriaInput['archetypes']> = [
    { name: 'azorius control', colors: ['W', 'U'], minPlayable: 20 },
  ];

  function measureSet(
    set: GeneratedSet,
    overrides: Partial<CubeCriteriaInput> = {},
    drafts = DRAFTS,
  ): AvailabilityMeasured {
    const criteria = draftableCriteria({
      size: Math.max(45, set.cards.length),
      archetypes: [...AZORIUS],
      ...overrides,
    });
    return measured(
      measureAvailability(draftableEntries(set), criteria, draftablePool(set, criteria).draftable, {
        drafts,
        seed: 'cube/availability/deal',
      }),
    );
  }

  function firstArchetype(availability: AvailabilityMeasured): ArchetypeAvailability {
    const [archetype] = availability.archetypes;
    if (archetype === undefined) throw new Error('the measurement states no archetypes');
    return archetype;
  }

  it('counts the cards the archetype can play, and a land is not one of them', () => {
    // The land produces white, so it carries white's identity and is within the
    // archetype's colors — a count that narrowed on colors alone would take it.
    // What a seat is short of is spells, so it must not.
    const withLand = draftableSet({ W: CARDS_PER_FULL_COLOR, U: CARDS_PER_FULL_COLOR }, { lands: ['W'] });
    const withoutLand = draftableSet({ W: CARDS_PER_FULL_COLOR, U: CARDS_PER_FULL_COLOR });
    const [land, ...otherLands] = withLand.cards.filter((card) => card.kind === 'land');
    if (land === undefined) throw new Error('the fixture set holds no land');

    expect(otherLands).toStrictEqual([]);
    expect(withLand.cards).toHaveLength(withoutLand.cards.length + 1);
    expect(candidateFromDslCard(land).colorIdentity).toContain('W');
    expect(firstArchetype(measureSet(withLand)).castable).toBe(
      firstArchetype(measureSet(withoutLand)).castable,
    );
  });

  it('counts a colorless card, because every archetype can cast it', () => {
    const plain = draftableSet({ W: CARDS_PER_FULL_COLOR, U: CARDS_PER_FULL_COLOR });
    const withColorless = draftableSet(
      { W: CARDS_PER_FULL_COLOR, U: CARDS_PER_FULL_COLOR },
      { colorless: 4 },
    );
    const added = withColorless.cards.length - plain.cards.length;

    expect(added).toBe(4);
    expect(firstArchetype(measureSet(withColorless)).castable).toBe(
      firstArchetype(measureSet(plain)).castable + added,
    );
  });

  it('is the deal the pod actually dealt, not an estimate of one', () => {
    // Every pack a seat opened, reconstructed from the picks that came out of
    // it: `openedBy` is a pack's identity for the round, so grouping on it is
    // the seat's whole deal before any bot touched it.
    const drafts = 6;
    const stated = firstArchetype(measureSet(DRAFTABLE_SET, {}, drafts));
    const recipe = cubeBoosterRecipe(DRAFTABLE_SET.cards, PACK_SIZE);
    let dealt = 0;
    let seatDeals = 0;

    for (let index = 0; index < drafts; index += 1) {
      const result = runDraft(DRAFTABLE_SET.cards, {
        seed: `cube/availability/deal/${String(index)}`,
        seats: CRITERIA.seats,
        packs: DEFAULT_PACKS_PER_SEAT,
        recipe,
      });
      const picks = result.seats.flatMap((seat) => seat.picks);
      for (let seat = 0; seat < CRITERIA.seats; seat += 1) {
        const opened = picks.filter((pick) => pick.openedBy === seat).map((pick) => pick.card);
        expect(opened).toHaveLength(CRITERIA.cardsPerSeat);
        dealt += opened.filter(
          (card) => card.kind !== 'land' && card.colors.every((color) => 'WU'.includes(color)),
        ).length;
        seatDeals += 1;
      }
    }

    const empirical = dealt / seatDeals;
    expect(Math.abs(stated.dealtCastable - empirical)).toBeLessThan(1.5);
    // And it is the castable part of the deal rather than the deal: a seat is
    // handed 45 cards and only some of them are spells two colors can cast.
    expect(stated.dealtCastable).toBeLessThan(CRITERIA.cardsPerSeat - 5);
  });

  it('is dealt at the rarity slot rate, not at the archetype share of the whole list', () => {
    // White lives entirely in the rare sheet here, and the pack rounds its rare
    // slot up, so the deal is above white's share of the list. A count that
    // ignored the collation would be off by three quarters of a card in a deal
    // this small, and the whole reason the split is computed is that a real cube
    // can sit like this.
    const drafts = 10;
    const cardsPerSeat = 15;
    const set = draftableSet(
      { W: CARDS_PER_FULL_COLOR, U: CARDS_PER_FULL_COLOR },
      { rarities: { W: 'rare' } },
    );
    const criteria = draftableCriteria({
      size: Math.max(45, set.cards.length),
      cardsPerSeat,
      archetypes: [{ name: 'mono-white beats', colors: ['W'], minPlayable: 4 }],
    });
    const seed = 'cube/availability/rarity';
    const availability = measured(
      measureAvailability(draftableEntries(set), criteria, draftablePool(set, criteria).draftable, {
        drafts,
        seed,
      }),
    );
    const white = firstArchetype(availability);
    const recipe = cubeBoosterRecipe(set.cards, cardsPerSeat / DEFAULT_PACKS_PER_SEAT);
    let dealt = 0;
    let seatDeals = 0;

    for (let index = 0; index < drafts; index += 1) {
      const result = runDraft(set.cards, {
        seed: `${seed}/${String(index)}`,
        seats: criteria.seats,
        packs: DEFAULT_PACKS_PER_SEAT,
        recipe,
      });
      const picks = result.seats.flatMap((seat) => seat.picks);
      for (let seat = 0; seat < criteria.seats; seat += 1) {
        dealt += picks.filter(
          (pick) =>
            pick.openedBy === seat && pick.card.kind !== 'land' && pick.card.colors.every((c) => c === 'W'),
        ).length;
        seatDeals += 1;
      }
    }

    const empirical = dealt / seatDeals;
    const flat = (availability.cardsPerSeat * white.castable) / set.cards.length;
    expect(Math.abs(white.dealtCastable - empirical)).toBeLessThan(0.4);
    // The case has power only because the two rates disagree here.
    expect(Math.abs(flat - empirical)).toBeGreaterThan(0.5);
  });

  it('falls as the cube takes on colors, which is the shipped predicate degrading', () => {
    const held = { W: CARDS_PER_FULL_COLOR, U: CARDS_PER_FULL_COLOR };
    const wider = [
      measureSet(draftableSet(held)),
      measureSet(draftableSet({ ...held, B: CARDS_PER_FULL_COLOR })),
      measureSet(draftableSet({ ...held, B: CARDS_PER_FULL_COLOR, G: CARDS_PER_FULL_COLOR })),
    ].map((availability) => firstArchetype(availability));

    // The archetype's own cards never move: every one of these lists holds the
    // same 68 white and blue cards. Only the deal does, which is the point.
    expect(new Set(wider.map((archetype) => archetype.castable)).size).toBe(1);
    expect(wider[0]!.dealtCastable).toBeGreaterThan(wider[1]!.dealtCastable);
    expect(wider[1]!.dealtCastable).toBeGreaterThan(wider[2]!.dealtCastable);
    expect(wider[0]!.share).toBeGreaterThan(wider[2]!.share);
  });

  it('rises as the pod deals a seat more cards, at a fixed list', () => {
    const set = draftableSet({
      W: CARDS_PER_FULL_COLOR,
      U: CARDS_PER_FULL_COLOR,
      B: CARDS_PER_FULL_COLOR,
      G: CARDS_PER_FULL_COLOR,
    });
    const deeper = [30, 45, 60, 90].map((cardsPerSeat) => firstArchetype(measureSet(set, { cardsPerSeat })));

    expect(new Set(deeper.map((archetype) => archetype.castable)).size).toBe(1);
    for (const [index, archetype] of deeper.entries()) {
      if (index === 0) continue;
      expect(archetype.dealtCastable).toBeGreaterThan(deeper[index - 1]!.dealtCastable);
    }
  });

  it('separates a pod too shallow to field anything from a list that is thin', () => {
    // One list, two pods. Under the shallow one the deal is short of the spells
    // a deck needs and no seat assembles the archetype; the same list under a
    // deeper pod does. A zero read without the deal beside it cannot tell those
    // apart, and that is the whole complaint the baseline answers.
    const set = draftableSet({
      W: CARDS_PER_FULL_COLOR,
      U: CARDS_PER_FULL_COLOR,
      B: CARDS_PER_FULL_COLOR,
      G: CARDS_PER_FULL_COLOR,
      R: CARDS_PER_FULL_COLOR,
    });
    const shallow = measureSet(set, { cardsPerSeat: 45 });
    const deep = measureSet(set, { cardsPerSeat: 90 });
    const shallowAzorius = firstArchetype(shallow);
    const deepAzorius = firstArchetype(deep);

    expect(shallowAzorius.dealtCastable).toBeLessThan(shallow.spellsRequired);
    expect(shallowAzorius.share).toBe(0);
    expect(deepAzorius.dealtCastable).toBeGreaterThan(deep.spellsRequired);
    expect(deepAzorius.share).toBeGreaterThan(0);
    expect(deepAzorius.castable).toBe(shallowAzorius.castable);
  });

  it('states the spells a deck needs as the number a complete deck holds', () => {
    // Not the constant: the deck the measurement's own predicate accepted, built
    // here, counted here. `spellsRequired` is `buildDeck`'s number and this
    // package does not own it, so the assertion goes through a deck.
    const availability = measureSet(DRAFTABLE_SET, {}, 1);
    const pools = draftedPools(
      runDraft(DRAFTABLE_SET.cards, {
        seed: 'cube/availability/deal/0',
        seats: CRITERIA.seats,
        packs: DEFAULT_PACKS_PER_SEAT,
        recipe: cubeBoosterRecipe(DRAFTABLE_SET.cards, PACK_SIZE),
      }),
    );
    const decks = pools
      .map((pool) => buildDeck(pool.filter((card) => card.colors.every((color) => 'WU'.includes(color)))))
      .filter((deck) => deck.complete);

    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) expect(deck.spells).toHaveLength(availability.spellsRequired);
  });
});

describe('a seat holding none of an archetype colors', () => {
  /**
   * `couldAssemble` short-circuits an empty narrowed pool to `false` rather than
   * handing it to `buildDeck`, which refuses one. Deleting that guard is caught,
   * because the refusal throws. Inverting it is not: `return true` counts every
   * seat as fielding an archetype it drafted nothing for, and the whole suite
   * stayed green while it did (found by the verification pass on mtg-bc2.123,
   * which measured boros moving from 2/80 to 3/80 under the inversion).
   *
   * Red is the color `DRAFTABLE_SET` holds none of, so every seat's narrowed
   * pool is empty by construction and the count can only be zero.
   */
  it('is not counted as assembling it', () => {
    const criteria = draftableCriteria({
      archetypes: [{ name: 'mono-red aggro', colors: ['R'], minPlayable: 4 }],
    });
    const availability = measured(
      measureAvailability(ENTRIES, criteria, draftablePool(DRAFTABLE_SET, criteria).draftable, {
        drafts: DRAFTS,
        seed: 'cube/availability/absent-color',
      }),
    );

    // Seats were drafted, so a zero here is a measured zero and not an empty run.
    expect(availability.seatDrafts).toBe(DRAFTS * criteria.seats);
    expect(assembledFor(availability, 'mono-red aggro')).toBe(0);
  });
});

describe('the seed', () => {
  it('makes the measurement reproducible: one seed, one answer', () => {
    expect(measure(DRAFTS, 'cube/availability/test')).toStrictEqual(
      measure(DRAFTS, 'cube/availability/test'),
    );
  });

  it('is carried with the numbers, so a share can be re-derived rather than believed', () => {
    expect(measured(measure()).seed).toBe(DEFAULT_AVAILABILITY_SEED);
    expect(measured(measure(DRAFTS, 'cube/availability/test')).seed).toBe('cube/availability/test');
  });

  it('names every draft apart, so three drafts are three drafts and not one counted thrice', () => {
    const once = assembledFor(measure(1), 'azorius control');
    const thrice = assembledFor(measure(3), 'azorius control');
    expect(thrice).not.toBe(3 * once);
  });

  it('changes the answer, which is what makes it a seed rather than a label', () => {
    expect(assembledFor(measure(DRAFTS, 'cube/availability/one'), 'azorius control')).not.toBe(
      assembledFor(measure(DRAFTS, 'cube/availability/two'), 'azorius control'),
    );
  });
});

describe('the pod a measurement runs', () => {
  it("is the cube's own stated seats, packed to its own stated cards per seat", () => {
    const availability = measured(measure());
    expect(availability.seats).toBe(CRITERIA.seats);
    expect(availability.packs).toBe(DEFAULT_PACKS_PER_SEAT);
    expect(availability.cardsPerSeat).toBe(CRITERIA.cardsPerSeat);
  });

  it('sizes the pack from the cards per seat the cube stated, not from a pack of its own', () => {
    // A second cube stating two thirds the cards per seat. Written as the
    // literal 15 the default cube happens to want, this case cannot tell a pack
    // sized from the criteria from a pack sized once and for all.
    const shorter = draftableCriteria({ cardsPerSeat: 30 });
    const availability = measured(measureAvailability(ENTRIES, shorter, POOL.draftable, { drafts: 1 }));

    expect(availability.cardsPerSeat).toBe(shorter.cardsPerSeat);
    expect(availability.cardsPerSeat).not.toBe(CRITERIA.cardsPerSeat);
  });

  it('reports the pack it actually dealt, which a list thinner than the ask makes shorter', () => {
    // Eight cards asked for a fifteen-card pack: the whole list is in it and the
    // pack is still short, so a seat drafts 24 cards against the 45 the cube
    // stated. Reporting the ask here would report a draft that did not happen,
    // which is what `cardsPerSeat` is on the measurement to prevent.
    const thin = draftableSet({ W: 8 });
    const criteria = draftableCriteria({
      archetypes: [{ name: 'mono-white beats', colors: ['W'], minPlayable: 4 }],
    });
    const availability = measured(
      measureAvailability(draftableEntries(thin), criteria, draftablePool(thin, criteria).draftable, {
        drafts: 1,
      }),
    );

    expect(availability.cardsPerSeat).toBe(DEFAULT_PACKS_PER_SEAT * thin.cards.length);
    expect(availability.cardsPerSeat).toBeLessThan(criteria.cardsPerSeat);
  });

  it('runs as many drafts as it was asked for, defaulting to a stated number', () => {
    expect(measured(measure(7)).drafts).toBe(7);
    expect(measured(measureAvailability(ENTRIES, CRITERIA, POOL.draftable, {})).drafts).toBe(
      DEFAULT_AVAILABILITY_DRAFTS,
    );
  });

  it('refuses a draft count that is not a positive whole number', () => {
    expect(() => measure(0)).toThrow(/positive integer/);
    expect(() => measure(2.5)).toThrow(/positive integer/);
  });
});

describe('a minimum the cube stated', () => {
  const criteria = draftableCriteria({
    archetypes: [
      { name: 'azorius control', colors: ['W', 'U'], minPlayable: 20, minAvailability: 0.9 },
      { name: 'azorius tempo', colors: ['W', 'U'], minPlayable: 20, minAvailability: 0.05 },
      { name: 'mono-green stompy', colors: ['G'], minPlayable: 4 },
    ],
  });
  const availability = measureAvailability(ENTRIES, criteria, POOL.draftable, { drafts: DRAFTS });
  const findings = validateCube(ENTRIES, criteria, availability).findings.filter(
    (finding) => finding.code === 'archetype-availability',
  );

  it('fails the archetype the drafts did not reach, in seat-drafts on both sides', () => {
    const sample = measured(availability).seatDrafts;
    expect(findings.map((finding) => finding.subject)).toStrictEqual(['azorius control']);
    const [finding] = findings;
    expect(finding?.measured).toBe(assembledFor(availability, 'azorius control'));
    expect(finding?.required).toBe(Math.ceil(0.9 * sample));
    expect(finding?.detail).toContain('seat-drafts');
  });

  it('passes the archetype that cleared the share it was held to', () => {
    expect(findings.map((finding) => finding.subject)).not.toContain('azorius tempo');
  });

  it('never fails an archetype that stated none, however few seats reached it', () => {
    expect(assembledFor(availability, 'mono-green stompy')).toBe(0);
    expect(findings.map((finding) => finding.subject)).not.toContain('mono-green stompy');
  });

  it('carries the minimum onto the measurement, so a report need not re-read the criteria', () => {
    expect(measured(availability).archetypes.map((archetype) => archetype.minShare)).toStrictEqual([
      0.9,
      0.05,
      null,
    ]);
  });
});

describe('a cube that landed exactly on the minimum it stated', () => {
  /**
   * The minimums above are 0.9 and 0.05 over twelve seat-drafts, which come to
   * 11 and 1 required and sit nowhere near what the drafts reached. Neither can
   * see the comparison itself. A minimum met exactly is the one case where an
   * inclusive `>=` and an exclusive `>` disagree, and it went untested.
   *
   * Four drafts rather than three: sixteen seat-drafts makes the share a
   * sixteenth, which is exact in binary, so the minimum lands on the count with
   * no rounding to argue about.
   */
  const BOUNDARY_DRAFTS = 4;
  const sample = BOUNDARY_DRAFTS * CRITERIA.seats;
  const reached = assembledFor(measure(BOUNDARY_DRAFTS), 'azorius control');
  const criteria = draftableCriteria({
    archetypes: [
      { name: 'azorius control', colors: ['W', 'U'], minPlayable: 20, minAvailability: reached / sample },
    ],
  });
  const availability = measureAvailability(ENTRIES, criteria, POOL.draftable, { drafts: BOUNDARY_DRAFTS });
  const findings = validateCube(ENTRIES, criteria, availability).findings.filter(
    (finding) => finding.code === 'archetype-availability',
  );

  it('is on the boundary rather than near it, which is the whole of what it tests', () => {
    expect(reached).toBeGreaterThan(0);
    expect(measured(availability).seatDrafts).toBe(sample);
    expect(assembledFor(availability, 'azorius control')).toBe(reached);
    expect(Math.ceil((reached / sample) * sample)).toBe(reached);
  });

  it('passes: a cube that reached exactly the share it demanded reached it', () => {
    expect(findings).toStrictEqual([]);
  });
});

describe('a cube that cannot be drafted', () => {
  it('says the card store is why, rather than reporting a share of nothing', () => {
    const availability = measureAvailability(balancedCube(), fixtureCriteria(), undefined, {
      drafts: DRAFTS,
    });
    expect(availability.kind).toBe('unmeasured');
    expect(availability.kind === 'unmeasured' && availability.reason).toContain('card store');
  });

  it('produces no finding, so an undrafted cube is never failed on a draft', () => {
    const criteria = fixtureCriteria();
    const availability = measureAvailability(balancedCube(), criteria, undefined, { drafts: DRAFTS });
    const validation = validateCube(balancedCube(), criteria, availability);
    expect(validation.availability).toBe(availability);
    expect(validation.findings.filter((finding) => finding.code === 'archetype-availability')).toStrictEqual(
      [],
    );
  });

  it('says so when the cube states no archetype for a seat to assemble', () => {
    const availability = measureAvailability(ENTRIES, draftableCriteria({ archetypes: [] }), POOL.draftable, {
      drafts: DRAFTS,
    });
    expect(availability.kind === 'unmeasured' && availability.reason).toContain('no archetypes');
  });

  it('blames --allow-multiples for a list holding a card twice, not the runtime it would trip', () => {
    const [first, ...rest] = ENTRIES;
    if (first === undefined) throw new Error('the fixture cube is empty');
    const twice = [{ ...first, count: 2 }, ...rest];
    const availability = measureAvailability(twice, draftableCriteria({ singleton: false }), POOL.draftable, {
      drafts: 1,
    });

    expect(availability.kind).toBe('unmeasured');
    const reason = availability.kind === 'unmeasured' ? availability.reason : '';
    expect(reason).toContain('--allow-multiples');
    expect(reason).toContain(first.card.name);
    // The runtime's own words for this are "two cards in the set share an id",
    // which names its rating map and nothing the designer typed.
    expect(reason).not.toContain('share an id');
  });

  it('says the same when a second entry names a card the list already holds', () => {
    const [first, ...rest] = ENTRIES;
    if (first === undefined) throw new Error('the fixture cube is empty');
    const availability = measureAvailability(
      [first, ...rest, first],
      draftableCriteria({ singleton: false }),
      POOL.draftable,
      { drafts: 1 },
    );
    expect(availability.kind === 'unmeasured' && availability.reason).toContain('--allow-multiples');
  });

  it("carries the runtime's own refusal when the pod is too small to pass a pack around", () => {
    const availability = measureAvailability(ENTRIES, draftableCriteria({ seats: 1 }), POOL.draftable, {
      drafts: 1,
    });
    expect(availability.kind === 'unmeasured' && availability.reason).toContain('at least 2 seats');
  });
});

describe('the pack a cube is dealt from', () => {
  it('gives every rarity the list holds a slot, so no card in the cube is undraftable', () => {
    const recipe = cubeBoosterRecipe(DRAFTABLE_SET.cards, 15);
    const rarities = new Set(DRAFTABLE_SET.cards.map((card) => card.rarity));
    expect(new Set(recipe.map((slot) => slot.rarity))).toStrictEqual(rarities);
  });

  it('deals the pack it was asked for, in the proportions the list is written in', () => {
    const recipe = cubeBoosterRecipe(DRAFTABLE_SET.cards, 15);
    expect(recipe.reduce((sum, slot) => sum + slot.count, 0)).toBe(15);
    for (const slot of recipe) {
      const held = DRAFTABLE_SET.cards.filter((card) => card.rarity === slot.rarity).length;
      expect(slot.count).toBeLessThanOrEqual(held);
      expect(Math.abs(slot.count - (held * 15) / DRAFTABLE_SET.cards.length)).toBeLessThan(1);
    }
  });

  it('names no rarity the list does not print', () => {
    const commons = draftableSet({ W: CARDS_PER_FULL_COLOR }).cards.filter(
      (card) => card.rarity === 'common',
    );
    expect(cubeBoosterRecipe(commons, 10)).toStrictEqual([{ rarity: 'common', count: 10 }]);
  });

  it('has nothing to deal from an empty list', () => {
    expect(cubeBoosterRecipe([], 15)).toStrictEqual([]);
  });
});

describe('a validation given no availability at all', () => {
  it('carries null rather than inventing a measurement', () => {
    const validation = validateCube(balancedCube(), fixtureCriteria());
    expect(validation.availability).toBeNull();
    expect(validation.findings.filter((finding) => finding.code === 'archetype-availability')).toStrictEqual(
      [],
    );
  });
});

describe('the pool a cube was cut from', () => {
  it('carries the DSL card behind every candidate when the cube came from a set', () => {
    expect(POOL.draftable?.size).toBe(DRAFTABLE_SET.cards.length);
    for (const entry of ENTRIES) {
      expect(POOL.draftable?.get(entry.card.oracleId)?.name).toBe(entry.card.name);
    }
  });

  it('carries none when the cube came from the store, which is what makes it undraftable', () => {
    expect(fixturePool([]).draftable).toBeUndefined();
  });
});
