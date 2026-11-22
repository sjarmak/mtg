/**
 * Where variations live: one directory, one JSON file per variation.
 *
 * `mtg-j1rg` asks for a durable deck library and says outright that
 * `localStorage` must not be the canonical store. The reason is in
 * `@mtg/ui`'s `routes/deck/saved-decks.ts`, which uses it and states its own
 * costs: the decks are per browser and per origin, clearing site data wipes
 * them, and nothing syncs. That was the right trade when the lab was a static
 * page with no backend to POST to. The workbench has one — it needs a server to
 * reach a model at all — so the moment that server exists, the reason for
 * keeping decks in a browser is gone.
 *
 * A directory of files rather than a database, because the whole content is a
 * few hundred kilobytes of documents nobody queries across. `git status` shows
 * what changed, a variation can be copied to another machine by copying a file,
 * and there is no schema migration to run at startup. A database would be an
 * index over thirty rows.
 *
 * ## Reads never throw on a bad file
 *
 * One unreadable variation must not take the shelf down with it. A file that
 * fails to parse is reported as a named failure and the rest of the shelf is
 * returned, because the alternative is a workbench that will not open until
 * somebody finds and deletes a file by hand. Writes are the opposite and do
 * throw: a save that silently did not happen is the failure this store exists
 * to prevent.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DeckVariation, VariationSummary } from './variation';
import { DeckVariationSchema, summarize } from './variation';

/** A file the shelf could not read, named so somebody can go look at it. */
export interface UnreadableVariation {
  readonly file: string;
  readonly reason: string;
}

export interface VariationShelf {
  readonly variations: readonly VariationSummary[];
  /** Files in the directory that are not readable variations. Usually empty. */
  readonly unreadable: readonly UnreadableVariation[];
}

/**
 * An id that cannot escape the store's directory.
 *
 * Ids come off a URL path, so they are external input reaching a filesystem
 * call. Restricted to what `randomUUID` produces rather than sanitized: a
 * rejection list is a guess about what is dangerous, and an allowance is a
 * statement about what is expected.
 */
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

export class InvalidVariationIdError extends Error {
  constructor(readonly id: string) {
    super(`${id} is not a variation id`);
    this.name = 'InvalidVariationIdError';
  }
}

export class VariationNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`no variation ${id}`);
    this.name = 'VariationNotFoundError';
  }
}

export class VariationStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = resolve(dir);
    mkdirSync(this.#dir, { recursive: true });
  }

  /** Where the variations are, for a launcher that wants to print it. */
  get directory(): string {
    return this.#dir;
  }

  list(): VariationShelf {
    const variations: VariationSummary[] = [];
    const unreadable: UnreadableVariation[] = [];

    for (const file of readdirSync(this.#dir).sort()) {
      if (!file.endsWith('.json')) continue;
      try {
        variations.push(summarize(this.#parse(join(this.#dir, file))));
      } catch (reason: unknown) {
        unreadable.push({ file, reason: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    // Newest first: a shelf is read from the top, and the last build is the one
    // somebody is looking for.
    variations.sort((left, right) => right.builtAt.localeCompare(left.builtAt));
    return { variations, unreadable };
  }

  read(id: string): DeckVariation {
    return this.#parse(this.#pathFor(id));
  }

  /**
   * Writes through a temporary file in the same directory, then renames.
   *
   * A rename within one filesystem is atomic, so a reader either sees the whole
   * variation or the previous one, never half of a 60-card deck. Writing in
   * place would leave a truncated document on any interrupted write, and the
   * shelf would then refuse the file forever.
   */
  write(variation: DeckVariation): void {
    const target = this.#pathFor(variation.id);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(variation, null, 2)}\n`);
    renameSync(temporary, target);
  }

  delete(id: string): void {
    const path = this.#pathFor(id);
    // Checked first so a missing id is a named failure rather than a silent
    // success: a shelf that reports "deleted" for an id it never held is a shelf
    // that will disagree with the next listing.
    this.read(id);
    rmSync(path);
  }

  #pathFor(id: string): string {
    if (!ID_PATTERN.test(id)) throw new InvalidVariationIdError(id);
    return join(this.#dir, `${id}.json`);
  }

  #parse(path: string): DeckVariation {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      throw new VariationNotFoundError(path);
    }
    return DeckVariationSchema.parse(JSON.parse(text));
  }
}
