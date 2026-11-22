/**
 * Two players on two machines, over one server.
 *
 * The parts, in the order a game moves through them:
 *
 *  - `deal.ts` turns a set into a `TableSpec`: two sealed decks, two seats, and
 *    a capability per seat that is sitting at one.
 *  - `room.ts` is the phase before that one, for a game whose decks are cut by
 *    the people playing it: two pools, two submissions, then the same table
 *    under the same seat tokens.
 *  - `table.ts` owns the session. It is the only authority on legality and the
 *    only place that knows the whole position, and it hands each seat a
 *    concealed one.
 *  - `protocol.ts` is what crosses: an index in, a position out.
 *  - `server.ts` is that over `node:http`; `backend-gateway.ts` is the matching
 *    transport for engine sessions. They are the Node-only modules here.
 *
 * **`@mtg/ui` may import this package for types and must not import it for
 * values.** The server exports reach `node:http`, and `@mtg/ui`'s `src/` is
 * bundled by Vite; a value import from there would put a Node built-in in a
 * browser bundle. `@mtg/ui` already carries exactly this arrangement for `@mtg/sim`,
 * whose barrel reaches `node:worker_threads` and which the replay reader imports
 * with `import type` for that reason. Type-only imports are erased before Vite
 * sees them, and `packages/ui/test/net/isolation.test.ts` reads the tree so the
 * rule is checked rather than remembered. `packages/ui/tools/` has no such
 * constraint and imports this package outright.
 */
export type {
  InviteLink,
  InviteResponse,
  InviteSeat,
  SeatRefusal,
  SeatRequest,
  SeatSnapshot,
  TableInvite,
  WireAutoPass,
  WireStopSet,
} from './protocol';
export {
  fromWireAutoPass,
  MAX_NETPLAY_DECISIONS,
  NETPLAY_PROTOCOL,
  readSeatRequest,
  readWireAutoPass,
  toWireAutoPass,
} from './protocol';

export type {
  BrowserGameCapture,
  GameplayCapture,
  GameplayFormat,
  GameplayRecorded,
  GameplayRecorder,
  GameplayRefusal,
  GameplaySource,
  KernelGameCapture,
  KernelGameWire,
  ObservedGameCapture,
  WireDeck,
  WireSeat,
} from './gameplay';
export { MAX_GAME_BODY_BYTES, MAX_OPEN_RECORDINGS, MAX_RECORDED_POSTS, readKernelGameWire } from './gameplay';

export type { Table, TableRecord, TableSeating, TableSpec } from './table';
export { createTable } from './table';

export type { DealtTable, PreconTableDealOptions, SeatPlan, TableDealOptions } from './deal';
export { dealPreconTable, dealSealedTable, humanSeatsOf, poolSeedFor, tableSpecFor } from './deal';

export type {
  Room,
  RoomBuild,
  RoomDraftPlan,
  RoomOptions,
  RoomPackView,
  RoomPhase,
  RoomSeatView,
  RoomView,
} from './room';
export { MAX_BASICS, openRoom, readRoomBuild, readRoomPick } from './room';

export type {
  DealtRoom,
  DealtSeats,
  RoomDealer,
  RunningServer,
  ServeDealing,
  ServeDrafting,
  ServeObserving,
  ServeOptions,
  ServeRooming,
  ServeSeated,
  TableDealer,
} from './server';
export { DEFAULT_POLL_MS, MAX_LIVE_TABLES, serveTable } from './server';

export type { BackendGatewayOptions, RunningBackendGateway } from './backend-gateway';
export {
  BACKEND_GATEWAY_ABANDONED_AFTER_MS,
  MAX_BACKEND_GATEWAY_SESSIONS,
  serveBackendGateway,
} from './backend-gateway';
export type { BackendGatewayErrorCode } from './gateway-envelope';
export { BACKEND_GATEWAY_PROTOCOL } from './gateway-envelope';
export type { StartingBackendGatewayOptions } from './starting-gateway';
export { serveStartingBackendGateway } from './starting-gateway';

export type {
  ObservedEndReason,
  ObservedOpenRequest,
  ObservedPhase,
  ObservedSeatFrame,
  ObservedStart,
} from './observed-protocol';
export {
  MAX_OBSERVED_SEATS,
  MAX_OBSERVED_TABLES,
  OBSERVED_DISCONNECT_MS,
  OBSERVED_SEATING_MS,
  OBSERVED_TABLE_PROTOCOL,
  playFor,
  readObservedMove,
  readObservedOpenRequest,
} from './observed-protocol';
export type {
  ObservedClock,
  ObservedDealer,
  ObservedTableCapture,
  ObservedOpenOutcome,
  ObservedOpenRefusalCode,
  ObservedTableOptions,
} from './observed-table';
export type { LobbySeat, SeatTokens } from './observed-table';
export { OBSERVED_SEAT_NAMES, ObservedTable, createObservedDealer, observedSeatName } from './observed-table';
