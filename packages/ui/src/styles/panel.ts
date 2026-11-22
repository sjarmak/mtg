/**
 * The contextual rail, and the two-track page that puts one beside a workspace.
 *
 * `mtg-aqxi`. Both are shared vocabulary rather than a draft-only sheet: the
 * draft screen was the first surface to need them, deckbuilding is the second,
 * and `../panel/ContextRail.ts` argues why one implementation instead of three.
 *
 * The whole arrangement is one idea — a page that fills the viewport exactly
 * once, with a scrolling workspace and a rail that scrolls separately, and no
 * document scroll under either. That is what §11 asks for and what the *before*
 * screenshots of this lane show missing: at 844x390 the draft screen was one
 * long document, so the pack scrolled the status header off the top and
 * deckbuilding put a two-line explanatory paragraph where the cards should be.
 *
 * The rail collapses by *dropping the rail track*, not by hiding the rail: a
 * hidden panel still has to be reached, and a workspace that keeps a 17rem
 * column reserved for something invisible is the exact waste this lane exists
 * to remove.
 */
import { CARD_TRIM_MM, FRAME_BAND_MM } from '@mtg/card-geometry';
import { cssNumber, MICRO_LABEL } from './number';
import {
  STACK_BOX_FROM_PANE,
  STACK_BOX_SOURCE_PROPERTY,
  STRIP_REGION_CHROME_PX,
  STRIP_REGION_SCROLLBAR_PX,
} from './stack-box';
import { TOUCH_TARGET_PX, WCAG_TARGET_PX } from './touch';

/**
 * How thick a divider is, in pixels.
 *
 * A number rather than a literal in the rules below, because the pane on the far
 * side of a divider has to subtract it: `../routes/deck/builder-split.ts` states
 * its floors as a share of the whole container, and a divider plus its gaps sit
 * inside that whole. 8px is a strip a pointer can find without a rule anyone can
 * see -- the line itself is 2px and inset, which `.mtg-split::after` explains.
 */
export const SPLIT_THICKNESS_PX = 8;

/** How wide the rail is where there is room for it, in rem. */
export const RAIL_REM = 17;

/** Below this the rail goes under the workspace instead of beside it. */
export const RAIL_STACK_QUERY = '(max-width: 60rem)';

/**
 * The height below which a page stops being a document and becomes a screen.
 *
 * The same condition `./board/geometry.ts` uses for the played table, restated
 * here rather than imported, because it means something different: there it is
 * a height budget for a fixed grid, and here it is the switch that turns a
 * scrolling page into one that fits the viewport. Sharing the constant would
 * tie two unrelated decisions to one number.
 */
export const SCREEN_QUERY = '(max-height: 34rem)';

/**
 * The shortest a column in the drafted pool is allowed to be, in CSS pixels.
 *
 * The number is `../routes/deck/strips.ts`'s `DRAFT_STACK_BOX.boxHeight`, and
 * that file reads it from here rather than the other way round because the
 * styles layer never imports from `../routes` -- the same direction
 * `../routes/deck/stack-box.ts` already takes to reach `./deck.ts`'s token.
 *
 * It is stated in both places at once on purpose. Since `mtg-v7sg` the pool is
 * the flexed half of the draft column, so what stops a 15-card pack from
 * squeezing it to a strip is a CSS floor, and what the columns inside it are
 * laid out against is a constant in JS. Two numbers that have to agree, agreeing
 * by construction.
 *
 * A column and not the box around it, which is `mtg-qs2d` and is the whole of
 * that bug: the pool's scrollport holds a count row and two gaps as well as a
 * column, so a scrollport floored at this number is 32px short of the column it
 * is the floor for. `./stack-box.ts`'s `STRIP_REGION_CHROME_PX` is that
 * difference and the rule below adds it, so the sentence the floor is here to
 * make true -- the pool never falls below the box its columns are laid out
 * against -- is true of the scrollport rather than only of the arithmetic.
 */
export const DRAFT_POOL_COLUMN_FLOOR_PX = 240;

/**
 * Where the pack divides its rows instead of scrolling them.
 *
 * `mtg-rgc.18`. The pack's box is the flex remainder above the drafted pool, and
 * on a desk it is a fixed working surface: three rows of faces share it rather
 * than running past its bottom edge. Below this gate the draft screen is a
 * different arrangement and stays one -- a landscape phone scrolls its pack
 * (`./draft-mobile.ts` measured why: thirteen readable faces do not fit in 390px
 * of height at any column width), and an upright phone is a document with no
 * fixed surface to divide at all. Squeezing three rows into either would make
 * the faces shorter than the type on them.
 *
 * The two lengths are `../styles/deck.ts`'s `BUILDER_FRAME_QUERY` restated: the
 * same "wide enough for a rail and tall enough to divide" question, asked about
 * the other workspace.
 */
export const PACK_FIT_QUERY = '(min-width: 64rem) and (min-height: 48rem)';

export const PANEL_CSS = `
/* ── the two-track workspace ───────────────────────────────────────────── */
.mtg-work {
  display: grid;
  grid-template-columns: minmax(0, 1fr) ${String(RAIL_REM)}rem;
  gap: var(--mtg-space-3);
  align-items: stretch;
  min-block-size: 0;
}
.mtg-work[data-rail='none'] { grid-template-columns: minmax(0, 1fr); }
/* And a rail the player sizes, when the surface offers a handle for it
   (\`mtg-veun\`, \`../routes/draft/rail-split.ts\`). Three tracks: the workspace,
   the divider, the rail.

   The middle track *is* the gutter rather than sitting beside one. A third
   \`auto\` column plus the second \`gap\` this grid would then draw costs the
   workspace \`SPLIT_THICKNESS_PX\` + \`--mtg-space-3\` = 20px, and the draft's own
   horizontal handle below shows what that costs a pack with a fit promise and
   what it takes to hand it back. So \`column-gap\` goes to zero, the divider's
   track is exactly the gap that was there before, and the 8px handle is
   centered inside those 12px. Net width to the panes: unchanged.

   Keyed on the attribute and not on \`:has(> .mtg-split)\`, because
   \`../routes/play/RemoteDraft.ts\` draws this same workspace with a rail and no
   handle, and a \`:has\` rule would give it a three-track grid with its rail in
   the middle 12px. \`data-rail\` is the vocabulary already here. */
.mtg-work[data-rail='split'] {
  grid-template-columns: minmax(0, 1fr) var(--mtg-space-3) var(--split-b, ${String(RAIL_REM)}rem);
  column-gap: 0;
}
.mtg-work[data-rail='split'] > .mtg-split { display: block; justify-self: center; }
/* And a rail shut to its head (\`../routes/draft/DraftPack.ts\`): the strip takes
   the width of its one control and the workspace takes the rest. No divider,
   because there is no seam left to drag. */
.mtg-work[data-rail='shut'] { grid-template-columns: minmax(0, 1fr) auto; }
.mtg-work__main { min-inline-size: 0; min-block-size: 0; display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* ── the divider between two panes ─────────────────────────────────────── */
/* \`mtg-rgc.19\`, and \`../panel/SplitHandle.ts\` is the control. Three facts
   are worth stating here rather than there.

   It is \`display: none\` until a surface's own frame query turns it on. A
   divider is only offered where the panes it divides are boxes with fixed room
   between them, and below those gates each of these surfaces is a document that
   scrolls -- \`./mobile.ts\` and \`./draft-mobile.ts\` arrange them that way
   deliberately. A handle on a 390px-tall screen would spend a touch target on a
   control with nothing to give.

   \`touch-action: none\` because the gesture is a drag along the axis the pane
   under it scrolls on, and without it the browser hands the stream to the
   scroller at the first millimeter. It costs nothing: the strip is 8px of
   chrome between two panes and there is nothing under it to scroll.

   The line is drawn by \`::after\` and inset from the strip, so the thing a
   pointer can grab is comfortably larger than the thing a reader can see -- a
   2px rule is honest about how little it separates and miserable to hit. */
.mtg-split {
  display: none;
  flex: none; align-self: stretch; position: relative;
  border: 0; padding: 0; background: none;
  color: var(--mtg-line);
  touch-action: none;
}
.mtg-split[data-orientation='horizontal'] { block-size: ${String(SPLIT_THICKNESS_PX)}px; cursor: row-resize; }
.mtg-split[data-orientation='vertical'] { inline-size: ${String(SPLIT_THICKNESS_PX)}px; cursor: col-resize; }
.mtg-split::after {
  content: ''; position: absolute; inset: 0; margin: auto;
  background: currentColor; border-radius: 999px;
}
.mtg-split[data-orientation='horizontal']::after { block-size: 2px; inline-size: min(8rem, 40%); }
.mtg-split[data-orientation='vertical']::after { inline-size: 2px; block-size: min(8rem, 40%); }
.mtg-split:hover,
.mtg-split:focus-visible,
.mtg-split[data-dragging='true'] { color: var(--mtg-accent); }
.mtg-split[data-dragging='true']::after { block-size: 3px; }
.mtg-split[data-orientation='vertical'][data-dragging='true']::after { block-size: min(8rem, 40%); inline-size: 3px; }
/* The workspace is the only thing on the page allowed to grow, so a pack of
   thirteen cards scrolls inside its own box instead of pushing the status strip
   and the rail's commit button off the screen. */
.mtg-work__scroll {
  flex: 1 1 auto; min-block-size: 0; overflow: auto; overscroll-behavior: contain;
  padding: var(--mtg-space-2);
  background: var(--mtg-surface-sunken);
  border: 1px solid var(--mtg-line);
  border-radius: var(--mtg-radius-md);
}

/* ── the drafted pool, under the pack ──────────────────────────────────── */
/* \`mtg-3apk\`. The second half of the main column: the pack scrolls in the box
   above, this sits under it, and the rail keeps the card being read and the
   commit. Two boxes and not one, because \`../routes/deck/strips.ts\` fixes the
   height of the columns and the pack's own height is whatever the pack is.

   The pack takes the room it needs and the pool takes the rest (\`mtg-v7sg\`).
   Both halves were the other way round until then: the pack was the flexed one,
   so it held its whole share whatever was in it, and the pool sat at the height
   of a 240px constant under a 45vh cap it never reached. Measured at 1440x900 at
   pack 3 pick 11, that was five faces above 230px of nothing, over a pool
   clipping its own deepest column and cutting names in half — the screen wasting
   a third of its column and hiding the thing that column is for.

   So the pack is \`flex: 0 1 auto\`: as tall as its faces, and it shrinks and
   scrolls when there are more of them than there is room. The pool is
   \`flex: 1 1 0\`, which is the part that has to be a zero basis rather than
   \`auto\`: \`../routes/deck/stack-box.ts\` grows a column to the box it is drawn
   in, so a pool whose height was its content's would raise the box, raise the
   content, and go round again once a frame. A zero basis breaks that — the
   pool's height is what the pack left, and what the columns do inside it is not
   a fact the layout reads back.

   \`DRAFT_POOL_COLUMN_FLOOR_PX\` is the other half: the pool never falls below the
   constant its columns are laid out against, so a full pack shrinks and scrolls
   rather than squeezing the pool to a strip. That floor is what keeps the pack
   the larger half of a desk's column at a 15-card pack, which is the promise the
   45vh cap used to make. The phone tier below takes the floor off again and caps
   instead, for the reason it states.

   Plus \`STRIP_REGION_CHROME_PX\` and \`STRIP_REGION_SCROLLBAR_PX\`, which is
   \`mtg-qs2d\`. The floor is a column's and the box it is written on is a
   scrollport's, and between the two sit the count row, its gaps, and the
   sideways scrollbar the region grows when its columns run off the right.
   Measured at 1440x900 with a full 15-card pack before those terms: a 240px pool
   with 208px of room in it, \`boxFromRoom\` handing back the 240px constant
   because it only ever grows, and the deepest column 24px out the bottom of a
   pool that scrolled to reach it — the whole card at the foot of that column cut
   through the picture, on the half of the screen that exists to say what has
   already been drafted. The pack pays the 47px, 494px to 447px at that size,
   which is two rows of 13rem faces either way and a pack that scrolls either
   way.

   The head is \`./deck.ts\`'s, deliberately: it is the deck editor's pane head,
   above the deck editor's columns, and giving the draft screen its own would be
   a second answer to a question already answered two panes over. */
/* \`--split-a\` is \`mtg-rgc.19\`: unset until somebody drags the divider under
   this pane, and \`auto\` until then, which is the arrangement every measurement
   in this file was taken against. */
.mtg-draft .mtg-work__scroll { flex: 0 1 var(--split-a, auto); }
/* And the rows inside it divide that box rather than scrolling out of it.

   \`mtg-rgc.18\`. The pack pane already shrinks -- it is \`flex: 0 1 auto\` --
   but shrinking a scroller only moves the overflow inside it, so a pack too tall
   for its room lost its last row to a scrollbar. Two rules turn the shrink into
   a fit: the pane becomes a one-row grid, which hands the thumbnail grid inside
   it the height the pane actually settled on rather than the height of its own
   content, and the thumbnail grid's rows are \`1fr\`, which divide that height
   between them. A pack that would fit at its natural height still draws at its
   natural height -- an auto-sized grid resolves \`1fr\` rows against their own
   content -- so this only ever takes room away from a pack that has too much.

   The faces need \`min-block-size: 0\` to accept it. A grid item's automatic
   minimum is its min-content height, and a face whose art window may go to
   nothing has a min-content height of its type; without this the row would be
   143px and the card 155, and the overflow would simply have moved down one
   level. The window is the region that gives, which is
   \`./card.ts\`'s \`[data-size='board']\` rule and the same trade the played
   table makes.

   The rows divide down to \`--pack-row-min\` and no further, and under that the
   pack scrolls again. A division with no floor is not a fit -- measured at
   1024x768, which is the smallest desk this query covers, a third-round pack of
   fifteen over a pool sitting on its own 287px floor divides 313px four ways and
   draws 68px faces. Fifteen cards on one screen at 68px is fifteen cards nobody
   can read, so the floor is where the answer goes back to being "scroll it", and
   the answer after that is \`mtg-rgc.19\`: a divider the player drags is what
   settles a split this tight, and no stylesheet can guess which side of it they
   wanted. \`1fr\` tracks resolve their base size from the minimum, so once the
   minimums outgrow the box the free space is negative, the rows stay on the
   floor and the pane overflows -- the same rule doing both jobs.

   Every pack, since \`mtg-ao52\`. The division used to be keyed to
   \`data-reads='false'\`, on the argument that a pack short enough to print its
   own rules text is a pack drawing at its natural height and therefore one with
   nothing to divide. \`mtg-2rmf\` made every pack draw at its natural height, so
   the two stopped being the same fact, and the rule that was carrying both is
   the row division. Measured at 15, 11, 8, 6, 3 and 1 cards over 1440x900,
   1600x1000 and 1024x768: every reading is what it was with the attribute on it,
   because a short pack's rows sit above the floor and \`1fr\` over a box sized by
   them changes nothing.

   The floor is the column width rather than a second number. A face divided to
   \`--thumb-w\` tall is square, which is as far as the frame goes before the art
   window is shorter than the type over it; and it is measured to be the number
   that gets out of the way -- at 9rem the three rows a full pack takes at
   1440x900 want 456px of a 445px box, so a floor set to protect that pack was
   what pushed it out of its own pane by 11px. */
@media ${PACK_FIT_QUERY} {
  /* A roomy desk buys readable cards, not a compressed contact sheet. The
     pack pane already owns vertical scrolling and yields room to the pool, so
     its grid may keep natural card rows even when a full pack needs more than
     the visible pane. */
  .mtg-draft .mtg-work__scroll { display: block; }
  .mtg-draft .mtg-work__scroll > .mtg-thumbs {
    grid-auto-rows: auto;
    min-block-size: 0;
  }
  /* And a face is a card's shape, up to the row it is in.
   *
   * \`mtg-2rmf\`. The rules above give the rows a floor and a \`1fr\` division of
   * whatever box the flex column hands them, and the box is \`flex: 0 1 auto\`, so
   * it is sized by its content and its content is sized by the floor. Nothing in
   * that chain ever asks for the room that is there. Measured at 1440x900 on the
   * fixture's 13-card pack: a 307px pack row inside a 789px workspace, faces at
   * 152x140 -- an aspect of 1.09 where a card is 1.40 -- and 482px below it
   * holding nothing at all until the first pick puts a pool there.
   *
   * \`aspect-ratio\` is the missing sentence. It makes a face's natural height the
   * height a card of that width has, so the auto rows ask for that and the box
   * that is sized by them grows to it. Measured after: the same pack draws
   * 152x213 faces in a 451px row, all thirteen inside the box, nothing scrolled.
   *
   * \`max-block-size: 100%\` is what keeps it from being the pack's problem again
   * at a size with no room to give. An aspect ratio on its own is a demand: at
   * 1024x768 it took the pack to 165x230 and pushed the thirteenth card 69px out
   * of the box. Capped at the row, the face gives the height back instead and
   * lands at 169x154, which is where it was, and the same cap turns 1024x768's
   * six-card pack from four faces visible into six. \`min-block-size: 0\` is the
   * pair to it and is already stated above for deep packs; a face that may not
   * shrink below its content cannot give anything back.
   *
   * Inside \`PACK_FIT_QUERY\` with the rest, which is the gate that means there is
   * a workspace to divide. Below it the pack row is 390px tall on a landscape
   * phone, and a face at a card's aspect there is four of thirteen visible
   * instead of eight. */
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card {
    aspect-ratio: ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)};
    max-block-size: none;
    min-block-size: 0;
  }
  /* What the pack keeps when the divider is dragged down onto it: one row of
     faces at the floor those rows divide to, plus the box's own padding. The
     drafted pool has had a floor of its own since \`mtg-qs2d\` and this is the
     other side of that split finally stating one, because until a person could
     move the divider nothing could ask for less than the faces needed. */
  /* And it is drawn *in* the gutter rather than beside it, because a pack that
     fits is a promise \`mtg-rgc.18\` made and a divider is not allowed to spend
     it. \`.mtg-work__main\` gaps its children by \`--mtg-space-2\`, so a handle
     between two panes costs the column its own 8px plus a second 8px of gap,
     out of a pack already divided down to \`--pack-row-min\`: measured at
     1440x900 on a 15-card pack, the pack went 3px out of the pane it is
     promised to fit inside. The negative margins hand those 16px back, and
     since the handle is exactly one gutter thick it lands on the gutter and
     overlaps neither pane. */
  .mtg-draft .mtg-work__main > .mtg-split {
    display: block;
    margin-block: calc(var(--mtg-space-2) * -1);
  }
  .mtg-draft .mtg-work__scroll {
    min-block-size: calc(var(--pack-row-min) + var(--mtg-space-2) * 2);
  }
  .mtg-draft .mtg-work__main[data-split='auto'] > .mtg-draft__pool[data-shallow='true'] > .mtg-draft__poolbox {
    min-block-size: 0;
  }
}
.mtg-draft__pool {
  flex: 1 1 0;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
}
.mtg-draft__pool .mtg-deck__group { margin-left: auto; }
/* Shut, the pool is its head row and the pack takes the height it gave up:
   the pack pane's split share stops applying and it grows into the column.
   The disclosure keeps to the end of the row whether or not the grouping
   control is drawn beside it. */
.mtg-draft__pool[data-collapsed='true'] { flex: 0 0 auto; }
.mtg-draft__pool[data-collapsed='true'] .mtg-draft__pool-toggle { margin-inline-start: auto; }
.mtg-draft__pool-toggle { min-block-size: ${String(WCAG_TARGET_PX)}px; }
.mtg-draft .mtg-work__main[data-pool='shut'] > .mtg-work__scroll { flex: 1 1 auto; }
/* The token is \`./deck.ts\`'s and it means here what it means on a builder's
   pane: this box has a height of its own, so the columns may be laid out against
   it. The draft screen is a \`.mtg-screen\` at every size, so the height is always
   the flex remainder and never the content -- which is the condition
   \`../routes/deck/stack-box.ts\` requires and the reason it names this surface
   as one that did not have it. */
.mtg-draft__poolbox {
  flex: 1 1 0; min-block-size: ${String(DRAFT_POOL_COLUMN_FLOOR_PX + STRIP_REGION_CHROME_PX + STRIP_REGION_SCROLLBAR_PX)}px;
  overflow: auto; overscroll-behavior: contain;
  ${STACK_BOX_SOURCE_PROPERTY}: ${STACK_BOX_FROM_PANE};
}
.mtg-draft__rating { margin: 0.25rem 0 0; font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }

/* ── the compact status strip ──────────────────────────────────────────── */
/* One row, wrapping, of label/value pairs and the controls that change them.
   It replaces a page heading plus a toolbar plus an explanatory paragraph: on a
   390px-tall screen those three cost more than half the viewport and say
   nothing that changes between one pick and the next.

   \`.mtg-strip\` and not \`.mtg-status\`, which is what it was called for one
   report and is \`mtg-aqxi.7\`: \`./board/status.ts\` has owned \`.mtg-status\`
   since long before this sheet existed, for a player's vitals read across, and
   \`./index.ts\` joins this sheet after that one. Two single-class selectors tie
   on specificity, so the later one won and every surface drawing
   \`../board/PlayerStatus.ts\` — the replay timeline — got this strip's wrap and
   gaps instead of its own. */
.mtg-strip {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: var(--mtg-space-1) var(--mtg-space-3);
  padding: var(--mtg-space-1) var(--mtg-space-2);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line);
  border-radius: var(--mtg-radius-md);
}
.mtg-strip__spacer { flex: 1 1 auto; }
/* Where you are, and what is left of the pack. The title is the one thing on
   the strip a player looks for between picks, so it is the only thing on it
   drawn at full ink; the rest reads as the footnotes they are. */
.mtg-strip__title { font-weight: 600; }
.mtg-strip__note { font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted); }
/* The controls that start and identify a run, kept together so a screen with no
   room for them can take them away in one declaration rather than four. */
.mtg-strip__setup { display: flex; align-items: center; gap: var(--mtg-space-1) var(--mtg-space-3); }
.mtg-strip .mtg-btn { padding-block: var(--mtg-space-1); }

/* ── the rail ──────────────────────────────────────────────────────────── */
.mtg-rail {
  display: flex; flex-direction: column; min-block-size: 0;
  background: var(--mtg-surface-rail);
  border: 1px solid var(--mtg-line);
  border-radius: var(--mtg-radius-md);
  overflow: hidden;
}
.mtg-rail__head { flex: none; display: flex; flex-direction: column; gap: var(--mtg-space-1); padding: var(--mtg-space-1); }
.mtg-rail__toggle {
  display: flex; align-items: center; justify-content: center;
  inline-size: 100%; min-inline-size: 0; min-block-size: ${String(WCAG_TARGET_PX)}px;
  gap: var(--mtg-space-1); padding-inline: var(--mtg-space-1);
}
.mtg-rail__chevron { font-weight: 700; line-height: 1; }
.mtg-rail__toggle-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Shut, the rail is a strip: the word comes off the button and the name stays
   on it (\`../routes/draft/DraftPack.ts\`'s toggle carries it as a label). */
.mtg-rail[data-collapsed='true'] .mtg-rail__toggle-label { display: none; }
.mtg-rail__tabs {
  display: flex; flex: 0 0 auto;
  border-block-end: 1px solid var(--mtg-line);
  background: var(--mtg-surface-sunken);
}
.mtg-rail__tab {
  flex: 1 1 0; min-inline-size: 0;
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--mtg-space-1);
  min-block-size: ${String(WCAG_TARGET_PX)}px;
  padding: var(--mtg-space-1) var(--mtg-space-2);
  font: inherit; ${MICRO_LABEL}
  color: var(--mtg-ink-muted);
  background: transparent; border: 0; border-inline-end: 1px solid var(--mtg-line);
  cursor: pointer;
}
.mtg-rail__tab:last-child { border-inline-end: 0; }
.mtg-rail__tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The count is drawn whether or not the section is showing, which is the whole
   reason a section is never removed: "STACK 2" is the fact a player needs while
   they are reading the log. */
.mtg-rail__tab-count {
  flex: 0 0 auto;
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums;
  padding-inline: var(--mtg-space-1);
  border-radius: var(--mtg-radius-pill);
  background: var(--mtg-surface-inset); color: var(--mtg-ink);
}
/* Selected state carries a weight change and a filled bar as well as a color,
   because §13 asks that state not be color alone. */
.mtg-rail__tab[aria-pressed='true'] {
  color: var(--mtg-ink); font-weight: 700;
  background: var(--mtg-surface-raised);
  box-shadow: inset 0 -2px 0 var(--mtg-accent);
}
.mtg-rail__body {
  flex: 1 1 auto; min-block-size: 0; overflow: auto; overscroll-behavior: contain;
  padding: var(--mtg-space-2);
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
  /* A container, so the printed face below sizes off the rail's own width. */
  container-type: inline-size;
}
/* An empty rail is one sentence in a column 600px tall, and pinned to the top
   of it the sentence reads as a stranded label rather than as the state of the
   panel. \`margin: auto\` centers it in whatever height the body has, which is
   all of it: the body holds nothing else when this is drawn. */
.mtg-rail__empty {
  margin: auto; max-inline-size: 24ch; text-align: center;
  font-size: var(--mtg-text-sm); color: var(--mtg-ink-muted);
}
.mtg-rail__foot {
  flex: 0 0 auto;
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  padding: var(--mtg-space-2);
  border-block-start: 1px solid var(--mtg-line);
  background: var(--mtg-surface-raised);
}
.mtg-rail__foot .mtg-btn { inline-size: 100%; min-block-size: ${String(TOUCH_TARGET_PX)}px; }
.mtg-rail__note { margin: 0; font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); }

/* A dense grid of thumbnails: the pack, the pool, a deck. \`auto-fill\` rather
   than a fixed column count, so the same markup is three columns on a phone and
   nine on a desktop without a second rule per breakpoint. */
.mtg-thumbs {
  display: grid; gap: var(--mtg-space-2);
  grid-template-columns: repeat(auto-fill, minmax(var(--thumb-w, 9rem), 1fr));
  align-content: start;
}
.mtg-thumbs .mtg-card { width: 100%; --card-w: 100%; --rules-type: var(--mtg-text-sm); --frame-band: calc(var(--thumb-w, 9rem) * ${cssNumber(FRAME_BAND_MM / CARD_TRIM_MM.width)}); }
/* \`--frame-band\` is restated because the face derives it as a share of
   \`--card-w\`, and \`--card-w\` here is a percentage: \`calc(100% * 0.041)\` is not
   a length a border-width accepts, so the whole \`border\` shorthand would be
   dropped and these cards would lose their identity edge entirely. The share is
   the one in \`@mtg/card-geometry\`, read off the column width instead. */

/* A card drawn *in* the rail is measured by the rail, for the same reason and
   with the same restatement. Two columns of pool at 7rem, one readable face at
   the rail's full inside width. */
.mtg-thumbs--rail { --thumb-w: 7rem; }
/* A pack is fifteen cards at most, and how wide each of them should be is not a
   constant -- it is whatever divides the room the pack has between the cards
   that are in it.

   \`mtg-rgc.18\`. the playtester: "the cards should be sized while drafting so
   they're all easily seen on one screen". The declared 13rem column was the
   same column for a fifteen-card pack and a three-card one: measured at
   1440x900 on fifteen cards, five faces across in three rows of 569.5px inside
   a 445px box, so a third of the pack was under the fold of the pane that
   exists to show what there is to pick from.

   Two changes, and between them the pack always fits.

   \`auto-fit\` rather than \`auto-fill\`, so the column is a *floor* and not a
   target: a fifteen-card pack takes the seven tracks its floor allows and each
   face is the width that leaves, and a three-card pack collapses the four empty
   tracks and spreads into the whole width instead of drawing three thumbnails
   beside four holes. \`--thumb-max\` is the other end of that -- a single card
   left in a pack would otherwise be drawn a foot wide -- and the faces are
   centered in the tracks they cannot fill.

   The repetition count is computed from the *minimum* track size only because
   the maximum here is \`1fr\`, which is indefinite; \`minmax(8.5rem, 15rem)\`
   would have counted tracks at 15rem and laid a fifteen-card pack out four
   across. Hence the cap on the card rather than on the track. \`--frame-band\`
   follows the same pair, for the reason the base rule states: the band is a
   share of a width, and \`--card-w\` here is a percentage. */
.mtg-draft { --pack-row-min: 13.375rem; }
.mtg-draft .mtg-thumbs {
  --thumb-w: max(13.375rem, calc((100% - 4 * var(--mtg-space-2)) / 5));
  --thumb-max: 15.25rem;
}
.mtg-draft .mtg-thumbs--pack { container-type: inline-size; }
@container (min-width: 1102px) {
  .mtg-draft .mtg-thumbs--pack > .mtg-card { --thumb-max: 13.75rem; }
}
.mtg-draft .mtg-work__scroll > .mtg-thumbs {
  grid-template-columns: repeat(auto-fit, minmax(var(--thumb-w), 1fr));
  justify-items: center; justify-content: center;
}
.mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card {
  max-inline-size: var(--thumb-max);
  /* A pack face is a fixed piece of cardboard, including when a set imported
     before the generator's zoom-capacity gate carries more words than this
     thumbnail can print. The desktop reading rule below lets ordinary text
     use the whole rules region, but the trim is the final paint boundary. */
  overflow: hidden;
  --frame-band: calc(min(var(--thumb-w), var(--thumb-max)) * ${cssNumber(FRAME_BAND_MM / CARD_TRIM_MM.width)});
}

/* Pack cards use the full face that deckbuilding uses. Its shared anatomy owns
   the fixed nonland art window and the taller land window, so rules density can
   no longer resize either region from card to card. The pack contributes only
   scale and clipping; it does not maintain another card layout. */
/* The rail's face is as wide as the rail, and the rail is not one width: it is
   RAIL_REM by default and the play board's split handle can double it. So the
   body is an inline-size container and the face's --card-w is its width as a
   length (100cqw), which is what every share the face derives from it needs.
   It used to be 100%, with the frame band pinned to the default rail's width
   and the type reset to the token, because a share of a percentage is a
   percentage of the parent font size in a font-size context. That pin was only
   right at the default width: at a doubled rail the edge band, a share of a
   percentage resolved against the face's height, outgrew the pinned frame band
   and put every planeswalker's loyalty shield below the trim, and the type
   stayed at 13px inside a rules box four times the area it was sized for. */
.mtg-rail__body > .mtg-card {
  width: 100%; --card-w: 100cqw;
}

/* ── the page as a screen ──────────────────────────────────────────────── */
/* A route that draws \`.mtg-screen\` fills the viewport exactly once and never
   scrolls as a document: the shell bar and the status strip take what they take,
   and everything left is divided between the workspace and the rail, each
   scrolling inside itself.

   Selected through \`:has\` on the shell rather than on the route, for the reason
   \`./mobile.ts\` gives where it does the same thing for the table: the state
   belongs to what is on screen, not to which tab is open. The draft route draws
   a finished draft's deckbuilder through the same component the play route does,
   and a rule keyed on the route name would have applied to one and not the
   other.

   At every width, not only on a phone. the playtester asked for this lane's
   improvements on the desktop web version too, and a pack that scrolls inside a
   pane while the pick button stays put is the same improvement on a 1440px
   window as on an 844px one. */
.mtg-shell:has(.mtg-screen) { block-size: 100%; overflow: hidden; }
.mtg-shell:has(.mtg-screen) > .mtg-shell__main {
  display: flex; flex-direction: column; min-block-size: 0;
  padding: var(--mtg-space-3);
}
.mtg-shell:has(.mtg-screen) > .mtg-shell__main > * + * { margin-block-start: 0; }
.mtg-screen {
  flex: 1 1 auto; min-block-size: 0;
  display: flex; flex-direction: column; gap: var(--mtg-space-2);
}
.mtg-screen > .mtg-work { flex: 1 1 auto; min-block-size: 0; }

@media ${RAIL_STACK_QUERY} {
  .mtg-work, .mtg-work[data-rail='split'], .mtg-work[data-rail='shut'] { grid-template-columns: minmax(0, 1fr); }
  /* Stacked, there is no shared width to divide. */
  .mtg-work[data-rail='split'] > .mtg-split { display: none; }
  /* Stacked, a shut rail is a bar under the pack rather than a strip beside
     it, and a bar has room for its word. */
  .mtg-rail[data-collapsed='true'] .mtg-rail__toggle-label { display: inline; }
}

/* A short viewport keeps the rail beside the workspace rather than under it —
   under it is off the bottom — and pays for it with narrower thumbnails. */
@media ${SCREEN_QUERY} {
  .mtg-work { grid-template-columns: minmax(0, 1fr) ${String(RAIL_REM)}rem; }
  /* The rail comes back beside the workspace, so its divider comes back with
     it — restated rather than inherited, because the rule above this one is
     one class wide and the split's is a class and an attribute. */
  .mtg-work[data-rail='split'] {
    grid-template-columns: minmax(0, 1fr) var(--mtg-space-3) var(--split-b, ${String(RAIL_REM)}rem);
  }
  .mtg-work[data-rail='split'] > .mtg-split { display: block; }
  .mtg-work[data-rail='shut'] { grid-template-columns: minmax(0, 1fr) auto; }
  .mtg-rail[data-collapsed='true'] .mtg-rail__toggle-label { display: none; }
  .mtg-thumbs { --thumb-w: 6rem; }
  /* The pack keeps its own column, because the rule above it is one class wide
     and \`.mtg-draft .mtg-thumbs\` is two: a phone held sideways was drawing the
     desktop's 11rem column and getting cards *larger* than the desktop's. It
     was measured at 844x390 — a pack card 263x260 against the same card at
     179x217 on a 1440x900 desktop, so a 13-card pack was two across, a row and a
     half on screen, and seven rows of scrolling to see the pack you are picking
     from. The column is the pool's, which puts four of the
     thirteen across instead of two: thirteen readable cards do not fit in 390px
     of height at any column width, so what this buys is rows of scrolling
     rather than a pack on one screen. The rail still draws whichever card they
     land on at its full width, which is where a card is read. */
  .mtg-draft .mtg-thumbs { --thumb-w: 7rem; }
  /* The pack still uses the universal full-card component on a landscape
     phone, but the grid is a scan surface rather than a reading surface. Give
     each face two finger-sized rows of the scrollport and let its shared art
     and rules regions yield inside that height; the rail beside it remains the
     undistorted reading copy. */
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card {
    aspect-ratio: auto;
    block-size: 6rem;
    min-block-size: 6rem;
    --rules-type: var(--mtg-text-xs);
  }
  .mtg-draft .mtg-work__scroll > .mtg-thumbs > .mtg-card > [data-region='art'] {
    flex: 1 1 auto;
    min-block-size: 1.5rem;
    aspect-ratio: auto;
  }
  /* And the face the rail is showing is measured by the height it has left
     rather than by the rail's width, because that height is the binding
     constraint: a 15.25rem card wants about 340px and the rail's body has about
     290 on a 390px screen.

     \`mtg-aqxi.12\`. The first answer to that was to narrow the card to 11rem so
     its aspect ratio would fit the height, and it made the panel that exists to
     be read the least readable thing on the screen. Measured at 844x390 on the
     flagship's longest card: 176px wide, the name overflowing its bar by 25px so
     "Everything You Killed" drew as "Everything ...", and 57px of the rules text
     below the bottom of a box that had no room to grow. A card you have to
     scroll to read is a card you cannot compare against the twelve in the pack,
     which is the whole reason the rail draws it.

     So the card keeps the rail's full width and gives up the *aspect ratio*
     instead. A trading card's proportions are a fact about cardboard; this is a
     panel. The art window takes what is left after the text box has what it
     needs (\`flex: 1 1 auto\` against \`flex: 0 0 auto\`), which at 390px means
     the art becomes a 48px strip and every word is on screen — 254px wide, the
     name whole, nothing clipped, and the body not scrolling at all. Above
     \`SCREEN_QUERY\` none of it applies and the face is a card again; the same
     measurement at 1440x900 comes back identical to before. */
  .mtg-rail__body > .mtg-card {
    aspect-ratio: auto; block-size: 100%; min-block-size: 0;
  }
  .mtg-rail__body > .mtg-card > [data-region='art'] {
    flex: 1 1 auto; min-block-size: 0; aspect-ratio: auto;
  }
  .mtg-rail__body > .mtg-card > .mtg-card__text {
    flex: 0 0 auto; min-block-size: 0; aspect-ratio: auto;
  }
  /* And the pool takes less of a screen that has none to give. A desk's pool is
     whatever the pack leaves, floored at the constant its columns are drawn
     against; 240px of a 390px phone is most of what is left after the strip and
     would leave the pack — the thing being chosen from — smaller than the pile
     of what has already been chosen. So the floor comes off here and a cap goes
     on. 30vh is 117px: four strips and the face at the bottom of one, scrolled
     to reach the rest. The columns keep their computed height and this crops
     them, which is the same trade the box makes against a deep column and is
     why \`../routes/deck/strips.ts\` marks a clipped one — and it is why the
     floor has to go rather than sit under the cap, since a minimum wins over a
     maximum and 240 would simply have beaten the 117 this tier is for. */
  .mtg-draft__poolbox { min-block-size: 0; max-block-size: 30vh; }
  .mtg-shell:has(.mtg-screen) > .mtg-shell__main { padding: var(--mtg-space-1); }
  /* And the app's own chrome comes off the top of the screen entirely, the way
     it already does over a board.

     This tier used to *tighten* the bar and keep the notice, on the argument
     that a game is a full-screen thing you leave deliberately while a draft is
     one screen of an app whose mode switch is how you get back to the rest of
     it. the playtester read that argument off a phone and rejected it: the draft
     screen was spending 165.69px of 390 on a bar, a notice and a strip, 42% of
     the glass, above a pack region that got 208.31 and could show 5 of its 13
     cards whole. The tab row is not what you are doing on this screen either.

     So the same three declarations \`./mobile.ts\` makes over a board, for the
     same reasons, including the ones that are costs:

     - \`display: none\` and not \`./base.ts\`'s \`SPOKEN_NOT_DRAWN\`, because
       these bands hold six tab buttons and a set picker, and a control that is
       focusable but not drawn is the focus-visible defect WCAG 2.4.7 names.
     - Turning the phone is the way back, and it is a better way than a control
       would be: this is a \`max-height\` query, so portrait *is* the gesture,
       on every phone, with nothing to find and nothing to learn.
     - The notice carries \`role="status"\`, so a landscape drafter is not told
       the set is a reduced build. Stated rather than discovered later; it is
       the same trade the table already makes.

     Gated on \`:has(.mtg-screen)\` and not on the route, so it is a state the
     *screen* is in rather than a state the tab is in. A draft that cannot be
     read — no staged set, an invalid link, a set that cannot fill packs — draws
     an empty state and no \`.mtg-screen\`, and keeps its bar. Those are exactly
     the screens whose next move is to go somewhere else.

     \`mtg-aqxi.17\` tried to put a 45px band back here holding the mark and the
     set picker, and this screen is the one that cannot pay for it. The rail card
     is \`block-size: 100%\` of the rail body with the art window as its
     flexible track, so the 45px comes off the picture: measured at 844x390, the
     art strip went from 47.38px to 2, and the "Art pending" pill overflowed the
     window it was in by 11. A card you tap in a pack is tapped to be *read*,
     which is the whole of \`mtg-aqxi.12\`, and the pack beside it is already
     showing the picture. So the band stays off here and the set picker comes
     back everywhere the measurement allows it: every route that draws neither a
     board nor a screen keeps its bar on a phone, and the landing page the mark
     leads to is where choosing a set is the subject rather than a control in a
     band with no room. Turning the phone reaches all of it. The section row
     under the bar goes with it, for the reason \`./mobile.ts\` gives beside a
     board: a landscape phone is wider than the phone-width block and this is
     the only block it reaches. */
  .mtg-shell:has(.mtg-screen) > .mtg-shell__bar,
  .mtg-shell:has(.mtg-screen) > .mtg-subs,
  .mtg-shell:has(.mtg-screen) > .mtg-shell__notice { display: none; }
  /* And the strip keeps the draft and drops the setup, which is the same cut
     \`./mobile.ts\` makes when it hides the dealer's toolbar and keeps the
     board. \`pack\`, \`pick\`, \`cards\` and \`drafted\` change with every pick
     and are read on the way to one; the seed and \`New draft\` are what you use
     before a draft and after it, and between them they are the whole reason the
     strip is 54px instead of 30 — the button carries \`./touch.ts\`'s 44px
     floor, and the seed is 21 characters of monospace that wraps the row on a
     narrower phone. */
  .mtg-screen > .mtg-strip > .mtg-strip__setup { display: none; }
}
`;
