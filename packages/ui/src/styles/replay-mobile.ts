/**
 * The replay viewer on a phone held upright, and the four things about it that
 * the played table's phone rules cannot be asked.
 *
 * `mtg-dcxg.1`, 2026-08-23. `./mobile.ts` now reflows any fitted board into one
 * document column at 390px and that rule's own docblock carries the reading it
 * was written from; what is left here is everything that is a replay rather
 * than a board. Each block below is a place where the desktop rule is right in
 * a 272px rail and wrong in a 358px column.
 *
 * All of it is the replay section of Analysis and portrait-phone only, so a desk is
 * untouched by construction: nothing here is a re-valuation of a number the
 * wide layout reads.
 */
import { SHORT_VIEWPORT_QUERY } from './board/geometry';
import { PHONE_MAX_REM } from './mobile';
import { cssNumber } from './number';
import { viewScope } from './tokens';

const REPLAY = viewScope('analysis', 'replay');

/**
 * The shortest a seat's half of the board may be drawn on a phone.
 *
 * `./mobile.ts` gives the played table's lanes a stated 46rem and lets the two
 * seats divide it; that number is fitted to a near seat carrying a step bar and
 * a hand of seven and a far seat carrying a track of chips, and a replay is
 * neither — it is two seats of the same shape, each a battlefield over a face-up
 * hand (`./replay.ts`). Measured at 390x844 over the fixture log at seq 120,
 * with the lanes left to their content: each side came out 111.4px, which is a
 * 48px card face and its own padding, and the hand under it was 0.
 *
 * 17rem a side, so the two together are the 34rem this route asks of a column
 * the phone scrolls anyway. At that height the battlefield row and the hand row
 * are both above `./board/fit.ts`'s floor and a card in either is drawn at the
 * same size the play route draws one.
 */
const PHONE_SIDE_MIN_REM = 17;

export const REPLAY_MOBILE_CSS = `
@media (max-width: ${String(PHONE_MAX_REM)}rem) {
  /* The column above the mat stops being a strip that must not grow. Its three
     bands are \`flex: none\` on a desk because the mat is what the window's
     height is for; here the page scrolls and the transport is the control the
     whole route is operated from. */
  ${REPLAY} .mtg-replay,
  ${REPLAY} .mtg-replay__table { flex: none; min-height: auto; }
  /* The game picker is the one control on this route whose width is a sentence
     somebody else wrote. Its label is two deck names and a turn count — "1.
     Wield the Obliterator vs The Sky Islands · 13 turns" is 47 characters — and
     a bare \`<select>\` is as wide as its widest option, so at 390px it ran off
     the right-hand edge of the screen with the end of its own name past the
     glass. Given the row instead: the label keeps its intrinsic width and the
     select takes what is left and ellipsizes, which is the shortening a select
     already does to the option it is showing. */
  ${REPLAY} .mtg-replay > .mtg-toolbar .mtg-field { flex: 1 1 100%; min-width: 0; }
  ${REPLAY} .mtg-replay > .mtg-toolbar .mtg-select { flex: 1 1 auto; min-width: 0; max-width: 100%; }
  /* Both seats are as tall as they are asked to be rather than a share of a
     lane. \`./replay.ts\` gives each hand row 28% of its side, which reads a
     definite height off the mat's height budget; in a document column the side
     has no such height, the percentage resolves to auto, and the two rows draw
     at whatever their cards happen to want. */
  ${REPLAY} .mtg-board__lanes { min-height: ${cssNumber(PHONE_SIDE_MIN_REM * 2)}rem; }
  ${REPLAY} .mtg-board__side { flex: 1 1 auto; min-height: ${cssNumber(PHONE_SIDE_MIN_REM)}rem; }
  ${REPLAY} .mtg-board__side[data-seat] > .mtg-zone[data-tone='rail'] { height: auto; }
  /* And the rail's two panels grow with what they hold. Bounded and internally
     scrolling is the bargain a 272px column beside a mat strikes, and it is the
     wrong one in a column the page already scrolls: "What happened" was 31
     events read four at a time through a 115px window, and the turn index was
     capped at 40% of a rail whose height on a phone is the sum of the things
     inside it. Two nested scrollers, one of them 40% of the other. */
  ${REPLAY} .mtg-board__rail > .mtg-panel,
  ${REPLAY} .mtg-board__rail > .mtg-panel[aria-label='Turns'] {
    flex: none; min-height: 0; max-height: none; overflow: visible;
  }
  ${REPLAY} .mtg-board__rail > .mtg-panel > .mtg-panel__body {
    flex: none; min-height: 0; max-height: none; overflow: visible;
  }
}

@media ${SHORT_VIEWPORT_QUERY} {
  ${REPLAY} .mtg-board__side[data-seat] > .mtg-zone[data-tone='rail'] { flex: none; height: auto; }
  ${REPLAY} .mtg-board__side[data-seat] .mtg-slot[data-slot='hand']:not([data-empty='true']) { height: auto; }
  ${REPLAY} .mtg-board__side { min-height: 11.5rem; }
}
`;
