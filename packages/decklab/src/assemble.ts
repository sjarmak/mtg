/**
 * The arithmetic half of the ZFC split: everything about the deck that is a
 * calculation rather than a judgment.
 *
 * The basic-land split, the curve histogram, and the probability that a color's
 * sources arrive on time are all computed here and never asked of the model. The
 * land *count* is the exception and does not live here: it is a judgment about
 * the deck, so it arrives already decided on `criteria.landCount` (see
 * `land-plan.ts`) and this file only apportions it. `apportion`,
 * `hypergeometricAtLeast` and `minSourcesFor` come from
 * `@mtg/deckbuild` unchanged — they are pure math over numbers, so they apply
 * to a real Scryfall card exactly as they do to a generated one.
 *
 * What does *not* transfer from `@mtg/deckbuild` is its card evaluation:
 * `evaluateCard`, `buildDeck` and `isRemovalCard` all read the DSL's structured
 * `effects` array, which a real card does not have — a Scryfall card carries
 * free oracle text instead. Reconstructing effects from that text would be
 * regex meaning-detection, so the judgment those functions encode is the
 * model's job here, and only the arithmetic is reused.
 */
import type { BasicLandType, Color } from '@mtg/dsl';
import { apportion, COLORS } from '@mtg/dsl';
import {
  curveBucket,
  emptyCurveHistogram,
  hypergeometricAtLeast,
  minSourcesFor,
  type CurveBucket,
} from '@mtg/deckbuild';
import { isLandCard } from './candidates';
import type { DeckCriteria, ResolvedCriteria } from './criteria';
import { basicLandTypesOf, colorOfBasicType, fetchTargets } from './fetchland';
import { pipDemand } from './mana-cost';
import type { Inclusion } from './verify';
import { cardCount, deckPrice } from './verify';

/**
 * How much a pip on an early card outweighs a late one. A double-pip two-drop
 * needs its sources by turn two; a six-drop has four more draws to find them.
 * Indexed by mana value, clamped at the end.
 */
const PIP_WEIGHT_BY_MANA_VALUE: readonly number[] = [1.6, 1.6, 1.4, 1.2, 1.05, 1, 1];

/** Karsten's reporting threshold: below this, a color is unreliable on curve. */
export const CASTABILITY_TARGET = 0.9;

/**
 * The band the deck's heaviest single-card requirement is held to.
 *
 * Two checks, two bands, because the two failures are not the same failure.
 * Missing the one source a color's cheapest card needs means the color does
 * nothing all game; missing the second pip of a {2}{B}{B} means that one card
 * is late. `@mtg/deckbuild` declined to enforce the heavier check at all, and
 * for a reason: at 0.9 two black sources by turn four wants twenty of sixty
 * cards, and two colors cannot both hold twenty out of twenty-four lands
 * unless nearly every land is a dual.
 *
 * 0.8 is pinned from both sides by that same requirement. At 0.75 it asks for
 * fifteen, which is exactly black's {1}{B} floor, so the double pip would go on
 * being invisible — the bug. At 0.8 it asks for sixteen: one above the
 * single-source floor, so it fires on the deck that prompted this, and low
 * enough that a two-color deck carrying its mana base on duals still clears
 * it. `assemble.test.ts` pins all four of those numbers.
 */
export const HEAVY_CASTABILITY_TARGET = 0.8;

/**
 * One thing a color has to be able to do, written so it can be both solved for
 * a source count and evaluated at one. Holding the two together is what keeps
 * a reported floor and the sentence explaining it from drifting apart.
 */
export interface CastabilityCheck {
  /** Sources wanted in hand at once. */
  readonly pips: number;
  /** Mana value of the card wanting them, which is the turn it wants them by. */
  readonly manaValue: number;
  /** Probability the check has to reach. */
  readonly target: number;
  /** The card the check comes from. */
  readonly cardName: string;
}

/**
 * What one color's mana base does, in a 60-card constructed deck.
 *
 * `Constructed` is in the name because `@mtg/deckbuild` exports a
 * `ColorSourceReport` of its own for the 40-card Limited deck, and it is a
 * different record rather than an older version of this one. That one carries
 * `demandShare` and the castability the split happened to land at, because at
 * 40 cards the Karsten inversion asks for more sources than the deck has lands.
 * This one carries `sourceFloor` and `meetsTarget`, because at 60 it asks for a
 * number a deck can hold. `@mtg/deckbuild`'s `mana-base.ts` header argues that
 * split with the arithmetic; the two names are kept apart so nobody has to
 * re-derive it from a collision.
 */
export interface ConstructedColorSourceReport {
  readonly color: Color;
  readonly pipCount: number;
  readonly weightedDemand: number;
  /** Basics plus every nonbasic land that taps for this color. */
  readonly sources: number;
  readonly basicSources: number;
  readonly nonBasicSources: number;
  /** Sources this color needs to clear every check; 0 when it needs none. */
  readonly sourceFloor: number;
  /** The check that set the floor; undefined when the color asks for nothing. */
  readonly binding: CastabilityCheck | undefined;
  /** P(the binding check succeeds) at the sources the deck actually runs. */
  readonly castability: number;
  readonly meetsTarget: boolean;
}

export interface ConstructedManaBase {
  readonly basics: Readonly<Record<Color, number>>;
  readonly nonBasicLands: number;
  /** Colored sources the chosen nonbasic lands supply, by color. */
  readonly nonBasicSources: Readonly<Record<Color, number>>;
  readonly totalLands: number;
  readonly reports: readonly ConstructedColorSourceReport[];
}

export interface ConstructedCurveReport {
  readonly histogram: Readonly<Record<CurveBucket, number>>;
  readonly averageManaValue: number;
}

export interface AssembledDeck {
  readonly spells: readonly Inclusion[];
  readonly lands: readonly Inclusion[];
  readonly manaBase: ConstructedManaBase;
  readonly curve: ConstructedCurveReport;
  readonly totalCards: number;
  /** Ways the deck does not meet the criteria's structural targets. */
  readonly shortfalls: readonly string[];
}

/**
 * Turns a verified card list into a deck.
 *
 * The land slot is filled from whatever the criteria asked for: any non-basic
 * lands the model chose count against it, and basics make up the rest. If the
 * model's spells already exceed the deck size the excess is reported as a
 * shortfall rather than silently trimmed, because which card to cut is a
 * judgment. The rest is what the basic split actually placed rather than what
 * it was asked for: basics are apportioned by pip demand, so a deck where no
 * color demands a pip leaves the slot empty, and the deck's size is the cards
 * it holds rather than a count balanced with lands that were never chosen.
 *
 * A nonbasic land is a *source*, not a blank. Four Sacred Foundry are four red
 * sources and four white ones, so the basics apportioned afterwards cover what
 * the duals leave uncovered rather than duplicating what they already supply,
 * and the castability report counts them. Treating them as blanks understated
 * every multicolor mana base and is what made the all-basics build look
 * acceptable on paper. A fetchland taps for nothing at all, so it is worth
 * whatever the rest of the deck gives it to find; `fetchland.ts` holds which
 * land types each printed one names, as data rather than as a reading of its
 * oracle text.
 *
 * Castability is a threshold, so the split is not purely proportional: each
 * color's floor is paid before demand gets a say, and a deck whose colors want
 * more lands than it runs is told the count that would hold them all. A color
 * short of its floor with no number attached is a complaint the reader cannot
 * act on.
 *
 * A color's floor answers two questions, not one: can it cast anything on
 * curve, and can it cast the card that wants the most of it at once. The second
 * is what a deck of four {2}{B}{B} passes on the first alone.
 */
export function assembleDeck(inclusions: readonly Inclusion[], criteria: ResolvedCriteria): AssembledDeck {
  const lands = inclusions.filter((entry) => isLandCard(entry.card));
  const spells = inclusions.filter((entry) => !isLandCard(entry.card));

  const nonBasicLands = cardCount(lands);
  const spellCount = cardCount(spells);
  const basicsWanted = Math.max(0, criteria.landCount - nonBasicLands);

  const deckColors = resolveDeckColors(spells, criteria);
  const demand = measureColorDemand(spells, deckColors);
  const supply = landSources(lands, deckColors);
  const nonBasicSources = supply.sources;

  // The floors are an input to filling the land slot, so they are solved
  // against the size the deck is being built to rather than the size filling it
  // produced.
  const plannedCards = spellCount + nonBasicLands + basicsWanted;
  const floors = sourceFloors(demand, deckColors, plannedCards);
  const basics = splitBasics(basicsWanted, demand, floors, supply, deckColors);

  // What the split placed, which is not always what it was asked for: basics go
  // out by pip demand, so a deck where no color demands a pip gets zeros back
  // and its land slot stays empty. Counting that slot into the size anyway is
  // how a deck of colorless spells claimed sixty cards and exported thirty-six.
  const basicsPlaced = COLORS.reduce((sum, color) => sum + basics[color], 0);
  const totalLands = nonBasicLands + basicsPlaced;
  const totalCards = spellCount + totalLands;

  const reports = COLORS.filter((color) => deckColors.includes(color)).map((color) =>
    reportColor(color, demand[color], basics[color], nonBasicSources[color], floors[color], totalCards),
  );

  const shortfalls: string[] = [];

  // Defense in depth. The selection loop enforces the budget as it goes; this
  // check is what makes a failure of that enforcement visible in the report
  // rather than silently compliant, which is how it was missed the first time.
  const maxDeckUsd = criteria.budget?.maxDeckUsd;
  if (maxDeckUsd !== undefined) {
    const total = deckPrice([...spells, ...lands]);
    if (total > maxDeckUsd) {
      shortfalls.push(`deck costs $${total.toFixed(2)} against a $${maxDeckUsd} budget`);
    }
  }

  // The empty slot is reported before the size it leaves the deck at, because
  // the second is a consequence of the first. `splitBasics` hands out the whole
  // count whenever any color carries weighted demand, so a slot it left empty
  // is one there was no color to apportion a basic to.
  const unfilled = basicsWanted - basicsPlaced;
  if (unfilled > 0) {
    shortfalls.push(
      `${unfilled} of the ${criteria.landCount} land slots cannot be filled: ` +
        'no color in the deck has pip demand to apportion basics to',
    );
  }

  if (totalCards !== criteria.size) {
    shortfalls.push(
      `deck has ${totalCards} cards against a target of ${criteria.size} (${spellCount} spells + ${totalLands} lands)`,
    );
  }
  // A color with nothing to check has a floor of zero and always meets it, so
  // narrowing on the binding check excludes nothing that could be short.
  const uncastable = reports.filter(
    (report): report is ConstructedColorSourceReport & { readonly binding: CastabilityCheck } =>
      !report.meetsTarget && report.binding !== undefined,
  );
  for (const report of uncastable) shortfalls.push(castabilityShortfall(report, report.binding));
  // The count is the actionable half. A color short of its floor is a fact the
  // reader can do nothing with on its own — the UB deck that prompted this knew
  // it wanted more black sources and had no way to tell whether that meant a
  // different split or more lands. Every floor is met at this count, and at no
  // smaller one.
  if (uncastable.length > 0) {
    const required =
      nonBasicLands +
      reports.reduce((sum, report) => sum + basicsForFloor(report.sourceFloor, report.nonBasicSources), 0);
    shortfalls.push(
      `meeting every color's source floor needs ${required} lands; the deck runs ${totalLands}`,
    );
  }

  return {
    spells,
    lands,
    manaBase: { basics, nonBasicLands, nonBasicSources, totalLands, reports },
    curve: curveReport(spells),
    totalCards,
    shortfalls,
  };
}

/**
 * The deck's colors: what the user stated, or failing that what the cards
 * actually demand. Derived rather than assumed, so a model that quietly built
 * three colors produces a three-color mana base and an honest castability
 * report instead of a two-color one that lies.
 */
export function resolveDeckColors(spells: readonly Inclusion[], criteria: DeckCriteria): readonly Color[] {
  if (criteria.colors.length > 0) return criteria.colors;
  const used = new Set<Color>();
  for (const entry of spells) {
    for (const color of COLORS) {
      if (entry.card.parsedCost.fixed[color] > 0) used.add(color);
    }
  }
  return COLORS.filter((color) => used.has(color));
}

function pipWeight(manaValue: number): number {
  const last = PIP_WEIGHT_BY_MANA_VALUE[PIP_WEIGHT_BY_MANA_VALUE.length - 1] ?? 1;
  if (manaValue < 0) return last;
  return (
    PIP_WEIGHT_BY_MANA_VALUE[Math.min(Math.floor(manaValue), PIP_WEIGHT_BY_MANA_VALUE.length - 1)] ?? last
  );
}

/** One card's claim on a color: how many sources at once, by which turn. */
interface PipRequirement {
  /** Pips of the color the card cannot pay any other way. */
  readonly pips: number;
  readonly manaValue: number;
  readonly cardName: string;
}

/** What one color asks of the mana base, in one pass over the spells. */
interface ColorPipDemand {
  readonly pipCount: number;
  /** Pips weighted by how early the card wanting them is cast. */
  readonly weighted: number;
  /** Cheapest card wanting the color at all, hybrid pips included. */
  readonly earliest: PipRequirement | undefined;
  /** Card forcing the most sources of the color at once, soonest; two or more. */
  readonly heaviest: PipRequirement | undefined;
}

const NO_DEMAND: ColorPipDemand = { pipCount: 0, weighted: 0, earliest: undefined, heaviest: undefined };

/** The cheaper card wins; the first one seen holds a tie. */
function earlier(current: PipRequirement | undefined, next: PipRequirement): PipRequirement {
  return current === undefined || next.manaValue < current.manaValue ? next : current;
}

/** More pips wins; on a tie the one that wants them sooner does. Mirrors `@mtg/deckbuild`. */
function heavier(current: PipRequirement | undefined, next: PipRequirement): PipRequirement {
  if (current === undefined) return next;
  if (next.pips !== current.pips) return next.pips > current.pips ? next : current;
  return next.manaValue < current.manaValue ? next : current;
}

function measureColorDemand(
  spells: readonly Inclusion[],
  deckColors: readonly Color[],
): Record<Color, ColorPipDemand> {
  const demand: Record<Color, ColorPipDemand> = {
    W: NO_DEMAND,
    U: NO_DEMAND,
    B: NO_DEMAND,
    R: NO_DEMAND,
    G: NO_DEMAND,
  };
  for (const entry of spells) {
    const pips = pipDemand(entry.card.parsedCost, deckColors);
    const weight = pipWeight(entry.card.manaValue);
    for (const color of COLORS) {
      if (pips[color] <= 0) continue;
      const current = demand[color];
      // The heavy requirement counts only pips the card cannot pay another way.
      // `pipDemand` splits a hybrid across the colors that can pay it, so two
      // {R/W} pips read as one of each — a real number for apportionment and a
      // fiction for "how many red sources must be in hand at once", which is
      // none. `fixed` is the half of the cost that admits no substitute.
      const requirement: PipRequirement = {
        pips: entry.card.parsedCost.fixed[color],
        manaValue: entry.card.manaValue,
        cardName: entry.card.name,
      };
      demand[color] = {
        pipCount: current.pipCount + pips[color] * entry.count,
        weighted: current.weighted + pips[color] * weight * entry.count,
        earliest: earlier(current.earliest, requirement),
        heaviest: requirement.pips >= 2 ? heavier(current.heaviest, requirement) : current.heaviest,
      };
    }
  }
  return demand;
}

/** Cards seen by the turn a card of this mana value wants to be cast, on the play. */
function cardsSeen(manaValue: number): number {
  return 7 + Math.max(0, Math.ceil(manaValue) - 1);
}

/**
 * The checks a color has to pass. One source by the turn its cheapest card
 * wants to be cast, and — when some card forces two or more of the color at
 * once — that many by the turn that card wants them.
 */
function castabilityChecks(demand: ColorPipDemand): readonly CastabilityCheck[] {
  const checks: CastabilityCheck[] = [];
  const { earliest, heaviest } = demand;
  // One source is the whole of the cheapest-card check: it asks whether the
  // color does anything on curve, not whether that card is castable.
  if (earliest !== undefined) {
    checks.push({
      pips: 1,
      manaValue: earliest.manaValue,
      target: CASTABILITY_TARGET,
      cardName: earliest.cardName,
    });
  }
  if (heaviest !== undefined) {
    checks.push({
      pips: heaviest.pips,
      manaValue: heaviest.manaValue,
      target: HEAVY_CASTABILITY_TARGET,
      cardName: heaviest.cardName,
    });
  }
  return checks;
}

/** The check solved for a source count. `cardsSeen` is at least seven, so no real card's pip count outruns it. */
function checkFloor(check: CastabilityCheck, deckSize: number): number {
  return minSourcesFor(check.pips, check.target, cardsSeen(check.manaValue), deckSize);
}

/** The same check evaluated at a source count the deck actually runs. */
function checkCastability(check: CastabilityCheck, sources: number, deckSize: number): number {
  return hypergeometricAtLeast(check.pips, sources, cardsSeen(check.manaValue), deckSize);
}

/** A color's floor and the one check that set it. */
interface ColorFloor {
  readonly floor: number;
  readonly binding: CastabilityCheck | undefined;
}

const NO_FLOOR: ColorFloor = { floor: 0, binding: undefined };

/**
 * The fewest sources each color needs to clear every check: the checks
 * `reportColor` applies, solved for the source count instead of evaluated at
 * one.
 *
 * This is what apportionment cannot express. Splitting the land slot by demand
 * hands a color holding 39% of the pips 39% of the sources, but a color whose
 * cheapest card costs {1}{B} needs fifteen sources in a sixty-card deck whatever
 * its share works out to. Ten is a self-consistent answer to a different
 * question.
 *
 * The floor is the largest of the per-check answers, and that single number is
 * also the pass mark: `hypergeometricAtLeast` only rises with the source count,
 * so holding the largest floor is exactly holding all of them. Keeping the
 * binding check alongside is what lets the shortfall quote a probability and a
 * target that belong to the number beside them.
 */
function sourceFloors(
  demand: Record<Color, ColorPipDemand>,
  deckColors: readonly Color[],
  deckSize: number,
): Record<Color, ColorFloor> {
  const floors: Record<Color, ColorFloor> = {
    W: NO_FLOOR,
    U: NO_FLOOR,
    B: NO_FLOOR,
    R: NO_FLOOR,
    G: NO_FLOOR,
  };
  for (const color of deckColors) {
    let highest = NO_FLOOR;
    for (const check of castabilityChecks(demand[color])) {
      const floor = checkFloor(check, deckSize);
      if (highest.binding === undefined || floor > highest.floor) highest = { floor, binding: check };
    }
    floors[color] = highest;
  }
  return floors;
}

/**
 * Basics a color still owes its floor once the nonbasic lands are counted.
 * The split and the land count it reports both come from here, so they cannot
 * disagree about what the deck is short of.
 */
function basicsForFloor(floor: number, nonBasicSources: number): number {
  return Math.max(0, floor - nonBasicSources);
}

/** What the nonbasic lands supply, and what the basics owe them in return. */
interface NonBasicSupply {
  /** Colored sources the nonbasic lands supply, counted with multiplicity. */
  readonly sources: Record<Color, number>;
  /**
   * Colors whose fetches reach them only through a basic. The split owes each
   * of them one, because a fetch counted as a source of a color the deck runs
   * no basic of is a source that is not there.
   */
  readonly basicsOwedToFetches: Record<Color, number>;
}

/**
 * Colored sources the nonbasic lands supply.
 *
 * Most lands answer this from Scryfall's `produced_mana`. A fetchland taps for
 * nothing and has none, so what it supplies is whatever the rest of the deck
 * gives it to find: `fetchland.ts` holds which land types each one names, and
 * the deck's own lands carry those types. An Arid Mesa in a deck with three
 * Sacred Foundry is three ways to a white source and counts as one, exactly as a
 * dual does.
 *
 * Two routes, and they are not interchangeable. A fetch reaches a color through
 * a *nonbasic* that carries the named type — Sacred Foundry is a Mountain and a
 * Plains, so anything fetching either finds it and taps for both colors — or
 * through a *basic* of the color that type produces, which the deck has to
 * actually run. Only the second creates a debt, and `splitBasics` pays it.
 */
function landSources(lands: readonly Inclusion[], deckColors: readonly Color[]): NonBasicSupply {
  const sources: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const basicsOwedToFetches: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };

  // What a fetch would find, indexed by the type it has to name to find it. A
  // fetch cannot find another fetch, so they are not in here.
  const byLandType = new Map<BasicLandType, Set<Color>>();
  for (const entry of lands) {
    if (fetchTargets(entry.card.name) !== undefined) continue;
    const produced = entry.card.producedMana.filter((color) => deckColors.includes(color));
    if (produced.length === 0) continue;
    for (const type of basicLandTypesOf(entry.card.typeLine)) {
      const found = byLandType.get(type) ?? new Set<Color>();
      for (const color of produced) found.add(color);
      byLandType.set(type, found);
    }
  }

  for (const entry of lands) {
    const colors = new Set<Color>(entry.card.producedMana.filter((color) => deckColors.includes(color)));
    const targets = fetchTargets(entry.card.name);
    if (targets !== undefined) {
      const viaBasic = new Set<Color>();
      const viaNonBasic = new Set<Color>();
      for (const type of targets.types) {
        const basicColor = colorOfBasicType(type);
        if (deckColors.includes(basicColor)) viaBasic.add(basicColor);
        if (targets.basicsOnly) continue;
        for (const color of byLandType.get(type) ?? []) viaNonBasic.add(color);
      }
      for (const color of viaBasic) {
        if (!viaNonBasic.has(color)) basicsOwedToFetches[color] = 1;
      }
      for (const color of [...viaBasic, ...viaNonBasic]) colors.add(color);
    }
    for (const color of colors) sources[color] += entry.count;
  }

  return { sources, basicsOwedToFetches };
}

/**
 * Splits the basics, floors first.
 *
 * Each color's floor comes out of the land slot before anything proportional
 * happens, less whatever the nonbasic lands already supply — four Sacred Foundry
 * are four fewer Mountains and four fewer Plains, not blanks — and only what the
 * floors leave over is apportioned by weighted demand. A color that clears its
 * floor is castable on curve, which is the property the deck is judged on;
 * proportionality is what to do with the rest. A color whose fetchlands reach
 * it only through a basic is owed one on the same terms: a fetch counted as a
 * source of a color the deck runs no basic of is a source that is not there.
 *
 * When the floors do not all fit, no split meets them and there is nothing to
 * choose between. Forcing one anyway would hand a lone {3}{W} in a red deck a
 * third of the mana base, so the basics fall back to demand: the deck's colored
 * sources apportioned by weighted demand, less what the nonbasics already cover,
 * with every played color guaranteed at least one source so a real second
 * color cannot round to nothing. `assembleDeck` then reports the land count
 * that would have met every floor.
 *
 * What is apportioned there is *sources*, not lands, and the two are not the
 * same number: a dual is one land and two sources. Aiming a share of the land
 * count at each color and then subtracting the sources its nonbasics supply
 * charged every dual to both colors at once, which amplified the demand split
 * rather than honoring it — six duals in a 26-land UB deck came out 20/11
 * against a 60/40 demand, below what the weaker pre-heavy-check floors had given
 * black at the same land count.
 *
 * Demand is the only signal in that branch, and its rivals were tried. Dividing
 * by each color's distance from its own floor, or leveling every color to the
 * same fraction of its floor, both hand the lone {3}{W} six of seventeen lands.
 * Relaxing to the cheapest-card floors puts a mono-red deck's twenty {R}{R}
 * two-drops back on ten sources. A floor no split can meet says nothing about
 * how to divide what is there; how much of the deck wants each color does.
 */
function splitBasics(
  count: number,
  demand: Record<Color, ColorPipDemand>,
  floors: Record<Color, ColorFloor>,
  supply: NonBasicSupply,
  deckColors: readonly Color[],
): Record<Color, number> {
  const { sources: nonBasicSources, basicsOwedToFetches } = supply;
  const basics: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const active = deckColors.filter((color) => demand[color].weighted > 0);
  if (count === 0 || active.length === 0) return basics;

  const weights = active.map((color) => demand[color].weighted);
  const need = active.map((color) =>
    Math.max(basicsForFloor(floors[color].floor, nonBasicSources[color]), basicsOwedToFetches[color]),
  );
  const needed = need.reduce((sum, value) => sum + value, 0);

  if (needed <= count) {
    const spare = apportion(count - needed, weights);
    for (const [index, color] of active.entries()) basics[color] = (need[index] ?? 0) + (spare[index] ?? 0);
    return basics;
  }

  // Every basic is one source and every nonbasic is as many as it taps for, so
  // that sum — not the land count — is what demand has to divide.
  const sourceBudget = active.reduce((sum, color) => sum + nonBasicSources[color], count);
  const target = apportion(sourceBudget, weights);
  const residual = active.map((color, index) => Math.max(0, (target[index] ?? 0) - nonBasicSources[color]));
  const shares = apportion(count, residual.some((value) => value > 0) ? residual : weights);
  for (const [index, color] of active.entries()) basics[color] = shares[index] ?? 0;

  // One basic for a color demand alone would leave with nothing, and one for a
  // color whose fetches have nothing else to find. Both are the same move.
  for (const color of active) {
    const wanted = nonBasicSources[color] === 0 || basicsOwedToFetches[color] > 0 ? 1 : 0;
    if (basics[color] >= wanted) continue;
    const richest = active.reduce(
      (best, other) => (basics[other] > basics[best] ? other : best),
      active[0] ?? color,
    );
    if (basics[richest] > 1) {
      basics[richest] -= 1;
      basics[color] += 1;
    }
  }
  return basics;
}

function reportColor(
  color: Color,
  demand: ColorPipDemand,
  basicSources: number,
  nonBasicSources: number,
  floor: ColorFloor,
  deckSize: number,
): ConstructedColorSourceReport {
  const sources = basicSources + nonBasicSources;
  const { binding } = floor;

  return {
    color,
    pipCount: demand.pipCount,
    weightedDemand: demand.weighted,
    sources,
    basicSources,
    nonBasicSources,
    sourceFloor: floor.floor,
    binding,
    castability: binding === undefined ? 1 : checkCastability(binding, sources, deckSize),
    meetsTarget: sources >= floor.floor,
  };
}

/**
 * Why a color missed, in the terms of the check that set its floor. The card,
 * the probability, the target and the source count all come from that one
 * check, so the sentence cannot disagree with the number beside it.
 *
 * The percentage rounds down. A check that fails at 79.6% printed as "only 80%
 * of the time (target 80%)" reads as a contradiction rather than a shortfall.
 */
function castabilityShortfall(report: ConstructedColorSourceReport, check: CastabilityCheck): string {
  const achieved = Math.floor(report.castability * 100);
  const target = Math.round(check.target * 100);
  return `${report.color} casts ${check.cardName} on curve only ${achieved}% of the time (target ${target}%): ${report.sources} sources against the ${report.sourceFloor} it needs`;
}

function curveReport(spells: readonly Inclusion[]): ConstructedCurveReport {
  const histogram = emptyCurveHistogram();
  let total = 0;
  let cards = 0;
  for (const entry of spells) {
    const bucket = curveBucket(entry.card.manaValue);
    histogram[bucket] += entry.count;
    total += entry.card.manaValue * entry.count;
    cards += entry.count;
  }
  return { histogram, averageManaValue: cards === 0 ? 0 : total / cards };
}
