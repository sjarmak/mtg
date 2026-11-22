/**
 * The links this seat may hand out, and whether anything is listening at all.
 *
 * The browser half of `@mtg/netplay`'s invite route. `remote-table.ts` beside it
 * is the game; this is the thing that has to happen before there is one, which
 * is getting the other player's link onto the other player's device.
 *
 * # Two questions, two hooks
 *
 * `useInvite` is asked by somebody already sitting at a table: it holds a seat
 * link, and the answer is either *you are the host, here is what to hand out*
 * or *you are the guest, there is nothing for you to hand out*. The server
 * decides which, from the token, and this side cannot ask for the other answer.
 *
 * `useTableRunning` is asked by somebody who is not at a table and may not know
 * one can exist: it is a `/api/health` probe, and its whole job is to tell the
 * Play chooser which of three things to draw — a button that deals a table, a
 * line saying one is already running, or the command that starts a lab which
 * can deal one. The server answers `deals`, so the difference between the first
 * and the third is read off the wire rather than assumed from the fact that
 * something answered. `./start-table.ts` is the press.
 *
 * # The poll stops
 *
 * The invite carries `joined` per guest, so the panel can say *Sam is here*
 * rather than leaving the host wondering whether the link worked. That is the
 * only thing about an invite that changes, so the poll runs while a guest has
 * not arrived and stops once they all have. A fixed interval that ran for the
 * length of the game would be a request every few seconds asking a question
 * whose answer can no longer change.
 *
 * As in `snapshot.ts`, the validator is this side's own: the sender is the thing
 * that might be wrong, so a reader that trusted the sender's validator would be
 * checking nothing.
 */
import { useEffect, useState } from 'react';
import type { InviteLink, InviteResponse, InviteSeat } from '@mtg/netplay';
import { OBSERVED_CLIENT_PROTOCOL } from './observed-table';
import { CLIENT_PROTOCOL } from './snapshot';

/** How long between asks while a guest has still not opened their link. */
const INVITE_POLL_MS = 3_000;

export type InviteResult =
  { readonly ok: true; readonly invite: InviteResponse } | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLink(value: unknown): InviteLink | null {
  if (!isRecord(value)) return null;
  const { label, url } = value;
  if (typeof label !== 'string' || typeof url !== 'string') return null;
  return { label, url };
}

function readSeat(value: unknown): InviteSeat | null {
  if (!isRecord(value)) return null;
  const { name, links, joined } = value;
  if (typeof name !== 'string' || typeof joined !== 'boolean' || !Array.isArray(links)) return null;
  const read: InviteLink[] = [];
  for (const entry of links) {
    const link = readLink(entry);
    if (link === null) return null;
    read.push(link);
  }
  return { name, links: read, joined };
}

/** An invite off the wire, or the reason this page will not draw it. */
export function readInvite(body: unknown, where: string): InviteResult {
  if (!isRecord(body)) return { ok: false, message: `${where} did not answer with an object` };
  if (body['host'] === false) return { ok: true, invite: { host: false } };
  if (body['host'] !== true) return { ok: false, message: `${where} did not say whether this seat hosts` };
  const guests: unknown = body['guests'];
  if (!Array.isArray(guests)) return { ok: false, message: `${where} named no seats to invite` };
  const read: InviteSeat[] = [];
  for (const entry of guests) {
    const seat = readSeat(entry);
    if (seat === null) return { ok: false, message: `${where} sent a seat this page cannot read` };
    read.push(seat);
  }
  return { ok: true, invite: { host: true, guests: read } };
}

export interface InviteHandle {
  /** Null until the first answer lands, or when there is nothing to hand out. */
  readonly invite: InviteResponse | null;
  /** The last thing that went wrong, or null. Cleared by the next good read. */
  readonly error: string | null;
}

/**
 * Whether every guest has opened their link, which is when the poll can stop.
 *
 * Nothing yet is *not* settled, which is the whole reason this is a function
 * rather than a condition inlined at the hook: a null invite reads like an empty
 * one, and treating it as finished stops the poll before it has asked anything.
 * A seat that is not the host is finished, though — there is nothing about
 * `{ host: false }` that a later answer can change.
 */
function allJoined(invite: InviteResponse | null): boolean {
  if (invite === null) return false;
  if (!invite.host) return true;
  return invite.guests.every((guest) => guest.joined);
}

/**
 * What this seat may hand out.
 *
 * A 404 is not an error here and does not draw one: a table dealt without links
 * (`serveTable` takes no invite) is a table played entirely from links somebody
 * already has, and the panel simply is not drawn. Anything else that goes wrong
 * says so, because a host waiting on a link that never appears is entitled to
 * know it is the server rather than their patience.
 */
/** Which arm of the server the seat is at: a kernel table, or a Forge table over the LAN. */
export type InviteRoute = 'table' | 'observed';

export function useInvite(base: string, token: string, route: InviteRoute = 'table'): InviteHandle {
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settled = allJoined(invite);

  useEffect(() => {
    if (settled) return undefined;
    let live = true;
    const controller = new AbortController();

    const ask = async (): Promise<void> => {
      try {
        const response = await fetch(`${base}/${route}/${token}/invite`, { signal: controller.signal });
        if (!live) return;
        if (response.status === 404) {
          setInvite({ host: false });
          setError(null);
          return;
        }
        if (!response.ok) {
          setError(`the table answered ${String(response.status)}`);
          return;
        }
        const parsed = readInvite(await response.json(), 'the table');
        if (!live) return;
        if (!parsed.ok) {
          setError(parsed.message);
          return;
        }
        setInvite(parsed.invite);
        setError(null);
      } catch (cause: unknown) {
        // The abort on unmount lands here too, and `live` is what tells the two
        // apart: a page that is going away has nothing to report.
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void ask();
    const timer = setInterval(() => {
      void ask();
    }, INVITE_POLL_MS);
    return (): void => {
      live = false;
      clearInterval(timer);
      controller.abort();
    };
  }, [base, token, route, settled]);

  return { invite, error };
}

/**
 * What a `/api/health` probe found, before it has found anything.
 *
 * `seated` and `dealing` are both a game server answering; the difference is
 * whether it will deal a table on request. A lab started by `npm run play`
 * deals; the server `npm run netplay` starts is holding a table it already
 * dealt and printed links for, and a page that offered to start a second one
 * there would be offering to replace the game somebody came to play.
 */
export type TableRunning = 'asking' | 'none' | 'seated' | 'dealing';

/**
 * What the lab on this origin can make, which is two questions and not one.
 *
 * `rooms` is read separately from `deals` because a lab can deal a table without
 * knowing what a room is — every launcher between the Play button and the build
 * screen is exactly that — and a page that inferred one from the other would
 * draw a button that 404s. `drafts` is a third question for the third reason:
 * the lab that opens sealed rooms shipped before the one that drafts them, so a
 * page that read a drafting room off `rooms` would draw a button that 404s on
 * every lab in between.
 */
export interface TableServer {
  readonly running: TableRunning;
  /** Whether `POST /api/rooms` will open a room here. False while asking. */
  readonly rooms: boolean;
  /** Whether `POST /api/drafts` will open a drafting room. False while asking. */
  readonly drafts: boolean;
  /**
   * The formats `POST /api/observed` seats a Forge table for, or null when this
   * server has no observed arm, speaks another observed protocol, or is still
   * being asked.
   */
  readonly observed: readonly string[] | null;
}

/** The observed arm's advertisement off the health answer, or null when it made none this page can use. */
export function readObservedFormats(body: unknown): readonly string[] | null {
  if (!isRecord(body) || !isRecord(body['observed'])) return null;
  const observed = body['observed'];
  const formats = observed['formats'];
  if (observed['protocol'] !== OBSERVED_CLIENT_PROTOCOL || !Array.isArray(formats)) return null;
  return formats.every((format) => typeof format === 'string') ? formats : null;
}

/**
 * Whether a game server answers on this origin, and what it will make.
 *
 * Asked once. Nothing this probe reads changes while the page is open: a lab
 * that deals goes on dealing, and a table started from a terminal is opened by
 * following the link it printed, which is a navigation rather than a state this
 * page would have to notice.
 */
export function useTableServer(base: string): TableServer {
  const [state, setState] = useState<TableRunning>('asking');
  const [rooms, setRooms] = useState(false);
  const [drafts, setDrafts] = useState(false);
  const [observed, setObserved] = useState<readonly string[] | null>(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();

    const probe = async (): Promise<void> => {
      try {
        const response = await fetch(`${base}/health`, { signal: controller.signal });
        if (!live) return;
        if (!response.ok) {
          setState('none');
          return;
        }
        const body: unknown = await response.json();
        if (!live) return;
        // A server answering something else on this path is not a table. The
        // protocol check is the same seam `readSnapshot` uses, for the same
        // reason: an older launcher left running is a real state.
        const ok = isRecord(body) && body['ok'] === true && body['protocol'] === CLIENT_PROTOCOL;
        if (!ok) {
          setState('none');
          return;
        }
        setRooms(isRecord(body) && body['rooms'] === true);
        setDrafts(isRecord(body) && body['drafts'] === true);
        setObserved(readObservedFormats(body));
        // Absent reads as `seated`, which is what a launcher older than the
        // create route is: it answers health, it holds a table, and posting to
        // it would 404.
        setState(isRecord(body) && body['deals'] === true ? 'dealing' : 'seated');
      } catch {
        if (!live) return;
        setState('none');
      }
    };

    void probe();
    return (): void => {
      live = false;
      controller.abort();
    };
  }, [base]);

  return { running: state, rooms, drafts, observed };
}

/** Just the three-state answer, for callers with nothing to ask about rooms. */
export function useTableRunning(base: string): TableRunning {
  return useTableServer(base).running;
}
