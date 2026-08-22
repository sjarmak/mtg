/**
 * What the attacking seat is told while a block is being assembled.
 *
 * `mtg-nj6m`. Sequencing one `declareBlockers` decision into one submit per
 * blocker (`mtg-cs8t`, stage 2) gives the table k positions where it had one,
 * and every one of them is announced: `apply` bumps the revision and wakes the
 * held poll, so the attacking seat is handed each intermediate position by the
 * same projection that hides hidden information. Whether that projection names a
 * block the attacker should not yet know about was filed as unmeasured. This
 * file measures it.
 *
 * **The identity instruments do not answer this question, and the first
 * assertion below is the reason.** `hidden-information.test.ts` searches the
 * payload for a card the seat may not identify, and `@mtg/engine`'s
 * `auditSeatPayloads` folds a per-seat license over `EngineEvent.reveals` and
 * searches for object ids. A blocker is a creature that has been face up on the
 * battlefield all game: its id and its name are already in the attacker's
 * payload before the defender has decided anything, so both searches report
 * "present" at the position where nothing has been declared and at the position
 * where a block has, and neither can tell them apart. What moves is not an
 * identity but a *relation* — which blocker is on which attacker — and that is
 * what is counted here.
 *
 * The finished measurement is three numbers and a set difference; the reading is
 * in `docs/design/blocker-sequence-commitment.md`.
 */
import { describe, expect, it } from 'vitest';
import type { BlockDeclaration, Choice, GameSetup, GameState, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, replaySession, seatState } from '@mtg/kernel';
import type { SeatSnapshot, Table, WireAutoPass } from '@mtg/netplay';
import { createTable, readSeatRequest } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/blocker-sequence/v0', decks: twoDecks(), maximumTurns: 30 };

const FULL_CONTROL: WireAutoPass = {
  enabled: false,
  passUnstopped: true,
  stops: { yourTurn: [], theirTurn: [] },
};

function tableOn(choices?: readonly Choice[]): Table {
  return createTable({
    id: 'blocker-sequence',
    setup: SETUP,
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token: 'token-two' },
    ],
    ...(choices === undefined ? {} : { choices }),
  });
}

/**
 * Both seats off auto-pass, so a submitted declaration does not settle the rest
 * of the combat before anybody is handed a snapshot.
 *
 * Under the table's default the settle loop runs on from the declaration to the
 * end of the game, and what would be measured is the wreckage afterwards rather
 * than the block. It is set on the fork rather than on the driven game because
 * the driver wants the default: a game asked about every priority takes far
 * longer to reach a combat, and the recording is what carries over.
 */
function holdStill(live: Table): Table {
  for (const seat of [0, 1] as const) live.apply(seat, { kind: 'autoPass', autoPass: FULL_CONTROL });
  return live;
}

/** Every blocker-on-attacker pair a position holds, as sortable text. */
function blockRelation(state: GameState): readonly string[] {
  const pairs: string[] = [];
  for (const block of state.combat.blocks) {
    for (const blocker of block.blockers) pairs.push(`${blocker} blocks ${block.attacker}`);
  }
  return [...pairs].sort();
}

interface Position {
  /** The recording up to the declaration, which every fork below replays. */
  readonly prefix: readonly Choice[];
  readonly defender: PlayerId;
  readonly attacker: PlayerId;
  /** Two blockers that may each block, and an attacker each may block. */
  readonly first: BlockDeclaration;
  readonly second: BlockDeclaration;
}

/**
 * A real game driven to a declaration with two blockers in it.
 *
 * Driven rather than constructed, because the claim is about what a table sends
 * and a table takes a deal and a recording, not a board. The largest option at
 * every decision is the same driver `hidden-information.test.ts` uses and for
 * the same reason: it plays lands, casts creatures and attacks, so the game
 * reaches a combat instead of two seats passing at each other.
 */
function reachedDeclaration(): Position {
  const live = tableOn();
  for (let guard = 0; guard < 4000; guard += 1) {
    const owed = live.snapshotFor(0).awaiting;
    if (owed === null) break;
    const owing = live.snapshotFor(owed);
    const pending = owing.pending;
    if (pending === null) throw new Error('a seat was named as owing a decision it was not sent');
    if (pending.kind === 'declareBlockers' && pending.candidates.length >= 2) {
      const [first, second] = pending.candidates;
      if (first === undefined || second === undefined) throw new Error('unreachable');
      const firstAttacker = first.attackers[0];
      const secondAttacker = second.attackers[1] ?? second.attackers[0];
      if (firstAttacker === undefined || secondAttacker === undefined) {
        throw new Error('a candidate blocker was offered no attacker to block');
      }
      return {
        prefix: live.record().choices,
        defender: owed,
        attacker: owed === 0 ? 1 : 0,
        first: { blocker: first.blocker, attacker: firstAttacker },
        second: { blocker: second.blocker, attacker: secondAttacker },
      };
    }
    live.apply(owed, { kind: 'choose', index: pending.options.length - 1, at: owing.decisions });
  }
  throw new Error('the driven game never reached a declaration with two blockers in it');
}

/** The attacking seat's payload after the defender declares exactly these blocks. */
function declaredBy(position: Position, blocks: readonly BlockDeclaration[]): SeatSnapshot {
  const live = holdStill(tableOn(position.prefix));
  const at = live.snapshotFor(position.defender).decisions;
  const refusal = live.apply(position.defender, {
    kind: 'declare',
    declaration: { type: 'declareBlockers', player: position.defender, blocks },
    at,
  });
  if (refusal !== null) throw new Error(`the table refused the declaration: ${refusal.refused}`);
  return live.snapshotFor(position.attacker);
}

const POSITION = reachedDeclaration();

describe('a block assembled one blocker at a time', () => {
  it('is not a question the identity instruments can be asked', () => {
    const live = tableOn(POSITION.prefix);
    const before = live.snapshotFor(POSITION.attacker);
    const wire = JSON.stringify(before);

    // Both creatures are on the battlefield and both ids are in the attacking
    // seat's bytes, at a position where the defender has declared nothing. A
    // search for either id is already true here, so it stays true after a
    // block and reports the same thing about both positions.
    expect(wire).toContain(JSON.stringify(POSITION.first.blocker));
    expect(wire).toContain(JSON.stringify(POSITION.second.blocker));
    // The relation is empty at the same position, which is what makes it the
    // instrument: it has somewhere to move to.
    expect(blockRelation(before.state)).toEqual([]);
  });

  it('shows the attacking seat each blocker as it is assigned', () => {
    const increment = declaredBy(POSITION, [POSITION.first]);

    expect(blockRelation(increment.state)).toEqual([
      `${POSITION.first.blocker} blocks ${POSITION.first.attacker}`,
    ]);
    // Sent to the seat that did not declare it, which is the whole exposure.
    // The analogue differs from a sequence interior in one way and it is the
    // harmless one: the kernel considers this declaration finished, so the
    // attacker is handed priority as well. Mid-sequence it would be handed the
    // block and nothing to do with it, which the last test in this block shows.
    expect(increment.seat).toBe(POSITION.attacker);
    expect(increment.state.combat.attacks.map((attack) => attack.oid)).toContain(POSITION.first.attacker);
  });

  it('is announced to that seat rather than sitting on the server until the block is finished', () => {
    const live = holdStill(tableOn(POSITION.prefix));
    const before = live.revision;
    let woken = 0;
    const stop = live.watch(() => {
      woken += 1;
    });
    const at = live.snapshotFor(POSITION.defender).decisions;
    const refusal = live.apply(POSITION.defender, {
      kind: 'declare',
      declaration: { type: 'declareBlockers', player: POSITION.defender, blocks: [POSITION.first] },
      at,
    });
    stop();

    expect(refusal).toBeNull();
    // A held poll returns on a revision it has not seen, so one increment is one
    // delivery to both seats. Six increments are six.
    expect(woken).toBe(1);
    expect(live.revision).toBeGreaterThan(before);
  });

  it('names it at the position the sequence would actually stop at', () => {
    // Everything above measures a declaration the kernel considers finished,
    // because a one-blocker block is a legal whole block today and there is no
    // other way to make a table hold one. The position a sequenced declaration
    // stops at is not that: the defender still owes the decision. It is built
    // here rather than played, since no reducer produces it yet, and it is put
    // through the projector the table projects with.
    const session = replaySession(SETUP, [humanSeat('One'), humanSeat('Two')], POSITION.prefix);
    const opening = session.state;
    const interior: GameState = {
      ...opening,
      combat: {
        ...opening.combat,
        blocks: [{ attacker: POSITION.first.attacker, blockers: [POSITION.first.blocker] }],
      },
    };

    const owed = pendingDecision(interior);
    // The kernel still owes the defender the same decision, which is what makes
    // this the interior of a sequence rather than the far side of one.
    expect(owed?.kind).toBe('declareBlockers');
    expect(owed?.player).toBe(POSITION.defender);

    const key = 'salt:1:0';
    expect(blockRelation(seatState(interior, POSITION.attacker, key))).toEqual([
      `${POSITION.first.blocker} blocks ${POSITION.first.attacker}`,
    ]);
    // The same projector on the same position with the block taken out, so the
    // line above is reading the block and not something the projector always
    // says.
    expect(blockRelation(seatState(opening, POSITION.attacker, key))).toEqual([]);
  });
});

describe('what that costs the attacking seat', () => {
  it('costs nothing while the increments only add', () => {
    const increment = blockRelation(declaredBy(POSITION, [POSITION.first]).state);
    const finished = blockRelation(declaredBy(POSITION, [POSITION.first, POSITION.second]).state);

    // The finished declaration is strictly larger, so the subset below is a
    // claim about two different sets rather than about one set twice.
    expect(finished.length).toBe(2);
    expect(increment.length).toBe(1);
    expect(finished).toEqual(expect.arrayContaining([...increment]));
    expect(increment.filter((pair) => !finished.includes(pair))).toEqual([]);
  });

  it('costs one block the game never had when an increment is taken back', () => {
    const increment = blockRelation(declaredBy(POSITION, [POSITION.first]).state);
    // The completion a defender reaches by rewinding into the sequence and
    // assigning the first blocker somewhere else — or nowhere. Every position
    // after it is a position the first blocker is not blocking in.
    const rewritten = blockRelation(declaredBy(POSITION, [POSITION.second]).state);

    const stranded = increment.filter((pair) => !rewritten.includes(pair));
    expect(stranded).toEqual([`${POSITION.first.blocker} blocks ${POSITION.first.attacker}`]);
    // Not the trivial difference of an empty completion against a full one:
    // the rewritten declaration is a real block of its own.
    expect(rewritten.length).toBe(1);
  });

  it('is not reachable over this wire, because the table takes no rewind', () => {
    // The stranded block above needs a door back into the sequence, and the
    // protocol has none: `SeatRequest` is four kinds and none of them names a
    // prefix. `table.ts` argues why undo is absent — a rewind in a two-player
    // game takes back the opponent's decisions too — and that argument is now
    // load-bearing for concealment as well as for fairness.
    expect(readSeatRequest({ kind: 'undo', at: 0, keep: 0 })).toContain('not a request this table answers');
    expect(readSeatRequest({ kind: 'undoTo', keep: 3 })).toContain('not a request this table answers');
    // Non-vacuous: the reader is working, and says yes to the kind it takes.
    expect(readSeatRequest({ kind: 'choose', index: 0, at: 0 })).toEqual({ kind: 'choose', index: 0, at: 0 });
  });
});
