/**
 * A table of more than two: the seat rail, the row of opponent tiles, and the
 * attack target picker.
 *
 * `mtg-bc2.154.6.5.4`, and the ruling under it (dec-nh7i, 2026-09-20): every
 * opponent's board is on screen at once, compressed to fit, and what a compression
 * has to give up is whatever another player's turn does not depend on. So a
 * tile's battlefield is drawn small and complete: the vitals are one line, the
 * command zone is a strip above the board rather than a column beside it, lands
 * are one overlapped line, and the poison and commander damage that would have
 * been three copies are one row each in a rail. Nothing here removes a permanent,
 * a commander or a zone.
 *
 * **A tile states its own sizes.** A permanent is `TILE_SLOT_REM` tall, a land
 * `TILE_LAND_REM`, the commander `TILE_COMMANDER_REM`, and each is set on both
 * axes: a slot whose width is automatic asks its card for a width, the card asks
 * the slot for a height, and Chromium settled that loop at 72px for a card 44px
 * wide. A tile is a third of a lane, so a lane's sizing rules, which are the
 * answer to one lane sharing a table with a hand, would each be wrong for it.
 *
 * **A tile never claims the crowded row's contract.** The lane's `data-crowded`
 * flag (eight places in a row) buys a 72px identity floor per place, a fan of
 * overlapped lines, a phone layout, and a lowered hand cap for the whole board.
 * `Battlefield`'s `tile` prop swaps it for `data-tile-crowded`, which only this
 * sheet reads, so a crowded opponent neither out-votes the tile's sizes nor
 * lowers the viewer's hand for the other three players.
 *
 * **Everything is scoped to a class this arm alone writes** (`.mtg-seat-rail`,
 * `.mtg-pod-tile`, `.mtg-board__opponents`, `.mtg-combat__target*`), so a duel's
 * sheet is untouched by construction. Where a rule reaches one declared elsewhere
 * (a slot's size, the mana band's cap) it is written against `TILE`, which is one
 * class heavier than the rule it overrides, and the sheet is last in the list so a
 * tie also goes to it.
 *
 * **The opponents' row asks for two shares of spare height** (`flex: 2 1 auto`)
 * and each tile for a basis of `TILE_BOARD_BASIS_REM`. Without a stated basis the
 * row's content-driven size (375px of wrapped permanents) took the lane's height
 * and left the viewer's own battlefield 39px against a duel's 182px. Measured over
 * `../../../test/play/pod-board.browser.test.ts`; the numbers and what they cost
 * are in that file's docblock.
 */
import { cssNumber } from '../number';
import { CARD_TRIM_MM } from '../../card/anatomy';
import { playedSlot, TABLE } from './geometry';

/**
 * The height a tile asks its battlefield and command strip for before the lane
 * shares out what it has. A basis and not a floor: a lane too short for it takes
 * the difference off the tile, and the tile's board scrolls.
 */
export const TILE_BOARD_BASIS_REM = 14;
/** How tall a permanent, and the commander, is drawn in an opponent tile. */
export const TILE_SLOT_REM = 3.25;
/** A permanent's height in a tile whose spell row is crowded. */
export const TILE_CROWDED_SLOT_REM = 2.5;
/** The commander's card in that tile's strip, a size smaller than a permanent so the strip stays a line. */
export const TILE_COMMANDER_REM = 2.75;
/** How tall a land is drawn there, against `./lands.ts`'s 3.5 for a lane. */
export const TILE_LAND_REM = 1.75;

/** The tile's scope, one class heavier than the lane rules a tile's sizes replace. */
const TILE = '.mtg-board[data-pod] .mtg-pod-tile';

/** A card's width over its height at the printed trim. */
const TRIM_RATIO = cssNumber(CARD_TRIM_MM.width / CARD_TRIM_MM.height);

export const POD_CSS = `
.mtg-seat-rail { min-width: 0; }
.mtg-seat-rail__list {
  display: flex; flex-direction: column; gap: var(--mtg-space-1);
  margin: 0; padding: 0; list-style: none;
}
.mtg-seat-rail__item {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: var(--mtg-space-1);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
}
.mtg-seat-rail__item[data-active='true'] { border-color: var(--mtg-accent); }
.mtg-seat-rail__item[data-attacked='true'] {
  border-color: var(--mtg-negative); box-shadow: 0 0 0 1px var(--mtg-negative);
}
/* A button while a spell is being aimed, and font and color are inherited for the
   reason .mtg-pod's are (../board/status.ts): a button takes none of the page's
   type from the UA sheet, and the resting row and the pressable one are the same
   block with a different element. */
.mtg-seat-rail__seat {
  display: grid; grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas: 'life name' 'life poison';
  align-items: baseline; column-gap: var(--mtg-space-2);
  min-width: 0; padding: 0; border: 0; background: none;
  font: inherit; color: inherit; text-align: start;
}
button.mtg-seat-rail__seat { cursor: pointer; }
.mtg-seat-rail__life {
  grid-area: life; align-self: center;
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xl); font-weight: 600;
  font-variant-numeric: tabular-nums; line-height: 1;
}
.mtg-seat-rail__life[data-low='true'] { color: var(--mtg-negative); }
.mtg-seat-rail__name {
  grid-area: name; min-width: 0;
  font-weight: 600; font-size: var(--mtg-text-sm); line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mtg-seat-rail__you {
  margin-inline-start: var(--mtg-space-1);
  font-size: var(--mtg-text-xs); font-weight: 400; color: var(--mtg-ink-faint);
}
.mtg-seat-rail__poison {
  grid-area: poison; display: flex; gap: var(--mtg-space-1); align-items: baseline;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-faint); line-height: 1.3;
}
.mtg-seat-rail__poison-amount { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; }
.mtg-seat-rail__poison[data-tone='warn'] { color: var(--mtg-ready); }
.mtg-seat-rail__poison[data-tone='lethal'] { color: var(--mtg-negative); font-weight: 600; }
.mtg-seat-rail__damage-list {
  display: flex; flex-wrap: wrap; gap: 2px var(--mtg-space-1);
  margin: 0; padding: 0; list-style: none;
}
.mtg-seat-rail__damage {
  display: inline-flex; gap: var(--mtg-space-1); align-items: baseline; min-width: 0;
  padding: 0 var(--mtg-space-1);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-pill);
  font-size: var(--mtg-text-xs); line-height: 1.4; color: var(--mtg-ink-muted);
}
.mtg-seat-rail__damage[data-amount='0'] { opacity: 0.55; }
.mtg-seat-rail__damage[data-tone='warn'] { border-color: var(--mtg-ready); color: var(--mtg-ink); }
.mtg-seat-rail__damage[data-tone='lethal'] {
  border-color: var(--mtg-negative); background: var(--mtg-negative); color: var(--mtg-accent-ink);
}
.mtg-seat-rail__damage-from { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtg-seat-rail__damage-amount { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }

/* The opponents share the row equally, and each tile takes the row's whole height
   so the battlefields line up along the seam whatever their neighbors hold. */
.mtg-board__opponents {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: var(--mtg-space-1); min-width: 0;
}
/* Two shares of any height the lanes have left over to the viewer's one: three boards
   are asking where a duel's lane asked for one, and the viewer's own lane already
   has all it can use once its cards reach their cap. The basis and the shrink are
   the duel's, so a viewport with nothing to spare draws the split it always did. */
${TABLE} .mtg-board__opponents { flex: 2 1 auto; min-height: 0; }
.mtg-pod-tile { display: flex; flex-direction: column; gap: var(--mtg-space-1); min-width: 0; min-height: 0; }
.mtg-pod-tile > .mtg-board__side { flex: 1 1 ${cssNumber(TILE_BOARD_BASIS_REM)}rem; min-height: 0; }
.mtg-pod-tile[data-active='true'] > .mtg-pod-tile__head { border-color: var(--mtg-accent); }
/* One line where SeatPod is a block, and it wraps rather than clips when a
   narrow tile cannot hold it: a life total that is cut off is a wrong reading. */
.mtg-pod-tile__head {
  display: flex; flex: none; flex-wrap: wrap; align-items: baseline; gap: 0 var(--mtg-space-2);
  min-width: 0; padding: 1px var(--mtg-space-1);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-md);
  font-size: var(--mtg-text-xs); line-height: 1.4;
}
.mtg-pod-tile__name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 600; font-size: var(--mtg-text-sm);
}
.mtg-pod-tile__life {
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-lg); font-weight: 600;
  font-variant-numeric: tabular-nums; line-height: 1.2;
}
.mtg-pod-tile__life[data-low='true'] { color: var(--mtg-negative); }
.mtg-pod-tile__count { display: inline-flex; gap: 2px; align-items: baseline; color: var(--mtg-ink-faint); }
.mtg-pod-tile__count-label { text-transform: capitalize; }
.mtg-pod-tile__count-value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--mtg-ink); }
.mtg-pod-tile__head .mtg-status__mana { flex-wrap: wrap; }
/* The tile's side is one column, and its command zone a strip above the
   battlefield rather than a column beside it. A tile is a third of the lanes:
   a 4.5rem column out of a 176px-wide tile left the battlefield 104px, which is
   two permanents behind a scrollbar. The strip costs height instead, and a
   tile's height is what the row has plenty of. */
.mtg-pod-tile .mtg-board__side[data-side-panel='true'] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}
.mtg-pod-tile .mtg-board__side[data-side-panel='true'] > :first-child { grid-column: 1; grid-row: 2; }
.mtg-pod-tile .mtg-board__side[data-side-panel='true'] > .mtg-command { grid-column: 1; grid-row: 1; }
.mtg-pod-tile .mtg-board__side[data-side-panel='true'] > .mtg-library-top { grid-column: 1; grid-row: 3; }
.mtg-pod-tile .mtg-command .mtg-zone__body { flex-direction: row; flex-wrap: wrap; align-items: center; overflow: visible; }
.mtg-pod-tile .mtg-command__entry { flex-direction: row; align-items: center; }
.mtg-pod-tile .mtg-command__ledger { align-items: flex-start; text-align: start; line-height: 1.2; }
.mtg-pod-tile .mtg-command__casts, .mtg-pod-tile .mtg-command__cost { white-space: normal; }
.mtg-pod-tile .mtg-command .mtg-zone { padding-block: 2px; }
.mtg-pod-tile .mtg-command .mtg-zone__body { padding-block: 0; }
.mtg-pod-tile .mtg-command .mtg-zone__empty { white-space: normal; overflow-wrap: anywhere; }
.mtg-pod-tile .mtg-command .mtg-zone:not([data-empty='true']) > .mtg-zone__head {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.mtg-pod-tile .mtg-command .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  width: auto; height: ${cssNumber(TILE_COMMANDER_REM)}rem; flex: none;
}
/* Sizes are stated on both axes rather than left to an aspect-ratio and an
   automatic width: a slot whose width is auto asks its card for a width, the card
   asks the slot for a height, and Chromium settled that loop at 72px for a card
   44px wide. A slot is its height at the printed trim; a tapped one is square, as
   ./slot.ts draws it. Lands keep ./lands.ts's art-window shape at a height of
   their own.

   The rules below are written against \`${TILE}\` and not \`.mtg-pod-tile\` so
   they out-weigh the lane's rules for a slot and a mana band (./slot.ts,
   ./lands.ts, ./fit.ts), which a tile has decided not to follow. */
${TILE} { --tile-slot: ${cssNumber(TILE_SLOT_REM)}rem; --tile-land: ${cssNumber(TILE_LAND_REM)}rem; }
${TILE} .mtg-board__spells[data-tile-crowded='true'] { --tile-slot: ${cssNumber(TILE_CROWDED_SLOT_REM)}rem; }
${playedSlot(`${TILE} .mtg-board__spells`)}[data-slot='play'] {
  flex: none; min-width: 0; min-height: 0; max-height: none; aspect-ratio: auto;
  height: var(--tile-slot); width: calc(var(--tile-slot) * ${TRIM_RATIO});
}
${playedSlot(`${TILE} .mtg-board__spells`)}[data-slot='play'][data-tapped='true'] { width: var(--tile-slot); }
${TILE} .mtg-command .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  flex: none; min-width: 0; min-height: 0; aspect-ratio: auto;
  height: ${cssNumber(TILE_COMMANDER_REM)}rem; width: calc(${cssNumber(TILE_COMMANDER_REM)}rem * ${TRIM_RATIO});
}
${TILE} .mtg-lands > .mtg-slot[data-slot='play'] { height: var(--tile-land); }
/* The mana base is one line however many lands there are: each tile overlaps the
   one before it by more than half, so a seven-land base is about the width of
   four and every land is still a tile with its own edge to count. What a tile
   cannot afford is a second line, which is what wrapping it cost in height. */
${TILE} .mtg-lands { flex-wrap: nowrap; overflow-x: auto; }
${TILE} .mtg-zone__body[data-layout='board'] > .mtg-lands { max-height: none; }
${TILE} .mtg-lands > .mtg-slot[data-slot='play']:not(:first-child) { margin-inline-start: calc(var(--tile-land) * -1.05); }
${TILE} .mtg-lands > .mtg-slot[data-slot='play']:hover { position: relative; z-index: 2; }
/* Wrapped and from the top: a row centered in a body shorter than it is puts its
   first line above the scroll origin, where nothing can reach it. */
${TILE} .mtg-board__spells {
  flex: 0 0 auto; min-height: 0; flex-wrap: wrap; overflow: visible; align-content: flex-start;
  padding-block: 0; row-gap: var(--mtg-space-1);
}

/* The attack target picker, drawn in the combat band's controls. It wraps rather
   than widening the controls, which are the one part of the band that does not
   scroll: a picker that pushed the confirm past the band's edge would put the
   button that ends the declaration out of reach. */
.mtg-combat__controls:has(.mtg-combat__targets) { flex-wrap: wrap; justify-content: center; max-width: 100%; }
.mtg-combat__targets {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: var(--mtg-space-1);
}
.mtg-combat__targets-ask {
  flex: 1 0 100%; text-align: center;
  font-size: var(--mtg-text-xs); color: var(--mtg-accent-ink);
}
.mtg-combat__target { display: inline-flex; gap: var(--mtg-space-1); align-items: baseline; }
.mtg-combat__target[aria-checked='true'] {
  border-color: var(--mtg-ready);
  box-shadow: 0 0 0 1px var(--mtg-ready), 0 0 10px 2px var(--mtg-ready-soft);
}
.mtg-combat__target-count {
  font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 600;
  color: var(--mtg-ready);
}
`;
