/**
 * Bringing the rules-text symbols onto the same origin as the page.
 *
 * `stage-art.ts` already argues this for a card's illustration, and every word
 * of it applies here: an href that names another host makes the page depend on
 * that host being reachable *from wherever the viewer sits*, which is a
 * different network from the one that started the server. The difference is
 * only in what a failure looks like. A missing illustration is a labeled
 * pending frame, so a viewer can see what happened. A missing symbol is an
 * empty box in the middle of a sentence, so the card just reads wrong.
 *
 * So the symbols go through the same path: `@mtg/image-cache` fetches each one
 * once into `data/images/`, keyed by its URL, and the served copy is written
 * into `public/symbols/`. Twenty-nine files, none of them in git, none of them
 * traced or redrawn — `../src/card/symbols.ts` carries the licensing argument
 * for why referencing is the whole of what this tree may do with them.
 *
 * **All of them or none of them.** A run that stages twenty-eight and misses
 * one would draw twenty-eight symbols and one empty box, which is the bug this
 * replaces rather than a smaller version of it. So a single failure gives back
 * `original` — the lab's own drawing, which is always complete and needs no
 * network — and the launcher says so where a person can read it. The files that
 * did arrive stay in the cache, so the next run with a network costs less.
 *
 * Node-only, like everything under `tools/`: `@mtg/image-cache` reaches for
 * `node:fs`, and nothing Vite bundles may import this file.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheImage, DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import type { CacheImageOptions } from '@mtg/image-cache';
import { SCRYFALL_SYMBOL_BASE, SYMBOL_TOKENS } from '../src/card/symbols';
import type { SymbolSet } from '../src/card/symbols';

export interface StagedSymbols {
  /** The set the page should paint with: `local` when every token is served. */
  readonly set: SymbolSet;
  /** Symbols downloaded this run. */
  readonly fetched: number;
  /** Symbols the shared cache already had. */
  readonly reused: number;
  /** One line per symbol that could not be fetched, naming the printed token. */
  readonly failures: readonly string[];
}

export interface StageSymbolsOptions {
  /** The shared cache, usually `data/images` at the repo root. */
  readonly cacheDir: string;
  /** Where the page serves symbols from, usually `public/symbols`. */
  readonly publicDir: string;
  /** Injectable for the tests, which must not touch the network or the disk. */
  readonly cache?: (url: string, options: CacheImageOptions) => ReturnType<typeof cacheImage>;
  readonly publish?: (from: string, to: string) => void;
}

/** How many files a complete local set is; the launcher quotes it. */
export const SYMBOL_COUNT: number = SYMBOL_TOKENS.length;

/**
 * The copy, which also creates the served directory.
 *
 * Unconditional, unlike `stage-art.ts`'s. There the served name carries the
 * URL digest, so a file already at that name is that URL's file; here the
 * served name is the token, so an existing `T.svg` could be left over from a
 * run that was interrupted halfway through writing it.
 */
function publishFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/**
 * Caches every rules-text symbol and returns the set the page can paint with.
 *
 * One request at a time, for the reason `stage-art.ts` gives: twenty-nine small
 * files are a second of wall clock, and a burst at somebody else's CDN to save
 * that second is not a trade worth making.
 */
export async function stageSymbols(options: StageSymbolsOptions): Promise<StagedSymbols> {
  const cache = options.cache ?? cacheImage;
  const publish = options.publish ?? publishFile;

  const failures: string[] = [];
  const staged: { readonly from: string; readonly to: string }[] = [];
  let fetched = 0;
  let reused = 0;

  for (const token of SYMBOL_TOKENS) {
    const url = `${SCRYFALL_SYMBOL_BASE}${token}.svg`;
    try {
      const image = await cache(url, { dir: options.cacheDir });
      staged.push({ from: image.path, to: join(options.publicDir, `${token}.svg`) });
      if (image.fetched) fetched += 1;
      else reused += 1;
    } catch (cause: unknown) {
      failures.push(`{${token}}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  // Published only once the whole set is in hand. A partial directory left
  // behind would be served, and the page has no way to tell a symbol that is
  // missing from one that is late.
  // The counts stay true even here: what arrived is in the shared cache and the
  // next run with a network will not pay for it again.
  if (failures.length > 0) return { set: 'original', fetched, reused, failures };
  for (const file of staged) publish(file.from, file.to);
  return { set: 'local', fetched, reused, failures };
}

/**
 * What the launcher prints about the run, in `play.ts`'s voice: what it staged,
 * where from, and what the page will look like as a result.
 *
 * Shared by both launchers rather than written twice, because the sentence a
 * person needs is the same one whichever tab they asked for. The fallback names
 * the first failure only: twenty-nine copies of one DNS error is noise, and the
 * one that matters is that the drawings are the lab's own.
 */
export function describeSymbols(staged: StagedSymbols): string {
  if (staged.set === 'local') {
    return staged.fetched === 0
      ? `${String(SYMBOL_COUNT)} rules-text symbols already in ${DEFAULT_IMAGE_CACHE_DIR}.`
      : `Fetched ${String(staged.fetched)} rules-text symbols into ${DEFAULT_IMAGE_CACHE_DIR} ` +
          `(${String(staged.reused)} already there).`;
  }
  return (
    `Could not stage ${String(staged.failures.length)} of ${String(SYMBOL_COUNT)} rules-text symbols ` +
    `(${staged.failures[0] ?? 'no reason given'}),\n` +
    "so the lab draws its own instead. Every symbol still renders; they are this tree's\n" +
    'shapes rather than the printed ones. Rerun with a network to pick those up.'
  );
}
