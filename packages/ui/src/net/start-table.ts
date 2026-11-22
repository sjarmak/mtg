/**
 * Dealing a table from the page, which is the whole of what starting one takes.
 *
 * The browser half of `@mtg/netplay`'s create routes. It posts to `/api/tables`,
 * and what comes back is one seat capability: the host's. Everything else about
 * the table — the guest's link, the QR code, whether they have arrived — is read
 * afterwards through `./invite.ts`, from that token.
 *
 * `startRoom` is the same press for a game the two people build themselves: one
 * route over, one seat back, and `./room.ts` reads what it opened. `startDraft`
 * is one route further on, for the room whose pools are drafted before they are
 * built. All three are one module because they differ in a path segment and in
 * nothing else — same body (none), same answer, same reader, same reasons.
 *
 * There is no body. A create request states nothing, because every input to a
 * deal (the set, the written decks, this machine's addresses, the port the page
 * is served on) is a launcher fact and the launcher is what holds the dealer.
 * A page that named a set would be naming one the server may not have.
 *
 * As everywhere else on this seam, the validator is this side's own: the sender
 * is the thing that might be wrong, so a reader that trusted the sender's
 * validator would be checking nothing. A token that is not a string, or a
 * protocol this page does not speak, is a refusal with a reason rather than a
 * navigation to a seat that cannot exist.
 */
import { CLIENT_PROTOCOL } from './snapshot';

/** A dealt seat, or the reason the press did nothing. */
export type TableStart =
  { readonly ok: true; readonly token: string } | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What the server said it dealt, or why this page will not open it. */
export function readTableStart(body: unknown, where: string): TableStart {
  if (!isRecord(body)) return { ok: false, message: `${where} did not answer with an object` };
  const token: unknown = body['token'];
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, message: `${where} dealt a table and named no seat` };
  }
  if (body['protocol'] !== CLIENT_PROTOCOL) {
    return { ok: false, message: `${where} speaks a protocol this page does not` };
  }
  return { ok: true, token };
}

/**
 * The reason a refusal carries, said in the words the server used where it used
 * any.
 *
 * A 429 is the table cap and a 404 is a server with no dealer, and both are
 * states a person can act on — restart the lab, or start it with the launcher
 * that deals. So the body's own `refused` line is preferred over a status code
 * nobody reads, and the code is the fallback rather than the message.
 */
function refusalOf(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['refused'] === 'string') return body['refused'];
  return `the lab answered ${String(status)}`;
}

async function press(base: string, route: string): Promise<TableStart> {
  try {
    const response = await fetch(`${base}/${route}`, { method: 'POST' });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: refusalOf(response.status, body) };
    return readTableStart(body, 'the lab');
  } catch (cause: unknown) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Deals a table with both decks already built. */
export async function startTable(base: string): Promise<TableStart> {
  return press(base, 'tables');
}

/** Opens a room: two sealed pools, and two people who cut their own decks. */
export async function startRoom(base: string): Promise<TableStart> {
  return press(base, 'rooms');
}

/**
 * Opens a room that drafts first: shared packs, then the same build screen.
 *
 * The seat that comes back is a room seat, and `./room.ts` reads it the way it
 * reads any other. What the phase says is what the screen draws, so nothing
 * about this press has to be remembered afterwards.
 */
export async function startDraft(base: string): Promise<TableStart> {
  return press(base, 'drafts');
}
