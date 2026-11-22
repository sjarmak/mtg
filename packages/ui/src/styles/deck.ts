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
import { cssNumber, MICRO_LABEL } from './number';
import { SCREEN_QUERY, SPLIT_THICKNESS_PX } from './panel';
import { STACK_BOX_FROM_PANE, STACK_BOX_SOURCE_PROPERTY } from './stack-box';

/**
 * The narrowest screen the deck and the pool are drawn side by side on.
 *
 * Between this and the portrait phone's 40rem sits a screen with room for one
 * column of card faces and no more; the BUILDER block below argues the rest.
 */
export const BUILDER_SPLIT_MIN_REM = 48;

/**
 * The condition under which a deckbuilder's two panes sit side by side.
 *
 * The second clause is the landscape phone (mtg-aqxi.4): 844x390, wide enough
 * for two columns and short enough that a width-only threshold set at a desk's
 * 64rem would hand it the portrait arrangement.
 */
export const BUILDER_SPLIT_QUERY = `(min-width: 64rem), (min-width: ${cssNumber(BUILDER_SPLIT_MIN_REM)}rem) and ${SCREEN_QUERY}`;

/**
 * The shortest screen a deckbuilder is drawn as a frame of boxes on.
 *
 * A pane is not just its cards: it carries a header, and above its scrollport
 * the deck pane draws the curve and the basics and the pool pane draws the
 * filters, which come to about 180px together. So the height a frame needs is
 * that twice over -- the chrome above the panes, capped at two fifths, and then
 * a pane's own apparatus -- before the first card face has anywhere to be.
 *
 * Measured rather than reasoned: framed at 844x390 the panes were 162px tall
 * and every scrollport inside them measured zero, and the same at 390x844. That
 * is a deckbuilder with no cards in it, which is worse than one that scrolls.
 * At 1024x640 they are 74 and 100, which is not zero and is still about a
 * quarter of one card face -- a pool you can only ever see a sliver of is worse
 * than a page you scroll. At 1024x768 they are 151 and 177 and the thing works,
 * so the floor is 48rem, and it is the same 48 as BUILDER_SPLIT_MIN_REM by
 * arithmetic rather than by argument.
 */
export const BUILDER_FRAME_MIN_BLOCK_REM = 48;

/**
 * The condition under which a deckbuilder is a frame rather than a document.
 *
 * Both halves are necessary and neither is BUILDER_SPLIT_QUERY: the panes have
 * to be side by side, because a frame over stacked panes divides one screen's
 * height between two of them, and the screen has to be tall enough to divide.
 * The split query says yes to a landscape phone on purpose; this one says no to
 * it for the same reason, which is why they are two constants.
 */
export const BUILDER_FRAME_QUERY = `(min-width: 64rem) and (min-height: ${cssNumber(BUILDER_FRAME_MIN_BLOCK_REM)}rem)`;

/**
 * How the sealed workbench divides its height, as the two numbers behind it.
 *
 * `mtg-8osf` argued two fifths of pool against three fifths of deck, and that
 * one decision is now stated in three places that have to agree: the pool
 * track's floor, the `fr` that lets it take back what the deck is not using,
 * and the share `../routes/deck/builder-split.ts` announces on the divider's
 * handle. Naming the two integers here is what keeps them one decision -- a
 * share typed a second time as `0.4` goes on reading right long after somebody
 * moves a track to `4fr`.
 */
const BUILDER_POOL_FR = 2;
const BUILDER_DECK_FR = 3;

/** The pool's share of that workbench, which `builder-split.ts` announces. */
export const BUILDER_POOL_SHARE = BUILDER_POOL_FR / (BUILDER_POOL_FR + BUILDER_DECK_FR);

/**
 * The least the pool may be squeezed to by a deck that is being cut.
 *
 * `mtg-d9f4`. The share is a floor rather than a size: the deck row below sizes
 * to what the deck holds, so a deck shorter than its share hands the difference
 * back, and this is what stops a long one from taking the workbench with it.
 *
 * A share *of the room the two panes divide*, so the gutter comes off first --
 * one divider and the two gaps around it, the same 32px `BUILDER_SPLIT_FLOORS`
 * subtracts for the same reason. Without that the floor is a share of the
 * container, and the pool keeps a little of the deck's share on every screen.
 *
 * The percentage resolves against the grid's own block size, which is definite:
 * the panes are a `flex: 1 1 0` item of a frame that has a height. It has to be
 * this track function rather than a `fit-content()` cap on the deck's, which is
 * the arrangement this was written as first and measured wrong -- Chrome treats
 * the percentage inside `fit-content()` as indefinite here and the cap silently
 * becomes `auto`, so a 90-card selection took 74.7% of the workbench and left
 * the pool a 56px scrollport. The other arrangement that works, size
 * containment on the panes plus `cqb`, is forbidden by `./card.ts`: the floating
 * preview is `position: fixed` and nothing between the shell and a pane may
 * carry layout containment.
 */
const BUILDER_POOL_TRACK = `minmax(calc((100% - var(--mtg-space-3) * 2 - ${String(SPLIT_THICKNESS_PX)}px) * ${cssNumber(BUILDER_POOL_SHARE)}), ${cssNumber(BUILDER_POOL_FR)}fr)`;

/**
 * The deck row: what the pane holds, and no more.
 *
 * `max-content` rather than `auto`, and the difference is that grid stretches an
 * `auto` track into leftover space when `align-content` is normal -- which is
 * this grid, and would have handed the slack straight back to the deck. The
 * floor is 0 and the pane's own scrollport is what absorbs a deck too long for
 * the room the floor above leaves it.
 */
const BUILDER_DECK_TRACK = `minmax(0, max-content)`;

const DECK = `
/* The library's set shelves (mtg-tewc.6): the sets under one taxonomy heading.
 *
 * Only spacing. The heading is ".mtg-group__title" and the grid is
 * ".mtg-deckcards", both already defined and both drawn identically wherever a
 * deck is offered; what a nested shelf needs that a flat one did not is room
 * between one set and the next, since two grids of tiles with nothing between
 * them read as one grid with a caption in the middle of it. */
.mtg-decklib__sets { display: flex; flex-direction: column; gap: var(--mtg-space-4); }
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
/*
 * Everything about a deck that is not its cards, opened by the head's button.
 *
 * A panel rather than a run of loose blocks: closed it costs nothing, and open
 * it has to read as one thing the reader asked for rather than as three
 * paragraphs that came back. The inset well is what says so, and it is the
 * page's own, not a new color.
 */
.mtg-deck__details {
  display: flex; flex-direction: column; gap: var(--mtg-space-3);
  padding: var(--mtg-space-4);
  background: var(--mtg-surface-inset); border-radius: var(--mtg-radius-md);
}
/* Said once at the top of that panel when a count has moved: everything under
   it describes the deck as it was built (../routes/deck/DeckFacts.ts). */
.mtg-deck__built-note {
  margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint);
  max-width: var(--mtg-measure);
}
/*
 * The deck's live numbers, and the one move it has to refuse (mtg-ipse).
 *
 * Two rows at most and never more: mtg-z4q6 measured what a block above the
 * columns costs and moved this page's prose behind a disclosure to buy the
 * height back, so what is drawn here has to earn its rows against the cards it
 * pushes down. The line wraps rather than scrolling, for the selection bar's
 * reason -- a horizontal scrollbar above the columns hides the half of a number
 * nobody knows is missing.
 */
.mtg-deck__facts {
  display: flex; flex-wrap: wrap; align-items: baseline;
  gap: var(--mtg-space-1) var(--mtg-space-3);
}
.mtg-deck__facts-line {
  font-size: var(--mtg-text-sm); font-variant-numeric: tabular-nums;
}
/* The sentence under a button that is dark on purpose. It takes the whole row
   ("flex-basis: 100%") so it reads as the reason for the button rather than as
   another figure on the line. */
.mtg-deck__facts-reason,
.mtg-deck__facts-built {
  flex-basis: 100%; margin: 0;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
  max-width: var(--mtg-measure);
}
/* The cards cut to nothing, above the columns they left. Same well as the
   selection bar, because it is the same kind of thing: a pane's own row about
   the cards, outside the box that scrolls. */
.mtg-deck__cuts {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--mtg-space-2);
  padding: var(--mtg-space-2);
  border: 1px dashed var(--mtg-line); border-radius: var(--mtg-radius-sm);
}
.mtg-deck__cuts-name {
  font-size: var(--mtg-text-sm); font-weight: 600; color: var(--mtg-ink-muted);
}
/* One pane of a deck screen, wherever one is drawn: a header bar, whatever rows
   that pane keeps fixed, and the box of cards that scrolls. "min-width: 0"
   because a pane is a grid track's child and a track's automatic minimum is its
   content, so a column strip inside it would widen the track rather than
   scroll. */
.mtg-deck__pane {
  display: flex; flex-direction: column; gap: var(--mtg-space-3); min-width: 0;
}
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
/* The one-pane track is floored the same way the two-pane tracks below already
   are, and for the reason they are: a pane holds a row of strip columns that
   never wraps, so its max-content width is every column side by side -- 900px
   for a 60-card deck at four columns. An implicit "auto" track sizes to that
   and the grid then runs past its own container, which on a phone put the
   pane's density control off the right edge of the frame. */
.mtg-deck__panes { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--mtg-space-5); align-items: start; }
.mtg-deck__panes[data-panes='2'] { grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); }
@media (max-width: 1024px) {
  .mtg-deck__panes[data-panes='2'] { grid-template-columns: minmax(0, 1fr); }
}
/* A pane with no cards says so where the cards would be, not in its header. */
.mtg-deck__empty { font-size: var(--mtg-text-sm); color: var(--mtg-ink-faint); }
/*
 * The pane header is a bar above its pane's scrollport, not a layer inside it.
 *
 * "mtg-tz11" finishes what "mtg-n4d3" and "mtg-nuk3" were each approximating.
 * The bug n4d3 found was real: the header holds the pane's name, its count and
 * its only View control, and a pane is as tall as its cards, so scrolled into
 * the middle of the spells you had a page of cards belonging to a pane whose
 * controls were three screens up. The fix was to stick the header, and a stuck
 * header is one pretending to be outside a box it is inside. It cost a measured
 * 3.5rem of app bar to clear, a second offset once the route became a frame,
 * and an exception below 450px where the bar stops having one height and a chain
 * of guesses would have hidden the header behind it -- worse than the bug,
 * because a header that scrolled away can be found by scrolling back.
 *
 * The pane is now the box. Its header, its density and grouping controls and
 * its selected copy's moves all sit above ".mtg-deck__pane-scroll", which is
 * the only thing in the pane that scrolls, so the header does not move because
 * nothing moves it. Every one of those numbers goes with the position.
 */
.mtg-deck__pane-head {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--mtg-space-3);
  padding-block-end: var(--mtg-space-2);
  border-block-end: 1px solid var(--mtg-line);
}
/*
 * An open deck is a frame of boxes: the panes fill it, and each one scrolls.
 *
 * The second half of "mtg-nuk3", which gave the route one scrollport and stopped
 * the window scrolling. This spends that scrollport on the panes rather than on
 * the page: ".mtg-work__scroll" keeps no scroll of its own here, because if it
 * did, a fixed-height pane at the bottom of it would be a box you scroll the
 * page to reach, and three nested scroll regions is the half-measure the bead
 * refuses. So it is a column of exactly its own height, and the panes divide it.
 *
 * "grid-auto-rows: minmax(0, 1fr)" rather than the default: an auto row is sized
 * by its content and a pane's content is a deck, so the row would be as tall as
 * the cards and the box would be a document again. The "minmax(0, ...)" is the
 * half that makes a child's "overflow" mean anything at all -- a grid item's
 * automatic minimum size is its content, so "1fr" by itself still refuses to be
 * shorter than the cards in it. Same reason for every "min-block-size: 0" below.
 *
 * Below 1024px the panes stack and they are still boxes. Two half-height panes
 * that each scroll is what the client does on a short window; the alternative is
 * one pane's cards pushing the other pane off the bottom of the screen.
 */
.mtg-deck-screen .mtg-work__scroll { display: flex; flex-direction: column; overflow: hidden; }
.mtg-deck-screen .mtg-deck { flex: 1 1 auto; min-block-size: 0; }
/* Read once, so it yields its height to the panes rather than taking theirs, and
   scrolls itself on a window too short to hold the whole of it. */
.mtg-deck-screen .mtg-deck__details { flex: 0 1 auto; min-block-size: 0; overflow-y: auto; }
/* The numbers keep their two rows at every height. They are the shortest thing
   on the page and the one thing above the columns that is read continuously, so
   they are the wrong place to take height from. */
.mtg-deck-screen .mtg-deck__facts { flex: 0 0 auto; }
.mtg-deck-screen .mtg-deck__panes {
  flex: 1 1 auto; min-block-size: 0;
  align-items: stretch; grid-auto-rows: minmax(0, 1fr);
}
/* A written deck has one pane and no ".mtg-deck__panes" around it, so it is
   floored here rather than by the grid track above. */
.mtg-deck-screen .mtg-deck > .mtg-deck__pane { flex: 1 1 auto; min-block-size: 0; }
.mtg-deck__pane-scroll {
  flex: 1 1 auto; min-block-size: 0;
  display: flex; flex-direction: column; gap: var(--mtg-space-3);
  overflow: auto; overscroll-behavior: contain;
}
/* Only inside the frame, and only on the screen whose frame is not gated: this
   pane's height is imposed by the grid track above it, so a column can take its
   box from it without the two chasing each other. */
.mtg-deck-screen .mtg-deck__pane-scroll { ${STACK_BOX_SOURCE_PROPERTY}: ${STACK_BOX_FROM_PANE}; }
/* A scrollport whose contents shrink has nothing to scroll. The strips region is
   a flex item here, so on a window too short to hold it the default
   "flex-shrink: 1" squeezed it to the box's height and its own "overflow-y:
   hidden" cut the columns off at the bottom -- a pane reporting nothing to
   scroll while half its cards were unreachable. Landscape phone is where that
   bites: 390px of window leaves the pane about 200px. */
.mtg-deck__pane-scroll > * { flex: 0 0 auto; }
/* The pane's name, in the type a person reads rather than a micro label.
   "Main Deck: 42" and "Items: 128663" are what the MTGO capture writes on a
   pane bar, in the same size as the rest of the interface; this was a small
   uppercase label on the artifact panes and a heading on the builders, which is
   one arrangement drawn twice (mtg-pmpu). */
.mtg-deck__pane-title { margin: 0; font-size: var(--mtg-text-base); font-weight: 600; }
.mtg-deck__pane-note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-deck__expand { align-self: center; font-size: var(--mtg-text-xs); }
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
.mtg-deck__group {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: var(--mtg-space-2);
}
/* One control, two halves: the seam between them is a single shared border. */
.mtg-deck__view-btn:first-child { border-start-end-radius: 0; border-end-end-radius: 0; }
.mtg-deck__view-btn:last-child {
  border-start-start-radius: 0; border-end-start-radius: 0; margin-inline-start: -1px;
}
/* The pressed half draws its own edge, so it must sit above its neighbor's. */
.mtg-deck__view-btn[aria-pressed='true'] { position: relative; z-index: 1; }
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
/* What the build chose, beside what the deck holds now. Only ever drawn on a
   tile whose count a person moved (../routes/deck/DeckTile.ts). */
.mtg-deck-card__built {
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
  text-decoration: line-through;
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
  ${MICRO_LABEL}
  color: var(--mtg-ink-muted);
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

/**
 * The deckbuilding workspace: a bar, two panes, and no boxes.
 *
 * The playtester's UI pass asked for "deck contents and card pool side by side
 * (about 40/60)", and the screen it asked that of was a single column of five
 * bordered panels — save, mana base, deck, pool, filters — each one a rectangle
 * whose only job was to hold a heading. Scrolling past the deck to reach the
 * pool is the wrong shape for a screen whose entire activity is moving cards
 * between the two.
 *
 * So the panes are a grid and the chrome is a rule under a heading. The split
 * is `2fr 3fr` rather than a stated 40/60 because the pool holds four times as
 * many faces and both panes have to keep their card grids above the width one
 * face needs; `minmax(0, …)` is what stops a wide face from pushing the other
 * pane off the screen. Under `64rem` they stack, deck first, because on a phone
 * the deck is the thing being read and the pool is what you go and get.
 *
 * The bar is sticky, since the two counts it holds — how many cards, whether
 * the deck is legal — are what a person checks after every click, and they were
 * scrolled off the top of the screen for the whole second half of a build.
 */
const BUILDER = `
.mtg-builder { display: flex; flex-direction: column; gap: var(--mtg-space-4); }
/* A band of failures rather than a band of status. \`mtg-84703\` took the three
   standing sentences out of the printed pool editor's copy of this; what is
   left here, and on the two hosts that still draw it, is what has gone wrong. */
.mtg-printed-pool-status {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-1) var(--mtg-space-3);
  margin-block-end: var(--mtg-space-2);
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}
/* Everything that is neither pane, in one box: the counts bar, the written decks
   to start from, the saved decks, the legality notes. Its own column, so it
   keeps the spacing it had as four siblings of the pane grid. */
.mtg-builder__above { display: flex; flex-direction: column; gap: var(--mtg-space-4); }
.mtg-builder__bar {
  position: sticky; top: 0; z-index: 2;
  padding: var(--mtg-space-2) var(--mtg-space-1);
  background: var(--mtg-surface-page);
  border-bottom: 1px solid var(--mtg-line);
}
.mtg-builder__mirror { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
/* The build's name, at the left end of its own toolbar rather than in a page
   head above it (\`mtg-i8xl\`). It is still the screen's \`h1\`; what it stops
   being is a band. */
.mtg-builder__title { font-size: var(--mtg-text-base); margin: 0; }
/* What colors the deck is, as pips (\`mtg-84703\`, \`../routes/deck/DeckColors.ts\`).
   The counts that sat beside this are gone from the bar entirely: they are the
   deck pane's own note, one band below, in the same words.

   A flex row so the pips sit on one line with the bar's other items rather than
   on the text baseline they are drawn against inside a rules box, and a gap
   narrower than a space because five of them are one readout and not five. */
.mtg-builder__colors {
  display: inline-flex; align-items: center; gap: 1px;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}
.mtg-builder__colors .mtg-symbol { bottom: 0; }
.mtg-builder__blocked {
  flex-basis: 100%; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
}
/* Every sentence about why the deck is not legal, on the bar rather than in a
   band under it, and capped (\`mtg-i8xl\`). Eleven cards over the copy limit is
   eleven sentences, and the pool is what would pay for them. */
.mtg-builder__notes {
  flex-basis: 100%; margin: 0; padding: 0; list-style: none;
  display: flex; flex-wrap: wrap; gap: 0 var(--mtg-space-3);
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
  max-block-size: 3em; overflow-y: auto;
}
.mtg-builder__panes {
  display: grid; gap: var(--mtg-space-5); align-items: start;
  grid-template-columns: minmax(0, 1fr);
}
/* One pane at a time below the split, and the switch that chooses which.

   \`mtg-nqms\`, the half of \`mtg-3ggp\` that did not ship. Stacking both panes
   full width is what keeps neither of them a sliver, and it is also what turns
   the screen back into a document: measured at 390x844 with sixty cards in the
   deck, the deck pane ran 1,057px, the collection began at 1,528px and ran
   6,562px, and the page was 8,138px. Reaching the collection meant scrolling
   past the whole deck.

   The rule is stated here and undone inside the split query below, rather than
   stated inside a negated one, because the split query is two clauses joined by
   a comma and CSS has no negation of that. So the narrow arrangement is the base
   and the desk arrangement is what a media query restores -- the same direction
   every other rule in this file runs.

   \`.mtg-builder__switch\` is a row of its own inside the sticky counts bar
   (\`flex-basis: 100%\`, the way \`.mtg-builder__notes\` above is), which is what
   keeps it on the screen from anywhere in either pane: the bar is already pinned
   to the top of the page, and a second sticky element at \`top: 0\` would slide
   over the first. */
.mtg-builder__switch {
  flex-basis: 100%; display: flex; gap: var(--mtg-space-2);
  padding-block-start: var(--mtg-space-2);
}
.mtg-builder__switch-btn { flex: 1 1 0; }
.mtg-builder__switch-btn[aria-pressed='true'] {
  background: var(--mtg-surface-inset); border-color: var(--mtg-line-strong); font-weight: 600;
}
.mtg-builder__panes[data-showing='deck'] > [data-pane='pool'],
.mtg-builder__panes[data-showing='pool'] > [data-pane='deck'] { display: none; }
/* Two columns on a desk, and on a phone held sideways.

   The second query is the one this repository keeps having to add (mtg-aqxi.4):
   a landscape phone is 844x390, so a width-only threshold set at a desk's 64rem
   hands it the portrait arrangement, and the portrait arrangement puts the pool
   a scroll below the deck on the screen whose entire activity is moving cards
   between the two. 390px of height makes that scroll most of a page.

   48rem rather than 40rem, which is where the portrait phone sheet stops:
   between the two lies a screen wide enough for one column of cards and no more,
   and splitting it would give two columns that each cut a card face. The height
   half is ./panel.ts's SCREEN_QUERY, the same line that decides when a page
   stops being a document, because that is the same judgment made twice. */
@media ${BUILDER_SPLIT_QUERY} {
  .mtg-builder__panes { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
  /* Both panes, whatever the switch last wrote, and no switch to write it with.
     The value restated here is \`.mtg-deck__pane\`'s own \`display: flex\` above;
     \`../../test/deck/builder-panes.test.ts\` fails if the two stop agreeing,
     because a pane restored as \`block\` would lose the column its scrollport
     depends on. The extra class is specificity: the hiding rule above is three
     compound selectors and so is this one, and a restore that only wins by
     source order is a restore that breaks the day the sheet is reordered. */
  .mtg-builder .mtg-builder__panes[data-showing] > [data-pane] { display: flex; }
  .mtg-builder__switch { display: none; }
  /* The Constructed builder's columns, outside the frame as well as inside it
     (\`mtg-x6xq\`): the collection on the left at five to three. Named areas
     rather than a reorder, because both builders write the deck pane first --
     below the split query the screen is one column and the deck is what you
     came to read. */
  .mtg-builder[data-builder='constructed'] .mtg-builder__panes {
    grid-template-columns: minmax(0, 5fr) minmax(0, 3fr);
    grid-template-areas: 'pool deck';
  }
  .mtg-builder[data-builder='constructed'] .mtg-builder__panes > [data-pane='pool'] { grid-area: pool; }
  .mtg-builder[data-builder='constructed'] .mtg-builder__panes > [data-pane='deck'] { grid-area: deck; }
}
/*
 * A builder is a frame of boxes, at every size.
 *
 * "mtg-pmpu", and the same arrangement an open deck got in "mtg-tz11": the
 * window is filled once, each pane is a box with its own scrollbar, and the
 * header bar a pane is steered by sits outside the box it steers. Measured on
 * the flagship at 1440x900, the builder was a 13,436px document, so reaching
 * the pool took the deck you were cutting from off the top of the screen -- on
 * the one screen whose whole activity is moving cards between the two.
 *
 * The gate is BUILDER_FRAME_QUERY and not the split above it, which is the one
 * thing this arrangement gets wrong if you reason it out instead of measuring
 * it: a frame needs room, and two panes side by side is not the same claim as
 * enough height to divide between them. Where there is not enough, this route
 * stays the document it has always been.
 *
 * ".mtg-builder__bar" stays sticky and inside the frame is sticky against
 * ".mtg-builder__above" rather than against the page. That is the same rule
 * doing the same job through the one scroll left that can take the counts off
 * the top -- and it is still the page's scroll below the frame.
 *
 * Both builders, since "mtg-sk1c". The sealed screen's three hosts drew it into
 * plain documents until then, so every rule in this block matched nothing on the
 * screen the other half of this lab builds decks on.
 */
@media ${BUILDER_FRAME_QUERY} {
  .mtg-builder-screen .mtg-work__scroll {
    display: flex; flex-direction: column; overflow: hidden;
  }
  .mtg-builder-screen .mtg-builder { flex: 1 1 auto; min-block-size: 0; }
  /* The bands around the cards, at the height of what is in them.
   *
   * "mtg-564j". Measured on the sealed builder at 1440x900: of 900px the screen
   * spent 306 on chrome and left 198px of pool pane holding 604px of cards. None
   * of that 306 was control height. Every band measures its tallest child at 29
   * or 30px and then adds 16px of block padding around it, and each pane puts a
   * 12px gap between its bands: the counts bar 46, each pane header 39, the mana
   * base 47. The MTGO capture this screen is being cut against spends 54px of a
   * 630px window on chrome, 8.6% against 34%.
   *
   * So inside the frame the block padding and the band gaps come down one step
   * on the scale and nothing else moves. The controls keep every pixel they had
   * -- the 1.5rem step buttons, the 1.75rem density toggles -- because the
   * padding is around them and a target that shrinks is a target you miss. The
   * inline padding is untouched too: it is what keeps the first pip off the
   * pane's edge, and horizontal room is not what this screen is short of.
   *
   * Only inside the gate. Below it the screen is a document, the panes are as
   * tall as their cards, and 16px between a header and the cards under it is
   * what makes it readable rather than what costs the deck a row. */
  .mtg-builder-screen .mtg-builder { gap: var(--mtg-space-3); }
  .mtg-builder-screen .mtg-builder__bar { padding-block: var(--mtg-space-1); }
  .mtg-builder-screen .mtg-deck__pane { gap: var(--mtg-space-2); }
  .mtg-builder-screen .mtg-deck__pane-head { padding-block-end: var(--mtg-space-1); }
  .mtg-builder-screen .mtg-manabar { padding-block: var(--mtg-space-1); }
  /* The deck pane's analytics, at the size a third of the workbench can pay for.
   *
   * "mtg-x6xq". Measured at 1600x1000 once the panes went side by side: the deck
   * column is 572px tall in its scrollport and spent 279px above it, of which
   * the curve was 99 and the mana base 71 -- the base because ten step buttons
   * and five counts wrap to two rows at 572px, and the curve because its bar
   * track is 3.5rem whatever the room is. the playtester asked for both, "as compact
   * analytical elements, not [to] consume a large full-width section".
   *
   * The track halves and the row tightens. Nothing is dropped and no target
   * shrinks: the steps keep their 1.75rem and the numbers keep their size, which
   * is the same rule "mtg-564j" applied to the bands above. */
  .mtg-builder[data-builder='constructed'] .mtg-curve { margin-block-end: var(--mtg-space-2); }
  .mtg-builder[data-builder='constructed'] .mtg-curve__bar { block-size: 1.75rem; }
  .mtg-builder[data-builder='constructed'] .mtg-curve__step { min-width: 2rem; gap: 0; }
  .mtg-builder[data-builder='constructed'] .mtg-manabar { gap: var(--mtg-space-1); }
  /* The chrome yields to the cards, and scrolls what it cannot show.
   *
   * A frame divides its height between the box above the panes and the panes,
   * and the box above is not small: the counts, the two lines saying what the
   * dark buttons are waiting for, five written decks to start from, the saved
   * decks. Measured on the flagship it wants about 350px, and it wants more of
   * that the narrower the window gets, because every line of it wraps. Without
   * a ceiling it takes what it asks for: it is the only item here with a base
   * size, so flexbox hands it the whole frame and leaves the panes zero.
   *
   * So it is capped at two fifths of the frame and scrolls inside that. Two
   * fifths because the panes are the screen and this is the apparatus around
   * them; below the cap nothing moves, so a desk sees exactly what it saw
   * (201px of 736 at 1440x900, 241 of 604 at 1024x768). */
  .mtg-builder-screen .mtg-builder__above {
    flex: 0 1 auto; min-block-size: 0; max-block-size: 40%; overflow-y: auto;
  }
  /* The Constructed builder has no such box since \`mtg-i8xl\`: its title, its
     counts, its saved decks, its actions and its legality notes are one bar, and
     the bar is a flex item that measures its own content. The cap above is the
     sealed builder's, which still stacks a banner, a summary and its problems. */
  .mtg-builder[data-builder='constructed'] .mtg-builder__bar {
    flex: 0 0 auto; border-bottom: 1px solid var(--mtg-line);
  }
  /* A workbench rather than two columns.
   *
   * "mtg-8osf". Side by side, the deck gets two fifths of the window and its
   * mana-value columns are what pays: measured on the flagship at 1440x900 the
   * deck pane was 560px wide, which is three of seven columns with the rest
   * behind a horizontal scrollbar, on the screen whose one question is what the
   * curve looks like. Stacked, the deck has the whole 1440 and the seven columns
   * are one glance.
   *
   * So the pool goes across the top and the deck takes the rest, which is what
   * every deck editor that has to be read at speed does. Two fifths and three
   * fifths: the pool is a place to look things up and the deck is the thing
   * being built, and both keep a card face's worth of room at the 48rem floor
   * this gate already establishes (2/5 of 768 is 307px, against the 180px a pane
   * spends on its own header and filters).
   *
   * The rows are named rather than reordered. Both builders draw the deck pane
   * first, because below this gate the screen is a document and the deck is what
   * you came to read; "order" would have said the same thing and grid areas say
   * it once for a grid that already exists. Both panes are labeled regions, so
   * landmark navigation still reaches them in the order they are written. */
  .mtg-builder-screen .mtg-builder__panes {
    flex: 1 1 0; min-block-size: 0;
    align-items: stretch;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--split-a, ${BUILDER_POOL_TRACK}) auto var(--split-b, ${BUILDER_DECK_TRACK});
    grid-template-areas: 'pool' 'split' 'deck';
    gap: var(--mtg-space-3);
  }
  /* The deck row takes what it holds rather than filling its share, which is
   * what the two tracks above say, and this is the argument for it.
   *
   * "mtg-x3yb" made this claim at one point. Measured on the Constructed builder
   * at 1440x900, opened on a new deck: the workbench is 564px, the pool pane
   * takes 213 of it and 121 of that is its scrollport, while the deck pane holds
   * nothing and takes 319. At Full cards a face is 262px tall, so the pool drew
   * a band of title bars beside an empty box with room to spare. The share was
   * argued for a deck being cut ("mtg-8osf") and it is right for one; it was
   * never argued for the state the screen opens in.
   *
   * "mtg-d9f4" is the same reading one state along, and it is why the empty-deck
   * rule that used to sit here is gone rather than kept beside this one. On the
   * sealed builder at 1440x900 the deck is not empty and is still shorter than
   * its share: the deck pane held 441.8px for 352px of content while the pool
   * pane had 294.5 with a 214.7px scrollport holding 1,379px of cards. A deck
   * that is merely short costs the pool exactly what an empty one did, and the
   * pool is the thing being read while the deck is cut.
   *
   * So the deck row sizes to the pane and the pool row carries the floor. What
   * that floor is for is the other direction: a 90-card selection wants more
   * than the workbench, and without it the deck would take the pool with it and
   * invert this into the bug "mtg-x6xq" fixed on the other builder. Measured on
   * the whole pool selected, at 1440x900: pool 253.2 and deck 379.8, which is
   * the two fifths and three fifths this arrangement started as, to the tenth.
   *
   * The gain is the middle state and it is the deck's own content that sets it.
   * Measured on the suggested 23-card selection: the deck asks for 320px and
   * gets 409.8 with its chrome, so the pool goes 294.5 -> 326.5 and its
   * scrollport 214.7 -> 246.6. An empty deck reads 120.7 either way, which is
   * "mtg-x3yb"'s own number and why its rule is gone rather than kept.
   *
   * A dragged split wins, and it wins by writing both tracks inline
   * ("../routes/deck/builder-split.ts"): a person who has said how they want
   * this workbench shared is not asking to be corrected on the day their deck
   * is short. */
  .mtg-builder-screen .mtg-builder__panes > [data-pane='pool'] { grid-area: pool; }
  .mtg-builder-screen .mtg-builder__panes > [data-pane='deck'] { grid-area: deck; }
  /* The Constructed builder divides the width instead, which reverses the
     workbench above for that screen and only that screen.
   *
   * "mtg-x6xq". "mtg-8osf" stacked the panes because a deck of mana-value
   * columns cannot be read in two fifths of the width, and it was right about
   * the columns. the playtester read the result on 2026-08-31: "the deck itself is
   * pushed to the bottom where cards are barely visible ... the playable-card
   * browser is compressed into a shallow strip". Measured at 1600x1000 with 36
   * cards in the deck, the pool pane was 231px tall and its scrollport 152px,
   * holding 26,769px of cards.
   *
   * What makes both true at once is "mtg-umro": the deck pane's default drawing
   * is a decklist, and a decklist is what a narrow column is for. The columns
   * are still there behind Full cards, and the sealed builder next door -- whose
   * deck pane has no list -- keeps the stacked workbench and the whole width its
   * columns were argued for.
   *
   * Roughly five to three, which is the playtester's "~60-65%" for the collection
   * against "~35-40%" for the deck. At the 64rem floor this gate establishes
   * that is 640px of pool against 384px of deck, and a decklist row needs a name
   * and a cost run rather than a card face's width.
   *
   * The short-deck cap above is deliberately not repeated. It is an argument
   * about height -- a pane taking three fifths of a workbench the pool has to be
   * filled from while holding less than that -- and a column that narrowed as
   * the deck grew would move the pool's cards sideways on every card played.
   * That is why this rule states both tracks itself and reads no cap. */
  .mtg-builder[data-builder='constructed'] .mtg-builder__panes {
    grid-template-columns: var(--split-a, minmax(0, 5fr)) auto var(--split-b, minmax(0, 3fr));
    grid-template-rows: minmax(0, 1fr);
    grid-template-areas: 'pool split deck';
  }
  /* The divider between them, and the frame gate is what turns it on: a
     workbench is two boxes sharing one window here and a document that scrolls
     below, and there is nothing to divide in a document (\`../panel/split.ts\`).
     The whole track expression is what the custom property replaces rather than
     the number inside it, so a builder nobody has dragged lays out through the
     exact rule above -- \`2fr\` is a share of the room whatever the pane holds,
     and a percentage substituted into a \`minmax\` would have let a short pool
     shrink its own row. */
  .mtg-builder-screen .mtg-builder__panes > .mtg-split { grid-area: split; display: block; }
  /* One scroll region per pane, in both directions.
   *
   * ".mtg-builder-curve" carries its own "overflow-x: auto" so that a column of
   * mana values scrolls locally rather than widening the page, and inside a
   * framed pane that is the same offer made twice: the pane already scrolls.
   * What it cost is where the horizontal scrollbar ends up. The pool's columns
   * are 12,924px tall on this set, so the curve's own scrollbar sits at the
   * bottom of that, and the columns past the pane's right edge were reachable
   * only by scrolling to the end of the pool first. Handing the overflow up
   * puts the scrollbar on the edge of the box it belongs to.
   *
   * ".mtg-strips" carries the identical "overflow-x: auto" for the identical
   * reason (its own columns of strips), and since mtg-eeqnj the pool draws it
   * instead of the curve at compact -- so it needs the same hand-off, or a
   * compact pool would have grown back the buried scrollbar this rule exists
   * to remove. It also carries "overflow-y: hidden", which ".mtg-builder-curve"
   * does not, and the CSS Overflow spec computes a "visible" overflow-x back to
   * "auto" whenever its paired overflow-y is not also visible -- so freeing only
   * overflow-x here would have been silently undone. Both axes have to open
   * together, and the pane the strip sits in already owns its own scroll. */
  .mtg-builder-screen .mtg-deck__pane-scroll > .mtg-builder-curve { overflow-x: visible; }
  .mtg-builder-screen .mtg-deck__pane-scroll > .mtg-strips { overflow-x: visible; overflow-y: visible; }
  /* Inside the gate only. Below it the pane is sized by its cards, and a column
     that read its height from a scrollport its own height had produced would
     grow by one header every frame. */
  .mtg-builder-screen .mtg-deck__pane-scroll { ${STACK_BOX_SOURCE_PROPERTY}: ${STACK_BOX_FROM_PANE}; }
}
/* A pane may take the whole workbench without becoming a different surface.
   Both panes stay mounted, so restoring this mode also restores their local
   state and the divider's persisted share. These rules are intentionally after
   both responsive arrangements: an explicit expansion wins over the desk rule
   that normally restores both panes and over either builder's named tracks. */
.mtg-builder .mtg-builder__panes[data-expanded='deck'] > [data-pane='pool'],
.mtg-builder .mtg-builder__panes[data-expanded='pool'] > [data-pane='deck'],
.mtg-builder .mtg-builder__panes[data-expanded]:not([data-expanded='split']) > .mtg-split { display: none; }
.mtg-builder .mtg-builder__panes[data-expanded='deck'],
.mtg-builder .mtg-builder__panes[data-expanded='pool'] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto;
}
.mtg-builder .mtg-builder__panes[data-expanded='deck'] { grid-template-areas: 'deck'; }
.mtg-builder .mtg-builder__panes[data-expanded='pool'] { grid-template-areas: 'pool'; }
@media ${BUILDER_FRAME_QUERY} {
  .mtg-builder-screen .mtg-builder__panes[data-expanded='deck'],
  .mtg-builder-screen .mtg-builder__panes[data-expanded='pool'] {
    grid-template-rows: minmax(0, 1fr);
  }
}
`;

/**
 * The two copy controls under a face, and the mana base as one row.
 *
 * The steps are small on purpose and still 1.75rem tall, which is the smallest
 * a target gets on this surface; they sit under the face rather than over it
 * because a control on top of a card is a control that hides the card.
 *
 * `.mtg-manabar` is five counts and their ten buttons on one line. It wraps
 * rather than scrolls, since the row is under a heading rather than in a rail,
 * and the registered mana glyph is pip-sized so the row reads as mana at a
 * glance instead of as ten more numbers.
 */
const COPIES = `
.mtg-copies__bar { display: flex; align-items: center; gap: var(--mtg-space-1); }
.mtg-copies__step {
  min-inline-size: 1.75rem; min-block-size: 1.75rem;
  padding: 0; border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  font: inherit; font-size: var(--mtg-text-sm); line-height: 1; cursor: pointer;
}
.mtg-copies__step:hover:not(:disabled) { background: var(--mtg-surface-inset); }
.mtg-copies__step:disabled { opacity: 0.45; cursor: default; }
.mtg-manabar {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--mtg-space-2);
  padding: var(--mtg-space-2) 0;
  border-block: 1px solid var(--mtg-line);
}
.mtg-manabar__lands { display: inline-flex; align-items: center; gap: var(--mtg-space-1); }
.mtg-manabar__label { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-manabar__total { font-weight: 600; font-variant-numeric: tabular-nums; }
.mtg-manabar__color { display: inline-flex; align-items: center; gap: var(--mtg-space-1); }
.mtg-manabar__pip {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 1.15rem; block-size: 1.15rem;
  font-size: 1.22rem; line-height: 1;
}
.mtg-manabar__pip > .mtg-symbol { margin: 0; bottom: 0; }
.mtg-manabar__count { min-inline-size: 1ch; font-variant-numeric: tabular-nums; }
.mtg-manabar__step {
  min-inline-size: 1.5rem; min-block-size: 1.5rem;
  padding: 0; border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  font: inherit; font-size: var(--mtg-text-sm); line-height: 1; cursor: pointer;
}
.mtg-manabar__step:hover:not(:disabled) { background: var(--mtg-surface-inset); }
.mtg-manabar__step:disabled { opacity: 0.45; cursor: default; }
.mtg-manabar__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
`;

/**
 * Saving a deck, as a row rather than a panel.
 *
 * The name box, the two save buttons and the state of the deck were a titled
 * box with a paragraph of explanation under it, above the cards. The paragraph
 * moved behind *Import / Export* with the decklist text, and what is left is
 * one line: what this deck is called and whether it is written down.
 */
const SAVEBAR = `
.mtg-savebar { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-savebar__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mtg-space-2); }
/* The disclosure the save controls live in. Its summary is the one band a shut
   panel costs, and it carries the title and the deck's saved state; see
   \`../routes/deck/SavedDecksPanel.ts\` for what is deliberately outside it. */
.mtg-savebar__disclosure { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* \`display: list-item\` rather than flex: a summary laid out as a flex
   container loses its disclosure triangle in Chrome, and a control with no
   affordance is a control nobody presses. The two spans are inline and spaced
   by a margin instead. */
.mtg-savebar__summary {
  display: list-item;
  list-style-position: inside;
  cursor: pointer;
  padding: var(--mtg-space-1) 0;
}
.mtg-savebar__summary > * + * { margin-inline-start: var(--mtg-space-2); }
.mtg-savebar__title { ${MICRO_LABEL} color: var(--mtg-ink-muted); }
.mtg-savebar__note { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
.mtg-savebar__files { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* Everything the summary opens, in one box (\`mtg-i8xl\`). Below the Constructed
   builder's toolbar it is an ordinary column and this rule is all of it. */
.mtg-savebar__body { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* Inside that toolbar it drops open over the workspace instead of pushing it
   down. Saved decks are a thing you reach for twice in a session -- open one,
   save one -- and the shut panel was still spending a permanent 38px band on
   saying so, on a screen measured at 368px of chrome over a 152px pool
   scrollport. the playtester, 2026-08-31: "Saved decks should not consume permanent
   vertical space."

   The trigger keeps its place in the bar and keeps its own width; only the body
   leaves the flow. \`position: fixed\` is wrong here even though the bar is
   sticky -- the popover has to travel with the bar -- so the anchor is an
   ancestor that is already positioned, and \`mtg-3ggp.1\` is which one.

   The bar, not the savebar. Anchoring to the savebar reads correctly on a desk,
   where the savebar is on the bar's only line and \`calc(100% + space)\` of it is
   the bottom of the bar. On a phone the bar has wrapped to several lines and the
   savebar is no longer the last of them, so the same offset opened the panel
   *inside* the bar: measured at 390x844 with sixty cards in the deck, the bar
   ran 414px, the panel opened 133px down inside it, and all five of the bar's
   controls -- Clear the deck, both play buttons, and both halves of the pane
   switch -- answered \`elementFromPoint\` with the panel. The bar is sticky and
   therefore already a containing block, so naming it is the whole fix; it also
   moves the panel off the notes line it overlapped at desk width.
   \`../../test/deck/savebar-popover.browser.test.ts\` holds both readings. */
.mtg-builder[data-builder='constructed'] .mtg-builder__bar .mtg-savebar__body {
  position: absolute; inset-inline-end: 0; inset-block-start: calc(100% + var(--mtg-space-1));
  z-index: 6;
  inline-size: min(38rem, 80vw);
  max-block-size: 60vh; overflow-y: auto;
  padding: var(--mtg-space-3);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line-strong);
  border-radius: var(--mtg-radius-sm);
  box-shadow: var(--mtg-shadow-card);
}
`;

/*
 * The strip columns: `../routes/deck/StripColumns.ts`.
 *
 * Every measurement that decides whether a column fits is computed in
 * `../routes/deck/strips.ts` and arrives as two inline values — the box height
 * on the region, the pitch on each column — so this sheet positions and paints
 * and decides nothing about depth. That split is deliberate: the pitch is the
 * part that can be silently wrong, and a number in a stylesheet is a number no
 * test can reach without a browser.
 *
 * # No negative margins
 *
 * `./board/zone.ts` paid twice for a stack built out of negative margins: a box
 * pulled upward draws outside its border box, and whatever sits above it clips
 * the overhang. So the stack is a positioned context of a stated height and each
 * strip is absolutely placed at `pitch * index` inside it. The height is stated
 * rather than discovered, the overlap costs no margin, and nothing draws outside
 * the box it was measured into.
 *
 * # Why the later strip is on top
 *
 * Source order, with no `z-index` anywhere. Each strip covers the one before it,
 * which is what leaves the bottom one whole and makes the full card at the foot
 * of a column an artifact of the overlap rather than a mode somebody selected.
 * A `z-index` here would be a second statement of the same order and the place
 * the two would disagree.
 */
const STRIPS = `
.mtg-strips {
  display: flex; align-items: flex-start; gap: var(--mtg-space-3);
  /* Never wraps and scrolls sideways, so the count row stays one line and the
     region's height is the same at pick 1 and at pick 45. */
  flex-wrap: nowrap;
  overflow-x: auto; overflow-y: hidden;
  overscroll-behavior-x: contain;
  padding-block-end: var(--mtg-space-1);
}
.mtg-strips__col { flex: 0 0 auto; display: flex; flex-direction: column; gap: var(--mtg-space-1); }
/* One label over the middle of the column, rather than two things at its two
   ends.

   \`mtg-keii\`. \`space-between\` in a 13.5rem column puts the pip against the left
   edge and the count against the right, 196px apart in a 216px column on the
   deck screen at 1440x900, and what a reader does with that is pair them up
   again for
   every column in the row. Magic Online writes one count over the middle of each
   column and nothing else; the column's position is already its mana value.

   Centered keeps both halves, because ours is not Magic Online's column: the pip
   is what \`../routes/deck/StripColumns.ts\` argues cannot be dropped, since a
   bare \`3\` over a column of three-drops is ambiguous between the value and the
   count. Side by side they read as one label, which is the thing the eye is
   meant to take in at a glance, and the lone column that drops its number is
   centered too rather than sitting off to one side of a column it is the only
   one of. */
.mtg-strips__head {
  display: flex; align-items: center; justify-content: center; gap: var(--mtg-space-2);
  min-block-size: 1.5rem;
}
.mtg-strips__what { display: inline-flex; align-items: center; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-strips__count {
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 700;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink);
}
.mtg-strips__stack {
  position: relative;
  inline-size: 13.5rem;
  /* The box is the region's, not the column's: a column shorter than the box
     leaves the space empty rather than letting the row of columns ragged out. */
  max-block-size: var(--strip-box);
  overflow: hidden;
}
/* A column past the pitch floor is taller than its box, and the box scrolls it
   rather than cutting it off (mtg-47xi). It used to be clipped outright: the
   strips below the fold were undrawable and unclickable, so a mono-color deck
   grouped by color -- one column, sixty copies -- lost its last twenty cards to
   a fade. The region around it cannot be the thing that scrolls, because its own
   sideways scrollbar would then sit below the fold, which is the failure
   ../../test/deck/builder-frame.browser.test.ts's fourth sentence exists to
   catch. So the deep column carries the scroll, and it is the only one that
   does. */
.mtg-strips__stack[data-clipped='true'] {
  overflow-x: hidden; overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
}
/* An element of the block rather than \`.mtg-strip\`, which is not a spelling
   preference: \`./panel.ts\` has owned \`.mtg-strip\` since long before this — the
   screen's own toolbar, the thing \`../routes/draft/DraftPack.ts\` and
   \`../routes/play/RemoteDraft.ts\` draw a pick timer into. Two bare single-class
   rules tie on specificity and the later sheet wins, and \`./index.ts\` joins this
   one after the panel's, so a copy of a card would have quietly redrawn every
   toolbar on the site. \`../../test/panel/sheet-ownership.test.ts\` caught it. */
.mtg-strips__card {
  position: absolute; inset-inline: 0;
  display: flex; flex-direction: column;
  padding: 0; border: 1px solid var(--edge, var(--mtg-line));
  border-radius: var(--mtg-radius-sm);
  background: var(--panel, var(--mtg-surface-raised));
  text-align: start; cursor: pointer;
  /* Opaque, because the strip below shows through anything else and two card
     names on one row is unreadable at any tint. */
  overflow: hidden;
}
.mtg-strips__bar {
  display: flex; align-items: center; gap: var(--mtg-space-1);
  padding: 0 var(--mtg-space-1);
  min-block-size: 1.5rem;
}
.mtg-strips__name {
  flex: 1; min-width: 0;
  font-size: var(--mtg-text-xs); font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mtg-strips__cost { display: inline-flex; align-items: center; gap: 1px; white-space: nowrap; }
/*
 * A foil copy, marked twice: a glyph in the bar and a still sheen behind it.
 *
 * mtg-p3g5. The deck pane draws bars at this density and faces at the other, and
 * until this rule it said "foil" at one of them, so a view preference changed
 * what the pane claimed about the deck.
 *
 * Twice for the reason ../routes/deck/StripColumns.ts already says the color
 * twice: a wash is a color, and a mark carried by color alone is one a reader
 * who cannot separate pearl from panel does not get. The glyph is the carrier
 * that is not a color, and the accessible name says the word outright
 * (\`stripLabel\`), so the mark survives losing either channel.
 *
 * The wash is deliberately the *reduced-motion frame* of ../styles/card.ts's
 * sheen rather than the sheen: same two token stops, same 220% box, stopped at
 * the middle of its travel and thinned to 0.4, which is the arm that file
 * already argues carries the whole of the information and none of the movement.
 * A face is a picture and can afford a highlight traveling over it; a column of
 * strips is a list, and eight foil copies sweeping at once behind eight card
 * names is a list nobody can read down.
 *
 * Only at compact. At full the strip is a face and the face paints its own,
 * which is why the selector excludes that density rather than the block-level
 * rules below re-stating it.
 */
.mtg-strips__foil {
  flex: none;
  font-size: var(--mtg-text-xs);
  line-height: 1;
  /* The bar's own ink, not the sheen's amber, and that is the whole point of
     having a glyph: the wash is the color and the star is the shape, so the star
     has to read at whatever tint the identity fill puts behind it. Drawn in the
     amber first and measured at 4x, it was a pale mark on a pale bar -- the
     token carries 0.48 alpha because it is painted over a card, and a 10px star
     is not a card. */
  color: var(--mtg-ink);
}
.mtg-strips:not([data-density='full']) .mtg-strips__card[data-foil='true']::after {
  content: '';
  position: absolute; inset: 0;
  pointer-events: none;
  background-image: linear-gradient(
    115deg,
    transparent 32%,
    var(--mtg-sheen-pearl) 45%,
    var(--mtg-sheen-amber) 55%,
    transparent 68%
  );
  background-size: 220% 220%;
  background-position: 50% 50%;
  opacity: 0.4;
}
.mtg-strips__card[data-selected='true'] {
  outline: 2px solid var(--mtg-accent); outline-offset: -1px;
}
/* The bar the selected copy's moves live on: deckSelectionBar in
   ../routes/deck/ConstructedBuilder.ts and SelectionBar in ../routes/DeckRoute.ts.
   It wraps rather than scrolls, because the one thing that must never happen to
   it is pushing the columns down a page it cannot be read beside. */
.mtg-deck__selection {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--mtg-space-2);
  padding: var(--mtg-space-2);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-raised);
}
.mtg-deck__selection-name { font-size: var(--mtg-text-sm); font-weight: 600; }
.mtg-deck__selection-backdrop {
  position: fixed; inset: 0; z-index: 50;
  display: grid; place-items: center; overflow: auto;
  padding: var(--mtg-space-4);
  background: color-mix(in srgb, var(--mtg-surface-page) 92%, transparent);
}
.mtg-deck__selection-overlay {
  flex-direction: column; flex-wrap: nowrap;
  max-inline-size: calc(100vw - 2 * var(--mtg-space-4));
}

/*
 * The same columns at the other density: whole faces overlapped, one per copy.
 *
 * \`mtg-rgc.21\`. the playtester, 2026-08-29: "the cards should be sorted by mana cost
 * even when they are in full expanded view not only in compact view". So View
 * stops choosing between two arrangements and chooses between two densities of
 * one arrangement -- the columns, the heads and the counts are the same objects,
 * and what changes is that a strip is a card rather than a name bar.
 *
 * The strip is a \`div\` here and a \`button\` at compact, which is why nothing
 * below paints a panel: the face inside is the button and it paints itself. See
 * \`../routes/deck/StripColumns.ts\`'s \`StripFaceGestures\` for the content-model
 * argument behind the swap.
 *
 * Every strip is clipped to the pitch and shows the top of its own face, which
 * is the title bar and most of the art window (\`FULL_BAND_SHARE\`). The one that
 * is open -- the bottom of the column, or the one somebody selected -- is its
 * whole height, and \`--strip-push\` has already moved the strips below it down
 * by the difference, so the pile opens in place and nothing else on the pane
 * moves.
 */
.mtg-strips[data-density='full'] .mtg-strips__stack { inline-size: var(--strip-width, 11rem); }
.mtg-strips[data-density='full'] .mtg-strips__card {
  display: block;
  block-size: var(--strip-pitch);
  border: 0; background: none; border-radius: 0;
  cursor: auto;
}
/* Visible rather than hidden, because an open face is exactly its own height
   and what would be clipped is its shadow and its selected outline, both of
   which are drawn outside the border box. The \`z-index\` is the pair to that:
   source order puts every later strip above this one, and a shadow the next
   card paints over is a shadow nobody can see. */
.mtg-strips[data-density='full'] .mtg-strips__card[data-open='true'] {
  block-size: var(--strip-face);
  overflow: visible;
  z-index: 1;
}
/* The face takes the column, and the column was derived from the pane. The
   token is the width rather than a share of it for \`./views.ts\`'s reason where
   it writes the same line: a percentage inside a font-size is a percentage of
   the parent's type. */
.mtg-strips[data-density='full'] .mtg-strips__card > .mtg-card {
  --card-w: 100%; width: 100%;
  --rules-type: var(--mtg-text-sm);
}
/* The outline belongs to the face, which draws its own. Two of them on one card
   is a doubled rule at two different radii. */
.mtg-strips[data-density='full'] .mtg-strips__card[data-selected='true'] { outline: none; }
`;

/**
 * The deck as a decklist: quantity, name, cost, one row each.
 *
 * `mtg-umro`. The drawing a third of a workbench holds, against the mana-value
 * columns that need the capture's whole width. Rows are the smallest thing on
 * this surface that still has to be pressed, so the height floor is the touch
 * target's and the type is the base size, not the small one: a decklist is read
 * at speed and a 12px name is not.
 *
 * The quantity column is fixed and tabular so the numbers form a line down the
 * left edge -- that line is the whole reason a decklist is faster to count than
 * a grid -- and the cost is pushed to the right edge for the same reason, so the
 * curve is legible as a shape without reading a single name.
 */
const DECKLIST = `
.mtg-decklines { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-decklines__group { display: flex; flex-direction: column; }
/* Sticky inside the pane's own scrollport, so the head of the section you are
   reading stays named however far down the list you are. The offset is the
   scrollport's padding negated, which is \`.mtg-deck__pane-scroll\`'s own rule. */
.mtg-decklines__head {
  position: sticky; inset-block-start: 0; z-index: 1;
  display: flex; align-items: baseline; gap: var(--mtg-space-2);
  padding: var(--mtg-space-1) var(--mtg-space-2);
  background: var(--mtg-surface-page);
  border-block-end: 1px solid var(--mtg-line);
}
.mtg-decklines__what { ${MICRO_LABEL} color: var(--mtg-ink-muted); }
.mtg-decklines__group-count {
  margin-inline-start: auto;
  font-size: var(--mtg-text-xs); font-variant-numeric: tabular-nums; color: var(--mtg-ink-faint);
}
.mtg-decklines__row {
  display: flex; align-items: center; gap: var(--mtg-space-2);
  min-block-size: 1.5rem;
  padding: 0 var(--mtg-space-2);
  border: 1px solid transparent; border-radius: var(--mtg-radius-sm);
  background: none; color: var(--mtg-ink); font: inherit; text-align: start;
  cursor: pointer;
}
.mtg-decklines__row:hover { background: var(--mtg-surface-inset); }
.mtg-decklines__row[data-selected='true'] {
  border-color: var(--mtg-line-strong); background: var(--mtg-surface-inset);
}
.mtg-decklines__qty {
  inline-size: 1.5rem; flex: 0 0 auto; text-align: end;
  font-variant-numeric: tabular-nums; color: var(--mtg-ink-muted);
}
.mtg-decklines__name {
  flex: 1 1 auto; min-inline-size: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mtg-decklines__nocost { color: var(--mtg-ink-faint); }
/* The steps appear on the row under the pointer and on the row under the
   outline, and hold their width either way: a pair of buttons that materializes
   on hover and reflows the name beside it is a row that moves while you aim at
   it. */
.mtg-decklines__steps { display: flex; gap: var(--mtg-space-1); flex: 0 0 auto; visibility: hidden; }
/* The floating face (\`../routes/deck/CardPreview.ts\`, \`mtg-nyeo\`). Fixed, so
   it travels with the window rather than with a scrolled pane; above everything,
   because a preview under a pane header is a preview nobody asked for; and inert
   to the pointer, so the card it appears beside is still the card the next click
   lands on. Its own position comes from the component, which is arithmetic over
   the window and the pointer. */
.mtg-cardpeek {
  position: fixed; z-index: 40; pointer-events: none;
  filter: drop-shadow(0 8px 20px oklch(0.24 0.014 60 / 0.28));
}
/* The one thing inside a preview that may be pressed: the control that turns a
   two-faced card over (card/FaceFlip.ts). The rest stays a picture. */
.mtg-cardpeek .mtg-faceflip { pointer-events: auto; display: block; margin: 0.5rem auto 0; }
.mtg-faceflip { font-size: var(--mtg-text-sm); }
.mtg-rail__body > .mtg-faceflip { margin-block-start: 0.5rem; align-self: center; }
.mtg-decklines__row:hover .mtg-decklines__steps,
.mtg-decklines__row:focus-within .mtg-decklines__steps,
.mtg-decklines__row[data-selected='true'] .mtg-decklines__steps { visibility: visible; }
`;

export const DECK_CSS = `${DECK}${TILE}${MANA}${BUILDER}${COPIES}${SAVEBAR}${STRIPS}${DECKLIST}`;
