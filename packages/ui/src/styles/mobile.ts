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
import { FLYOUT_MAX_PERCENT } from './board/ask-flyout';
import { SHORT_COMMAND_FACE_MIN_REM } from './board/command';
import { PLAY, SHORT_VIEWPORT_MAX_HEIGHT_REM, SHORT_VIEWPORT_QUERY, TABLE } from './board/geometry';
import { SHORT_TABLE_SPELLS_MIN_REM } from './board/fit';
import { COMBAT_HAND_FACE_MAX_REM, CROWDED_HAND_FACE_MAX_REM } from './board/hand';
import { SHORT_TABLE_LAND_TILE_REM } from './board/lands';
import { TRANSPORT_CLASS } from './replay';
import { RAIL_WIDTH_VAR, SHORT_TABLE_ASK_SHUT_REM, SHORT_TABLE_RAIL_SHUT_PX } from './board/rail';
import { ZOOM_FACE_WIDTH_REM } from './card';
import { TOUCH_TARGET_PX, WCAG_TARGET_PX } from './touch';

export const PHONE_MAX_REM = 40;

/**
 * The most of a seat's well the mana base may take, side by side, as a percent.
 *
 * `mtg-aqxi.6`. The band is `flex: 0 1 auto`, so at every ordinary board size it
 * asks for exactly the width its tiles need and this number decides nothing:
 * measured at 844x390 with six lands a side, two of them tapped, it asks for
 * 373px of a 724px well, and the three creatures beside it take the other 347.
 *
 * The cap is what happens past that. A seat with a dozen lands out keeps asking,
 * and because the row beside it is the child carrying `flex-shrink`, the
 * permanents you are deciding with are what would pay for the mana base. Over
 * the cap the band scrolls inside itself instead, which is what it already did
 * on the height axis.
 *
 * Not half. Half reads fairest and is the number that bites first: this very
 * position, six lands and three creatures, is over it by 11px, so the cap would
 * have fired on a board nobody would call crowded — and fired by clipping the
 * sixth land, because a `max-width` that cuts a flex line does not hand it a
 * scrollbar. The row's own share is defended by its slot floor
 * (`./board/fit.ts`'s `MIN_SLOT_WIDTH_REM`) rather than by this number, which is
 * what lets this one be the backstop it is named for.
 */
export const SHORT_TABLE_BAND_MAX_SHARE = 60;

/**
 * How much of the step bar's row the turn may take on a phone (`mtg-rgc.13`,
 * mtg-lab issue 186).
 *
 * It was 3.5rem, which left the label 28px of the 70 that `Turn 12: You` wants,
 * so an upright phone drew `Tu…` at every turn. The cap was that small because
 * the head and the steps sat side by side: the steps wrapped inside a box of
 * their own, so every pixel the head took came off every wrapped line, and a
 * little more head cost a whole line of steps.
 *
 * On a phone tall enough that the steps wrap, the block under the phone block
 * now dissolves the steps' box, so the head is the first item of the one
 * wrapping row and takes its width off line one alone. Measured in
 * chrome-headless-shell as a coarse-pointer phone over
 * `../../test/play/phone-turn-label.browser.test.ts`'s page at turn 12, bar
 * height in px with the seat named `You`, then `Opponent`:
 *
 *   viewport   3.5rem, beside   8.5rem, beside   8.5rem, wrapping (this)
 *   360x780    136 / 136        182 / 182        136 / 136
 *   375x667    136 / 136        136 / 182        136 / 136
 *   390x844    136 / 136        136 / 182        136 / 136
 *   430x932    136 / 136        136 / 136        136 / 136
 *
 * A 182px bar is 23px off the opponent's battlefield (265 to 242). Wrapping,
 * every cap from 3.5rem to 12rem measured the same 136, and a fine pointer in a
 * window this narrow agreed (105.8 at 390x844, 131.8 at 360x780, against
 * 141.8 for 4rem beside the steps) — so the cap no longer prices a line, and
 * the head can take the width of its words. 8.5rem is 136px, which clears
 * `Turn 12: Opponent` (133.9px, the app's own longest ordinary turn text and
 * the line `./views.ts`'s desktop cap is fitted to). A longer seat name loses
 * its tail to the ellipsis, never the number: `Turn 100:` is 48.8px.
 *
 * On a short phone (375x553, 320x568) the steps are a sideways scroller rather
 * than a wrapping row, so the head's width comes off the scroller's view of the
 * steps and the bar stays one 30.6px line whatever the cap.
 *
 * The head is not hidden here instead, which would be the cheaper rule and is
 * the wrong one: the disclosure on it is the only way to reach the auto-pass
 * settings now that the strip above the table is gone, so hiding it on a phone
 * would take the setting away rather than shorten it.
 */
export const PHONE_HEAD_MAX_REM = 8.5;

/**
 * The height the bottom navigation reserves at the foot of a phone screen,
 * before the safe-area inset under it.
 *
 * `./touch.ts` puts a 44px floor on `.mtg-modes__item` and the bar is that plus
 * its own two-pixel frame, so this is a measurement of the control rather than a
 * number chosen to look right. `../../test/lab/bottom-nav.browser.test.ts`
 * measures the rendered bar against it in a real Chrome.
 */
export const BOTTOM_NAV_REM = 3;

/**
 * What the page has to leave clear at its foot. A string rather than a custom
 * property: `./tokens.ts` owns the `--mtg-` vocabulary and every name in it is
 * a design token, and this is a layout measurement with two uses in one media
 * block.
 */
const BOTTOM_NAV_SPACE = `calc(${String(BOTTOM_NAV_REM)}rem + env(safe-area-inset-bottom))`;

const SHORT_COMMAND_FACE_HEIGHT = `calc(${cssNumber(SHORT_COMMAND_FACE_MIN_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)})`;

const TALL_VIEWPORT_QUERY = `(min-height: ${cssNumber(SHORT_VIEWPORT_MAX_HEIGHT_REM + 1 / 16)}rem)`;

const SHORT_RAIL_TABLE_QUERY = `${SHORT_VIEWPORT_QUERY} and (min-width: ${cssNumber(PHONE_MAX_REM + 1 / 16)}rem)`;

const SHORT_TABLE_STEPS_AND_HAND_REM = 8.25;

const SHORT_TABLE_FLYOUT_MAX_PERCENT = 60;

export const MOBILE_CSS = `
@media (max-width: ${String(PHONE_MAX_REM)}rem) {
  /* The five destinations move to the bottom of the screen (\`mtg-tewc.3\`).

     One nav, moved rather than duplicated: the same \`.mtg-modes\` element the
     desktop bar draws, re-laid-out here. A second bottom bar in the markup would
     be a second tab row in the accessibility tree and two lists to keep in step,
     and the standing instruction on this lane is that the two breakpoints do not
     get different information architecture.

     Bottom because of where a thumb is. The top of a 844px-tall phone held in
     one hand is the part of the screen a thumb does not reach, and the tab row
     is the control a person uses most and reaches for without looking.

     Every rule that hides the whole bar still hides this: the nav is inside
     \`.mtg-shell__bar\`, so \`display: none\` on the bar takes its fixed child
     with it. That is what keeps a board and a draft screen free of it, which is
     the measured requirement this repository already holds — "I want the table
     to basically take up the full landscape screen". */
  .mtg-modes {
    position: fixed; inset-inline: 0; bottom: 0; z-index: 3;
    display: flex; justify-content: space-between; gap: 0;
    padding: 0; padding-block-end: env(safe-area-inset-bottom);
    padding-inline-start: env(safe-area-inset-left);
    padding-inline-end: env(safe-area-inset-right);
    border-radius: 0; border-top: 1px solid var(--mtg-line);
    background: var(--mtg-surface-rail);
  }
  /* Seven equal columns, and a label small enough to sit inside one.

     \`mtg-dcxg.6\`, 2026-08-23. The columns were already equal — \`flex: 1 1 0\`
     hands each of the seven 55.71px of a 390px screen — but the label was still
     the desktop's \`--mtg-text-sm\`, 13px, and at 13px *Analysis* measures
     53.63px against the 47.71px its column has left after \`--mtg-space-1\` on
     each side. A word wider than its own content box does not wrap and does not
     clip; it bleeds outward, which is why the row read as one continuous strip
     of touching words and why *Design*, the last of them, ended 6.64px from the
     right edge of the glass with nothing between it and the bezel.

     \`--mtg-text-xs\` is 11px, and it is the fix rather than a tweak: *Analysis*
     comes to 45.38px, which clears the column's 47.71px, and *Design* ends
     9.91px in. Every one of the seven now sits inside the box it is drawn in,
     which is what \`../../test/lab/bottom-nav.browser.test.ts\` reads. 11px is
     also what a bottom tab bar's label is on the platforms this imitates; it is
     the smallest type in the app and it is a one-word noun read at a glance, not
     prose.

     Two other fixes were available and both cost more than this one.

     A scrollable strip — \`overflow-x: auto\` with the current tab scrolled into
     view — keeps 13px and fits any label. It also hides destinations: at 55.71px
     a column and 390px of screen, two of the seven would be off the edge at all
     times, and the tab row is the one control on a phone that must say where
     everything is without being operated first. It would also need script to
     keep the selected tab visible, which is a second thing to keep in step with
     the router for a problem that is 2px of type.

     Shorter labels — *Sets* for *Analysis* — fit at 13px and were refused
     because the labels are the route names. \`MODE_LABELS\` feeds the bar at both
     breakpoints, the accessible name of every tab, and the \`aria-label\` on the
     mark; renaming a route so it fits a 390px viewport makes the 1440px window
     worse and makes the spoken name of the tab a different word from the page it
     opens.

     Nothing clips here on purpose. \`overflow: hidden\` on the item would hide
     the next label that outgrows its column instead of showing it overflowing,
     and a silently truncated tab is harder to find than an ugly one — the test
     is the guard, not the clip. */
  .mtg-modes__item {
    flex: 1 1 0; min-width: 0;
    display: flex; align-items: center; justify-content: center;
    border-radius: 0; padding-inline: var(--mtg-space-1);
    font-size: var(--mtg-text-xs);
  }
  /* The pressed key reads as a lit tab here rather than as a raised one: a
     shadow under a control sitting on the edge of the glass has nothing to cast
     onto, and the desktop's \`--mtg-shadow-raised\` drew a gray smear. */
  .mtg-modes__item[aria-current='page'] {
    box-shadow: inset 0 2px 0 0 var(--mtg-accent);
  }
  /* And the page ends above it rather than under it. */
  .mtg-shell__main { padding-block-end: ${BOTTOM_NAV_SPACE}; }
  /* The section row stays at the top, where the bar is, and takes the whole
     width: on a 390px screen four sections at desktop padding overflow, and
     equal columns are what the bottom bar already does for the modes. */
  .mtg-subs { padding-inline: var(--mtg-space-2); gap: 0; }
  .mtg-subs__item {
    flex: 1 1 0; min-width: 0; text-align: center;
    padding-inline: var(--mtg-space-1); font-size: var(--mtg-text-xs);
  }
  /* The reflow itself is scoped to \`TABLE\` rather than to \`PLAY\`, which is
     where \`mtg-dcxg.1\` found it.

     Every rule from here to the phase bar answers one question — what a board
     laid out as three fixed tracks does on a 390px screen — and the answer has
     nothing to do with whether anybody is taking a turn on it. \`PLAY\` is play
     and draft; the replay viewer is the third route on \`./board/geometry.ts\`'s
     \`FITTED_MODES\` and it kept the desktop tracks. Measured at 390x844 in
     chrome-headless-shell over \`../../test/replay/support/log-fixture.ts\` at
     seq 0: \`grid-template-columns\` read \`88px 0px 272px\`. The pods had 88, the
     rail took 272 and ran 7px past the right edge of the screen, and the lanes —
     both battlefields, both hands, every card in the game being watched — were a
     column zero pixels wide whose children painted over the two beside it.

     So the split is by what the rule is about. The one-column reflow, the
     scroller the main region takes over, and the prompt that grows with its
     content are about a fitted board on a phone; the far seat's face-down track,
     the phase bar and the priority buttons are about playing, and stay where
     they were. \`./replay-mobile.ts\` carries what is left over that is
     the replay's own, and carries it in a later sheet so it can re-answer these
     rules rather than tie with them. */
  .mtg-shell${TABLE} { overflow: hidden; }
  .mtg-shell${TABLE} .mtg-shell__bar {
    min-width: 0;
    padding-block-start: max(var(--mtg-space-3), env(safe-area-inset-top));
    padding-inline-start: max(var(--mtg-space-3), env(safe-area-inset-left));
    padding-inline-end: max(var(--mtg-space-3), env(safe-area-inset-right));
  }
  .mtg-shell${TABLE} .mtg-modes {
    max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain;
  }
  .mtg-shell${TABLE}:has(.mtg-board) > .mtg-subs,
  .mtg-shell${TABLE}:has(.mtg-screen) > .mtg-subs { display: none; }
  ${TABLE} .mtg-shell__main {
    position: relative;
    overflow-x: hidden; overflow-y: auto;
    padding-inline-start: max(var(--mtg-space-1), env(safe-area-inset-left));
    padding-inline-end: max(var(--mtg-space-1), env(safe-area-inset-right));
    padding-block-end: ${BOTTOM_NAV_SPACE};
  }
  ${PLAY} .mtg-play, ${PLAY} .mtg-play__table { flex: none; min-height: auto; }
  ${TABLE} .mtg-board {
    flex: none; height: auto; min-height: 0; width: 100%;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto auto;
    align-items: stretch; overflow: visible;
  }
  ${TABLE} .mtg-board__pods,
  ${TABLE} .mtg-board__lanes,
  ${TABLE} .mtg-board__rail { width: 100%; min-width: 0; }
  ${TABLE} .mtg-board__pods {
    min-height: 16rem; max-height: none;
  }
  /* The desktop rail clips a bounded prompt and scrolls its move list. On a
     one-column phone the main region owns that axis, so the prompt grows with
     its choices instead of asking for a second vertical gesture inside it. */
  ${TABLE} .mtg-board__pods > .mtg-prompt {
    flex: none; min-height: 0; overflow: visible;
  }
  ${TABLE} .mtg-board__pods > .mtg-prompt .mtg-panel__body {
    flex: none; min-height: 0; overflow-y: visible;
    scrollbar-width: auto; background: none;
  }
  ${PLAY} .mtg-board__lanes { min-height: 46rem; }
  ${TABLE} .mtg-board__side { min-height: 0; }
  /* A portrait-phone hand is a labeled thumbnail rail by decision, not a
     full-size card row that happened to lose a sizing contest. Seven 100px
     faces cannot fit a 390px viewport; the fixed zoom is the reading surface,
     and the rail stays at the 48px slot floor at every width in this tier. */
  ${TABLE} .mtg-board { --hand-face-cap: ${cssNumber(CROWDED_HAND_FACE_MAX_REM)}rem; }
  ${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] {
    position: relative;
  }
  ${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__head {
    display: flex;
    position: absolute; inset-block-start: 0; inset-inline-start: var(--mtg-space-2);
    translate: 0 -50%; z-index: 1;
    padding-inline: var(--mtg-space-1);
    background: var(--mtg-surface-rail);
    font-size: var(--mtg-text-xs);
  }
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
  ${TABLE} .mtg-board__rail {
    min-height: 28rem; max-height: none; overflow: visible;
  }
  ${TABLE} .mtg-board__rail > .mtg-zone { max-height: none; }
  ${TABLE} .mtg-zoom {
    inset-inline-start: max(var(--mtg-space-3), env(safe-area-inset-left));
    inset-inline-end: max(var(--mtg-space-3), env(safe-area-inset-right));
    max-width: calc(100vw - max(var(--mtg-space-3), env(safe-area-inset-left)) - max(var(--mtg-space-3), env(safe-area-inset-right)));
  }
}
/* The turn wraps with the steps rather than beside them (mtg-lab issue 186).

   \`display: contents\` on the steps makes the head, the thirteen nodes and
   the bar's two controls one flex row, so the head's width comes off the
   first line only; the gap is the steps' own, so the lines stack exactly as
   they did inside their box. The steps element carries no role, so dissolving
   its box removes nothing from the accessibility tree. A short phone keeps the
   steps' box, because there it is the sideways scroller. \`PHONE_HEAD_MAX_REM\`
   carries the measurements. */
@media (max-width: ${String(PHONE_MAX_REM)}rem) and ${TALL_VIEWPORT_QUERY} {
  ${PLAY} .mtg-phasebar { flex-wrap: wrap; gap: 0.125rem; }
  ${PLAY} .mtg-phasebar__steps { display: contents; }
}
@media (max-width: ${String(PHONE_MAX_REM)}rem) and (pointer: coarse) {
  ${PLAY} .mtg-phasebar__node { flex: 0 0 44px; min-width: 44px; }
  ${PLAY} .mtg-phasebar__beats,
  ${PLAY} .mtg-phasebar__pace { min-width: 44px; min-height: 44px; justify-content: center; }
  ${PLAY} .mtg-priority .mtg-btn { min-height: 44px; }
}
@media (max-width: ${String(PHONE_MAX_REM)}rem) and ${SHORT_VIEWPORT_QUERY} {
  ${PLAY} .mtg-board__lanes { min-height: 0; }
}
@media not all and (max-width: ${String(PHONE_MAX_REM)}rem) {
  .mtg-shell {
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
}

@media ${SHORT_VIEWPORT_QUERY} {
  /* The bar keeps the two controls and drops the two labels, on every route.

     \`mtg-aqxi.11\`. Measured at 844x390 with four sets staged, on a route with
     no board: the bar is 100.38px of a 390px screen. It does not wrap — nothing
     tells it to above 720px — so that height is the set name and the subtitle
     breaking onto three lines each inside a flex item the mode switch and the
     picker have squeezed to nothing. What the 100px buys is the phrase
     "Magic 2011 (reduced)" and the phrase "2,700 games analyzed", one of which
     the picker beside it already draws.

     So the mark and the aside go to the readers and the bar stands at the
     height of the tallest control in it. Spoken and not drawn, the way
     \`.mtg-page-title\` above is and for the same reason: neither is focusable,
     so hiding them outright would cost the accessibility tree two facts and buy
     nothing back.

     What stays is the mode switch and the set picker, which is the answer to
     the second half of what the playtester asked for here — a phone in landscape on
     any route that is not a board or a pack can still see which set it is
     showing and choose another one. \`../app/SetPicker.ts\` is that control; it
     draws a \`<select>\` as soon as the launcher has staged more than one set,
     and the reason it is in the bar at all is that every tab reads the staged
     set.

     Amended for \`mtg-aqxi.17\`: the mark stays. It used to be the set's name,
     which is what the paragraph above is measuring and what the picker beside it
     already draws; it is now the word \`MTG Lab\` and a link to Play. It used to
     carry a subtitle and the bar used to carry a statistic beside it, and both
     were taken off every viewport rather than hidden on this one — a header that
     says \`PLAY, ANALYZE, REPLAY\` and \`XMP · 2,700 games analyzed\` is a header
     describing the application to somebody already inside it. The row is
     therefore two controls and a mark on a phone the same way it is on a desk.
     A control cannot be spoken-and-not-drawn — that is the focus-visible defect
     WCAG 2.4.7 names — so nothing here hides one. */
  /* The row is padded like a strip rather than like a page header, which is
     the same trade \`./base.ts\` already makes on the play route and
     \`./panel.ts\` makes on a screen. 12px above and below a 48px control is 24
     of a 390px viewport spent on air; 4px is 8. Measured: 100.38 -> 73 from the
     two labels, 73 -> 57 from this. */
  .mtg-shell__bar { padding-block: var(--mtg-space-1); }
  /* And the picker is a finger-sized target rather than a 30px one.

     \`./touch.ts\`'s \`COARSE_TARGETS\` floors the controls a table draws and
     this control is not one of them, so it kept the desktop select's 30px on a
     phone — under both floors, on the one control that changes what every tab
     is showing. Height only: the width is whatever the bar has left after the
     mode switch, and a 105px select holding a 60-character option label is a
     truncated label rather than a missed tap. */
  .mtg-setpick__select { min-block-size: ${String(TOUCH_TARGET_PX)}px; }
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
     about the hand row, and it is the same defect here.

     The bar's own two controls are inside this scroller now (\`mtg-t9n7\`), and
     that is why \`./views.ts\` pins them with \`position: sticky; right: 0\`
     over an opaque field. Beside the row they were \`flex: none\` against a
     \`flex: 1 1 0\` steps row, so on every tier that wraps they took their width
     off each wrapped line rather than off one, and the 32px of table that cost
     at 1024x768 is what four browser gates measured. Inside the row they cost a
     wrapping tier nothing and cost this one a pin: the steps pass under the two
     controls rather than around them, so the tail of the last step is behind
     them until the row is scrolled its own overflow — 8.4px of CLEANUP at
     1440x560, measured. That is the price of keeping a bar-level control where
     it was on every table, and it is smaller than the one the other
     arrangement charged. */
  ${TABLE} .mtg-phasebar__steps {
    flex-wrap: nowrap;
    overscroll-behavior-inline: contain;
  }
  ${TABLE} .mtg-phasebar__node { flex: 0 0 auto; }
  /* And the bar stands at the height its content asks for, not at a finger's.

     \`mtg-aqxi.8\`, and it is the playtester's sentence from a phone: the phase bar can
     be a lot thinner, it shouldn't take up so much space. Measured at 844x390 it
     was 44px tall and so was every one of its thirteen nodes, which is
     \`../touch.ts\`'s coarse-pointer floor exactly — the content wants 33.9. The
     bar sits between the two battlefields, so those ten pixels are ten pixels of
     board.

     \`WCAG_TARGET_PX\` and not zero: this is a lowering of a floor to the
     conformance minimum (2.5.8, 24px) rather than the removal of one. The 44 it
     replaces is Apple's HIG, which is a good default and not a requirement, and
     the step bar is level-2 information under the brief's hierarchy — you read
     it every turn and press it rarely, and the press it takes is setting a stop,
     which is undoable by pressing again. Nothing else on the table gives up its
     44.

     The name line is tightened with it, because the node is three lines and the
     middle one is the only one carrying type: at the sheet's default leading a
     12px word occupies about 18px, and the two pip rows either side of it are 8
     apiece. That is where the last few pixels are, and 1.15 keeps the descenders
     of a word like \`UPKEEP\` inside the box.

     **The turn badge is in the list because it is the thing that was pinning
     the bar**, which the first version of this rule got wrong: the nodes were
     lowered, the bar stayed at 44, and the nodes went on measuring 44 because a
     flex row is as tall as its tallest child and \`align-items: stretch\` hands
     that height back down. The tallest child is the turn disclosure at the
     left-hand end, floored to 44 by \`../touch.ts\` over 19px of content. A bar
     is one control strip; either the whole strip stands at the conformance
     minimum here or none of it does. */
  ${TABLE} .mtg-phasebar__node,
  ${TABLE} .mtg-phasebar__beats,
  ${TABLE} .mtg-phasebar__pace,
  ${TABLE} .mtg-phasebar > .mtg-turnstops .mtg-turnstops__head,
  ${TABLE} .mtg-phasebar > .mtg-badge { min-height: ${String(WCAG_TARGET_PX)}px; }
  ${TABLE} .mtg-phasebar__name { line-height: 1.15; }
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
  ${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] > .mtg-zone__head {
    display: flex;
    position: absolute; inset-block-start: 0; inset-inline-start: var(--mtg-space-2);
    translate: 0 -50%; z-index: 1;
    padding-inline: var(--mtg-space-1);
    background: var(--mtg-surface-rail);
    font-size: var(--mtg-text-xs);
  }
  ${TABLE} .mtg-board__side[data-seat='you'] > .mtg-zone[data-tone='rail'] { position: relative; }
  /* A crowded phone takes the narrower of the two approved thumbnail modes:
     48px for crowding rather than combat's 56px. The row publishes crowding
     from represented permanents before exact-state copies collapse, so neither
     a pile nor an attachment can make this decision disappear from the DOM. */
  ${TABLE} .mtg-board:has(.mtg-board__spells[data-crowded='true']) {
    --hand-face-cap: ${cssNumber(CROWDED_HAND_FACE_MAX_REM)}rem;
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
     navigating by headings still finds the route it is on.

     \`[data-live]\` is the exception the argument above names without meaning to:
     all of it turns on the title being the word over a tab that is on screen
     saying it already. The replay caption wears the same class and is the frame
     you are looking at — \`Turn 7 · main 1 · Wield the Obliterator\`, different
     every step and on no tab anywhere. Hidden, its band drew the note alone, and
     an opening frame's note is an em dash: measured at 844x390, 19px of table
     spent on one character. Marked at the element
     (\`../routes/replay/ReplayViewer.ts\`) rather than scoped to the replay mode
     here, because what earns the exception is what the text *is*, not which
     route drew it. */
  ${TABLE} .mtg-page-title:not([data-live='true']) { ${SPOKEN_NOT_DRAWN} }
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
     the game going again.

     And the replay transport is exempt by name (\`mtg-aqxi.18\`). \`TABLE\` is
     play, draft *and* replay, and on replay the toolbar is not chrome around the
     game — it is First, Prev, Play, Next, Last and the two selects, the whole of
     how a watcher moves through one. Taking it left a landscape phone holding a
     replay it could not advance. \`./replay.ts\` owns the class and the
     argument; the head band above it still goes.

     And \`mtg-aqxi.17\` stops at the edge of this rule rather than crossing it.
     That lane put the mark and the set picker back into a band two other tiers
     had emptied — \`./base.ts\`'s \`barCollapsedToMark\`, which
     \`./panel.ts\` interpolates over a draft screen — because the playtester asked
     for both by name. A board is the one surface where it does not follow: the
     sentence that produced this rule is "I want the table to basically take up
     the full landscape screen", and it is measured, at 95% of the viewport in
     \`../../test/play/landscape-phone.browser.test.ts\`. A 45px band on a
     390px screen is 11.5% of it, spent on a picker nobody uses mid-game and a
     way out of a game in progress. Turning the phone is still that way out, and
     on a table it is the only one.

     The section row goes with the bar. \`mtg-a982g.1\` put a second band under
     it, and the phone-width block above takes that band out beside a board at
     40rem and under; a landscape phone is 844px wide, so the only block it
     reaches is this one, and the row stayed in the drawing at 29.84px while
     the bar above it went. \`../../../slice/test/ui-phone-scroll.browser.test.ts\`
     lists everything drawn above the mat at 844x390 and expects nothing. */
  .mtg-shell${TABLE}:has(.mtg-board) > .mtg-shell__bar,
  .mtg-shell${TABLE}:has(.mtg-board) > .mtg-subs,
  .mtg-shell${TABLE}:has(.mtg-board) > .mtg-shell__notice,
  ${TABLE} .mtg-shell__main:has(.mtg-board) .mtg-page-note,
  ${TABLE} .mtg-shell__main:has(.mtg-board) .mtg-toolbar:not(.${TRANSPORT_CLASS}) {
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
  /* The crowded-lane padding \`./board/lands.ts\` drops is not this row's
     rule: here the band sits *beside* the spells row (\`flex-direction: row\`
     below) and stretches to the row's own height, so its own 2px of
     block padding costs it nothing the row needed back. Restated at the
     same selector as \`./board/lands.ts\`'s crowded rule, so this wins on
     order rather than on weight. */
  ${TABLE} .mtg-zone__body[data-layout='board']:has(> .mtg-board__spells[data-crowded='true']) > .mtg-lands {
    padding-block: 2px;
  }

  /* And the mana base moves *beside* the cards in play, not under them.

     \`mtg-aqxi.6\`, and it is the whole of what a landscape phone has that a
     laptop does not: width. Measured at 844x390 on the stated dense position,
     each seat's well was 738 x 106.4 and spent 40 of that height on a row of
     land tiles, leaving the spells row 48px — a 27.5 x 38.4 card, against the
     56 x 78.2 card the same screen drew in that player's hand. The row those
     cards sat in was 728px wide and they spanned 290 of it. So the seat was
     paying in the axis it had none of for something the axis beside it was
     throwing away, and the playtester's report of it was that the board was empty
     and the cards were unreadable, which are the same sentence.

     Side by side the whole of the well's inside height reaches both children:
     the row goes 48 to about 96 and its face roughly doubles on each axis, and
     the band keeps the stated tile it already had, vertically centered instead of
     stacked. Both children keep their own inline scroller, so a crowded seat
     spends width rather than pushing anything off the well.

     The band is \`flex: 0 1 auto\` against the row's \`1 1 auto\`: it asks for the
     width its tiles need and never more, every spare pixel in the well goes to
     the cards you are deciding with, and when the two together do not fit the
     band is the child that gives. The cap is the backstop for that last case —
     a mana base wide enough to reach it scrolls inside itself rather than
     pushing the permanents off the well. Measured at 844x390 with six lands a
     side, two of them tapped: the band asks for 373px of the well's 724 and the
     cap, at 434, does not bind. At half it would have — by 11px, clipping the
     sixth land rather than scrolling to it, which is why the number is not the
     one that reads fairest.

     The sticky bottom this replaces belonged to the column: it glued the band to
     the foot of the scrollport at the sizes where the lane was a few px short,
     so the overflow cost a card's bottom edge rather than the whole mana base
     (the playtester, 2026-08-22, "I'm still not seeing lands once I play them"). Off
     the height axis the band cannot be the thing that goes under the fold, so
     the rule that decided which child paid has nothing left to decide.

     The row's floor stays: \`./board/fit.ts\`'s \`SHORT_TABLE_SPELLS_MIN_REM\` is
     what keeps the row the child that gives on the *height* axis, which is still
     how the well and the lane above it settle.

     Restated at the same specificity as the declarations one file over, so this
     wins on order rather than on weight. */
  ${TABLE} .mtg-board__spells { min-height: ${cssNumber(SHORT_TABLE_SPELLS_MIN_REM)}rem; }
  ${TABLE} .mtg-zone__body[data-layout='board'] {
    flex-direction: row; align-items: stretch; gap: var(--mtg-space-2);
  }
  ${TABLE} .mtg-zone__body[data-layout='board'] > .mtg-board__spells {
    flex: 1 1 auto; min-width: 0;
  }
  ${TABLE} .mtg-zone__body[data-layout='board'] > .mtg-lands {
    position: static; flex: 0 1 auto; min-width: 0; max-width: ${cssNumber(SHORT_TABLE_BAND_MAX_SHARE)}%;
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

     **The dot between them comes off here, and \`flex-wrap\` goes back to
     \`nowrap\`.** \`./board/status.ts\` draws the pair as one centered sentence
     with a middle dot between the chips, which is the right drawing where the
     column is 176px wide; at 97px "hand 7 \u00B7 library 52" wants more row than
     there is and wraps, and the pod went 15.59px to 45.05 and took the whole
     column 35px past its scroller with it. Justified to the two ends of the pod
     the gap between them is the separator, so the dot is a third thing competing
     for the width it was drawn to organize.

     \`.mtg-prompt__explain\` restates \`.mtg-priority\`'s sentence inside the
     panel. It does not shorten the column — the prompt is the flexible block —
     but it is 75.38px of the prompt's own scroller, which is where the moves
     are.

     \`.mtg-priority__land\` is the sentence behind the highlighted Pass
     control. On this short table the control keeps the visual warning and the
     separately named live region still announces the sentence. Drawing it as
     well costs three lines in the open column; shut, its widest word is 49px
     inside the 48px strip. In either state it takes room from the action it
     describes without adding another usable action. */
  ${TABLE} .mtg-priority__land,
  ${TABLE} .mtg-play-meta,
  ${TABLE} .mtg-board__pods .mtg-pod__tags,
  ${TABLE} .mtg-board__pods .mtg-pod__name,
  ${TABLE} .mtg-board__pods .mtg-prompt__explain { display: none; }
  ${TABLE} .mtg-board__pods .mtg-pod__chips {
    flex-flow: row nowrap; justify-content: space-between; gap: var(--mtg-space-1);
  }
  /* And the two gaps inside the row go with the one between them.

     \`./board/status.ts\` ellipsizes a chip's label so the row can shrink, which
     is the right last resort and a bad first one: an ellipsis eats three
     characters to save one, so a shortfall of a pixel costs a word. Measured on
     the replay board at 844x390, where the pod is 107px and the chips row is
     97.4: the pair wants 99.9px, is 2.5px over, and the 2.5px came out as
     \`Ha… 7\` and \`Libra… 53\` — both labels destroyed to save two and a half
     pixels of air. \`--mtg-space-2\` between the chips and 4px inside each is
     8px of gap on a row with 97 to spend; at \`--mtg-space-1\` and 2px the pair
     lays out at 87.9 and the words finish, with room for a library count that
     reaches three digits. The ellipsis stays, for the seat this does not save. */
  ${TABLE} .mtg-board__pods .mtg-pod__chip { gap: 2px; }
  ${TABLE} .mtg-board__pods .mtg-pod__chip + .mtg-pod__chip::before { content: none; }
  /* And the stack strip stops saying which end of itself you are looking at.

     \`./board/stack.ts\` draws each entry as name, controller, cost, target and
     then \`resolves next\` or \`waiting\`. Measured at 844x390 with two objects on
     the stack, that sentence wants 345px in a 214px row, and the closing word is
     68 of the 345 to repeat two things the strip already draws: the top entry
     carries the accent keyline, and it is the only entry with a Resolve button
     next to it. Off, the target keeps the room instead. */
  ${TABLE} .mtg-stack__state { display: none; }
  ${TABLE} .mtg-stack__entry { gap: var(--mtg-space-1); padding-inline: 0; }
  ${TABLE} .mtg-stack__resolve { padding-inline: 0; }
  ${TABLE} .mtg-stack__mode { min-width: var(--mtg-space-1); }
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
      calc((100dvh - 2 * var(--mtg-space-4)) * ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)})
    );
  }

  ${TABLE} .mtg-board__side[data-side-panel='true'] > .mtg-command {
    min-height: calc(${SHORT_COMMAND_FACE_HEIGHT} + 2 * var(--mtg-space-2));
  }
  ${TABLE} .mtg-command > .mtg-zone {
    min-height: calc(${SHORT_COMMAND_FACE_HEIGHT} + 2 * var(--mtg-space-2));
  }
  ${TABLE} .mtg-command .mtg-zone:not([data-empty='true']) > .mtg-zone__head {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  }
  ${TABLE} .mtg-command .mtg-zone__body { flex-direction: row; flex-wrap: wrap; align-items: center; overflow: visible; }
  ${TABLE} .mtg-command__entry { flex-direction: row; align-items: center; }
  ${TABLE} .mtg-command__ledger { align-items: flex-start; text-align: start; }
  ${TABLE} .mtg-command__casts, ${TABLE} .mtg-command__cost { white-space: normal; }
  ${TABLE} .mtg-command .mtg-slot[data-slot='hand']:not([data-empty='true']) {
    flex: none; min-width: 0; min-height: 0; aspect-ratio: auto;
    width: ${cssNumber(SHORT_COMMAND_FACE_MIN_REM)}rem;
    height: ${SHORT_COMMAND_FACE_HEIGHT};
    max-width: none; max-height: none;
  }
}
@media ${SHORT_RAIL_TABLE_QUERY} {
  ${TABLE} .mtg-ask-flyout {
    max-block-size: clamp(
      ${cssNumber(FLYOUT_MAX_PERCENT)}%,
      calc(100% - ${cssNumber(SHORT_TABLE_STEPS_AND_HAND_REM)}rem),
      ${cssNumber(SHORT_TABLE_FLYOUT_MAX_PERCENT)}%
    );
  }
}
`;
