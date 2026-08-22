/**
 * `mtg-11yn`, the fifth row of `docs/design/per-seat-knowledge-log.md` §2: a
 * card the opponent watched on the battlefield does not become a leak by
 * returning to a hand.
 *
 * Seat 0 bounces a creature off seat 1's battlefield. `seatState` drops the
 * object from seat 0's projection, so the card's *name* is gone; the *id* is
 * still in seat 0's cumulative event log, published while the creature was
 * public. `auditSeatPayloads` searches that log for the ids in the other seat's
 * hand, so a correct kernel is reported as leaking a card seat 0 has been
 * looking at all game.
 *
 * A per-event redactor cannot repair that — `seatEvent`'s `zoneChanged` arm
 * already replaces the id for the non-owner, and the finding survives it,
 * because the question is not "may this event name this id" but "may this seat
 * still identify this object". The answer is a license the auditor folds out of
 * `EngineEvent.reveals`, and the kernel's adapter fills that field from the zone
 * the object left rather than from the event's spelling.
 *
 * The second case is the guard on the first: a card that has been in seat 1's
 * hand since the opening earns no license from anything, so a payload naming it
 * is still a finding. Without it, "the audit is quiet" would be satisfied by an
 * adapter that licensed every id it ever wrote down.
 *
 * The second pair is the older entry kind, `handRevealed` (CR 701.16a), driven
 * end to end for the same reason. It is the one case that existed before the
 * `reveals` field did, and the contract suite reaches it only through deltas it
 * builds by hand, which exercise the auditor's fold and not the kernel's fill.
 * So the arm that replaced the deleted `revealedBy` had no test that ran the
 * real reducer, and breaking it left the whole suite green.
 */
import { describe, expect, it } from 'vitest';
import type { EngineEvent, PendingDecision, SeatId, SeatProjection, SessionSpec } from '@mtg/engine';
import { auditSeatPayloads } from '@mtg/engine';
import type { Action, ObjectId, ReduceResult } from '@mtg/kernel';
import { pendingDecision, playerOf, scenario } from '@mtg/kernel';
import { projectDecision, projectState, seatProjection } from '../src/backend-projection';
import { creature, instant, lands, MOUNTAIN, sorcery } from './cards';
import { apply, oidOf } from './helpers';

const TABLE: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'TST' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'local', deck: { name: 'south', cards: [] } },
  ],
  seed: 'knowledge-log/mtg-11yn',
  maximumTurns: 40,
};

const BOUNCE_COST = { generic: 2 } as const;

function bounceCard(): ReturnType<typeof instant> {
  return instant(
    'Undertow Snare',
    [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }],
    BOUNCE_COST,
  );
}

/** Passes priority until the stack is empty, which resolves whatever is on it. */
function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack never emptied');
}

/** The projection each seat would be sent at this position, from the real adapter. */
function projectionOf(run: ReduceResult): SeatProjection {
  return seatProjection({
    state: run.state,
    events: run.events,
    pending: pendingDecision(run.state),
    table: TABLE,
    at: 0,
  });
}

function auditOf(run: ReduceResult, seats: SeatProjection, at: string): ReturnType<typeof auditSeatPayloads> {
  const pending = pendingDecision(run.state);
  const decision: PendingDecision | null = pending === null ? null : projectDecision(run.state, pending);
  return auditSeatPayloads(seats, projectState(run.state, TABLE, [0, 1]), decision, at, TABLE.seed, null);
}

/** The board the design document probed: six lands, a bounce spell, one creature to aim it at. */
function bouncePosition(): { readonly run: ReduceResult; readonly bear: ObjectId } {
  const start = scenario({
    battlefield: [
      ...Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      { card: creature('Void Scout', 2, 2), controller: 1 as const },
    ],
    hands: [[bounceCard()], []],
  });
  const snare = playerOf(start.state, 0).hand[0];
  if (snare === undefined) throw new Error('seat 0 was dealt no spell');
  const bear = oidOf(start.state, 'Void Scout');
  const cast: Action = {
    type: 'castSpell',
    player: 0,
    oid: snare,
    targets: [{ kind: 'permanent', oid: bear }],
  };
  return { run: resolveStack(apply({ state: start.state, events: [...start.events] }, cast)), bear };
}

describe('a creature bounced out of play stays identifiable to the seat that watched it', () => {
  it('leaves no finding, though the id is still in seat 0’s cumulative log', () => {
    const { run, bear } = bouncePosition();
    expect(playerOf(run.state, 1).hand).toContain(bear);

    const seats = projectionOf(run);
    // The two halves of the disagreement the design document measured: the
    // state projector has dropped the object, and the event log has not.
    expect(seats.view(0).seats[1].hand).toBeNull();
    expect(JSON.stringify(seats.events(0))).toContain(JSON.stringify(bear));

    const audit = auditOf(run, seats, 'after the bounce resolved');
    // Not vacuous: seat 1 is holding a card there was something to look for.
    expect(audit.searched).toBeGreaterThan(0);
    expect(audit.findings).toEqual([]);
    // And the license is the reason, recorded where the auditor reads it.
    expect(audit.memo.revealed[1]).toContain(bear);
  });

  it('still reports a card that has been in that hand since the opening', () => {
    const start = scenario({
      battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      hands: [[bounceCard()], [creature('Void Brute', 3, 3)]],
    });
    const held = playerOf(start.state, 1).hand[0];
    if (held === undefined) throw new Error('seat 1 was dealt no card');
    const run: ReduceResult = { state: start.state, events: [...start.events] };
    const honest = projectionOf(run);
    // One appended event naming a card that was never anywhere seat 0 could see
    // it. Nothing about the position changes; only the bytes seat 0 is sent.
    const leaking: SeatProjection = {
      ...honest,
      events: (seat: SeatId): readonly EngineEvent[] => {
        const log = honest.events(seat);
        if (seat !== 0) return log;
        return [
          ...log,
          { seq: log.length, type: 'stray', text: 'a stray leak', detail: { held }, reveals: [] },
        ];
      },
    };

    const audit = auditOf(run, leaking, 'with a fabricated log line');
    expect(audit.searched).toBeGreaterThan(0);
    expect(audit.findings.map((one) => one.detail).join('\n')).toContain(
      `object ${held} is in seat 1's hand and in seat 0's payload`,
    );
    expect(audit.memo.revealed[1]).not.toContain(held);
  });
});

const REVEAL_COST = { generic: 2 } as const;

/**
 * Reveals the hand and then fills it back up, in that order, so the position
 * holds both a card seat 0 was shown and a card in the same hand it was not.
 * The draw arrives after the reveal has already reported the hand, and its
 * `zoneChanged` comes out of the library, which is hidden — nothing licenses it.
 */
function revealCard(): ReturnType<typeof sorcery> {
  return sorcery(
    // Named from the census of card names public tests already type, so this
    // file adds no unclassified name to it.
    'Void Peer',
    [
      { kind: 'revealHand', target: { kind: 'targetOpponent' } },
      { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
    ],
    REVEAL_COST,
  );
}

function revealPosition(): {
  readonly run: ReduceResult;
  readonly shown: readonly ObjectId[];
  readonly drawn: ObjectId;
} {
  const start = scenario({
    battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[revealCard()], [creature('Void Scout', 2, 2), creature('Void Brute', 3, 3)]],
    libraries: [lands(MOUNTAIN, 4), [creature('Void Whelp', 1, 1), ...lands(MOUNTAIN, 3)]],
  });
  const bequest = playerOf(start.state, 0).hand[0];
  if (bequest === undefined) throw new Error('seat 0 was dealt no spell');
  const shown = [...playerOf(start.state, 1).hand];
  const cast: Action = {
    type: 'castSpell',
    player: 0,
    oid: bequest,
    targets: [
      { kind: 'player', player: 1 },
      { kind: 'player', player: 1 },
    ],
  };
  const run = resolveStack(apply({ state: start.state, events: [...start.events] }, cast));
  const drawn = playerOf(run.state, 1).hand.find((oid) => !shown.includes(oid));
  if (drawn === undefined) throw new Error('seat 1 drew nothing after the reveal');
  return { run, shown, drawn };
}

describe('a hand revealed to the table stays identifiable to the seat it was shown to', () => {
  it('leaves no finding for the cards the reveal named', () => {
    const { run, shown, drawn } = revealPosition();
    expect(shown.length).toBeGreaterThan(0);
    expect(playerOf(run.state, 1).hand).toEqual([...shown, drawn]);

    const seats = projectionOf(run);
    // Same disagreement as the bounce, reached the other way: the hand is
    // hidden in the projected state and named in the log that reported it.
    expect(seats.view(0).seats[1].hand).toBeNull();
    for (const oid of shown) {
      expect(JSON.stringify(seats.events(0))).toContain(JSON.stringify(oid));
    }

    const audit = auditOf(run, seats, 'after the hand reveal resolved');
    expect(audit.searched).toBeGreaterThan(0);
    expect(audit.findings).toEqual([]);
    for (const oid of shown) expect(audit.memo.revealed[1]).toContain(oid);
    // And the license stops at the cards the reveal named. Without this the
    // pass above would also be satisfied by a fill that licensed the hand.
    expect(audit.memo.revealed[1]).not.toContain(drawn);
  });

  it('still reports the card drawn into that hand after the reveal', () => {
    const { run, drawn } = revealPosition();
    const honest = projectionOf(run);
    const leaking: SeatProjection = {
      ...honest,
      events: (seat: SeatId): readonly EngineEvent[] => {
        const log = honest.events(seat);
        if (seat !== 0) return log;
        return [
          ...log,
          { seq: log.length, type: 'stray', text: 'a stray leak', detail: { drawn }, reveals: [] },
        ];
      },
    };

    const audit = auditOf(run, leaking, 'with a fabricated line after the reveal');
    expect(audit.searched).toBeGreaterThan(0);
    expect(audit.findings.map((one) => one.detail).join('\n')).toContain(
      `object ${drawn} is in seat 1's hand and in seat 0's payload`,
    );
    expect(audit.memo.revealed[1]).not.toContain(drawn);
  });
});
