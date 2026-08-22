/**
 * The game log: a rail block that opens into a bottom-anchored scroller.
 *
 * Its own sheet for the reason `./browser.ts` is one, and emitted straight after
 * it, because it is the same shape one step further on: a zone whose closed state
 * is a strip and whose open state is a panel that scrolls. It reuses
 * `.mtg-browser__head` and `.mtg-browser__newest` verbatim rather than restating
 * them — the head is the same control doing the same job, and a second copy of
 * that row is exactly the drift `../../../test/polish.test.ts` sweeps for.
 *
 * # `column-reverse` is the whole of the scroll behavior
 *
 * `.mtg-log__panel` holds one child, the chronological list, and is laid out
 * `column-reverse`. With a single flex item that reorders nothing: DOM order,
 * reading order and screen-reader order are untouched. What it changes is where
 * the browser anchors the scroll. A `column-reverse` scroll container is anchored
 * at its bottom, so the panel opens on the newest line without an effect, a ref or
 * a `scrollTop` write, and content appended below a reader who has scrolled back
 * grows away from them instead of shoving their line up the screen.
 *
 * Measured in chrome-headless-shell 151.0.7922.47 over a real 90-line log at
 * 1440x900, 1280x800 and 1024x768, static page, all three identical unless said
 * otherwise:
 *
 *  - At rest the panel sits at `scrollTop: 0` with 3158px of content in 238px of
 *    box, the newest line inside the viewport and the oldest outside it. Zero
 *    script ran.
 *  - Appending 30 entries at the end leaves `scrollTop` at 0 and the new newest
 *    line visible: it follows.
 *  - Parked mid-history at `scrollTop: -1460`, the same 30 entries move
 *    `scrollTop` to -2088 and move the reader's anchor line **0.1px**. That is
 *    the property the brief asks for, and it is the one a measure-and-write
 *    effect gets wrong loudly.
 *  - Chrome's `scrollTop` on a reversed column runs 0 at the bottom to
 *    -(scrollHeight - clientHeight) at the top. Anything that ever reads or
 *    writes it here needs to know that; the first version of the measurement
 *    wrote a positive value and was silently clamped to 0.
 *
 * **`justify-content: flex-end` was tried and removed**, and this is why it is
 * not coming back. It packs a short log against the top of the box, which looks
 * tidier, and in a reversed column it puts the overflow on the *start* side,
 * which Chrome does not make scrollable: measured at all three viewports the
 * panel reported `scrollHeight === clientHeight === 352`, the oldest line was on
 * screen and the newest 3178px below it was unreachable. Without the declaration
 * a short log sits at the bottom of the panel, which is where a terminal and
 * every chat client put it anyway.
 *
 * `../../log/GameLog.ts` carries why CSS rather than a measure-and-write effect.
 *
 * # Height
 *
 * The rail caps every block at 30% and floors it at its own head (`./rail.ts`),
 * which is right for a graveyard nobody is reading and wrong for the one panel on
 * the rail a player deliberately opened. An open log takes `LOG_OPEN_MAX_PERCENT`
 * of the rail instead; a closed log is a single row and keeps the block floor it
 * shares with every other zone. The panel inside scrolls, so nothing is lost at
 * either size — the rail's `overflow: hidden` clips a block that overruns, and an
 * internal scroller is what keeps that from becoming silent truncation.
 *
 * **What it takes that room from changed twice.** It used to come off the move
 * list, which sat in this rail as the one `flex: 1 1 auto` block and gave way;
 * `mtg-rgc.4` moved the list to the pod column and left the log competing with a
 * stack and two graveyards, all three floored and capped. `mtg-rgc.7` moved
 * those three out as well, so **it takes the column from the disclosure and
 * nothing else** and there is no longer anything in here for it to take room
 * from. Opening it still moves no card on the table: the rail is the mat's third
 * grid track and its width never moved.
 *
 * Nothing here touches `.mtg-log`'s own `min-height`. `.mtg-zone` floors a well at
 * 4.5rem, `./fit.ts` lifts that floor to zero on the mat lanes and `./rail.ts`
 * puts it back at 3.25rem for a rail block, and a rule of this file's own would
 * have been a fourth opinion in that argument;
 * `../../../test/play/fit.test.ts` fails on one, which is how the first draft of
 * this sheet was caught. `min-height: 0` on the *panel* is a different thing and
 * is load-bearing: a flex item defaults to `min-height: auto`, which refuses to
 * shrink below its content, and without it the scroller never engages.
 */
import { cssNumber } from '../number';
import { PLAY } from './geometry';

/**
 * How much of the rail an opened log may take.
 *
 * It was 40, and the number was the move list's: at 55% the log came out 404.5px
 * of a 735.5px rail at 1440x900 and left the list 175px, at 40% it was 294.2px
 * and the list kept 285px, and the list had nowhere else to go. **It has
 * somewhere else to go now** — `mtg-rgc.4` moved it to the pod column — so the
 * only blocks left in this rail were the stack and the two graveyards, each of
 * which is floored at its own head and capped at 30% by `./rail.ts` and neither
 * of which wants a pixel more than that.
 *
 * So the cap comes off and the log takes the leftover, which is what "the log
 * takes the right rail" means arithmetically. Measured after the move in
 * chrome-headless-shell 151.0.7922.47 over an 89-line log, before and after, at
 * the three viewports `packages/ui/tools/rail-split.ts` writes pages for: the
 * block goes 200.8px to 589.3px at 1440x900, 167.5px to 489.3px at 1280x800 and
 * 156.8px to 457.3px at 1024x768, and the lines a reader can actually see go 3 to
 * 10, 2 to 8 and 2 to 7.
 *
 * It stays `flex: 1 1 auto` rather than `height: 100%` even now that `mtg-rgc.7`
 * has left it alone in the column, because what it is against is the disclosure
 * above it, which is `flex: none` and must stay reachable: a log claiming the
 * whole column outright would take the way back out of the collapsed state with
 * it.
 */
const LOG_OPEN_MAX_PERCENT = 100;

/**
 * The tallest the panel grows off the played table, where no rail caps it.
 *
 * It used to be unreachable on the play route, because the rail's share bound
 * first at all three measured viewports (238.3px against this 352px). With the
 * move list out of the rail the share is larger than this at every viewport
 * measured, so the play route lifts it outright at the bottom of this sheet:
 * a 352px panel in a 440px block would be dead space inside a block that had
 * just been given the room. It stays here for the surface that renders the log
 * without a rail at all, which is the case it was written for.
 */
const LOG_PANEL_MAX_REM = 22;

export const LOG_CSS = `
.mtg-log__panel {
  display: flex; flex-direction: column-reverse;
  flex: 1 1 auto; min-height: 0; max-height: ${cssNumber(LOG_PANEL_MAX_REM)}rem; overflow-y: auto;
}
.mtg-log__panel:focus-visible { outline: 2px solid var(--mtg-accent); outline-offset: 1px; }
.mtg-log__turns, .mtg-log__steps, .mtg-log__lines {
  display: flex; flex-direction: column;
  margin: 0; padding: 0; list-style: none;
}
.mtg-log__turns { gap: var(--mtg-space-3); }
.mtg-log__steps { gap: var(--mtg-space-2); }
.mtg-log__lines { gap: 1px; }
/* The turn number and its owner on one baseline, in the micro-label the rail
   already speaks. Not a second uppercase rule: the size, weight and tracking are
   the ones .mtg-zone__label sets, restated here because a heading element brings
   the user agent's own and has to be told otherwise. */
.mtg-log__turn-title {
  display: flex; align-items: baseline; gap: var(--mtg-space-2);
  margin: 0; padding-bottom: 1px;
  font-size: var(--mtg-text-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--mtg-ink-muted); border-bottom: 1px solid var(--mtg-line);
}
.mtg-log__turn-owner { color: var(--mtg-ink-faint); font-weight: 400; }
.mtg-log__step-title {
  margin: 0; font-size: var(--mtg-text-xs); font-weight: 400; color: var(--mtg-ink-faint);
}
.mtg-log__step { display: flex; flex-direction: column; gap: 1px; }
.mtg-log__line { display: flex; align-items: baseline; gap: var(--mtg-space-2); min-width: 0; }
.mtg-log__num {
  flex: none; font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint);
}
.mtg-log__text { font-size: var(--mtg-text-sm); min-width: 0; }
/* The tiers a reader turned on read as the second and third things on the list
   they share, so the game is still findable inside them. One step of ink each,
   in the order ../../log/group.ts puts them in: the rules' own bookkeeping is
   muted and the priority round, which is two thirds of a real game's stream, is
   fainter still. */
.mtg-log__line[data-role='detail'] .mtg-log__text { color: var(--mtg-ink-muted); }
.mtg-log__line[data-role='priority'] .mtg-log__text { color: var(--mtg-ink-faint); }
.mtg-log__foot { display: flex; align-items: center; gap: var(--mtg-space-2); flex: none; }
/* Three levels on a 17rem rail: the buttons take the room they need and the
   count that follows them takes what is left rather than wrapping the group.
   Whether three fit where two did is a geometric claim, so it was measured in
   chrome-headless-shell 151.0.7922.47 over a real opened log at 1440x900,
   1280x800 and 1024x768: rail 256px, foot 230px, scrollWidth equal to
   clientWidth, all three buttons on one row (45 + 48 + 77 plus the gaps) and the
   count beside them, page overflow 0 at all three. 26px of slack, which is where
   a fourth level or a longer word would go and would have to be measured again. */
.mtg-log__levels { display: flex; gap: 1px; flex: none; }
.mtg-log__density { font-size: var(--mtg-text-xs); padding: 1px var(--mtg-space-2); }
.mtg-log__hidden { font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); }
${PLAY} .mtg-board__rail > .mtg-log[data-open='true'] {
  flex: 1 1 auto; max-height: ${cssNumber(LOG_OPEN_MAX_PERCENT)}%;
}
/* The block's own share is the cap on this route; LOG_PANEL_MAX_REM says why the
   panel's is lifted rather than raised to some larger number. */
${PLAY} .mtg-board__rail > .mtg-log > .mtg-log__panel { max-height: none; }
`;
