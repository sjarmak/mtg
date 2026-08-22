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
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cacheImage } from '@mtg/image-cache';
import type { CacheImageOptions } from '@mtg/image-cache';
import type { DeckArt, DeckArtifact, DeckArtifactEntry } from '../src/lab/deck-artifact';

/** Directory under `public/`, and therefore also the URL prefix. */
export const ART_DIR = 'art';

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

function entriesOf(deck: DeckArtifact): readonly DeckArtifactEntry[] {
  return [...deck.spells, ...deck.lands, ...deck.basics];
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
    },
    fetched,
    reused,
    failures,
  };
}
