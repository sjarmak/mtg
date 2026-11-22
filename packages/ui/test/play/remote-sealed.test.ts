// @vitest-environment jsdom
/**
 * The LAN game both players build a deck for, from one player's side.
 *
 * `mtg-j73a`. the playtester asked to "build sealed decks to play against each
 * other", and the shape that answers it is a room: two pools, two people
 * cutting, and a table that exists only once the second deck lands. This file
 * is the screen half — `../../../netplay/test/room.test.ts` is the rule half —
 * and the claims are the ones a person would notice being wrong.
 *
 * The load-bearing one is **which set the pool is resolved against**. The pool
 * crosses as card ids, and the set that prints them is the room's, served by
 * `GET /api/room/:token/set`, not whatever set this tab has open: the lab
 * stages every set it found and lets a person switch between them, so a room
 * dealt from the reduced M13 read by a tab showing the flagship set refused a
 * pool that was perfectly good (`mtg-77i6`). The refusal itself stays, for the
 * case where the room's own set does not print its own pool: a builder that
 * quietly dropped a card would cut a deck that is not the deck the server
 * assembles from the same indices, and the person would discover it at the
 * board with a library that is not theirs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { ART_PENDING_LABEL } from '../../src/card/ArtSlot';
import type { ArtResolver } from '../../src/lab/art-manifest';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import {
  RemoteSealed,
  ROOM_MISMATCH_TITLE,
  ROOM_OPENING_TITLE,
  ROOM_POOL_LABEL,
  ROOM_SEND_LABEL,
  ROOM_SET_TITLE,
} from '../../src/routes/play/RemoteSealed';

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

/**
 * A pool big enough to cut a legal deck from, drawn off the fixture.
 *
 * A room deals `openSealedPool`, which is six boosters; what this screen needs
 * from it is a list of ids the set prints and enough playables that the opening
 * suggestion fills a deck, and both are true of the set's own spells.
 */
const POOL: readonly string[] = SET.filter((card) => card.kind !== 'land')
  .slice(0, 90)
  .map((card) => card.id);

/**
 * A staged set that shares no id with the room's, which is the reported bug.
 *
 * The playtester's two machines had exactly this: one lab dealing out of the reduced
 * M13 and a tab open on the flagship set. The ids are rewritten rather than
 * the cards replaced so the only difference is the one that matters.
 */
const FOREIGN: readonly Card[] = RAW.cards
  .slice(0, 12)
  .map((card, index) => parseCard({ ...(card as Record<string, unknown>), id: `foreign-${String(index)}` }));

interface ElementLike {
  readonly textContent: string;
  readonly parentElement: ElementLike | null;
  readonly querySelector: (selector: string) => ElementLike | null;
}

function like(node: unknown): ElementLike {
  return node as ElementLike;
}

/**
 * An image's `src`, narrowed by hand.
 *
 * The workspace tsconfig has no `lib: dom`, so `getAttribute` is not typed here
 * and every jsdom test in this package that needs an attribute narrows it the
 * same way (`../lab/staged-play.test.ts`).
 */
function srcOf(node: unknown): string {
  return (node as { readonly getAttribute: (name: string) => string | null }).getAttribute('src') ?? '';
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

/** A room the way the server sends one, with whatever this test is changing. */
function wire(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    protocol: 3,
    room: 'room-1',
    phase: 'build',
    seat: 0,
    seats: [
      { name: 'You', ready: false },
      { name: 'Sam', ready: false },
    ],
    revision: 0,
    pool: POOL,
    deckSize: 40,
    ...over,
  };
}

/**
 * A lab holding one room, recording what the page asked it.
 *
 * The invite route answers 404, which is the *quiet* answer rather than an
 * error: a seat with nothing to hand out draws no panel, and every assertion
 * below is about the builder rather than about the links beside it.
 */
function lab(
  room: () => Promise<Response>,
  onPost?: (ask: Ask) => Promise<Response>,
  onSet?: () => Promise<Response>,
): readonly Ask[] {
  const asked: Ask[] = [];
  const original = globalThis.fetch;
  const answer = (url: string, init?: { method?: string; body?: string }): Promise<Response> => {
    const ask: Ask = { url, method: init?.method ?? 'GET', body: init?.body ?? '' };
    asked.push(ask);
    if (url.endsWith('/invite')) return json({ refused: 'no invite' }, 404);
    // The room's own set. Every test that draws a pool needs it, so it is the
    // default rather than something each one arranges; `onSet` is for the two
    // that are about the route failing.
    if (url.endsWith('/set')) {
      return onSet === undefined ? json({ protocol: 3, cards: RAW.cards }) : onSet();
    }
    if (ask.method === 'POST') return onPost === undefined ? json(wire({ revision: 1 })) : onPost(ask);
    return room();
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: answer });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
  return asked;
}

/**
 * Everything the screen says, read through the region every route draws into.
 *
 * `document` is not a name under this workspace's tsconfig (no `lib: dom`), so
 * the page is reached the way every jsdom test in the package reaches it: the
 * container `render` hands back.
 */
let page: ElementLike | null = null;

function show(element: ReturnType<typeof h>): void {
  page = like(render(element).container);
}

function screenText(): string {
  return page === null ? '' : page.textContent;
}

afterEach(() => {
  page = null;
  cleanup();
  restore?.();
  restore = null;
});

describe('the LAN sealed build screen', () => {
  it('waits for the pool rather than drawing an empty builder', () => {
    lab(() => new Promise<Response>(() => undefined));
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    expect(screenText()).toContain(ROOM_OPENING_TITLE);
  });

  it('opens the pool the room dealt this seat, and says who the other one is', async () => {
    lab(() => json(wire()));
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
    expect(screenText()).toContain(ROOM_POOL_LABEL);
    // The note names the opponent and the deck size, because both are facts the
    // person cutting needs and neither is on this page's own set.
    expect(screenText()).toContain('Sam');
    expect(screenText()).toContain('40-card deck');
  });

  it('sends pool positions, never card names', async () => {
    const asked = lab(() => json(wire()));
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    fireEvent.click(await screen.findByRole('button', { name: ROOM_SEND_LABEL }));

    await waitFor(() => {
      expect(asked.some((ask) => ask.method === 'POST')).toBe(true);
    });
    const post = asked.find((ask) => ask.method === 'POST');
    expect(post?.url).toBe('/api/room/token-one');
    const build = JSON.parse(post?.body ?? 'null') as { chosen: unknown; basics: unknown };
    expect(Array.isArray(build.chosen)).toBe(true);
    const chosen = build.chosen as readonly number[];
    expect(chosen.length).toBeGreaterThan(0);
    for (const index of chosen) {
      expect(Number.isSafeInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(POOL.length);
    }
    // No id anywhere in what crossed: an index the pool does not hold is the
    // only illegal thing this shape can say, and the server refuses that one.
    expect(post?.body).not.toContain(POOL[0] ?? 'xmp-none');
  });

  /**
   * `mtg-sk1c`, and the third host's half of `./sealed-screen.test.ts`. The
   * builder is a `.mtg-screen` and this route's own chrome -- the invite, and
   * whatever the poll last said -- used to be siblings above it, which inside a
   * frame is height taken off the two panes before they draw a card. It goes in
   * `.mtg-builder__above` instead, the box `../../src/styles/deck.ts` caps at
   * two fifths of the frame and scrolls.
   */
  it('draws the room inside the builder frame rather than above it', async () => {
    lab(
      () => json(wire()),
      () => json({ refused: 'that deck is 12 cards; this table plays 40' }, 409),
    );
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    const container = page;
    if (container === null) throw new Error('nothing was rendered');
    fireEvent.click(await screen.findByRole('button', { name: ROOM_SEND_LABEL }));
    await screen.findByRole('alert');
    const screenElement = container.querySelector('.mtg-builder-screen');
    if (screenElement === null) throw new Error('the room drew no builder screen');
    // Nothing between it and the region a route is rendered into: this host adds
    // no column of its own, so the shell sizes the screen directly.
    expect(screenElement.parentElement).toBe(container);
    const refusal = container.querySelector('.mtg-builder__above [role="alert"]');
    expect(refusal, 'what the room said is outside the box that holds the chrome').not.toBeNull();
    expect(like(refusal).textContent).toContain('this table plays 40');
  });

  it('says the deck is in, and who it is waiting on', async () => {
    lab(
      () => json(wire()),
      () =>
        json(
          wire({
            revision: 1,
            seats: [
              { name: 'You', ready: true },
              { name: 'Sam', ready: false },
            ],
          }),
        ),
    );
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    fireEvent.click(await screen.findByRole('button', { name: ROOM_SEND_LABEL }));
    await waitFor(() => {
      expect(screenText()).toContain('Waiting for Sam');
    });
  });

  it('draws the refusal and leaves the deck editable, since there is no game yet', async () => {
    lab(
      () => json(wire()),
      () => json({ refused: 'that deck is 12 cards; this table plays 40' }, 409),
    );
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    fireEvent.click(await screen.findByRole('button', { name: ROOM_SEND_LABEL }));
    await screen.findByRole('alert');
    expect(like(screen.getByRole('alert')).textContent).toContain('this table plays 40');
    // The button is back, because a refused deck is one somebody re-cuts.
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
  });

  it("refuses a pool the room's own set does not print, and names the cards", async () => {
    lab(() => json(wire({ pool: ['other-1', 'other-2', ...POOL.slice(0, 5)] })));
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    await waitFor(() => {
      expect(screenText()).toContain(ROOM_MISMATCH_TITLE);
    });
    expect(screenText()).toContain('other-1');
    expect(screenText()).toContain('other-2');
    // And no builder: half a pool is the state this refusal exists to prevent.
    expect(screen.queryByRole('button', { name: ROOM_SEND_LABEL })).toBeNull();
  });

  it('asks the room which set its pool is printed in, once', async () => {
    const asked = lab(() => json(wire()));
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
    const sets = asked.filter((ask) => ask.url === '/api/room/token-one/set');
    // Once, not per poll: a room's set is fixed when the room is opened, so a
    // second ask is a question whose answer cannot have changed.
    expect(sets).toHaveLength(1);
    expect(sets[0]?.method).toBe('GET');
  });

  it('says so when the room will not hand over its set, rather than drawing a pool', async () => {
    lab(
      () => json(wire()),
      undefined,
      () => json({ refused: 'no seat answers to that link' }, 404),
    );
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    await screen.findByText(ROOM_SET_TITLE);
    // No builder and no mismatch: the set never arrived, which is a different
    // sentence from a pool that does not match one.
    expect(screen.queryByRole('button', { name: ROOM_SEND_LABEL })).toBeNull();
    expect(screenText()).not.toContain(ROOM_MISMATCH_TITLE);
  });

  it('becomes the board when the room says the game has started', async () => {
    lab(() => json(wire({ phase: 'playing' })));
    show(h(RemoteSealed, { base: '/api', token: 'token-one' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: ROOM_SEND_LABEL })).toBeNull();
    });
    // The board reads its own route under the same token, which is the whole
    // reason the link never changes hands twice.
    expect(screenText()).not.toContain(ROOM_POOL_LABEL);
  });
});

/**
 * And the route that mounts it, which is where the link becomes the screen.
 *
 * `?room=` and `?table=` are two parameters rather than one with a flag,
 * because the link is what says which of the two a seat is: a page that probed
 * for a room on every seat link would ask the wrong question of every table
 * dealt before rooms existed. So the route has to keep them apart, and these
 * are the two directions it can get that wrong in.
 */
describe('the Play route, handed a room link', () => {
  const ready = { status: 'ready', cards: SET } as const;

  it('opens the build screen rather than the chooser', async () => {
    lab(() => json(wire()));
    show(h(PlayRoute, { set: ready, room: 'token-one', tableBase: '/api' }));
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
    expect(screenText()).toContain(ROOM_POOL_LABEL);
  });

  it("resolves the pool against the room's set, not the one this page has staged", async () => {
    // The reported bug, from the outside: a tab on one set, a room dealt from
    // another. It refused a pool that was perfectly good. Now the page's set is
    // not a term in the question at all, and the builder opens.
    const foreign = { status: 'ready', cards: FOREIGN } as const;
    lab(() => json(wire()));
    show(h(PlayRoute, { set: foreign, room: 'token-one', tableBase: '/api' }));
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
    expect(screenText()).not.toContain(ROOM_MISMATCH_TITLE);
  });

  it('opens a room link before the staged set has finished loading', async () => {
    // `loading` used to resolve to an empty card list, so a fresh room link
    // drew the mismatch refusal for as long as the staged fetch took.
    lab(() => json(wire()));
    show(h(PlayRoute, { set: { status: 'loading' }, room: 'token-one', tableBase: '/api' }));
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
    expect(screenText()).not.toContain(ROOM_MISMATCH_TITLE);
  });

  it('does not read a room link as a table one', async () => {
    const asked = lab(() => json(wire()));
    show(h(PlayRoute, { set: ready, room: 'token-one', tableBase: '/api' }));
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });
    // The room route, and never the table one: a seat still building has no
    // table to poll, and asking for one would draw an error over the builder.
    expect(asked.some((ask) => ask.url.startsWith('/api/room/'))).toBe(true);
    // `/api/table/<token>` is the board's own poll and it is not asked here.
    // The invite beside it is, under the same token, which is the point of the
    // token being one thing: the link a host hands out does not change when the
    // room becomes a table.
    expect(asked.map((ask) => ask.url)).not.toContain('/api/table/token-one');
  });

  /**
   * The pictures follow the pool, for the same reason the cards do.
   *
   * `mtg-5h78`. All three dealers are built from the set the launcher opened
   * (`tools/play.ts`), so switching the picker changes what a tab browses and
   * changes nothing about what a room deals. The browsed set's manifest is keyed
   * to the browsed set's ids, so a room read from that tab drew the labeled
   * pending frame on every card in the pool: the cards were right, the names
   * were right, and one side of a LAN game looked unfinished.
   */

  /**
   * Both sealed panes in full cards, so their tiles draw illustrations at all.
   *
   * A pane opens in compact since `mtg-ljda`, and a compact tile drops the art
   * window (`../../src/card/anatomy.ts`). These tests are about *which* set's pictures
   * reach the screen, so they ask for the mode that has pictures rather than
   * measuring whichever mode is the default.
   */
  function fullSealedPanes(): void {
    const host = globalThis as { readonly localStorage?: { setItem(key: string, value: string): void } };
    const kept = host.localStorage;
    if (kept === undefined) throw new Error('no preference store');
    for (const pane of ['limited-deck', 'limited-pool']) kept.setItem(deckViewStoreKey(pane), 'full');
  }

  it("draws the dealt set's art over a room, not the art of the set this tab browses", async () => {
    fullSealedPanes();
    lab(() => json(wire()));
    const browsed: ArtResolver = (card) => ({ src: `browsed/${card.id}.png`, alt: `browsed ${card.name}` });
    const dealt: ArtResolver = (card) => ({ src: `dealt/${card.id}.png`, alt: `dealt ${card.name}` });
    show(
      h(PlayRoute, {
        set: { status: 'ready', cards: FOREIGN },
        room: 'token-one',
        tableBase: '/api',
        artFor: browsed,
        dealtArtFor: dealt,
      }),
    );
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });

    // By the alt text each resolver writes, since the rarity seal beside every
    // tile is an `img` too and is nobody's illustration.
    const drawn = screen.getAllByRole('img', { name: /^dealt / }).map((image) => srcOf(image));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((src) => src.startsWith('dealt/'))).toBe(true);
    expect(screen.queryAllByRole('img', { name: /^browsed / })).toEqual([]);
  });

  it('draws pending frames when the dealt set has no art, rather than another set’s', async () => {
    // `null` is the answer "that set has had no art run", and it has to survive
    // the trip: a `??` here would fall back to the browsed set's resolver, which
    // paints one set's pictures onto whichever ids the two happen to share.
    fullSealedPanes();
    lab(() => json(wire()));
    const browsed: ArtResolver = (card) => ({ src: `browsed/${card.id}.png`, alt: `browsed ${card.name}` });
    show(
      h(PlayRoute, {
        set: { status: 'ready', cards: FOREIGN },
        room: 'token-one',
        tableBase: '/api',
        artFor: browsed,
        dealtArtFor: null,
      }),
    );
    await screen.findByRole('button', { name: ROOM_SEND_LABEL });

    expect(screen.queryAllByRole('img', { name: /^browsed / })).toEqual([]);
    expect(screen.getAllByLabelText(new RegExp(`^${ART_PENDING_LABEL} for `)).length).toBeGreaterThan(0);
  });
});
