/**
 * Reporting a finished in-browser game to the lab that served the page.
 *
 * A kernel game played in the browser against a bot finishes on this side of
 * the wire, and the only server that ever sees it is the one it asks. So the
 * page reports it: one `POST /api/games` to be handed a token, one `PUT` under
 * that token carrying the seed, the decks by card id, the seats, every choice
 * and the result it believes it reached. The server re-derives the game from
 * the seed and the choices and keeps its own answer, which is why the body is
 * the smallest claim a kernel game can make rather than the event rows the
 * page could have written (`../../tools/gameplay-recorder.ts` argues it).
 *
 * The sender is structural so a surface can be handed one that records
 * nothing, and the HTTP one never throws: a page served by plain `vite dev`
 * has no `/api`, and a game that could not be recorded is a game that was
 * still played. Every refusal is a sentence the surface can show. As on every
 * other seam in this directory, the validator is this side's own, and the
 * only value import is `./snapshot`'s protocol constant: `@mtg/netplay` is
 * named in type positions only (`../../test/net/isolation.test.ts`).
 */
import type { Choice, DeckList, GameResult, Seat } from '@mtg/kernel';
import type { GameplayFormat, KernelGameWire, WireDeck, WireSeat } from '@mtg/netplay';
import type { PlayConfig } from '../routes/play/use-session';
import { CLIENT_PROTOCOL } from './snapshot';

/** The Vite proxy prefix, the same one the LAN tables are reached under. */
export const DEFAULT_GAMEPLAY_BASE = '/api';

/** What a surface knows about a game the moment it ends. */
export interface FinishedKernelGame {
  readonly config: PlayConfig;
  readonly choices: readonly Choice[];
  readonly result: GameResult;
  readonly format: GameplayFormat;
}

export type GameplayOpened =
  { readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: string };

export type GameplaySent =
  | { readonly status: 'recorded'; readonly id: string }
  | { readonly status: 'refused'; readonly reason: string };

/** The seam: mint a token, then finish under it. Neither call throws. */
export interface GameplaySender {
  open(): Promise<GameplayOpened>;
  finish(token: string, game: FinishedKernelGame): Promise<GameplaySent>;
}

/** What a surface hands `LiveGame`: which format it dealt, and where to send the game. */
export interface GameplayReport {
  readonly format: GameplayFormat;
  readonly sender: GameplaySender;
}

function deckOf(deck: DeckList): WireDeck {
  return { name: deck.name, cardIds: deck.cards.map((card) => card.id) };
}

function seatOf(seat: Seat, name: string): WireSeat {
  return { kind: seat.kind === 'human' ? 'human' : 'bot', name };
}

/** The claim as the server reads it: everything but the cards themselves. */
export function wireOf(game: FinishedKernelGame): KernelGameWire {
  const { decks, ...setup } = game.config.setup;
  const { seats, names } = game.config;
  return {
    protocol: CLIENT_PROTOCOL,
    format: game.format,
    setup,
    decks: [deckOf(decks[0]), deckOf(decks[1])],
    seats: [seatOf(seats[0], names[0]), seatOf(seats[1], names[1])],
    choices: game.choices,
    result: game.result,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The server's own sentence where it wrote one, else the status nobody reads. */
function refusalOf(status: number, body: unknown): string {
  if (isRecord(body)) {
    if (typeof body['message'] === 'string') return body['message'];
    if (typeof body['refused'] === 'string') return body['refused'];
  }
  return `the lab answered ${String(status)}`;
}

function unreachable(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `the lab could not be reached (${message}); games are recorded when the page is served by npm run play`;
}

type Fetch = typeof globalThis.fetch;

/** The one page-side implementation. `fetchImpl` is injectable for tests. */
export function httpGameplaySender(
  base: string = DEFAULT_GAMEPLAY_BASE,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): GameplaySender {
  return {
    async open(): Promise<GameplayOpened> {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/games`, { method: 'POST' });
      } catch (cause: unknown) {
        return { ok: false, reason: unreachable(cause) };
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 404) return { ok: false, reason: 'this lab is not recording games' };
      if (!response.ok) return { ok: false, reason: refusalOf(response.status, body) };
      if (!isRecord(body) || typeof body['token'] !== 'string' || body['token'] === '') {
        return { ok: false, reason: 'the lab answered without a token' };
      }
      if (body['protocol'] !== CLIENT_PROTOCOL) {
        return { ok: false, reason: 'the lab speaks a protocol this page does not' };
      }
      return { ok: true, token: body['token'] };
    },
    async finish(token: string, game: FinishedKernelGame): Promise<GameplaySent> {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/games/${encodeURIComponent(token)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(wireOf(game)),
        });
      } catch (cause: unknown) {
        return { status: 'refused', reason: unreachable(cause) };
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) return { status: 'refused', reason: refusalOf(response.status, body) };
      if (!isRecord(body) || typeof body['id'] !== 'string' || body['id'] === '') {
        return { status: 'refused', reason: 'the lab recorded the game and named no id' };
      }
      return { status: 'recorded', id: body['id'] };
    },
  };
}

let shared: GameplaySender | null = null;

/** The report a surface hands `LiveGame` for a game it dealt: one sender for the page. */
export function gameplayReport(format: GameplayFormat): GameplayReport {
  shared ??= httpGameplaySender();
  return { format, sender: shared };
}
