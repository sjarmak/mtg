/**
 * The deck view: art tiles and the mana-base table.
 *
 * The tile borrows the card sheet's `--edge` and `--panel` channels by carrying
 * the same `data-identity` attribute, so a red card's tile is edged and grounded
 * red without this file knowing a color name — the rule that makes that work is
 * generated in `card.ts` across both selectors. Both channels are read through a
 * fallback rather than bare: a tile is rendered from a decklab entry, and an
 * entry whose color identity the sheet has no rule for still has to draw.
 *
 * The mana base is a table and not a row of tiles for the reason stated in
 * `views.ts`: a castability number without the sources it was computed from and
 * the card that demanded them is a vibe, and the whole point of the panel is
 * that those three travel together.
 */

const DECK = `
.mtg-deck { display: flex; flex-direction: column; gap: var(--mtg-space-5); }
.mtg-deck__plan {
  margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
  max-width: var(--mtg-measure); white-space: pre-wrap;
}
/* The criteria the whole deck shares, said once instead of on every tile. */
.mtg-deck__shared {
  margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint);
  max-width: var(--mtg-measure);
}
.mtg-deck__section { display: flex; flex-direction: column; gap: var(--mtg-space-3); }
/*
 * The main deck and the cards set aside, side by side (mtg-o5z1).
 *
 * Two tracks rather than "auto-fit", because the two panes are not
 * interchangeable and their widths should not be: the capture's main deck holds
 * six mana-value columns and its sideboard two, and a 3:1 split is that ratio.
 * A track is "minmax(0, Nfr)" and not "Nfr" for the reason the column grid below
 * records -- an "fr" track has an "auto" minimum, so one long card name inside a
 * pane would push that pane wider than its share and take the width out of its
 * neighbor.
 *
 * The template is attached to "data-panes='2'" rather than to the container,
 * because a page told about no sideboard draws one pane and a two-track template
 * would give that pane three quarters of the width and leave a quarter of the
 * page empty. The attribute is written by "../routes/DeckRoute.ts", which is the
 * only thing that knows whether the document carried the field.
 *
 * They stack under 1024px. That number is reasoned rather than measured: a
 * column track is capped at 13rem, so a quarter-width sideboard is one track and
 * the main deck's three quarters is four -- under a curve with six values, which
 * wraps, and a mana curve that wraps is not a curve. Nothing here was run through
 * "../../tools/deck-density.ts"; when it is, this is the number to check.
 */
.mtg-deck__panes { display: grid; gap: var(--mtg-space-5); align-items: start; }
.mtg-deck__panes[data-panes='2'] { grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); }
@media (max-width: 1024px) {
  .mtg-deck__panes[data-panes='2'] { grid-template-columns: minmax(0, 1fr); }
}
/* A pane with no cards says so where the cards would be, not in its header. */
.mtg-deck__empty { font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint); }
/*
 * The pane header stays in reach for the whole length of its pane (mtg-n4d3).
 *
 * The bug it fixes: the header holds the pane's name, its count and its View
 * control, and a pane is as tall as its cards, so scrolled into the middle of the
 * spells you had a page of cards belonging to a pane whose only control was three
 * screens up. The capture does not have this because its panes are fixed-height
 * boxes that scroll inside a window that never does; that is a property of an app
 * frame, not of a pane, and half of it -- fixed-height panes inside a document
 * that still scrolls -- buys three nested scroll regions and none of the benefit.
 * So the header sticks and the page keeps one scroll region. The frame is filed.
 *
 * "top" is not zero, because there is already a sticky element there:
 * "./base.ts" pins ".mtg-shell__bar" at "top: 0; z-index: 2", so a pane header at
 * zero slides under an opaque bar that outranks it and the fix looks exactly like
 * the bug. The 3.5rem is that bar: 56px against a measured 55.8, in
 * chrome-headless-shell 151 through "../../tools/deck-density.ts", which reports
 * the bar's height beside every other number for exactly this reason. It is
 * written as a length rather than as a token because it is not one -- it is one
 * route's measurement of another element, and "tokens.ts" is the design
 * vocabulary the whole app shares.
 *
 * It is spent as an offset a step short of the bar plus a matching
 * "padding-block-start", rather than as "top" alone, and the difference is not
 * cosmetic. Sticky pins the *border* box; padding is inside it. So the border box
 * sits under the bar and the header's own text lands exactly at the bar's lower
 * edge, and any error in the measurement is absorbed by background that is behind
 * an opaque bar. Setting "top" to the height directly would put the error in the
 * gap between the two instead, where it reads as a sliver of scrolling card.
 *
 * The background is required rather than decoration: a transparent header would
 * have cards sliding under its text.
 *
 * Below 450px the bar stops having one height and the header stops sticking. The
 * first guess here was a 720px breakpoint mirroring the one "base.ts" writes, and
 * measurement said no twice over: the bar is 55.8px unbroken from 1440 down to
 * 450, and under that it does not settle on a second value either -- 67.8 at 440,
 * 89.6 at 420, 101.6 at 360, because the mode pills wrap one at a time. A chain
 * of offsets guessing at that is a chain of chances to hide the header behind an
 * opaque bar, which is worse than the bug: a header that scrolled away can be
 * found by scrolling back, and one covered by a bar cannot be found at all. So on
 * a viewport that narrow the header is static and honest.
 */
.mtg-deck__section-head {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--mtg-space-3);
  position: sticky; top: calc(3.5rem - var(--mtg-space-3)); z-index: 1;
  background: var(--mtg-surface-page);
  padding-block: var(--mtg-space-3) var(--mtg-space-2);
  margin-block-start: calc(var(--mtg-space-3) * -1);
}
@media (max-width: 450px) {
  .mtg-deck__section-head { position: static; }
}
.mtg-deck__section-title {
  font-size: var(--mtg-text-xs); text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--mtg-ink-faint); font-weight: 600;
}
.mtg-deck__section-note { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
/*
 * The density control sits at the end of its pane's header, which is where the
 * MTGO capture puts every Sort/View pair: hard right on the pane's own bar, so
 * the same header holds what the pane is on the left and how it is drawn on the
 * right. "margin-left: auto" rather than "justify-content: space-between",
 * because the header wraps and a wrapped "space-between" strands the title.
 *
 * "align-self: center" against the header's "align-items: baseline": a button
 * has a baseline and aligning to it hangs the box below the heading's.
 */
.mtg-deck__view { display: flex; margin-left: auto; align-self: center; }
.mtg-deck__view-btn { font-size: var(--mtg-text-xs); }
/* One control, two halves: the seam between them is a single shared border. */
.mtg-deck__view-btn:first-child { border-start-end-radius: 0; border-end-end-radius: 0; }
.mtg-deck__view-btn:last-child {
  border-start-start-radius: 0; border-end-start-radius: 0; margin-inline-start: -1px;
}
/* The pressed half draws its own edge, so it must sit above its neighbor's. */
.mtg-deck__view-btn[aria-pressed='true'] { position: relative; z-index: 1; }
.mtg-deck__grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: var(--mtg-space-4);
}
/*
 * A compact pane is the mana curve, one column per value (mtg-9ubz).
 *
 * The track count is data and arrives as an inline "grid-template-columns" from
 * "../routes/DeckRoute.ts"; the rule here is the floor a page without that style
 * attribute falls back to, and it is one column rather than the full grid's
 * auto-fill run, because a compact pane's children are columns and an auto-fill
 * run would lay the columns out as though they were cards.
 *
 * A track is capped at 13rem and floored at nothing: "minmax(0, 13rem)". The cap
 * is the full grid's own width floor, so a column of strips comes out the width
 * of a card, which is what the capture's columns are. It is load-bearing rather
 * than tidy -- an uncapped "1fr" track gave the one-column land panes a single
 * 1377px strip at 1440 wide, a name at the far left and a cost at the far right
 * with a mile of nothing between them, which is worse than what those panes drew
 * before columns existed. The floor of zero is what keeps a seven-value curve
 * inside a 1024px viewport instead of handing the pane a horizontal scrollbar;
 * the compact tile already truncates its name and its type line to one row each.
 * Columns that do not fill the pane leave the rest of it empty, which is what the
 * capture does too.
 *
 * The gap drops a step from the full grid for the same reason a decklist is set
 * tighter than a page of prose: the tiles are rows now, and rows that far apart
 * read as unrelated. The columns align at their tops rather than stretching, so a
 * short column is short instead of being padded out to its tallest neighbor.
 */
.mtg-deck__grid[data-view='compact'] {
  grid-template-columns: repeat(1, minmax(0, 13rem));
  justify-content: start;
  gap: var(--mtg-space-3);
  align-items: start;
}
.mtg-deck__column { display: flex; flex-direction: column; gap: var(--mtg-space-1); min-width: 0; }
/*
 * The count sits above its column, which is the capture's own arrangement, and it
 * is drawn beside the column's mana value as a pip rather than alone as a number.
 * A bare "3" above three three-drops is ambiguous between the value and the
 * count; the capture escapes that only because none of its counts (24, 6, 13, 5,
 * 6, 6) could be read as a mana value. The pip comes from the same registry the
 * card face and the tile's own cost use, so this adds no vocabulary.
 */
.mtg-deck__column-head {
  display: flex; align-items: center; justify-content: center; gap: var(--mtg-space-2);
  padding-block-end: var(--mtg-space-1);
  border-bottom: 1px solid var(--mtg-line);
}
.mtg-deck__column-value { display: inline-flex; align-items: center; }
.mtg-deck__column-count {
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 700;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}
`;

const TILE = `
.mtg-deck-card {
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-2);
  background: var(--panel, var(--mtg-surface-raised));
  border: 1px solid var(--edge, var(--mtg-line));
  border-radius: var(--mtg-radius-md);
  box-shadow: var(--mtg-shadow-raised);
}
.mtg-deck-card__head { display: flex; align-items: baseline; gap: var(--mtg-space-2); }
.mtg-deck-card__count {
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 700;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}
.mtg-deck-card__name { flex: 1; min-width: 0; font-size: var(--mtg-text-sm); font-weight: 600; }
.mtg-deck-card__cost {
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
  white-space: nowrap;
}
.mtg-deck-card__type { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-deck-card__reason { margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink); }
.mtg-deck-card__foot {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-1) var(--mtg-space-2);
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
}
.mtg-deck-card__cite {
  font-family: var(--mtg-font-mono);
  padding: 0 var(--mtg-space-1);
  background: var(--mtg-surface-inset); border-radius: var(--mtg-radius-sm);
}
.mtg-deck-card__price { margin-left: auto; font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; }
/*
 * A compact tile is a strip, and it is drawn by tightening what is left rather
 * than by hiding anything: "DeckTile" builds a shorter tree, so there is no rule
 * here setting anything to "display: none" and no region the sheet and the DOM
 * can disagree about.
 *
 * The name gets "text-overflow: ellipsis" in this mode and only this one. A full
 * tile has a whole column's width and a card whose name wraps to two lines costs
 * it nothing; a strip is one row by construction, and a name that wraps there
 * doubles the height of that one tile and knocks the grid's rows out of step.
 *
 * A truncated name has to be recoverable, and it is twice over. "DeckTile" puts
 * the full name in the strip's "title" attribute, which is the same place
 * "../card/anatomy.ts" put the collector line when the footer left the full face.
 * That is pointer-only, so it is the convenience rather than the answer: the
 * answer is that the whole pane goes back to full in one press, and the text
 * node itself is never truncated, so a screen reader and a page search both read
 * the whole name whatever the box is doing.
 */
.mtg-deck-card[data-view='compact'] {
  gap: 0;
  padding: var(--mtg-space-1) var(--mtg-space-2);
  box-shadow: none;
}
.mtg-deck-card[data-view='compact'] .mtg-deck-card__name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mtg-deck-card[data-view='compact'] .mtg-deck-card__type {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--mtg-ink-faint);
}
`;

const MANA = `
.mtg-mana { display: flex; flex-direction: column; gap: var(--mtg-space-3); }
.mtg-mana__scroll { overflow-x: auto; }
.mtg-mana__table { border-collapse: collapse; width: 100%; font-size: var(--mtg-text-sm); }
.mtg-mana__table th, .mtg-mana__table td {
  padding: var(--mtg-space-2) var(--mtg-space-3);
  border-bottom: 1px solid var(--mtg-line); text-align: right; white-space: nowrap;
}
.mtg-mana__table th {
  font-size: var(--mtg-text-xs); font-weight: 600; color: var(--mtg-ink-muted);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.mtg-mana__table th:first-child, .mtg-mana__table td:first-child { text-align: left; }
.mtg-mana__table td:last-child, .mtg-mana__table th:last-child { text-align: left; white-space: normal; }
.mtg-mana__table td { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; }
.mtg-mana__color { display: inline-flex; align-items: center; gap: var(--mtg-space-2); font-family: var(--mtg-font-ui); }
.mtg-mana__row[data-meets='false'] { background: var(--mtg-surface-inset); }
.mtg-mana__cast { font-weight: 700; }
.mtg-mana__row[data-meets='true'] .mtg-mana__cast { color: var(--mtg-positive); }
.mtg-mana__row[data-meets='false'] .mtg-mana__cast { color: var(--mtg-negative); }
.mtg-mana__binding { font-family: var(--mtg-font-ui); color: var(--mtg-ink-muted); }
.mtg-mana__binding-card { color: var(--mtg-ink); font-weight: 600; }
.mtg-mana__caption {
  margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); max-width: var(--mtg-measure);
}
.mtg-mana__shortfalls {
  margin: 0; padding-left: var(--mtg-space-5);
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  font-size: var(--mtg-text-sm); color: var(--mtg-ink);
}
.mtg-mana__shortfalls li::marker { color: var(--mtg-negative); }
`;

export const DECK_CSS = `${DECK}${TILE}${MANA}`;
