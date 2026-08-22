/**
 * The two rails on the played table, and the split between them.
 *
 * # What each column is for
 *
 * `mtg-rgc.4`. Magic Online spends about 22% of its width on two rails and gives
 * them different jobs. The **left** one carries the current ask in plain language
 * in the span between the two player pods — "BswizzMTG's declare attackers step.
 * Waiting for BswizzMTG to declare attackers." — and the **right** one is Chat
 * and Game Log and nothing else, with the chat input under it. Reading the
 * capture in `references/068-1083771671.png`: one column answers "what is being
 * asked of me", the other answers "what has already happened", and neither can
 * squeeze the other because they are not in the same column.
 *
 * Ours put both in the right rail — the stack, the move list, the log and both
 * graveyards, in that order — and the parts competed. Measured in
 * chrome-headless-shell 151.0.7922.47 over a real 89-line log at 1440x900,
 * 1280x800 and 1024x768 and at both four and twelve permanents a side: opening
 * the log gave it 200.8px, 167.5px and 156.8px of a rail whose other four blocks
 * were already floored, and **three, two and two of the 89 lines were painted**.
 * The move list paid for even that — it went from 533.3px to 384.5px at 1440x900
 * the moment the log was opened — and it is the one thing on the surface a
 * player acts with. That is not a log anybody reads; it is a log that fits.
 *
 * After the split, at the same three viewports and the same log: the log's block
 * is 589.3px, 489.3px and 457.3px with 10, 8 and 7 lines painted, and the move
 * list is 529px, 429px and 397px **whether the log is open or shut**. Neither
 * number moves when the other panel does, which is the property having two
 * columns buys.
 *
 * So the ask moves to the pod column (`../../board/Board.ts`'s `prompt` prop) and
 * the rail keeps the history. The pods were already at the two ends of that
 * column with an empty span between them, which is where Magic Online puts its
 * prompt box and is the span the seat-pods lane reported leaving behind.
 *
 * # The two widths
 *
 * `PLAY_ASK_REM` and `PLAY_RAIL_REM` are stated here together because the trade
 * between them and the lanes is one trade. `./fit.ts` sizes the mat's three grid
 * tracks from them, `./picker.ts` anchors a menu inside the right one, and
 * `../views.ts` hangs the priority row off it.
 *
 * # What each rail block may do
 *
 * There is one left. `mtg-rgc.7` took the last two things in this column that
 * were not history: the stack went to the seam between the seats
 * (`./stack.ts`) and each graveyard went under its own pod, so the rail is the
 * disclosure and the log. What that bought is the whole point of the bead and
 * it is a measurement — every block in here is floored at
 * `RAIL_BLOCK_MIN_REM`, and an empty stack and two shut graveyards were three
 * of those floors and their gaps, 168px, spent on boxes that said "stack is
 * empty" and named a card each. Measured in chrome-headless-shell over the
 * played table before and after, at 1024x768, 1280x800 and 1440x900: the log's
 * block goes 509.3 / 541.3 / 641.3px to 677.3 / 709.3 / 809.3, the same
 * +168.0px at every viewport because every part of it is an absolute number.
 * What that buys is read rather than inferred: over a 1,191-line log at the
 * `everything` density it is 16 / 18 / 21 painted lines before and 23 / 24 / 27
 * after at twelve permanents a side, so the bead's estimate of "about three
 * more lines" was low by roughly a factor of two.
 *
 * The rules that carried the four-block column are kept, because they are what
 * makes the one that is left safe to squeeze and because the ask column now
 * makes the same bargain with the same numbers. A block is floored, so it can
 * never be shorter than its own head. A block clips, so a block that is
 * nonetheless too short for its content cuts it off at its own edge rather than
 * painting it over the next block; the body inside it is already an internal
 * scroller, so nothing becomes unreachable by that — a browser's list is one
 * (`./browser.ts`, `.mtg-browser__list`). And the column itself scrolls rather
 * than hiding, so a column too short for the sum of the floors can still be read
 * to the end. `overflow: hidden` there was the rule that turned an overlap into a
 * silent truncation; `auto` is what makes the cost visible and payable.
 *
 * # The graveyards, in the ask column
 *
 * `references/068-1083771671.png` hangs each player's zones off that player's own
 * pod, and the strip is a click-to-open browser rather than a list
 * (`../../board/ZoneBrowser.ts`), so what crossed the mat is one row of chrome.
 * It comes out of the rail's floor as well as out of the rail: shut, a browser is
 * its head and the zone's padding, and the ask column lets it be exactly that
 * instead of the 52px a rail block is entitled to.
 *
 * Adding two blocks to a column measured for two is a claim about the narrow
 * viewport, so it was re-measured rather than assumed. `../../test/play/ask-column.browser.test.ts`
 * holds the assertion and the numbers are in its docblock; the rule below is the
 * half that makes it hold — a shut strip cannot shrink and does not want to, and
 * an opened one is floored, capped at the same 30% a rail block was, and scrolls
 * inside itself, so a forty-card graveyard cannot push a pod off the mat.
 */
import { cssNumber } from '../number';
import { TOUCH_TARGET_PX, WCAG_TARGET_PX } from '../touch';
import { TABLE } from './geometry';

/**
 * How wide the side rail is on the played table.
 *
 * Wider than the 16rem the mat gives a replay frame. It held the move list as
 * well when this number was set, and it keeps the width now that it does not,
 * for a measured reason: the log's three level buttons and the count beside them
 * lay out at 230px in the 256px box a 17rem rail gives them, so this column has
 * 26px of slack and narrowing it by more than that wraps the log's own foot
 * (`./log.ts` carries that measurement). The reclaim this bead makes is on the
 * height axis inside the rail, not on the width axis beside it.
 *
 * 17rem is 272px, which is 21.3% of a 1280px window and 18.9% of a 1440px one —
 * Forge's left rail is 20% of width and Magic Online's two rails are 22.4%
 * between them, so this is the geometry the field already settled on, spent on
 * the axis that is not scarce here.
 */
export const PLAY_RAIL_REM = 17;

/**
 * The rail's current width, published by the mat to the rules that follow it.
 *
 * `mtg-crw`. `PLAY_RAIL_REM` was written into the grid track and into the hover
 * zoom's clearance separately; the column collapses now, so the width is a value
 * the mat carries and both readers take. `./fit.ts` declares it at
 * `PLAY_RAIL_REM` and the block below re-declares it at the strip on
 * `[data-rail='shut']` — a more specific selector on the same element, so the
 * strip wins wherever the state says so and nothing depends on sheet order.
 *
 * No `--mtg-` prefix, for the reason `./hand.ts`'s `--hand-slot` carries none:
 * that prefix is the design vocabulary, declared once in `../tokens.ts` and
 * checked against every reference by `../../test/tokens.test.ts`, and this is the
 * board sheet publishing a number to itself.
 */
export const RAIL_WIDTH_VAR = '--rail-w';

/**
 * And how wide the column is once it is shut: exactly one touch target.
 *
 * `mtg-crw`. Shut is a strip rather than nothing, and the strip is what makes the
 * state reversible — a column that vanished would leave its control nowhere, and
 * a control that moved to the toolbar when the panel shut would be a second
 * place to look for one thing. What is in the strip is the disclosure and
 * nothing else, so its width is the width of that button, and the button's width
 * is already decided: `../touch.ts`'s `TOUCH_TARGET_PX` is the floor every
 * pressable thing on this surface takes under a coarse pointer. Stated in px
 * from that constant rather than as a rem that happens to match it, so the strip
 * and the floor cannot drift apart while both look right.
 *
 * What the collapse returns is `PLAY_RAIL_REM` minus this, plus the mat's gap:
 * 272 - 44 + 8 = 236 CSS px of the lanes column, at every viewport, because both
 * numbers are absolute. That is the reclaim, and it lands on the axis a board
 * face is actually sized on — `./hand.ts` makes a battlefield face a share of the
 * *hand slot*, which is a share of the lane's width, so width is the only axis
 * on this table that turns into a bigger card. Measured against the flagship set
 * at 1440x900 with four permanents a side, a near face goes 99.2 x 138.5 to
 * 129.9 x 181.4: 31% wider, from a column nobody was reading.
 */
const PLAY_RAIL_SHUT_PX = TOUCH_TARGET_PX;

/**
 * And how wide the ask column is allowed to grow to, once it carries the prompt.
 *
 * Magic Online's left rail is 168px at 1280x720, which is 13.1% of the window;
 * 11rem is 176px. That is the size of the thing being copied, and it is a *cap*
 * rather than a width, because the column has to shrink on a narrow screen and a
 * fixed 11rem is at its most expensive exactly where the lanes are at their
 * poorest. `./fit.ts` writes it as `clamp(POD_WIDTH_REM, ASK_PERCENT%, this)`.
 *
 * Measured in chrome-headless-shell 151.0.7922.47: the column lands at 176px at
 * 1440x900, 160.9px at 1280x800 and 127.7px at 1024x768.
 *
 * **The claim that used to follow that sentence was false, and it was false
 * because the check could not fail** (`mtg-6i4`). It read: no move label, group
 * title, seat name or zone caption overflows its box at any of the three, a
 * label in this column wraps rather than being cut. What was actually happening
 * is that `../views.ts`'s move grid stated a track minimum of 11rem, a grid item
 * never shrinks below its track minimum, and every group laid out at 176px in a
 * column that was 127.7px — so the labels did not wrap, they hung out over the
 * board and were sliced by the panel's own edge. `../../tools/rail-split.ts`
 * asked each label whether it had clipped *itself* and got 0, because the thing
 * doing the cutting was one box up. Re-measured with that check fixed and the
 * track minimum bounded: 16 of 16 and 28 of 28 labels outside their box before,
 * by 1px, 16.1px and 49.3px at the three viewports, and four group titles with
 * them; none of either after, at either board size. The sentence is true now.
 *
 * What it costs is that a narrow ask really does cost lines. The label is 130px,
 * 114.9px and 81.7px, and at the smallest of those a two-word move takes two of
 * them, which is why the fully-shown move count at 1024x768 reads 5 where it
 * read 6 while six of them were being sliced.
 *
 * A percentage in the middle rather than a media query, because the thing that
 * has to bend is a ratio and a breakpoint would state one number twice. The floor
 * is the pod's own width, so the column can never be narrower than the block that
 * was already in it.
 */
export const PLAY_ASK_REM = 11;

/**
 * And how wide the ask column is once it is shut.
 *
 * Wider than the rail's strip, and the reason is what is left in each of them.
 * A shut rail is a disclosure and nothing else, so its width is one touch target.
 * A shut ask column keeps three things a player reads or presses between
 * decisions — the two pods with the life totals on them, and the priority row —
 * so it is the width of the widest of those rather than of the chevron. 5rem is
 * 80px, and `../../routes/play/priority.ts`'s longest button label lays out in
 * it with `--mtg-space-1` either side; at the strip's 44px it would ellipsize.
 *
 * Stated here rather than inline in the block below because two rigs read it:
 * `../../../slice/test/ui-phone-scroll.browser.test.ts` plays a landscape phone
 * through Vite and asserts the first grid track, and a number a test restates by
 * hand is a number that drifts.
 */
export const PLAY_ASK_SHUT_REM = 5;

/**
 * And what both shut columns narrow to once the table is short as well.
 *
 * The playtester, 2026-08-22, having played the full-screen landscape table: "reclaim
 * the width a bit by making the borders on the left and right where the panes
 * are expandable and collapsible more narrow". Measured at 844x390 with both
 * columns shut, the two strips were 80px and 44px of an 844px screen and the
 * lanes had 686. The rail's is a chevron in a 44px box and the ask column's is a
 * chevron, two life totals and the word `Pass`.
 *
 * `../touch.ts`'s `WCAG_TARGET_PX` for the rail, because a disclosure is one
 * control and 24x44 is a conformant target on the axis that is not scarce.
 * 3rem for the ask column, because `Pass` at `--mtg-text-sm` is 30.4px of text
 * and `../../routes/play/pass.ts` gives it `--mtg-space-1` either side, so 48px
 * holds the widest thing in the column with 9.6px to spare — and a life total is
 * two digits.
 *
 * What that returns is 52px of an 844px mat, which is one more card on the row
 * at every board size, and it is returned on the axis `./hand.ts` sizes a face
 * on. It is spent only on a *short* table: a narrow desktop window shuts the rail
 * (`../board/geometry.ts`'s two arms) with height to spare, and there the strips
 * keep the 44px floor the rest of this surface is measured against.
 */
export const SHORT_TABLE_RAIL_SHUT_PX = WCAG_TARGET_PX;
export const SHORT_TABLE_ASK_SHUT_REM = 3;

/**
 * What share of the mat the ask column asks for between its floor and its cap.
 *
 * 13 rather than the 19 that would hold the full 176px at every viewport, and the
 * difference is one board. The lanes pay for this column, and at 1024x768 with
 * twelve permanents a side the row is already fitted to `./fit.ts`'s 3rem slot
 * floor and scrolling sideways, so every pixel taken off it is a card that stops
 * being painted. Measured there: 19% costs one of the opponent's twelve and two
 * of yours, 16% costs one each, and 13% costs one of yours and nothing of theirs.
 *
 * What 13% costs in total, over the six measurements: one of the opponent's
 * twelve at 1280x800, one of yours at 1024x768, and nothing at all at 1440x900 or
 * at four permanents a side anywhere. **No card changed height at any of them** —
 * 182.4px, 149.1px and 138.4px before and after — because `./fit.ts` fits a slot
 * to its row's height and only its width follows the room. So the whole bill is a
 * narrower card in a row that already scrolls.
 *
 * The ask column takes Magic Online's own width wherever the board can afford it
 * and gives some back where it cannot. The narrow end is 127.7px, which is still
 * 45% wider than the pod it replaced.
 *
 * **The number is kept and it is not settled**, because half of what argued it
 * is gone. The half that stands is the board's bill, re-measured at 16%: one
 * more of the opponent's twelve unpainted at 1280x800 and at 1024x768, and every
 * card 4px shorter at the smaller one. The half that does not is "no label
 * overflows at any of the three" — see `PLAY_ASK_REM` above — so 13% was chosen
 * against a reading of this column's own comfort that no width could have
 * failed. What 16% buys, now that the labels are inside the column: one more
 * move fully shown at 1024x768 and 18% off the list's scroll height. One board
 * card against one move is a trade somebody has to make on purpose, and this
 * lane's beads are the fold and the slicing rather than the width.
 */
export const ASK_PERCENT = 13;

/**
 * The shortest a rail block may be squeezed to: its head and one row under it.
 *
 * The number that answers the second of `mtg-bc2.137`'s verifier findings, and
 * the finding is worth restating because the shape of it is general. The rail
 * capped its blocks at 30% and floored them at nothing, `${TABLE} .mtg-zone` sets
 * `min-height: 0`, and a `.mtg-zone` declared no overflow of its own, so at a
 * 296-option declare-blockers prompt all three rail zones came out 9px tall
 * against 44px of content, their heads and bodies painted over the zone beneath
 * them, and `overflow: hidden` on the rail cut the tail off. Measured at
 * 1280x800: 8 pairs of text drawn over one another and 5 labels drawn outside
 * the rail entirely. The variable-length thing had stopped taking its cost out
 * of the cards and started taking it out of the rail's own text.
 *
 * 3.25rem is measured rather than guessed: an uncrowded rail zone lays out at
 * 48px of content (the uppercase label, one line of body, and the zone's own
 * padding), and the box is bordered, so 52px is that content plus the two
 * keylines and a pixel of slack. A floor below the natural size would still clip
 * the last line of a zone that had nothing to hide. Under the sum of the floors
 * the rail scrolls instead, which is the same bargain the hand rail makes on the
 * other axis.
 */
const RAIL_BLOCK_MIN_REM = 3.25;

export const RAIL_CSS = `
${TABLE} .mtg-board__rail { min-height: 0; overflow-y: auto; gap: var(--mtg-space-1); }
${TABLE} .mtg-ask__head { flex: none; }
${TABLE} .mtg-ask__toggle {
  width: 100%; min-width: 0; justify-content: center;
  gap: var(--mtg-space-1); padding-inline: var(--mtg-space-1);
}
${TABLE} .mtg-ask__chevron { font-weight: 700; line-height: 1; }
${TABLE} .mtg-ask__toggle-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${TABLE} .mtg-play-meta {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  padding: var(--mtg-space-1); border-bottom: 1px solid var(--mtg-line);
}
${TABLE} .mtg-board[data-ask='shut'] { --ask-w: ${cssNumber(PLAY_ASK_SHUT_REM)}rem; }
${TABLE} .mtg-board[data-ask='shut'] .mtg-ask__toggle-label,
${TABLE} .mtg-board[data-ask='shut'] .mtg-play-meta,
${TABLE} .mtg-board[data-ask='shut'] .mtg-board__pods > .mtg-panel,
${TABLE} .mtg-board[data-ask='shut'] .mtg-pod__chips,
${TABLE} .mtg-board[data-ask='shut'] .mtg-pod__name { display: none; }
${TABLE} .mtg-board[data-ask='shut'] .mtg-pod { padding-inline: var(--mtg-space-1); }
${TABLE} .mtg-board[data-ask='shut'] .mtg-priority .mtg-btn {
  width: 100%; min-width: 0; padding-inline: var(--mtg-space-1);
}
/*
 * The disclosure, at the top of the column and drawn in both states.
 *
 * flex: none, so it is the one block in here the rail's own scroll and the 30%
 * cap below never touch: it is the way back out of the shut state and a way out
 * that can be scrolled off the top is not one. The label is hidden rather than
 * the button narrowed, because the button carries its accessible name outright
 * (../../routes/play/rail-collapse.ts) and the name is what a screen reader
 * reads in either state.
 */
${TABLE} .mtg-rail__head { flex: none; display: flex; flex-direction: column; gap: var(--mtg-space-1); }
${TABLE} .mtg-rail__toggle {
  width: 100%; min-width: 0; justify-content: center;
  gap: var(--mtg-space-1); padding-inline: var(--mtg-space-1);
}
${TABLE} .mtg-rail__chevron { font-weight: 700; line-height: 1; }
${TABLE} .mtg-rail__toggle-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/*
 * Shut: the column is a strip, and everything but the disclosure stops being
 * drawn.
 *
 * display: none rather than unmounting, so a graveyard browser or a log the
 * player had open is still open when the panel comes back — and so the blocks
 * leave the accessible tree and the tab order together, which is what a hidden
 * panel has to do and what visibility or a zero width would not.
 *
 * The strip is the mat's business as well as the rail's, which is why the width
 * is re-declared here on the mat: the third grid track reads it (./fit.ts), and
 * so does the hover zoom's clearance, so a panel that shut without moving the
 * track would be a 44px strip inside a 272px column.
 */
${TABLE} .mtg-board[data-rail='shut'] { ${RAIL_WIDTH_VAR}: ${cssNumber(PLAY_RAIL_SHUT_PX)}px; }
${TABLE} .mtg-board[data-rail='shut'] .mtg-board__rail > *:not(.mtg-rail__head) { display: none; }
${TABLE} .mtg-board[data-rail='shut'] .mtg-rail__toggle-label { display: none; }
${TABLE} .mtg-board__rail > .mtg-zone {
  flex: 0 1 auto;
  max-height: 30%;
  min-height: ${cssNumber(RAIL_BLOCK_MIN_REM)}rem;
  overflow: hidden;
}
/*
 * The ask column, on the played table only.
 *
 * The pods keep their place at the two ends and stop being fixed-width blocks in
 * a wider column: an 88px pod floating in a 176px track would read as a gutter
 * somebody forgot, and the reference fills the column with the pod. An automatic
 * width rather than a full percentage, because the column is already a
 * stretch-aligned flex column, so the pod takes the track and nothing here
 * restates the track's own number.
 *
 * The prompt takes what the two pods leave, floors at the same head-and-a-row
 * every rail block floors at, and clips at its own edge, which is the bargain the
 * rail's blocks already make one column over. Its body is an internal scroller
 * (../views.ts), so a 513-option declare-attackers prompt scrolls inside the span
 * rather than pushing a pod off the mat.
 */
${TABLE} .mtg-board__pods { overflow-y: auto; }
${TABLE} .mtg-board__pods > .mtg-pod { width: auto; }
${TABLE} .mtg-board__pods > .mtg-prompt {
  flex: 1 1 auto;
  min-height: ${cssNumber(RAIL_BLOCK_MIN_REM)}rem;
  overflow: hidden;
}
/* Shut, a graveyard is its own head and nothing else, and flex: none is what
   lets it be that: the rail's floor was written for a zone with a label line and
   a body under it, and applying it here would have moved the 52px rather than
   removed it. Nothing in this column wants those pixels more than the prompt
   does, and the prompt is the one flexible block in it.

   Open, it takes up to 30% of the column and clips at its own edge, with
   ./browser.ts's scroller inside it. :has() rather than an attribute, for the
   reason ./band.ts gives: the section either contains its list or it does not,
   and a component writing an attribute that restates its own children is a
   second place for the two to disagree.

   **The floor is the whole of the tuning, and it is bounded from both sides.**
   This column is always exactly full — the prompt is flex: 1 1 auto and takes
   whatever is left — so an opened pile and the prompt are not sharing free
   space, they are dividing a deficit, and flex weights a shrink by base size.
   The pile's base is forty rows, so without a floor it absorbs nearly all of
   it: measured at 1024x768, the opened browser was 28.0px, a scroller shorter
   than one of the rows it scrolls, and the player who opened a pile got less
   than they started with. With one, the pile takes its floor and the prompt
   pays the difference. 4.5rem is the largest floor the narrow column can carry:
   at 1024x768 it leaves the prompt 235.4px, which is one whole clickable move,
   and 6rem leaves 197.6px, which is none. It buys the pile a whole card and its
   scrollbar, and the other 39 cards are a scroll away rather than a click away.
   ../../test/play/ask-column.browser.test.ts opens forty cards and asserts both
   halves at once — a whole clickable row in the pile and a whole clickable move
   in the prompt — which is the pair this number trades between. */
${TABLE} .mtg-board__pods > .mtg-browser { flex: none; overflow: hidden; }
${TABLE} .mtg-board__pods > .mtg-browser:has(.mtg-browser__list) {
  flex: 0 1 auto;
  min-height: 4.5rem;
  max-height: 30%;
}
`;
