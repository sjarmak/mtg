// @vitest-environment jsdom
/**
 * Where a saved deck is kept, and what happens when the machine that could keep
 * it is not there.
 *
 * `mtg-j1rg`. The store under this was one browser's `localStorage`: clearing
 * site data lost every deck, a second browser saw none of them, and a private
 * window refused the write outright. `@mtg/decklab`'s deck library is the
 * durable half, `npm run play` starts it, and `../../src/routes/deck/
 * deck-keeping.ts` is the page's side of that arrangement.
 *
 * The three claims worth testing are the three that can be got wrong:
 *
 *   1. With a server, the server is canonical and a deck this browser has and
 *      the server has not is *uploaded* rather than dropped. Somebody who saved
 *      ten decks before the library existed keeps all ten.
 *   2. Without a server, everything still works and the page says decks are kept
 *      by this browser only. A missing server is a state, not a failure — the
 *      same rule `workbench/client.ts` states for the workbench.
 *   3. A server write that fails is *reported*, not swallowed. A library that
 *      silently drops a save is the bug this whole lane exists to remove.
 *
 * jsdom has no server behind `/deck-api`, so the fetch is stubbed per test. The
 * stub answers the three real routes and records what it was asked, which is how
 * the upload in claim 1 is asserted: not "the list looks right" but "this PUT
 * happened".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEPT_BY_BROWSER_NOTE,
  KEPT_BY_SERVER_NOTE,
  deckKeeping,
  dropDeck,
  keepDeck,
  refreshDeckKeeping,
  resetDeckKeeping,
  subscribeDeckKeeping,
} from '../../src/routes/deck/deck-keeping';
import { SAVED_DECK_VERSION, readSavedDecks, writeSavedDecks } from '../../src/routes/deck/saved-decks';
import type { SavedDeck } from '../../src/routes/deck/saved-decks';

/** A deck document, with everything a caller does not care about filled in. */
function deck(overrides: Partial<SavedDeck> = {}): SavedDeck {
  return {
    version: SAVED_DECK_VERSION,
    id: 'deck-m1kx3n-9f2a',
    name: 'A deck kept somewhere',
    savedAt: '2026-09-02T10:00:00.000Z',
    entries: [{ id: 'xmp-emberwake-scout', name: 'Emberwake Scout', count: 4 }],
    basics: [{ color: 'W', count: 17 }],
    set: { name: 'the flagship set', origin: 'custom' },
    source: 'constructed',
    ...overrides,
  };
}

/** One request the page made, in the order it made them. */
interface Ask {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

interface Server {
  readonly asks: readonly Ask[];
  readonly shelf: Map<string, SavedDeck>;
}

/**
 * A deck library behind `/deck-api`, or a refusal instead of one.
 *
 * `refuseWrites` is the third claim's subject: a server that lists happily and
 * then declines to keep anything, which is what a full disk looks like from
 * here.
 */
function serve(
  options: { readonly decks?: readonly SavedDeck[]; readonly refuseWrites?: boolean } = {},
): Server {
  const asks: Ask[] = [];
  const shelf = new Map<string, SavedDeck>((options.decks ?? []).map((entry) => [entry.id, entry]));
  const answer = (status: number, payload: unknown): Promise<unknown> =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    });

  vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(init.body);
    asks.push({ method, url, body });
    const id = url.startsWith('/deck-api/decks/')
      ? decodeURIComponent(url.slice('/deck-api/decks/'.length))
      : null;
    if (url === '/deck-api/decks' && method === 'GET') {
      const decks = [...shelf.values()].sort((left, right) => right.savedAt.localeCompare(left.savedAt));
      return answer(200, { decks, unreadable: [] });
    }
    if (id !== null && method === 'PUT') {
      if (options.refuseWrites === true)
        return answer(500, { refused: 'the library could not write that deck' });
      shelf.set(id, body as SavedDeck);
      return answer(200, { saved: id });
    }
    if (id !== null && method === 'DELETE') {
      if (options.refuseWrites === true)
        return answer(500, { refused: 'the library could not remove that deck' });
      shelf.delete(id);
      return answer(200, { deleted: id });
    }
    return answer(404, { refused: `no route ${url}` });
  });
  return { asks, shelf };
}

/** Nothing behind the proxy: what a lab opened without the deck server looks like. */
function serveNothing(): void {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')));
}

/** A server that is there and was started with no library at all. */
function serveWithoutLibrary(): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ refused: 'this server was started without a deck library' }),
      text: () => Promise.resolve(''),
    }),
  );
}

/** Every pending server write, so an assertion reads settled state. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach((): void => {
  localStorage.clear();
  resetDeckKeeping();
});

afterEach((): void => {
  vi.unstubAllGlobals();
  // The private-window test replaces `setItem` on the prototype, and a spy that
  // outlives its test makes every later one run against a browser that refuses
  // to store anything. It cost three failures before it was restored here.
  vi.restoreAllMocks();
  localStorage.clear();
  resetDeckKeeping();
});

describe('a browser with no deck server', () => {
  it('keeps the decks it has and says they are this browser only', async () => {
    writeSavedDecks([deck()]);
    serveNothing();

    const keeping = await refreshDeckKeeping();

    expect(keeping.keeper.kind).toBe('browser');
    expect(keeping.decks.map((entry) => entry.id)).toEqual(['deck-m1kx3n-9f2a']);
    expect(KEPT_BY_BROWSER_NOTE).toContain('this browser');
  });

  it('saves and deletes against the browser alone', async () => {
    serveNothing();
    await refreshDeckKeeping();

    expect(keepDeck(deck())).toBe(true);
    expect(readSavedDecks().map((entry) => entry.name)).toEqual(['A deck kept somewhere']);

    expect(dropDeck('deck-m1kx3n-9f2a')).toBe(true);
    expect(readSavedDecks()).toEqual([]);
    expect(deckKeeping().decks).toEqual([]);
  });

  it('reads a server that has no library as a browser-only library', async () => {
    serveWithoutLibrary();

    const keeping = await refreshDeckKeeping();

    expect(keeping.keeper.kind).toBe('browser');
    expect(keeping.keeper.kind === 'browser' ? keeping.keeper.reason : '').toContain(
      'without a deck library',
    );
  });
});

describe('a browser with the deck server behind it', () => {
  it('takes the server as canonical and writes its decks down here', async () => {
    const remote = deck({ id: 'deck-remote-1', name: 'Kept by the machine' });
    serve({ decks: [remote] });

    const keeping = await refreshDeckKeeping();

    expect(keeping.keeper.kind).toBe('server');
    expect(keeping.decks.map((entry) => entry.id)).toEqual(['deck-remote-1']);
    // Written through to the browser as well, so the next paint is instant and
    // the decks are still there if the server goes away.
    expect(readSavedDecks().map((entry) => entry.id)).toEqual(['deck-remote-1']);
    expect(KEPT_BY_SERVER_NOTE).toContain('machine');
  });

  it('uploads a deck this browser has and the server has not, once', async () => {
    writeSavedDecks([deck({ id: 'deck-local-1', name: 'Saved before the library existed' })]);
    const server = serve({ decks: [deck({ id: 'deck-remote-1', savedAt: '2026-09-01T10:00:00.000Z' })] });

    const first = await refreshDeckKeeping();
    await settle();

    expect(first.decks.map((entry) => entry.id).sort()).toEqual(['deck-local-1', 'deck-remote-1']);
    expect(server.shelf.has('deck-local-1')).toBe(true);
    const uploads = server.asks.filter((ask) => ask.method === 'PUT');
    expect(uploads.map((ask) => ask.url)).toEqual(['/deck-api/decks/deck-local-1']);

    // The second visit has nothing left to upload: the server already holds it.
    await refreshDeckKeeping();
    await settle();
    expect(server.asks.filter((ask) => ask.method === 'PUT')).toHaveLength(1);
  });

  it('sends a save to the server and a delete after it', async () => {
    const server = serve();
    await refreshDeckKeeping();

    expect(keepDeck(deck())).toBe(true);
    await settle();
    expect(server.shelf.get('deck-m1kx3n-9f2a')?.name).toBe('A deck kept somewhere');

    expect(dropDeck('deck-m1kx3n-9f2a')).toBe(true);
    await settle();
    expect(server.shelf.has('deck-m1kx3n-9f2a')).toBe(false);
    expect(server.asks.map((ask) => ask.method)).toEqual(['GET', 'PUT', 'DELETE']);
  });

  it('keeps a deck the browser refused, because the server took it', async () => {
    const server = serve();
    await refreshDeckKeeping();
    // What a private window does: the store is there and declines to write.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(keepDeck(deck())).toBe(true);
    await settle();

    expect(server.shelf.has('deck-m1kx3n-9f2a')).toBe(true);
    expect(deckKeeping().decks.map((entry) => entry.id)).toEqual(['deck-m1kx3n-9f2a']);
    expect(deckKeeping().failure).toBeNull();
  });

  it('reports a server write it refused rather than swallowing it', async () => {
    serve({ refuseWrites: true });
    await refreshDeckKeeping();

    expect(keepDeck(deck())).toBe(true);
    await settle();

    const keeping = deckKeeping();
    expect(keeping.failure).toContain('could not write that deck');
    // The deck is still on this browser, which is what the page must not lie
    // about in either direction: kept here, not kept there.
    expect(readSavedDecks().map((entry) => entry.id)).toEqual(['deck-m1kx3n-9f2a']);
    expect(keeping.keeper.kind).toBe('browser');
  });
});

describe('the one list two panels read', () => {
  it('tells a subscriber about every change', async () => {
    serveNothing();
    let seen = 0;
    const stop = subscribeDeckKeeping(() => {
      seen += 1;
    });

    await refreshDeckKeeping();
    keepDeck(deck());
    dropDeck('deck-m1kx3n-9f2a');
    stop();
    keepDeck(deck({ id: 'deck-after-stop' }));

    expect(seen).toBe(3);
    expect(deckKeeping().decks.map((entry) => entry.id)).toEqual(['deck-after-stop']);
  });

  it('hands the same object back until something changes', async () => {
    serveNothing();
    await refreshDeckKeeping();
    const before = deckKeeping();

    expect(deckKeeping()).toBe(before);

    keepDeck(deck());
    expect(deckKeeping()).not.toBe(before);
  });
});
