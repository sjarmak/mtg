/**
 * What arrives from a table, checked before anything draws it.
 *
 * A response body is external data even when the process that wrote it is in
 * this repository. `@mtg/deckbuild`'s artifact reader and the art pipeline's manifest
 * reader are both here for the same reason and this is the third: a stale tab
 * talking to a server that has moved on gets a sentence about which field is
 * wrong rather than a board built out of `undefined`.
 *
 * # Why the shape is declared again here
 *
 * `@mtg/netplay` owns the wire and `import type` from it is erased before Vite
 * sees it, so the *types* are shared and the module never reaches the bundle.
 * The *validator* is this side's own, because a reader that trusted the sender's
 * validator would be checking nothing: the sender is the thing that might be
 * wrong. `NETPLAY_PROTOCOL` is the seam the two sides meet at, and it is
 * repeated below rather than imported for the same reason — a version constant
 * read out of the payload being checked cannot fail a version check.
 *
 * The kernel-typed innards — the state, the log, the pending decision — are not
 * re-validated field by field, and that is a stated limit rather than an
 * oversight. They are `@mtg/kernel` values on both ends of the wire, built by
 * the same version of the same package out of one repository; a second structural
 * parse of a `GameState` here would be a second definition of `GameState` and
 * would go stale the first time the kernel gained a field. What is checked is
 * everything the envelope adds, which is everything this side actually reasons
 * about.
 */
import type { PlayerId, SessionView } from '@mtg/kernel';
import type { SeatSnapshot, WireAutoPass } from '@mtg/netplay';

/**
 * The protocol this page speaks.
 *
 * Bumped with `NETPLAY_PROTOCOL` in `@mtg/netplay`'s `protocol.ts`, together, in
 * one change. `packages/ui/test/net/isolation.test.ts` fails when the two drift.
 */
export const CLIENT_PROTOCOL = 3;

/** Mirrored from protocol v3 and checked against the producer in isolation.test. */
export const MAX_SNAPSHOT_DECISIONS = 200_000;

export type SnapshotResult =
  { readonly ok: true; readonly snapshot: SeatSnapshot } | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSeat(value: unknown): value is PlayerId {
  return value === 0 || value === 1;
}

function isNames(value: unknown): value is readonly [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((name) => typeof name === 'string');
}

function isAutoPass(value: unknown): value is WireAutoPass {
  if (!isRecord(value)) return false;
  if (typeof value['enabled'] !== 'boolean' || typeof value['passUnstopped'] !== 'boolean') return false;
  const stops: unknown = value['stops'];
  if (!isRecord(stops)) return false;
  return Array.isArray(stops['yourTurn']) && Array.isArray(stops['theirTurn']);
}

/** A snapshot off the wire, or the reason this page will not draw it. */
export function readSnapshot(body: unknown, where: string): SnapshotResult {
  if (!isRecord(body)) return { ok: false, message: `${where} did not answer with an object` };
  if (body['protocol'] !== CLIENT_PROTOCOL) {
    return {
      ok: false,
      message:
        `${where} speaks protocol ${JSON.stringify(body['protocol'])} and this page speaks ` +
        `${String(CLIENT_PROTOCOL)}. Reload, or restart the table.`,
    };
  }
  if (!isSeat(body['seat'])) return { ok: false, message: `${where} did not say which seat this is` };
  if (!isNames(body['names'])) return { ok: false, message: `${where} did not name the two seats` };
  if (typeof body['revision'] !== 'number') return { ok: false, message: `${where} sent no revision` };
  if (
    typeof body['decisions'] !== 'number' ||
    !Number.isInteger(body['decisions']) ||
    body['decisions'] < 0 ||
    body['decisions'] > MAX_SNAPSHOT_DECISIONS
  ) {
    return { ok: false, message: `${where} sent no bounded decision count` };
  }
  const choices: unknown = body['choices'];
  if (
    !isRecord(choices) ||
    typeof choices['length'] !== 'number' ||
    !Number.isInteger(choices['length']) ||
    choices['length'] < 0
  ) {
    return { ok: false, message: `${where} sent no choice count` };
  }
  if (choices['length'] > body['decisions']) {
    return { ok: false, message: `${where} sent more choices than decisions` };
  }
  if (!Array.isArray(body['events'])) return { ok: false, message: `${where} sent no event log` };
  if (!isRecord(body['state'])) return { ok: false, message: `${where} sent no position` };
  if (body['awaiting'] !== null && !isSeat(body['awaiting'])) {
    return { ok: false, message: `${where} did not say who the table is waiting on` };
  }
  if (!isAutoPass(body['autoPass'])) return { ok: false, message: `${where} sent no auto-pass settings` };
  return { ok: true, snapshot: body as unknown as SeatSnapshot };
}

/**
 * The snapshot as the thing every play surface already takes.
 *
 * The whole reason `SessionView` exists in the kernel. `PlayView` used to take a
 * `GameSession`, which carries a bot's `decide` function and an undo commitment
 * — neither of which crosses a wire and neither of which it reads. Narrowing it
 * to the six fields it does read means a position that arrived over a network
 * renders through exactly the same component as one played at the keyboard,
 * with nothing fabricated to make the types line up.
 */
export function sessionViewOf(snapshot: SeatSnapshot): SessionView {
  return {
    state: snapshot.state,
    events: snapshot.events,
    result: snapshot.result,
    pending: snapshot.pending,
    decisions: snapshot.decisions,
    // `PlayView` reads only `.length`; no values are fabricated or cross the wire.
    choices: snapshot.choices,
  };
}
