// @vitest-environment jsdom
/**
 * The LAN room one phase earlier: two seats drafting out of shared packs.
 *
 * `mtg-28bh`. The rules half is `../../../netplay/test/room-draft.test.ts`; this
 * is the screen half, and the claims are the ones a person would notice being
 * wrong.
 *
 * Two are load-bearing. **A pick crosses as a position**, so the index the page
 * sends has to be the index of the card that was chosen in the pack as the
 * server dealt it — a screen that reordered or thinned the pack would take a
 * different card than the one that was pressed, and there is no undo. And the
 * **mismatch refusal** extends to the pack for the reason `RemoteSealed`'s
 * covers the pool: a set that does not print an id can draw a pack one card
 * short, and then every position after the gap addresses the wrong card. The
 * set the ids are resolved against is the room's own, served by `GET
 * /api/room/:token/set` and stubbed here, never the one this tab has open
 * (`mtg-77i6`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DRAFT_PICK_IDLE_LABEL, DRAFT_WAITING_TITLE } from '../../src/routes/play/RemoteDraft';
import { RemoteSealed, ROOM_MISMATCH_TITLE } from '../../src/routes/play/RemoteSealed';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

const RAW = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as { readonly cards: readonly unknown[] };
const SET: readonly Card[] = RAW.cards.map((card) => parseCard(card));

/** A pack and a pool, from the one set both ends of a room have open. */
const SPELLS: readonly Card[] = SET.filter((card) => card.kind !== 'land');
const PACK: readonly Card[] = SPELLS.slice(0, 8);
const TAKEN: readonly Card[] = SPELLS.slice(20, 23);

interface ElementLike {
  readonly textContent: string;
}

function like(node: unknown): ElementLike {
  return node as ElementLike;
}

let restore: (() => void) | null = null;

interface Ask {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

/** A drafting room as the server sends one, with whatever a test is changing. */
function wire(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    protocol: 3,
    room: 'room-1',
    phase: 'draft',
    seat: 0,
    seats: [
      { name: 'You', ready: false },
      { name: 'Sam', ready: false },
    ],
    revision: 0,
    pool: TAKEN.map((card) => card.id),
    deckSize: 40,
    rounds: 3,
    pack: { cards: PACK.map((card) => card.id), round: 1, pickNumber: 4 },
    ...over,
  };
}

/** A lab holding one drafting room, recording what the page asked it. */
function lab(room: () => Promise<Response>, onPost?: (ask: Ask) => Promise<Response>): readonly Ask[] {
  const asked: Ask[] = [];
  const original = globalThis.fetch;
  const answer = (url: string, init?: { method?: string; body?: string }): Promise<Response> => {
    const ask: Ask = { url, method: init?.method ?? 'GET', body: init?.body ?? '' };
    asked.push(ask);
    if (url.endsWith('/invite')) return json({ refused: 'no invite' }, 404);
    // The room's own set, which is what the pack and the pool resolve against.
    if (url.endsWith('/set')) return json({ protocol: 3, cards: RAW.cards });
    if (ask.method === 'POST') return onPost === undefined ? json(wire({ revision: 1 })) : onPost(ask);
    return room();
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: answer });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
  return asked;
}

let page: ElementLike | null = null;

function show(element: ReturnType<typeof h>): void {
  page = like(render(element).container);
}

function screenText(): string {
  return page === null ? '' : page.textContent;
}

function draft(): void {
  show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
}

afterEach(() => {
  page = null;
  cleanup();
  restore?.();
  restore = null;
});

describe('the LAN draft screen', () => {
  it('draws the pack this seat owes a pick out of', async () => {
    lab(() => json(wire()));
    draft();
    await screen.findByRole('group', { name: 'Your pack' });
    // Every card in the pack, by name, because a pack one card short is a pack
    // whose positions no longer address what the server dealt.
    for (const card of PACK) expect(screenText()).toContain(card.name);
  });

  it('says which pack and which pick, out of how many packs', async () => {
    lab(() => json(wire()));
    draft();
    await waitFor(() => {
      expect(screenText()).toContain('Pack 1 of 3 · Pick 4');
    });
    expect(screenText()).toContain('3 drafted');
  });

  it('selects on a press and sends nothing until the pick is committed', async () => {
    const asked = lab(() => json(wire()));
    draft();
    const first = PACK[0];
    if (first === undefined) throw new Error('the fixture printed no cards');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(first.name) }));
    // The commit names the card, which is the whole of the confirmation.
    await screen.findByRole('button', { name: `Pick ${first.name}` });
    expect(asked.filter((ask) => ask.method === 'POST')).toEqual([]);
  });

  it('sends the position of the chosen card, which is what a pick is', async () => {
    const asked = lab(() => json(wire()));
    draft();
    const third = PACK[2];
    if (third === undefined) throw new Error('the fixture printed too few cards');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(third.name) }));
    fireEvent.click(await screen.findByRole('button', { name: `Pick ${third.name}` }));
    await waitFor(() => {
      expect(asked.filter((ask) => ask.method === 'POST')).toHaveLength(1);
    });
    const sent = asked.find((ask) => ask.method === 'POST');
    expect(sent?.url).toBe('/api/room/token-one');
    expect(JSON.parse(sent?.body ?? 'null')).toEqual({ pick: 2 });
  });

  it('puts the pack down the moment the pick lands, rather than at the next poll', async () => {
    // The room keeps answering with the revision the pick was sent against,
    // which is the two-second window the screen must not leave the taken card
    // pressable in.
    lab(() => json(wire()));
    draft();
    const first = PACK[0];
    if (first === undefined) throw new Error('the fixture printed no cards');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(first.name) }));
    fireEvent.click(await screen.findByRole('button', { name: `Pick ${first.name}` }));
    await screen.findByText(DRAFT_WAITING_TITLE);
    expect(screen.queryByRole('group', { name: 'Your pack' })).toBeNull();
  });

  it('hands the pack back when a pick is refused, because it did not happen', async () => {
    lab(
      () => json(wire()),
      () => json({ refused: 'that pack has already been passed', room: wire({ revision: 2 }) }, 409),
    );
    draft();
    const first = PACK[0];
    if (first === undefined) throw new Error('the fixture printed no cards');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(first.name) }));
    fireEvent.click(await screen.findByRole('button', { name: `Pick ${first.name}` }));
    await waitFor(() => {
      expect(screenText()).toContain('that pack has already been passed');
    });
    await screen.findByRole('group', { name: 'Your pack' });
  });

  it('says it is waiting when this seat owes no pick, rather than drawing an empty pack', async () => {
    lab(() => json(wire({ pack: null })));
    draft();
    await screen.findByText(DRAFT_WAITING_TITLE);
    expect(screen.queryByRole('group', { name: 'Your pack' })).toBeNull();
    // Nothing to commit either: the foot is the idle label and it is disabled.
    const commit = (await screen.findByRole('button', { name: DRAFT_PICK_IDLE_LABEL })) as {
      disabled?: boolean;
    };
    expect(commit.disabled).toBe(true);
  });

  it("refuses a pack the room's own set has no cards for rather than drawing it short", async () => {
    lab(() => json(wire({ pack: { cards: ['not-a-card-in-this-set'], round: 1, pickNumber: 1 } })));
    draft();
    await screen.findByText(ROOM_MISMATCH_TITLE);
    expect(screenText()).toContain('not-a-card-in-this-set');
  });

  it('becomes the build screen when the packs run out', async () => {
    lab(() => json(wire({ phase: 'build', pack: null, pool: SPELLS.slice(0, 45).map((card) => card.id) })));
    draft();
    // The same token, the same component, one phase on: what changes is the
    // screen, and nobody is handed a second link.
    await screen.findByRole('button', { name: 'Send this deck' });
    expect(screen.queryByRole('group', { name: 'Your pack' })).toBeNull();
  });
});
