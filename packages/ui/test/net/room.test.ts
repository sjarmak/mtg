// @vitest-environment jsdom
/**
 * The room, read from the page: the pool, the wait, and the deck going back.
 *
 * The seam this file guards is narrow on purpose. A room crosses the wire as a
 * list of card ids and comes back as a list of indices into that list, so the
 * only thing this module can get wrong is believing something it should have
 * refused — and every refusal here is a screen that says why instead of one that
 * draws a pool it cannot resolve.
 *
 * The validator is this side's own (the sender is the thing that might be
 * wrong), so the malformed bodies below are the whole point rather than
 * defensive garnish.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_NATIVE_DRAFT_BOT_POLICY, DRAFTMANCER_SIMPLE_BOT_POLICY } from '@mtg/draft-export';
import type { RoomBuild } from '@mtg/netplay';
import { ROOM_POLL_MS, readRoomView, submitBuild, useRoom } from '../../src/net/room';

interface ElementLike {
  readonly textContent: string;
}

function like(node: unknown): ElementLike {
  return node as ElementLike;
}

let restore: (() => void) | null = null;

function stubFetch(
  answer: (url: string, init?: { method?: string; body?: string }) => Promise<Response>,
): void {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: answer });
  restore = (): void => {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  };
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

/** A room the way the server sends one, with whatever this test is changing. */
function wire(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    protocol: 3,
    room: 'room-1',
    phase: 'build',
    seat: 0,
    seats: [
      { name: 'You', ready: false },
      { name: 'Your opponent', ready: false },
    ],
    revision: 0,
    pool: ['xmp-one', 'xmp-two'],
    deckSize: 40,
    ...over,
  };
}

describe('readRoomView', () => {
  it('reads a room the server sent', () => {
    const read = readRoomView(wire(), 'the room');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.view.seat).toBe(0);
    expect(read.view.pool).toEqual(['xmp-one', 'xmp-two']);
    expect(read.view.deckSize).toBe(40);
    expect(read.view.seats[1]?.name).toBe('Your opponent');
  });

  it('reads the started room, which is the one the board takes over from', () => {
    const read = readRoomView(wire({ phase: 'playing', revision: 2 }), 'the room');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.view.phase).toBe('playing');
  });

  it('preserves the named bot policy after a draft advances to deck construction', () => {
    const read = readRoomView(wire({ draftBotPolicy: DEFAULT_NATIVE_DRAFT_BOT_POLICY }), 'the room');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.view.draftBotPolicy).toBe(DEFAULT_NATIVE_DRAFT_BOT_POLICY);
  });

  it('replays an old draft room with the policy those rooms used', () => {
    const read = readRoomView(wire({ phase: 'draft' }), 'the room');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.view.draftBotPolicy).toBe(DRAFTMANCER_SIMPLE_BOT_POLICY);
  });

  it('refuses a draft policy this page cannot replay', () => {
    const read = readRoomView(
      wire({ phase: 'draft', draftBotPolicy: 'native-deck-conditioned/v9' }),
      'the room',
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain('unknown draft bot policy');
  });

  /**
   * One case per field, because each refusal is a different sentence somebody
   * reads on a screen with no pool on it, and a reader that collapsed them would
   * tell a person on an old lab that their pool was unreadable.
   */
  const refusals: readonly (readonly [string, unknown, string])[] = [
    ['a body that is not an object', 'a room', 'did not answer with an object'],
    ['a body that is a list', [wire()], 'did not answer with an object'],
    ['a protocol this page does not speak', wire({ protocol: 2 }), 'speaks a protocol this page does not'],
    ['a phase that is neither', wire({ phase: 'waiting' }), 'did not say what the room is doing'],
    ['a seat that is not a seat', wire({ seat: 2 }), 'did not say which seat this is'],
    ['no seat at all', wire({ seat: undefined }), 'did not say which seat this is'],
    ['a seat list that is not a list', wire({ seats: 'two' }), 'sent a seat this page cannot read'],
    ['a seat with no readiness', wire({ seats: [{ name: 'You' }] }), 'sent a seat this page cannot read'],
    ['a pool that is not a list', wire({ pool: 'xmp-one' }), 'sent a pool this page cannot read'],
    [
      'a pool holding something that is not an id',
      wire({ pool: ['xmp-one', 7] }),
      'sent a pool this page cannot read',
    ],
    ['a pool holding an empty id', wire({ pool: [''] }), 'sent a pool this page cannot read'],
    ['no room name', wire({ room: undefined }), 'did not name the room'],
    ['a revision that is not a whole number', wire({ revision: 1.5 }), 'did not number the room'],
    ['no deck size', wire({ deckSize: undefined }), 'did not say how big a deck it plays'],
    ['a deck of no cards', wire({ deckSize: 0 }), 'did not say how big a deck it plays'],
  ];

  for (const [what, body, why] of refusals) {
    it(`refuses ${what}`, () => {
      const read = readRoomView(body, 'the room');
      expect(read.ok).toBe(false);
      if (read.ok) return;
      expect(read.message).toContain(why);
    });
  }

  it('says where the trouble came from, so two seams do not read alike', () => {
    const read = readRoomView(null, 'the lab');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain('the lab');
  });
});

describe('submitBuild', () => {
  const build: RoomBuild = { chosen: [0, 1], basics: { W: 9, U: 0, B: 0, R: 0, G: 0 } };

  it('sends the indices and reads back the room the send produced', async () => {
    const sent: { url: string; method: string; body: string }[] = [];
    stubFetch((url, init) => {
      sent.push({ url, method: init?.method ?? 'GET', body: init?.body ?? '' });
      return json(
        wire({
          revision: 1,
          seats: [
            { name: 'You', ready: true },
            { name: 'Them', ready: false },
          ],
        }),
      );
    });

    const result = await submitBuild('/api', 'token-one', build);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.revision).toBe(1);
    expect(result.view.seats[0]?.ready).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/room/token-one');
    expect(sent[0]?.method).toBe('POST');
    // Indices, never card ids: naming a card the pool never held is the thing
    // this shape makes unsayable rather than merely refused.
    expect(JSON.parse(sent[0]?.body ?? 'null')).toEqual(build);
  });

  it('carries a refusal and the room it was refused against', async () => {
    stubFetch(() =>
      json({ refused: 'that deck is 12 cards; this table plays 40', room: wire({ revision: 3 }) }, 409),
    );
    const result = await submitBuild('/api', 'token-one', build);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('that deck is 12 cards; this table plays 40');
    expect(result.view?.revision).toBe(3);
  });

  it('still says why when the refusal comes without a room beside it', async () => {
    stubFetch(() => json({ refused: 'this table has already started' }, 409));
    const result = await submitBuild('/api', 'token-one', build);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('this table has already started');
    expect(result.view).toBeNull();
  });

  it('falls back to the status when nothing on the wire explains itself', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>gateway</html>', { status: 502 })));
    const result = await submitBuild('/api', 'token-one', build);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('502');
  });

  it('refuses an accepted answer it cannot read, rather than acting on it', async () => {
    stubFetch(() => json(wire({ pool: 'xmp-one' })));
    const result = await submitBuild('/api', 'token-one', build);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('cannot read');
  });

  it('reports a lab that is no longer there', async () => {
    stubFetch(() => Promise.reject(new Error('failed to fetch')));
    const result = await submitBuild('/api', 'token-one', build);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('failed to fetch');
  });
});

/** A probe that renders whatever the hook is holding, and nothing else. */
function Probe(props: { readonly base: string; readonly token: string }): ReturnType<typeof h> {
  const room = useRoom(props.base, props.token);
  return h(
    'output',
    null,
    room.error ?? (room.view === null ? 'asking' : `${room.view.phase}/${String(room.view.revision)}`),
  );
}

function shown(): string {
  return like(screen.getByRole('status')).textContent;
}

describe('useRoom', () => {
  it('asks the seat room and holds what came back', async () => {
    const asked: string[] = [];
    stubFetch((url) => {
      asked.push(url);
      return json(wire());
    });
    render(h(Probe, { base: '/api', token: 'token-one' }));
    await waitFor(() => {
      expect(shown()).toBe('build/0');
    });
    expect(asked[0]).toBe('/api/room/token-one');
  });

  it('says what went wrong and keeps asking, because a blink is not the end', async () => {
    let answers = 0;
    stubFetch(() => {
      answers += 1;
      return answers === 1 ? Promise.reject(new Error('network down')) : json(wire({ revision: 4 }));
    });
    render(h(Probe, { base: '/api', token: 'token-one' }));
    await waitFor(() => {
      expect(shown()).toBe('network down');
    });
    await waitFor(
      () => {
        expect(shown()).toBe('build/4');
      },
      { timeout: 5_000 },
    );
  });

  it('reports the status when the room answers something other than a room', async () => {
    stubFetch(() => json({ refused: 'no such token' }, 404));
    render(h(Probe, { base: '/api', token: 'nobody' }));
    await waitFor(() => {
      expect(shown()).toContain('404');
    });
  });

  it('stops asking once the game has started, since the board polls from there', async () => {
    let answers = 0;
    stubFetch(() => {
      answers += 1;
      return json(wire({ phase: 'playing', revision: 2 }));
    });
    render(h(Probe, { base: '/api', token: 'token-one' }));
    await waitFor(() => {
      expect(shown()).toBe('playing/2');
    });
    // One whole interval and a little, in real time: the claim is that the timer
    // was cleared, and a wait shorter than the interval would pass against a
    // poll that is still running.
    const settled = answers;
    await new Promise((resolve) => setTimeout(resolve, ROOM_POLL_MS + 200));
    expect(answers).toBe(settled);
  });
});
