/**
 * One seat's end of the wire.
 *
 * The mirror of `routes/play/use-session.ts`, and the differences are the whole
 * of what it means to play across a network:
 *
 *  - **It holds a snapshot, not a session.** There is no `choose` in this file
 *    that reduces anything. A press posts an index and waits to be told what the
 *    game did, because the game is somewhere else.
 *  - **The viewer never moves.** Hot-seat draws the board from the seat being
 *    asked, because the question crosses the table; here the seat is fixed at
 *    the one this browser holds the link for, and the board follows the game
 *    rather than the question.
 *  - **It is never sure it is up to date.** A held request is open for as long
 *    as the table is quiet, and anything can drop it: a laptop lid, a router, a
 *    server restart. So the loop reconnects rather than failing, and `connected`
 *    is a thing the page can say out loud.
 *
 * # The loop
 *
 * Read once, then ask for anything newer than the revision just read. The server
 * answers immediately when it has something and holds the request when it does
 * not, so the ordinary state of a waiting player is one open socket and no
 * traffic. A drop lands in the catch, waits a beat and asks again with the same
 * revision, which is also the whole of reconnection: the request that resumes is
 * identical to the request that dropped.
 *
 * DOM types are reached the way the rest of this package reaches them — through
 * what is actually there rather than through `lib: dom`, which the workspace
 * tsconfig does not load. `fetch` and `AbortController` are in `@types/node`;
 * `Response` is not nameable, so nothing here names it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutoPassSettings, Choice, YieldBoundary } from '@mtg/kernel';
import { asDeclaration } from '@mtg/kernel';
import type { SeatRequest, SeatSnapshot, WireAutoPass } from '@mtg/netplay';
import { readSnapshot } from './snapshot';

/** How long a dropped connection waits before asking again. */
const RETRY_MS = 1_000;

export interface RemoteTableHandle {
  /** Null until the first read lands. */
  readonly snapshot: SeatSnapshot | null;
  /** The last thing that went wrong, or null. Cleared by the next good read. */
  readonly error: string | null;
  /** False while the loop is between attempts, so the page can say so. */
  readonly connected: boolean;
  readonly choose: (choice: Choice) => void;
  readonly setAutoPass: (next: AutoPassSettings) => void;
  readonly yieldTo: (boundary: YieldBoundary) => void;
}

/**
 * `AutoPassSettings` as the wire carries it.
 *
 * Written out here rather than imported from `@mtg/netplay`, because importing
 * it would be a *value* import and this module is bundled for a browser; the
 * package barrel reaches `node:http` through the server. `@mtg/ui` already
 * carries exactly this arrangement for `@mtg/sim`. The cost is these six lines
 * and `packages/ui/test/net/isolation.test.ts` checking they still agree with
 * the other side.
 */
function toWire(settings: AutoPassSettings): WireAutoPass {
  return {
    enabled: settings.enabled,
    passUnstopped: settings.passUnstopped,
    stops: { yourTurn: [...settings.stops.yourTurn], theirTurn: [...settings.stops.theirTurn] },
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function refusalOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'refused' in body) {
    const { refused } = body as { refused: unknown };
    if (typeof refused === 'string') return refused;
  }
  return 'the table refused that';
}

function wait(ms: number): Promise<void> {
  return new Promise<void>((done) => {
    setTimeout(done, ms);
  });
}

export function useRemoteTable(base: string, token: string): RemoteTableHandle {
  const [snapshot, setSnapshot] = useState<SeatSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /**
   * The revision a press should be answering, kept in a ref rather than read out
   * of state.
   *
   * A callback closes over the snapshot it was built with, and on this surface
   * the snapshot changes underneath the player constantly — the opponent moves,
   * the poll lands. A stale closure would post the decision counter from two
   * moves ago, and the table would refuse it correctly and confusingly.
   */
  const held = useRef<SeatSnapshot | null>(null);

  const seatUrl = `${base}/table/${token}`;

  useEffect(() => {
    let live = true;
    const controller = new AbortController();

    const loop = async (): Promise<void> => {
      let since: number | null = null;
      while (live) {
        const url = since === null ? seatUrl : `${seatUrl}/wait?since=${String(since)}`;
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            setConnected(false);
            setError(`the table answered ${String(response.status)}`);
            await wait(RETRY_MS);
            continue;
          }
          const parsed = readSnapshot(await response.json(), 'the table');
          if (!parsed.ok) {
            setConnected(false);
            setError(parsed.message);
            await wait(RETRY_MS);
            continue;
          }
          if (!live) return;
          since = parsed.snapshot.revision;
          held.current = parsed.snapshot;
          setSnapshot(parsed.snapshot);
          setConnected(true);
          setError(null);
        } catch (cause: unknown) {
          if (!live) return;
          setConnected(false);
          setError(messageOf(cause));
          await wait(RETRY_MS);
        }
      }
    };

    void loop();
    return (): void => {
      live = false;
      controller.abort();
    };
  }, [seatUrl]);

  const send = useCallback(
    (request: SeatRequest): void => {
      const post = async (): Promise<void> => {
        try {
          const response = await fetch(seatUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
          });
          const body: unknown = await response.json();
          if (!response.ok) {
            // A refusal is the ordinary answer to a stale click and is shown
            // rather than swallowed: the loop will bring the real position along
            // a moment later, and a button that silently did nothing is the one
            // thing worse than being told why.
            setError(refusalOf(body));
            return;
          }
          const parsed = readSnapshot(body, 'the table');
          if (!parsed.ok) {
            setError(parsed.message);
            return;
          }
          held.current = parsed.snapshot;
          setSnapshot(parsed.snapshot);
          setError(null);
        } catch (cause: unknown) {
          setError(messageOf(cause));
        }
      };
      void post();
    },
    [seatUrl],
  );

  const choose = useCallback(
    (choice: Choice): void => {
      const at = held.current?.decisions ?? 0;
      if (typeof choice === 'number') {
        send({ kind: 'choose', index: choice, at });
        return;
      }
      // Two requests because they are two things the table does: an index
      // addresses the enumeration it just sent, and a declaration is a move the
      // enumeration never listed (`@mtg/kernel`'s `session.ts`). The table takes
      // the seat from the connection whatever the body says.
      const declaration = asDeclaration(choice);
      if (declaration === null) {
        // Nothing on this surface builds a constructed move that is not a
        // combat declaration, so this is a bug rather than a player's mistake —
        // and it is said out loud instead of dropping the press on the floor.
        setError(`this table cannot carry a constructed ${choice.type}`);
        return;
      }
      send({ kind: 'declare', declaration, at });
    },
    [send],
  );

  const yieldTo = useCallback(
    (boundary: YieldBoundary): void => {
      send({ kind: 'yield', boundary, at: held.current?.decisions ?? 0 });
    },
    [send],
  );

  const setAutoPass = useCallback(
    (next: AutoPassSettings): void => {
      send({ kind: 'autoPass', autoPass: toWire(next) });
    },
    [send],
  );

  return { snapshot, error, connected, choose, setAutoPass, yieldTo };
}
