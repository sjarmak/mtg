/**
 * The pre-game room, from the page: your pool, your deck, and the wait.
 *
 * The browser half of `@mtg/netplay`'s room routes. A table dealt by `POST
 * /api/tables` arrives with both decks already built; a room arrives with two
 * sealed pools and nothing else, and the two people in it cut their own decks
 * before there is a game. `./start-table.ts` opens one, this reads it, and
 * `../routes/play/RemoteSealed.ts` is the screen.
 *
 * # The pool crosses as ids, and the room says what they are printed in
 *
 * `RoomView.pool` is a list of card ids in pool order, because a 90-card pool
 * repeated every two seconds is a lot of set to send twice. What it is *not* is
 * an assumption that the page already holds those cards: the lab stages every
 * set it found and lets a person switch between them, so whatever set this tab
 * has open is a fact about the reader, and a room dealt from one set read by a
 * tab on another refused a pool that was perfectly good (`mtg-77i6`). So the
 * room serves the set it dealt from, `useRoomSet` fetches it once per token,
 * and the ids resolve against that.
 *
 * A build goes back as indices into that same list. The page never names a card
 * it wants to play, which is what makes playing a card the pool never held
 * unsayable rather than merely refused.
 *
 * # The poll stops when the game starts
 *
 * The one thing a building seat is waiting for is the other seat, so the poll
 * runs while the phase is `build` and stops the moment it is not. After that the
 * board has its own poll (`./remote-table.ts`) and this one would be asking a
 * question whose answer can no longer change.
 *
 * As everywhere on this seam, the validator is this side's own: the sender is
 * the thing that might be wrong.
 */
import { useEffect, useState } from 'react';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { RoomBuild, RoomPackView, RoomPhase, RoomSeatView, RoomView } from '@mtg/netplay';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DRAFTMANCER_SIMPLE_BOT_POLICY } from '@mtg/draft-export';
import type { NativeDraftBotPolicy } from '@mtg/draft-export';
import { CLIENT_PROTOCOL } from './snapshot';

/** How long between asks while the other seat is still building. */
export const ROOM_POLL_MS = 2_000;

export type RoomResult =
  { readonly ok: true; readonly view: RoomView } | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPhase(value: unknown): RoomPhase | null {
  return value === 'draft' || value === 'build' || value === 'playing' ? value : null;
}

function readDraftBotPolicy(value: unknown, phase: RoomPhase): NativeDraftBotPolicy | null | 'unreadable' {
  if (phase !== 'draft' && (value === null || value === undefined)) return null;
  if (phase === 'draft' && value === undefined) return DRAFTMANCER_SIMPLE_BOT_POLICY;
  if (value === DEFAULT_NATIVE_DRAFT_BOT_POLICY || value === DRAFTMANCER_SIMPLE_BOT_POLICY) return value;
  return 'unreadable';
}

/**
 * The pack in front of this seat, or null when it owes no pick.
 *
 * Absent and null are the same answer — a room that is not drafting sends no
 * pack — and the third case is a pack this page cannot read, which is a
 * refusal rather than a silent nothing: drawing "waiting for the other player"
 * over a pack somebody is owed is the one wrong screen here.
 */
function readPack(value: unknown): RoomPackView | null | 'unreadable' {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return 'unreadable';
  const { cards, round, pickNumber } = value;
  if (!Number.isSafeInteger(round) || !Number.isSafeInteger(pickNumber)) return 'unreadable';
  if (typeof round !== 'number' || typeof pickNumber !== 'number') return 'unreadable';
  const read = readPool(cards);
  if (read === null) return 'unreadable';
  return { cards: read, round, pickNumber };
}

function readSeats(value: unknown): readonly RoomSeatView[] | null {
  if (!Array.isArray(value)) return null;
  const read: RoomSeatView[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { name, ready } = entry;
    if (typeof name !== 'string' || typeof ready !== 'boolean') return null;
    read.push({ name, ready });
  }
  return read;
}

function readPool(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const read: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) return null;
    read.push(entry);
  }
  return read;
}

/** A room off the wire, or the reason this page will not draw it. */
export function readRoomView(body: unknown, where: string): RoomResult {
  if (!isRecord(body)) return { ok: false, message: `${where} did not answer with an object` };
  if (body['protocol'] !== CLIENT_PROTOCOL) {
    return { ok: false, message: `${where} speaks a protocol this page does not` };
  }
  const phase = readPhase(body['phase']);
  if (phase === null) return { ok: false, message: `${where} did not say what the room is doing` };
  const seat: unknown = body['seat'];
  if (seat !== 0 && seat !== 1) return { ok: false, message: `${where} did not say which seat this is` };
  const seats = readSeats(body['seats']);
  if (seats === null) return { ok: false, message: `${where} sent a seat this page cannot read` };
  const pool = readPool(body['pool']);
  if (pool === null) return { ok: false, message: `${where} sent a pool this page cannot read` };
  const { room, revision, deckSize } = body;
  if (typeof room !== 'string') return { ok: false, message: `${where} did not name the room` };
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
    return { ok: false, message: `${where} did not number the room` };
  }
  if (typeof deckSize !== 'number' || !Number.isSafeInteger(deckSize) || deckSize <= 0) {
    return { ok: false, message: `${where} did not say how big a deck it plays` };
  }
  const pack = readPack(body['pack']);
  if (pack === 'unreadable') return { ok: false, message: `${where} sent a pack this page cannot read` };
  const rounds: unknown = body['rounds'];
  if (rounds !== undefined && (typeof rounds !== 'number' || !Number.isSafeInteger(rounds) || rounds < 0)) {
    return { ok: false, message: `${where} did not say how many packs it deals` };
  }
  const draftBotPolicy = readDraftBotPolicy(body['draftBotPolicy'], phase);
  if (draftBotPolicy === 'unreadable') {
    return { ok: false, message: `${where} sent an unknown draft bot policy` };
  }
  return {
    ok: true,
    view: {
      protocol: CLIENT_PROTOCOL,
      room,
      phase,
      seat,
      seats,
      revision,
      pool,
      deckSize,
      pack,
      rounds: rounds ?? 0,
      draftBotPolicy,
    },
  };
}

export interface RoomHandle {
  /** Null until the first answer lands. */
  readonly view: RoomView | null;
  /** The last thing that went wrong, or null. Cleared by the next good read. */
  readonly error: string | null;
}

/**
 * This seat's room, polled until the game it becomes has started.
 *
 * An error does not stop the poll. The two things that fail here are a lab that
 * went away and a network that blinked, and the second one recovers by asking
 * again; a hook that gave up on the first failure would leave somebody who had
 * already submitted staring at a screen that had stopped listening.
 */
export function useRoom(base: string, token: string): RoomHandle {
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = view !== null && view.phase === 'playing';

  useEffect(() => {
    if (started) return undefined;
    let live = true;
    const controller = new AbortController();

    const ask = async (): Promise<void> => {
      try {
        const response = await fetch(`${base}/room/${token}`, { signal: controller.signal });
        if (!live) return;
        if (!response.ok) {
          setError(`the room answered ${String(response.status)}`);
          return;
        }
        const parsed = readRoomView(await response.json(), 'the room');
        if (!live) return;
        if (!parsed.ok) {
          setError(parsed.message);
          return;
        }
        setView(parsed.view);
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
    }, ROOM_POLL_MS);
    return (): void => {
      live = false;
      clearInterval(timer);
      controller.abort();
    };
  }, [base, token, started]);

  return { view, error };
}

export type RoomSetResult =
  { readonly ok: true; readonly cards: readonly Card[] } | { readonly ok: false; readonly message: string };

/**
 * The room's own set off the wire, or the reason this page will not draw it.
 *
 * Every card goes through `parseCard`, for the reason the staged set does: a
 * list this page half-reads is a board that fails somewhere in the middle of
 * rendering, and one refusal now beats one blank card later. A room that sends
 * no cards is a refusal too — the pool would resolve against nothing, and
 * "waiting" over an empty screen is the wrong thing to say about a set that
 * never arrived.
 */
export function readRoomSet(body: unknown, where: string): RoomSetResult {
  if (!isRecord(body)) return { ok: false, message: `${where} did not answer with an object` };
  if (body['protocol'] !== CLIENT_PROTOCOL) {
    return { ok: false, message: `${where} speaks a protocol this page does not` };
  }
  const cards: unknown = body['cards'];
  if (!Array.isArray(cards) || cards.length === 0) {
    return { ok: false, message: `${where} sent no cards` };
  }
  try {
    return { ok: true, cards: cards.map((card: unknown) => parseCard(card)) };
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, message: `${where} sent a set this page cannot read: ${detail}` };
  }
}

export interface RoomSetHandle {
  /** Null until the set lands, and null if it never does. */
  readonly cards: readonly Card[] | null;
  /** Why it will not land, or null. Both null at once means it has not yet. */
  readonly error: string | null;
}

/**
 * The set this room deals from, fetched once.
 *
 * Once, not polled: a room's set is fixed when it is opened, so asking again
 * would be asking a question whose answer cannot change. That is also why it is
 * a route of its own rather than a field on the view — the view is the thing
 * that changes every two seconds, and a set does not belong in it.
 *
 * A failure here is terminal for this screen and is meant to be: without the
 * set there is no pool to draw, so the screen says so rather than falling back
 * to whatever set the tab happens to have open, which is the bug this route
 * exists to close.
 */
export function useRoomSet(base: string, token: string): RoomSetHandle {
  const [cards, setCards] = useState<readonly Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setCards(null);
    setError(null);

    const ask = async (): Promise<void> => {
      try {
        const response = await fetch(`${base}/room/${token}/set`, { signal: controller.signal });
        if (!live) return;
        if (!response.ok) {
          setError(`the room answered ${String(response.status)} for its set`);
          return;
        }
        const parsed = readRoomSet(await response.json(), "the room's set");
        if (!live) return;
        if (!parsed.ok) {
          setError(parsed.message);
          return;
        }
        setCards(parsed.cards);
        setError(null);
      } catch (cause: unknown) {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void ask();
    return (): void => {
      live = false;
      controller.abort();
    };
  }, [base, token]);

  return { cards, error };
}

/** What came back from sending a deck: the room as it now stands, or a reason. */
export type BuildSent =
  | { readonly ok: true; readonly view: RoomView }
  | { readonly ok: false; readonly message: string; readonly view: RoomView | null };

/**
 * Sends this seat's deck.
 *
 * A refusal carries the room beside its sentence, so a screen that was told *no*
 * does not then have to ask what it is looking at; that is the same bargain the
 * play route strikes with a refused decision. When the refusal is unreadable —
 * an older lab, a proxy answering for something else — the sentence still gets
 * through and the view is simply absent.
 */
export async function submitBuild(base: string, token: string, build: RoomBuild): Promise<BuildSent> {
  return send(base, token, JSON.stringify(build));
}

/**
 * Takes a card out of the pack in front of this seat, by position.
 *
 * The same route and the same answer as a build, because the room already knows
 * which of the two it is asking for: a page that had to say *this is a pick*
 * could say it in a phase where it is not one. What crosses is one number.
 */
export async function sendPick(base: string, token: string, pick: number): Promise<BuildSent> {
  return send(base, token, JSON.stringify({ pick }));
}

async function send(base: string, token: string, payload: string): Promise<BuildSent> {
  try {
    const response = await fetch(`${base}/room/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const refused =
        isRecord(body) && typeof body['refused'] === 'string'
          ? body['refused']
          : `the room answered ${String(response.status)}`;
      const beside = isRecord(body) ? readRoomView(body['room'], 'the room') : null;
      return { ok: false, message: refused, view: beside !== null && beside.ok ? beside.view : null };
    }
    const parsed = readRoomView(body, 'the room');
    if (!parsed.ok) return { ok: false, message: parsed.message, view: null };
    return { ok: true, view: parsed.view };
  } catch (cause: unknown) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause), view: null };
  }
}
