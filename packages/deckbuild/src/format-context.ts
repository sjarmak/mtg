/**
 * What the rest of the format is made of, counted so a price can read it.
 *
 * `deck-context.ts` answers the questions a deck decides about itself. Three
 * prices are decided by the *other* deck instead, and this module is the answer
 * side for those:
 *
 *  - **`landwalk`** is live exactly when the opponent plays the named basic
 *    land type, which follows from the colors they play.
 *  - **`protection` from a color** is live against the share of opposing decks
 *    that play that color.
 *  - **`protection` from a creature subtype** is live against the share of the
 *    format's creatures that carry it.
 *  - **`intimidate`** is live against the share of the format's creatures that
 *    can neither block it by color nor block it as an artifact.
 *
 * Each of them shipped as a constant standing in for a census that nobody had
 * run: 0.6 (`enabledWhileFactor`) for landwalk and again for intimidate, 2/5
 * folded into `protection`'s body share for a color, and 0.5
 * (`staticSubtypeReachFactor`) for a subtype. `config.ts`'s
 * `DEFAULT_KEYWORD_ABILITY_VALUE` names them as priors and says what would
 * replace them; this is that census, and the constants stay as the answer for a
 * caller that states no set.
 *
 * ## What a color share means, and why it is not the pool's share
 *
 * "The share of the format's decks expected to play this color." A deck covers
 * `COLORS_PER_DECK` of the five, and it picks them where the playables are, so
 * a color that is a fifth of the format's colored cards is on two fifths of its
 * decks and a color that is half of them is on more. That makes the shipped 2/5
 * the even-format reading of this census rather than a number it replaces: on a
 * set with five equal colors, `2 * (1/5)` is exactly 0.4.
 *
 * Clamped at 1, because a mono-color format is one every deck plays that color
 * in, not one where each deck plays it twice.
 *
 * ## Why the whole set and never the pool
 *
 * A sealed pool is six boosters, and six boosters are a sample of the format
 * rather than the format. `DeckBuildConfig.set` already draws this distinction
 * for the basics the mana base plays, for the same reason and in the same
 * words: a caller that knows the set says so, and a caller that does not gets
 * the constants. Reading colors off a pool would make protection from red worth
 * more in a pool that opened red cards, which is a fact about six packs.
 *
 * `formatContextOf` is in `deck-context.ts` rather than here, because the
 * creature census is that module's walk over a card list and a second walk is a
 * second answer to "what puts a Merfolk on the battlefield".
 */
import type { BasicLandType, Card, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR } from '@mtg/dsl';

/**
 * How many of the five colors one deck of this format covers.
 *
 * Two, because that is what this builder builds: `color-pair.ts` ranks every
 * `ColorPair` and `buildDeck` plays the winner, and a `ColorPair` is a pair.
 * `test/format-context.test.ts` pins the number to `COLOR_PAIRS` rather than
 * leaving two derivations of the same fact to drift.
 */
export const COLORS_PER_DECK = 2;

export interface FormatContext {
  /** The share of the format's decks expected to play each color. */
  readonly colorShares: Readonly<Record<Color, number>>;
  /**
   * The share of the format's creatures carrying each subtype.
   *
   * A subtype nobody prints is absent rather than zero-valued, and
   * `formatSubtypeShare` reads an absence as the zero it is: a format with no
   * Merfolk in it is one where protection from Merfolk stops nothing, which is a
   * measurement and not a missing answer.
   */
  readonly creatureSubtypeShares: ReadonlyMap<string, number>;
  /**
   * The share of the format's creatures that can block only by sharing a color,
   * keyed by `colorKey` over the colors they can share it with.
   *
   * The key is the union of the colors a card's creatures print, because the
   * question asked of it is "can this card block that attacker", and a card
   * that mints a blue token can block a blue creature whatever color the card
   * itself is.
   *
   * A card whose creatures include an artifact one is absent from this map and
   * still counted in the denominator, so the shares here sum to less than one
   * by exactly the format's artifact-creature share. That is the point rather
   * than a rounding: CR 702.13a lets an artifact creature block an intimidator
   * regardless of color, so it belongs to no color's entry and to every
   * attacker's blockers.
   */
  readonly colorBlockerShares: ReadonlyMap<string, number>;
}

/**
 * The one spelling of a set of colors that `colorBlockerShares` is keyed by.
 *
 * Deduplicated, sorted and concatenated, so `WU` and `UW` and `UWU` are one
 * key. Single characters throughout, which is what lets `formatIntimidateShare`
 * ask whether a key holds a color with `includes` rather than by splitting it
 * back apart. `deck-context.ts` builds the keys and this module reads them; the
 * spelling lives here so there is one of it.
 */
export function colorKey(colors: readonly Color[]): string {
  return [...new Set(colors)].sort().join('');
}

/**
 * Each color's share of the format's decks, from the set's own card list.
 *
 * The denominator is card-color incidences rather than cards: a gold card is
 * played by decks of both its colors and counts once for each, and a colorless
 * card is played by all of them and constrains none, so it counts for none.
 *
 * A set with no colored cards at all measures zero for every color. That is the
 * honest reading and not a division guard standing in for one — no deck in such
 * a format needs a basic land type, so no landwalk in it is ever live.
 */
export function colorSharesOf(set: readonly Card[]): Readonly<Record<Color, number>> {
  const incidence = new Map<Color, number>();
  let total = 0;
  for (const card of set) {
    for (const color of card.colors) {
      incidence.set(color, (incidence.get(color) ?? 0) + 1);
      total += 1;
    }
  }
  const share = (color: Color): number =>
    total === 0 ? 0 : Math.min(1, (COLORS_PER_DECK * (incidence.get(color) ?? 0)) / total);
  // Written out rather than mapped over `COLORS`, so a sixth color would be a
  // compile error here instead of a silently missing key.
  return { W: share('W'), U: share('U'), B: share('B'), R: share('R'), G: share('G') };
}

/** The share of the format's decks that play a color. */
export function formatColorShare(format: FormatContext, color: Color): number {
  return format.colorShares[color];
}

/**
 * The share of the format's decks a landwalk is live against.
 *
 * A deck plays the basic land type its colors need, so this is the color's own
 * share read through `BASIC_LAND_COLOR`. It overstates for a deck that plays
 * the color out of nonbasic lands and understates for one splashing a basic it
 * barely casts off; both are smaller than the gap between measuring the format
 * and assuming 0.6 of it.
 */
export function formatLandwalkShare(format: FormatContext, landType: BasicLandType): number {
  return formatColorShare(format, BASIC_LAND_COLOR[landType]);
}

/**
 * The share of the format's creatures an intimidate on these colors gets past.
 *
 * CR 702.13a: a creature with intimidate can be blocked only by artifact
 * creatures and by creatures that share a color with it. So this sums the
 * shares of every entry whose key holds none of the attacker's colors, which is
 * the format's creatures minus the ones that share a color minus the artifact
 * ones `colorBlockerShares` leaves out.
 *
 * Exact rather than a union of per-color shares: the census is keyed by the
 * whole color identity a card can block with, so a two-color attacker is read
 * off the same count of cards a one-color attacker is, and no independence
 * between the colors has to be assumed. Reading it as `1 - (share of W) -
 * (share of U)` would double-subtract every card that prints both.
 *
 * A colorless intimidator shares a color with nothing, so it is live against
 * everything except the artifact creatures, which is what the rule says and not
 * a degenerate case of it. A format with no creatures measures zero for every
 * attacker: an empty map sums to nothing, and a creature that nothing can block
 * in a format with nothing to block it is still worth nothing to attack past.
 */
export function formatIntimidateShare(format: FormatContext, colors: readonly Color[]): number {
  let live = 0;
  for (const [key, share] of format.colorBlockerShares) {
    if (!colors.some((color) => key.includes(color))) live += share;
  }
  return Math.min(1, live);
}

/** The share of the format's creatures carrying a subtype; absent is zero. */
export function formatSubtypeShare(format: FormatContext, subtype: string): number {
  return format.creatureSubtypeShares.get(subtype) ?? 0;
}
