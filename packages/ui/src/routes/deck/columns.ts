/**
 * A pane's cards, grouped into mana-value columns.
 *
 * # What the capture actually shows
 *
 * `references/mtgo+interface+(1)-3169202701.png`, read at 5x and 14x rather than
 * inherited: the Main Deck pane's header says `Main Deck: 60`, and the numbers
 * standing above its six columns are `24 6 13 5 6 6`, which sum to 60. The
 * Sideboard header says 15 and its two columns say 11 and 4. So the number above
 * a column is a **count of cards**, and the counts sum to the number in the pane
 * title. That is the invariant worth keeping, and it is the one that decides the
 * open question in `mtg-9ubz`: cards, not distinct entries.
 *
 * It decides it because the two clients count differently. MTGO draws one strip
 * per *copy* — the fourth column is one card and four copies of a second, five
 * strips, no multiplier anywhere — so there, cards and strips are the same
 * number. Our tile is one per distinct entry with a `4x` on it (`./DeckTile.ts`),
 * so counting tiles would put `13` over a 60-card deck: a number that appears
 * nowhere else on the page and answers no question anybody has. Counting cards
 * keeps the row of numbers summing to the count the pane already states in its
 * own header, which is what makes a row of bare numbers readable at all.
 *
 * # Lands
 *
 * The capture's leftmost column is 24 cards with no cost drawn on any strip, and
 * `Lands: 24` in the same header bar. It is the lands, and it is leftmost because
 * a land's mana value is 0 — not because anything in that client special-cases
 * lands into a column. There is no land rule here either, and there is nothing
 * for one to do: the artifact's producer has already written every entry's mana
 * value down, a land's is 0, and 0 sorts first.
 *
 * That used to be true for a different reason. Until `mtg-o5z1` `../DeckRoute.ts`
 * split the lands out one level up into their own `Nonbasic lands` and `Basics`
 * panes, so no pane this ran over held a land beside a spell and a land pane
 * groups to exactly one column. The panes are now the capture's own two — main
 * deck and sideboard — so a pane does hold both, and the zero column is the
 * capture's leftmost column in the place the capture puts it. Nothing here
 * changed to allow that, which is the point: the rule was never about lands.
 *
 * # What is deliberately not adopted
 *
 * The capture's columns overlap: every card in a column shows only its
 * name-and-cost strip, and the last card in the column is drawn full, which is
 * how six cards fit in the height of two. `mtg-9ubz` asked for that to be
 * measured before adopting, and it is not adopted, for three reasons that are
 * about our page rather than about taste.
 *
 * The stack solves a problem the strip count already solved for us. MTGO stacks
 * because a 60-card deck is 60 strips there; the same deck is 13 tiles here, and
 * the committed fixture's largest pane is 10. Overlapping ten strips saves a few
 * hundred pixels on a pane that already fits.
 *
 * Overlapping means negative margins and a stacking order, and a tile that draws
 * outside its border box then loses whatever the box above it covers. This
 * codebase has paid for that clip twice (`../../styles/board/zone.ts`), and the
 * remedy costs more than the pixels the stack would save.
 *
 * And drawing the last card of each column full is a second density inside a pane
 * whose density control says one thing. `./view-mode.ts` states that a third mode
 * is a bead rather than a quiet addition; a mode that is compact except for six
 * cards is exactly that, arrived at sideways.
 */
import type { DeckArtifactEntry } from '../../lab/deck-artifact';

/**
 * A column of anything, keyed by mana value and counted in cards.
 *
 * Three panes on two routes group by mana value and put a count above the
 * column, and until `mtg-xzxs` each of them wrote the loop out: this file for a
 * built artifact's entries, `./ConstructedBuilder.ts` for the DSL cards of a
 * build, and `../DeckRoute.ts` for a precon's spells paired with their counts.
 * Three implementations of one rule is three places for the count above a column
 * to stop summing to the count in the pane's own header, which is the invariant
 * the docblock above spends its length establishing.
 *
 * Generic over the member rather than over a card, because the three panes hold
 * three different things and none of them is willing to become one of the
 * others: an artifact entry has its mana value already written down by the
 * producer, a DSL card has it derived by `./build.ts`'s `cardManaValue`, and the
 * precon pane holds a `{ card, count }` pair because the count is not on the
 * card. What they share is the grouping and the arithmetic, so that is what is
 * shared.
 */
export interface ManaValueGroup<T> {
  /** The mana value every member of this group shares. */
  readonly manaValue: number;
  /** Cards, not members: the sum of what `weigh` said each member is worth. */
  readonly cards: number;
  /** In the order they arrived, which is the order the pane draws them. */
  readonly members: readonly T[];
}

/**
 * Groups by mana value, ascending, counting cards.
 *
 * `valueOf` is what a member sorts under and `weigh` is what it contributes to
 * the number above the column. Both are the caller's, and they are two functions
 * rather than one because the two questions genuinely differ per pane: the pool
 * pane weighs every card as one, since it lists each playable card once and its
 * header counts those; the deck pane weighs a card as the copies played, since
 * its header counts cards.
 *
 * Present values only, never contiguous. An empty column claims a card belongs
 * there; `./build.ts`'s `manaCurve` is the one drawing that wants the gaps and
 * says why.
 */
export function manaValueGroups<T>(
  members: readonly T[],
  valueOf: (member: T) => number,
  weigh: (member: T) => number,
): readonly ManaValueGroup<T>[] {
  const grouped = new Map<number, T[]>();
  for (const member of members) {
    const value = valueOf(member);
    const held = grouped.get(value);
    if (held === undefined) grouped.set(value, [member]);
    else held.push(member);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([manaValue, members_]) => ({
      manaValue,
      cards: members_.reduce((sum, member) => sum + weigh(member), 0),
      members: members_,
    }));
}

export interface DeckColumn {
  /** The mana value every entry in this column shares. */
  readonly manaValue: number;
  /** Cards, not entries: the sum of the entries' counts. See the docblock. */
  readonly cards: number;
  /** In the order the artifact listed them, which is the order the pane drew them. */
  readonly entries: readonly DeckArtifactEntry[];
}

/**
 * One column per distinct mana value present, ascending.
 *
 * The artifact's own name for a group, kept because `entries` is what the pane
 * that draws these reads and `members` would say less about them. The producer
 * has already written each entry's mana value down, so nothing here derives one.
 *
 * A pure function over entries the page already holds — no schema change, no
 * `DECK_ARTIFACT_VERSION` bump, nothing crosses a package boundary.
 */
export function manaValueColumns(entries: readonly DeckArtifactEntry[]): readonly DeckColumn[] {
  return manaValueGroups(
    entries,
    (entry) => entry.manaValue,
    (entry) => entry.count,
  ).map((group) => ({ manaValue: group.manaValue, cards: group.cards, entries: group.members }));
}

/**
 * How a column's mana value is written when it is spoken rather than drawn.
 *
 * `curveLabel` is the sentence and takes the two numbers, so the Constructed
 * builder — which counts DSL cards out of a build rather than entries out of an
 * artifact (`./build.ts`'s `manaCurve`) — says the same one instead of a second
 * that could drift from it. `columnLabel` is the same sentence about a column.
 *
 * The visible head draws the value as a mana symbol through the same registry the
 * card face and the tile's own cost use (`../../card/symbols.ts`), because a bare
 * number above a column of three-drops reading `3` is ambiguous between the value
 * and the count — the capture gets away with it only because none of its six
 * counts could be mistaken for a mana value. A symbol cannot be mistaken for a
 * count, so the two numbers stay one glance apart.
 *
 * A screen reader gets this sentence instead, because a pip's accessible name is
 * the pip and not what a column of them means.
 */
export function curveLabel(manaValue: number, cards: number): string {
  return `Mana value ${String(manaValue)}, ${String(cards)} ${cards === 1 ? 'card' : 'cards'}`;
}

export function columnLabel(column: DeckColumn): string {
  return curveLabel(column.manaValue, column.cards);
}
