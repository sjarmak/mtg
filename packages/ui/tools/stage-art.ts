/**
 * Bringing a deck's illustrations onto the same origin as the page.
 *
 * An artifact carries absolute Scryfall URLs, which is right for a portable
 * document and wrong for a page: it makes the deck view depend on Scryfall
 * being reachable *from wherever the viewer sits*, at the moment they look.
 * That is a different network from the one that built the deck — a laptop
 * behind a DNS filter renders thirteen hatched "Art pending" frames while the
 * machine serving the page can fetch every one of them.
 *
 * So staging pulls each illustration through `@mtg/image-cache` and copies it
 * into `public/art/`, then rewrites the artifact's `src` to a relative path.
 * The browser loads art from the same origin it loaded the HTML from, which
 * works behind a filter, through a tunnel, and offline after the first stage.
 *
 * The download lives in the cache at `data/images/`, shared with every other
 * consumer, and only the copy under `public/` is web-served — so a deck sharing
 * cards with a previous one costs no requests, and the dev server publishes the
 * cards on the page rather than the whole cache.
 *
 * Only the *staged copy* of the artifact is rewritten. The one on disk keeps its
 * absolute URLs, so it stays portable to a machine whose cache is empty.
 *
 * A download that fails is not fatal. That card keeps its absolute URL — a
 * viewer who can reach Scryfall still sees it, and one who cannot gets the
 * pending frame, which is exactly the state that existed before this file. The
 * launcher reports what it could not fetch rather than swallowing it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cacheImage } from '@mtg/image-cache';
import type { CacheImageOptions } from '@mtg/image-cache';
import type { DeckArt, DeckArtifact, DeckArtifactEntry } from '../src/lab/deck-artifact';

/** Directory under `public/`, and therefore also the URL prefix. */
export const ART_DIR = 'art';

/**
 * Remove a flat art directory an earlier launcher staged, and say what it held.
 *
 * `mtg-cax8`, 2026-08-23. `npm run play` stages per-set bundles and clears the
 * flat `public/art.json` beside them, because a stale manifest is another set's
 * art under this set's card ids. It never cleared the directory that manifest
 * named. Nothing reads those files once the manifest is gone, nothing overwrites
 * them because the bundles write elsewhere, and every run of the older flat
 * launcher left another copy: 11 GB of orphaned rasters on this machine, found
 * while building a static server.
 *
 * It is the same decision `clearStagedDeck` makes about `deck.json`, and it is
 * made for the same reason: `npm run lab` restages what it needs on its next
 * run, from a cache that still holds every byte, so the cost of being wrong
 * here is one re-copy and the cost of being right is gigabytes.
 *
 * Returns the count and the bytes rather than a boolean, because a launcher
 * that says it removed 1,248 files totaling 11 GB is telling the reader
 * something they want to know about their disk.
 */
export function clearStagedFlatArt(publicDir: string): { readonly files: number; readonly bytes: number } {
  const directory = join(publicDir, ART_DIR);
  if (!existsSync(directory)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += statSync(join(directory, entry.name)).size;
  }
  rmSync(directory, { recursive: true, force: true });
  return { files, bytes };
}

/** The launcher's line, or nothing when there was nothing to clear. */
export function describeClearedFlatArt(cleared: { readonly files: number; readonly bytes: number }): string {
  if (cleared.files === 0) return '';
  const mb = Math.round(cleared.bytes / 1_000_000);
  return (
    `Cleared ${String(cleared.files)} illustration(s) (${String(mb)} MB) staged by an older launcher ` +
    'into public/art; this run serves per-set bundles and nothing reads them.'
  );
}

export interface StagedArt {
  readonly deck: DeckArtifact;
  /** Illustrations downloaded this run. */
  readonly fetched: number;
  /** Illustrations the shared cache already had. */
  readonly reused: number;
  /** One line per illustration that could not be fetched, naming the card. */
  readonly failures: readonly string[];
}

export interface StageArtOptions {
  /** The shared cache, usually `data/images` at the repo root. */
  readonly cacheDir: string;
  /** Where the page serves art from, usually `public/art`. */
  readonly publicDir: string;
  /** Injectable for the tests, which must not touch the network or the disk. */
  readonly cache?: (url: string, options: CacheImageOptions) => ReturnType<typeof cacheImage>;
  readonly publish?: (from: string, to: string) => void;
}

/**
 * Every entry the page will draw a tile for, the sideboard included.
 *
 * The sideboard was missing here until 2026-09-03, and it is the one field that
 * can be absent rather than empty, so it read as three lists rather than four
 * and nothing pointed at the gap. `../src/routes/deck/OpenDeckScreen.ts` draws a
 * sideboard pane whenever the document carries the field, with tiles that carry
 * art like any other -- so a deck built with one served that pane's
 * illustrations from Scryfall while the other three panes came off this origin,
 * which is the split this file exists to close. Nothing in the committed
 * fixtures has a sideboard, which is why it went unseen.
 */
function entriesOf(deck: DeckArtifact): readonly DeckArtifactEntry[] {
  return [...deck.spells, ...deck.lands, ...deck.basics, ...(deck.sideboard ?? [])];
}

/** Every distinct illustration the deck references, with a card name for each. */
function distinctArt(deck: DeckArtifact): ReadonlyMap<string, string> {
  const bySrc = new Map<string, string>();
  for (const entry of entriesOf(deck)) {
    if (entry.art !== null && !bySrc.has(entry.art.src)) bySrc.set(entry.art.src, entry.name);
  }
  return bySrc;
}

function rewrite(entry: DeckArtifactEntry, local: ReadonlyMap<string, string>): DeckArtifactEntry {
  const { art } = entry;
  if (art === null) return entry;
  const path = local.get(art.src);
  if (path === undefined) return entry;
  const staged: DeckArt = { ...art, src: path };
  return { ...entry, art: staged };
}

/** Copies out of the cache only when the served file is not already there. */
function publishFile(from: string, to: string): void {
  if (existsSync(to)) return;
  copyFileSync(from, to);
}

/**
 * Caches every illustration the deck references and returns the deck pointing
 * at the local copies.
 *
 * Downloads run one at a time. Thirteen images is a second of wall clock, and
 * a burst of parallel requests at somebody else's image CDN to save that second
 * is not a trade worth making.
 */
export async function stageDeckArt(deck: DeckArtifact, options: StageArtOptions): Promise<StagedArt> {
  const cache = options.cache ?? cacheImage;
  const publish = options.publish ?? publishFile;

  mkdirSync(options.publicDir, { recursive: true });

  const local = new Map<string, string>();
  const failures: string[] = [];
  let fetched = 0;
  let reused = 0;

  for (const [src, cardName] of distinctArt(deck)) {
    try {
      const image = await cache(src, { dir: options.cacheDir });
      publish(image.path, join(options.publicDir, image.name));
      if (image.fetched) fetched += 1;
      else reused += 1;
      local.set(src, `${ART_DIR}/${image.name}`);
    } catch (cause: unknown) {
      failures.push(`${cardName}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  return {
    deck: {
      ...deck,
      spells: deck.spells.map((entry) => rewrite(entry, local)),
      lands: deck.lands.map((entry) => rewrite(entry, local)),
      basics: deck.basics.map((entry) => rewrite(entry, local)),
      // Spread rather than assigned, because absent and empty are different
      // claims about a sideboard and `../src/lab/deck-artifact.ts` draws them
      // differently. Writing `sideboard: undefined` would turn a deck that was
      // never asked about one into a deck that set nothing aside.
      ...(deck.sideboard === undefined
        ? {}
        : { sideboard: deck.sideboard.map((entry) => rewrite(entry, local)) }),
    },
    fetched,
    reused,
    failures,
  };
}
