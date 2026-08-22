/**
 * Bare id lists for a zone CR 613 does not reach, with no dependency on
 * anything that reads a permanent's derived characteristics.
 *
 * `graveyardMembers` used to live in `zone-filter.ts` beside `selectPrinted`,
 * which is where a card that only ever *filters* a graveyard would expect to
 * find it. `characteristics.ts`'s CDA arithmetic (`applyPtDefine`'s
 * `graveyardCardTypes` count, CR 613.4a) needs the same id list but sits
 * underneath `zone-filter.ts` in the dependency order — `zone-filter.ts`
 * imports `printedCharacteristics`/`matchesFilter` *from*
 * `characteristics.ts` — so importing it the other way would be a cycle. This
 * file is the shared leaf both sides can depend on: zero imports from
 * anywhere else in the kernel, so it can never be the module that closes a
 * cycle. `zone-filter.ts` re-exports `graveyardMembers` from here unchanged,
 * so every existing import path keeps working.
 */
import { PLAYER_IDS } from './ids';
import type { ObjectId, PlayerId } from './ids';
import type { GameState } from './state';

/**
 * The ids in one or both graveyards, in a fixed order.
 *
 * `'each'` walks `PLAYER_IDS` — seat 0 then seat 1 — rather than concatenating
 * the two arrays by hand, so the traversal order is visibly the same
 * canonical order every other "both players" read in this kernel uses, and
 * not an accident of which literal was written first. A graveyard is
 * append-ordered exactly as a hand or a battlefield is, so a selection read
 * off it is a function of state and replays.
 */
export function graveyardMembers(state: GameState, whose: PlayerId | 'each'): readonly ObjectId[] {
  if (whose === 'each') return PLAYER_IDS.flatMap((player) => state.players[player].graveyard);
  return state.players[whose].graveyard;
}
