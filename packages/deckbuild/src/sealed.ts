/**
 * Set to sealed pool: opening boosters.
 *
 * This is the step before everything else in this package. `buildDeck` turns a
 * pool into a deck; a sealed player does not start with a pool, they start with
 * a set and six sealed packs.
 *
 * Seeded and deterministic, like every other sampling in this repo. The same
 * seed opens the same six packs forever, which is what makes a sealed game
 * something you can write down, hand to someone else, and replay. It also means
 * a pool that produced an interesting game can be re-opened rather than
 * described.
 *
 * Cards are unique *within* a pack and may repeat *across* packs, which is how
 * real boosters behave: one pack never contains the same card twice, six packs
 * frequently contain the same common three times.
 */
import type { Card, Rarity } from '@mtg/dsl';
import { isBasicLand } from '@mtg/dsl';
import type { PoolProvenance } from './provenance';
import { nextInt, seedRng } from './rng';
import type { Rng } from './rng';

export interface BoosterSlot {
  /** The fixed rarity, or the primary rarity of a source-weighted slot. */
  readonly rarity: Rarity;
  readonly count: number;
  /**
   * Per-printing weights when one physical sheet supplies several rarities.
   * Omitted means the slot is fixed at `rarity`.
   *
   * Explicitly `undefined` means the same thing as omitted, which is why the
   * type says so under `exactOptionalPropertyTypes`: a recipe that arrives as
   * parsed JSON (`@mtg/metrics`'s collation document) carries the key with an
   * undefined value, and a slot it cannot describe is a rare/mythic sheet the
   * calibration harness refuses to open.
   */
  readonly rarityWeights?: readonly BoosterRarityWeight[] | undefined;
}

export interface BoosterRarityWeight {
  readonly rarity: Rarity;
  readonly weight: number;
}

export type BoosterRecipe = readonly BoosterSlot[];

/**
 * The two-tier pack: nine commons and three uncommons.
 *
 * The ratio is the one `@mtg/design-data`'s skeleton-lite derives its rarity
 * split from, and its reasoning applies here for the same reason: what a player
 * sees per pack is the honest weighting for a pool that is drafted and played
 * rather than collected. Basic lands are not a slot because the deck builder
 * supplies the mana base, and `boosterPool` is what makes that true of a set
 * that prints its own basics rather than only of one that does not.
 *
 * This is the pack for a set that prints no rares, which is what both committed
 * fixtures do today. It is no longer the pack for every set: see
 * `boosterRecipeFor`.
 */
export const SLICE_BOOSTER: BoosterRecipe = [
  { rarity: 'common', count: 9 },
  { rarity: 'uncommon', count: 3 },
];

/**
 * The three-tier pack: the same nine and three, plus the rare.
 *
 * Thirteen cards rather than twelve, because the rare is an addition to the
 * pack and not a promotion out of the uncommon slot. That is the shape
 * `skeleton-play-booster-2024`'s own 9:3:1 describes, and keeping the commons
 * and uncommons at their existing counts is what stops a set gaining a rare
 * tier from silently changing what every other slot deals.
 */
export const SLICE_BOOSTER_WITH_RARE: BoosterRecipe = [...SLICE_BOOSTER, { rarity: 'rare', count: 1 }];

/** M11/M13's shared rare sheet: each rare has twice one mythic's weight. */
export const SLICE_BOOSTER_WITH_RARE_MYTHIC: BoosterRecipe = [
  ...SLICE_BOOSTER,
  {
    rarity: 'rare',
    count: 1,
    rarityWeights: [
      { rarity: 'rare', weight: 2 },
      { rarity: 'mythic', weight: 1 },
    ],
  },
];

/** A high-rarity slot for a set that prints mythics but no rares. */
export const SLICE_BOOSTER_WITH_MYTHIC: BoosterRecipe = [...SLICE_BOOSTER, { rarity: 'mythic', count: 1 }];

/**
 * The pack a set should be opened with, chosen by what the set actually prints.
 *
 * A fixed recipe cannot be right for both cases and the two failures are not
 * symmetric. A recipe with no rare slot silently makes every rare in the set
 * unopenable: a 250-card set generates 19 rares, renders them, exports them and
 * balance-tests them, and puts none of them on a board. A recipe with a rare
 * slot handed a set that prints none is the loud failure instead —
 * `assertPoolFits` refuses the whole pool rather than dealing a thin pack — so a
 * constant of either kind breaks one of the two sets this repo ships.
 *
 * Deriving it from the pool is what makes both right, and the derivation has to
 * live here rather than be imported: this package depends on `@mtg/dsl` alone
 * and cannot see `SLICE_RARITIES` in `@mtg/design-data`, so the compiler could
 * never have caught the missing tier. `@mtg/cube`'s `cubeBoosterRecipe` solved
 * the same problem the same way, and names this recipe's missing rare slot as
 * the hazard it was routing around.
 *
 * A caller with its own opinion still passes `recipe` and is never overridden.
 */
/**
 * The cards a pack may deal: the set minus its basic lands.
 *
 * `SLICE_BOOSTER` states the rule as its own reason for having no land slot —
 * the deck builder supplies the mana base — but a basic land carries DSL rarity
 * `common`, so a set that *prints* its basics put twenty Plains, Islands,
 * Swamps, Mountains and Forests into the common slot's pool and dealt them at
 * that share. Over the reduced M11, twenty of 121 commons were basics and one
 * pack in six came out with three or more of them (`mtg-h77m`). A generated set
 * never showed it because it prints no basics at all: `@mtg/deckbuild` mints
 * them at build time.
 *
 * One derivation for both surfaces. `@mtg/draft-export`'s `buildSheets` reads
 * this too, so a drafted pack and a sealed pack hold the same mix, which is the
 * claim that file's docblock already makes.
 */
export function boosterPool(set: readonly Card[]): readonly Card[] {
  return set.filter((card) => !isBasicLand(card));
}

export function boosterRecipeFor(set: readonly Card[]): BoosterRecipe {
  const hasRare = set.some((card) => card.rarity === 'rare');
  const hasMythic = set.some((card) => card.rarity === 'mythic');
  if (hasRare && hasMythic) return SLICE_BOOSTER_WITH_RARE_MYTHIC;
  if (hasMythic) return SLICE_BOOSTER_WITH_MYTHIC;
  return hasRare ? SLICE_BOOSTER_WITH_RARE : SLICE_BOOSTER;
}

/** The sheet membership and per-printing weight of one recipe slot. */
export function boosterSlotRarityWeights(slot: BoosterSlot): readonly BoosterRarityWeight[] {
  return slot.rarityWeights ?? [{ rarity: slot.rarity, weight: 1 }];
}

export const DEFAULT_BOOSTER_COUNT = 6;

export interface SealedOptions {
  readonly seed?: string;
  readonly boosters?: number;
  readonly recipe?: BoosterRecipe;
}

export interface SealedPool<CardType = Card> {
  readonly seed: string;
  /** Every pack in the order it was opened. */
  readonly boosters: readonly (readonly CardType[])[];
  /** Every card from every pack, flattened. Duplicates are real. */
  readonly cards: readonly CardType[];
  /**
   * Which slot each card came off, aligned with `boosters` card for card.
   *
   * The flattening into `cards` is what loses it, and a pool dealt off a
   * printing's sheets is where that costs something: two copies of one card, one
   * off the foil sheet, arrive as two identical entries. `provenance.ts` argues
   * the shape, including why the sealed arm answers a foil question by having no
   * foil slot rather than by reporting `false`.
   */
  readonly provenance: PoolProvenance;
}

export class SealedPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedPoolError';
  }
}

/** Draws `count` distinct cards from `from`, without replacement. */
function drawDistinct(from: readonly Card[], count: number, rng: Rng): readonly [readonly Card[], Rng] {
  const remaining = [...from];
  const drawn: Card[] = [];
  let current = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const [index, advanced] = nextInt(current, remaining.length);
    current = advanced;
    const [card] = remaining.splice(index, 1);
    if (card !== undefined) drawn.push(card);
  }
  return [drawn, current];
}

function checkedWeights(slot: BoosterSlot): readonly BoosterRarityWeight[] {
  const weights = boosterSlotRarityWeights(slot);
  if (weights.length === 0) throw new SealedPoolError('a booster slot needs at least one rarity');
  if (!weights.some((entry) => entry.rarity === slot.rarity)) {
    throw new SealedPoolError(`a weighted ${slot.rarity} slot must include its primary rarity`);
  }
  if (new Set(weights.map((entry) => entry.rarity)).size !== weights.length) {
    throw new SealedPoolError('a booster slot cannot weight one rarity twice');
  }
  for (const entry of weights) {
    if (!Number.isSafeInteger(entry.weight) || entry.weight <= 0) {
      throw new SealedPoolError(
        `booster rarity weight must be a positive safe integer, got ${String(entry.weight)}`,
      );
    }
  }
  return weights;
}

function cardsForSlot(pool: readonly Card[], slot: BoosterSlot): readonly Card[] {
  const rarities = new Set(checkedWeights(slot).map((entry) => entry.rarity));
  return pool.filter((card) => rarities.has(card.rarity));
}

function drawDistinctWeighted(
  from: readonly Card[],
  weights: readonly BoosterRarityWeight[],
  count: number,
  rng: Rng,
): readonly [readonly Card[], Rng] {
  const byRarityWeight = new Map(weights.map((entry) => [entry.rarity, entry.weight]));
  const remaining = [...from];
  const drawn: Card[] = [];
  let current = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const total = remaining.reduce((sum, card) => sum + (byRarityWeight.get(card.rarity) ?? 0), 0);
    if (!Number.isSafeInteger(total) || total <= 0) {
      throw new SealedPoolError('booster rarity weights exceed the supported range');
    }
    const [roll, advanced] = nextInt(current, total);
    current = advanced;
    let cursor = roll;
    let index = 0;
    for (; index < remaining.length; index += 1) {
      const card = remaining[index];
      if (card === undefined) continue;
      cursor -= byRarityWeight.get(card.rarity) ?? 0;
      if (cursor < 0) break;
    }
    const [card] = remaining.splice(index, 1);
    if (card !== undefined) drawn.push(card);
  }
  return [drawn, current];
}

/**
 * Checks the pool can fill the recipe before opening anything, so a short pool
 * fails with the rarity and the two numbers rather than with a pack that is
 * quietly one card light.
 */
function assertPoolFits(pool: readonly Card[], recipe: BoosterRecipe): void {
  if (pool.length === 0) throw new SealedPoolError('cannot open boosters from an empty set');
  for (const slot of recipe) {
    const weights = checkedWeights(slot);
    const available = cardsForSlot(pool, slot).length;
    if (available < slot.count) {
      const label = weights.map((entry) => entry.rarity).join('/');
      throw new SealedPoolError(
        `a booster needs ${String(slot.count)} ${label} cards but the set has ${String(available)}`,
      );
    }
  }
}

/**
 * One pack, with the slot every card came off beside it.
 *
 * The slot's label is the slot's own `rarity` rather than the drawn card's,
 * which differ on a source-weighted slot: M11's rare slot deals a mythic one
 * time in three and it is still the rare slot. Provenance is about where a card
 * was dealt from, and `card.rarity` already answers what it is.
 */
function openOne(
  pool: readonly Card[],
  recipe: BoosterRecipe,
  rng: Rng,
): readonly [readonly Card[], readonly Rarity[], Rng] {
  const cards: Card[] = [];
  const slots: Rarity[] = [];
  let current = rng;
  for (const slot of recipe) {
    const weights = checkedWeights(slot);
    const candidates = cardsForSlot(pool, slot);
    const [drawn, advanced] =
      weights.length === 1
        ? drawDistinct(candidates, slot.count, current)
        : drawDistinctWeighted(candidates, weights, slot.count, current);
    current = advanced;
    cards.push(...drawn);
    slots.push(...drawn.map(() => slot.rarity));
  }
  return [cards, slots, current];
}

/** Opens `boosters` packs from a set. Deterministic in the seed. */
export function openSealedPool(set: readonly Card[], options: SealedOptions = {}): SealedPool {
  const recipe = options.recipe ?? boosterRecipeFor(set);
  const count = options.boosters ?? DEFAULT_BOOSTER_COUNT;
  if (!Number.isInteger(count) || count <= 0) {
    throw new SealedPoolError(`booster count must be a positive integer, got ${String(count)}`);
  }
  const pool = boosterPool(set);
  assertPoolFits(pool, recipe);

  const seed = options.seed ?? 'sealed/v0';
  let rng = seedRng(seed);
  const boosters: (readonly Card[])[] = [];
  const slots: (readonly Rarity[])[] = [];
  for (let pack = 0; pack < count; pack += 1) {
    const [opened, dealtOff, advanced] = openOne(pool, recipe, rng);
    rng = advanced;
    boosters.push(opened);
    slots.push(dealtOff);
  }
  return { seed, boosters, cards: boosters.flat(), provenance: { kind: 'rarities', slots } };
}

/**
 * How many cards a recipe puts in one pack.
 *
 * The recipe is required rather than defaulted. There is no one pack any more,
 * so a caller that omitted it would be asking a question with two answers and
 * getting whichever one this file was written with.
 */
export function boosterSize(recipe: BoosterRecipe): number {
  return recipe.reduce((total, slot) => total + slot.count, 0);
}
