/**
 * The order a pack is read in: rarest first, deal order inside a rarity, or
 * best rated first where the format has a rating for its cards.
 *
 * A booster arrives in collation order — the common sheet, then the uncommons,
 * then whatever the rare slot opened — which is the order a printer produces
 * cards in and not the order a player reads them. The card that decides most
 * first picks was landing wherever the deal put it, which at 844x390 is often
 * the last row of a grid that has to be scrolled to. the playtester asked for the
 * rarest in the upper left, so this is the one place the drawing order is
 * decided and `./DraftPack.ts` reads it.
 *
 * # Why a position rather than a card
 *
 * A pack position is the identity of a face on that screen — `./DraftPack.ts`'s
 * `Selection` argues it at length: a pack of commons can hold two copies of one
 * card, so an id would light both of them up. Sorting cards alone and letting
 * the drawing loop hand out fresh indices would therefore point every selection
 * at whatever the sort moved into that slot, and the screen would read the rare
 * while the button picked a common. The dealt index travels with the card.
 *
 * # Why the deal order survives inside a rarity
 *
 * Ten commons have no rarity order between them, and inventing one (by name, by
 * mana value) would reshuffle the ten cards a player is actually deciding
 * between every time a pack redraws. `RARITIES` is ascending, so the comparison
 * is reversed here rather than a second table being written down; a rarity the
 * DSL does not know sorts last, which is where an unreadable answer belongs.
 *
 * # Ordering by rating
 *
 * `packOrderByRating` is the same judgment with a rating in front of it, for a
 * format that stages one (the playtester, 2026-09-20: "ordered by limited rating").
 * It does not restate the rarity order; it sorts the rarity order, stably, so
 * two cards of equal rating are read the way `packOrderBy` reads them, and two
 * equal in rarity too are in the order the pack dealt them. Forge's ranks are
 * coarse and tie often, and falling back to the existing order is what keeps a
 * pack from being arbitrary inside a tie.
 *
 * A card with no rating sorts after every rated one, and after a rating of
 * zero. Zero is a stated judgment that the card is weak; `null` is the source
 * saying nothing, and reading it as zero would invent a rating, which ADR-0005
 * names as the failure (§3: "inventing" human data). A format staging no
 * ranking at all answers `null` for every card, every comparison is then a tie,
 * and the pack is drawn in `packOrderBy`'s order unchanged.
 */
import { RARITIES } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';

/** One card and the slot the pack dealt it into. */
export interface PackPosition<CardType = Card> {
  readonly card: CardType;
  /** The index in the dealt pack, which is what a selection names. */
  readonly index: number;
}

/** Rarest first. Ascending in the DSL's own list, so the rank is its reverse. */
function rank(rarity: string | null): number {
  const found = rarity === null ? -1 : (RARITIES as readonly string[]).indexOf(rarity);
  return found < 0 ? -1 : found;
}

/**
 * The pack, most rare first, each card still carrying the slot it was dealt to,
 * for any card a rarity can be read off.
 *
 * Generic over the card because the printed-format draft deals booster copies
 * of real printings rather than DSL cards, and its rarity lives in the format's
 * display metadata rather than on the card; the accessor is where that lookup
 * goes. `null` is a card with no stated rarity, and it sorts after every stated
 * one, which is where an unreadable answer belongs.
 *
 * A copy is sorted rather than the caller's array: the pack belongs to the
 * draft in progress and this function only decides how it is read.
 */
export function packOrderBy<CardType>(
  cards: readonly CardType[],
  rarityOf: (card: CardType) => string | null,
): readonly PackPosition<CardType>[] {
  const positions: PackPosition<CardType>[] = cards.map((card, index) => ({ card, index }));
  // Stable, so the deal order is what remains inside a rarity.
  return [...positions].sort((left, right) => rank(rarityOf(right.card)) - rank(rarityOf(left.card)));
}

/**
 * Higher rating first, and no rating after every rating. `null` against `null`
 * is a tie, as is one number against itself, so the stable sort keeps whatever
 * order the caller had already put those cards in.
 */
function compareRating(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/**
 * The pack, best rated first, each card still carrying the slot it was dealt to.
 *
 * `ratingOf` answers a number for a card the format's source ranks and `null`
 * for one it does not; it is read once per card rather than once per comparison,
 * since the source may be a scan of a staged catalog. Ties, including every card
 * of a pack with nothing ranked, are left in `packOrderBy`'s order.
 */
export function packOrderByRating<CardType>(
  cards: readonly CardType[],
  ratingOf: (card: CardType) => number | null,
  rarityOf: (card: CardType) => string | null,
): readonly PackPosition<CardType>[] {
  const rated = packOrderBy(cards, rarityOf).map((position) => ({
    position,
    rating: ratingOf(position.card),
  }));
  // Stable, so the rarity order (and inside it the deal order) is what remains
  // inside a rating.
  return rated
    .sort((left, right) => compareRating(left.rating, right.rating))
    .map(({ position }) => position);
}

/** The kernel draft's pack: a DSL card carries its own rarity. */
export function packOrder(cards: readonly Card[]): readonly PackPosition[] {
  return packOrderBy(cards, (card) => card.rarity);
}
