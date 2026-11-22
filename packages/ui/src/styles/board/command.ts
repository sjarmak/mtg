/**
 * The command zone's place: on the right-hand side of the seat's battlefield.
 *
 * A side is a flex column (`./mat.ts`), and every sheet that dresses the
 * battlefield selects it as the side's direct child (`./band.ts` paints it,
 * `./fit.ts` sizes it). So the panel is not wrapped around the battlefield; a
 * side that carries one turns itself into a two-column grid instead, with the
 * battlefield in the first column, the panel in the second, and the step bar,
 * the seam and the hand still spanning the whole width underneath. Nothing a
 * standard game draws changes, because a side with no commander carries no
 * `data-command-zone` and stays the column it was.
 *
 * The panel wraps its zone in `.mtg-command` rather than being one, because the
 * hand sheet's combat and crowding rules select the side's own rail-toned zone
 * child, and the commander is not a hand.
 */
import { CARD_TRIM_MM } from '../../card/anatomy';
import { cssNumber } from '../number';
import { FACE_COMPLETE_REM, HAND_FACE_MAX_REM } from './hand';
import { RATIO, TABLE } from './geometry';

export const COMMAND_ZONE_WIDTH_REM = 11;

export const SHORT_COMMAND_FACE_MIN_REM = 2.75;

export const COMMAND_CSS = `
.mtg-board__side[data-side-panel='true'] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) ${String(COMMAND_ZONE_WIDTH_REM)}rem;
  grid-template-rows: minmax(0, 1fr) auto;
  grid-auto-rows: auto;
  align-items: stretch;
}
.mtg-board__side[data-side-panel='true'] > :first-child { grid-column: 1; grid-row: 1 / 3; }
.mtg-board__side[data-side-panel='true'] > .mtg-command { grid-column: 2; grid-row: 1; min-height: 0; }
.mtg-board__side[data-side-panel='true'] > .mtg-avatar { grid-column: 2; grid-row: 1; min-height: 0; align-self: start; }
/* The revealed top card sits under the commander, and takes the commander's
   place at the top of the panel on a table that has none. */
.mtg-board__side[data-side-panel='true'] > .mtg-library-top { grid-column: 2; grid-row: 2; min-width: 0; }
.mtg-board__side[data-side-panel='true']:not([data-command-zone='true']) > .mtg-library-top { grid-row: 1; align-self: start; }
.mtg-board__side[data-side-panel='true'] > :not(.mtg-command):not(.mtg-avatar):not(.mtg-library-top):not(:first-child) { grid-column: 1 / -1; }
.mtg-avatar { display: flex; flex-direction: column; min-width: 0; }
.mtg-avatar > .mtg-zone { flex: 1 1 auto; min-height: 0; }
.mtg-avatar .mtg-zone__body { flex-direction: column; align-items: center; flex-wrap: nowrap; }
${TABLE} .mtg-avatar .mtg-zone__head { display: flex; }
${TABLE} .mtg-avatar { --hand-face-cap: ${cssNumber(HAND_FACE_MAX_REM)}rem; }
.mtg-library-top { display: flex; flex-direction: column; min-width: 0; }
.mtg-library-top .mtg-zone__body { flex-direction: column; align-items: center; flex-wrap: nowrap; }
${TABLE} .mtg-library-top .mtg-zone__head { display: flex; }
.mtg-command { display: flex; flex-direction: column; min-width: 0; }
.mtg-command > .mtg-zone { flex: 1 1 auto; min-height: 0; }
.mtg-command .mtg-zone__body { flex-direction: column; align-items: center; flex-wrap: nowrap; overflow: auto; }
${TABLE} .mtg-command .mtg-slot[data-slot='hand']:not([data-empty='true']) {
  flex: 1 1 auto;
  width: auto;
  height: auto;
  min-height: 0;
  max-width: ${cssNumber(FACE_COMPLETE_REM)}rem;
  max-height: calc(${cssNumber(FACE_COMPLETE_REM)}rem * ${cssNumber(CARD_TRIM_MM.height)} / ${cssNumber(CARD_TRIM_MM.width)});
  aspect-ratio: ${RATIO};
}
${TABLE} .mtg-command .mtg-slot[data-slot='hand']:not([data-empty='true']) > .mtg-card {
  width: auto;
  height: 100%;
  max-width: 100%;
  aspect-ratio: ${RATIO};
}
.mtg-command__entry { display: flex; flex-direction: column; align-items: center; gap: var(--mtg-space-1); flex: 1 1 auto; min-height: 0; }
.mtg-command__ledger {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  font-size: var(--mtg-text-xs); color: var(--mtg-ink-muted); text-align: center;
}
.mtg-command__casts { white-space: nowrap; }
.mtg-command__cost { color: var(--mtg-ink); white-space: nowrap; }
${TABLE} .mtg-command .mtg-zone__head { display: flex; }
`;
