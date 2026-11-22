/**
 * Where library decks live: one directory, one JSON file per deck.
 *
 * The same arrangement `./store.ts` uses for variations, for the same reasons it
 * argues there — a few hundred kilobytes of documents nobody queries across,
 * `git status` shows what changed, a deck moves between machines by copying a
 * file, and there is no schema migration to run at startup. A database would be
 * an index over thirty rows.
 *
 * # Why the mechanics are written twice rather than extracted
 *
 * Two stores now do atomic-write-through-rename, tolerant listing and id
 * validation, and a third would be the point at which those become a shared
 * `JsonDocumentStore` rather than a shape two files happen to share. Extracting
 * at two would also have to unify the two error types `./server.ts` catches by
 * name, which is a change to the build routes to gain nothing the library needs.
 * The duplication is named here so the third store is written as an extraction
 * rather than as a third copy.
 *
 * # Reads never throw on a bad file, writes always do
 *
 * One unreadable deck must not take the library down with it: a file that fails
 * to parse is reported as a named failure and the rest of the shelf comes back,
 * because the alternative is a Decks tab that will not open until somebody finds
 * and deletes a file by hand. Writes are the opposite: a save that silently did
 * not happen is the failure this store exists to prevent, and `mtg-j1rg` exists
 * because the previous store could fail one — a browser at its quota refuses a
 * write and the deck is gone with the tab.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LibraryDeck } from './library';
import { LibraryDeckSchema } from './library';

/** A file the library could not read, named so somebody can go look at it. */
export interface UnreadableDeck {
  readonly file: string;
  readonly reason: string;
}

export interface DeckShelf {
  /** Newest save first: a shelf is read from the top. */
  readonly decks: readonly LibraryDeck[];
  /** Files in the directory that are not readable decks. Usually empty. */
  readonly unreadable: readonly UnreadableDeck[];
}

/**
 * An id that cannot escape the store's directory.
 *
 * Ids come off a URL path, so they are external input reaching a filesystem
 * call. An allowance rather than a rejection list, for `./store.ts`'s reason: a
 * rejection list is a guess about what is dangerous and an allowance is a
 * statement about what is expected. It is wider than that one because the page
 * mints `deck-<base36>-<hex>` rather than a UUID, and both fit inside it.
 */
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

export class InvalidDeckIdError extends Error {
  constructor(readonly id: string) {
    super(`${id} is not a deck id`);
    this.name = 'InvalidDeckIdError';
  }
}

export class DeckNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no deck ${id}`);
    this.name = 'DeckNotFoundError';
  }
}

export class DeckIdMismatchError extends Error {
  constructor(
    readonly id: string,
    readonly documentId: string,
  ) {
    super(`the deck at ${id} calls itself ${documentId}`);
    this.name = 'DeckIdMismatchError';
  }
}

export class DeckLibraryStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = resolve(dir);
    mkdirSync(this.#dir, { recursive: true });
  }

  /** Where the decks are, for a launcher that wants to print it. */
  get directory(): string {
    return this.#dir;
  }

  list(): DeckShelf {
    const decks: LibraryDeck[] = [];
    const unreadable: UnreadableDeck[] = [];

    for (const file of readdirSync(this.#dir).sort()) {
      if (!file.endsWith('.json')) continue;
      try {
        decks.push(this.#parse(join(this.#dir, file)));
      } catch (reason: unknown) {
        unreadable.push({ file, reason: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    decks.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    return { decks, unreadable };
  }

  read(id: string): LibraryDeck {
    return this.#parse(this.#pathFor(id));
  }

  /**
   * Writes through a temporary file in the same directory, then renames.
   *
   * A rename within one filesystem is atomic, so a reader either sees the whole
   * deck or the previous one, never half of a sixty-card list. Writing in place
   * would leave a truncated document on any interrupted write, and the shelf
   * would then refuse the file forever.
   *
   * The id in the path and the id in the document have to agree. They arrive
   * separately — one off a URL, one out of a body — and a save that filed a deck
   * under an id it does not call itself would be found by the next read, which
   * looks the deck up by the id the document carries.
   */
  write(id: string, deck: LibraryDeck): void {
    if (deck.id !== id) throw new DeckIdMismatchError(id, deck.id);
    const target = this.#pathFor(id);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(deck, null, 2)}\n`);
    renameSync(temporary, target);
  }

  delete(id: string): void {
    const path = this.#pathFor(id);
    // Read first so a missing id is a named failure rather than a silent
    // success: a library that reports "deleted" for an id it never held is a
    // library that will disagree with the next listing.
    this.read(id);
    rmSync(path);
  }

  #pathFor(id: string): string {
    if (!ID_PATTERN.test(id)) throw new InvalidDeckIdError(id);
    return join(this.#dir, `${id}.json`);
  }

  #parse(path: string): LibraryDeck {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      throw new DeckNotFoundError(path);
    }
    return LibraryDeckSchema.parse(JSON.parse(text) as unknown);
  }
}
