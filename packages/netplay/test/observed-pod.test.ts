/**
 * An observed table seats a pod (`mtg-bc2.154.6.5.3`): four clients behind four
 * tokens, each sent its own hand and everyone's public state, on the engine's
 * toy backend, which seats N round-robin. The kernel plays two and refuses the
 * rest itself (`packages/kernel/test`), so the pod is never dealt to it here.
 */
import type { DeckRef, SeatId } from '@mtg/engine';
import { scriptBackend, seatViewOf } from '@mtg/engine';
import {
  MAX_OBSERVED_SEATS,
  OBSERVED_TABLE_PROTOCOL,
  createObservedDealer,
  observedSeatName,
  readObservedOpenRequest,
} from '@mtg/netplay';
import type { ObservedOpenRequest, ObservedPhase, ObservedTable } from '@mtg/netplay';
import { describe, expect, it } from 'vitest';
import { fakeClock } from './observed-clock';

const POD: ObservedOpenRequest = {
  protocol: OBSERVED_TABLE_PROTOCOL,
  format: 'toy',
  content: { kind: 'printed', format: 'toy' },
  seed: 'pod-seed',
  maximumTurns: null,
  seats: 4,
};

const deckOf = (seat: SeatId): DeckRef => ({
  name: `Deck ${String(seat)}`,
  cards: [{ name: 'Island', count: 40 }],
});

function playing(table: ObservedTable, seat: SeatId): Extract<ObservedPhase, { kind: 'playing' }> {
  const phase = table.frameFor(seat).phase;
  if (phase.kind !== 'playing') throw new Error(`seat ${String(seat)} is ${phase.kind}`);
  return phase;
}

async function openPod(): Promise<{ table: ObservedTable; tokens: readonly string[] }> {
  const dealer = createObservedDealer({
    backend: scriptBackend({ clock: 8 }),
    formats: ['toy'],
    clock: fakeClock(),
  });
  const opened = await dealer.open(POD);
  if (!opened.ok) throw new Error(opened.refused);
  return { table: opened.table, tokens: opened.tokens };
}

describe('a four-seat observed table', () => {
  it('mints one token per seat and finds each seat by its own', async () => {
    const dealer = createObservedDealer({
      backend: scriptBackend({ clock: 8 }),
      formats: ['toy'],
      clock: fakeClock(),
    });
    const opened = await dealer.open(POD);
    if (!opened.ok) throw new Error(opened.refused);
    expect(opened.tokens).toHaveLength(4);
    expect(new Set(opened.tokens).size).toBe(4);
    for (const [seat, token] of opened.tokens.entries()) expect(dealer.find(token)?.seat).toBe(seat);
    expect(new Set(opened.table.poolSeeds).size).toBe(4);
  });

  it('waits for every deck, then opens once, and tells each seat who has submitted', async () => {
    const { table } = await openPod();
    for (const seat of [2, 0, 3]) expect(await table.submitDeck(seat, deckOf(seat))).toBeNull();
    expect(table.phase).toBe('seating');
    expect(table.frameFor(1).phase).toMatchObject({ kind: 'seating', submitted: [true, false, true, true] });
    expect(await table.submitDeck(2, deckOf(2))).toMatchObject({
      refused: 'this seat already submitted a deck',
    });
    expect(await table.submitDeck(1, deckOf(1))).toBeNull();
    expect(table.phase).toBe('playing');
  });

  it('refuses a seat the table does not have', async () => {
    const { table } = await openPod();
    expect(await table.submitDeck(4, deckOf(4))).toMatchObject({ refused: 'the table has no such seat' });
  });

  it('sends each seat its own hand and only counts of the others', async () => {
    const { table } = await openPod();
    for (const seat of [0, 1, 2, 3]) expect(await table.submitDeck(seat, deckOf(seat))).toBeNull();
    for (const seat of [0, 1, 2, 3]) {
      const view = playing(table, seat).view;
      expect(view.seats).toHaveLength(4);
      expect(seat).toBe(table.frameFor(seat).seat);
      expect(seatViewOf(view, seat).hand).not.toBeNull();
      for (const other of [0, 1, 2, 3].filter((each) => each !== seat)) {
        expect(seatViewOf(view, other).hand).toBeNull();
        expect(seatViewOf(view, other).handSize).toBe(seatViewOf(view, seat).handSize);
      }
      expect(table.frameFor(seat).deck?.name).toBe(deckOf(seat).name);
    }
  });

  it('hands the decision to one seat at a time and refuses the other three', async () => {
    const { table } = await openPod();
    for (const seat of [0, 1, 2, 3]) await table.submitDeck(seat, deckOf(seat));
    const holder = playing(table, 0).decision?.seat;
    if (holder === undefined) throw new Error('no decision');
    for (const seat of [0, 1, 2, 3].filter((each) => each !== holder)) {
      expect(await table.submit(seat, 'advance')).toMatchObject({
        refused: "it is not this seat's decision",
      });
      expect(playing(table, seat).decision).toBeNull();
    }
    expect(await table.submit(holder, 'advance')).toBeNull();
  });

  it('ends undecided when a seat leaves mid-game, naming who left', async () => {
    const { table } = await openPod();
    for (const seat of [0, 1, 2, 3]) await table.submitDeck(seat, deckOf(seat));
    await table.leave(2);
    expect(table.frameFor(0).phase).toMatchObject({
      kind: 'finished',
      result: { winner: null, reason: `${observedSeatName(2)} left the table` },
    });
  });
});

describe('readObservedOpenRequest seat counts', () => {
  const wire = {
    protocol: OBSERVED_TABLE_PROTOCOL,
    format: 'toy',
    content: POD.content,
    seed: null,
    maximumTurns: null,
  };

  it('reads an absent count as the two-seat game and a stated one as stated', () => {
    expect(readObservedOpenRequest(wire)).not.toHaveProperty('seats');
    expect(readObservedOpenRequest({ ...wire, seats: 4 })).toMatchObject({ seats: 4 });
  });

  it.each([1, 2.5, MAX_OBSERVED_SEATS + 1, '4', null])('refuses %s seats', (seats) => {
    expect(readObservedOpenRequest({ ...wire, seats })).toMatch(/whole number of players/);
  });
});
