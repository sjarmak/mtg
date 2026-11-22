/**
 * `/api/games`: how a game played in the browser reaches the recorder.
 *
 * Four arms, and the shape of them is `packages/ui/tools/analyze.ts`'s:
 *
 *   GET  /api/games          the index rows, for whoever draws a list of games
 *   POST /api/games          mint a token for one game about to be played
 *   PUT  /api/games/:token   the finished game, once, against that token
 *   GET  /api/games/:id      one record's bytes
 *
 * A token is minted before the game and spent by the finish, so a page holds
 * exactly one capability per game it is playing and a stranger on the network
 * who never minted one has nothing to spend. It is not an account: the point is
 * that a finish is a single use of something the server handed out a moment
 * ago, so a body replayed twice records once. The id the record gets is the
 * server's own and is never taken from the body.
 *
 * The ceilings are `./gameplay.ts`'s and each has a name in the refusal:
 * `too-many-open` when `MAX_OPEN_RECORDINGS` tokens wait unfinished,
 * `budget-spent` once `MAX_RECORDED_POSTS` games have been accepted, and a 413
 * past `MAX_GAME_BODY_BYTES`. What the browser sends is a claim, and the
 * recorder replays it before writing; a claim that does not reproduce is a 422
 * with the recorder's code, and a disk that refuses is a 507.
 *
 * Without a recorder every arm is a 404 that says so, which is what a page
 * reads to decide whether to send anything at all.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GameplayRecorder, GameplayRefusal } from './gameplay';
import { MAX_GAME_BODY_BYTES, MAX_OPEN_RECORDINGS, MAX_RECORDED_POSTS, readKernelGameWire } from './gameplay';
import { json, readBody } from './http-support';
import { NETPLAY_PROTOCOL } from './protocol';

/** What one server process remembers about the games it has been asked to record. */
export interface Recordings {
  /** Tokens minted and not yet spent. */
  readonly open: Set<string>;
  /** Browser games accepted so far, against `MAX_RECORDED_POSTS`. */
  accepted: number;
}

export function openRecordings(): Recordings {
  return { open: new Set<string>(), accepted: 0 };
}

/** The status a recorder's refusal answers with: the disk's fault is not the client's. */
function statusOf(code: GameplayRefusal): number {
  return code === 'write-failed' ? 507 : 422;
}

function mint(recordings: Recordings, response: ServerResponse): void {
  if (recordings.accepted >= MAX_RECORDED_POSTS) {
    json(response, 429, {
      refused: 'budget-spent',
      message: `this server has recorded ${String(MAX_RECORDED_POSTS)} games and records no more until it is restarted`,
    });
    return;
  }
  if (recordings.open.size >= MAX_OPEN_RECORDINGS) {
    json(response, 429, {
      refused: 'too-many-open',
      message: `${String(MAX_OPEN_RECORDINGS)} games are already waiting to be finished`,
    });
    return;
  }
  const token = randomUUID();
  recordings.open.add(token);
  json(response, 201, { protocol: NETPLAY_PROTOCOL, token });
}

async function finish(
  recorder: GameplayRecorder,
  recordings: Recordings,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readBody(request, MAX_GAME_BODY_BYTES);
  if (typeof body !== 'string') {
    json(response, 413, { refused: 'the game is longer than any this server records' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause: unknown) {
    json(response, 400, { refused: `the request body is not JSON (${String(cause)})` });
    return;
  }
  const wire = readKernelGameWire(parsed);
  if (typeof wire === 'string') {
    json(response, 400, { refused: wire });
    return;
  }
  const recorded = await recorder.record({ source: 'browser-kernel', wire });
  if (!recorded.ok) {
    json(response, statusOf(recorded.code), { refused: recorded.code, message: recorded.message });
    return;
  }
  recordings.accepted += 1;
  json(response, 201, { protocol: NETPLAY_PROTOCOL, id: recorded.id });
}

async function read(recorder: GameplayRecorder, id: string, response: ServerResponse): Promise<void> {
  const bytes = await recorder.read(id);
  if (bytes === null) {
    json(response, 404, { refused: 'no recorded game has that id' });
    return;
  }
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(bytes)),
    'cache-control': 'no-store',
  });
  response.end(bytes);
}

/**
 * Answers a `/api/games` request, or returns false when the path is not one.
 * The caller has already parsed the path into its segments.
 */
export function handleGames(
  recorder: GameplayRecorder | undefined,
  recordings: Recordings,
  segments: readonly string[],
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (segments[0] !== 'api' || segments[1] !== 'games' || segments.length > 3) return false;
  const method = request.method ?? 'GET';
  const tail = segments[2];
  if (recorder === undefined) {
    request.resume();
    json(response, 404, { refused: 'this server records nothing' });
    return true;
  }
  if (tail === undefined) {
    request.resume();
    if (method === 'GET') {
      void recorder.index().then((games) => json(response, 200, { protocol: NETPLAY_PROTOCOL, games }));
    } else if (method === 'POST') mint(recordings, response);
    else json(response, 405, { refused: `${method} is not one this route answers` });
    return true;
  }
  if (method === 'PUT') {
    if (!recordings.open.delete(tail)) {
      request.resume();
      json(response, 404, { refused: 'no game is waiting to be finished under that token' });
      return true;
    }
    void finish(recorder, recordings, request, response).catch((cause: unknown) => {
      json(response, 400, { refused: `the request body could not be read (${String(cause)})` });
    });
    return true;
  }
  request.resume();
  if (method === 'GET') void read(recorder, tail, response);
  else json(response, 405, { refused: `${method} is not one this route answers` });
  return true;
}
