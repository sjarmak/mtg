/**
 * What `server.ts`, `games-route.ts` and `observed-routes.ts` answer with,
 * shared so every arm of one server writes the same bytes the same way.
 *
 * Node-only, like both callers. Nothing here knows what a table is: `hold` is
 * typed on the two members a long poll needs, a revision and a way to watch
 * it, and the caller hands it the answer to send.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { InviteResponse, InviteSeat, TableInvite } from './protocol';

/** A request body past this is refused unread; a choice is a hundred bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * The default is the seat routes' ceiling, and a caller that reads something
 * else states its own: `games-route.ts` takes a whole finished game, which is
 * `MAX_GAME_BODY_BYTES` rather than a choice.
 */

/** What a long poll needs of a table: where it is, and a way to hear it move. */
export interface Pollable {
  readonly revision: number;
  watch(listener: () => void): () => void;
}

export function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    // A position is true for one revision. A cached one is a board that has
    // stopped moving, which on this surface looks exactly like a game nobody is
    // playing.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * The body, or the reason there is none.
 *
 * Capped and counted as it arrives rather than after, because a body that is
 * refused only once it has all been buffered has already been accepted.
 */
export async function readBody(
  request: IncomingMessage,
  limit = MAX_BODY_BYTES,
): Promise<string | { readonly tooLarge: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) return { tooLarge: true };
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Answers once the table has moved, or once the wait is up.
 *
 * The whole of the push half of this protocol. A client asks with the revision
 * it last drew; if the table is already past it the caller answers at once, and
 * otherwise the request is held here. Three things can end it and each of them
 * ends it exactly once, the table changed, the timer expired, or the client
 * went away, because a response written twice is a socket error and a table
 * whose listener set never shrinks is a leak the length of the game.
 */
export function hold(
  table: Pollable,
  pollMs: number,
  request: IncomingMessage,
  response: ServerResponse,
  answer: () => unknown,
): void {
  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    unwatch();
    request.off('close', finish);
    if (!response.writableEnded) json(response, 200, answer());
  };
  const timer = setTimeout(finish, pollMs);
  const unwatch = table.watch(finish);
  request.on('close', finish);
}

/**
 * Which seats have ever asked this server for a position.
 *
 * Read by the invite route and by nothing else, so a host's page can say
 * *Sam joined* rather than leaving the one question it is open to answer
 * unanswered. It is a set of seat numbers rather than a timestamp per seat: the
 * question is whether the link was ever opened, and a phone that locked its
 * screen has not stopped being a player.
 */
export function inviteFor(invite: TableInvite, seat: number, joined: ReadonlySet<number>): InviteResponse {
  if (seat !== invite.hostSeat) return { host: false };
  const guests: InviteSeat[] = invite.guests.map((guest, index) => ({
    ...guest,
    joined: joined.has(seatOfGuest(invite, index)),
  }));
  return { host: true, guests };
}

/**
 * The seat number a guest entry describes.
 *
 * `guests` is the seat list with the host taken out, so an index into it is one
 * short of a seat number once it passes the host. Derived rather than carried,
 * because a guest that stated its own seat could state the host's.
 */
function seatOfGuest(invite: TableInvite, index: number): number {
  return index < invite.hostSeat ? index : index + 1;
}
