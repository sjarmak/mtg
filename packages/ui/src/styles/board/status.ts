/**
 * A player's vitals, in the two arrangements the lab draws them in.
 *
 * `.mtg-status` is the line — who they are, what their life total is, and how
 * deep each of their unlaid-out zones runs, read across. The replay timeline
 * draws it under each turn, where a page has width to spare and height to burn.
 *
 * `.mtg-pod` is the block, read down: the chips, the life total, the name. It is
 * what the table draws (`../../board/SeatPod.ts` argues the arrangement, and
 * `./mat.ts` puts the two pods in a column of their own on the far left), and it
 * is here beside the line rather than in a file of its own because the two are
 * one set of facts laid out two ways — a token that changes for one of them
 * almost always has to change for the other.
 *
 * Tabular figures on every number in both, because these are read while they
 * change and a life total that shifts sideways as it ticks is a number nobody
 * can watch.
 */
import { cssNumber } from '../number';

/**
 * How wide the pod column is.
 *
 * Fixed, like Magic Online's, because a player's vitals are the one block on the
 * table whose size has nothing to do with the game state: a seat at 20 life and
 * a seat at 3 want the same box. 5.5rem is 88px, which is 8.6% of a 1024px
 * window and 6.1% of a 1440px one. Magic Online spends about 10.5% on the same
 * column and it is buying an avatar with the difference; this pod has none
 * (`../../board/SeatPod.ts` says why), so what has to fit is the longest chip
 * line, measured rather than estimated: the widest label the pod prints draws
 * 51px inside the 78px content box, beside its number.
 *
 * **It is narrow because width is not free on a crowded board.** The trade the
 * whole move makes is 80px of height for 96px of width (this column plus the
 * mat's gap), and the two are not worth the same everywhere. Measured in
 * chrome-headless-shell at 1440x900: at four permanents a side the row has width
 * to spare, so all 80px reaches the cards and a battlefield face goes 158.1px to
 * 184.8px. At twelve a side the row is already width-bound — the slot is fitted
 * to the room, so a narrower row draws a shorter card — and the same face goes
 * 98.2px to 87px even though its well gained 26.7px. Every rem here is paid for
 * twice in that second case, which is why the pod is sized to its longest word
 * and not to a round number.
 *
 * Read by `./mat.ts` for the mat's first grid track and by `./fit.ts` for the
 * played table's, which is the same reason `./rail.ts` exports its own width
 * rather than each sheet typing it.
 */
export const POD_WIDTH_REM = 5.5;

export const STATUS_CSS = `
.mtg-status {
  display: flex; align-items: center; gap: var(--mtg-space-4);
  padding: var(--mtg-space-2) var(--mtg-space-3);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-lg);
}
.mtg-status[data-active='true'] { border-color: var(--mtg-accent); }
.mtg-status__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mtg-status__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mtg-status__tags { display: flex; gap: var(--mtg-space-1); }
.mtg-status__life {
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xl); font-weight: 600;
  font-variant-numeric: tabular-nums; line-height: 1;
}
.mtg-status__life[data-low='true'] { color: var(--mtg-negative); }
.mtg-status__counts { display: flex; gap: var(--mtg-space-4); margin-left: auto; }
.mtg-status__count { display: flex; flex-direction: column; gap: 1px; align-items: flex-end; }
.mtg-status__count-value { font-family: var(--mtg-font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
.mtg-status__count-label {
  font-size: var(--mtg-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--mtg-ink-faint);
}
.mtg-status__mana { display: flex; gap: 2px; }
.mtg-pod {
  flex: none;
  display: flex; flex-direction: column; align-items: center; gap: var(--mtg-space-1);
  width: ${cssNumber(POD_WIDTH_REM)}rem;
  padding: var(--mtg-space-2) var(--mtg-space-1);
  background: var(--mtg-surface-raised);
  border: 1px solid var(--mtg-line); border-radius: var(--mtg-radius-lg);
  text-align: center;
}
.mtg-pod[data-active='true'] { border-color: var(--mtg-accent); }
.mtg-pod__chips { display: flex; flex-direction: column; gap: 1px; width: 100%; }
.mtg-pod__chip {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: var(--mtg-space-1); min-width: 0;
}
.mtg-pod__chip-value {
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xs);
  font-variant-numeric: tabular-nums; font-weight: 600; line-height: 1.3;
}
.mtg-pod__chip-label {
  font-size: var(--mtg-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--mtg-ink-faint); line-height: 1.3;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mtg-pod__life {
  font-family: var(--mtg-font-mono); font-size: var(--mtg-text-xl); font-weight: 600;
  font-variant-numeric: tabular-nums; line-height: 1;
}
.mtg-pod__life[data-low='true'] { color: var(--mtg-negative); }
.mtg-pod__name {
  font-weight: 600; font-size: var(--mtg-text-sm); line-height: 1.2;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mtg-pod__tags { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--mtg-space-1); }
.mtg-pod .mtg-status__mana { flex-wrap: wrap; justify-content: center; }
`;
