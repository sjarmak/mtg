/**
 * Archetype availability: how often a seat could assemble each stated archetype,
 * measured by drafting the finished list rather than counting it.
 *
 * `validate.ts` counts the cards an archetype has. That is a census, and a
 * census cannot answer the question a cube designer actually asks — *will the
 * archetype be there when eight people draft this?* A cube can hold thirty
 * playable boros cards and still fail, because seven other seats are pulling
 * from the same list. Only a draft can say.
 *
 * ## The pick loop is not here
 *
 * `runDraft` is imported from `@mtg/draft-export`, which owns the seat model,
 * the bots and the pass order. This file is the projection from cube criteria
 * onto that runtime plus the arithmetic over what comes back, and nothing else.
 *
 * ## What "could assemble" means
 *
 * A seat could assemble an archetype when the cards it drafted that are
 * castable in that archetype's colors build a complete deck — `buildDeck` over
 * the color-narrowed pool, with `complete` as the answer. `buildDeck` is
 * already the project's answer to "does this pool make a legal deck": full
 * spell count, on curve, over the creature floor, and a mana base that can cast
 * what it selected. Inventing a second predicate here would be a second
 * definition of a legal deck to keep in step by hand.
 *
 * The archetype's *tag* is deliberately not part of the predicate, even though
 * `playableFor` uses it. A seat drafts `cardsPerSeat` cards and a deck needs 23
 * spells, so a tag-gated predicate asks whether a seat drafted 23 cards that one
 * archetype was tagged for — which no cube of any size delivers, since a 360-card
 * cube tagging 24 cards for an archetype puts about two of them in a 36-card
 * seat. It would read zero for every cube and measure nothing. The tag's job is
 * the census in `validate.ts`; the draft's job is the colors.
 *
 * A consequence worth stating: two archetypes declared in the same colors get
 * the same availability, because the draft cannot tell them apart. That is a
 * true statement about a draft — a seat in {W,U} can field either — and the
 * place the two differ is the census.
 *
 * ## Where the color predicate bottoms out, which is the same failure one axis over
 *
 * The shipped predicate degrades the way the rejected one does; the axis is the
 * cube's color count rather than its tagging. A seat is dealt `cardsPerSeat`
 * cards from the whole list and keeps only the ones two colors can cast, so the
 * spells it can play fall roughly as the reciprocal of the colors the cube is
 * drafted in, while `buildDeck` keeps asking for 23. Drafting the committed
 * 90-card five-color set whole at the default 8x45 pod, ten drafts, boros and
 * dimir come back in the low single digits — 7 and 0 seats of 80 under the
 * default seed, 3 and 1 under another — and none of those readings is a fact
 * about those archetypes. The pod deals a seat 19.5 castable spells against the
 * 23 a deck needs, so most seats fail on arithmetic before any card's quality is
 * reached, and at that floor the spread between seeds is as wide as the reading.
 * Deal the same list 60 cards a seat and boros reads 16.3%; deal it 90 and it
 * reads 37.5%. Nothing about the list changed.
 *
 * A designer reading a share near zero cannot tell those two situations apart
 * from the share alone, so the share never travels alone. Every archetype carries the deal
 * beside it — `castable`, how many cards in the cube it can play as spells, and
 * `dealtCastable`, how many of those this pod's own pack hands one seat before
 * a single pick — and the measurement carries `spellsRequired`, which is what
 * `buildDeck` demands. A low share under a deal well below the requirement is
 * the pod being too shallow for a list this wide; the same share with the deal
 * above the requirement is the list itself. `dealtCastable` is exact rather than
 * simulated: it is `slot.count x castable-in-that-rarity / sheet` summed over
 * the pack's slots and multiplied by the packs a seat opens, read off the very
 * recipe the drafts ran, which is why it costs nothing and cannot drift from the
 * measurement it is printed beside.
 *
 * It is a count against a count and not a probability, and that was measured
 * rather than preferred. A closed-form share — `P(at least 23 castable cards
 * dealt)`, hypergeometric over the same deal — over-states the color-blind
 * assembly rate badly and unevenly, because 23 castable cards is necessary and
 * not sufficient for `buildDeck`, which also wants a curve, a creature floor
 * and a mana base: against a 400-trial control it reads 99.93% where the control
 * assembles 26.00%, 50.00% against 0.75%, 12.37% against 0.25%. It is also a
 * near-step function of the deal, so it is flat everywhere except at its knee,
 * while the count moves smoothly with everything the share moves with.
 *
 * Two other nulls were measured and rejected. Dealing the same packs and never
 * picking (the seed's own deal, unfiltered by any bot) reads 0.0% for a rich
 * cube whose measured share is 13.8% and 0.0% for a thin one whose measured
 * share is 0.0%, so it cannot separate the two cases this section exists to
 * separate, and it doubles the deck builds. Permuting the colors of the actual
 * cube holds `castable`, size and `cardsPerSeat` all fixed — every input the
 * shortfall is made of — so it cannot move along the axis the problem lives on:
 * two five-color cubes with identical castable counts, identical pods and
 * identical deals measured 11.3% and 2.5% purely by where on the curve the
 * archetype's colors sat, and a permutation null would report that 4.5x swing
 * as if it were a fact about the floor.
 *
 * ## Seeded, with provenance
 *
 * Every draft is seeded from `seed/<index>`, so a measurement is a number
 * anyone can reproduce and the result carries the seed, the draft count and the
 * sample it is a share of. An unseeded availability number is not evidence.
 *
 * ## What the draft runtime cannot do for a cube, stated rather than worked around
 *
 * Four gaps, all in `@mtg/draft-export` and none of them papered over here:
 *
 *  1. `openPack` draws each pack independently from its sheet, so one card can
 *     be dealt to several seats in one draft. A real cube is one physical list
 *     dealt once. This makes availability optimistic, most for the cards the
 *     bots want most.
 *  2. Packs are collated by DSL rarity, because `buildSheets` partitions on it.
 *     A cube has no rarities. `cubeBoosterRecipe` answers with the closest thing
 *     the runtime accepts — a pack whose rarity mix is the cube's own — so no
 *     part of the list is unreachable, but the deal is stratified rather than
 *     uniform.
 *  3. `runDraft` drafts DSL cards. A cube cut from the card store holds real
 *     printings whose rules text the kernel cannot run, and fabricating DSL
 *     cards from them would break the project's load-bearing invariant. Such a
 *     cube reports `unmeasured` with that as its reason.
 *  4. A card is its id to the runtime, which refuses a list holding one twice.
 *     So a cube built with `--allow-multiples` is measured but not drafted, and
 *     it is refused here by name: left to reach `runDraft`, it comes back as
 *     "two cards in the set share an id", which is true about the runtime's
 *     internals and says nothing about the flag the designer typed. Minting a
 *     synthetic id per copy would draft *a* list, but not this one (the copies
 *     would be different cards to every bot), so the limit is stated instead
 *     and the choice is open in mtg-bc2.139.
 */
import type { BoosterRecipe } from '@mtg/deckbuild';
import { buildDeck, resolveConfig, spellCount } from '@mtg/deckbuild';
import { DEFAULT_PACKS_PER_SEAT, DraftError, draftedPools, runDraft } from '@mtg/draft-export';
import type { Card, Rarity } from '@mtg/dsl';
import { isLand, RARITIES } from '@mtg/dsl';
import type { CubeArchetype, CubeCriteria } from './criteria';
import type { CubeEntry } from './validate';
import { withinArchetype } from './validate';

/**
 * Drafts run per measurement.
 *
 * Twenty-five drafts of an eight-seat pod is 200 seat-drafts, which is the
 * sample `mtg-bc2.117` already measured drafted pools over, and it bounds the
 * standard error of any reported share at 3.5 points (worst case `p = 0.5`).
 * That is fine enough to separate an archetype two seats in three can field
 * from one that one seat in three can, which is the resolution a designer acts
 * on; it is not fine enough to argue about a two-point difference, and nothing
 * here claims otherwise. Raising it costs linear time — the whole measurement
 * is `drafts x seats x archetypes` deck builds — so it is an option rather than
 * a constant.
 */
export const DEFAULT_AVAILABILITY_DRAFTS = 25;

export const DEFAULT_AVAILABILITY_SEED = 'cube/availability/v0';

export interface ArchetypeAvailability {
  readonly name: string;
  /** Seat-drafts whose pool built a complete deck in this archetype's colors. */
  readonly assembled: number;
  /** `assembled / seatDrafts`. */
  readonly share: number;
  /** The share the cube demanded, or `null` when it stated none. */
  readonly minShare: number | null;
  /**
   * Cards in the whole cube this archetype can play as spells: within its colors
   * by the same predicate the draft narrows on, and not a land, because the
   * spells `buildDeck` counts are what a deck is short of. This is the ceiling
   * the deal is drawn from, and it is a property of the list alone.
   */
  readonly castable: number;
  /**
   * How many of those `castable` cards this pod's own pack deals one seat across
   * its packs, in expectation, before a single pick is made. Read off the
   * recipe the drafts ran rather than simulated, and therefore exact.
   *
   * The floor `share` is read against: below `spellsRequired` the seat cannot
   * assemble the archetype from the deal at all, however good the list is, and
   * a share near zero there is the pod rather than the cube.
   */
  readonly dealtCastable: number;
}

export interface AvailabilityMeasured {
  readonly kind: 'measured';
  readonly seed: string;
  readonly drafts: number;
  readonly seats: number;
  /** Packs each seat opened, one per round. */
  readonly packs: number;
  /**
   * Cards a seat actually drafted, which is `packs` times the pack the recipe
   * describes. It is reported because it can differ from the cube's stated
   * `cardsPerSeat`: the pack is whole cards, and a list too thin in one rarity
   * deals a shorter pack than the arithmetic asked for.
   */
  readonly cardsPerSeat: number;
  /** `drafts * seats`: the sample every share is out of. */
  readonly seatDrafts: number;
  /**
   * Spells `buildDeck` needs for a complete deck, which is what every
   * `dealtCastable` is short or long of. Carried on the measurement rather than
   * assumed by a reader, because it is the deck builder's number and this
   * package does not own it.
   */
  readonly spellsRequired: number;
  readonly archetypes: readonly ArchetypeAvailability[];
}

/** Why a cube was not drafted. Never a silent absence: the reason is carried. */
export interface AvailabilityUnmeasured {
  readonly kind: 'unmeasured';
  readonly reason: string;
}

export type CubeAvailability = AvailabilityMeasured | AvailabilityUnmeasured;

export interface AvailabilityOptions {
  readonly drafts?: number;
  readonly seed?: string;
}

/** Thrown when the cube and the pool it came from disagree about what a card is. */
export class UndraftableCubeError extends Error {
  constructor(readonly cardName: string) {
    super(
      `the cube holds ${cardName}, which its pool carries no DSL card for; ` +
        'a drafted cube must be cut from a generated set, entry for entry',
    );
    this.name = 'UndraftableCubeError';
  }
}

/**
 * Drafts the finished list `drafts` times and reports, per stated archetype, the
 * share of seats that could have assembled it.
 *
 * `draftable` is the pool's map from a candidate's `oracleId` to the DSL card
 * behind it, which only a cube cut from a generated set has. Its absence is the
 * store cube, and that is reported rather than thrown: the cube was constructed
 * and measured, and only this one measurement is out of reach.
 */
export function measureAvailability(
  entries: readonly CubeEntry[],
  criteria: CubeCriteria,
  draftable: ReadonlyMap<string, Card> | undefined,
  options: AvailabilityOptions = {},
): CubeAvailability {
  if (draftable === undefined) {
    return {
      kind: 'unmeasured',
      reason:
        'this cube is cut from the card store, and the draft runtime drafts DSL cards; ' +
        'build it from a generated set with --set to draft it',
    };
  }
  if (criteria.archetypes.length === 0) {
    return { kind: 'unmeasured', reason: 'the cube states no archetypes, so there is none to be available' };
  }
  const repeated = repeatedCard(entries);
  if (repeated !== undefined) {
    return {
      kind: 'unmeasured',
      reason:
        `the cube holds ${repeated} more than once, and the draft runtime deals a list of distinct cards; ` +
        'build this cube singleton, without --allow-multiples, to draft it',
    };
  }

  const drafts = draftCount(options.drafts);
  const seed = options.seed ?? DEFAULT_AVAILABILITY_SEED;
  const cards = cubeCards(entries, draftable);
  const recipe = cubeBoosterRecipe(cards, packSize(criteria));

  const byId = new Map(entries.map((entry) => [entry.card.oracleId, entry]));

  try {
    return tallied(cards, byId, criteria, recipe, { drafts, seed });
  } catch (error) {
    // The runtime's own refusals (a pod too small to pass a pack between, a
    // list it cannot deal this recipe from), carried verbatim rather than
    // reworded, because they are statements about the draft and not about the
    // cube. The one refusal that is about the cube is the repeated card above,
    // and it is answered before the runtime is reached.
    if (error instanceof DraftError) return { kind: 'unmeasured', reason: error.message };
    throw error;
  }
}

function draftCount(stated: number | undefined): number {
  const drafts = stated ?? DEFAULT_AVAILABILITY_DRAFTS;
  if (!Number.isInteger(drafts) || drafts < 1) {
    throw new Error(`drafts must be a positive integer, got ${String(drafts)}`);
  }
  return drafts;
}

/** The pack a seat opens, sized so `packs` rounds come to the stated `cardsPerSeat`. */
function packSize(criteria: CubeCriteria): number {
  return Math.max(1, Math.round(criteria.cardsPerSeat / DEFAULT_PACKS_PER_SEAT));
}

function tallied(
  cards: readonly Card[],
  byId: ReadonlyMap<string, CubeEntry>,
  criteria: CubeCriteria,
  recipe: BoosterRecipe,
  bounds: { readonly drafts: number; readonly seed: string },
): AvailabilityMeasured {
  const assembled = new Map<string, number>(criteria.archetypes.map((archetype) => [archetype.name, 0]));

  for (let index = 0; index < bounds.drafts; index += 1) {
    const result = runDraft(cards, {
      seed: `${bounds.seed}/${String(index)}`,
      seats: criteria.seats,
      packs: DEFAULT_PACKS_PER_SEAT,
      recipe,
    });
    for (const pool of draftedPools(result)) {
      for (const archetype of criteria.archetypes) {
        if (!couldAssemble(pool, archetype, byId)) continue;
        assembled.set(archetype.name, (assembled.get(archetype.name) ?? 0) + 1);
      }
    }
  }

  const seatDrafts = bounds.drafts * criteria.seats;
  return {
    kind: 'measured',
    seed: bounds.seed,
    drafts: bounds.drafts,
    seats: criteria.seats,
    packs: DEFAULT_PACKS_PER_SEAT,
    cardsPerSeat: DEFAULT_PACKS_PER_SEAT * recipe.reduce((sum, slot) => sum + slot.count, 0),
    seatDrafts,
    spellsRequired: spellCount(resolveConfig()),
    archetypes: criteria.archetypes.map((archetype) => {
      const count = assembled.get(archetype.name) ?? 0;
      const castable = castableSpells(cards, byId, archetype);
      return {
        name: archetype.name,
        assembled: count,
        share: seatDrafts === 0 ? 0 : count / seatDrafts,
        minShare: archetype.minAvailability ?? null,
        castable: castable.length,
        dealtCastable: dealtCount(cards, castable, recipe, DEFAULT_PACKS_PER_SEAT),
      };
    }),
  };
}

/**
 * The cards an archetype can play as spells, out of the whole list.
 *
 * The color half is `withinArchetype`, the same call `couldAssemble` narrows a
 * drafted pool with, so the ceiling and the measurement cannot disagree about
 * what an archetype can cast. The land half is this file's own: `buildDeck`
 * takes lands from the narrowed pool too, but what it fails for lack of is
 * spells, and a cube's lands would otherwise pad a count that is read against
 * a spell requirement.
 */
function castableSpells(
  cards: readonly Card[],
  byId: ReadonlyMap<string, CubeEntry>,
  archetype: CubeArchetype,
): readonly Card[] {
  return cards.filter((card) => !isLand(card) && withinArchetype(entryFor(byId, card).card, archetype));
}

/**
 * How many of `castable` one seat is dealt across `packs` packs, in expectation.
 *
 * Exact, not estimated. A slot draws `count` cards from its rarity's sheet, so
 * by linearity of expectation it hands over `count x castable-in-that-rarity /
 * sheet` of them however the draws inside a pack are correlated — which is what
 * makes this affordable to state beside every measurement instead of running a
 * second population of drafts to estimate it.
 *
 * The rarity split matters and is not decoration: the recipe is stratified (gap
 * 2 in this file's header), so an archetype whose colors sit mostly in one
 * rarity is dealt a different number from one with the same total spread evenly.
 */
function dealtCount(
  cards: readonly Card[],
  castable: readonly Card[],
  recipe: BoosterRecipe,
  packs: number,
): number {
  const perPack = recipe.reduce((sum, slot) => {
    const sheet = cards.filter((card) => card.rarity === slot.rarity).length;
    if (sheet === 0) return sum;
    const wanted = castable.filter((card) => card.rarity === slot.rarity).length;
    return sum + (slot.count * wanted) / sheet;
  }, 0);
  return packs * perPack;
}

/**
 * Whether one seat's drafted pool fields one archetype.
 *
 * An empty narrowed pool is the ordinary answer for a seat that drafted none of
 * the archetype's colors, so it returns false rather than reaching `buildDeck`,
 * which refuses an empty pool.
 */
function couldAssemble(
  pool: readonly Card[],
  archetype: CubeArchetype,
  byId: ReadonlyMap<string, CubeEntry>,
): boolean {
  const castable = pool.filter((card) => withinArchetype(entryFor(byId, card).card, archetype));
  if (castable.length === 0) return false;
  return buildDeck(castable).complete;
}

function entryFor(byId: ReadonlyMap<string, CubeEntry>, card: Card): CubeEntry {
  const entry = byId.get(card.id);
  if (entry === undefined) throw new UndraftableCubeError(card.name);
  return entry;
}

/**
 * The first card the list holds more than once, by copies or by a second entry,
 * and `undefined` for a list of distinct cards.
 *
 * Both shapes are the same fact about the list and the runtime refuses both, so
 * both are reported the same way. See gap 4 in this file's header for why the
 * refusal is stated here rather than worked around.
 */
function repeatedCard(entries: readonly CubeEntry[]): string | undefined {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.count > 1 || seen.has(entry.card.oracleId)) return entry.card.name;
    seen.add(entry.card.oracleId);
  }
  return undefined;
}

/**
 * The cube as the runtime drafts it: one DSL card per entry, in list order.
 *
 * One per entry rather than one per copy, because a list holding a card more
 * than once never reaches here: `measureAvailability` refuses it above, by the
 * name of the card and the flag that allowed it.
 */
function cubeCards(entries: readonly CubeEntry[], draftable: ReadonlyMap<string, Card>): readonly Card[] {
  return entries.map((entry) => {
    const card = draftable.get(entry.card.oracleId);
    if (card === undefined) throw new UndraftableCubeError(entry.card.name);
    return card;
  });
}

/**
 * A pack whose rarity mix is the cube's own, by largest remainder.
 *
 * The runtime collates by rarity and a cube does not have rarities, so the
 * question is which pack loses the least. A fixed recipe leaves whole sheets
 * unreachable — `SLICE_BOOSTER` has no rare slot, so every rare in the cube
 * would be undraftable and invisible in the numbers — while a pack drawn in the
 * list's own proportions reaches every card and is a stratified sample of the
 * shuffled list the runtime cannot deal directly.
 *
 * Largest remainder rather than rounding each share independently, because
 * independent rounding does not sum to the pack. A rarity is never asked for
 * more cards than its sheet holds, since a share of a pack no larger than the
 * list is never larger than the sheet it came from.
 */
export function cubeBoosterRecipe(cards: readonly Card[], size: number): BoosterRecipe {
  const held = RARITIES.map((rarity) => ({
    rarity,
    cards: cards.filter((card) => card.rarity === rarity).length,
  })).filter((sheet) => sheet.cards > 0);
  if (cards.length === 0 || held.length === 0) return [];

  const exact = held.map((sheet) => ({ ...sheet, share: (sheet.cards * size) / cards.length }));
  const floors = exact.map((sheet) => ({ ...sheet, count: Math.floor(sheet.share) }));
  const spare = size - floors.reduce((sum, sheet) => sum + sheet.count, 0);
  const promoted = new Set(
    [...floors]
      .sort(byRemainderThenRarity)
      .filter((sheet) => sheet.count < sheet.cards)
      .slice(0, Math.max(0, spare))
      .map((sheet) => sheet.rarity),
  );

  return floors
    .map((sheet) => ({
      rarity: sheet.rarity,
      count: Math.min(sheet.cards, sheet.count + (promoted.has(sheet.rarity) ? 1 : 0)),
    }))
    .filter((slot) => slot.count > 0);
}

function byRemainderThenRarity(
  a: { readonly share: number; readonly count: number; readonly rarity: Rarity },
  b: { readonly share: number; readonly count: number; readonly rarity: Rarity },
): number {
  const remainder = b.share - b.count - (a.share - a.count);
  if (remainder !== 0) return remainder;
  return RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity);
}
