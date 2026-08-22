/**
 * The played table on a phone, in both orientations.
 *
 * # Portrait
 *
 * The desktop table deliberately spends width on a prompt column and a history
 * rail. At 430px those fixed tracks leave 12px for both battlefield lanes, and
 * at 390px they leave none. A phone therefore spends the other axis: the same
 * three regions form one document column inside the shell's existing scroller.
 * Nothing is hidden or replaced, so the prompt, both seats, the stack, log and
 * zone browsers keep their existing keyboard and screen-reader paths.
 *
 * This sheet is joined after the ordinary touch floor. It is narrower than the
 * 810px tablet portrait contract and only refines controls whose full width is
 * available through a local horizontal scroller.
 *
 * # Landscape
 *
 * A landscape phone is the opposite shape and matched neither tier until
 * `mtg-l4w0`: 844 to 932 CSS px wide is past the block above, and 390 to 430
 * tall is half the height `./board/hand.ts`'s short table was fitted to. It fell
 * through to the laptop layout, and what a laptop layout does with a third of the
 * height is spend it on furniture. Measured at 844x390 with four permanents a
 * side, the shell bar and the step bar took 147px of 390 before a card was
 * drawn, both battlefield rows sat at `./board/fit.ts`'s 72px floor, and the
 * player's own hand was 10.6px past the bottom of a table that does not scroll.
 *
 * So the landscape tier is a *height* tier and it has nothing to say about
 * width: `./board/geometry.ts`'s `SHORT_VIEWPORT_QUERY` is the whole condition,
 * the three columns stay three columns, and the rail's own default answers the
 * width question one file over.
 */
import { CARD_TRIM_MM } from '../card/anatomy';
import { SPOKEN_NOT_DRAWN } from './base';
import { cssNumber } from './number';
import { PLAY, SHORT_VIEWPORT_QUERY, TABLE } from './board/geometry';
import { SHORT_TABLE_SPELLS_MIN_REM } from './board/fit';
import { COMBAT_HAND_FACE_MAX_REM } from './board/hand';
import { SHORT_TABLE_LAND_TILE_REM } from './board/lands';
import { RAIL_WIDTH_VAR, SHORT_TABLE_ASK_SHUT_REM, SHORT_TABLE_RAIL_SHUT_PX } from './board/rail';
import { ZOOM_FACE_WIDTH_REM } from './card';
import { WCAG_TARGET_PX } from './touch';

export const PHONE_MAX_REM = 40;

/**
 * How much of the step bar's row the turn may take on a phone (`mtg-rgc.13`).
 *
 * `./views.ts` caps it at 5rem and argues that number against three desktop
 * viewports, where the lanes take whatever the column has left and a wrapped
 * line of steps is paid for out of a budget that can grow. A phone is the one
 * layout where it cannot: the block above gives `.mtg-board__lanes` a stated
 * 46rem and the two seats divide exactly that, so a line the near lane takes is
 * a line the opponent's board loses.
 *
 * Measured in chrome-headless-shell 151 at 390x844 over the screenshot position
 * in `../../test/play/battlefield-geometry.browser.test.ts`, sweeping the cap.
 * Bar height, then the two lanes:
 *
 *   cap        bar      opponent   you
 *   no head    105.8    198.4      397.1
 *   3rem       105.8    198.4      397.1
 *   3.5rem     105.8    198.4      397.1
 *   4rem       141.8    184.5      414.3
 *   5rem       141.8    184.5      414.3
 *
 * So this is a ledge in the same sense 5rem is on the desktop, and it is a
 * sharp one: up to 3.5rem the turn is free, and half a rem past it costs a
 * whole wrapped line — 36px of bar, 13.9px of which comes off the opponent's
 * battlefield. 3.5rem is 56px and `Turn 18:` is 43.8px in this face, so the
 * same half of the label survives here as on the desktop and the seat name is
 * what the ellipsis eats.
 *
 * The head is not hidden here instead, which would be the cheaper rule and is
 * the wrong one: the disclosure on it is the only way to reach the auto-pass
 * settings now that the strip above the table is gone, so hiding it on a phone
 * would take the setting away rather than shorten it.
 */
export const PHONE_HEAD_MAX_REM = 3.5;

export const MOBILE_CSS = `
@media (max-width: ${String(PHONE_MAX_REM)}rem) {
  .mtg-shell${PLAY} { overflow: hidden; }
  .mtg-shell${PLAY} .mtg-shell__bar {
    min-width: 0;
    padding-block-start: max(var(--mtg-space-3), env(safe-area-inset-top));
    padding-inline-start: max(var(--mtg-space-3), env(safe-area-inset-left));
    padding-inline-end: max(var(--mtg-space-3), env(safe-area-inset-right));
  }
  .mtg-shell${PLAY} .mtg-modes {
    max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain;
  }
  ${PLAY} .mtg-shell__main {
    position: relative;
    overflow-x: hidden; overflow-y: auto;
    padding-inline-start: max(var(--mtg-space-1), env(safe-area-inset-left));
    padding-inline-end: max(var(--mtg-space-1), env(safe-area-inset-right));
    padding-block-end: max(var(--mtg-space-1), env(safe-area-inset-bottom));
  }
  ${PLAY} .mtg-play, ${PLAY} .mtg-play__table { flex: none; min-height: auto; }
  ${PLAY} .mtg-board {
    flex: none; height: auto; min-height: 0; width: 100%;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto;
    align-items: stretch; overflow: visible;
  }
  ${PLAY} .mtg-board__pods,
  ${PLAY} .mtg-board__lanes,
  ${PLAY} .mtg-board__rail { width: 100%; min-width: 0; }
  ${PLAY} .mtg-board__pods {
    min-height: 16rem; max-height: none;
  }
  /* The desktop rail clips a bounded prompt and scrolls its move list. On a
     one-column phone the main region owns that axis, so the prompt grows with
     its choices instead of asking for a second vertical gesture inside it. */
  ${PLAY} .mtg-board__pods > .mtg-prompt {
    flex: none; min-height: 0; overflow: visible;
  }
  ${PLAY} .mtg-board__pods > .mtg-prompt .mtg-panel__body {
    flex: none; min-height: 0; overflow-y: visible;
    scrollbar-width: auto; background: none;
  }
  ${PLAY} .mtg-board__lanes { min-height: 46rem; }
  ${PLAY} .mtg-board__side { min-height: 0; }
  ${PLAY} .mtg-board__side[data-seat='opponent'] {
    display: flex; flex-direction: column;
  }
  ${PLAY} .mtg-board__side[data-seat='opponent'] > .mtg-zone[data-tone='rail'] {
    flex: none;
  }
  ${PLAY} .mtg-phasebar { width: 100%; min-width: 0; }
  ${PLAY} .mtg-phasebar > .mtg-turnstops .mtg-turnstops__head,
  ${PLAY} .mtg-phasebar > .mtg-badge { max-width: ${cssNumber(PHONE_HEAD_MAX_REM)}rem; }
  ${PLAY} .mtg-phasebar__steps { overscroll-behavior-inline: contain; }
  ${PLAY} .mtg-board__rail {
    min-height: 28rem; max-height: none; overflow: visible;
  }
  ${PLAY} .mtg-board__rail > .mtg-zone { max-height: none; }
  ${PLAY} .mtg-zoom {
    inset-inline-start: max(var(--mtg-space-3), env(safe-area-inset-left));
    inset-inline-end: max(var(--mtg-space-3), env(safe-area-inset-right));
    max-width: calc(100vw - max(var(--mtg-space-3), env(safe-area-inset-left)) - max(var(--mtg-space-3), env(safe-area-inset-right)));
  }
}
@media (max-width: ${String(PHONE_MAX_REM)}rem) and (pointer: coarse) {
  ${PLAY} .mtg-phasebar__node { flex: 0 0 44px; min-width: 44px; }
  ${PLAY} .mtg-phasebar__beats { min-width: 44px; min-height: 44px; justify-content: center; }
  ${PLAY} .mtg-priority .mtg-btn { min-height: 44px; }
}

@media ${SHORT_VIEWPORT_QUERY} {
  /* The step bar is one line here, and the thirteen steps scroll sideways.

     It wraps everywhere else, and \`./views.ts\` argues that at length: thirteen
     labels want 779px of row, most viewports are short of it, and a second line
     costs 33.9px at the viewport that is short and nothing at the one that is
     not. On a short table the same trade runs the other way. Measured at 844x390
     over four permanents a side, the bar was 90px of a 390px viewport — two
     lines of 44px node, the node height being \`../touch.ts\`'s coarse-pointer
     floor rather than the type — while both battlefield rows were pinned at
     their own 72px minimum with nothing left to give. At 932x430 it was three
     lines and 136px. A line of that bar is worth more to this table as card.

     \`flex: 0 0 auto\` on the node is what makes it scroll rather than shrink,
     and it is the load-bearing half. \`nowrap\` alone leaves the nodes their
     \`flex-shrink: 1\`, so a 545px row holding 779px of labels shrinks all
     thirteen toward the 1.75rem floor and every one of them ellipsizes — which
     is exactly the drawing \`mtg-rgc.2\` refused and the reason the row wraps in
     the first place. At a content basis with no shrink there is no deficit to
     distribute: each step is as wide as its word, and the row overflows by the
     difference. The scrollbar stays \`thin\` and visible rather than hidden,
     because a scroller nobody can see is the defect \`./board/hand.ts\` names
     about the hand row, and it is the same defect here. */
  ${TABLE} .mtg-phasebar__steps {
    flex-wrap: nowrap;
    overscroll-behavior-inline: contain;
  }
  ${TABLE} .mtg-phasebar__node { flex: 0 0 auto; }
  /* Your hand is capped at the size combat already caps it to, for the same
     reason and permanently.

     \`./board/hand.ts\`'s \`COMBAT_HAND_FACE_MAX_REM\` says it in one line —
     combat spends the vertical budget on permanents, not held options — and a
     landscape phone is in that condition on every step of every turn. Measured
     at 932x430 with four permanents a side, the hand row was 157.7px of a 430px
     viewport and the battlefield you play out of was 30.7px: 5.1 times the room
     for the cards you have not committed to. That is the inversion
     \`./board/band.ts\` quotes the playtester on and \`mtg-d6s\` spent a bead
     removing, arriving down a third road. At this cap the row is 96.2px.

     It binds only where the width has not already bound it. At 844x390 the hand
     slot is a seventh of a 628px row and the face lands at 49px on its own, so
     this rule moves nothing there; it is the wider landscape phones and the
     stubby desktop window that were drawing a 100px card in hand over a 61px
     card on the table. */
  ${TABLE} .mtg-board { --hand-face-cap: ${cssNumber(COMBAT_HAND_FACE_MAX_REM)}rem; }
  /* Restated for a crowded board, which is where the cap above would otherwise
     be undone by a rule meant to lower it.

     \`./board/hand.ts\` drops the cap from 7.5rem to 7rem once a battlefield row
     holds eight permanents, and it does that on a
     \`:has(.mtg-board__spells > .mtg-slot:nth-child(8))\` compound, which outranks
     the bare \`.mtg-board\` above. A media query adds no specificity, so on a
     landscape phone the eighth permanent raised the hand face from 3.5rem to
     7rem — a rule that only ever narrows a desktop board widening a phone one,
     and the busier the table the larger the cards it drew over it.

     Same selector, same value as the uncrowded landscape case: there is nothing
     further to give here, since 3.5rem is already the floor combat drops to. It
     wins on order rather than on weight, which is what \`./index.ts\` puts this
     sheet last for. */
  ${TABLE} .mtg-board:has(.mtg-board__spells > .mtg-slot:nth-child(8)) {
    --hand-face-cap: ${cssNumber(COMBAT_HAND_FACE_MAX_REM)}rem;
  }
  /* And the word over the tab you pressed to get here goes to the screen
     readers only.

     \`./views.ts\` already calls it the least load-bearing text on the screen and
     already shrank it to \`--mtg-text-sm\` for the same reason. On a phone in
     landscape the argument finishes itself: measured at 844x390 the mat gets
     194px of a 390px screen, and the heading plus the column gap it opens is 27
     of the 196 that furniture takes — 14% of the table, spent on a word the
     player is looking at the tab for.

     Hidden the way \`./base.ts\` hides a live region rather than with
     \`display: none\`, so the heading stays in the accessibility tree and a reader
     navigating by headings still finds the route it is on. */
  ${TABLE} .mtg-page-title { ${SPOKEN_NOT_DRAWN} }
  /* And the seat you act from outgrows the seat you only read.

     \`./board/fit.ts\` gives both bands \`flex: 1 1 auto\` and argues that an
     equal share of the *free* space lands both rows on the same height. It does,
     while there is free space. On a short table there is none, and then the
     equal share is a deficit split against two unequal content bases: the near
     band carries the step bar and the hand as fixed blocks, neither of which can
     give, so the whole of its shrink lands on the one child that can — the
     battlefield you are playing out of. Measured at 844x390, your row came out
     59.6px against the opponent's 104.8, and at 932x430 it was 30.7 against
     102.7. Your own board was 29% of theirs on a phone.

     The factors are \`./board/band.ts\`'s \`NEAR_GROW_IN_COMBAT\` restated for a
     second condition rather than a new idea: two, so the near band takes
     two-thirds of what is going and the far band gives up two-thirds of what is
     lost. Measured with the cap above in place, 844x390 lands at 85.1 yours to
     79.3 theirs and 932x430 at 98.7 to 96.1 — both seats a row of readable cards,
     and the one you are deciding from is the larger of the two, which is the
     order \`./board/hand.ts\` states for the whole table.

     Scoped to \`PLAY\` rather than \`TABLE\` for the reason band.ts scopes its
     own pair there: on a replay there is no seat you act from. */
  ${PLAY} .mtg-board__side[data-seat='you'] { flex-grow: 2; }
  ${PLAY} .mtg-board__side[data-seat='opponent'] { flex-shrink: 2; }
  /* And once a board is on the screen, everything above it stops being drawn:
     the shell's own bar, the set-completeness notice under it, and the route's
     control strip.

     the playtester, 2026-08-21, after playing a reduced M11 in landscape: "I want the
     table to basically take up the full landscape screen, you should need to
     return to portrait mode if you want to click any of the tabs at the top".
     Measured at 844x390 on the reduced build she was playing, the three bands
     are 57px of shell bar, 35.84px of notice and 44px of dealer strip — 136.84
     of 390, 35% of the screen, above a mat that got 227.16. None of the three is
     a thing a player uses while a turn is in progress: the bar is the route
     switcher, the notice is a sentence about which positions the set kept, and
     the strip is the seed and the reshuffle.

     Turning the phone is the way back to all of it, and it is a better way than
     a control would be: this tier is a \`max-height\` query, so portrait *is*
     the gesture that reveals the navigation, on every phone, with nothing to
     find and nothing to learn.

     \`display: none\` rather than \`./base.ts\`'s \`SPOKEN_NOT_DRAWN\`, and the
     difference matters here where it did not for the heading above. These bands
     hold six tab buttons, a set picker and up to three dealer buttons, and a
     control that is focusable but not drawn is the focus-visible defect WCAG
     2.4.7 names — a keyboard or switch user tabbing through a table would land
     on eight invisible stops. Out of the drawing means out of the tree.

     What that costs, stated rather than discovered later: the notice carries
     \`role="status"\`, so a landscape player is not told the set is a reduced
     build. That is the trade she asked for by name.

     Gated on \`:has(.mtg-board)\` rather than on the route, because the shut
     state has to be a state the table is in and not a state the *tab* is in.
     The precon picker and the sealed builder are on this route with no board and
     keep their strip, and \`../routes/play/LiveGame.ts\`'s handoff card — "Pass
     the device to X", whose only control is the button that takes the turn —
     draws a \`.mtg-toolbar\` and no board, so it keeps the one press that gets
     the game going again. */
  .mtg-shell${TABLE}:has(.mtg-board) > .mtg-shell__bar,
  .mtg-shell${TABLE}:has(.mtg-board) > .mtg-shell__notice,
  ${TABLE} .mtg-shell__main:has(.mtg-board) .mtg-toolbar {
    display: none;
  }
  /* And the gutter either side of the table is a quarter of what a page gets.

     \`./views.ts\` gives the table route's main a \`--mtg-space-4\` inline
     padding, which is 16px a side and the right number for a page of prose in a
     window. Beside a board it is 32px of an 844px screen — 24 of them more than
     the 4px this leaves — and what it buys is white space between the mat's own
     keyline and the edge of the glass. \`./board/hand.ts\` turns lane width into
     card width directly, so this is the cheapest 24px on the surface. */
  ${TABLE} .mtg-shell__main:has(.mtg-board) { padding-inline: var(--mtg-space-1); }
  /* And both shut columns narrow to what is actually left standing in them.

     \`./board/rail.ts\`'s \`SHORT_TABLE_RAIL_SHUT_PX\` and \`SHORT_TABLE_ASK_SHUT_REM\`
     carry the measurement and the argument; what is here is that they apply on a
     short table and nowhere else. The rail's strip is a disclosure, so it takes
     \`./touch.ts\`'s WCAG floor on the width axis and keeps the full 44 on the
     height axis, which is the axis nothing is competing for. The ask column's
     keeps the two life totals and \`Pass\`, and 3rem is the width of the widest of
     those.

     Restated at the same specificity as the declarations one file over, so this
     wins on order rather than on weight — which is what \`./index.ts\` puts this
     sheet last for. */
  ${TABLE} .mtg-board[data-rail='shut'] { ${RAIL_WIDTH_VAR}: ${cssNumber(SHORT_TABLE_RAIL_SHUT_PX)}px; }
  ${TABLE} .mtg-board[data-ask='shut'] { --ask-w: ${cssNumber(SHORT_TABLE_ASK_SHUT_REM)}rem; }
  /* And the mana base stops being a 9px well you scroll to read.

     \`./board/lands.ts\`'s \`SHORT_TABLE_LAND_TILE_REM\` carries the measurement
     and the argument. Two declarations, and both are needed: \`./board/fit.ts\`
     caps the band at whatever the lane has left after the cards in play take
     their floor, which on a short table is single digits, and the tile inside it
     is a stated 3.5rem that the band centers rather than shrinks — so lifting
     the cap without shortening the tile spends 60px on five lands, and
     shortening the band without lifting the cap draws the middle third of each
     of them.

     \`max-height: none\` on the tile as well as on the band, and that one is not
     redundant: \`./board/fit.ts\` caps the tile at \`100%\` of the band, which is
     the circularity its own docblock warns about the moment the band stops
     having a stated height of its own. Left in, chrome-headless-shell settled a
     36px tile at 38 and the band scrolled by 2.

     With the cap off the band is \`flex: none\` and content-driven, so it takes
     the tile plus its 2px of padding and stops; the spells row above it keeps
     the rest and floors at \`./board/fit.ts\`'s \`MIN_SLOT_REM\`, which is what
     makes giving the band a fixed claim safe in this direction only.

     Restated at the same specificity as the declarations one file over, so this
     wins on order rather than on weight. */
  ${TABLE} .mtg-zone__body[data-layout='board'] > .mtg-lands { max-height: none; }
  ${TABLE} .mtg-lands > .mtg-slot[data-slot='play'] {
    height: ${cssNumber(SHORT_TABLE_LAND_TILE_REM)}rem; max-height: none;
  }

  /* And the band cannot be the thing that goes under the fold, which is the half
     of the paragraph above that was left to arithmetic.

     Two declarations, and they answer two different sizes. The floor is
     \`./board/fit.ts\`'s \`SHORT_TABLE_SPELLS_MIN_REM\`, and it makes the row the
     child that gives: the lane is a column of a row and a band, the band is
     \`flex: none\` at a stated tile, and until now the row's 4.5rem floor meant
     neither of them could shrink, so a lane 12px short at 932x430 put 12px of
     mana base past the bottom edge rather than 12px of card. With the floor at
     3rem the row absorbs it and nothing overflows at all.

     The sticky is for the sizes where even 3rem does not fit — 932x400 and
     844x390 are 3px and 8px short of it, and a 330px-tall table is 39px short.
     There the body still overflows, and \`bottom: 0\` glues the band to the
     bottom of the scrollport so what the overflow costs is the bottom edge of a
     card instead of the whole mana base. The background is the zone's own
     (\`./board/zone.ts\`), because a transparent sticky band draws the cards it is
     covering straight through itself.

     Restated at the same specificity as the declarations one file over, so this
     wins on order rather than on weight. */
  ${TABLE} .mtg-board__spells { min-height: ${cssNumber(SHORT_TABLE_SPELLS_MIN_REM)}rem; }
  ${TABLE} .mtg-zone__body[data-layout='board'] > .mtg-lands {
    position: sticky; bottom: 0; background: var(--mtg-mat-well);
  }

  /* The ask column stops scrolling, because everything in it that was said
     twice stops being drawn.

     the playtester, 2026-08-22: "the life totals seem cut off and you shouldn't have
     to scroll on the left side to see available life totals and actions".
     Measured at 844x390 with the column open, it held 550px of content in 372:
     178px of scroll, with your own life number 47.63px under the bottom edge and
     the prompt squeezed to 50px of the 123 it wanted. \`./board/rail.ts\` makes
     the prompt the one flexible block in here and every other block \`flex:
     none\`, which is right, and it is why the deficit lands where it does: the
     fixed blocks came to 470px on their own, so the prompt was paying a debt it
     could not cover and the column scrolled for the rest.

     So the cut is made against the fixed blocks, and every one of these is a
     fact this column prints in two places rather than a fact it stops printing.

     \`.mtg-play-meta\` is "0 choices made", a tally of your own past clicks.
     27.84px.

     \`.mtg-pod__tags\` is Active and Priority as two words. \`./board/status.ts\`
     already draws the active seat's pod with an accent keyline
     (\`.mtg-pod[data-active='true']\`), and \`.mtg-priority\` two blocks down says
     whose priority it is in a sentence with the Pass button under it. 39.88px,
     and it is also the 6px this column clipped sideways in its *shut* state,
     where 59.22px of tag was drawn into a 48px strip.

     \`.mtg-pod__name\` is "You" and "Bot". The graveyard head directly under each
     pod is titled "your graveyard" and "Bot's graveyard", so the seat is named
     within 15px of itself either way, and the pod keeps the accessible name
     \`../board/SeatPod.ts\` gives it. 15.59px.

     \`.mtg-pod__chips\` stacks library over hand because the pod is a column you
     read down. Two numbers side by side is the same pair in half the height, and
     the pod is 97px wide here, which is room for both. 15.59px.

     \`.mtg-prompt__explain\` restates \`.mtg-priority\`'s sentence inside the
     panel. It does not shorten the column — the prompt is the flexible block —
     but it is 75.38px of the prompt's own scroller, which is where the moves
     are. */
  ${TABLE} .mtg-play-meta,
  ${TABLE} .mtg-board__pods .mtg-pod__tags,
  ${TABLE} .mtg-board__pods .mtg-pod__name,
  ${TABLE} .mtg-board__pods .mtg-prompt__explain { display: none; }
  ${TABLE} .mtg-board__pods .mtg-pod__chips {
    flex-direction: row; justify-content: space-between; gap: var(--mtg-space-2);
  }
  /* And the pod's own top and bottom margin halves, which is the last 6px and
     the only one of these that is not a duplicate.

     \`./board/status.ts\` pads the pod \`--mtg-space-2\` down the block axis and
     \`--mtg-space-1\` across it, which is 16px of a 63px block spent on air above
     and below two lines of type. Halved, the pod is the same two lines with the
     same keyline around them and the column stops scrolling at 844x390 with 10px
     to spare. The inline padding is untouched: that is the axis a 107px column
     is poor in, and the chips row is already using all of it. */
  ${TABLE} .mtg-board__pods > .mtg-pod { padding-block: var(--mtg-space-1); }
  /* And a closed pile is a line rather than a fingertip.

     \`../touch.ts\` floors \`.mtg-browser__head\` at 44px, and the two graveyards
     take 108px of a 372px column between them to say they are empty. The floor
     is spent on the axis the surface is poor in — that file argues exactly this
     when it narrows a strip to WCAG 2.5.8 AA's 24px and keeps the full 44 on the
     other axis. Here the poor axis is height and the head is the full width of
     the column, so the target is 107 x 24 rather than 107 x 44: over the AA
     minimum on both axes, and 40px back into the prompt.

     Only the closed one. An open pile is a list you press rows in
     (\`./board/browser.ts\`), and its rows keep the full floor.

     And an empty one stops saying so twice. \`../board/ZoneBrowser.ts\` draws
     "graveyard is empty" beside the count that is already 0, and in a 107px
     column the sentence takes the second half of the head's width, which pushes
     both it and the zone's own label onto two lines each: 37.69px of head for a
     pile with nothing in it. Spoken rather than removed, the way \`./base.ts\`
     hides a live region, because the sentence is the whole content of an empty
     zone for a reader and the count beside it is a bare numeral. Drawn, the head
     is one line of label and 21.7px shorter. */
  ${TABLE} .mtg-board__pods > .mtg-browser:not(:has(.mtg-browser__list)) .mtg-browser__head {
    min-height: ${cssNumber(WCAG_TARGET_PX)}px;
  }
  ${TABLE} .mtg-board__pods .mtg-zone__empty { ${SPOKEN_NOT_DRAWN} }

  /* And what the four cuts above bought goes to the move list, which is the
     other half of what she asked to stop scrolling for.

     Three declarations, and the first is the one that matters. \`./board/rail.ts\`
     makes the prompt the column's only flexible block, so it is the block every
     pixel freed above lands in: 50px at 844x390 before any of this, 60 after the
     cuts, 80 with the disclosure below, against a panel that wants 123.

     The disclosure takes \`../touch.ts\`'s WCAG floor on the axis this table is
     poor in, which is the trade that file already makes for a narrowed strip and
     the one \`./board/rail.ts\` makes for the shut rail. Open, the toggle is the
     full 107px width of the column, so 107 x 24 clears 2.5.8 AA on both axes and
     hands 20px to the moves. Shut, it is a 48px strip and the column has room to
     spare, so it keeps the full 44.

     The panel's head goes from a stack to a line: "Priority" over "10 legal" is
     42.88px of a 390px screen for six words, and side by side it is 26.9. And
     \`../views.ts\` floors the panel's body at 5rem, which on a panel this short
     is 80px of content inside 53px of box — the floor was written for a window
     with room and here it only moves the clipping from the scroller's bottom to
     the panel's. Zeroed, the body is exactly the panel less its head and the
     moves scroll inside it, which is what the scroller is for.

     What that leaves at the smallest phone: a panel that is 75px and wants 75,
     so nothing in it is cut off, over a scroller 46.97px deep — room for a whole
     44px move, with the other nine a scroll of the panel away rather than a
     scroll of the whole column. At 932x430 the scroller is 86.97. That is the
     criterion \`./board/rail.ts\` states for the opened-pile floor one file
     over, arrived at from the other side. */
  ${TABLE} .mtg-board[data-ask='open'] .mtg-ask__toggle {
    min-height: ${cssNumber(WCAG_TARGET_PX)}px;
  }
  ${TABLE} .mtg-board__pods > .mtg-prompt > .mtg-panel__head {
    flex-direction: row; align-items: baseline; justify-content: space-between;
    gap: var(--mtg-space-2); padding-inline: var(--mtg-space-2);
  }
  ${TABLE} .mtg-board__pods > .mtg-prompt > .mtg-panel__head > .mtg-panel__note {
    flex: none; white-space: nowrap;
  }
  ${TABLE} .mtg-board__pods > .mtg-prompt > .mtg-panel__head > .mtg-panel__title {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  ${TABLE} .mtg-board__pods > .mtg-prompt > .mtg-panel__body { min-height: 0; }

  /* The zoom panel, sized to the screen it is drawn on rather than to a number.

     the playtester, 2026-08-22: "when you click a card you should be able to see the
     full version of its card text". \`../card.ts\` gives the tap its trigger back;
     this is the other half, because on this table the panel it opens did not fit.
     \`ZOOM_FACE_WIDTH_REM\` is 20rem, and a card face is trimmed
     ${cssNumber(CARD_TRIM_MM.width)} by ${cssNumber(CARD_TRIM_MM.height)}, so the
     face is 320 x 447px on a viewport 390px tall: the rules box, which is the
     whole reason the panel exists, was the part under the fold.

     Derived from the viewport rather than tiered, so it is right at 390, at 430
     and at whatever the next phone is, and \`min()\` so it only ever shrinks —
     a tall narrow window is still a 20rem face. The inset is counted twice
     because the panel is pinned one \`--mtg-space-4\` off the bottom and the same
     margin above it is what keeps it from reading as clipped. At 844x390 that
     settles a 256px face, which is a third of the width it is drawn over and
     the first time the whole card has been on the screen.

     **20rem was derived, so shrinking it has to answer the derivation.**
     \`../card.ts\` picks it as the width at which the zoom's rules box, set at
     step 0, holds what a 15.25rem face holds at the fit ladder's floor. Measured
     at 844x390 the capped face's box is 236.28 x 113.45px at 13px, which is 6.02
     lines of 37.9 characters, or 228; the floor case it has to cover is 196 x
     82.9px at 10.1px, 5.65 lines of 40.5, or 229. So the smallest phone this
     runs on meets the requirement to within a character, and every larger one
     clears it — 932x430 settles a 262.92 x 133.95px box, which is 300. The
     panel got smaller and the text in it did not, because what was actually
     lost at 20rem was the bottom 73px of the card.

     No \`${'$'}{TABLE}\` on it, unlike everything above: a zoom panel is a card face
     wherever it is drawn, and a window this short cannot hold a 447px one on
     any route. That leaves it at the same weight as the declaration in
     \`../card.ts\`, so it wins on this file being last in \`./index.ts\` rather
     than on specificity, which is the same bargain the rest of this block
     makes. */
  .mtg-zoom > .mtg-card {
    --card-w: min(
      ${cssNumber(ZOOM_FACE_WIDTH_REM)}rem,
      calc((100vh - 2 * var(--mtg-space-4)) * ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)})
    );
  }
}
`;
