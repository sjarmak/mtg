// @vitest-environment jsdom
/**
 * One seat at a Forge table over the network, drawn phase by phase.
 *
 * The table behind every case is a real `ObservedDealer` over `scriptBackend`,
 * reached through `observed-wire.ts` in place of a socket, so what the page
 * draws is what the table sent. The load-bearing cases are the two hand-offs:
 * the format's own builder is drawn while the table is seating and its deck
 * goes up the wire when the builder says so, and once both decks are in the
 * shared board takes over with the other seat's moves arriving on their own.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DeckRef } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { OBSERVED_TABLE_PROTOCOL, createObservedDealer } from '@mtg/netplay';
import type { ObservedDealer, ObservedTable, SeatTokens } from '@mtg/netplay';
import { CLOSE_GAME_LABEL } from '../../src/routes/play/BackendGame';
import {
  OBSERVED_BACK_LABEL,
  OBSERVED_BUILD_LABEL,
  OBSERVED_ENDED_LABEL,
  OBSERVED_LEAVE_LABEL,
  OBSERVED_OPENING_LABEL,
  OBSERVED_SUBMITTED_LABEL,
  OBSERVED_TOKEN_PREFIX,
  ObservedSeat,
  observedSeatLink,
  seatingStatus,
} from '../../src/routes/play/ObservedSeat';
import type { ObservedSeating } from '../../src/routes/play/ObservedSeat';
import { CONNECTING_LABEL } from '../../src/routes/play/RemoteGame';
import { WIRE_BASE, observedWire, stillClock } from '../net/observed-wire';

const HOST_DECK: DeckRef = { name: 'Host deck', cards: [{ name: 'Island', count: 40 }] };
const GUEST_DECK: DeckRef = { name: 'Guest deck', cards: [{ name: 'Forest', count: 40 }] };

let restore: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

function stubFetch(answer: typeof globalThis.fetch): void {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: answer });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
}

async function tableOf(clock: number): Promise<{
  dealer: ObservedDealer;
  table: ObservedTable;
  tokens: SeatTokens;
}> {
  const dealer = createObservedDealer({
    backend: scriptBackend({ clock }),
    formats: ['toy'],
    clock: stillClock(),
  });
  stubFetch(observedWire(dealer));
  const opened = await dealer.open({
    protocol: OBSERVED_TABLE_PROTOCOL,
    format: 'toy',
    content: { kind: 'printed', format: 'toy' },
    seed: 'seed-of-the-match',
    maximumTurns: null,
  });
  if (!opened.ok) throw new Error(opened.refused);
  return { dealer, table: opened.table, tokens: opened.tokens };
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/** A stand-in for a format's deck builder: one button that hands in the host deck. */
function builder(seating: ObservedSeating, submitDeck: (deck: DeckRef) => void): ReturnType<typeof h> {
  return h(
    'button',
    { type: 'button', onClick: (): void => submitDeck(HOST_DECK) },
    `Hand in ${seating.poolSeed}`,
  );
}

function seat(token: string, onLeave: () => void): ReturnType<typeof h> {
  return h(ObservedSeat, { base: WIRE_BASE, token, printedCards: [], builder, onLeave });
}

describe('the observed seat link', () => {
  it('is the table parameter when it carries the observed prefix, and nothing otherwise', () => {
    expect(observedSeatLink({ table: `${OBSERVED_TOKEN_PREFIX}abc` }, '/api')).toEqual({
      base: '/api',
      token: 'obs-abc',
    });
    expect(observedSeatLink({ table: 'kernel-table' }, '/api')).toBeUndefined();
    expect(observedSeatLink({ source: 'printed:toy' }, '/api')).toBeUndefined();
  });

  it('states the seating in one sentence per state', () => {
    const seating: ObservedSeating = { seat: 0, poolSeed: 'p', submitted: [false, false], deck: null };
    expect(seatingStatus(seating)).toBe(OBSERVED_BUILD_LABEL);
    expect(seatingStatus({ ...seating, deck: HOST_DECK, submitted: [true, false] })).toBe(
      OBSERVED_SUBMITTED_LABEL,
    );
    expect(seatingStatus({ ...seating, deck: HOST_DECK, submitted: [true, true] })).toBe(
      OBSERVED_OPENING_LABEL,
    );
  });
});

describe('ObservedSeat', () => {
  it('draws the builder on the dealt seed, hands the deck up, then plays the board as the table moves', async () => {
    const { dealer, table, tokens } = await tableOf(3);
    const onLeave = vi.fn();
    render(seat(tokens[0], onLeave));

    const dealt = table.frameFor(0).phase;
    const poolSeed = dealt.kind === 'seating' ? dealt.poolSeed : '';
    const handIn = await screen.findByRole('button', { name: `Hand in ${poolSeed}` });
    expect(textOf(screen.getByRole('status'))).toBe(OBSERVED_BUILD_LABEL);
    fireEvent.click(handIn);
    await screen.findByText(OBSERVED_SUBMITTED_LABEL);
    expect(table.frameFor(0).deck).toEqual(HOST_DECK);
    expect(screen.queryByRole('button', { name: `Hand in ${poolSeed}` })).toBeNull();

    expect(await table.submitDeck(1, GUEST_DECK)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Advance the clock' }));
    await screen.findByText('1 choices made');
    expect(await table.submit(1, 'advance')).toBeNull();
    await screen.findByText('2 choices made');

    fireEvent.click(screen.getByRole('button', { name: CLOSE_GAME_LABEL }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(table.phase).toBe('finished');
    await dealer.close();
  });

  it('leaves the table from the seating panel and hands the hash back', async () => {
    const { dealer, table, tokens } = await tableOf(3);
    const onLeave = vi.fn();
    render(seat(tokens[1], onLeave));

    fireEvent.click(await screen.findByRole('button', { name: OBSERVED_LEAVE_LABEL }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(table.phase).toBe('ended');
    await dealer.close();
  });

  it('says the table closed, with the reason, and offers the way back', async () => {
    const { dealer, table, tokens } = await tableOf(3);
    const onLeave = vi.fn();
    render(seat(tokens[0], onLeave));

    await screen.findByText(OBSERVED_BUILD_LABEL);
    await table.leave(1);
    await screen.findByText(OBSERVED_ENDED_LABEL);
    expect(textOf(screen.getByRole('status'))).toBe('Guest left the table.');
    fireEvent.click(screen.getByRole('button', { name: OBSERVED_BACK_LABEL }));
    expect(onLeave).toHaveBeenCalledOnce();
    await dealer.close();
  });

  it('draws the connection problem when no seat answers to the link', async () => {
    const { dealer } = await tableOf(3);
    render(seat('obs-nobody', vi.fn()));

    await screen.findByText('no seat answers to that link');
    expect(screen.getByText(CONNECTING_LABEL)).not.toBeNull();
    await dealer.close();
  });
});
