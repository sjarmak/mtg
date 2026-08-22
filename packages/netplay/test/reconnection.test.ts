/**
 * A dropped client, and a dead server.
 *
 * The bead says a client that drops can be handed the log and rebuild, and asks
 * for that to be proved rather than assumed. It is two different claims and they
 * have different proofs.
 *
 * **A client that dropped is the cheap one.** The server holds the session, so
 * reconnecting is asking for the position again. The only thing that has to be
 * true is that a fresh reader gets the same answer as the one that was watching,
 * which is asserted here by taking two snapshots and comparing them.
 *
 * **A server that died is the one the kernel's shape pays for.** `record`
 * returns a seed and a list of integers, `createTable` takes them back, and the
 * claim is that the rebuilt table is the same game rather than a similar one.
 * `replaySession` says that about the position, and the snapshots are compared
 * field by field after replacing concealed placeholders with one marker. The
 * placeholders themselves must differ across processes: equality there would
 * turn a server restart into a way to keep tracking hidden cards.
 */
import { describe, expect, it } from 'vitest';
import type { Choice, GameSetup, Seat } from '@mtg/kernel';
import { humanSeat, replaySession, seatState } from '@mtg/kernel';
import type { SeatSnapshot, Table, TableSpec } from '@mtg/netplay';
import { createTable } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/reconnect/v0', decks: twoDecks(), maximumTurns: 30 };
const seats = (): readonly [Seat, Seat] => [humanSeat('One'), humanSeat('Two')];

function spec(choices?: readonly Choice[]): TableSpec {
  return {
    id: 'reconnect',
    setup: SETUP,
    seats: seats(),
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token: 'token-two' },
    ],
    ...(choices === undefined ? {} : { choices }),
  };
}

function play(live: Table, steps: number): void {
  for (let guard = 0; guard < steps; guard += 1) {
    const owed = live.snapshotFor(0).awaiting;
    if (owed === null) return;
    const owing = live.snapshotFor(owed);
    live.apply(owed, {
      kind: 'choose',
      index: (owing.pending?.options.length ?? 1) - 1,
      at: owing.decisions,
    });
  }
}

/**
 * A snapshot without its revision.
 *
 * The revision counts changes this process has seen, so a table rebuilt on a
 * restarted server is at zero on a position the original reached after two
 * hundred. That is right rather than a discrepancy — a client reconnecting to a
 * new process has to be told the position from scratch — so it is the one field
 * that is not part of "the same game".
 */
function position(snapshot: SeatSnapshot): Omit<SeatSnapshot, 'revision'> {
  const { revision: _revision, ...rest } = snapshot;
  return rest;
}

function withoutConcealedIds<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      typeof entry === 'string' && entry.startsWith('concealed:') ? '<concealed>' : entry,
    ),
  ) as unknown;
}

describe('a client that dropped', () => {
  it('is handed the same position the one that stayed is looking at', () => {
    const live = createTable(spec());
    play(live, 80);
    const watching = live.snapshotFor(0);
    // A reconnect is a second read. Nothing about the table changes because
    // somebody asked twice, which is the whole reason this is cheap.
    const rejoined = live.snapshotFor(0);
    expect(rejoined).toEqual(watching);
  });

  it('gets its own seat back and not the other one', () => {
    const live = createTable(spec());
    play(live, 80);
    const first = live.snapshotFor(0);
    const second = live.snapshotFor(1);
    expect(first.seat).toBe(0);
    expect(second.seat).toBe(1);
    expect(position(first)).not.toEqual(position(second));
  });
});

describe('a table rebuilt from its recording', () => {
  it('lands on the identical position apart from fresh concealed placeholders', () => {
    const live = createTable(spec());
    play(live, 200);
    const record = live.record();
    expect(record.choices.length).toBeGreaterThan(50);

    // Both sides are concealed for the same seat, because that is the value a
    // client is actually handed. Placeholder spelling is removed while lengths
    // and every public object remain in the comparison.
    const replayed = replaySession(SETUP, seats(), record.choices);
    const rebuilt = createTable(spec(record.choices));
    expect(withoutConcealedIds(rebuilt.snapshotFor(0).state)).toEqual(
      withoutConcealedIds(seatState(replayed.state, 0, 'replayed-0')),
    );
    expect(withoutConcealedIds(rebuilt.snapshotFor(1).state)).toEqual(
      withoutConcealedIds(seatState(replayed.state, 1, 'replayed-1')),
    );
    expect(rebuilt.record().choices).toEqual(record.choices);
  });

  it('hands both seats the same facts under fresh process-local placeholders', () => {
    const live = createTable(spec());
    play(live, 200);
    const rebuilt = createTable(spec(live.record().choices));
    for (const seat of [0, 1] as const) {
      const restarted = position(rebuilt.snapshotFor(seat));
      const original = position(live.snapshotFor(seat));
      expect(restarted).not.toEqual(original);
      expect(withoutConcealedIds(restarted)).toEqual(withoutConcealedIds(original));
    }
  });

  it('starts its revisions again, because a new process is a new conversation', () => {
    const live = createTable(spec());
    play(live, 40);
    const rebuilt = createTable(spec(live.record().choices));
    expect(live.revision).toBeGreaterThan(0);
    expect(rebuilt.revision).toBe(0);
  });

  it('carries on from where the recording stopped', () => {
    const live = createTable(spec());
    play(live, 60);
    const rebuilt = createTable(spec(live.record().choices));
    play(rebuilt, 60);
    play(live, 60);
    expect(rebuilt.record().choices).toEqual(live.record().choices);
  });
});
