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
 * # The overlapping stack, which this file refused and no longer decides
 *
 * Three paragraphs here used to argue against the capture's other half — the
 * columns of overlapping name-and-cost strips with the last card drawn full.
 * The playtester overruled that on 2026-08-29 against three fresh captures, and the
 * argument is answered rather than deleted, in `./strips.ts`: two of the three
 * reasons were about a pane drawn as tiles rather than as strips, and the third
 * (negative margins and a stacking order, which `../../styles/board/zone.ts` has
 * paid for twice) was right and is why the pitch is arithmetic handed to an
 * absolutely-positioned stack instead of a margin.
 *
 * What survives here is one sentence and nothing else. The grouping moved on
 * one axis further to `./grouping.ts`, which every pane reads, and the artifact
 * pane's mana-value special case went with it: `manaValueColumns` lost its last
 * caller in `mtg-pmpu`, when the full grid started reading the pane's grouping
 * the way the columns already did, and a function two tests call is not a
 * second implementation worth keeping.
 */
/**
 * How a column's mana value is written when it is spoken rather than drawn.
 *
 * `curveLabel` is the sentence and takes the two numbers, so the Constructed
 * builder — which counts DSL cards out of a build rather than entries out of an
 * artifact (`./build.ts`'s `manaCurve`) — says the same one instead of a second
 * that could drift from it.
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
