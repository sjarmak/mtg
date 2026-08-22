/**
 * The bead's acceptance criterion, asserted against the bytes.
 *
 * "Neither client ever receives the other seat's hidden information over the
 * wire — asserted by a test against the payload, not against the DOM." The
 * distinction is the whole lane: the hot-seat surface already hides the other
 * hand, and it hides it by holding the cards and declining to draw them. Across
 * a network that is not hiding, it is a component being polite about bytes the
 * browser already has, and "the component does not render it" is exactly the
 * assumption that fails.
 *
 * So this test does not render anything. It plays a whole game through the
 * table, takes the payload each seat would be sent at every single decision, and
 * asks two questions of the JSON text:
 *
 *  - Is any card this seat may not identify named in it? (Must be no.)
 *  - Is every card in this seat's own hand named in it? (Must be yes.)
 *
 * The second question is not decoration. Without it the first passes trivially
 * on an empty payload, and a concealment bug that concealed everything would
 * read as a clean run.
 *
 * `decks.ts` explains why every spell has a number in its name: a text search
 * needs a name that identifies one object, and four copies of a card would make
 * "the name is absent" go false the moment any copy was legitimately played.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { humanSeat } from '@mtg/kernel';
import type { SeatSnapshot, Table } from '@mtg/netplay';
import { createTable } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/hidden/v0', decks: twoDecks(), maximumTurns: 30 };

function table(): Table {
  return createTable({
    id: 'hidden',
    setup: SETUP,
    seats: [humanSeat('One'), humanSeat('Two')],
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token: 'token-two' },
    ],
  });
}

/**
 * The full position, which only this test may have.
 *
 * Read out of seat 0's own snapshot plus seat 1's, since between them the two
 * name every object: what seat 0 may not see is exactly what seat 1 may, apart
 * from the libraries, which neither may. So the truth comes from the decks
 * instead — every card in the game, by name — and the zones come from the two
 * snapshots agreeing about counts.
 */
interface Truth {
  /** Card names that belong to exactly one object in the game. */
  readonly unique: ReadonlyMap<ObjectId, string>;
  readonly concealed: ReadonlyMap<PlayerId, ReadonlySet<ObjectId>>;
  readonly ownHand: ReadonlyMap<PlayerId, readonly ObjectId[]>;
}

/**
 * What each seat may and may not identify, derived from the seats' own payloads
 * read together.
 *
 * Deliberately not derived from the same function the table uses. A test that
 * asked `concealedFrom` what is concealed and then checked that exactly that is
 * missing would agree with the implementation by construction and would pass on
 * any bug the implementation has. The zones come from the snapshots — a hand
 * count and a library count are public, and both seats are told them — and the
 * names come from whichever seat is entitled to read them.
 */
function truth(first: SeatSnapshot, second: SeatSnapshot): Truth {
  const names = new Map<ObjectId, string>();
  for (const snapshot of [first, second]) {
    for (const [oid, object] of Object.entries(snapshot.state.objects)) names.set(oid, object.card.name);
  }
  const counted = new Map<string, number>();
  for (const name of names.values()) counted.set(name, (counted.get(name) ?? 0) + 1);
  const unique = new Map<ObjectId, string>();
  for (const [oid, name] of names) if (counted.get(name) === 1) unique.set(oid, name);

  const concealed = new Map<PlayerId, ReadonlySet<ObjectId>>();
  const ownHand = new Map<PlayerId, readonly ObjectId[]>();
  for (const snapshot of [first, second]) {
    const other = snapshot.seat === 0 ? 1 : 0;
    const state = snapshot.state;
    const hidden = new Set<ObjectId>([
      ...state.players[0].library,
      ...state.players[1].library,
      ...state.players[other].hand,
    ]);
    concealed.set(snapshot.seat, hidden);
    ownHand.set(snapshot.seat, state.players[snapshot.seat].hand);
  }
  return { unique, concealed, ownHand };
}

/**
 * Every claim this lane makes about one payload, checked at once.
 *
 * Returns how many of this seat's own cards it could confirm readable *by
 * name*, which feeds the run-wide floor below — that part stays a sum, because
 * a hand of nothing but basic lands has no card in it with a name of its own,
 * and which positions draw one is chance, not something a single position can
 * be made to guarantee.
 *
 * The presence check just below it is not that. It runs at every position, for
 * every object this seat's own hand names, named or not, so it does not
 * inherit the blind spot: a bad position with an all-land hand still has
 * objects behind those lands, and this still asks the wire for them.
 */
function auditPayload(snapshot: SeatSnapshot, other: SeatSnapshot, at: string): number {
  const facts = truth(snapshot, other);
  const wire = JSON.stringify(snapshot);
  const seat = snapshot.seat;
  // Searched as a JSON string literal, quotes included. A bare substring search
  // reports "Ember Scout 1" present because "Ember Scout 10" is in the payload,
  // which is a false alarm that reads exactly like the leak this test is for.
  const names = (name: string): boolean => wire.includes(JSON.stringify(name));

  for (const oid of facts.concealed.get(seat) ?? []) {
    expect(snapshot.state.objects[oid], `${at}: seat ${String(seat)} was sent object ${oid}`).toBeUndefined();
    const name = facts.unique.get(oid);
    if (name === undefined) continue;
    expect(names(name), `${at}: "${name}" is in seat ${String(seat)}'s payload`).toBe(false);
  }

  let identified = 0;
  for (const oid of facts.ownHand.get(seat) ?? []) {
    // Per position, not summed: every object this seat's own hand names must
    // be in this exact payload, whether or not its name happens to be unique
    // right now. A seat that wrongly conceals its own hand replaces the real
    // id in the hand list with a placeholder that names nothing, so this fails
    // at the position it broke rather than waiting for the run's total to
    // notice the loss among everything that still worked.
    expect(
      snapshot.state.objects[oid],
      `${at}: seat ${String(seat)} was not sent its own hand object ${oid}`,
    ).toBeDefined();
    const name = facts.unique.get(oid);
    if (name === undefined) continue;
    identified += 1;
    expect(names(name), `${at}: seat ${String(seat)} cannot read its own "${name}"`).toBe(true);
  }
  // The generator and the seed reproduce every shuffle in the game, so they are
  // concealment too rather than housekeeping.
  expect(snapshot.state.config.seed).toBe('');
  expect(wire.includes(SETUP.seed)).toBe(false);
  return identified;
}

describe('what a seat is sent', () => {
  it('never names a card that seat may not identify, at any point in a whole game', () => {
    const live = table();
    let audited = 0;
    let confirmed = 0;
    for (let guard = 0; guard < 4000; guard += 1) {
      const first = live.snapshotFor(0);
      const second = live.snapshotFor(1);
      confirmed += auditPayload(first, second, `decision ${String(first.decisions)}`);
      confirmed += auditPayload(second, first, `decision ${String(second.decisions)}`);
      audited += 1;
      const owed = first.awaiting;
      if (owed === null) break;
      const owing = owed === 0 ? first : second;
      const options = owing.pending?.options.length ?? 0;
      // The last option, which is the largest declaration a subset enumeration
      // offers: it plays lands, casts creatures and attacks with everything,
      // so the game reaches a battlefield, a graveyard and a result rather than
      // two players passing at each other for thirty turns.
      const refusal = live.apply(owed, { kind: 'choose', index: options - 1, at: owing.decisions });
      expect(refusal, `decision ${String(owing.decisions)} was refused`).toBeNull();
    }
    // A game played to a result, not a handful of mulligans. The bound is loose
    // because an unrelated change to the enumeration would move it by one, and a
    // test that fails on that is a test people delete.
    //
    // It was 150 against a measured 186, and it is 50 against a measured 74. The
    // game did not get shorter; its *questions* did. `play/dead-stops` stopped a
    // stop firing at a priority where `canRespond` is false, which removed 121 of
    // 233 priority prompts across five seeded games, and this loop audits one
    // position per decision it answers. The line below is the assertion that the
    // game still finishes, and it is unchanged and still passing, which is what
    // separates "fewer questions" from "the game stopped reaching a result".
    //
    // The check this floor exists to protect got *stronger* over the same merge:
    // `confirmed` is 414 where it was measured against a bound of 150.
    expect(audited).toBeGreaterThan(50);
    expect(live.snapshotFor(0).result).not.toBeNull();
    // And the positive control fired: a run that confirmed nothing readable
    // would satisfy every absence check above on an empty payload.
    expect(confirmed).toBeGreaterThan(150);
  });

  it('sends the enumeration only to the seat that owes it', () => {
    const live = table();
    for (let guard = 0; guard < 200; guard += 1) {
      const owed = live.snapshotFor(0).awaiting;
      if (owed === null) return;
      const other: PlayerId = owed === 0 ? 1 : 0;
      expect(live.snapshotFor(owed).pending).not.toBeNull();
      expect(live.snapshotFor(other).pending).toBeNull();
      const owing = live.snapshotFor(owed);
      live.apply(owed, { kind: 'choose', index: 0, at: owing.decisions });
    }
  });

  it('tells the seat that is not being asked who is', () => {
    const live = table();
    const owed = live.snapshotFor(0).awaiting;
    expect(owed).not.toBeNull();
    const other: PlayerId = owed === 0 ? 1 : 0;
    expect(live.snapshotFor(other).awaiting).toBe(owed);
    expect(live.snapshotFor(other).names[owed as PlayerId]).toBe(owed === 0 ? 'One' : 'Two');
  });

  it('agrees between the two seats on everything the position does not conceal', () => {
    const live = table();
    for (let guard = 0; guard < 60; guard += 1) {
      const owed = live.snapshotFor(0).awaiting;
      if (owed === null) break;
      const owing = live.snapshotFor(owed);
      live.apply(owed, {
        kind: 'choose',
        index: (owing.pending?.options.length ?? 1) - 1,
        at: owing.decisions,
      });
    }
    const first = live.snapshotFor(0);
    const second = live.snapshotFor(1);

    // `@mtg/engine`'s `checkPublicAgreement` names the fields it expects the
    // three views to agree on: turn, priority, stack, graveyards, hand sizes,
    // library sizes. That is a second, hand-picked answer to "what is
    // public" — the one `@mtg/kernel`'s `visibility.ts` already owns — so
    // this does not name one. It takes the whole `GameState` `seatState`
    // sends and normalizes only what that file makes differ between the two
    // seats: both libraries, the other seat's hand, and a pending scry that
    // only its own player is shown. `seatState` also clears `rng` and
    // `config.seed`, which is concealment too and needs nothing here, because
    // it clears them to the same values for whoever asks.
    // Everything `seatState` leaves alone
    // is required to agree byte for byte, which is a strictly wider claim
    // than turn/priority/stack/graveyards/hand-sizes/library-sizes and needs
    // no list of its own to state it — battlefield, exile, mana pools,
    // combat, continuous effects, cost modifiers, replacements and the
    // result are all covered without this test naming any of them.
    const sharedIds = new Set(Object.keys(first.state.objects).filter((oid) => oid in second.state.objects));
    const publicView = (state: GameState): unknown => {
      const { pendingScry: _pendingScry, ...rest } = state;
      return {
        ...rest,
        objects: Object.fromEntries(Object.entries(state.objects).filter(([oid]) => sharedIds.has(oid))),
        players: state.players.map((player) => ({
          ...player,
          library: player.library.length,
          hand: player.hand.length,
        })),
      };
    };
    expect(publicView(first.state)).toEqual(publicView(second.state));
  });
});
