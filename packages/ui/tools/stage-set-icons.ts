/**
 * Bringing an official set's icon onto the same origin as the page.
 *
 * `stage-symbols.ts` argues this for the rules-text symbols and every word
 * applies: a set icon referenced from another host is an empty seal for a
 * viewer who cannot reach that host, and the page in front of a person may not
 * depend on one. So each icon goes through the same path — `@mtg/image-cache`
 * fetches it once into `data/images/`, keyed by URL, and the served copy is
 * written into `public/set-icons/` under its set code. Nothing is vendored;
 * `@mtg/render-spec`'s `set-icon.ts` carries the licensing argument.
 *
 * **Which sets, and why that is decided here.** Only a set that states an
 * official origin is asked for: a reduced reference build (`origin: official`
 * in the staged set library) or a printed-format catalog, whose every card is a
 * real printing by construction. A generated set is never asked for, however
 * plausible its code, because Scryfall answers a code rather than a set and a
 * generated `XMP` would be handed whatever real set spells its code that way.
 * The roster is a pure function of what the launcher staged, so the page's
 * list and the served directory cannot disagree about what is official.
 *
 * **Each set on its own, not all or none.** `stage-symbols.ts` refuses a
 * partial set because one missing symbol is one empty box in the middle of a
 * sentence beside twenty-eight real ones. A set icon is one file per set, and
 * every card of that set shows the same thing: a set whose icon did not arrive
 * draws its mark on every face, which is a complete card rather than a broken
 * one. So the codes that arrived are served and named to the page, the codes
 * that did not are reported, and neither waits on the other.
 *
 * Node-only, like everything under `tools/`.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_IMAGE_CACHE_DIR, cacheImage } from '@mtg/image-cache';
import type { CacheImageOptions, CachedImage } from '@mtg/image-cache';
import { parsePrintedPresentationCatalog } from '@mtg/printed-card';
import { setIconAssetName, setIconSourceUrl } from '../src/card/set-icon';
import type { SetOrigin } from '../src/lab/set-origin';
import type { SetCandidate } from './resolve-set';
import { identityOf } from './stage-set-bundles';

export interface StagedSetIcons {
  /** The codes now served from `public/set-icons/`, uppercase, in roster order. */
  readonly staged: readonly string[];
  /** Icons downloaded this run. */
  readonly fetched: number;
  /** Icons the shared cache already had. */
  readonly reused: number;
  /** One line per set whose icon could not be fetched, naming the code. */
  readonly failures: readonly string[];
}

export interface StageSetIconsOptions {
  /** The set codes to serve, from `setIconRoster`. */
  readonly codes: readonly string[];
  /** The shared cache, usually `data/images` at the repo root. */
  readonly cacheDir: string;
  /** Where the page serves icons from, usually `public/set-icons`. */
  readonly publicDir: string;
  /** Injectable for the tests, which must not touch the network or the disk. */
  readonly cache?: (url: string, options: CacheImageOptions) => ReturnType<typeof cacheImage>;
  readonly publish?: (from: string, to: string) => void;
}

/** What a staged set says about itself that decides whether it has an icon. */
export interface IconRosterSet {
  readonly code: string | null;
  readonly origin: SetOrigin;
}

/** A printed-format catalog: real printings, so its set has an icon. */
export interface IconRosterCatalog {
  readonly code: string;
  readonly setCodes?: readonly string[];
}

/**
 * The set codes worth asking for, uppercase and deduplicated, in the order the
 * launcher staged them: the set library's official sets first, then every
 * catalog of every printed format.
 *
 * A custom set is left out here rather than filtered after a failed fetch,
 * because a fetch that *succeeds* for a custom code is the failure this file
 * exists to prevent.
 */
export function setIconRoster(
  sets: readonly IconRosterSet[],
  catalogs: readonly IconRosterCatalog[],
): readonly string[] {
  const codes: string[] = [];
  const push = (code: string): void => {
    const upper = code.toUpperCase();
    if (!codes.includes(upper)) codes.push(upper);
  };
  for (const set of sets) {
    if (set.origin === 'official' && set.code !== null) push(set.code);
  }
  for (const catalog of catalogs) {
    push(catalog.code);
    for (const setCode of catalog.setCodes ?? []) push(setCode);
  }
  return codes;
}

export interface IconRosterPrintedFormat {
  readonly id: string;
  readonly presentationCatalog?: string;
  readonly catalogs: readonly IconRosterCatalog[];
}

export function printedCatalogIconRoster(
  formats: readonly IconRosterPrintedFormat[],
  publicDir: string,
): readonly IconRosterCatalog[] {
  return formats.flatMap((format) => {
    const setCodes =
      format.presentationCatalog === undefined ? undefined : stagedPresentationSetCodes(publicDir, format.id);
    return format.catalogs.map((catalog) => (setCodes === undefined ? catalog : { ...catalog, setCodes }));
  });
}

export function stagedPresentationSetCodes(
  publicDir: string,
  formatId: string,
): readonly string[] | undefined {
  const dir = join(publicDir, 'formats', formatId);
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  const file = entries.find((name) => name.startsWith('presentation-') && name.endsWith('.json'));
  if (file === undefined) return undefined;
  const catalog = parsePrintedPresentationCatalog(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  const codes = new Set<string>();
  for (const card of catalog.cards) codes.add(card.setCode.toUpperCase());
  return [...codes];
}

export function libraryIconRoster(
  candidates: readonly SetCandidate[],
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): readonly IconRosterSet[] {
  return candidates.flatMap((candidate) => {
    try {
      return [identityOf(read(candidate.path))];
    } catch {
      return [];
    }
  });
}

function publishFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

export function parentIconCode(code: string): string | null {
  const upper = code.toUpperCase();
  const prefix = upper.charAt(0);
  if (prefix !== 'T' && prefix !== 'Y') return null;
  const parent = upper.slice(1);
  return parent.length > 0 ? parent : null;
}

type IconFetch = { readonly image: CachedImage } | { readonly error: unknown };

async function fetchStagedIcon(
  cache: NonNullable<StageSetIconsOptions['cache']>,
  cacheDir: string,
  upper: string,
): Promise<IconFetch> {
  try {
    return { image: await cache(setIconSourceUrl(upper), { dir: cacheDir }) };
  } catch (primaryError: unknown) {
    const parent = parentIconCode(upper);
    if (parent === null) return { error: primaryError };
    try {
      return { image: await cache(setIconSourceUrl(parent), { dir: cacheDir }) };
    } catch {
      return { error: primaryError };
    }
  }
}

/**
 * Caches every icon on the roster and returns the codes the page can paint with.
 *
 * One request at a time, for the reason `stage-art.ts` gives: these files are
 * a few kilobytes, and a burst at somebody else's CDN buys nothing.
 */
export async function stageSetIcons(options: StageSetIconsOptions): Promise<StagedSetIcons> {
  const cache = options.cache ?? cacheImage;
  const publish = options.publish ?? publishFile;
  const staged: string[] = [];
  const failures: string[] = [];
  let fetched = 0;
  let reused = 0;

  for (const code of options.codes) {
    const upper = code.toUpperCase();
    const result = await fetchStagedIcon(cache, options.cacheDir, upper);
    if ('error' in result) {
      failures.push(
        `${upper}: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
      );
      continue;
    }
    publish(result.image.path, join(options.publicDir, setIconAssetName(upper)));
    staged.push(upper);
    if (result.image.fetched) fetched += 1;
    else reused += 1;
  }
  return { staged, fetched, reused, failures };
}

/** The value `MTG_SET_ICONS` carries to Vite: the served codes, comma separated. */
export function setIconsEnv(staged: StagedSetIcons): string {
  return staged.staged.join(',');
}

/**
 * What the launcher prints about the run, in `play.ts`'s voice.
 *
 * A roster with nothing on it is a lab of custom sets and says so in one line;
 * a failure names the set and what the face does instead, because the card
 * still renders and a reader should know why it reads as a code.
 */
export function describeSetIcons(staged: StagedSetIcons): string {
  const total = staged.staged.length + staged.failures.length;
  if (total === 0) return 'No official sets staged, so every seal draws its set code.';
  const served =
    staged.staged.length === 0
      ? ''
      : staged.fetched === 0
        ? `${String(staged.staged.length)} set icons (${staged.staged.join(', ')}) already in ${DEFAULT_IMAGE_CACHE_DIR}.`
        : `Fetched ${String(staged.fetched)} set icons into ${DEFAULT_IMAGE_CACHE_DIR} ` +
          `(${String(staged.reused)} already there): ${staged.staged.join(', ')}.`;
  if (staged.failures.length === 0) return served;
  const missed =
    `Could not stage ${String(staged.failures.length)} of ${String(total)} set icons ` +
    `(${staged.failures[0] ?? 'no reason given'}),\n` +
    'so those sets draw their code in the seal instead. Rerun with a network to pick them up.';
  return served === '' ? missed : `${served}\n${missed}`;
}
