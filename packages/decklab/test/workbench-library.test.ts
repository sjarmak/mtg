/**
 * The deck library: the store on disk and the three routes over it.
 *
 * `mtg-j1rg`. The decks a person builds, seals or drafts used to live in the
 * browser's `localStorage`, which is per browser, per origin, wiped by clearing
 * site data and capable of refusing a write at quota — so the failure this file
 * exists to pin is a save that reported success and kept nothing.
 *
 * Two halves, and they fail differently on purpose. A read never throws on a bad
 * file, because one unreadable deck must not take the shelf down with it; a
 * write throws on everything it cannot do, because a silent one is the whole
 * bug. Both halves are asserted here rather than only through the routes: the
 * routes translate errors into status codes, and a translation test that never
 * saw the error it is translating passes on a store that raised nothing.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DeckIdMismatchError,
  DeckLibraryStore,
  DeckNotFoundError,
  InvalidDeckIdError,
} from '../src/workbench/library-store';
import type { LibraryDeck } from '../src/workbench/library';
import { LIBRARY_DECK_VERSION, libraryCardCount } from '../src/workbench/library';
import type { RunningWorkbenchServer, WorkbenchSet } from '../src/workbench/server';
import { serveDeckWorkbench } from '../src/workbench/server';
import { VariationStore } from '../src/workbench/store';

const SETS: readonly WorkbenchSet[] = [{ code: 'XMP', name: 'the flagship set', cardCount: 371 }];

/**
 * A deck shaped the way the page mints one: a `deck-<base36>-<hex>` id, entries
 * carrying the name beside the id, and the basics counted out by color.
 */
function deck(overrides: Partial<LibraryDeck> = {}): LibraryDeck {
  return {
    version: LIBRARY_DECK_VERSION,
    id: 'deck-m1kx3n-9f2a',
    name: 'kingdom weenie',
    savedAt: '2026-09-01T12:00:00.000Z',
    entries: [
      { id: 'xmp-skyborn-fledgling', name: 'Skyborn Fledgling', count: 4 },
      { id: 'xmp-warden-of-the-sky', name: 'Warden of the Sky', count: 2 },
    ],
    basics: [{ color: 'W', count: 17 }],
    set: { name: 'the flagship set', origin: 'custom' },
    source: 'constructed',
    ...overrides,
  };
}

let running: RunningWorkbenchServer | undefined;
const directories: string[] = [];

afterEach(async () => {
  if (running !== undefined) await running.close();
  running = undefined;
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function newDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'mtg-library-'));
  directories.push(directory);
  return directory;
}

function newStore(): DeckLibraryStore {
  return new DeckLibraryStore(newDirectory());
}

/** A server with a library, or — when `library` is false — deliberately without one. */
async function start(options: { readonly library?: boolean } = {}): Promise<{
  readonly base: string;
  readonly library: DeckLibraryStore | undefined;
}> {
  const library = options.library === false ? undefined : newStore();
  running = await serveDeckWorkbench({
    port: 0,
    host: '127.0.0.1',
    sets: SETS,
    store: new VariationStore(newDirectory()),
    ...(library === undefined ? {} : { library }),
  });
  return { base: `http://127.0.0.1:${String(running.port)}`, library };
}

describe('the deck library store', () => {
  it('writes a deck and reads back every field of it', () => {
    const store = newStore();
    const saved = deck();

    store.write(saved.id, saved);

    expect(store.read(saved.id)).toEqual(saved);
    expect(libraryCardCount(saved)).toBe(6);
  });

  it('writes through a temporary file, so a reader never sees half a deck', () => {
    // The rename is the atomicity; what is checkable after the fact is that the
    // temporary file is gone and exactly one document is on the shelf.
    const store = newStore();
    const saved = deck();

    store.write(saved.id, saved);

    const files = readdirSync(store.directory);
    expect(files).toEqual([`${saved.id}.json`]);
  });

  it('replaces a deck under the same id rather than shelving it twice', () => {
    const store = newStore();
    const first = deck({ name: 'kingdom weenie' });
    store.write(first.id, first);

    store.write(first.id, { ...first, name: 'kingdom weenie, cut for speed' });

    expect(store.list().decks).toHaveLength(1);
    expect(store.read(first.id).name).toBe('kingdom weenie, cut for speed');
  });

  it('refuses a document filed under an id it does not call itself', () => {
    // The id arrives twice — once off a URL, once out of a body — and a save
    // that filed them apart would be found by the next read, which looks the
    // deck up by the id the document carries.
    const store = newStore();

    expect(() => store.write('deck-other', deck())).toThrow(DeckIdMismatchError);
    expect(readdirSync(store.directory)).toEqual([]);
  });

  it('refuses an id that could leave the directory', () => {
    const store = newStore();

    expect(() => store.read('../../etc/passwd')).toThrow(InvalidDeckIdError);
    expect(() => store.write('..', deck({ id: '..' }))).toThrow(InvalidDeckIdError);
  });

  it('lists newest save first', () => {
    const store = newStore();
    const older = deck({ id: 'deck-older', savedAt: '2026-08-01T00:00:00.000Z' });
    const newer = deck({ id: 'deck-newer', savedAt: '2026-09-01T00:00:00.000Z' });
    // Written oldest-last so a passing order cannot be write order.
    store.write(newer.id, newer);
    store.write(older.id, older);

    expect(store.list().decks.map((entry) => entry.id)).toEqual(['deck-newer', 'deck-older']);
  });

  it('reports one unreadable file and still returns the rest of the shelf', () => {
    // The Decks tab has to open. A shelf that refuses to list until somebody
    // finds and deletes a file by hand is the failure mode this tolerance exists
    // to prevent.
    const store = newStore();
    const good = deck();
    store.write(good.id, good);
    writeFileSync(join(store.directory, 'deck-broken.json'), '{ not json');
    writeFileSync(join(store.directory, 'deck-old.json'), JSON.stringify({ version: 0, id: 'x' }));

    const shelf = store.list();

    expect(shelf.decks.map((entry) => entry.id)).toEqual([good.id]);
    expect(shelf.unreadable.map((entry) => entry.file).sort()).toEqual(['deck-broken.json', 'deck-old.json']);
    for (const entry of shelf.unreadable) expect(entry.reason).not.toBe('');
  });

  it('deletes a deck, and names a delete of one it never held', () => {
    const store = newStore();
    const saved = deck();
    store.write(saved.id, saved);

    store.delete(saved.id);

    expect(store.list().decks).toEqual([]);
    expect(() => store.delete(saved.id)).toThrow(DeckNotFoundError);
  });

  it('keeps a deck saved before the library knew about sets or sources', () => {
    // Both fields are optional so the decks already on somebody's shelf survive
    // the day the field was added. This is that day, written down.
    const store = newStore();
    const legacy: LibraryDeck = {
      version: LIBRARY_DECK_VERSION,
      id: 'deck-legacy',
      name: 'the one from before',
      savedAt: '2026-07-01T00:00:00.000Z',
      entries: [{ id: 'xmp-skyborn-fledgling', name: 'Skyborn Fledgling', count: 1 }],
      basics: null,
    };
    writeFileSync(join(store.directory, 'deck-legacy.json'), JSON.stringify(legacy));

    expect(store.list().decks).toEqual([legacy]);
  });
});

describe('the deck library routes', () => {
  it('answers 404 with a sentence when the server was started without a library', async () => {
    // `npm run deckbench` and `npm run play` both start this server, and a
    // surface has to be able to tell "no library here" from "the library is
    // empty" — one is a deck that will not save, the other is a shelf to fill.
    const { base } = await start({ library: false });

    const response = await fetch(`${base}/deck-api/decks`);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { refused: string };
    expect(body.refused).toContain('without a deck library');
  });

  it('answers an empty shelf rather than a failure', async () => {
    const { base } = await start();

    const response = await fetch(`${base}/deck-api/decks`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ decks: [], unreadable: [] });
  });

  it('saves a deck and lists it back', async () => {
    const { base, library } = await start();
    const saved = deck();

    const put = await fetch(`${base}/deck-api/decks/${saved.id}`, {
      method: 'PUT',
      body: JSON.stringify(saved),
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ saved: saved.id });
    // Through the store as well as through the route: the point of the lane is
    // that the deck is on a disk, not that a response said so.
    expect(library?.read(saved.id)).toEqual(saved);
    const shelf = (await (await fetch(`${base}/deck-api/decks`)).json()) as { decks: LibraryDeck[] };
    expect(shelf.decks).toEqual([saved]);
  });

  it('takes the same save twice, because the page mints the id', async () => {
    // PUT rather than POST for exactly this: a page that did not hear the answer
    // retries, and a retry must not shelve a second copy of the deck.
    const { base } = await start();
    const saved = deck();
    const send = async (): Promise<number> =>
      (await fetch(`${base}/deck-api/decks/${saved.id}`, { method: 'PUT', body: JSON.stringify(saved) }))
        .status;

    expect(await send()).toBe(200);
    expect(await send()).toBe(200);

    const shelf = (await (await fetch(`${base}/deck-api/decks`)).json()) as { decks: LibraryDeck[] };
    expect(shelf.decks).toHaveLength(1);
  });

  it('refuses a document that is not a deck, and says everything wrong with it at once', async () => {
    const { base, library } = await start();

    const response = await fetch(`${base}/deck-api/decks/deck-bad`, {
      method: 'PUT',
      body: JSON.stringify({ version: LIBRARY_DECK_VERSION, id: 'deck-bad', name: '', entries: 'no' }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      refused: string;
      issues: { pointer: string; message: string }[];
    };
    expect(body.refused).toContain('deck');
    expect(body.issues.map((issue) => issue.pointer).sort()).toEqual([
      '/basics',
      '/entries',
      '/name',
      '/savedAt',
    ]);
    expect(library?.list().decks).toEqual([]);
  });

  it('refuses a deck whose document is filed under another id', async () => {
    const { base } = await start();

    const response = await fetch(`${base}/deck-api/decks/deck-elsewhere`, {
      method: 'PUT',
      body: JSON.stringify(deck()),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { refused: string };
    expect(body.refused).toContain('deck-elsewhere');
  });

  it('reads one deck by id, and 404s one it does not have', async () => {
    const { base } = await start();
    const saved = deck();
    await fetch(`${base}/deck-api/decks/${saved.id}`, { method: 'PUT', body: JSON.stringify(saved) });

    expect(await (await fetch(`${base}/deck-api/decks/${saved.id}`)).json()).toEqual(saved);
    expect((await fetch(`${base}/deck-api/decks/deck-absent`)).status).toBe(404);
  });

  it('deletes a deck', async () => {
    const { base, library } = await start();
    const saved = deck();
    await fetch(`${base}/deck-api/decks/${saved.id}`, { method: 'PUT', body: JSON.stringify(saved) });

    const response = await fetch(`${base}/deck-api/decks/${saved.id}`, { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: saved.id });
    expect(library?.list().decks).toEqual([]);
  });

  it('says how the shelf is written when a method is not one of them', async () => {
    const { base } = await start();

    const response = await fetch(`${base}/deck-api/decks`, { method: 'DELETE' });

    expect(response.status).toBe(405);
    const body = (await response.json()) as { refused: string };
    expect(body.refused).toContain('PUT');
  });

  it('survives an unreadable file on the shelf and names it', async () => {
    const { base, library } = await start();
    const saved = deck();
    await fetch(`${base}/deck-api/decks/${saved.id}`, { method: 'PUT', body: JSON.stringify(saved) });
    writeFileSync(join(library?.directory ?? '', 'deck-torn.json'), '{"version":1,');

    const shelf = (await (await fetch(`${base}/deck-api/decks`)).json()) as {
      decks: LibraryDeck[];
      unreadable: { file: string }[];
    };

    expect(shelf.decks.map((entry) => entry.id)).toEqual([saved.id]);
    expect(shelf.unreadable.map((entry) => entry.file)).toEqual(['deck-torn.json']);
  });

  it('keeps the deck it wrote as one document a person can read', async () => {
    // The store's whole argument for files over a database is that a deck moves
    // between machines by copying one, so the file on disk is part of the
    // contract rather than an implementation detail.
    const { base, library } = await start();
    const saved = deck();
    await fetch(`${base}/deck-api/decks/${saved.id}`, { method: 'PUT', body: JSON.stringify(saved) });

    const text = readFileSync(join(library?.directory ?? '', `${saved.id}.json`), 'utf8');

    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(saved);
  });
});
