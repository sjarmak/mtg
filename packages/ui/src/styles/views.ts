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
import { cssNumber } from './number';
import { TABLE } from './board/geometry';

const GALLERY = `
.mtg-gallery { display: flex; flex-wrap: wrap; gap: var(--mtg-space-4); }
/* The index face. A compact card is drawn at the battlefield's thumbnail width,
   where the name is the shortest thing that identifies a permanent a person can
   also see on the table. In the gallery the name and the type line are all there
   is, so the face gets the width that lets both of them finish. The height is
   what the index is for either way: no art window, no rules box, three times the
   cards down the page. */
.mtg-gallery .mtg-card[data-size='compact'] { --card-w: 13rem; }
/* Limited deck/pool compact mode is the MTGO curve: one ascending column per
   mana value. It scrolls locally on a narrow viewport instead of shrinking
   card names into unreadable slivers. */
.mtg-builder-curve {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(11rem, 13rem);
  gap: var(--mtg-space-3); align-items: start; justify-content: start;
  overflow-x: auto; padding-block-end: var(--mtg-space-2);
}
.mtg-builder-curve .mtg-card[data-size='compact'] { --card-w: 100%; width: 100%; }
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
  font-size: var(--mtg-text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--mtg-ink-faint);
  font-weight: 600; margin-right: var(--mtg-space-1);
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
.mtg-turn__no {
  display: flex; flex-direction: column; gap: 1px;
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums;
}
.mtg-turn__no-value { font-weight: 700; }
.mtg-turn__owner {
  font-size: var(--mtg-text-xs); font-weight: 600; color: var(--mtg-ink-faint);
  text-transform: uppercase; letter-spacing: 0.06em;
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
  font-size: var(--mtg-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--mtg-ink-faint);
  padding-bottom: var(--mtg-space-1); border-bottom: 1px solid var(--mtg-line);
}
.mtg-choices__list { display: flex; flex-direction: column; gap: var(--mtg-space-1); }
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
.mtg-prompt .mtg-panel__head { flex: none; padding: var(--mtg-space-1) var(--mtg-space-3); }
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
.mtg-prompt .mtg-prompt__explain { margin-bottom: var(--mtg-space-1); }
.mtg-prompt .mtg-choices { gap: var(--mtg-space-2); }
/* The one step narrower on both insets, and it is bought rather than spent: at
   1024x768 the ask column is 127.7px, and the panel's border, the body's inset,
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
 * A phone re-values this, and `./mobile.ts` holds the number and the reason: at
 * 390px the bar's row is short enough that 5rem buys a whole extra line of steps
 * out of a lane budget that is fixed there.
 */
const PHASE_HEAD_MAX_REM = 5;

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
  font: inherit; font-size: var(--mtg-text-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap;
  color: var(--mtg-ink-faint);
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
}
/* The bar's own control, at the end of the strip, where Magic Online puts the
   one control that is about the bar rather than about a step. \`flex: none\` is
   load-bearing: the steps give under width pressure and this does not, because a
   toggle that shrank to an ellipsis would be a control nobody can identify. */
.mtg-phasebar__beats {
  flex: none; align-self: center;
  display: inline-flex; align-items: center; gap: 0.125rem;
  min-height: ${cssNumber(PHASE_NODE_MIN_REM)}rem;
  padding: 0 0.25rem;
  appearance: none; cursor: pointer;
  font: inherit; font-size: var(--mtg-text-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap;
  color: var(--mtg-ink-faint);
  background: none; border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-sm);
  transition: border-color var(--mtg-duration-fast) var(--mtg-ease), color var(--mtg-duration-fast) var(--mtg-ease);
}
.mtg-phasebar__beats:hover { border-color: var(--mtg-accent); color: var(--mtg-ink); }
.mtg-phasebar__beats:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-phasebar__beats[aria-pressed='true'] { color: var(--mtg-ink); border-color: var(--mtg-accent); }
.mtg-phasebar__beats[aria-pressed='true'] .mtg-phasebar__beats-mark { color: var(--mtg-pending); }
.mtg-phasebar__beats-mark { font-size: ${cssNumber(PHASE_PIP_REM)}rem; line-height: 1; }
/* What the last press did, for a screen reader and for nobody else. Clipped
   rather than \`display: none\`, which would take it out of the accessibility
   tree and announce nothing at all. */
.mtg-phasebar__status {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
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
.mtg-play__pass { flex: none; }
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

export const VIEWS_CSS = `${GALLERY}${TIMELINE}${ANALYSIS}${PLAY}${FIT}${COMMAND_RAIL}${PHASE_BAR}${TURN_STOPS}${PRIORITY_FOOT}${ASK_FIT_RULES}`;
