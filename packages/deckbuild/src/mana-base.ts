/**
 * Mana base: 17 basics split by weighted pip demand, then judged against
 * Karsten's castability threshold — or counted out by a person and judged the
 * same way. `buildManaBase` apportions, `buildChosenManaBase` does not, and both
 * end in the same measurement, because what a base supports is arithmetic
 * whoever picked it.
 *
 * A naive 9/8 split ignores what the deck actually costs. A deck with eleven
 * red pips and four white ones wants roughly 12/5, and one whose red pips sit
 * on two-drops wants the split pushed further still — early pips need more
 * sources to be castable on curve. So demand is weighted by the mana value of
 * the card requiring it (`pipWeightByManaValue`), apportioned with the
 * largest-remainder method, and then floored so a real second color cannot be
 * squeezed down to a splash.
 *
 * The castability numbers are reported, never enforced: Karsten's 90% threshold
 * for a double-pip two-drop needs about 20 sources in 40 cards, which no
 * two-color Limited deck can supply. Reporting them keeps the metrics gate
 * honest without flooding every build with unmeetable shortfalls.
 *
 * ## Why the floor here is a share threshold and not the Karsten inversion
 *
 * `@mtg/decklab` answers what looks like the same question the other way. It
 * solves `minSourcesFor` for the count each color needs, pays that floor out of
 * the basics before anything proportional happens, and reports against the same
 * predicate it allocated from. That inversion is deliberately absent here, and
 * the reason is the draw count rather than taste (bead mtg-bc2.67).
 *
 * Solve the inversion at 40 cards and nothing fits. One source by the turn a
 * two-drop wants to be cast is 10 sources of 40 at 90%, and a turn-one card
 * wants 11. Two colors therefore want 20 or 22 sources out of 17 lands: a deck
 * whose cheapest card in each color is a two-drop — which is every Limited deck
 * — is three lands short before a double pip is even considered, and {B}{B} on
 * turn two wants 16 of 40 at 90%, 13 at the 0.8 band decklab holds heavy
 * requirements to. A floors-first split would therefore fall through to its
 * fallback on essentially every build, so importing it would buy an unreachable
 * number and a shortfall on every deck while changing no split.
 *
 * Sixty-card constructed is where the inversion pays and why decklab has it: 15
 * sources for a {1}{B} and 16 for a double pip on turn four are numbers a
 * 24-land deck carrying duals can actually hold, so a floor there is a
 * requirement rather than a wish.
 *
 * `minSourcesPerColor` is answering a different question and is not an
 * approximation of Karsten's. Six sources is a 76% chance of one by turn two —
 * nowhere near the 90% band and not claimed to be. What it prevents is a
 * degenerate split: 17 lands apportioned by demand alone can hand a real second
 * color one or two sources, which is a rounding error rather than a mana base.
 * So this file enforces an anti-degeneracy floor and reports castability, and
 * decklab enforces castability itself. `mana-base.test.ts` pins the arithmetic
 * that decides which of those a format can afford.
 */
import type { BasicLandType, Card, Color } from '@mtg/dsl';
import {
  apportion,
  BASIC_LAND_COLOR,
  BASIC_LAND_TYPES,
  COLORS,
  dominantSetCode,
  isLand,
  manaValue,
  setBasics,
  sortColors,
} from '@mtg/dsl';
import type { DeckBuildConfig, ManaBaseConfig } from './config';
import type { PoolCard } from './evaluate';
import { hypergeometricAtLeast } from './hypergeometric';
import type { Shortfall } from './shortfall';

const BASIC_FOR_COLOR: Readonly<Record<Color, BasicLandType>> = Object.fromEntries(
  BASIC_LAND_TYPES.map((type) => [BASIC_LAND_COLOR[type], type]),
) as Record<Color, BasicLandType>;

/** One color's requirement: how many pips at what mana value. */
export interface ColorRequirement {
  readonly pips: number;
  readonly manaValue: number;
  readonly cardName: string;
}

export interface ColorSourceReport {
  readonly color: Color;
  /** Raw colored pips across the deck's spells. */
  readonly pipCount: number;
  /** Pip count after weighting each pip by the mana value of its card. */
  readonly weightedDemand: number;
  /** Share of the deck's total weighted demand, in [0, 1]. */
  readonly demandShare: number;
  /** Basics assigned to this color. */
  readonly sources: number;
  /** Cheapest card needing this color; the on-curve castability check uses it. */
  readonly earliest: ColorRequirement | undefined;
  /** Heaviest pip requirement in the deck for this color. */
  readonly heaviest: ColorRequirement | undefined;
  /** P(at least one source by the turn `earliest` wants to be cast, on the play). */
  readonly earliestCastability: number;
  /** P(enough sources for `heaviest` on its turn, on the play). */
  readonly heaviestCastability: number;
  /** Whether both probabilities clear `manaBase.castabilityTarget`. */
  readonly meetsCastabilityTarget: boolean;
}

export interface ManaBase {
  /** The land cards themselves, one entry per copy. */
  readonly lands: readonly Card[];
  /** Basic lands per color; colors absent from the deck map to 0. */
  readonly landsByColor: Readonly<Record<Color, number>>;
  /** Mana sources per color; a retained dual land contributes to both colors. */
  readonly sourcesByColor: Readonly<Record<Color, number>>;
  readonly reports: readonly ColorSourceReport[];
  readonly shortfalls: readonly Shortfall[];
}

function pipWeight(manaValue: number, config: ManaBaseConfig): number {
  const table = config.pipWeightByManaValue;
  const last = table[table.length - 1] ?? 1;
  if (manaValue < 0) return last;
  return table[Math.min(Math.floor(manaValue), table.length - 1)] ?? last;
}

export interface ColorDemand {
  readonly pipCount: number;
  readonly weightedDemand: number;
  readonly earliest: ColorRequirement | undefined;
  readonly heaviest: ColorRequirement | undefined;
}

/**
 * Every requirement one card puts on one color: its printed cost, and each
 * activated ability that has to be paid in that color as well.
 *
 * An ability's cost never reaches `colors` — `checkColorIdentity` derives that
 * from the printed cost, and a noncreature artifact's printed cost has to be
 * colorless — so a chest that opens for {1}{G} is a colorless card this file
 * would otherwise build no green for. The turn the requirement lands is the
 * turn both halves are affordable, so it is filed at the sum of the two mana
 * values: that is the turn `castability` asks about and the figure `pipWeight`
 * discounts by.
 */
function requirementsFor(spell: PoolCard, color: Color): readonly ColorRequirement[] {
  const { card } = spell;
  // The guard is here rather than only at the call site because it is what
  // narrows the card union: a land has no `manaCost` to read at all.
  if (isLand(card)) return [];
  const found: ColorRequirement[] = [];
  const printed = card.manaCost[color];
  if (printed > 0) found.push({ pips: printed, manaValue: spell.manaValue, cardName: card.name });
  for (const ability of card.abilities) {
    if (ability.kind !== 'activated') continue;
    const pips = ability.cost.mana[color];
    if (pips <= 0) continue;
    found.push({
      pips,
      manaValue: spell.manaValue + manaValue(ability.cost.mana),
      cardName: card.name,
    });
  }
  return found;
}

/**
 * Raw and weighted pip demand per color, plus the two requirements the
 * castability report needs: the cheapest card wanting the color and the card
 * wanting the most pips of it soonest.
 */
export function measureDemand(
  spells: readonly PoolCard[],
  config: ManaBaseConfig,
): Readonly<Record<Color, ColorDemand>> {
  const demand = {} as Record<Color, ColorDemand>;
  for (const color of COLORS) {
    let pipCount = 0;
    let weightedDemand = 0;
    let earliest: ColorRequirement | undefined;
    let heaviest: ColorRequirement | undefined;

    for (const spell of spells) {
      for (const requirement of requirementsFor(spell, color)) {
        pipCount += requirement.pips;
        weightedDemand += requirement.pips * pipWeight(requirement.manaValue, config);
        if (earliest === undefined || requirement.manaValue < earliest.manaValue) earliest = requirement;
        if (
          heaviest === undefined ||
          requirement.pips > heaviest.pips ||
          (requirement.pips === heaviest.pips && requirement.manaValue < heaviest.manaValue)
        ) {
          heaviest = requirement;
        }
      }
    }
    demand[color] = { pipCount, weightedDemand, earliest, heaviest };
  }
  return demand;
}

/**
 * Cards seen by the turn a spell of this mana value wants to be cast: the
 * opening hand plus one draw per turn after the first (one fewer on the play).
 */
function cardsSeenByTurn(turn: number, config: ManaBaseConfig): number {
  const draws = config.onThePlay ? Math.max(0, turn - 1) : turn;
  return config.openingHandSize + draws;
}

function castability(
  requirement: ColorRequirement | undefined,
  wantedPips: number,
  sources: number,
  deckSize: number,
  config: ManaBaseConfig,
): number {
  if (requirement === undefined) return 1;
  const turn = Math.max(1, requirement.manaValue);
  return hypergeometricAtLeast(wantedPips, sources, cardsSeenByTurn(turn, config), deckSize);
}

/**
 * Raises colors that carry a real share of the demand up to the minimum source
 * count, taking lands from the color that can most afford them. A donor is
 * never pushed below its own floor; if no legal donor exists the floor is left
 * unmet and the caller reports it as a shortfall.
 *
 * The floor being enforced is `minSourcesPerColor`, which is an anti-degeneracy
 * number and not a castability one. The module docstring records why the
 * castability floor decklab derives is not used at 40 cards.
 */
function enforceFloors(counts: number[], shares: readonly number[], config: ManaBaseConfig): void {
  const floorFor = (index: number): number =>
    (shares[index] ?? 0) >= config.colorFloorShareThreshold ? config.minSourcesPerColor : 0;

  for (let index = 0; index < counts.length; index += 1) {
    for (;;) {
      const current = counts[index] ?? 0;
      if (current >= floorFor(index)) break;
      let donor = -1;
      let donorSurplus = 0;
      for (let other = 0; other < counts.length; other += 1) {
        if (other === index) continue;
        const surplus = (counts[other] ?? 0) - floorFor(other);
        if (surplus > donorSurplus) {
          donor = other;
          donorSurplus = surplus;
        }
      }
      if (donor < 0) break;
      counts[donor] = (counts[donor] ?? 0) - 1;
      counts[index] = current + 1;
    }
  }
}

/**
 * The basic land card used for a color: the pool's own printing when the set
 * ships one, otherwise a synthesized basic in the pool's set code.
 *
 * `setBasics` decides both, and it is in `@mtg/dsl` rather than here because the
 * art pipeline has to name the same cards. A synthesized basic's id is the
 * manifest key its illustration is stored under, so two derivations of it are
 * two chances to disagree — and the one that disagreed drew the pending frame
 * for Swamp through a whole game.
 */
function landCardFor(color: Color, basics: readonly Card[]): Card {
  const card = basics[BASIC_LAND_TYPES.indexOf(BASIC_FOR_COLOR[color])];
  if (card === undefined) throw new Error(`no basic land for ${color}`);
  return card;
}

/** Re-exported at its old name: the implementation moved, the API did not. */
export { dominantSetCode };

/**
 * Each color's share of the deck's whole weighted pip demand, in [0, 1].
 *
 * Measured across all five colors rather than across the colors being paid for,
 * so a color left out of the base has a share the caller can report against. A
 * deck with no colored pips at all has a share of zero everywhere, which is the
 * true statement about it: nothing is demanded, so no color is floored.
 */
function demandShares(demand: Readonly<Record<Color, ColorDemand>>): Readonly<Record<Color, number>> {
  const total = COLORS.reduce((sum, color) => sum + demand[color].weightedDemand, 0);
  const shares = {} as Record<Color, number>;
  for (const color of COLORS) {
    shares[color] = total === 0 ? 0 : demand[color].weightedDemand / total;
  }
  return shares;
}

/**
 * Prints the lands and measures what they support, given a source count per
 * color that somebody else decided.
 *
 * This is the arithmetic half of a mana base and the only half that is not a
 * judgment call: how many of each basic to print, what share of the demand each
 * color carries, how likely the sources are to be there on the turn the cheapest
 * card wants them, and which colors carry real demand without the sources to
 * match. `colors` is reported in full even where a color has no sources, because
 * a demanded color paid nothing is exactly the thing worth saying out loud.
 */
function describeManaBase(
  colors: readonly Color[],
  sourcesByColor: Readonly<Record<Color, number>>,
  basicsByColor: Readonly<Record<Color, number>>,
  retainedLands: readonly Card[],
  demand: Readonly<Record<Color, ColorDemand>>,
  pool: readonly Card[],
  config: DeckBuildConfig,
): ManaBase {
  const manaConfig = config.manaBase;
  const shares = demandShares(demand);
  const basics = setBasics(pool);
  const lands: Card[] = [...retainedLands];
  const landsByColor: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const reports: ColorSourceReport[] = [];
  const shortfalls: Shortfall[] = [];

  for (const color of colors) {
    const sources = sourcesByColor[color];
    const share = shares[color];
    const colorDemand = demand[color];
    landsByColor[color] = sources;
    const basicsForColor = basicsByColor[color];
    if (basicsForColor > 0) {
      const landCard = landCardFor(color, basics);
      for (let copy = 0; copy < basicsForColor; copy += 1) lands.push(landCard);
    }

    const earliestCastability = castability(colorDemand.earliest, 1, sources, config.deckSize, manaConfig);
    const heaviestCastability = castability(
      colorDemand.heaviest,
      colorDemand.heaviest?.pips ?? 0,
      sources,
      config.deckSize,
      manaConfig,
    );
    reports.push({
      color,
      pipCount: colorDemand.pipCount,
      weightedDemand: colorDemand.weightedDemand,
      demandShare: share,
      sources,
      earliest: colorDemand.earliest,
      heaviest: colorDemand.heaviest,
      earliestCastability,
      heaviestCastability,
      meetsCastabilityTarget:
        earliestCastability >= manaConfig.castabilityTarget &&
        heaviestCastability >= manaConfig.castabilityTarget,
    });

    const floor = share >= manaConfig.colorFloorShareThreshold ? manaConfig.minSourcesPerColor : 0;
    if (sources < floor) {
      shortfalls.push({
        kind: 'colorSources',
        color,
        target: floor,
        achieved: sources,
        missing: floor - sources,
      });
    }
  }

  return { lands, landsByColor: { ...basicsByColor }, sourcesByColor: landsByColor, reports, shortfalls };
}

/** The colors a spell list actually asks for, in WUBRG order. */
export function demandedColors(demand: Readonly<Record<Color, ColorDemand>>): readonly Color[] {
  return COLORS.filter((color) => demand[color].pipCount > 0);
}

/**
 * Apportions the deck's land slots across the colors it is told to pay for.
 *
 * The color list is the caller's: `buildDeck` hands the pair it ranked and
 * `buildFromSpells` hands whatever the picks demand, which may be three or more.
 * Demand outside the list gets no sources and is reported anyway — a color the
 * caller left out shows up as a `colorSources` shortfall rather than quietly
 * rebalancing the split, because a splash nobody paid for is a fact about the
 * deck and not a bug in the arithmetic.
 */
export function buildManaBase(
  spells: readonly PoolCard[],
  colors: readonly Color[],
  pool: readonly Card[],
  config: DeckBuildConfig,
): ManaBase {
  const manaConfig = config.manaBase;
  const paid = sortColors(colors);
  const demand = measureDemand(spells, manaConfig);
  const retainedLands = pool
    .filter(
      (card) =>
        card.kind === 'land' &&
        card.basicLandType === undefined &&
        card.producesMana.some((mana) => mana !== 'C' && paid.includes(mana)) &&
        card.producesMana.every((mana) => mana === 'C' || paid.includes(mana)),
    )
    .slice(0, config.landCount);
  const landSlots = config.landCount - retainedLands.length;
  const weights = paid.map((color) => demand[color].weightedDemand);
  const totalDemand = weights.reduce((sum, weight) => sum + weight, 0);
  // An all-colorless deck has no pip demand at all; split the basics evenly
  // rather than dividing by zero.
  const counts = apportion(landSlots, totalDemand > 0 ? weights : paid.map(() => 1));
  const shares = demandShares(demand);
  enforceFloors(
    counts,
    paid.map((color) => shares[color]),
    manaConfig,
  );

  const basicsByColor: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const sourcesByColor: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  paid.forEach((color, index) => {
    basicsByColor[color] = counts[index] ?? 0;
    sourcesByColor[color] = basicsByColor[color];
  });
  for (const land of retainedLands) {
    if (land.kind !== 'land') continue;
    for (const mana of land.producesMana) {
      if (mana !== 'C') sourcesByColor[mana] += 1;
    }
  }
  const reported = sortColors([...new Set([...paid, ...demandedColors(demand)])]);
  return describeManaBase(reported, sourcesByColor, basicsByColor, retainedLands, demand, pool, config);
}

/** Basics per color, as somebody counted them out. A color left out means none. */
export type BasicLandCounts = Readonly<Partial<Record<Color, number>>>;

/**
 * The mana base a person counted out for themselves.
 *
 * The counts are taken exactly as given. Which basics back up a splash is a
 * decision with a cost either way rather than a sum with an answer, so it
 * belongs to whoever is building the deck; a builder that quietly rebalanced it
 * would be one they could not trust with the rest of their picks either. What
 * stays here is the measurement — the same castability report and the same
 * `colorSources` floor the apportioned base is judged by, so a splash paid for
 * in two basics is reported rather than refused.
 */
export function buildChosenManaBase(
  spells: readonly PoolCard[],
  basics: BasicLandCounts,
  pool: readonly Card[],
  config: DeckBuildConfig,
): ManaBase {
  const demand = measureDemand(spells, config.manaBase);
  const sourcesByColor: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const color of COLORS) {
    const count = basics[color] ?? 0;
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `buildChosenManaBase: ${color} basics must be a non-negative integer, got ${String(count)}`,
      );
    }
    sourcesByColor[color] = count;
  }
  const reported = COLORS.filter((color) => sourcesByColor[color] > 0 || demand[color].pipCount > 0);
  return describeManaBase(reported, sourcesByColor, sourcesByColor, [], demand, pool, config);
}
