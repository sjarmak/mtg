import type { SeatId } from '@mtg/engine';
import type { PlayerId } from '@mtg/kernel';

/**
 * A seat of a two-seat record, which is the only board this file still draws.
 *
 * `SeatNames` and the kernel arm's positions are pairs, and so is a recorded
 * game (`../../../tools/gameplay-recorder.ts`), so a seat past the second is a
 * caller bug and not a position to draw. The backend arm no longer asks: a
 * table of more than two seats is drawn as a pod (`../../board/SeatRail.ts`,
 * `mtg-bc2.154.6.5.4`) and `BackendGame` holds its seats as plain `SeatId`s.
 */
export function boardSeat(seat: SeatId): PlayerId {
  if (seat !== 0 && seat !== 1)
    throw new Error(`boardSeat: the board draws two seats, not seat ${String(seat)}`);
  return seat;
}

/** `boardSeat` for a seat that may be nobody's, such as the holder of priority. */
export function boardSeatOrNull(seat: SeatId | null): PlayerId | null {
  return seat === null ? null : boardSeat(seat);
}
