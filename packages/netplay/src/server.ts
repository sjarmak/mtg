/**
 * The table over HTTP. Node-only; never imported from the barrel.
 *
 * Nine routes and no framework, because `node:http` is already a router with a
 * `switch` in front of it and the workspace has neither `express` nor `ws`
 * installed. Adding one is a finding to report rather than an install to run
 * (`AGENTS.md`), and none of this needs one.
 *
 *   GET  /api/health              — is anything listening, speaking which protocol, dealing
 *   POST /api/tables              — deal a new table and keep its host seat
 *   POST /api/rooms               — open a pre-game room and keep its host seat
 *   POST /api/drafts              — open one that drafts its pools first
 *   GET  /api/room/:token         — this seat's room: its pool, and who has built
 *   GET  /api/room/:token/set     — the set that room's pool and packs are printed in
 *   POST /api/room/:token         — this seat's pick while drafting, its deck after
 *   GET  /api/table/:token        — this seat's position right now
 *   GET  /api/table/:token/wait   — the same, held until it changes
 *   GET  /api/table/:token/invite — the links this seat may hand out, if it is the host
 *   POST /api/table/:token        — a choice, a yield, or this seat's own stops
 *   GET  /api/games               — every game this lab has recorded, as index rows
 *   POST /api/games               — a token for one game about to be played in the browser
 *   PUT  /api/games/:token        — that game, finished, to be reproduced and recorded
 *   GET  /api/games/:id           — one recorded game
 *   /api/observed/...             — the Forge-over-LAN arm, in `observed-routes.ts`
 *
 * The four `games` routes are `./games-route.ts`'s and exist only when the
 * server was given a `recorder`; a kernel table this server plays to a result
 * is recorded without any of them, from the table itself.
 *
 * `:token` is the seat. There is nothing else to identify a client with and
 * nothing else is wanted: the bead states no accounts and no matchmaking, two
 * known people on one network. What the token does buy is the thing a query
 * string would not — one player cannot open the other player's board by editing
 * a digit — and it costs one `randomUUID` at deal time.
 *
 * **Bound to loopback unless told otherwise.** `serveTable` takes a host and has
 * no default that reaches a network. The arrangement the launcher sets up is
 * Vite on the LAN proxying `/api` to this server on 127.0.0.1, so exactly one
 * listener is reachable from another machine and it is the one that was already
 * designed to be (`packages/ui/vite.config.ts` carries that argument). Same
 * origin also means no CORS headers here, which is not an oversight: a server
 * that answered every origin would undo the seat capability the moment a page in
 * another tab knew the token.
 *
 * # The one route with no token in front of it
 *
 * `POST /api/tables` is that route — `POST /api/rooms` is the same route for a
 * game whose decks are cut by the people playing it, and everything below is
 * true of both — and it exists because the playtester's answer to
 * "run `npm run netplay` in a terminal" was that pressing a button in the page
 * is the whole of what a person should have to do. A page cannot mint a seat
 * capability — the point of one is that the server minted it — so somebody has
 * to be able to ask for a table without holding a token, and that ask is
 * reachable from the LAN through the same proxy the page is.
 *
 * What that costs, stated plainly rather than implied: any device that can load
 * the page can cause this process to deal tables, and dealing one is real work
 * (two sealed pools and two builds). `MAX_LIVE_TABLES` is the whole of the
 * bound on it, and a server given no `dealer` answers 404 here, which is what
 * every launcher that predates the button does.
 *
 * What it does *not* cost is any access to a table somebody is playing. The
 * created table's host token goes to the caller in the response and nowhere
 * else, the guest tokens go out only through that host's invite, and every
 * other route on this server still wants one of them. A stranger who posts here
 * gets a fresh, empty table of their own — the same thing they would get by
 * opening the lab on their own machine.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { PlayerId } from '@mtg/kernel';
import type { GameplayRecorder } from './gameplay';
import { handleGames, openRecordings } from './games-route';
import type { Recordings } from './games-route';
import type { Table } from './table';
import type { Room } from './room';
import { readRoomBuild, readRoomPick } from './room';
import { NETPLAY_PROTOCOL, readSeatRequest } from './protocol';
import type { TableInvite } from './protocol';
import { hold, inviteFor, json, readBody } from './http-support';
import { OBSERVED_TABLE_PROTOCOL } from './observed-protocol';
import { handleObserved } from './observed-routes';
import type { ObservedDealer } from './observed-table';

/** How long a held poll waits before answering with the position it has. */
export const DEFAULT_POLL_MS = 25_000;

/**
 * A table dealt on request, and the one seat the caller keeps.
 *
 * `hostToken` is carried rather than derived because a `Table` does not hand
 * back its own capabilities — `seatOf` goes the other way, which is the whole
 * of its safety — so the dealer, which minted them, is the only thing that can
 * say which one it is about to give away.
 */
export interface DealtSeats {
  readonly table: Table;
  readonly invite?: TableInvite | undefined;
  readonly hostToken: string;
}

/**
 * What deals a table when the page asks for one.
 *
 * A function rather than a set of cards, because everything that goes into a
 * deal — the set, the decks, this machine's addresses, the port the page is
 * served on — belongs to the launcher, and none of it belongs to a server whose
 * whole job is to be the thing on the other end of a socket. Async because a
 * dealer may read a file; the request waits, and nothing else does.
 */
export type TableDealer = () => DealtSeats | Promise<DealtSeats>;

/**
 * A room opened on request, and the one seat the caller keeps.
 *
 * The same shape as `DealtSeats` and for the same reason: a room mints the
 * tokens the table will later answer to, so the thing that minted them is the
 * only thing that can say which one is the host's.
 */
export interface DealtRoom {
  readonly room: Room;
  readonly invite?: TableInvite | undefined;
  readonly hostToken: string;
}

/** What opens a room when the page asks for one. See `TableDealer`. */
export type RoomDealer = () => DealtRoom | Promise<DealtRoom>;

/**
 * How many tables one process will deal before it starts refusing.
 *
 * The bound on the untokened route, and the reason it is a small number is that
 * a lab is one person at one keyboard: they deal a table, they play it, and the
 * one they dealt by pressing the button twice is the cost of a misclick. A
 * stranger on the network reaches the same ceiling, which is the point.
 *
 * Refused rather than evicted. Evicting the oldest would end a game somebody is
 * in the middle of, which is a worse answer to a full server than telling the
 * eleventh press that the server is full.
 */
export const MAX_LIVE_TABLES = 8;

interface ServeCommon {
  readonly port: number;
  /** Stated, never defaulted. See the header. */
  readonly host: string;
  readonly pollMs?: number | undefined;
  /** Deals a table for `POST /api/tables`. Absent means that route answers 404. */
  readonly dealer?: TableDealer | undefined;
  /** Opens a room for `POST /api/rooms`. Absent means that route answers 404. */
  readonly rooms?: RoomDealer | undefined;
  /**
   * Opens a drafting room for `POST /api/drafts`. Absent answers 404.
   *
   * A second dealer rather than a flag on the first, because the two presses
   * are two things a launcher may or may not be able to do and the health check
   * has to be able to say which: a page that drew a Draft button against a
   * launcher that opens sealed rooms only would be a button that 404s. What it
   * returns is the same `DealtRoom` — a drafting room is a room, and everything
   * after the last pick is the sealed room's own build phase.
   */
  readonly drafts?: RoomDealer | undefined;
  /**
   * Opens observed tables for `POST /api/observed`, the Forge-over-LAN arm.
   *
   * Absent answers 404 on every `/api/observed` route and leaves `observed`
   * off the health check, so a page against a launcher with no per-seat
   * backend draws that cell unavailable rather than a button that 404s.
   * `observed-routes.ts` holds the routes; this file only hands them the request.
   */
  readonly observed?: ObservedDealer | undefined;
  /**
   * Where finished games go. Absent means nothing is recorded and the
   * `/api/games` routes answer 404; present, every kernel table this server
   * plays to a result is handed over once, and a browser may post its own.
   */
  readonly recorder?: GameplayRecorder | undefined;
}

/**
 * A server that starts with a table already dealt, which is `npm run netplay`.
 *
 * `invite` is what the host seat may hand out, when this table has one at all.
 * Passed in finished rather than derived here. Building it means resolving this
 * machine's addresses and knowing the port the *page* is served on, which is
 * Vite's port and not this server's; both are the launcher's facts, and a table
 * with no invite is a table played entirely from links somebody already has.
 * Absent is a supported state, not a broken one — the route answers 404 and the
 * page says so.
 */
export interface ServeSeated extends ServeCommon {
  readonly table: Table;
  readonly invite?: TableInvite | undefined;
}

/** A server that starts empty and deals on request, which is `npm run play`. */
export interface ServeDealing extends ServeCommon {
  readonly table?: undefined;
  readonly dealer: TableDealer;
}

/**
 * A server that starts empty and opens rooms on request.
 *
 * The third way to be a server worth starting, and its own arm rather than an
 * optional field on the second: a lab may offer both presses, and a caller that
 * only wants the build screen (a test, mostly) is not made to invent a table
 * dealer it will never call.
 */
export interface ServeRooming extends ServeCommon {
  readonly table?: undefined;
  readonly rooms: RoomDealer;
}

/** The same, for the lab that only opens drafts. See `ServeRooming`. */
export interface ServeDrafting extends ServeCommon {
  readonly table?: undefined;
  readonly drafts: RoomDealer;
}

/**
 * A server can seat, or deal, or open rooms, or draft, or any combination — and
 * one that does none of them is a 404 with a port number, so it is written as a
 * union and fails to compile instead.
 */
/** A server whose only dealer is the observed one: the Forge-over-LAN arm alone. */
export interface ServeObserving extends ServeCommon {
  readonly table?: undefined;
  readonly observed: ObservedDealer;
}

export type ServeOptions = ServeSeated | ServeDealing | ServeRooming | ServeDrafting | ServeObserving;

export interface RunningServer {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

interface Route {
  readonly token: string;
  readonly kind: 'position' | 'wait' | 'invite' | 'room' | 'roomSet';
  readonly since: number | null;
}

/**
 * `/api/table/<token>`, `…/wait?since=N`, `…/invite`, `/api/room/<token>`,
 * `…/set`, or null.
 *
 * Parsed rather than matched with a regular expression so the five shapes are
 * visibly the only five: anything with more segments, a trailing word that is
 * none of the three, or a `since` that is not a number, is not a route this
 * server has.
 *
 * The room is addressed by the *same* token as the table it becomes, which is
 * what lets a page move from building to playing without being handed a second
 * link. Its own path exists so the two answers are two shapes rather than one
 * union a client has to discriminate on every poll.
 */
function routeOf(url: URL): Route | null {
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments.length < 3 || segments[0] !== 'api') return null;
  const token = segments[2] ?? '';
  if (token.length === 0) return null;
  if (segments[1] === 'room') {
    if (segments.length === 3) return { token, kind: 'room', since: null };
    if (segments.length === 4 && segments[3] === 'set') {
      return { token, kind: 'roomSet', since: null };
    }
    return null;
  }
  if (segments[1] !== 'table') return null;
  if (segments.length === 3) return { token, kind: 'position', since: null };
  if (segments.length !== 4) return null;
  if (segments[3] === 'invite') return { token, kind: 'invite', since: null };
  if (segments[3] !== 'wait') return null;
  const raw = url.searchParams.get('since');
  const since = raw === null ? null : Number(raw);
  if (since !== null && (!Number.isInteger(since) || since < 0)) return null;
  return { token, kind: 'wait', since };
}

/**
 * One game this process is serving, and who has turned up at it.
 *
 * Two ways in and one way out. A table dealt outright fills `dealt` and is a
 * game from the moment it exists; a room fills `room` and becomes one when both
 * seats have built, at which point `room.table()` starts answering. Either way
 * the tokens are the same tokens for the whole life of the entry, which is what
 * makes the transition invisible to the link somebody was handed.
 *
 * `joined` is per game rather than per process, which it was while a process
 * served exactly one. Seat numbers are 0 and 1 in every table, so one set
 * shared across several would report the second table's guest as having arrived
 * at the first the moment anybody opened anything.
 */
interface Live {
  /** The pre-game room, when this entry started as one. */
  readonly room: Room | null;
  /** The table, when one was dealt outright. A room fills its own. */
  readonly dealt: Table | null;
  readonly invite: TableInvite | undefined;
  readonly joined: Set<PlayerId>;
  /** Whether the finished game has been handed to the recorder; once only. */
  recorded: boolean;
}

/** The session behind an entry, or null while its room is still building. */
function tableOf(live: Live): Table | null {
  return live.dealt ?? live.room?.table() ?? null;
}

/**
 * The game a capability addresses and the seat it is, or null for neither.
 *
 * A room is asked before its table, because they answer to the same tokens and
 * the room is the one that answers from the moment the entry exists. Asking the
 * table first would find nothing for the whole of the build phase.
 */
function findSeat(games: readonly Live[], token: string): { live: Live; seat: PlayerId } | null {
  for (const live of games) {
    const seat = live.room?.seatOf(token) ?? live.dealt?.seatOf(token) ?? null;
    if (seat !== null) return { live, seat };
  }
  return null;
}

/**
 * `POST /api/tables`: deal one, keep the host seat, hand back its link.
 *
 * The response is the only place the host token is ever written, which is what
 * makes an untokened route safe to expose (see the header). A dealer that
 * throws is a 500 naming what went wrong rather than a silent empty answer: the
 * page has a button on the other end of this and has to be able to say why the
 * press did nothing.
 */
async function dealNewTable(
  games: Live[],
  dealer: TableDealer | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  // Drained rather than read. A create request states nothing — the dealer owns
  // every input to a deal — and a body left in the socket stalls keep-alive.
  request.resume();
  const refusal = canDeal(games, dealer, 'a table is dealt with POST', 'deal a table', request);
  if (refusal !== null) {
    json(response, refusal.status, { refused: refusal.refused });
    return;
  }
  if (dealer === undefined) return;
  try {
    const dealt = await dealer();
    games.push({
      room: null,
      dealt: dealt.table,
      invite: dealt.invite,
      joined: new Set<PlayerId>(),
      recorded: false,
    });
    json(response, 201, { token: dealt.hostToken, protocol: NETPLAY_PROTOCOL, table: dealt.table.id });
  } catch (cause: unknown) {
    json(response, 500, {
      refused: `the table could not be dealt (${cause instanceof Error ? cause.message : String(cause)})`,
    });
  }
}

/**
 * The three ways a create request is refused before anything is built.
 *
 * Shared by both create routes, because the wrong method, a launcher with no
 * dealer and a full server are the same three answers whether the thing being
 * created is a table or a room, and the cap is a cap on live games rather than
 * on either kind.
 */
function canDeal(
  games: readonly Live[],
  dealer: unknown,
  wrongMethod: string,
  /** What this route makes, so the 404 names the thing that is missing. */
  makes: string,
  request: IncomingMessage,
): { readonly status: number; readonly refused: string } | null {
  if (request.method !== 'POST') return { status: 405, refused: wrongMethod };
  if (dealer === undefined) {
    return { status: 404, refused: `this server was started without a way to ${makes}` };
  }
  if (games.length >= MAX_LIVE_TABLES) {
    return {
      status: 429,
      refused: `this server is already holding ${String(MAX_LIVE_TABLES)} tables; restart it to deal more`,
    };
  }
  return null;
}

/**
 * `POST /api/rooms`: open one, keep the host seat, hand back its link.
 *
 * `dealNewTable`'s twin, and the response is deliberately the same shape: the
 * page holds one token either way, and `room` beside `table` is what tells it
 * which of the two screens to open on.
 */
async function openNewRoom(
  games: Live[],
  rooms: RoomDealer | undefined,
  /** What this route opens, so a refusal names the press somebody made. */
  makes: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  request.resume();
  const refusal = canDeal(games, rooms, `a ${makes} is opened with POST`, `open a ${makes}`, request);
  if (refusal !== null) {
    json(response, refusal.status, { refused: refusal.refused });
    return;
  }
  if (rooms === undefined) return;
  try {
    const opened = await rooms();
    games.push({
      room: opened.room,
      dealt: null,
      invite: opened.invite,
      joined: new Set<PlayerId>(),
      recorded: false,
    });
    json(response, 201, { token: opened.hostToken, protocol: NETPLAY_PROTOCOL, room: opened.room.id });
  } catch (cause: unknown) {
    json(response, 500, {
      refused: `the ${makes} could not be opened (${cause instanceof Error ? cause.message : String(cause)})`,
    });
  }
}

/**
 * `GET /api/room/:token` and `POST /api/room/:token`.
 *
 * The view is this seat's own pool and who has built; the post is this seat's
 * pick while the room is drafting and its deck once it is not, as indices into
 * the pack and into that pool. A submission the room refuses is a 409 with
 * the room's own sentence and the view beside it, which is the same bargain the
 * table's refusals make: the client is told what is true now rather than only
 * that it was wrong.
 */
function handleRoom(live: Live, seat: PlayerId, request: IncomingMessage, response: ServerResponse): void {
  const room = live.room;
  if (room === null) {
    json(response, 404, { refused: 'this table was dealt with its decks already built' });
    return;
  }
  // Recorded here for the reason the position route records it: this is the
  // request a page makes when it opens its seat, and in a room it is the first
  // one there is. The host's invite panel is watching for exactly this.
  live.joined.add(seat);
  if (request.method === 'GET') {
    json(response, 200, room.viewFor(seat));
    return;
  }
  if (request.method !== 'POST') {
    json(response, 405, { refused: `${request.method ?? 'that method'} is not one this room answers` });
    return;
  }
  void readBody(request).then(
    (body) => {
      if (typeof body !== 'string') {
        json(response, 413, { refused: 'the request body is longer than any request this room has' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (cause: unknown) {
        json(response, 400, { refused: `the request body is not JSON (${String(cause)})` });
        return;
      }
      // One route, two things to send, and the room decides which: while it is
      // drafting the only legal thing to say is a pick, and afterwards the only
      // legal thing is a deck. A client that says the other one is told so by
      // the reader for the phase the room is actually in, rather than being
      // allowed to submit a deck out of a pool it has not finished drafting.
      const drafting = room.viewFor(seat).phase === 'draft';
      const sent = drafting ? readRoomPick(parsed) : readRoomBuild(parsed);
      if (typeof sent === 'string') {
        json(response, 400, { refused: sent });
        return;
      }
      const refusal = typeof sent === 'number' ? room.pick(seat, sent) : room.submit(seat, sent);
      if (refusal !== null) {
        json(response, 409, { refused: refusal, room: room.viewFor(seat) });
        return;
      }
      json(response, 200, room.viewFor(seat));
    },
    (cause: unknown) => {
      json(response, 400, { refused: `the request body could not be read (${String(cause)})` });
    },
  );
}

/**
 * `GET /api/room/:token/set`.
 *
 * The set that room's pool and packs are printed in, sent once per token rather
 * than repeated in the two-second poll. The page needs it because the pool
 * crosses the wire as ids and a page's *open* set is a fact about the reader:
 * the lab stages every set it found and lets a person switch between them, so a
 * room dealt from one set and read by a tab on another refused a pool that was
 * perfectly good. Resolving against this makes that condition unreachable
 * instead of merely reported.
 *
 * Behind the same seat capability as the room itself. A set is not a secret,
 * but a token is the only name this server knows a room by, and inventing a
 * second, weaker way to address one is how the first one stops being the
 * boundary.
 */
function handleRoomSet(live: Live, request: IncomingMessage, response: ServerResponse): void {
  const room = live.room;
  if (room === null) {
    json(response, 404, { refused: 'this table was dealt with its decks already built' });
    return;
  }
  if (request.method !== 'GET') {
    json(response, 405, { refused: 'a set is read, not written' });
    return;
  }
  // No seat is recorded, deliberately, which is why this handler is not handed
  // one: reading the set is a page preparing to draw, and *arrival* is what the
  // room route means. A host's invite panel closes when the other player is in
  // the room, not when their browser fetched a card list.
  json(response, 200, { protocol: NETPLAY_PROTOCOL, cards: room.set });
}

/**
 * Hands a table's finished game to the recorder, once. Called after every
 * accepted request rather than from a watcher, because the request that ends
 * the game is the one that knows it did, and a bot's reply ends it inside the
 * same `apply`.
 */
function captureFinished(live: Live, table: Table, recorder: GameplayRecorder | undefined): void {
  if (recorder === undefined || live.recorded) return;
  const capture = table.capture();
  if (capture === null) return;
  live.recorded = true;
  void recorder.record(capture);
}

function handle(
  games: Live[],
  pollMs: number,
  dealers: {
    readonly table: TableDealer | undefined;
    readonly room: RoomDealer | undefined;
    readonly draft: RoomDealer | undefined;
    readonly observed: ObservedDealer | undefined;
  },
  recording: { readonly recorder: GameplayRecorder | undefined; readonly recordings: Recordings },
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const url = new URL(request.url ?? '/', 'http://table.invalid');
  if (handleObserved(request, response, url, dealers.observed, pollMs)) return;
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (handleGames(recording.recorder, recording.recordings, segments, request, response)) return;
  if (url.pathname === '/api/health') {
    // `deals` is what the Play page reads to decide between drawing a button and
    // naming a command: a launcher that predates the button answers a health
    // check perfectly well and cannot deal anything. `rooms` is the same fact
    // about the build-your-own-deck button, asked separately because a launcher
    // that deals tables and not rooms is what every one of them was yesterday.
    // `drafts` is the third of them, and the same argument one press further on.
    json(response, 200, {
      ok: true,
      protocol: NETPLAY_PROTOCOL,
      deals: dealers.table !== undefined,
      rooms: dealers.room !== undefined,
      drafts: dealers.draft !== undefined,
      records: recording.recorder !== undefined,
      // `observed` names the formats the Forge-over-LAN arm serves, and is
      // absent rather than empty when there is no such arm, so a launcher that
      // predates it answers the same bytes it always did.
      ...(dealers.observed === undefined
        ? {}
        : { observed: { protocol: OBSERVED_TABLE_PROTOCOL, formats: dealers.observed.formats } }),
    });
    return;
  }
  if (url.pathname === '/api/tables') {
    void dealNewTable(games, dealers.table, request, response);
    return;
  }
  if (url.pathname === '/api/rooms') {
    void openNewRoom(games, dealers.room, 'room', request, response);
    return;
  }
  if (url.pathname === '/api/drafts') {
    void openNewRoom(games, dealers.draft, 'draft', request, response);
    return;
  }
  const route = routeOf(url);
  if (route === null) {
    json(response, 404, { refused: 'no such route' });
    return;
  }
  const found = findSeat(games, route.token);
  if (found === null) {
    json(response, 404, { refused: 'no seat answers to that link' });
    return;
  }
  const { seat, live } = found;
  const { invite, joined } = live;
  if (route.kind === 'room') {
    handleRoom(live, seat, request, response);
    return;
  }
  if (route.kind === 'roomSet') {
    handleRoomSet(live, request, response);
    return;
  }
  const table = tableOf(live);
  if (route.kind === 'invite') {
    if (request.method !== 'GET') {
      json(response, 405, { refused: 'an invite is read, not written' });
      return;
    }
    if (invite === undefined) {
      json(response, 404, { refused: 'this table was started without links to hand out' });
      return;
    }
    json(response, 200, inviteFor(invite, seat, joined));
    return;
  }
  // A room that has not started has no position to send, and saying so beats
  // both a 404 (which reads as a bad link) and an empty board. The room route is
  // named in the refusal because that is where the page should be.
  if (table === null) {
    json(response, 409, { refused: 'this table has not started; both seats are still building' });
    return;
  }
  // Recorded on a position request rather than on any request, because that is
  // the one a page makes when it opens a seat. The invite route is not it: the
  // host asking who has arrived would otherwise record itself as having.
  joined.add(seat);
  if (request.method === 'GET') {
    if (route.kind === 'wait' && route.since !== null && route.since === table.revision) {
      hold(table, pollMs, request, response, () => table.snapshotFor(seat));
      return;
    }
    json(response, 200, table.snapshotFor(seat));
    return;
  }
  if (request.method !== 'POST') {
    json(response, 405, { refused: `${request.method ?? 'that method'} is not one this table answers` });
    return;
  }
  void readBody(request).then(
    (body) => {
      if (typeof body !== 'string') {
        json(response, 413, { refused: 'the request body is longer than any request this table has' });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (cause: unknown) {
        json(response, 400, { refused: `the request body is not JSON (${String(cause)})` });
        return;
      }
      const seatRequest = readSeatRequest(parsed);
      if (typeof seatRequest === 'string') {
        json(response, 400, { refused: seatRequest, at: table.snapshotFor(seat).decisions });
        return;
      }
      const refusal = table.apply(seat, seatRequest);
      // A refusal is 409 rather than 400: the request was well formed and the
      // table simply is not in the position the client thought it was, which is
      // the ordinary outcome of two people clicking at once and is answered by
      // the snapshot that comes back with it.
      if (refusal !== null) {
        json(response, 409, refusal);
        return;
      }
      captureFinished(live, table, recording.recorder);
      json(response, 200, table.snapshotFor(seat));
    },
    (cause: unknown) => {
      json(response, 400, { refused: `the request body could not be read (${String(cause)})` });
    },
  );
}

export function serveTable(options: ServeOptions): Promise<RunningServer> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  // The table this server was started with, if it was started with one, and
  // whatever the create route deals after it. A list rather than one slot,
  // because replacing the slot on the second press would take a game away from
  // whoever was in the middle of it.
  const games: Live[] =
    options.table === undefined
      ? []
      : [
          {
            room: null,
            dealt: options.table,
            invite: options.invite,
            joined: new Set<PlayerId>(),
            recorded: false,
          },
        ];
  const dealers = {
    table: options.dealer,
    room: options.rooms,
    draft: options.drafts,
    observed: options.observed,
  };
  const recording = { recorder: options.recorder, recordings: openRecordings() };
  const server: Server = createServer((request, response) => {
    handle(games, pollMs, dealers, recording, request, response);
  });
  return new Promise<RunningServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      server.off('error', reject);
      resolve({
        port,
        host: options.host,
        close: async (): Promise<void> => {
          // An observed table holds a backend session, and behind the Forge
          // backend a JVM, so the server's close ends every table before the
          // sockets go: a launcher that stops listening still owes those exits.
          await options.observed?.close();
          await new Promise<void>((done, failed) => {
            // Held polls keep a socket open for up to `pollMs`, so a close that
            // only stopped accepting would hang for the length of one wait.
            server.closeAllConnections();
            server.close((cause) => {
              if (cause === undefined) done();
              else failed(cause);
            });
          });
        },
      });
    });
  });
}
