/**
 * The two yields, in one place, because two controls now offer them.
 *
 * `./TurnStops.ts` had this list inline while the turn badge's disclosure was
 * the only way to reach a yield. `mtg-nxh` gave the fixed pass the same options
 * on a long press, and two copies of a list of boundaries is two chances for a
 * surface to offer a boundary the other one does not.
 *
 * The boundaries themselves are `@mtg/kernel`'s; nothing here decides what a
 * yield does, only what it is called on screen.
 */
import type { YieldBoundary } from '@mtg/kernel';

export interface YieldOption {
  readonly boundary: YieldBoundary;
  readonly label: string;
}

export const YIELDS: readonly YieldOption[] = [
  { boundary: 'endOfTurn', label: 'Yield to end of turn' },
  { boundary: 'yourNextTurn', label: 'Yield to next own turn' },
];
