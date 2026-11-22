import type { SeatId, TableView } from '@mtg/engine';

/** The table projection a Forge policy may inspect for one seat. */
export function forgePolicyView(view: TableView, candidate: SeatId): TableView {
  const opponent: SeatId = candidate === 0 ? 1 : 0;
  const seats: TableView['seats'] =
    opponent === 0
      ? [{ ...view.seats[0], hand: null }, view.seats[1]]
      : [view.seats[0], { ...view.seats[1], hand: null }];
  return { ...view, seats };
}
