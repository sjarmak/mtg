/**
 * `@mtg/image-cache` — fetch a remote image once, keep it on disk, key it by URL.
 *
 * The lab shows card art it does not own. `docs/research/prior-art-data-sources.md`
 * settles how: **on-demand fetch, local content-addressed cache, never a bulk
 * mirror.** The numbers behind that are worth having here, because the obvious
 * alternative is to pull everything once and be done. All 38,623 printings in
 * the store carry an `art_crop`, measured at about 67 KB each — roughly 2.5 GB
 * for the crops alone, another 3.3 GB for the `normal` faces, beside a 656 MB
 * store — and mirroring means 38,623 automated requests against terms that
 * prohibit "undue burden … through the use of automated means". Fetching the
 * few hundred images a lab session actually looks at is both cheaper and the
 * thing the upstream asks for.
 *
 * Keying by URL rather than by content is what makes the cache self-maintaining.
 * Scryfall's image URLs carry a `?<timestamp>` that changes when art is
 * rescanned, so a re-ingest turns a rescanned image into a miss and refetches
 * exactly what changed. A mirror would have to diff for that.
 *
 * ## Why this is its own package
 *
 * Card data otherwise lives in `@mtg/data`, and this belongs beside it. It
 * cannot go there: `@mtg/ui`'s launcher is the first consumer, and `@mtg/ui`
 * must not declare a dependency on `@mtg/data` — that puts `better-sqlite3` on
 * the browser's module graph. So this package carries no third-party dependency
 * at all, only `node:fs`, `node:crypto` and the global `fetch`, and anything may
 * take it.
 *
 * It is still Node-only. Nothing under a package's `src/` that Vite bundles may
 * import it; the consumers are launchers and pipelines under `tools/`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Relative to the repo root, beside `data/store/mtg.sqlite`. Gitignored. */
export const DEFAULT_IMAGE_CACHE_DIR = 'data/images';

/** Enough to separate the URLs in a store; not a security boundary. */
const NAME_LENGTH = 16;

/**
 * Long enough for a 400 KB PNG over a slow link, short enough that a black hole
 * does not hang a launcher. A timeout surfaces as a named failure, never as a
 * silently missing image.
 */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Identifies the lab the way `@mtg/data` identifies it to the API. Restated
 * rather than imported, because importing it is what this package exists to
 * avoid; the two are the same string and neither is a protocol constant.
 */
const USER_AGENT = 'mtg-lab/0.0 (local development)';

/** What a caller needs to find the file and to report what it cost. */
export interface CachedImage {
  /** File name inside the cache directory. Stable for a URL. */
  readonly name: string;
  /** Absolute path of the cached file. */
  readonly path: string;
  /** False when it was already there. */
  readonly fetched: boolean;
}

export interface CacheImageOptions {
  /** Absolute path of the cache directory. */
  readonly dir: string;
  /** Injectable so tests never reach the network. */
  readonly download?: (url: string) => Promise<Uint8Array>;
  readonly exists?: (path: string) => boolean;
  readonly write?: (path: string, bytes: Uint8Array) => void;
}

/**
 * A stable file name for a URL.
 *
 * Content-addressed by the *URL*, not by the bytes, so the cache can be checked
 * before anything is downloaded — the whole point of a cache. The extension is
 * carried across so a dev server serving the file infers the right content type.
 *
 * `svg` is in the list for that second reason rather than for card art: a rules
 * text symbol is an SVG, and a dev server types a response from the extension
 * it finds on disk. Saved as `.jpg` it is served as `image/jpeg` and a browser
 * refuses to paint it, which looks exactly like a file that was never fetched.
 */
export function imageFileName(url: string): string {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, NAME_LENGTH);
  return `${digest}${extensionOf(url)}`;
}

function extensionOf(url: string): string {
  const match = /\.(jpe?g|png|webp|gif|avif|svg)(?:$|\?)/i.exec(url);
  const found = match?.[1];
  return found === undefined ? '.jpg' : `.${found.toLowerCase()}`;
}

async function fetchImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`responded ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Writes the file so a cache hit can only ever mean a whole file.
 *
 * The name is what the cache is keyed on, so anything sitting at that name is
 * believed forever: an interrupted write leaves a fragment that `existsSync`
 * reports as a hit, and because the URL has not changed, nothing will ever
 * refetch it. Writing beside the target and renaming makes the file appear whole
 * or not at all, since rename within a directory is atomic. The stray temp file
 * from a killed process is inert — it is not the name anything looks up.
 */
function writeWholeFile(path: string, bytes: Uint8Array): void {
  const temp = `${path}.${String(process.pid)}.partial`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, path);
  } catch (error: unknown) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * The cached file for a URL, downloading it if this is the first time.
 *
 * Throws when the download fails. Callers decide what a missing image means to
 * them — the deck launcher keeps the remote URL and reports the card by name,
 * because a viewer who can reach the origin should still see it.
 */
export async function cacheImage(url: string, options: CacheImageOptions): Promise<CachedImage> {
  const exists = options.exists ?? existsSync;
  const write = options.write ?? writeWholeFile;
  const download = options.download ?? fetchImage;

  const name = imageFileName(url);
  const path = join(options.dir, name);
  if (exists(path)) return { name, path, fetched: false };

  const bytes = await download(url);
  /**
   * An empty body is a failure that answered 200, and the shapes that produce
   * one are ordinary: a captive portal, a filtering resolver, a proxy that
   * returns a courtesy page for a host it will not reach. Caching it would key
   * that failure to a URL that is never going to change, so every later run
   * serves nothing and never retries. The caller already handles a throw.
   */
  if (bytes.length === 0) throw new Error('responded with an empty body');

  mkdirSync(options.dir, { recursive: true });
  write(path, bytes);
  return { name, path, fetched: true };
}
