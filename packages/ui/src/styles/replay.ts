/**
 * The replay viewer's own layout: the column above the board, and the three
 * things about this route that the played table's rules cannot be asked.
 *
 * Everything about *sizing* is deliberately not here. `mtg-ryix` is the playtester's
 * ask that "the sizing … match the play sizing view", and the load-bearing half
 * of it is where the numbers come from: `styles/board/geometry.ts`'s `TABLE`
 * puts this route under the same mat rules the played table runs on, so a card
 * face on a replay frame is the number `board/hand.ts` computed once. Anything
 * added here that stated a card size again would be the second copy that drifts.
 *
 * What is left is genuinely this route's, and each rule below is a place where
 * a replay is a different thing from a game:
 *
 *  1. The column. Three strips — the game picker, the transport, the caption —
 *     sit above the board and are `flex: none`, so the mat gets the rest of the
 *     window exactly as `.mtg-play__table` does.
 *  2. The hands. A replay draws both of them face up, because the reason to watch
 *     a bot game is to see what it was holding (`routes/replay/frame.ts`). The
 *     played table's far lane is a two-track grid with a fixed 12rem column for
 *     seven face-down chips, and that track is `PLAY`-scoped for this reason
 *     (`board/fit.ts`); here the far lane is the near lane's own shape, a column
 *     of a battlefield over a hand. Both hand rows then take a stated share of
 *     their lane and the battlefields take the rest, which is the reverse of the
 *     played table's division and is what `HAND_SHARE_PERCENT` argues.
 *  3. The rail's two panels. The played table's rail holds zones and a log; this
 *     one holds "What happened" and the turn rail, which are `.mtg-panel`s, so
 *     they need the bargain `board/rail.ts` already struck with the zones beside
 *     them: floored at a head and a row, clipped at their own edge, and scrolling
 *     inside themselves.
 */
import { HAND_ACROSS, HAND_GAP } from './board/hand';
import { cssNumber } from './number';
import { routeScope } from './tokens';

/** The scope: the replay viewer's shell and nothing else. */
const REPLAY = routeScope('replay');

/**
 * How much of a lane the hand row may take, and why the hand is the block that
 * gives way here.
 *
 * `board/hand.ts` gives the hand the biggest cards on the table and states the
 * reason: "the battlefield is a summary you scan, the hand is the thing you are
 * deciding from, so it gets the pixels" — Magic Online's own ratio, measured off
 * two captures. A replay has nobody deciding from either hand. It has *two* of
 * them, both face up (`routes/replay/frame.ts`), and that pair is the whole of
 * why this route cannot simply inherit the played table's division of a lane:
 * the far lane on a played table spends no height on a hand at all, so a replay
 * asks one column to carry two hand rows out of a board that is also 87.5px
 * shorter, because a transport and a caption sit above it.
 *
 * Measured at 1280x800 on game 0 seq 120, with the hand row left at seven
 * across: each lane came out 131.6px of battlefield against the played table's
 * 234, and a battlefield face 25.8px wide against its 82.6. Drawn at the
 * battlefield's own scale instead — `HAND_ACROSS / BOARD_TO_HAND`, which is the
 * ratio spent rather than inherited — it was still only 47.2px. The hand was
 * taking the height out of the thing being watched.
 *
 * So the hand row is given a share of the lane and the battlefield takes the
 * rest, which is the reverse of the played table's arrangement and is the
 * arrangement that makes the ask true. At this share the battlefield face
 * measures 97.5, 80.0, 68.0 and 48.0 against the played table's 99.2, 82.6,
 * 68.0 and 48.0 at the four viewports — within 2.6px at the two large ones and
 * identical at the two small ones, where both are on `board/fit.ts`'s own floor.
 *
 * `--board-face` itself is untouched: `board/hand.ts` computes it from the
 * *spells row's* own width and nothing here enters that arithmetic, so the width
 * a replay battlefield card asks for is the number the played table asks for.
 * All this does is stop the hand from eating the height it is paid out of.
 */
const HAND_SHARE_PERCENT = 28;

/**
 * The hand's own cap is still `board/hand.ts`'s, and it still binds where the
 * lane is tall and the row is narrow — 810x1080 is that viewport, where a hand
 * card is the same 48px the played table draws. Restated here only because the
 * slot is sized off its height on this route and a slot with no width cap at all
 * would draw a two-card hand as two enormous cards.
 */
const HAND_CAP = `calc((100% - ${cssNumber(HAND_ACROSS - 1)} * ${HAND_GAP}) / ${cssNumber(HAND_ACROSS)})`;

/**
 * The shortest a rail panel may be squeezed to.
 *
 * `board/rail.ts`'s own `RAIL_BLOCK_MIN_REM` is 3.25rem and is not exported;
 * this is the same measurement taken against a `.mtg-panel` rather than a
 * `.mtg-zone`, which carries a taller head — 33.9px of head plus a line of body
 * and the box's two keylines. A floor below the natural size would clip the last
 * line of a panel that had nothing to hide, which is the defect that number
 * exists to prevent one column over.
 *
 * Under the sum of the floors the rail scrolls, which is the bargain
 * `board/rail.ts` states and this file inherits rather than restates.
 */
const RAIL_PANEL_MIN_REM = 4.5;

/**
 * How much of the rail the turn index may take.
 *
 * The rail holds five blocks on this route — the stack, what happened, the turn
 * index and the two graveyards — and only one of them grows without bound: the
 * index is one row per turn and a game runs to the turn cap. Capped at a share
 * rather than floored at a height, which is the rule the rail's zones already
 * take, so a long game scrolls the index inside its own panel instead of pushing
 * the graveyards off the column.
 */
const TURN_RAIL_MAX_PERCENT = 40;

export const REPLAY_CSS = `
.mtg-replay { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
/* The three strips above the mat. Unshrinkable: which game, where in it, and
   what this frame is are the reader's whole orientation, and none of them is a
   thing whose size the game state decides — which is the property
   \`board/fit.ts\` spends four paragraphs keeping true of this column. */
${REPLAY} .mtg-replay > .mtg-toolbar,
${REPLAY} .mtg-replay > .mtg-page-head { flex: none; }
${REPLAY} .mtg-replay__table { display: flex; flex-direction: column; }

/* The far seat's hand is real cards, so its row behaves like the near one's:
   as tall as its cards and no taller, leaving the rest of the lane to the
   battlefield. \`board/hand.ts\` says the same thing about the near seat and says
   it for the near seat only, because on a played table the far hand is seven
   chips in a track beside the board. */
${REPLAY} .mtg-board__side[data-seat] > .mtg-zone[data-tone='rail'] {
  flex: none; height: ${cssNumber(HAND_SHARE_PERCENT)}%;
}
${REPLAY} .mtg-board__side[data-seat] > .mtg-zone[data-tone='rail'] > .mtg-zone__body {
  flex: 1; min-height: 0; align-items: stretch;
}
/* And the slot is sized off that height rather than off the row's width, so the
   card is the trim's shape either way and the cap below is the only thing that
   can make it narrower. \`[data-seat]\` is on the selector to outweigh
   \`board/hand.ts\`'s near-seat rules, which say the opposite for the opposite
   reason; it ties with them and wins on order, which is what \`./index.ts\`
   records about where this sheet sits. */
${REPLAY} .mtg-board__side[data-seat] .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  flex: 0 1 auto; width: auto; height: 100%; max-width: ${HAND_CAP};
}
/* And the two lanes then split the column evenly, which is a zero basis rather
   than an automatic one. \`board/fit.ts\` leaves the basis at \`auto\` because on a
   played table the two lanes hold different things — a hand row on the near one,
   a face-down track beside the far one — so the free space is shared on top of
   two different content heights. Here they hold the same two rows, and an
   automatic basis still came out 415.1px against 280.6px at 1440x900 purely
   because one seat's cards were taller: the far battlefield was a 90px well with
   a scrollbar in it while the near one had room to spare. Nobody watching a bot
   game is sitting in either seat. */
${REPLAY} .mtg-board__side { flex: 1 1 0; }

/* The rail's panels, on the terms its zones already sit there on. */
${REPLAY} .mtg-board__rail > .mtg-panel {
  display: flex; flex-direction: column;
  flex: 0 1 auto; min-height: ${cssNumber(RAIL_PANEL_MIN_REM)}rem; overflow: hidden;
}
${REPLAY} .mtg-board__rail > .mtg-panel > .mtg-panel__head {
  flex: none; padding: var(--mtg-space-1) var(--mtg-space-3);
}
${REPLAY} .mtg-board__rail > .mtg-panel > .mtg-panel__body {
  flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin;
  padding: var(--mtg-space-2) var(--mtg-space-3);
}
${REPLAY} .mtg-board__rail > .mtg-panel[aria-label='Turns'] { max-height: ${cssNumber(TURN_RAIL_MAX_PERCENT)}%; }
/* A turn row in a 272px column rather than a 390px one: the facts wrap onto as
   many lines as they need and the life bars stop demanding a 4rem track, which
   is what turned each row into six lines when this panel first moved here. */
${REPLAY} .mtg-board__rail .mtg-turn { padding: var(--mtg-space-1) 0; gap: var(--mtg-space-2); }
${REPLAY} .mtg-board__rail .mtg-turn__facts { gap: 0 var(--mtg-space-2); }
${REPLAY} .mtg-board__rail .mtg-lifebar__track { min-width: 2rem; }
`;
