/**
 * Bringing a generated set's own art onto the page.
 *
 * the art pipeline writes rasters and an `art.json` into a directory under `out/`,
 * which Vite does not serve and must not: the dev server publishes `public/`,
 * and pointing it at `out/` would expose a build directory to save a copy. So
 * staging copies the rasters the set actually references into `public/art/` —
 * the same directory the deck lab caches Scryfall art into, since both are just
 * "images this page serves" — and rewrites the manifest's `href` to match.
 *
 * The copy is unconditional, unlike the deck lab's. A cached Scryfall URL is
 * immutable, so an existing file is the right file; a generated raster is the
 * output of a fix loop, so an existing file is usually the *stale* one and
 * skipping the copy would show yesterday's art after a regeneration.
 *
 * A manifest entry whose raster is not on disk is dropped rather than staged.
 * The card then renders the labeled pending frame, which is the true statement
 * about it, and the launcher names it. Entries that already point at a URL or a
 * `data:` URI are left exactly as they are — they are loadable as written.
 *
 * A card carries several illustrations, and they are staged one at a time: a
 * missing raster costs that card one picture rather than all of them, and a card
 * whose whole list is missing is the one that goes back to the pending frame.
 * Names collide across art runs — every run writes `xmp-swamp.png` — so the
 * served copy takes the name it has *in its own manifest directory*, which
 * `adopt-variants` already made unique by suffixing the run it came from.
 */
import {
  copyFileSync,
  closeSync,
  openSync,
  readSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { cacheImage } from '@mtg/image-cache';
import type { CacheImageOptions } from '@mtg/image-cache';
import { readMigratedArtManifest } from '../src/lab/art-manifest';
import type { ArtManifest, ArtManifestEntry, ArtManifestResult } from '../src/lab/art-manifest';
import { ART_DIR } from './stage-art';

/** What the art pipeline names its manifest, and what the page fetches it as. */
export const ART_MANIFEST_FILENAME = 'art.json';

export interface CacheSetArtOptions {
  /** The shared cache, usually `data/images` at the repo root. */
  readonly cacheDir: string;
  /** Where the page serves art from, usually `public/sets/<stem>/art`. */
  readonly publicDir: string;
  /**
   * The URL prefix `publicDir` is served under, relative to the page.
   *
   * Stated rather than assumed to be `art/`, because two sets are staged at
   * once now and each keeps its rasters inside its own bundle. See
   * `stageSetArt` below for why that is the key and not a shared pool.
   */
  readonly servedPrefix?: string;
  /** Injectable for the tests, which must not touch the network or the disk. */
  readonly cache?: (url: string, options: CacheImageOptions) => ReturnType<typeof cacheImage>;
  readonly publish?: (from: string, to: string) => void;
}

export interface CachedSetArt {
  readonly manifest: ArtManifest;
  /** Illustrations downloaded this run. */
  readonly fetched: number;
  /** Illustrations the shared cache already had. */
  readonly reused: number;
  /** One line per illustration that could not be fetched, naming a card. */
  readonly failures: readonly string[];
}

export interface ArtCandidate {
  readonly path: string;
  /** Human phrase for where this came from, used in the success line. */
  readonly what: string;
}

export interface StagedSetArt {
  /** The manifest with every staged `href` rewritten to a served path. */
  readonly manifest: ArtManifest;
  /** Rasters copied into the served directory. */
  readonly copied: number;
  /** Entries left pointing at a URL or a `data:` URI. */
  readonly remote: number;
  /**
   * One line per illustration the manifest names and the disk does not have,
   * naming the card and which of its illustrations went missing. Per raster
   * rather than per card, because a card that lost one of three still draws.
   */
  readonly missing: readonly string[];
  /** Cards that lost every illustration and go back to the pending frame. */
  readonly pending: readonly string[];
}

export interface StageSetArtOptions {
  /** Directory the manifest was read from; relative `href`s resolve against it. */
  readonly manifestDir: string;
  /** Where the page serves art from, usually `public/sets/<stem>/art`. */
  readonly publicDir: string;
  /** The URL prefix `publicDir` is served under; defaults to the deck lab's flat `art/`. */
  readonly servedPrefix?: string;
  /** Injectable for the tests, which must not touch the disk. */
  readonly exists?: (path: string) => boolean;
  readonly copy?: (from: string, to: string) => void;
}

/** The first candidate that exists, or `null` — a set with no art is normal. */
export function findArtManifest(
  candidates: readonly ArtCandidate[],
  exists: (path: string) => boolean = existsSync,
): ArtCandidate | null {
  return candidates.find((candidate) => exists(candidate.path)) ?? null;
}

/**
 * Reads a manifest off disk and checks it really is one.
 *
 * Validated here rather than in the browser because this is where a person can
 * act on the answer. The page's reader stays as the seam check; by the time it
 * runs, the file has already been through this one.
 *
 * A format-1 manifest is accepted here and staged as format 2, which is why this
 * is the boundary that migrates: the page keeps seeing one encoding, and the
 * three format-1 runs on disk stop being unreadable. The conversion is declared
 * in `../src/lab/art-manifest` rather than imported from the art pipeline, whose copy
 * is the same one pass, because that arrow would close a cycle — the art pipeline
 * depends on `@mtg/card-render`, which depends on this package.
 */
export function readArtDocument(path: string): ArtManifestResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause: unknown) {
    return { ok: false, message: `could not read ${path} (${describe(cause)})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause: unknown) {
    return { ok: false, message: `${path} is not valid JSON (${describe(cause)})` };
  }
  return readMigratedArtManifest(parsed, path);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** True for an `href` the browser can already load without a local copy. */
function isRemote(href: string): boolean {
  return /^(?:https?:|data:)/i.test(href);
}

/**
 * The default copy, which also creates the served directory.
 *
 * Creating it here rather than once up front is what lets the tests inject a
 * copy and never touch the disk at all; it also means a manifest with nothing
 * local in it leaves no empty directory behind.
 */
function copyInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function localSource(href: string, manifestDir: string): string {
  return isAbsolute(href) ? resolve(href) : resolve(manifestDir, href);
}

/** Refuses two different inputs that the flat served directory cannot distinguish. */
function requireUniqueDestinations(manifest: ArtManifest, options: StageSetArtOptions): void {
  const sources = new Map<string, string>();
  const prefix = options.servedPrefix ?? ART_DIR;
  for (const variants of Object.values(manifest.art)) {
    for (const entry of variants) {
      if (isRemote(entry.href)) continue;
      const source = localSource(entry.href, options.manifestDir);
      const served = `${prefix}/${basename(source)}`;
      const previous = sources.get(served);
      if (previous !== undefined && previous !== source) {
        throw new Error(`${previous} and ${source} both stage as ${served}`);
      }
      sources.set(served, source);
    }
  }
}

/**
 * Copies the referenced rasters into the served directory and rewrites the hrefs.
 *
 * # Rasters are keyed by the set they belong to
 *
 * `servedPrefix` and `publicDir` move together, and the launcher points both at
 * the bundle it is staging: `public/sets/<stem>/art/`. That is the answer to the
 * question two staged sets raise — a served file is named by its basename in its
 * own manifest directory, and *every* generative run in this repository writes
 * `xmp-swamp.png`, so two sets staged into one shared directory means the second
 * copy silently wins and the first set draws the second set's picture. Both
 * manifests still resolve, so nothing announces it.
 *
 * Content-addressing the shared directory would remove the collision and keep
 * the confusion: a raster's identity here is "the picture this run made for this
 * card", which a hash names neither half of, and it would make a bundle
 * undeletable — no directory could be removed without first proving no other
 * set's manifest points into the pool. Keying by set makes each bundle whole and
 * disposable, which is what a picker needs to be able to restage one set without
 * touching another.
 *
 * The cost is duplication when two sets share an illustration, and it is
 * bounded: `cacheRemoteSetArt` still downloads through the one shared
 * `data/images/`, so a shared Scryfall image costs one request and two copies of
 * about 67 KB under a gitignored directory.
 */
export function stageSetArt(manifest: ArtManifest, options: StageSetArtOptions): StagedSetArt {
  const exists = options.exists ?? existsSync;
  const copy = options.copy ?? copyInto;
  const prefix = options.servedPrefix ?? ART_DIR;
  requireUniqueDestinations(manifest, options);

  const art: Record<string, ArtManifestEntry[]> = {};
  const missing: string[] = [];
  const pending: string[] = [];
  let copied = 0;
  let remote = 0;

  for (const [cardId, variants] of Object.entries(manifest.art)) {
    const staged: ArtManifestEntry[] = [];
    for (const [index, entry] of variants.entries()) {
      if (isRemote(entry.href)) {
        staged.push(entry);
        remote += 1;
        continue;
      }
      const source = localSource(entry.href, options.manifestDir);
      if (!exists(source)) {
        missing.push(describeVariant(cardId, index, variants.length, entry.href));
        continue;
      }
      const name = basename(source);
      copy(source, join(options.publicDir, name));
      staged.push({ ...entry, href: `${prefix}/${name}` });
      copied += 1;
    }
    // A card with nothing left is left out of the manifest entirely rather than
    // written as an empty list. The schema refuses the empty list on purpose:
    // absent already means "renders the pending frame", and two spellings of one
    // state is the ambiguity the format was widened to avoid.
    if (staged.length === 0) pending.push(cardId);
    else art[cardId] = staged;
  }

  return { manifest: { ...manifest, art }, copied, remote, missing, pending };
}

/** `xmp-swamp (illustration 2 of 3, ./xmp-swamp-v2.png)`, for a launcher line. */
function describeVariant(cardId: string, index: number, total: number, href: string): string {
  const which = total === 1 ? '' : `illustration ${String(index + 1)} of ${String(total)}, `;
  return `${cardId} (${which}${href})`;
}

/**
 * The subdirectories of `out/art`, which is where a per-set art run lands.
 *
 * Injectable so the tests never read a disk, and tolerant of the directory not
 * existing at all — a checkout that has never generated art is the ordinary
 * case, not a failure.
 */
export type ListArtDirs = () => readonly string[];

function artDirsUnder(repoRoot: string): readonly string[] {
  try {
    return readdirSync(join(repoRoot, 'out', 'art'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Where to look for a set's art.
 *
 * Beside the set first, then every per-set directory under `out/art`, then
 * `out/art/art.json` last. That ordering is only a tie-break: `chooseArtManifest`
 * decides on coverage, and the flat default goes last because it is whatever the
 * most recent run happened to leave behind rather than a statement about any
 * particular set.
 */
export function artCandidatesFor(
  setPath: string,
  repoRoot: string,
  listDirs: ListArtDirs = () => artDirsUnder(repoRoot),
): readonly ArtCandidate[] {
  return [
    {
      path: join(dirname(setPath), ART_MANIFEST_FILENAME),
      what: 'the manifest beside the set',
    },
    ...listDirs().map((name) => ({
      path: join(repoRoot, 'out', 'art', name, ART_MANIFEST_FILENAME),
      what: `the art run in ${join('out', 'art', name)}`,
    })),
    {
      path: join(repoRoot, 'out', 'art', ART_MANIFEST_FILENAME),
      what: 'the most recent `npm run art -- generate` run',
    },
  ];
}

export interface ChosenArt {
  readonly candidate: ArtCandidate;
  readonly manifest: ArtManifest;
  /** How many of the set's own card ids this manifest has art for. */
  readonly covered: number;
  /**
   * How many illustrations those covered ids carry between them.
   *
   * A manifest lists a *list* of illustrations per card, so two manifests can
   * cover the same cards and still not say the same thing: a collation of
   * several runs gives the basics three or four pictures each, and the single
   * run it collated gives them one. Coverage cannot tell them apart.
   */
  readonly illustrations: number;
}

export interface ChooseArtOptions {
  readonly read?: (path: string) => ArtManifestResult;
  readonly exists?: (path: string) => boolean;
  /** Reads a run's ledger, or returns null when there is none to read. */
  readonly readLedger?: (path: string) => unknown;
}

export interface ExplicitArtOptions extends ChooseArtOptions {
  /** Directory relative manifest arguments resolve from. */
  readonly cwd?: string;
}

/** True for lexical, symbolic, or hard-link aliases when both paths exist. */
function samePath(left: string, right: string, exists: (path: string) => boolean): boolean {
  if (resolve(left) === resolve(right)) return true;
  if (!exists(left) || !exists(right)) return false;
  if (realpathSync(left) === realpathSync(right)) return true;
  const leftStat = statSync(left);
  const rightStat = statSync(right);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function inside(root: string, path: string): boolean {
  const offset = relative(root, path);
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function rasterHeader(path: string): Uint8Array {
  const descriptor = openSync(path, 'r');
  try {
    const header = Buffer.alloc(12);
    const length = readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

function isSupportedRaster(path: string): boolean {
  const header = rasterHeader(path);
  const png =
    header.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => header[index] === byte);
  const jpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp =
    header.length >= 12 &&
    Buffer.from(header.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(header.subarray(8, 12)).toString('ascii') === 'WEBP';
  return png || jpeg || webp;
}

function validateLocalRasters(manifest: ArtManifest, manifestPath: string): void {
  const root = dirname(manifestPath);
  for (const [surfaceId, variants] of Object.entries(manifest.art)) {
    for (const entry of variants) {
      if (isRemote(entry.href)) continue;
      if (isAbsolute(entry.href)) {
        throw new Error(`${manifestPath}: local raster for ${surfaceId} must be relative to the manifest`);
      }
      const source = resolve(root, entry.href);
      if (!inside(resolve(root), source)) {
        throw new Error(
          `${manifestPath}: local raster for ${surfaceId} must stay inside the manifest directory`,
        );
      }
      let status;
      try {
        status = statSync(source);
      } catch (cause: unknown) {
        throw new Error(`${manifestPath}: could not read local raster ${entry.href} (${describe(cause)})`);
      }
      if (!status.isFile())
        throw new Error(`${manifestPath}: local raster ${entry.href} is not a regular file`);
      const realRoot = realpathSync(root);
      const realSource = realpathSync(source);
      if (!inside(realRoot, realSource)) {
        throw new Error(
          `${manifestPath}: local raster for ${surfaceId} must stay inside the manifest directory`,
        );
      }
      if (!isSupportedRaster(source)) {
        throw new Error(`${manifestPath}: local raster ${entry.href} is not a PNG, JPEG, or WebP image`);
      }
    }
  }
}

/**
 * Reads exactly the manifest the operator named and proves it covers this set.
 *
 * Unlike default discovery, an explicit path is a promise, so unreadable,
 * malformed, incomplete, and output-aliasing inputs fail instead of quietly
 * falling back to pending frames or another manifest.
 */
export function resolveExplicitArtManifest(
  manifestPath: string,
  setCardIds: readonly string[],
  stagedManifestPath: string,
  options: ExplicitArtOptions = {},
): ChosenArt {
  const read = options.read ?? readArtDocument;
  const exists = options.exists ?? existsSync;
  const path = resolve(options.cwd ?? process.cwd(), manifestPath);
  if (samePath(path, stagedManifestPath, exists)) {
    throw new Error(`${path} must not alias the staged art manifest ${stagedManifestPath}`);
  }
  const result = read(path);
  if (!result.ok) throw new Error(result.message);
  const wanted = new Set(setCardIds);
  const actual = Object.keys(result.manifest.art);
  const covered = actual.filter((id) => wanted.has(id)).length;
  if (covered !== wanted.size) {
    throw new Error(
      `${path} covers ${String(covered)} of ${String(wanted.size)} renderable surfaces in the selected set; ` +
        'refusing an incomplete or mismatched explicit manifest',
    );
  }
  const foreign = actual.filter((id) => !wanted.has(id));
  if (foreign.length > 0) {
    throw new Error(
      `${path} has ${String(foreign.length)} foreign surface${foreign.length === 1 ? '' : 's'}: ${foreign.join(', ')}`,
    );
  }
  validateLocalRasters(result.manifest, path);
  return {
    candidate: { path, what: `the explicitly named manifest at ${path}` },
    manifest: result.manifest,
    covered,
    illustrations: countIllustrations(result.manifest, wanted),
  };
}

/**
 * The illustrations a manifest offers for the ids asked about.
 *
 * Read as a total rather than a per-card figure: it is only ever compared
 * between two manifests that cover the same cards, where the larger total is
 * the one with more pictures to rotate through and none fewer anywhere.
 */
function countIllustrations(manifest: ArtManifest, wanted: ReadonlySet<string>): number {
  let total = 0;
  for (const [id, entries] of Object.entries(manifest.art)) {
    if (wanted.has(id)) total += entries.length;
  }
  return total;
}

/** Refuses an explicit promise when staging dropped any required raster. */
export function requireCompleteStagedArt(
  staged: StagedSetArt,
  surfaceIds: readonly string[],
  manifestPath: string,
): void {
  const wanted = new Set(surfaceIds);
  const surviving = Object.keys(staged.manifest.art).filter((id) => wanted.has(id)).length;
  if (surviving !== wanted.size) {
    throw new Error(
      `${manifestPath}: ${String(surviving)} of ${String(wanted.size)} required surfaces survived staging; ` +
        'refusing a preview with pending art',
    );
  }
}

/** What `adopt-variants` names the ledger it writes beside a collated manifest. */
export const ART_RUN_LEDGER_FILENAME = 'art-run.json';

/** The directory a run's manifest sits in, which is the name a ledger calls it by. */
function runNameOf(manifestPath: string): string {
  return basename(dirname(manifestPath));
}

/** Reads a manifest's sibling ledger, or null when there is none. */
function readRunLedger(manifestPath: string): unknown {
  const path = join(dirname(manifestPath), ART_RUN_LEDGER_FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * The runs a collation on disk says it replaced.
 *
 * Coverage and illustration count cannot separate a collation from the run it
 * superseded when the supersession was one picture for one picture: both cover
 * the same cards with the same total, so the tie fell to whichever directory
 * sorted first, which is the older one. `xmp-canon-v11` replaced two
 * planeswalker illustrations in `xmp-canon-v10` and lost the tie to it, so the
 * launcher went on staging the pictures that had already been paid to replace.
 *
 * The answer is already written down. `adopt-variants` records every
 * `--supersedes <newer>:<older>` edge in the `art-run.json` beside the manifest
 * it wrote, naming the runs by directory. So a run another candidate declares
 * `older` is not a candidate: it is the picture that was replaced. Read from
 * the ledger rather than inferred from mtimes or from the directory names,
 * because a supersession is a fact about why a run was made and only the
 * invocation that made it knows.
 *
 * Only ledgers belonging to manifests that survived the coverage filter are
 * read. A collation whose own manifest is unreadable or covers none of this set
 * cannot retire anything, or a broken file would take the working run down with
 * it.
 */
export function supersededRuns(
  candidates: readonly ArtCandidate[],
  readLedger: (path: string) => unknown,
): ReadonlySet<string> {
  const replaced = new Set<string>();
  for (const candidate of candidates) {
    const ledger = readLedger(candidate.path);
    if (typeof ledger !== 'object' || ledger === null) continue;
    const edges = (ledger as { supersedes?: unknown }).supersedes;
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) {
      if (typeof edge !== 'object' || edge === null) continue;
      const older = (edge as { older?: unknown }).older;
      if (typeof older === 'string' && older !== '') replaced.add(older);
    }
  }
  return replaced;
}

/**
 * The manifest that actually has art for the set being played.
 *
 * Existence was the wrong question. `out/art/art.json` is whatever the last art
 * run left there, so playing a set whose art lives in a directory of its own
 * found the previous set's manifest, matched none of its card ids, and drew a
 * full board of pending frames while the right rasters sat one directory away.
 * The docblock at the top of this file already named that failure and guarded
 * only the half where a stale file lingers in `public/`.
 *
 * So this asks what was always meant: of the manifests on disk, which one has
 * art for *these* cards. Zero overlap is not a candidate at all — it is another
 * set's art, and the pending frame is the true statement about this one.
 */
export function chooseArtManifest(
  candidates: readonly ArtCandidate[],
  setCardIds: readonly string[],
  options: ChooseArtOptions = {},
): ChosenArt | null {
  const read = options.read ?? readArtDocument;
  const exists = options.exists ?? existsSync;
  const readLedger = options.readLedger ?? readRunLedger;
  const wanted = new Set(setCardIds);

  const viable: { candidate: ArtCandidate; manifest: ArtManifest; covered: number }[] = [];
  for (const candidate of candidates) {
    if (!exists(candidate.path)) continue;
    const result = read(candidate.path);
    if (!result.ok) continue;
    const covered = Object.keys(result.manifest.art).filter((id) => wanted.has(id)).length;
    if (covered === 0) continue;
    viable.push({ candidate, manifest: result.manifest, covered });
  }
  const replaced = supersededRuns(
    viable.map((entry) => entry.candidate),
    readLedger,
  );

  let best: ChosenArt | null = null;
  for (const { candidate, manifest, covered } of viable) {
    if (replaced.has(runNameOf(candidate.path))) continue;
    const illustrations = countIllustrations(manifest, wanted);
    // Coverage first, then how many illustrations that coverage is made of. The
    // second question is what a collation of several runs answers differently
    // from any one of the runs it collated: same cards, more pictures per card.
    // Without it a canonical manifest could not win against the older run it was
    // built from, because both cover the whole set, and the tie fell to whichever
    // directory the candidate order happened to name first — so the set kept
    // being played with the pictures that had already been replaced.
    // Strictly greater on both, so the candidate order still breaks a true tie:
    // the manifest beside the set wins over one that says exactly as much.
    if (
      best === null ||
      covered > best.covered ||
      (covered === best.covered && illustrations > best.illustrations)
    ) {
      best = { candidate, manifest, covered, illustrations };
    }
  }
  return best;
}

/**
 * Pulls the illustrations that are still remote onto the page's own origin.
 *
 * `stageSetArt` copies rasters that are already on this disk and leaves an
 * `https:` href alone, which is right for a generative run — its manifest names
 * files, not URLs. A reference set's manifest names URLs, because the pictures
 * belong to Scryfall and the emitter that writes that manifest records where
 * they are rather than mirroring them. Left alone, those hrefs make the page
 * depend on Scryfall being reachable *from wherever the viewer sits*, which is a
 * different network from the one that staged the set: a laptop behind a DNS
 * filter draws 162 hatched pending frames while the machine serving the page can
 * fetch every one of them.
 *
 * This is `stage-art.ts`'s argument for decks, applied to sets, and it uses the
 * same cache: one shared `data/images/`, keyed by URL, so a second set sharing
 * a card with the first costs no request. Only the *staged* manifest is
 * rewritten; the one beside the set keeps its absolute URLs and stays portable
 * to a machine whose cache is empty.
 *
 * A download that fails is not fatal. That entry keeps its URL, so a viewer who
 * can reach Scryfall still sees it and one who cannot gets the pending frame,
 * which is the state that existed before this ran. The launcher reports the
 * failures rather than swallowing them.
 *
 * Serial, for the reason the deck path is serial: a burst of parallel requests
 * at somebody else's image CDN to save a few seconds is not a trade this
 * repository makes, and `docs/research/prior-art-data-sources.md` is the policy.
 */
export async function cacheRemoteSetArt(
  manifest: ArtManifest,
  options: CacheSetArtOptions,
): Promise<CachedSetArt> {
  const cache = options.cache ?? cacheImage;
  const publish = options.publish ?? publishInto;
  const prefix = options.servedPrefix ?? ART_DIR;
  mkdirSync(options.publicDir, { recursive: true });

  const local = new Map<string, string>();
  const failures: string[] = [];
  let fetched = 0;
  let reused = 0;

  for (const [href, cardId] of distinctRemote(manifest)) {
    try {
      const image = await cache(href, { dir: options.cacheDir });
      publish(image.path, join(options.publicDir, image.name));
      if (image.fetched) fetched += 1;
      else reused += 1;
      local.set(href, `${prefix}/${image.name}`);
    } catch (cause: unknown) {
      failures.push(`${cardId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  const art: Record<string, ArtManifestEntry[]> = {};
  for (const [cardId, variants] of Object.entries(manifest.art)) {
    art[cardId] = variants.map((entry) => {
      const path = local.get(entry.href);
      return path === undefined ? entry : { ...entry, href: path };
    });
  }
  return { manifest: { ...manifest, art }, fetched, reused, failures };
}

/**
 * Every distinct href that lives on another host, with one card id apiece for
 * the failure line.
 *
 * `isRemote` also answers true for a `data:` URI, and this deliberately does
 * not: a `data:` entry is already carried by the manifest itself, so there is
 * no other host to lose and nothing a fetch would add.
 */
function distinctRemote(manifest: ArtManifest): ReadonlyMap<string, string> {
  const byHref = new Map<string, string>();
  for (const [cardId, variants] of Object.entries(manifest.art)) {
    for (const entry of variants) {
      if (/^https?:/i.test(entry.href) && !byHref.has(entry.href)) byHref.set(entry.href, cardId);
    }
  }
  return byHref;
}

/** Copies out of the shared cache only when the served file is not already there. */
function publishInto(from: string, to: string): void {
  if (existsSync(to)) return;
  copyFileSync(from, to);
}
