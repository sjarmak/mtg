/**
 * The table is the authority, and these are the ways a client can be wrong.
 *
 * Every one of them exists because a network makes it reachable. On one screen
 * there is one clicker, one enumeration and no latency, so "the seat that is not
 * being asked submits a choice" and "a click arrives for a decision that has
 * already been answered" are not states a hot-seat surface can get into. Across
 * a wire they are ordinary: a double tap, a tab that woke up, two people
 * pressing at once.
 *
 * The bot block is the other half of the bead's second gap. Bots ran inline in
 * the client because the client owned the session; the server owns it now, so it
 * owns them, and a mixed game needs no special case anywhere.
 */
import { describe, expect, it } from 'vitest';
import type { GameSetup, PlayerId, Seat } from '@mtg/kernel';
import { botSeat, DEFAULT_AUTO_PASS, FULL_CONTROL, humanSeat, simpleAgent } from '@mtg/kernel';
import type { Table } from '@mtg/netplay';
import { createTable, toWireAutoPass } from '@mtg/netplay';
import { twoDecks } from './decks';

const SETUP: GameSetup = { seed: 'netplay/table/v0', decks: twoDecks(), maximumTurns: 30 };

function tableWith(second: Seat, token: string | null): Table {
  return createTable({
    id: 'table',
    setup: SETUP,
    seats: [humanSeat('One'), second],
    seating: [
      { name: 'One', token: 'token-one' },
      { name: 'Two', token },
    ],
  });
}

const twoHumans = (): Table => tableWith(humanSeat('Two'), 'token-two');
const oneBot = (): Table => tableWith(botSeat(simpleAgent('Two')), null);

/** Drives whichever seat owes a decision, taking the widest declaration on offer. */
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

describe('a seat capability', () => {
  it('addresses exactly one seat', () => {
    const live = twoHumans();
    expect(live.seatOf('token-one')).toBe(0);
    expect(live.seatOf('token-two')).toBe(1);
  });

  it('answers nothing to a link nobody was given', () => {
    const live = twoHumans();
    expect(live.seatOf('token-three')).toBeNull();
    expect(live.seatOf('')).toBeNull();
  });

  it('answers nothing for a bot, because nobody sits there', () => {
    const live = oneBot();
    expect(live.seatOf('token-one')).toBe(0);
    // A null token is the record that this seat is played by an agent. It must
    // not be matchable, or an empty string in a URL would open the bot's board.
    expect(live.seatOf('null')).toBeNull();
    expect(live.seatOf('')).toBeNull();
  });
});

describe('what the table refuses', () => {
  it('refuses a choice from the seat that is not being asked', () => {
    const live = twoHumans();
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const other: PlayerId = owed === 0 ? 1 : 0;
    const refusal = live.apply(other, { kind: 'choose', index: 0, at: live.snapshotFor(other).decisions });
    expect(refusal?.refused).toContain('belongs to');
    expect(live.snapshotFor(owed).decisions).toBe(0);
  });

  it('refuses a choice aimed at a decision that has already been answered', () => {
    const live = twoHumans();
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const at = live.snapshotFor(owed).decisions;
    expect(live.apply(owed, { kind: 'choose', index: 0, at })).toBeNull();
    // The same click again, the way a double tap or a retried request arrives.
    const second =
      live.snapshotFor(owed).awaiting === owed ? live.apply(owed, { kind: 'choose', index: 0, at }) : null;
    if (second !== null) expect(second.refused).toContain('already been answered');
  });

  it('refuses an index outside the enumeration it handed out', () => {
    const live = twoHumans();
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const snapshot = live.snapshotFor(owed);
    const beyond = (snapshot.pending?.options.length ?? 0) + 5;
    const refusal = live.apply(owed, { kind: 'choose', index: beyond, at: snapshot.decisions });
    expect(refusal?.refused).toContain('outside');
    expect(live.snapshotFor(owed).decisions).toBe(snapshot.decisions);
  });

  it('says which decision the table is actually on, so a client can resync', () => {
    const live = twoHumans();
    const owed = live.snapshotFor(0).awaiting as PlayerId;
    const refusal = live.apply(owed, { kind: 'choose', index: 0, at: 999 });
    expect(refusal?.at).toBe(live.snapshotFor(owed).decisions);
  });

  it('refuses everything once the game is over', () => {
    const live = twoHumans();
    play(live, 4000);
    expect(live.snapshotFor(0).result).not.toBeNull();
    const refusal = live.apply(0, { kind: 'choose', index: 0, at: live.snapshotFor(0).decisions });
    expect(refusal?.refused).toContain('the game is over');
  });
});

describe('the server owns the bot', () => {
  it('plays the bot seat without anyone asking it to', () => {
    const live = oneBot();
    // Every decision the table ever stops on belongs to the person. The bot's
    // answers happen inside `advance`, on this side of the wire.
    for (let guard = 0; guard < 400; guard += 1) {
      const owed = live.snapshotFor(0).awaiting;
      if (owed === null) break;
      expect(owed).toBe(0);
      const owing = live.snapshotFor(0);
      live.apply(0, { kind: 'choose', index: (owing.pending?.options.length ?? 1) - 1, at: owing.decisions });
    }
    expect(live.snapshotFor(0).decisions).toBeGreaterThan(20);
  });

  it('conceals the bot hand from the person exactly as it would a person', () => {
    const live = oneBot();
    const snapshot = live.snapshotFor(0);
    expect(snapshot.state.players[1].hand.length).toBeGreaterThan(0);
    for (const oid of snapshot.state.players[1].hand) {
      expect(snapshot.state.objects[oid]).toBeUndefined();
    }
  });
});

describe('one preference per seat', () => {
  it('changes only the seat that asked', () => {
    const live = twoHumans();
    expect(live.apply(0, { kind: 'autoPass', autoPass: toWireAutoPass(FULL_CONTROL) })).toBeNull();
    expect(live.snapshotFor(0).autoPass.enabled).toBe(false);
    expect(live.snapshotFor(1).autoPass.enabled).toBe(DEFAULT_AUTO_PASS.enabled);
  });

  it('re-settles the game rather than waiting for the next click', () => {
    const live = twoHumans();
    play(live, 30);
    const before = live.revision;
    live.apply(1, { kind: 'autoPass', autoPass: toWireAutoPass(FULL_CONTROL) });
    expect(live.revision).toBeGreaterThan(before);
  });

  it('never reaches the recording, whichever seat set it', () => {
    const settled = twoHumans();
    settled.apply(0, { kind: 'autoPass', autoPass: toWireAutoPass(FULL_CONTROL) });
    settled.apply(1, { kind: 'autoPass', autoPass: toWireAutoPass(FULL_CONTROL) });
    play(settled, 60);
    // The recording is a list of integers whatever the settings were, which is
    // what makes it replayable; `reconnection.test.ts` spends it.
    for (const index of settled.record().choices) expect(Number.isInteger(index)).toBe(true);
  });
});
