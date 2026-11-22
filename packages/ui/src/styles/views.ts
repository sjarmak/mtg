/**
 * Route-level layout: the card gallery, the replay turn rail, the analysis
 * tables. Deliberately thin — the three dependent surfaces bring their own
 * content and inherit this vocabulary rather than replacing it.
 *
 * No hero-metric tiles: aggregate numbers live in a table with their units and
 * their denominators visible, because a balance number without its sample size
 * is a vibe.
 */
import { ASK_BAND_ALWAYS, ASK_BANDS, ASK_FIT_STEPS, askFitAttribute, askFitScale } from './ask-fit';
import { FULL_FACE_WIDTH_REM } from '@mtg/card-geometry';
import { cssNumber, MICRO_LABEL } from './number';
import { SPOKEN_NOT_DRAWN } from './base';
import { SHORT_VIEWPORT_QUERY, TABLE } from './board/geometry';

const GALLERY = `
.mtg-gallery { display: flex; flex-wrap: wrap; gap: var(--mtg-space-4); }
/* The index face. A compact card is drawn at the battlefield's thumbnail width,
   where the name is the shortest thing that identifies a permanent a person can
   also see on the table. In the gallery the name and the type line are all there
   is, so the face gets the width that lets both of them finish. The height is
   what the index is for either way: no art window, no rules box, three times the
   cards down the page. */
.mtg-gallery .mtg-card[data-size='compact'] { --card-w: 13rem; }
/* The pool pane is the MTGO curve at both densities: one ascending column per
   mana value. It scrolls locally on a narrow viewport instead of shrinking
   card names into unreadable slivers.

   Both, since mtg-rgc.21. Full used to be a wrapping gallery, which emitted the
   cards in the same order and could not say so. What the density changes here is
   the face inside the column and how wide the column is drawn: a full face was
   measured at 15.25rem and there is no reason to hold it to the width a name and
   a type line need. */
.mtg-builder-curve {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(11rem, 13rem);
  gap: var(--mtg-space-3); align-items: start; justify-content: start;
  overflow-x: auto; padding-block-end: var(--mtg-space-2);
}
.mtg-builder-curve[data-view='full'] { grid-auto-columns: ${cssNumber(FULL_FACE_WIDTH_REM)}rem; }
/* The token rather than a share of --card-w, for the reason ./panel.ts states
   where it does the same: this width is a percentage, and a percentage in a
   font-size is a percentage of the parent's type. */
.mtg-builder-curve .mtg-card { --card-w: 100%; width: 100%; --rules-type: var(--mtg-text-sm); }
/* The same groups stacked, with their faces wrapping under each head, for a
   collection that is a column of a workbench rather than a band across a page
   (routes/deck/CurveColumns.ts's CurveFlow, mtg-xiso). One direction of scroll:
   the sideways one is what put the ninth mana value behind a scrollbar at the
   bottom of 26,769px of cards.

   auto-fill with a 1fr ceiling, so the faces grow into whatever the pane is
   given rather than leaving a ragged gutter down its right edge. The floor is
   the same width the columns use, which is what a name and a type line need,
   inside a min() against the pane: a bare rem floor does not shrink below itself,
   so a pane dragged narrower than one face would paint the faces cut off at its
   clip rather than at one per row. The move list learned that first and
   ../test/touch-sheet.ts holds both rules to it. */
.mtg-builder-curve[data-flow='rows'] {
  grid-auto-flow: row; grid-auto-columns: auto;
  grid-template-columns: minmax(0, 1fr);
  overflow-x: visible;
}
.mtg-builder-curve[data-flow='rows'] .mtg-deck__column {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(min(11rem, 100%), 1fr));
  gap: var(--mtg-space-2); align-items: start;
}
.mtg-builder-curve[data-flow='rows'][data-view='full'] .mtg-deck__column {
  grid-template-columns: repeat(auto-fill, minmax(min(${cssNumber(FULL_FACE_WIDTH_REM)}rem, 100%), 1fr));
}
/* The Limited pool keeps the face at the one width, without the 1fr ceiling.
   Its deck pane draws columns of that width beside it, and the playtester asked for
   the pool's cards to be the deck's size (mtg-84703); stretched to fill the row
   they came out 270 to 317px against the deck's 244. The ragged gutter the
   ceiling avoids is less than one face wide. */
.mtg-builder:not([data-builder='constructed']) .mtg-builder-curve[data-flow='rows'][data-view='full'] .mtg-deck__column {
  grid-template-columns: repeat(auto-fill, min(${cssNumber(FULL_FACE_WIDTH_REM)}rem, 100%));
}
/* The head names the whole row rather than sitting in the first cell of it, and
   stays put while the faces under it scroll past. */
.mtg-builder-curve[data-flow='rows'] .mtg-deck__column-head {
  grid-column: 1 / -1;
  position: sticky; inset-block-start: 0; z-index: 1;
  justify-content: flex-start;
  background: var(--mtg-surface-page);
}
/* The Constructed builder's curve readout: one rung per mana value between the
   deck's cheapest card and its dearest, drawn above the deck pane at both
   densities. Its numbers are cards rather than tiles, which is the rule
   styles/deck.ts states for the compact columns; this is the same row of numbers
   with a bar under each, kept on screen when the pane is drawing full faces.

   The bar track has a height so the stem's percentage has something to be a
   percentage of, and the row aligns on its baseline rather than stretching, so a
   deck with one six-drop draws one short bar instead of six tall ones. */
.mtg-curve {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); align-items: flex-end;
  list-style: none; margin: 0 0 var(--mtg-space-3); padding: 0;
}
.mtg-curve__step {
  display: flex; flex-direction: column; align-items: center; gap: var(--mtg-space-1);
  min-width: 2.75rem;
}
.mtg-curve__count {
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 700;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink);
}
.mtg-curve__bar {
  display: flex; align-items: flex-end; justify-content: center;
  block-size: 3.5rem; inline-size: 1.5rem;
  background: var(--mtg-surface-sunken); border-radius: var(--mtg-radius-sm);
}
.mtg-curve__stem {
  inline-size: 100%;
  background: var(--mtg-accent); border-radius: var(--mtg-radius-sm);
}
.mtg-curve__value {
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); white-space: nowrap;
}
/* A saved deck and the control that deletes it, kept together so the pair wraps
   as one rather than leaving a Delete under somebody else's name. */
.mtg-saved-deck { display: inline-flex; align-items: center; gap: var(--mtg-space-1); }
.mtg-saved-decks__note {
  margin: 0 0 var(--mtg-space-2); font-size: var(--mtg-text-sm); color: var(--mtg-negative);
}
/* The deck as text, which is the route out of this browser that always works;
   routes/deck/browser-file.ts says why a download is not. It is monospaced and
   full width because it is a decklist somebody reads line by line, and it
   resizes vertically only: a box a person can drag wider than its pane is a
   horizontal scrollbar on the whole page. */
.mtg-decklist {
  inline-size: 100%; resize: vertical;
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xs); line-height: 1.5;
  padding: var(--mtg-space-2);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-sunken); color: var(--mtg-ink);
}
.mtg-decklist:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-filters { display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); align-items: center; }
.mtg-filters__label {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint); margin-right: var(--mtg-space-1);
}
/* The Cards page's one control bar: search, identity, type, rarity, mana value,
   size. It sticks under the shell bar so a filter keeps changing what is on
   screen after the gallery has been scrolled -- the same offset
   \`.mtg-deck__pane-head\` uses, and static under 450px for the same reason it
   is: the shell bar's height stops being one number once its pills wrap, and a
   bar guessing wrong covers the heading rather than sitting below it. */
.mtg-cardbar {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-3); align-items: center;
  position: sticky; top: calc(3.5rem - var(--mtg-space-3)); z-index: 1;
  background: var(--mtg-surface-page);
  border-bottom: 1px solid var(--mtg-line);
  padding-block: var(--mtg-space-3);
  margin-block-start: calc(var(--mtg-space-3) * -1);
}
@media (max-width: 450px) {
  .mtg-cardbar { position: static; }
}
/* On a screen with no height the bar's own air is the cards it costs.

   Measured at 844x390 with the browser in compact: the bar is 96.1px and the
   first card starts 219.6px down a 390px screen, so a phone in landscape sees
   one row of an index of 371 cards. The bar wraps to two rows there and nothing
   here changes that -- eight identity pills, three selects and a density switch
   do not fit on one 844px line and the controls are the point of the route. What
   comes off is the padding above and below them and the gap between the two
   rows: 24px of the 96, and 24px is a fifth of a compact card. */
@media ${SHORT_VIEWPORT_QUERY} {
  .mtg-cardbar { gap: var(--mtg-space-2); padding-block: var(--mtg-space-1); }
}
/* The bar's micro-labels are spoken and not drawn, because every control on it
   already says what it narrows: each select's unset entry reads "Any type"
   rather than "Any", the search box carries its placeholder, and the identity
   row is pips with their letters on them. Drawn, they were six small-caps words
   that pushed Size onto a second line at 1440px and filled a 844x390 phone with
   three rows of controls and no cards. */
.mtg-cardbar .mtg-filters__label { ${SPOKEN_NOT_DRAWN} }
/* The one control on the bar that wants the room left over, so a long card name
   is readable while typing. It has a floor as well, because a wrapped bar hands
   the search whatever is left of the last line, which can be nothing. */
.mtg-cardbar__search { flex: 1 1 14rem; min-inline-size: 12rem; }
.mtg-cardbar__search .mtg-input { flex: 1; min-inline-size: 0; }
/* What a reduced build left out (\`../routes/cards/MissingCards.ts\`). It sits
   between the bar and the gallery because that is where its subject is: the
   holes are in the list below it. Shut, it is one line; open, it is a reason per
   refused position, so the list gets its own scroll rather than pushing the
   gallery off the screen. */
.mtg-missing {
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-sunken);
  padding: var(--mtg-space-2) var(--mtg-space-3);
  margin-block: var(--mtg-space-3);
}
.mtg-missing__summary { cursor: pointer; font-size: var(--mtg-text-sm); font-weight: 600; }
.mtg-missing__summary:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 2px; }
.mtg-missing__list {
  list-style: none; margin: 0; padding: 0;
  max-block-size: 22rem; overflow-y: auto;
  font-size: var(--mtg-text-xs);
}
.mtg-missing__row {
  display: grid; grid-template-columns: minmax(10rem, 1fr) minmax(8rem, auto);
  gap: 0 var(--mtg-space-2); align-items: baseline;
  padding-block: var(--mtg-space-1);
  border-block-start: 1px solid var(--mtg-line);
}
.mtg-missing__name { font-weight: 600; }
.mtg-missing__meta { color: var(--mtg-ink-muted); text-align: end; }
.mtg-missing__why { grid-column: 1 / -1; color: var(--mtg-ink-faint); }
@media (max-width: 450px) {
  .mtg-missing__row { grid-template-columns: 1fr; }
  .mtg-missing__meta { text-align: start; }
}
.mtg-toolbar { display: flex; flex-wrap: wrap; gap: var(--mtg-space-3); align-items: center; }
.mtg-toolbar__spacer { flex: 1; }
.mtg-field { display: inline-flex; align-items: center; gap: var(--mtg-space-2); font-size: var(--mtg-text-sm); }
.mtg-field__label { color: var(--mtg-ink-muted); }
.mtg-select {
  font: inherit; font-size: var(--mtg-text-sm);
  padding: var(--mtg-space-1) var(--mtg-space-2);
  background: var(--mtg-surface-raised); color: var(--mtg-ink);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
}
`;

const TIMELINE = `
.mtg-timeline { display: flex; flex-direction: column; }
.mtg-turn {
  display: grid; grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: var(--mtg-space-3); align-items: start;
  width: 100%; padding: var(--mtg-space-2) var(--mtg-space-1);
  appearance: none; font: inherit; color: inherit; text-align: left; cursor: pointer;
  background: transparent;
  border: 0; border-top: 1px solid var(--mtg-line);
  transition: background var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-turn:hover { background: var(--mtg-surface-sunken); }
.mtg-turn:first-child { border-top: 0; }
.mtg-turn[data-selected='true'] { background: var(--mtg-accent-soft); }
/* \`min-width: 0\` because the name in this column is a deck's, and a deck's name
   is as long as its author made it. The track is 4.5rem; a grid item's automatic
   minimum size is its content, so \`WIELD THE OBLITERATOR\` widened the column
   past the track and painted itself under the counts beside it — measured at
   1440x900 on the 2026-08-23 sweep, and again at 390x844 (\`mtg-dcxg.1\`). Wrapped
   rather than ellipsized: this is the only place either seat is named on the
   route, and half a deck name is not a seat. */
.mtg-turn__no {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0; overflow-wrap: anywhere;
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums;
}
.mtg-turn__no-value { font-weight: 700; }
.mtg-turn__owner {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-turn__facts { display: flex; flex-wrap: wrap; gap: var(--mtg-space-1) var(--mtg-space-3); }
.mtg-fact { display: inline-flex; align-items: baseline; gap: var(--mtg-space-1); font-size: var(--mtg-text-sm); }
.mtg-fact__label { color: var(--mtg-ink-muted); font-size: var(--mtg-text-xs); }
.mtg-fact__value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }

.mtg-lifebar { display: flex; align-items: center; gap: var(--mtg-space-2); }
.mtg-lifebar__track {
  position: relative; height: 6px; flex: 1; min-width: 4rem;
  background: var(--mtg-surface-inset); border-radius: var(--mtg-radius-pill); overflow: hidden;
}
.mtg-lifebar__fill { height: 100%; border-radius: var(--mtg-radius-pill); background: var(--mtg-ink-muted); }
.mtg-lifebar[data-side='user'] .mtg-lifebar__fill { background: var(--mtg-accent); }
.mtg-lifebar[data-side='oppo'] .mtg-lifebar__fill { background: var(--mtg-ink-faint); }
.mtg-lifebar__value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-size: var(--mtg-text-sm); width: 2ch; text-align: right; }
`;

const ANALYSIS = `
.mtg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: var(--mtg-space-4); align-items: start; }
.mtg-dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--mtg-space-2) var(--mtg-space-4); }
.mtg-dl__key { color: var(--mtg-ink-muted); font-size: var(--mtg-text-sm); }
.mtg-dl__value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-size: var(--mtg-text-sm); text-align: right; }
.mtg-hint { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); max-width: var(--mtg-measure); }
.mtg-page-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--mtg-space-3); }
.mtg-page-title { font-size: var(--mtg-text-lg); font-weight: 600; letter-spacing: -0.01em; }
.mtg-page-note { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
`;

/* The table is the mat and nothing else now: the legal moves and the
   altered-size notes are both inside it, in the side rail board/Board.ts draws
   (`mtg-bc2.137`). `.mtg-play__table` stays as a named link in the chain that
   carries the viewport's leftover height down to the mat, which is why it is a
   column of one child rather than nothing.

   `.mtg-play__notes` is the sealed builder's problem list and nothing else now.
   The played table drew the same list of altered sizes in a rail panel, and that
   panel is gone: the board face carries the printed pair itself, struck through
   in the corner and named, so the rail was restating the table.

   The gaps are the small step rather than the large one, and that is a budget
   decision: on this route the column holds the strip and the table and nothing
   else, on a screen that has to fit both boards, the stack, the hand and every
   legal move at once (`mtg-bc2.128`). */
const PLAY = `
.mtg-play { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* The table takes the focus ring programmatically, after a pointer press on a
   panel header leaves it stranded on that header (routes/play/PlayView.ts,
   mtg-s9p). Nobody tabbed here, so nothing is drawn as though they had; a
   player who really is navigating by keyboard is on a control, and every one of
   those draws its own focus-visible ring. */
.mtg-play:focus { outline: none; }
.mtg-play__table { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-play__notes {
  margin: 0; padding-left: var(--mtg-space-5);
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
}

/* Not sticky any more: a command bar the width of the page has nothing to
   follow the reader down, and a sticky element under the mat would cover it. */
.mtg-prompt__explain { margin: 0 0 var(--mtg-space-3); font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); max-width: var(--mtg-measure); }
/* Carries a thrown kernel error under role="alert", so it is a failure and not
   a caution: negative, not pending. A full 1px rule rather than the colored
   left stripe it used to have, which is the one border treatment this system
   never uses. */
.mtg-prompt__warning {
  margin: 0 0 var(--mtg-space-3); padding: var(--mtg-space-2) var(--mtg-space-3);
  font-size: var(--mtg-text-sm); color: var(--mtg-negative);
  background: var(--mtg-surface-inset); border: 1px solid var(--mtg-negative);
  border-radius: var(--mtg-radius-sm);
}

/* The board-size warning (issue 302, routes/play/board-cap.ts). A caution rather
   than a failure, so it borrows the warning's box with the pending keyline and
   full-strength ink instead of the negative color: nothing went wrong yet, the
   game is only told it is near the size where it stops. */
.mtg-board-cap-note {
  margin: 0 0 var(--mtg-space-2); padding: var(--mtg-space-1) var(--mtg-space-3);
  font-size: var(--mtg-text-sm); color: var(--mtg-ink);
  background: var(--mtg-surface-inset); border: 1px solid var(--mtg-pending);
  border-radius: var(--mtg-radius-sm);
}

/* One column of groups, because the move list is a rail again — see the note on
   COMMAND_RAIL below for why it moved back. auto-fit still, so a wider
   window (or a future surface that gives the list more room) gets two columns
   without a second rule. Each column is one heading and its moves, and the
   group's own gap owns the spacing between them.

   The track floor is min(11rem, 100%) rather than a bare 11rem, and that is
   mtg-6i4 — a bug rather than a refinement. A grid track minimum is a floor a
   grid item never shrinks below, so in the ask column — which board/rail.ts caps
   at 11rem and lets fall to a pod's width on a narrow screen — every group laid
   out at the full 176px whatever the column was, and hung out over the board.

   Two lanes found it independently, from opposite ends, and both readings are
   kept because each is the giveaway the other is not. The ask-column lane
   (mtg-6i4) measured the label at exactly 150px — 176px less the button's
   padding and border — at all three desktop viewports while the column it sat in
   was 176 / 160.9 / 127.7px: a constant inside a variable. The touch lane
   (mtg-yg8) measured what that costs going the other way, on
   ../../tools/touch-targets.ts's table page in chrome-headless-shell
   151.0.7922.47: an option laid out at 176px painted 162px at 1440x900, 146.9px
   at 1280x800, 113.7px at 1024x768 and 85.8px at 810x1080, so 51% of every move
   button was off the surface at the iPad's portrait width, taking the detail
   line with it — and a hit test at the button's laid-out center found whatever
   was painted behind.

   Wrapping the minimum in min() says the track wants 11rem and takes the
   container when the container is narrower, which is the bargain board/rail.ts's
   PLAY_ASK_REM docblock already stated and could not keep: a label in this
   column wraps rather than being cut. Measured after: labels of 124px, 108.9px
   and 75.7px, none outside the column at any viewport or either board size. */
.mtg-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); gap: var(--mtg-space-3); align-items: start; }
.mtg-choices__group { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* A run of moves that share an act, and the act above them (routes/play/rail.ts).
   The run is a block inside the group so the shared line and the buttons it
   covers cannot be separated by the group's own gap. */
.mtg-choices__run { display: flex; flex-direction: column; gap: var(--mtg-space-1); }
.mtg-choices__shared {
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
  overflow-wrap: break-word;
}
/* The half of the shared sentence the buttons under it used to carry, drawn in
   the type the unfolded button drew it in (.mtg-choice__detail below) so the
   folded block reads as one option's two lines rather than as two headings. It
   wraps where the button's own detail ellipsizes: this line is printed once for
   the whole run, so there is no column of them to keep level. */
.mtg-choices__shared-detail {
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); font-family: var(--mtg-font-mono);
  overflow-wrap: break-word;
}
.mtg-choices__group-title {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
  padding-bottom: var(--mtg-space-1); border-bottom: 1px solid var(--mtg-line);
}
.mtg-choices__list { display: flex; flex-direction: column; gap: var(--mtg-space-1); }
/* The one choice answered by typing rather than by pressing (routes/play/rail.ts).
   A bare <form> is a block, so its label, field and button stacked flush with
   no gap while every other group in this rail was a spaced column. mtg-21s0. */
.mtg-choices__text { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-damage-assignment { display: grid; gap: var(--mtg-space-2); }
.mtg-prompt--damage {
  position: fixed; z-index: 40;
  inset-inline-end: max(var(--mtg-space-4), env(safe-area-inset-right));
  inset-block-end: max(var(--mtg-space-4), env(safe-area-inset-bottom));
  inline-size: min(28rem, calc(100vw - 2 * var(--mtg-space-4) - env(safe-area-inset-left) - env(safe-area-inset-right)));
  max-block-size: calc(100dvh - 2 * var(--mtg-space-4) - env(safe-area-inset-bottom));
  box-shadow: var(--mtg-shadow-table);
}
.mtg-prompt--damage .mtg-panel__body { overflow-y: auto; }
.mtg-damage-assignment__summary { display: flex; justify-content: space-between; gap: var(--mtg-space-3); font-variant-numeric: tabular-nums; }
.mtg-damage-assignment__summary span { color: var(--mtg-ink-muted); }
.mtg-damage-assignment__row { display: grid; grid-template-columns: minmax(0, 1fr) 5rem; align-items: center; gap: var(--mtg-space-3); padding-block: var(--mtg-space-2); border-block-start: 1px solid var(--mtg-line); }
.mtg-damage-assignment__recipient { display: grid; gap: var(--mtg-space-1); min-inline-size: 0; }
.mtg-damage-assignment__recipient span { color: var(--mtg-ink-muted); font-size: var(--mtg-text-sm); font-variant-numeric: tabular-nums; }
.mtg-damage-assignment__amount { inline-size: 5rem; min-inline-size: 0; min-block-size: 44px; text-align: end; font-variant-numeric: tabular-nums; }
.mtg-damage-assignment__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--mtg-space-2); }
/* The pair that settles an optional trigger's answer (../routes/play/rail.ts).
   Ruled off above rather than boxed: it sits under the moves in the same
   scrolling body, and a box there would read as a third answer to the question.
   The two buttons share the row evenly, which is what says they are a pair and
   not a primary with an alternative - neither "always take" nor "always
   decline" is the one a player is being steered toward. */
.mtg-choices__yield {
  display: flex; flex-wrap: wrap; gap: var(--mtg-space-1);
  margin-top: var(--mtg-space-2); padding-top: var(--mtg-space-2);
  border-top: 1px solid var(--mtg-line);
}
.mtg-choices__yield > .mtg-btn { flex: 1 1 0; font-size: var(--mtg-text-xs); }
.mtg-choices__yield-note {
  flex: 1 0 100%; margin: 0;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
}
/* The note that stands in for an empty list.
   \`passPriority\` left the enumeration on 2026-08-20 for a fixed home in the
   priority foot (../routes/play/rail.ts), so a window where passing is the only
   legal move is a group list with nothing in it. A box that drew a headline, a
   count of one and then nothing would read as a surface that had failed rather
   than as a position with one move in it, so it says so instead and names both
   ways to take it. Muted and unbordered: it is prose about the position, not a
   control, and it must not be mistaken for one. */
.mtg-choices__note {
  margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}

/* Label over detail rather than beside it: a column of the bar is narrower than
   the rail was, and a target name and a cost on one line ellipsized each other. */
.mtg-choice {
  display: flex; flex-direction: column; align-items: stretch; gap: 1px;
  width: 100%; text-align: left; cursor: pointer;
  /* The query container the label's fit ladder is measured against. The button
     rather than the column, because the button's content box IS the label's
     available width once its border and inset are taken off, so a band stated
     in rem needs no second subtraction to stay true. Every choice button and
     not only the ask column's: a rung fires on the button's own width, so a
     wide picker takes none of them and a narrow one is helped for free. */
  container-name: mtg-ask; container-type: inline-size;
  padding: var(--mtg-space-2) var(--mtg-space-3);
  font: inherit; font-size: var(--mtg-text-sm);
  color: var(--mtg-ink); background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
  transition: background var(--mtg-duration-fast) var(--mtg-ease), border-color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-choice:hover:not(:disabled) { background: var(--mtg-accent-soft); border-color: var(--mtg-accent); }
.mtg-choice:active:not(:disabled) { background: var(--mtg-surface-sunken); }
.mtg-choice:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-choice[data-kind='passPriority'] { background: var(--mtg-surface-sunken); }
.mtg-choice[data-kind='concede'] { color: var(--mtg-negative); }
/* Last, so it beats the kind rules above: a disabled concede is disabled first
   and a concession second. Without this the button kept full contrast and still
   lit up on hover while doing nothing. The .mtg-btn:disabled rule in base.ts is
   ordered the same way against its own variant rules, for the same reason. */
.mtg-choice:disabled {
  color: var(--mtg-ink-faint); background: var(--mtg-surface-sunken);
  border-color: var(--mtg-line); cursor: not-allowed;
}
/* A word longer than the box is the one thing wrapping cannot place, and the ask
   column is narrow enough to produce them: with the track minimum fixed, three
   labels at 1024x768 spilled a card name past their own edge. Breaking inside a
   word is the last resort a browser takes only when there is no break
   opportunity left, so an ordinary two-word name is unaffected.

   It stays the floor and it stops being the first step. ASK_FIT_RULES below
   shrinks the label down a ladder as the button narrows, and break-word is what
   happens after the ladder runs out: at 810x1080 that was eight of ten move
   labels breaking mid-word, Mountai over a lone n. --ask-fit is unset until a
   rung fires, so every label outside the ladder's reach is set at
   --mtg-text-sm exactly as before. */
.mtg-choice__label { min-width: 0; overflow-wrap: break-word; font-size: calc(var(--mtg-text-sm) * var(--ask-fit, 1)); }
.mtg-choice__detail {
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); font-family: var(--mtg-font-mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;

/**
 * The shortest the move list may be squeezed to: the line that explains the
 * decision, one group heading, and one whole option button under them. A panel
 * that fits its content is not the same promise as a panel that always shows
 * something you can press.
 */
const COMMAND_ROW_FLOOR_REM = 5;

/*
 * The play route is a screen, not a page — and since `mtg-ryix` so is the
 * replay viewer, off this same chain.
 *
 * Neither the mockup nor the first build was drawn against a viewport budget, so
 * the opponent's board, the stack, your board, the hand rail and the command bar
 * simply stacked down the page and the last two fell below the fold at ordinary
 * window heights. Every legal move is a button in that command bar, so it was an
 * interface that could not be used without scrolling on every priority.
 *
 * The fix is one chain, not one rule. The shell is bounded by the viewport, and
 * every link between it and the mat carries `min-height: 0` — the default
 * minimum size of a flex item is its content, so a single link without it pins
 * the whole column open at the height of whatever is inside and the page grows
 * again. `board/fit.ts` picks the chain up at the mat and spends the leftover there.
 *
 * `.mtg-shell__main` still scrolls rather than clipping. The live table shrinks
 * to whatever it is given, so it never reaches that; the sealed builder is a
 * gallery of a hundred cards that genuinely is taller than a screen, and clipping
 * it would put the "Play this deck" button somewhere unreachable. A route that
 * cannot fit gets a scrollbar; the point is that the table no longer needs one.
 *
 * **The command bar is gone from the column, and that is mtg-bc2.137.** It used
 * to be a full-width block under the mat, served first, capped at 32% of the
 * table and floored so its first option stayed pressable. Every one of those
 * rules was managing a conflict that should not have existed: the mat and the
 * move list were competing for the same axis, and the list won a share of it
 * that grew with the number of legal moves, so a declare-blockers prompt shrank
 * every card on the table. COMMAND_RAIL below is where it went and why.
 *
 * The panel's own chrome is cut to the small step here rather than in `base.ts`:
 * `.mtg-panel` is the vocabulary of the analysis tables, where a generous head
 * and body are right, and this is the one panel that competes with a game board
 * for a screen.
 *
 * **The replay viewer joins the chain rather than copying it (`mtg-ryix`).** It
 * renders the same `Board`, and it rendered it in ordinary document flow: 2,451px
 * of page at 1280x800 with neither battlefield whole. The scope on the first two
 * rules is `board/geometry.ts`'s `TABLE`, which is the same selector the mat's
 * own rules are emitted under, so the shell, the main and the mat are told the
 * same thing by one declaration each. `.mtg-replay` and `.mtg-replay__table` are
 * the replay's two links in it; `replay.ts` is where that route's own layout is.
 */
const FIT = `
.mtg-shell${TABLE} { height: 100dvh; min-height: 0; }
${TABLE} .mtg-shell__main {
  flex: 1; min-height: 0; overflow: auto;
  display: flex; flex-direction: column;
  padding: var(--mtg-space-1) var(--mtg-space-4);
}
.mtg-play-route, .mtg-live { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-play-route, .mtg-live, .mtg-play, .mtg-play__table, .mtg-replay, .mtg-replay__table {
  flex: 1; min-height: 0;
}
/* The page title keeps the spacing this system sets with gaps rather than the
   user agent's own margin on an h1, which on this route is a band of empty
   table, and it drops to the scale of the strip it now sits above: the word
   "Play" over the Play tab is the least load-bearing text on the screen. */
.mtg-play-route .mtg-page-title { margin: 0; font-size: var(--mtg-text-sm); }
/* The sealed builder's problem list, which is the only .mtg-play__notes left:
   the played table's altered-size panel is gone entirely. Unshrinkable, because
   the reason a deck is illegal is not the thing to squeeze. */
.mtg-play__notes { flex: none; }
/* The line that says the pool below it was opened from cards standing in for a
   set nobody staged: PlayRoute's absent state. Unshrinkable for the same
   reason as the list above: a pool the reader may not have meant to open is
   exactly the sentence a short viewport must not squeeze to nothing. */
.mtg-play-route > .mtg-page-note { flex: none; }
`;

/*
 * The move list as a rail, which is where every other client puts its actions.
 *
 * **This reverses a decision argued and recorded in docs/mockups/README.md:**
 * direction B chose "the choice list as a full-width command bar under the
 * hand", and that is what shipped. The requirement changed under it. The list is
 * the only thing on this surface whose *size depends on the game state* — a
 * priority offers eight options and a declare-blockers prompt can offer five
 * hundred — so whichever axis it takes, it takes a varying amount of. On the
 * height axis it was taking it from the cards, and mtg-bc2.129's verifier
 * measured the result over a 238-step game: an art window of 8.55px at a
 * 31-option decision. On the width axis it takes it from a rail that holds a
 * fixed 17rem whatever the game does, and the overflow scrolls inside the panel.
 *
 * board/rail.ts owns where the rail sits and how tall it is; this owns what the
 * panel does with what it is given. Two rules carry the promise: the body
 * scrolls its own moves rather than growing, and it is floored at one whole
 * option row so there is always something to press.
 *
 * **And the scroll says it is one (`mtg-46g`).** The list holds more than the
 * panel at every viewport a game is played at — measured on the flagship fixture
 * at twelve permanents a side, 2,519px of moves in a 357px body at 1024x768 —
 * and what a player was reading was a row of moves that stopped. The browser's
 * own scrollbar is drawn there and is worth stating, because the rig that
 * reported "no sign there are more" runs headless with `--hide-scrollbars` and
 * had painted it out of every screenshot. It is 15px of a 125.7px column all the
 * same, so `thin` gives most of that back to the words. The shadows are what a
 * scrollbar does not do: they sit on the cut edge itself, so the half-row at the
 * fold reads as cut rather than as the end of the list. `local` layers are the
 * cover — they scroll with the content and slide out from under the shadow at
 * each end — and the `scroll` layers are the shadow, so the pair appears exactly
 * when there is something past that edge and at no other time.
 */
const COMMAND_RAIL = `
.mtg-prompt { display: flex; flex-direction: column; min-height: 0; }
.mtg-prompt .mtg-panel__head {
  flex: none; padding: var(--mtg-space-1) var(--mtg-space-3); flex-wrap: wrap;
}
/* The shape of the list, above the fold (routes/play/rail.ts's askIndex).

   It is the head's note rather than a line under it, and it wraps inside the
   head when it has to: ../../test/play/ask-fold.browser.test.ts measured the
   body at 1024x768 showing 4 move buttons whole, and a row of its own took that
   to 3. A quarter of the enumeration is too much to pay for a sentence about the
   rest of it. flex-wrap on the head above is what lets the words wrap rather
   than push the title off the row at 157.1px, which is the ask column there. */
.mtg-prompt__index { overflow-wrap: break-word; text-align: right; }
/* And it goes away where the scroller is at its shortest. On a phone held
   sideways the ask panel has 38.78px of body once the head takes two lines, and
   styles/touch.ts floors a move button at 44px under a coarse pointer, so the
   index turns a column showing one move into a column showing none —
   ../../test/play/ask-column-phone.browser.test.ts measures exactly that and is
   what caught it. The count comes back in its place: it is one line whatever the
   width, and where nothing fits, how many there are is the more useful of the
   two things to say. */
@media ${SHORT_VIEWPORT_QUERY} {
  .mtg-prompt__index { display: none; }
  /* Every property SPOKEN_NOT_DRAWN sets, put back: the count is drawn here. */
  .mtg-prompt__count {
    position: static; width: auto; height: auto; padding: 0; margin: 0;
    overflow: visible; clip-path: none; white-space: normal;
  }
}
/* The count the index displaces. It is in the head at every width and spoken at
   every width — the index above it is aria-hidden, so this is the only thing on
   the panel that says how many moves there are — and drawn only where the index
   is not. Which one is drawn is a media query rather than a render, because a
   component cannot ask how tall the panel came out. */
.mtg-prompt__count { ${SPOKEN_NOT_DRAWN} }
.mtg-prompt .mtg-panel__body {
  flex: 1; min-height: ${String(COMMAND_ROW_FLOOR_REM)}rem; overflow-y: auto;
  padding: var(--mtg-space-1) var(--mtg-space-2);
  scrollbar-width: thin;
  background:
    linear-gradient(var(--mtg-surface-raised) 30%, transparent) center top / 100% 1rem no-repeat local,
    linear-gradient(transparent, var(--mtg-surface-raised) 70%) center bottom / 100% 1rem no-repeat local,
    radial-gradient(farthest-side at 50% 0, var(--mtg-scroll-edge), transparent) center top / 100% 0.5rem no-repeat scroll,
    radial-gradient(farthest-side at 50% 100%, var(--mtg-scroll-edge), transparent) center bottom / 100% 0.5rem no-repeat scroll;
}
/* The anchored foot: the two answers to a decision, outside the scroller.
   routes/play/rail.ts's anchoredChoices argues which prompts get one; this is
   what it costs the layout. flex: none against the body's flex: 1, so the
   scroller yields every pixel the buttons need and the panel's height is
   unchanged — which is the whole of why the foot cannot be pushed off a box
   capped at 46% of the lanes (board/ask-flyout.ts), 171.11px of them at 844x390.

   The buttons go side by side rather than stacked. A decision is two answers of
   equal standing, and an equal share of 26rem of flyout gives Keep this hand
   and Mulligan a line apiece; stacked, the second sat 9.52px below the box that
   started this. flex-basis 0 so a long label does not take
   the width off a short one. They keep .mtg-choice's own type and padding, and
   with it styles/touch.ts's 44px coarse floor, because they are the same
   control the list draws — a second button vocabulary here would be a second
   opinion about what pressing it does (routes/play/choice-button.ts). */
.mtg-prompt__foot {
  flex: none; padding: var(--mtg-space-2); border-top: 1px solid var(--mtg-line);
}
.mtg-prompt__foot .mtg-choices { display: block; }
.mtg-prompt__foot .mtg-choices__list { flex-direction: row; gap: var(--mtg-space-2); }
.mtg-prompt__foot .mtg-choice { flex: 1 1 0; min-inline-size: 0; align-items: center; text-align: center; }
.mtg-prompt .mtg-prompt__explain { margin-bottom: var(--mtg-space-1); }
.mtg-prompt .mtg-choices { gap: var(--mtg-space-2); }
/* The one step narrower on both insets, and it is bought rather than spent: at
   1024x768 the ask column was 127.7px when this was read (ASK_PERCENT was 13;
   it is 157.1px now, and both labels below gain that 29.4px), and the panel's
   border, the body's inset,
   the button's own inset and the scrollbar leave a 65.7px label for a card name.
   Taking the small step here instead of the medium one on the two insets that
   nest gives that label 81.7px — a quarter more room for words — and costs the
   battlefield nothing, which is the alternative: board/rail.ts's ASK_PERCENT
   buys width for this column out of the card rows. The analysis tables keep the
   generous inset; this is the panel that competes with a game board. */
.mtg-prompt .mtg-choice { padding: var(--mtg-space-2); }
`;

/**
 * The floor under a phase node, in rem.
 *
 * WCAG 2.5.8: an interactive target is at least 24 x 24 CSS px, and a node is a
 * button. The bar's type is the smallest on the sheet and its padding is one
 * space step, which together come to less than that, so the floor is stated
 * rather than left to what the text happens to measure. Since `mtg-rgc.2` the
 * node is a three-line stack and clears it on content alone; the floor stays as
 * the floor, which is what it was for.
 */
const PHASE_NODE_MIN_REM = 1.5;

/**
 * The stop marks' own size, in rem, and the one place on this route that does
 * not draw from the type scale.
 *
 * They are not type: they are two rows of triangles above and below a word, and
 * every pixel of them comes off the battlefield. At `--mtg-text-xs` the node
 * stood 12px taller than it needed to for a shape whose whole content is
 * "pointing up, filled". Small enough to cost almost nothing, large enough that
 * filled and hollow are still two different things at arm's length; the browser
 * measurement in `tools/step-bar.ts` is what settled the number.
 */
const PHASE_PIP_REM = 0.5;

/**
 * How narrow one of the thirteen step columns is allowed to get.
 *
 * Zero would be simpler and is wrong: the columns share the bar equally, so at a
 * narrow window every one of them shrinks together and a floor of zero ends in
 * thirteen ellipses. This is about three characters at the bar's type size,
 * which is the width at which "Att…" is still a word somebody can read. It is
 * deliberately low enough that the whole bar fits inside the lanes column at
 * 1024px with room over — `tools/step-bar.ts` reports 36.3px columns against
 * this 28px floor — so the floor never becomes the thing that makes the bar
 * overflow.
 */
const PHASE_NODE_MIN_WIDTH_REM = 1.75;

/**
 * How much of the bar's row the turn is allowed to take (`mtg-rgc.13`).
 *
 * The badge took `max-width: 12rem` on the strip, where it shared a full-width
 * row with nothing that had to fit. On the bar it shares a row with thirteen step
 * names, and the row wraps rather than clips, so what the turn takes is not
 * width — it is lines, and a line is roughly 33.9px off the near battlefield.
 *
 * Measured in chrome-headless-shell 151 over `tools/step-bar.ts`, with the long
 * seat name that tool deals on purpose. Lines in the steps row, and the near
 * battlefield's height beside it:
 *
 *   cap        1440x900        1280x800        1024x768
 *   no head    1, 316.9        2, 271.3        2, 255.3
 *   5rem       2, 303.9        2, 271.3        2, 255.3
 *   5.5rem     2, 303.9        2, 271.3        3, 242.3
 *   8rem       2, 298.9        2, 271.3        3, 237.3
 *
 * So the turn costs one line at the widest viewport and nothing at the other
 * two, and **5rem is a ledge rather than a preference**: half a rem more takes a
 * third line at 1024x768, which is the viewport with the least to give.
 *
 * The cap leaves the label 51.8px. `Turn 18:` is 43.8px in this face, so the
 * turn and its number always survive and the seat name is what the ellipsis
 * eats — Magic Online's own answer at its own width (`Turn 18: BswizzM…`).
 * Losing the name here costs less than it looks: whose turn it is is also the
 * lifted band and the pod's Active badge (`board/band.ts`, `mtg-1nc`), and the
 * whole sentence, step included, is in the control's accessible name.
 *
 * A phone re-values this, and `./mobile.ts` holds the number and the reason: a
 * tall phone wraps the turn with the steps as one row, so the head's width comes
 * off one line rather than all of them and the turn can be read whole there
 * (mtg-lab issue 186). **A desktop re-values it in the
 * other direction, and the block directly below holds that number**: this one is
 * the narrow window's answer, not every window's.
 */
const PHASE_HEAD_MAX_REM = 5;

/*
 * And the desktop re-values all three of those numbers, because the ledge above
 * belongs to 1024x768 and not to the window this lab is used in.
 *
 * The playtester's interface pass asks the bar to be readable — "no tiny labels",
 * "stronger current-phase state" — and asks the whole surface to be optimized
 * for 1440 to 1600. Every number above was fitted against 1024x768, which is
 * the viewport with the least to give and the one where half a rem more of turn
 * is a third line of steps. Holding a 1600px window to 1024's budget is paying
 * that viewport's bill twice.
 *
 * Measured in chrome-headless-shell 151 over `tools/step-bar.ts`, 2026-08-22,
 * with the same long seat name the tool deals on purpose. Steps-row height and
 * the near battlefield's height, shipped against the two candidates:
 *
 *   viewport   shipped 11px/5rem   12px/9rem     13px/9rem
 *   1600x900   33.9, 316.9         35.4, 316.2   62.8, 302.4
 *   1440x900   59.9, 303.9         72.8, 297.5   75.7, 296.0
 *   1280x800   69.9, 271.3         72.8, 269.8   75.7, 268.4
 *
 * 12px rather than `--mtg-text-sm`, and the 1600 row is the whole reason: at
 * 13px the thirteen names plus a 9rem turn no longer fit one line, and a bar
 * that wraps stops reading as a timeline — which is the thing this bar is. A
 * type token would be the tidier write and the worse drawing, which is the same
 * trade `PHASE_PIP_REM` above makes for the same bar.
 *
 * The turn is what the width buys. At 5rem the label has 51.8px and the app's
 * own `Turn 7: Opponent` wants 99, so every desktop capture since `mtg-rgc.13`
 * has read `Turn 7: …` — a fact drawn as an ellipsis. 9rem clears
 * `Turn 12: Opponent` at 106px with the seat name still the part an unusually
 * long one loses.
 *
 * Both conditions are load-bearing. Width, because the ledge below 1200 is real
 * and measured. Height, because a wide short window — a landscape phone is
 * 844px, but a 1440x500 one is not — is `./mobile.ts`'s short tier, where the
 * steps row stops wrapping and scrolls sideways instead, and a larger word in a
 * scroller is more scrolling rather than more reading.
 */
const PHASE_WIDE_MIN_WIDTH_PX = 1200;
const PHASE_WIDE_MIN_HEIGHT_REM = 40;
const PHASE_WIDE_TEXT_REM = 0.75;
const PHASE_HEAD_WIDE_MAX_REM = 9;

/*
 * The step bar: the whole turn structure under the viewer's battlefield, with a
 * stop row per player on every node that can hold one (`mtg-bz2.1`, `mtg-rgc.2`,
 * `mtg-rgc.6`, `routes/play/PhaseBar.ts`).
 *
 * **`mtg-rgc.6` took it off the strip and put it where Magic Online draws it**:
 * in the near band, hard against the bottom edge of the lower battlefield with
 * the hand directly under it. All three game captures in `references/` are that
 * arrangement, and `board/Board.ts` argues why the bar belongs to the half of the
 * table you act from. Everything below is unchanged except the two rules that
 * were about being one item on a flex *row* beside a badge and a dealer's
 * button — the bar is now a block in a flex *column*, so `flex: none` is what
 * keeps it the height of its own content and the width it is given.
 *
 * That deletes the strip's width trade with it. The bar used to state a 32rem
 * floor so that the strip wrapped its dealer's button rather than letting the
 * thirteen columns collapse to two characters each, and at 1024x768 that cost a
 * second strip row on every sealed game: 74.8px of strip where the other two
 * viewports spent 33.9. Under the board the bar has the whole lanes column and
 * nothing to trade against, so the floor and the spacer rule that went with it
 * are gone rather than kept as inert declarations.
 *
 * **Where the shortfall goes is `mtg-rgc.2`'s decision and it still holds.** It
 * used to go sideways: the nodes kept their natural width and the bar scrolled,
 * which at 1280x800 on a sealed game meant three of thirteen nodes were off the
 * right-hand edge. A bar whose whole purpose is "where you will next be asked,
 * and where your opponent will be" cannot answer that with three of its nodes
 * scrolled out of sight, so the shortfall goes into the words. Thirteen equal
 * columns (`flex: 1 1 0` on the node, floored at `PHASE_NODE_MIN_WIDTH_REM`) and
 * `text-overflow: ellipsis` on the label is what Magic Online does under the same
 * pressure — `references/maxresdefault-80883895.jpg` is a turn-18 board reading
 * `Begin… Attack Block Dam… End… Main End Clean…` — and it keeps `scrollWidth
 * === clientWidth` at every width, so nothing is ever hidden behind a scroll a
 * player has no reason to suspect. The *drawn* word clips; the DOM text and the
 * accessible name do not, so what a screen reader and a voice control get is the
 * same at 1024px as at 1440px.
 *
 * **The bar brings its own ground, and that is a contrast fix rather than a
 * decoration.** `styles/board/band.ts` values `--mtg-ink-faint` against the well
 * and records what the near band does to it. An unset step name is exactly that
 * token, so a bar laid straight on the band would be the sheet's faintest ink on
 * the one ground it was not chosen for: measured on the played table, that ink
 * reads 1.64:1 against the near band and 2.35:1 against the mat, and the bar
 * separates from the band it sits in at 1.43:1. `--mtg-mat` is also the ground
 * the bar sits on in every reference capture — the chrome between the board panel
 * and the hand — so the ground is the reference's and the arithmetic's at once.
 * Neither number is AA and neither was before this move: a micro-label token is
 * the one class of text this sheet has never cleared AA with, a node with a stop
 * on it carries `--mtg-ink` instead, and the step the game is in is 13.64:1 on
 * its accent ground.
 *
 * **Measured in chrome-headless-shell 151.0.7922.47 on 2026-08-14**, through
 * `tools/step-bar.ts`, on a *sealed* table — the one `npm run play` opens, which
 * carries the dealer's controls and a long seat name. Before the move and after
 * it, at the three viewports:
 *
 *   viewport   bar width       column      words clipped   strip height
 *   1440x900   923.5 → 934.0   64.3 → 64.5   3 → 3         33.9 → 28.8
 *   1280x800   763.5 → 789.1   52.0 → 53.4   6 → 6         33.9 → 28.8
 *   1024x768   672.4 → 566.3   45.0 → 36.3  11 → 12        74.8 → 28.8
 *
 * The bar is 33.9px tall at all three, its steps report `scrollWidth ===
 * clientWidth`, and the page never scrolls sideways. Two viewports gain a little
 * column width, because the lanes column is wider than what the badge and the
 * odometer left the bar on the strip. **1024x768 loses it**, and that is the
 * trade this move makes there: the lanes column is 566px against the strip's 992,
 * so a column falls from 45px to 36.3 and a twelfth word clips — bought with the
 * whole second strip row, 74.8px down to 28.8, which is 46px of table back on the
 * one viewport that has the least of it.
 *
 * The tracking is the sheet's one micro-label value and stays there. Dropping it
 * to 0.02em bought two columns' worth of word back at 1280x800 and broke
 * `test/polish.test.ts`, which sweeps every uppercase rule in the sheet against
 * DESIGN.md's Micro-Label Rule. A bar is not the place to reopen a convergence
 * ten selectors already went through.
 *
 * **A node is three lines**, which is where its height comes from: the opponent's
 * stop row above the name, the player's own below it, in the order the mat draws
 * the two seats. The pips are `PHASE_PIP_REM` rather than a type token because
 * they are shapes and not type, and the difference is about 12px of battlefield.
 *
 * The gaps and the padding are raw rem rather than space tokens, which is what
 * buys the fit: at `--mtg-space-1` throughout, the bar overflowed by 51px at
 * 1280x800 even before the rows were added.
 *
 * Nothing here invents a control. A node is a `<button>` with the sheet's own
 * type scale and focus ring; every mark it draws is `aria-hidden` and the state
 * is a word in the button's name, which is what a four-state control has instead
 * of `aria-pressed` (`PhaseBar.ts` carries that reasoning). The one thing on the
 * bar that *is* two-state — the combat-beat toggle at its end — carries
 * `aria-pressed` and takes `base.ts`'s pressed drawing rather than a new one.
 */
const PHASE_BAR = `
.mtg-phasebar {
  flex: none;
  display: flex; align-items: stretch; gap: 0.25rem;
  padding: 0 0.25rem;
  background: var(--mtg-mat); border-radius: var(--mtg-radius-sm);
}
/* The turn, at the left-hand end, where Magic Online writes it (\`mtg-rgc.13\`).

   \`flex: none\` for the reason the toggle at the other end has it: the thirteen
   steps are the part that gives under width pressure, and a turn squeezed to an
   ellipsis is a fact nobody can read. What it takes off the steps is the cap
   above, which is measured and is a ledge — 5rem rather than the 12rem the badge
   took on the strip, because the row it shares wraps and half a rem more is a
   third line at the narrowest viewport. */
.mtg-phasebar > .mtg-turnstops, .mtg-phasebar > .mtg-badge { flex: none; align-self: center; }
.mtg-phasebar > .mtg-badge { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtg-phasebar > .mtg-turnstops .mtg-turnstops__head,
.mtg-phasebar > .mtg-badge { max-width: ${cssNumber(PHASE_HEAD_MAX_REM)}rem; }
/* The row wraps, and that is where the shortfall goes now.

   Thirteen labels want 779px of row (measured in chrome-headless-shell 151 over
   ../../tools/step-bar.ts, Σ content 677 + 78 of padding and border + 24 of
   gap). The lanes column gives them 863px at 1440x900, 718 at 1280x800 and 495
   at 1024x768, so two of the three viewports are short and one of them is short
   by 284px. A second line costs 33.9px of table at the viewport that is short
   and nothing at the one that is not, which is less than the 46px the bar's move
   under the board already gave 1024x768 back. */
.mtg-phasebar__steps {
  flex: 1 1 0; min-width: 0;
  display: flex; align-items: stretch; flex-wrap: wrap; gap: 0.125rem;
  overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin;
}
/* A column is as wide as its word wants to be, and the surplus is shared.

   flex-basis was 0, which is one equal column per step whatever is written in
   it, and equal columns are why a bar with room to spare still cut words: at
   1440x900 three of thirteen were drawn short with 84px of the row unspent,
   because BEGIN COMBAT wants 92px of the 65px every step got and END wants 25. A
   content basis spends the row where the words are.

   The pair with the wrap above is what makes it a fit rather than a
   redistribution. A content basis alone shrinks every column by the same *share*
   under a deficit, which at 1280x800 turned six clipped words into thirteen -
   each missing only a character, and thirteen ellipses is still the drawing
   mtg-rgc.2 refused. With the wrap there is no deficit on a line to distribute,
   so the basis is what each column keeps. */
.mtg-phasebar__node {
  flex: 1 1 auto; min-width: ${cssNumber(PHASE_NODE_MIN_WIDTH_REM)}rem;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: ${cssNumber(PHASE_NODE_MIN_REM)}rem;
  padding: 0 0.125rem;
  font: inherit; ${MICRO_LABEL} white-space: nowrap;
  /* Muted rather than faint. Faint is the ink for a thing beside the point --
     a caption, a count -- and every step on this bar is a place the game
     stops; the hierarchy that matters is where the game *is*, and that is
     carried below by an accent field and a border rather than by making the
     other twelve labels hard to read. */
  color: var(--mtg-ink-muted);
  background: none; border: 1px solid transparent; border-radius: var(--mtg-radius-sm);
}
/* The name line, and the one thing on the bar that is allowed to be cut short.
   \`min-width: 0\` is what lets it be — a flex item refuses to shrink below its
   content otherwise, and the ellipsis would never fire. */
.mtg-phasebar__name {
  display: flex; align-items: center; justify-content: center; gap: 0.125rem;
  min-width: 0; max-width: 100%;
}
.mtg-phasebar__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.mtg-phasebar__node {
  appearance: none; cursor: pointer;
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease), color var(--mtg-duration-fast) var(--mtg-ease);
}
button.mtg-phasebar__node:hover { border-color: var(--mtg-accent); color: var(--mtg-ink); }
button.mtg-phasebar__node:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-phasebar__node:not([data-stop='none']) { color: var(--mtg-ink); }
/* The two stop rows. Which row a mark is in is half of what it says, so they are
   fixed lines rather than something that collapses when empty: an unset row
   draws the hollow mark and holds its place, and a step no stop can be set at
   draws no row at all. Fill carries the meaning and the color reinforces it,
   which is WCAG 1.4.1 — the marks stay readable with the palette removed. */
.mtg-phasebar__pip {
  font-size: ${cssNumber(PHASE_PIP_REM)}rem; line-height: 1;
  color: var(--mtg-ink-faint); opacity: 0.55;
}
.mtg-phasebar__pip[data-set='true'] { color: var(--mtg-accent); opacity: 1; }
/* The third mark, and the only one that is not a stop: the game pauses here to
   show combat (\`mtg-0sn\`, \`mtg-885\`). On the name line because it belongs to
   neither player's row, and pressing the node does not move it. The fact is in
   the node's accessible name too, because a glyph says nothing to a screen
   reader. */
.mtg-phasebar__beat { font-size: ${cssNumber(PHASE_PIP_REM)}rem; line-height: 1; color: var(--mtg-pending); }
/* The one node a turn does not always enter, drawn as the aside it is. The
   condition itself is in the node's accessible name, because an opacity says
   nothing to a screen reader. */
.mtg-phasebar__node[data-conditional='true'] .mtg-phasebar__text { opacity: 0.65; }
/* Last of the node rules, so where the game is beats how the node is set: a
   player looking for the game's position must not have to read two signals. */
.mtg-phasebar__node[aria-current='step'] {
  background: var(--mtg-accent-soft); border-color: var(--mtg-accent); color: var(--mtg-ink);
  /* Where the game is, said a third way. A field and a border are two, and a
     player scanning thirteen uppercase words at a glance reads weight before
     either of them. */
  font-weight: 700;
}
/* The bar's own controls, at the end of the strip, where Magic Online puts the
   ones that are about the bar rather than about a step. \`flex: none\` is
   load-bearing: the steps give under width pressure and these do not, because a
   toggle that shrank to an ellipsis would be a control nobody can identify.

   They sit INSIDE \`.mtg-phasebar__steps\` rather than beside it (\`mtg-t9n7\`).
   Beside it, \`flex: none\` on a sibling of a \`flex: 1 1 0\` row took their
   width off the steps before the steps wrapped, so the shortfall landed on every
   wrapped line: 105.8px of bar at 1024x768 against the 69.9 before the pace
   control existed, and the 32px of table that went with it is what four browser
   gates measure. Inside the row they wrap with the steps and cost one short
   line instead of a slice of every line.

   \`position: sticky; right: 0\` is the other half, and it is for the tier that
   does not wrap. \`./mobile.ts\` makes this row a sideways scroller on a short
   table on purpose, and a control that scrolls with the steps is off the
   right-hand end until the player scrolls for it, which is worse than the width
   it was costing. Pinned against the scrollport it stays where it was on every
   table. The pin needs an opaque field under it, because the steps pass beneath
   it rather than around it, and the field is the bar's own \`--mtg-mat\` so the
   pinned control reads as part of the bar rather than as a card over it. */
.mtg-phasebar__controls {
  position: sticky; right: 0; z-index: 1;
  flex: none; align-self: stretch;
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding-left: 0.25rem;
  background: var(--mtg-mat);
}
/*

   The pace (\`mtg-kwu\`) takes the beats' appearance outright rather than a
   second one of its own. They sit adjacent, they are the same size, and they are
   the two settings on this bar that are about watching rather than about
   playing; drawing them differently would say they are different kinds of thing.
   It carries no \`aria-pressed\` and no mark, because it cycles four values
   rather than toggling one, so the pressed-state rules below name only the
   toggle. */
.mtg-phasebar__beats,
.mtg-phasebar__pace {
  flex: none; align-self: center;
  display: inline-flex; align-items: center; gap: 0.125rem;
  min-height: ${cssNumber(PHASE_NODE_MIN_REM)}rem;
  padding: 0 0.25rem;
  appearance: none; cursor: pointer;
  font: inherit; ${MICRO_LABEL} white-space: nowrap;
  color: var(--mtg-ink-faint);
  background: none; border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-sm);
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease), color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-phasebar__beats:hover,
.mtg-phasebar__pace:hover { border-color: var(--mtg-accent); color: var(--mtg-ink); }
.mtg-phasebar__beats:focus-visible,
.mtg-phasebar__pace:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-phasebar__beats[aria-pressed='true'] { color: var(--mtg-ink); border-color: var(--mtg-accent); }
.mtg-phasebar__beats[aria-pressed='true'] .mtg-phasebar__beats-mark { color: var(--mtg-pending); }
.mtg-phasebar__beats-mark,
.mtg-phasebar__pace-mark { font-size: ${cssNumber(PHASE_PIP_REM)}rem; line-height: 1; }
/* Constrained tables spend the control width on familiar playback marks. The
   full words remain in the DOM and return in the wide tier below; title and the
   described hint keep the compact controls named for pointer and assistive
   input. */
.mtg-phasebar__beats-text,
.mtg-phasebar__pace-text { display: none; }
/* What the last press did, for a screen reader and for nobody else. Clipped
   rather than \`display: none\`, which would take it out of the accessibility
   tree and announce nothing at all. */
.mtg-phasebar__status {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
/* The desktop tier, whose numbers and whose measurements are above the sheet.
   A bigger word and a turn that is not an ellipsis, bought with pixels off a
   battlefield the same interface pass calls too empty. */
@media (min-width: ${String(PHASE_WIDE_MIN_WIDTH_PX)}px) and (min-height: ${cssNumber(PHASE_WIDE_MIN_HEIGHT_REM)}rem) {
  .mtg-phasebar__node,
  .mtg-phasebar__pace,
  .mtg-phasebar__beats { font-size: ${cssNumber(PHASE_WIDE_TEXT_REM)}rem; }
  .mtg-phasebar__beats-text,
  .mtg-phasebar__pace-text { display: inline; }
  .mtg-phasebar__pace-mark { display: none; }
  /* And the surplus stops being shared once the row wraps.

     A content basis with \`flex-grow: 1\` shares the leftover equally, which is
     right on a full line and grotesque on a short one: at 1440x900 the row wraps
     after MAIN 2 and the two words left over were drawn as two 500px columns
     with END and CLEANUP marooned at either end of them. Packed and centered,
     the thirteen names read as one sentence that happens to wrap, which is what
     they are. */
  .mtg-phasebar__steps { justify-content: center; }
  .mtg-phasebar__node { flex-grow: 0; }
  .mtg-phasebar > .mtg-turnstops .mtg-turnstops__head,
  .mtg-phasebar > .mtg-badge { max-width: ${cssNumber(PHASE_HEAD_WIDE_MAX_REM)}rem; }
}
`;

/*
 * The auto-pass controls, hanging off the turn indicator (`mtg-6ce`).
 *
 * They were a rail block, floored and capped and clipped beside the move list,
 * and then a folding rail block. Both were chrome in a column that has to hold
 * every legal play on a screen that also holds two boards and two hands.
 * The playtester, 2026-08-13: "I would rather have the stops be settable in the same
 * place where in the upper left the current turn and phase is". So the strip
 * badge is the head and this is the panel it opens, and the rail is one block
 * lighter.
 *
 * **The head is the badge, unchanged in what it draws.** `.mtg-badge` already
 * carries the pill, the ink and the type scale; the rules here are the four a
 * `<button>` needs that a `<span>` did not — the font does not inherit into a
 * button, the user-agent border and appearance have to go, and a control has to
 * show the keyboard where it is. The marker is a rotated triangle, which is
 * affordance rather than information: it says the badge opens, and it is the one
 * thing beside the turn and the phase, because a stop count in the collapsed
 * state is exactly what was asked not to be there.
 *
 * **The panel is anchored, not in flow.** Absolute against the indicator, so
 * opening it does not shove the mat down a row and re-lay every card out for the
 * duration. It is capped at 60% of the viewport and scrolls inside that, for the
 * short window rather than for its own length — `mtg-bz2.1` took the twenty-two
 * step toggles out of it and onto the phase bar, so what is left is four
 * buttons, a hint and the four-row mark legend.
 * `z-index: 30` puts it over the mat and under the hover zoom (45) and the card
 * tooltip (40), which are the two things on this route that are allowed to cover
 * it.
 *
 * **And it opens upward, which is `mtg-rgc.13`'s second half.** The head moved
 * to the left-hand end of the step bar, and the bar's two neighbors are the
 * viewer's own battlefield above it and their hand below it. `inset-block-start`
 * dropped the panel straight onto the hand — the surface `mtg-rgc.5` spent a
 * lane making the largest thing on screen, and the surface the setting is
 * *about*: a stop exists so you can hold up an instant, and the instant you are
 * holding up is a card in that hand. Covering it while the player decides where
 * to be asked covers the evidence for the decision. `inset-block-end` puts the
 * panel's bottom edge on the bar's top edge instead, so it grows into the
 * battlefield, which is board state the player is reading rather than a hand
 * they are choosing from.
 *
 * It is not the fix for what it covers, and that was settled once already:
 * `mtg-5jl` measured this panel over the opponent's whole status row and the
 * answer was four ways out rather than a new address (`../routes/play/
 * TurnStops.ts`). What the direction buys is which surface pays while it is
 * open, and that is measured rather than argued
 * (`../../test/play/stops-panel.browser.test.ts`, chrome-headless-shell 151, a
 * board of nine permanents a side and a hand of seven):
 *
 *   viewport   panel        upward covers        downward covers
 *   1024x768   416x332.9    96,986 of the mat    62,209 of the hand
 *   1280x800   416x332.9    105,701              58,058
 *   1440x900   416x332.9    124,666              76,609
 *
 * The room above is measured too: the bar's top edge is 534.2px down a 768px
 * window at the shortest viewport this table supports, against a panel 332.9px
 * tall, so the 60dvh cap is never what decides and nothing opens off the top.
 *
 * Nothing clips it on the way: `.mtg-board__side` and `.mtg-board__lanes` are
 * plain flex columns with no overflow of their own (`./board/fit.ts`), and the
 * one scroller in the near band is `.mtg-board__spells` inside the battlefield,
 * which the panel is drawn over rather than inside.
 *
 * Nothing here invents a control. The four buttons are `.mtg-btn` with
 * `aria-pressed`, whose pressed state `base.ts` has drawn since long before this
 * panel.
 */
const TURN_STOPS = `
.mtg-turnstops { position: relative; display: inline-flex; }
.mtg-turnstops__head {
  appearance: none; font-family: inherit; cursor: pointer;
  max-width: 12rem;
  border: 1px solid transparent;
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-turnstops__head::after {
  content: '\\25b8'; flex: none; color: var(--mtg-ink-faint);
  transition: transform var(--mtg-duration-fast) var(--mtg-ease);
}
/* Magic Online writes \`Turn 18: BswizzM…\` and clips the name, which is the same
   answer this strip needs (\`mtg-rgc.2\`): the badge is the widest thing on the
   row, the bar beside it is short of width, and a seat name is arbitrarily long.
   The cap is what the badge is allowed to take; the ellipsis lands on the words
   rather than on the disclosure marker, which is why the label has an element of
   its own. The whole sentence, step included, is in the button's accessible
   name, so nothing is lost by clipping — only redrawn. The cap itself is on the
   head rule above, so the badge is described in one place rather than two. */
.mtg-turnstops__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtg-turnstops[data-open='true'] .mtg-turnstops__head::after { transform: rotate(90deg); }
.mtg-turnstops__head:hover { border-color: var(--mtg-accent); }
.mtg-turnstops__head:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 2px; }

.mtg-turnstops__panel {
  position: absolute; z-index: 30;
  inset-block-end: calc(100% + var(--mtg-space-1)); inset-inline-start: 0;
  width: 26rem; max-width: calc(100vw - var(--mtg-space-6));
  max-height: 60dvh; overflow-y: auto;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-3);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-lg);
  box-shadow: var(--mtg-shadow-raised);
}
/* The way out, where a way out is looked for. It is the panel's first child so
   that a screen reader meets it before the settings, and \`align-self\` puts it at
   the top right without taking it out of flow — an absolutely positioned close
   control overlaps the first row it is drawn over at narrow widths. */
.mtg-turnstops__close {
  align-self: flex-end;
  appearance: none; font: inherit; font-size: var(--mtg-text-xs); cursor: pointer;
  padding: 0 var(--mtg-space-1);
  color: var(--mtg-ink-muted); background: none;
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-sm);
}
.mtg-turnstops__close:hover { color: var(--mtg-ink); border-color: var(--mtg-accent); }
.mtg-turnstops__close:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 2px; }
.mtg-turnstops__row { display: flex; flex-wrap: wrap; gap: var(--mtg-space-1); }
.mtg-turnstops__hint { margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
.mtg-turnstops__legend {
  display: grid; grid-template-columns: auto 1fr; gap: var(--mtg-space-1) var(--mtg-space-2);
  margin: 0; padding: 0; list-style: none;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
}
.mtg-turnstops__legend-row { display: contents; }
.mtg-turnstops__legend-mark { color: var(--mtg-accent); font-size: var(--mtg-text-sm); line-height: 1; }
/* The same colors the bar draws these marks in, keyed the same way, so the
   legend is a picture of the bar rather than a second palette. */
.mtg-turnstops__legend-row[data-mark='none'] .mtg-turnstops__legend-mark { color: var(--mtg-ink-faint); }
.mtg-turnstops__legend-row[data-mark='beat'] .mtg-turnstops__legend-mark { color: var(--mtg-pending); }
/* The settled optional-trigger answers (../routes/play/trigger-yields.ts).
   A row is a sentence and the control that undoes it, so the two are pushed to
   opposite ends and the sentence takes what is left: the ability's name is the
   half that varies in length, and a button whose width followed it would put
   the way out of this setting somewhere different on every row. Unstyled list,
   like the legend above it, for the same reason - it is structure for a reader
   rather than a bulleted list for the eye. */
.mtg-turnstops__yields {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  margin: 0; padding: 0; list-style: none;
}
.mtg-turnstops__yield-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--mtg-space-2);
}
.mtg-turnstops__yield-name {
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
  overflow-wrap: break-word; min-inline-size: 0;
}
.mtg-turnstops__yield-row .mtg-btn { flex: 0 0 auto; font-size: var(--mtg-text-xs); }
/* The game menu: one word on the strip and a sheet under it. Opens downward,
   aligned to its own start, because that is where the control is: .mtg-toolbar
   is a flex row and the strip is its only child, so the button sits at the start
   of the band above the table, not the end. It was written end-aligned on the
   opposite belief, and a 256px sheet hung off the start-most control starts at
   -182.75 CSS px — the whole Game ID line off the left of the window at every
   viewport width, which is what a person sees as a cut-off text box
   (../../test/play/game-menu.browser.test.ts measures both edges).
   Same surface, border and shadow as the stops panel: they are the same object —
   a small panel over the board, opened from a control in the chrome — and two
   treatments would read as two kinds of thing. */
.mtg-gamemenu { position: relative; display: inline-flex; }
.mtg-gamemenu__caret { margin-inline-start: var(--mtg-space-1); color: var(--mtg-ink-faint); }
.mtg-gamemenu__sheet {
  position: absolute; z-index: 30;
  inset-block-start: calc(100% + var(--mtg-space-1)); inset-inline-start: 0;
  min-inline-size: 16rem; max-inline-size: calc(100vw - var(--mtg-space-6));
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  padding: var(--mtg-space-3);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-lg);
  box-shadow: var(--mtg-shadow-raised);
}
/* A seed is one token with no space in it, so the line it sits on cannot wrap on
   its own. Where the sheet is clamped narrower than the seed — a phone, where
   max-inline-size bites — the row has to be allowed to shrink and the token to
   break, or the id runs out through the panel's own padding. */
.mtg-gamemenu__sheet .mtg-fact { min-inline-size: 0; flex-wrap: wrap; }
.mtg-gamemenu__sheet .mtg-fact__value { min-inline-size: 0; overflow-wrap: anywhere; }
`;

/*
 * 2026-08-14: the pass, at the foot of the ask column.
 *
 * It used to be a band spanning the whole table, at the end of `.mtg-play__table`'s
 * flex column, with the priority sentence beside it — and that band is what
 * The playtester asked to be rid of. It was `flex: none` on the one column that
 * carries the viewport's leftover height down to the mat, so it took 36.9 CSS px
 * of that column at every viewport whatever the game was doing.
 *
 * Here it is a block in the pod column, between the panel that answers the
 * current question and the near seat's own pod, so it costs the *width* axis,
 * which on this table is the axis that is not scarce (`board/rail.ts` argues that
 * trade for both columns at once). `flex: none`, so the panel above it takes
 * everything else and a long move list is still the thing that grows.
 *
 * What it costs the column it is now in is one button row: measured against the
 * flagship set, the move list's own box loses 36.9px at every viewport, which is
 * about one move at 1024x768. That is `mtg-euc`'s axis and it is the honest price
 * of a pass that never moves — `routes/play/pass.ts` states why that promise is
 * absolute and `routes/play/priority.ts` states what came with it and what did
 * not.
 */
const PRIORITY_FOOT = `
.mtg-priority {
  flex: none;
  display: flex; flex-direction: column; align-items: stretch;
  gap: var(--mtg-space-1);
}
/* The window over your own spell, above the button it is telling you to hold
   off pressing. Drawn only while it is true, so the foot is one button tall for
   most of a game, and at the accent because it is the half of this block a
   player is being told to act on. */
.mtg-priority__own {
  margin: 0; font-size: var(--mtg-text-xs); font-weight: 600; color: var(--mtg-accent);
}
/* The unspent land drop, in the same place and at the same weight as the clause
   above it, because it is the same kind of statement: a fact about this window
   that the move list cannot give, drawn only while it is true (mtg-re3).

   Full-strength ink, not the amber the button below wears. --mtg-pending is
   already under AA as text (board/band.ts measured it), and this is a sentence
   whose whole job is to be read; the hue channel belongs on the control, where
   it is a keyline rather than letterforms. Not the accent either - that color
   is spent on the clause above, and two demands for attention in a block one
   button tall is neither of them being read. */
.mtg-priority__land {
  margin: 0; font-size: var(--mtg-text-xs); font-weight: 600; color: var(--mtg-ink);
}
.mtg-play__pass { flex: none; }
/* And the button itself says it, because a player who has learned where the pass
   is stops reading the column above it. A keyline rather than a fill: the pass is
   the primary control of this surface and recoloring it would either shout or
   make it look unavailable, and it is neither. It never disables anything -
   ../routes/play/pass.ts keeps the click on the enumerated index. */
.mtg-play__pass[data-land-drop] {
  box-shadow: inset 0 0 0 2px var(--mtg-pending);
}
/* The pass and its yield panel share one box, and that box is the button's own
   until the panel opens (mtg-nxh). Relative rather than in flow, because the
   promise routes/play/pass.ts calls absolute is that nothing makes the button
   move: a panel that took height would push the pass down the column at the
   moment the player is holding it. */
.mtg-pass { flex: none; position: relative; display: flex; flex-direction: column; }
/* Above the button rather than below it. The pass sits at the foot of the ask
   column with the near seat's own pod directly under it, so a panel drawn
   downward opens over the player's own vitals; upward it opens over the move
   list, which is the thing the player has just decided against. */
.mtg-pass__yields {
  position: absolute; inset-inline: 0; inset-block-end: calc(100% + var(--mtg-space-1));
  z-index: 3;
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  padding: var(--mtg-space-1);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised); box-shadow: var(--mtg-shadow-card);
}
.mtg-pass__yields .mtg-btn { inline-size: 100%; }
/* The take-back, under the pass and quieter than it.

   Unavailable is drawn and never enforced (../routes/play/undo.ts), so the
   drawing is the whole of the signal: muted ink and a thinner keyline, with the
   pointer left alone. \`cursor: not-allowed\` was the obvious choice and is the
   wrong one here - it says the press will be swallowed, and the press is what
   makes the kernel state its reason. Opacity is left alone for the same reason
   ../styles/tokens.ts keeps text at full strength: a control that is still worth
   pressing should still be worth reading. */
.mtg-undo { flex: none; inline-size: 100%; }
.mtg-undo[data-available='false'] {
  color: var(--mtg-ink-muted); border-color: var(--mtg-line);
}
/* The pass key's answer, under the button rather than beside it: this is the one
   thing here that exists to be read in full, and the column is narrow. It takes
   no height while it has nothing to say, and it is never hidden with
   \`display: none\` — a live region the reader cannot reach is a live region that
   announces nothing. */
.mtg-priority__key-note {
  margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted);
}
`;

/** Every rung's rule at one band, shallowest first; see `ASK_FIT_RULES`. */
function askFitRungs(band: string): string {
  return ASK_FIT_STEPS.slice(1)
    .map(
      (_scale, index) =>
        `  .mtg-choice__label[${askFitAttribute(index + 1)}='${band}'] { --ask-fit: ${cssNumber(askFitScale(index + 1))}; }`,
    )
    .join('\n');
}

/**
 * The move label's fit ladder, as one `--ask-fit` rule per rung per band.
 *
 * `./ask-fit.ts` holds the arithmetic and the argument; this is the half that
 * has to be a stylesheet, because the width a rung answers to is the browser's
 * and not ours. `../card/type-line.ts` and `./card.ts`'s `TYPE_BAND_RULES` are
 * the same pair one surface over.
 *
 * **Source order is the whole tie-break.** Every rule here has the same
 * specificity and a label matches several at once — a band fires at its own
 * width and at every width under it, and two rungs can round to one band — so
 * the one that wins is the last one written. Deepest rung last within a block,
 * because a label that has fallen to rung 4 must not be pulled back to rung 2 by
 * a rule that also matches; narrowest band last across blocks, for the same
 * reason one step out; and `ASK_BAND_ALWAYS` first of all, since a rung that
 * applies at every width is the shallowest claim on the element.
 */
const ASK_FIT_RULES = `
${askFitRungs(ASK_BAND_ALWAYS)}
${[...ASK_BANDS]
  .reverse()
  .map(
    (band) => `@container mtg-ask (max-width: ${cssNumber(band)}rem) {\n${askFitRungs(cssNumber(band))}\n}`,
  )
  .join('\n')}
`;

/* The shape every route that is a page rather than a table sits in.
 *
 * It used to hold the set list and More's destination rows as well. Both are
 * gone: the set list was a page whose whole content the picker in the bar
 * already carries on every route, and More was a page whose whole content was
 * two links to tabs that are tabs again. `.mtg-group__title` outlived both,
 * because the deck panes and the precon picker name their groups the same way. */
const PAGE = `
.mtg-page {
  display: flex; flex-direction: column; gap: var(--mtg-space-4);
  padding-block-end: var(--mtg-space-4);
}
.mtg-group + .mtg-group { margin-block-start: var(--mtg-space-3); }
/* Small caps rather than a heading-sized heading: a label over three rows
   should name them, not outweigh them. */
.mtg-group__title {
  margin: 0 0 var(--mtg-space-2);
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-source-choice { display: flex; flex-direction: column; gap: var(--mtg-space-3); }
.mtg-source-choice__title {
  margin: 0 0 var(--mtg-space-2);
  font-size: var(--mtg-text-sm); font-weight: 600; color: var(--mtg-ink-muted);
}
.mtg-source-choice__group { min-inline-size: 0; }
.mtg-source-choice__select { inline-size: min(100%, 28rem); }
.mtg-printed-precon-deck {
  display: flex; flex: 1 1 auto; flex-direction: column; gap: var(--mtg-space-3);
  min-block-size: 0;
}
.mtg-printed-precon-deck > [data-pane='deck'] { flex: 1 1 auto; min-block-size: 0; }
.mtg-printed-precon-commanders-head {
  display: flex; align-items: center; gap: var(--mtg-space-2);
}
.mtg-printed-precon-commanders {
  display: flex; flex: 0 1 auto; flex-wrap: wrap; gap: var(--mtg-space-2);
  min-block-size: 0; overflow: auto;
}
/* The word the full face has nowhere to put: mtg-dna4y moved the commander
   from the board face to the full one, and the full face has no footer region
   for a caller's footnote. It goes above the card instead. */
.mtg-printed-precon-commander {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
}
.mtg-printed-precon-commander__label {
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-precon-matchup {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--mtg-space-5);
  margin-block: var(--mtg-space-2) var(--mtg-space-4);
}
.mtg-precon-matchup[data-seats='one'] { grid-template-columns: minmax(0, 1fr); }
.mtg-precon-matchup__deck {
  display: grid;
  grid-template-columns: minmax(9rem, 12rem) minmax(0, 1fr);
  grid-template-areas: 'seat seat' 'faces details';
  gap: var(--mtg-space-2) var(--mtg-space-4);
  align-items: start;
  padding-block: var(--mtg-space-3);
  border-block: 1px solid var(--mtg-line);
}
.mtg-precon-matchup__seat {
  grid-area: seat;
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-precon-matchup__faces {
  grid-area: faces;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  width: min(100%, 12rem);
}
.mtg-precon-matchup__faces > .mtg-card { --card-w: 100%; --rules-type: var(--mtg-text-sm); }
.mtg-precon-matchup__details {
  grid-area: details;
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--mtg-space-2);
}
.mtg-precon-matchup__name { margin: 0; font-size: var(--mtg-text-lg); }
.mtg-precon-matchup__summary,
.mtg-precon-matchup__plan { margin: 0; color: var(--mtg-ink-muted); }
.mtg-precon-matchup__summary { font-weight: 650; color: var(--mtg-ink); }
@media (max-width: 70rem) {
  .mtg-precon-matchup__deck {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'seat' 'faces' 'details';
  }
}
@media (max-width: 42rem) {
  .mtg-precon-matchup { grid-template-columns: minmax(0, 1fr); gap: var(--mtg-space-3); }
}
.mtg-pairing {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--mtg-space-2);
  margin-block: var(--mtg-space-3);
}
.mtg-pairing__title { margin: 0; font-size: var(--mtg-text-base); }
.mtg-pairing__line { margin: 0; }
.mtg-pairing__label {
  margin: 0;
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-pairing__opponents { display: flex; flex-wrap: wrap; gap: var(--mtg-space-2); }
.mtg-pairing__opponents > .mtg-chip {
  block-size: auto; padding-block: var(--mtg-space-1);
  border-radius: var(--mtg-radius-md); text-align: start;
}
.mtg-pairing__head-to-head {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--mtg-space-2);
  padding-block-start: var(--mtg-space-3); border-top: 1px solid var(--mtg-line);
}
`;

/* Play's chooser (`mtg-tewc.5`): the set it is showing, and the two ways in.
 *
 * The header is the set's name with its category beside it, and it is drawn at
 * the scale of a page title rather than a route title because on this page it
 * *is* the subject — the question the page asks is "what do I want to play",
 * and the answer starts with which set. It is removed from the markup entirely
 * once a game is on, so nothing here has to hide it.
 *
 * `data-playing` is the height budget. `.mtg-play-route` is a flex column whose
 * leftover goes to the one child that asks for it, and once the decks section
 * holds a live table it is that child; `min-height: 0` is what lets the table
 * inside it scroll rather than push the column taller than the viewport.
 */
const CHOOSER = `
.mtg-playhead {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--mtg-space-2);
}
.mtg-playhead__name {
  margin: 0; font-size: var(--mtg-text-lg); font-weight: 600; letter-spacing: -0.01em;
}
.mtg-playhead__kind {
  padding: 1px var(--mtg-space-2); border-radius: var(--mtg-radius-pill);
  font-size: var(--mtg-text-xs); font-weight: 600;
  background: var(--mtg-surface-sunken); color: var(--mtg-pending);
}
/* \`flex: none\`, and the reason is the landscape phone. The route is a flex
   column with the viewport's height to spend, so every section is shrinkable by
   default, and \`min-height: 0\` used to sit here and let one shrink past its own
   content. At 844x390 it did: the decks section was given less height than the
   five cards in it needed, the cards overflowed it rather than resizing, and
   "SEALED / Open six boosters" was drawn straight through the middle of two of
   them. The budget is for the section holding a live table and nothing else, so
   it lives on that section alone (below) and the chooser scrolls, which is what
   \`.mtg-shell__main\` is \`overflow: auto\` for. */
.mtg-playsection {
  display: flex; flex-direction: column; gap: var(--mtg-space-3); flex: none;
}
.mtg-playsection__title {
  margin: 0; font-size: var(--mtg-text-base); font-weight: 600;
  color: var(--mtg-ink-faint);
}
.mtg-playsection__blurb {
  margin: 0; font-size: var(--mtg-text-base); color: var(--mtg-ink-muted);
  max-inline-size: var(--mtg-measure);
}
.mtg-playsection[data-playing='true'] { flex: 1; min-height: 0; gap: var(--mtg-space-2); }
.mtg-playsection[data-boxed='true'] {
  max-inline-size: 40rem; gap: var(--mtg-space-2);
  padding: var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised);
}
/* The LAN button and the reason it did nothing, stacked. The refusal is drawn
   under the control rather than in place of it (\`LanSection.ts\` says why), so
   the two need a gap tighter than the section's own or the sentence reads as a
   third thing in the section instead of an answer to the press. */
.mtg-lanstart {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
}
/* The opponent choice above every Play section: two cells side by side at
   reading width, one under the other on a phone. Each cell is its button and,
   when the cell is dark, the sentence saying why, which is the printed pool
   editor's status row so the two refusals read the same way. */
.mtg-opponents {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--mtg-space-3);
  max-inline-size: 40rem;
}
.mtg-opponents__cell {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--mtg-space-1);
}
@media (max-width: 40rem) {
  .mtg-opponents { grid-template-columns: minmax(0, 1fr); }
}
`;

/**
 * The invite panel, and the one thing it is not allowed to be: furniture.
 *
 * It sits above a board on the host's screen while the other player is still
 * finding their phone, and it leaves the moment they arrive (`LanInvite.ts`
 * decides that; this only has to not fight it). So it is boxed at reading width
 * the way the sealed section is, rather than a band across a 1440px window.
 *
 * The link is drawn as monospace with `word-break: anywhere`, because it is a
 * UUID and the alternative on a 390px phone is a line that reaches the edge of
 * the screen and stops. It is selectable text as well as a copy button: the
 * button is absent on an insecure origin, which is exactly what a LAN address
 * is, and the link still has to be gettable there.
 *
 * The code is 9rem and has a white ground of its own. A scanner wants dark
 * modules on a light field, and the field this page provides in dark mode is
 * neither.
 */
const LAN = `
.mtg-lan {
  display: flex; flex-direction: column; gap: var(--mtg-space-3); flex: none;
  max-inline-size: 38rem;
  padding: var(--mtg-space-3);
  border: 1px solid var(--mtg-line-strong); border-radius: var(--mtg-radius-md);
  background: var(--mtg-surface-raised);
}
.mtg-lan__title {
  margin: 0;
  ${MICRO_LABEL}
  color: var(--mtg-ink-faint);
}
.mtg-lan__seat { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-lan__body {
  display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--mtg-space-3);
}
.mtg-lan__lines {
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  flex: 1 1 16rem; min-inline-size: 0;
}
.mtg-lan__who { margin: 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
.mtg-lan__url {
  display: block;
  padding: var(--mtg-space-2);
  border-radius: var(--mtg-radius-sm);
  background: var(--mtg-surface-sunken);
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xs);
  overflow-wrap: anywhere; word-break: break-all;
}
.mtg-lan__qr {
  flex: none; inline-size: 9rem; block-size: 9rem;
  border-radius: var(--mtg-radius-sm);
  background: var(--mtg-qr-field);
}
/* The code's own two colors, which live here rather than on the elements: a
   scanner needs dark modules on a light field in both themes, and a fill
   written into the component is a color literal the token gate is right to
   refuse. The quiet zone is the rect; the modules are the one path. */
.mtg-lan__qr > rect { fill: var(--mtg-qr-field); }
.mtg-lan__qr > path { fill: var(--mtg-qr-module); }
.mtg-lan__note { margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
.mtg-lan__more { font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }
.mtg-lan__more > summary { cursor: pointer; }
.mtg-lan__addresses {
  list-style: none; margin: var(--mtg-space-2) 0 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
}
.mtg-lan__addresslabel { display: block; color: var(--mtg-ink-faint); }
`;

export const VIEWS_CSS = `${GALLERY}${TIMELINE}${ANALYSIS}${PLAY}${FIT}${COMMAND_RAIL}${PHASE_BAR}${TURN_STOPS}${PRIORITY_FOOT}${ASK_FIT_RULES}${PAGE}${CHOOSER}${LAN}`;
