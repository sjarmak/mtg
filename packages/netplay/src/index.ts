/**
 * Two players on two machines, over one server.
 *
 * The parts, in the order a game moves through them:
 *
 *  - `deal.ts` turns a set into a `TableSpec`: two sealed decks, two seats, and
 *    a capability per seat that is sitting at one.
 *  - `table.ts` owns the session. It is the only authority on legality and the
 *    only place that knows the whole position, and it hands each seat a
 *    concealed one.
 *  - `protocol.ts` is what crosses: an index in, a position out.
 *  - `server.ts` is that over `node:http`, and is the only Node-only module
 *    here.
 *
 * **`@mtg/ui` may import this package for types and must not import it for
 * values.** `serveTable` reaches `node:http`, and `@mtg/ui`'s `src/` is bundled
 * by Vite; a value import from there would put a Node built-in in a browser
 * bundle. `@mtg/ui` already carries exactly this arrangement for `@mtg/sim`,
 * whose barrel reaches `node:worker_threads` and which the replay reader imports
 * with `import type` for that reason. Type-only imports are erased before Vite
 * sees them, and `packages/ui/test/net/isolation.test.ts` reads the tree so the
 * rule is checked rather than remembered. `packages/ui/tools/` has no such
 * constraint and imports this package outright.
 */
export type { SeatRefusal, SeatRequest, SeatSnapshot, WireAutoPass, WireStopSet } from './protocol';
export {
  fromWireAutoPass,
  MAX_NETPLAY_DECISIONS,
  NETPLAY_PROTOCOL,
  readSeatRequest,
  readWireAutoPass,
  toWireAutoPass,
} from './protocol';

export type { Table, TableRecord, TableSeating, TableSpec } from './table';
export { createTable } from './table';

export type { DealtTable, PreconTableDealOptions, SeatPlan, TableDealOptions } from './deal';
export { dealPreconTable, dealSealedTable, humanSeatsOf } from './deal';

export type { RunningServer, ServeOptions } from './server';
export { DEFAULT_POLL_MS, serveTable } from './server';
