/**
 * Staging every set the launcher found, each as a bundle the page can switch to.
 *
 * `npm run play` used to resolve one set and discard the rest: one set per
 * server restart, and comparing the flagship against a reduced reference build
 * was three restarts. Its candidate search already enumerated everything on
 * disk, so the discard was the only part that had to go — the filter that used
 * to pick the winner is now the *default selection* and the ordering, which is
 * what it always was.
 *
 * # What a bundle is, and why the unit is not a file
 *
 * `public/sets/<stem>/` holds one set's `set.json`, its `art.json`, that
 * manifest's rasters under `art/`, and the preconstructed decks cut from it.
 * Its collation rides inside the set document, so the Draft tab follows for
 * free. Everything a set needs is inside one directory, which is what makes a
 * bundle disposable: restaging one set cannot disturb another, and a stale
 * bundle is removed by removing a directory rather than by reasoning about
 * which of a shared pool's files nobody points at any more.
 *
 * That property is the answer to the question two staged sets raise. Rasters
 * are keyed by the set that owns them, not pooled and not content-addressed;
 * `stage-set-art.ts`'s `stageSetArt` argues it at length, and
 * `test/play/set-bundles.test.ts` holds it — every generative run in this
 * repository writes `xmp-swamp.png`, so a shared directory means the second set
 * staged silently overwrites the first set's picture while both manifests go on
 * resolving.
 *
 * # The launcher's other staged documents are deliberately not in here
 *
 * The calibration artifact checks the fingerprint of the set it is drawn
 * against, so it rejects another set's by itself and needs nothing from this
 * file. The statistics log and the recorded event log carry no such check: the
 * log is chosen by set code and the recorded game is played from whichever
 * decks the default set had. Neither is bundled, and `LabApp` withholds both
 * while a set other than the default is selected, which is the honest state —
 * nothing has been measured or recorded about the set on screen.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_IMAGE_CACHE_DIR } from '@mtg/image-cache';
import { STAGED_SETS_DIR, SET_INDEX_VERSION } from '../src/lab/set-index';
import type { SetIndex, StagedSetRow } from '../src/lab/set-index';
import { applyArtPreferences, describePreferenceOrdering } from './art-preference-order';
import type { PreferenceOrdering } from './art-preference-order';
import { readSetDocument } from './resolve-set';
import type { ResolvedSet, SetCandidate } from './resolve-set';
import {
  ART_MANIFEST_FILENAME,
  artCandidatesFor,
  chooseArtManifest,
  requireCompleteStagedArt,
  resolveExplicitArtManifest,
  cacheRemoteSetArt,
  stageSetArt,
} from './stage-set-art';
import type { CachedSetArt, StagedSetArt } from './stage-set-art';
import { printedCardIdsOf, surfaceIdsOf } from './set-surfaces';
import { choosePreconFile, PRECON_FILENAME, preconCandidatesFor } from './stage-precons';

/** Where a bundle's rasters live inside it, and therefore the tail of their URL. */
const BUNDLE_ART_DIR = 'art';

/** What the launcher achieved for one set's art, or why it staged none. */
export type ArtOutcome =
  | {
      readonly status: 'staged';
      readonly staged: StagedSetArt;
      readonly cached: CachedSetArt;
      readonly what: string;
      /** How many of the staged set's own card ids this manifest has art for. */
      readonly covered: number;
      /** How many card ids the staged set actually has. */
      readonly total: number;
      /** What the set's curated picks did to the manifest before it was staged. */
      readonly preferences: PreferenceOrdering;
    }
  | { readonly status: 'none'; readonly note: string };

/** Where one set's art is written, and the URL the page will read it back under. */
export interface ArtTarget {
  /** Absolute path of the `art.json` to write. */
  readonly manifestPath: string;
  /** Absolute path of the directory the rasters are copied into. */
  readonly publicDir: string;
  /** URL prefix `publicDir` is served under, relative to the page. */
  readonly servedPrefix: string;
  readonly repoRoot: string;
}

/**
 * Stages the set's own art, when it has been through the art pipeline.
 *
 * A set with no manifest is the normal state of a checkout that has not paid
 * for an art run, so this reports rather than fails. The stale manifest from a
 * *previous* set is the case worth being careful about: leaving it in place
 * would have the page look up this set's card ids in another set's art, so the
 * file is removed when this set has none.
 *
 * The card ids are what makes a manifest the right one or somebody else's. They
 * are read off the raw JSON rather than through `parseCard`, because the only
 * question here is which ids the manifest should be asked to cover, and a set
 * that fails the DSL has already been refused by `resolveSet` before this runs.
 */
export async function stageArt(
  set: ResolvedSet,
  explicitManifest: string | undefined,
  target: ArtTarget,
): Promise<ArtOutcome> {
  // Chosen by what it has art for, not by which file exists first. `out/art/art.json`
  // is whatever the last run left there, so a set whose art sits in a directory of
  // its own used to find the previous set's manifest and draw a board of pending
  // frames with the right rasters one directory away.
  const ids = explicitManifest === undefined ? printedCardIdsOf(set) : surfaceIdsOf(set);
  const chosen =
    explicitManifest === undefined
      ? chooseArtManifest(artCandidatesFor(set.path, target.repoRoot), ids)
      : resolveExplicitArtManifest(explicitManifest, ids, target.manifestPath);
  if (chosen === null) {
    rmSync(target.manifestPath, { force: true });
    return {
      status: 'none',
      note: `No art manifest covers this set, so cards show the pending frame. Generate one into ${join('out', 'art')}.`,
    };
  }
  // Before staging, not after: the renderer paints position zero for every card
  // that is not a basic land, so position zero has to be the picture somebody
  // chose rather than the one the collation happened to adopt first.
  const manifestDir = dirname(chosen.candidate.path);
  const preferences = applyArtPreferences(chosen.manifest, manifestDir, set.path, target.repoRoot);
  const staged = stageSetArt(preferences.manifest, {
    manifestDir,
    publicDir: target.publicDir,
    servedPrefix: target.servedPrefix,
  });
  if (explicitManifest !== undefined) requireCompleteStagedArt(staged, ids, chosen.candidate.path);
  // A reference set's manifest names Scryfall URLs rather than files on this
  // disk, so `stageSetArt` has nothing to copy and every card would load from
  // another host at view time. Pull them onto our own origin, for the reason
  // `stage-art.ts` gives for decks. A generative run's manifest has no remote
  // hrefs, so this is a no-op there and costs one map walk.
  const cached = await cacheRemoteSetArt(staged.manifest, {
    cacheDir: DEFAULT_IMAGE_CACHE_DIR,
    publicDir: target.publicDir,
    servedPrefix: target.servedPrefix,
  });
  mkdirSync(dirname(target.manifestPath), { recursive: true });
  writeFileSync(target.manifestPath, `${JSON.stringify(cached.manifest, null, 2)}\n`);
  const wanted = new Set(ids);
  const covered = Object.keys(cached.manifest.art).filter((id) => wanted.has(id)).length;
  return {
    status: 'staged',
    staged,
    cached,
    what: chosen.candidate.what,
    covered,
    total: ids.length,
    preferences,
  };
}

export function describeArt(outcome: ArtOutcome): string {
  if (outcome.status === 'none') return outcome.note;
  const { staged, cached, what, covered, total } = outcome;
  const picks = `\n${describePreferenceOrdering(outcome.preferences)}`;
  const head =
    `Staged ${String(staged.copied + cached.fetched + cached.reused)} illustrations ` +
    `for ${String(covered)} of ${String(total)} cards from ${what}${extras(staged.manifest)}.`;
  // Counted separately from the rasters already on this disk, because the two
  // numbers answer different questions: one says how much of the set the
  // manifest covers, the other says how much of it this run had to go and get.
  const pulled =
    cached.fetched + cached.reused === 0
      ? ''
      : ` ${String(cached.fetched)} pulled from their own host and ${String(cached.reused)} ` +
        `already in the shared cache, all now served from this page.`;
  const pendingCount = total - covered;
  const gone = pendingCount === 0 ? '' : ` ${String(pendingCount)} of them show the pending frame.`;
  const stillRemote =
    cached.failures.length === 0
      ? ''
      : `\n${String(cached.failures.length)} illustrations could not be pulled and still ` +
        `load from their own URL:\n` +
        cached.failures.map((line) => `  - ${line}`).join('\n');
  if (staged.missing.length === 0) return `${head}${pulled}${gone}${picks}${stillRemote}`;
  return (
    `${head}${pulled}${gone}${picks}${stillRemote}\n` +
    `${String(staged.missing.length)} rasters the manifest names are not on disk:\n` +
    staged.missing.map((line) => `  - ${line}`).join('\n')
  );
}

/**
 * How many cards came with more than one picture, said out loud.
 *
 * Worth a clause of its own because it is the difference a player sees and the
 * one they cannot check any other way: a board of five Swamps drawing five
 * different illustrations looks like a set, and a launcher that reported only a
 * total would have looked identical the day the second Swamp went missing.
 */
function extras(manifest: StagedSetArt['manifest']): string {
  const several = Object.values(manifest.art).filter((variants) => variants.length > 1).length;
  return several === 0 ? '' : `, ${String(several)} of them with several illustrations`;
}

/** The set document's own identity block, as much of it as the document states. */
function identityOf(json: string): {
  readonly code: string | null;
  readonly name: string | null;
  readonly reduced: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { code: null, name: null, reduced: false };
  }
  if (typeof parsed !== 'object' || parsed === null || !('set' in parsed)) {
    return { code: null, name: null, reduced: false };
  }
  const { set } = parsed as { set: unknown };
  if (typeof set !== 'object' || set === null) return { code: null, name: null, reduced: false };
  const value = set as { readonly code?: unknown; readonly name?: unknown; readonly reduced?: unknown };
  return {
    code: typeof value.code === 'string' && value.code.length > 0 ? value.code : null,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name : null,
    reduced: value.reduced === true,
  };
}

/** Lowercase, and nothing a directory name or a URL segment has to escape. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The directory name one set is staged under, unique among the ones already taken.
 *
 * The set code leads, because it is the only name a set states about itself that
 * is short enough to be a path. It is not sufficient: `out/XMP/set.json` and the
 * committed fixture are both builds of XMP, and a stem that collided would hide
 * one of them behind the other — which is the state this whole lane exists to
 * end. So a taken stem is suffixed rather than reused, and the row carries the
 * launcher's own phrase for where the build came from so the picker can say
 * which is which.
 *
 * A document with no code falls back to its filename and then to its parent
 * directory, and the filename `set.json` is skipped on the way past. It is the
 * name every emitter in this repository writes — `out/reference/m11/set.json`
 * and `out/reference/m13/set.json` are the same filename in different
 * directories — so honoring it would stem two different sets to `set` and
 * `set-2` and leave the picker offering two rows nobody can tell apart. The
 * directory is what carries the identity at that point.
 */
const GENERIC_SET_FILENAMES: readonly string[] = ['set', 'index'];

export function stagedSetStem(json: string, path: string, taken: ReadonlySet<string>): string {
  const code = identityOf(json).code;
  const file = basename(path).replace(/\.set\.json$|\.json$/i, '');
  const named = GENERIC_SET_FILENAMES.includes(file.toLowerCase()) ? '' : slug(file);
  const base = slug(code ?? '') || named || slug(basename(dirname(path))) || 'set';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${String(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** One set read off disk, with the launcher's phrase for where it came from. */
export interface LibraryEntry {
  readonly set: ResolvedSet;
  /** True for the one the launcher would have opened on its own. */
  readonly selected: boolean;
}

/**
 * Every candidate on disk, the launcher's own choice first.
 *
 * The chosen set leads because it is the default and a dropdown's default
 * belongs at the top; the rest keep the candidate list's order, which is the
 * ranking `set-candidates.ts` argues. A candidate that cannot be read is
 * dropped with a note rather than fataled: `resolveSet` has already proved the
 * *chosen* one is a set, and a broken file somewhere else in `out/` must not
 * stop the lab from opening.
 */
export interface SetLibrary {
  readonly entries: readonly LibraryEntry[];
  /** One line per candidate that is on disk and is not a set this build can read. */
  readonly refused: readonly string[];
}

export function readSetLibrary(
  candidates: readonly SetCandidate[],
  chosen: ResolvedSet,
  options: { readonly read?: (path: string, what: string) => ReturnType<typeof readSetDocument> } = {},
): SetLibrary {
  const read = options.read ?? readSetDocument;
  const entries: LibraryEntry[] = [{ set: chosen, selected: true }];
  const refused: string[] = [];
  for (const candidate of candidates) {
    if (candidate.path === chosen.path) continue;
    const result = read(candidate.path, candidate.what);
    if (!result.ok) {
      // Only worth a line when the file is actually there; every candidate list
      // names more places than any checkout has.
      if (!/^no set at |^could not read /.test(result.message)) refused.push(result.message);
      continue;
    }
    entries.push({ set: result, selected: false });
  }
  return { entries, refused };
}

export interface StagedBundle {
  readonly row: StagedSetRow;
  readonly art: ArtOutcome;
}

export interface BundleStaging {
  readonly index: SetIndex;
  readonly bundles: readonly StagedBundle[];
  readonly refused: readonly string[];
}

/**
 * Writes every entry as a bundle under `public/sets/` and returns the index.
 *
 * The whole `sets/` directory is removed first. A stem is derived from the set
 * code, so a stem can be *reused by a different build* between two runs — the
 * paid XMP run replaced by a fresher one, `out/reference/m11` regenerated — and
 * a directory that kept the previous build's rasters beside the new build's
 * manifest is the stale-file failure this repository keeps meeting. Removing
 * the directory whose name this module owns is cheaper than reasoning about
 * which files inside it are still referenced.
 *
 * `explicitManifest` applies to the selected set alone. It is a promise about
 * one set's art — `resolveExplicitArtManifest` refuses a manifest that does not
 * cover it in full — and asserting that promise over every other set on disk
 * would turn a working override into a launcher that refuses to start.
 */
export async function stageSetBundles(
  library: SetLibrary,
  publicDir: string,
  repoRoot: string,
  explicitManifest?: string,
): Promise<BundleStaging> {
  const root = join(publicDir, STAGED_SETS_DIR);
  // Named literally rather than trusted: this function removes a directory tree,
  // and the one thing that makes it safe is that the path ends in the segment
  // this module owns.
  if (basename(root) !== STAGED_SETS_DIR) throw new Error(`refusing to clear ${root}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const taken = new Set<string>();
  const bundles: StagedBundle[] = [];
  let selected: string | null = null;

  for (const entry of library.entries) {
    const stem = stagedSetStem(entry.set.json, entry.set.path, taken);
    taken.add(stem);
    const dir = join(root, stem);
    mkdirSync(dir, { recursive: true });
    const url = `${STAGED_SETS_DIR}/${stem}`;
    writeFileSync(join(dir, 'set.json'), entry.set.json, 'utf8');

    const art = await stageArt(entry.set, entry.selected ? explicitManifest : undefined, {
      manifestPath: join(dir, ART_MANIFEST_FILENAME),
      publicDir: join(dir, BUNDLE_ART_DIR),
      servedPrefix: `${url}/${BUNDLE_ART_DIR}`,
      repoRoot,
    });

    const precons = choosePreconFile(
      preconCandidatesFor(entry.set.path, repoRoot),
      printedCardIdsOf(entry.set),
    );
    if (precons.chosen !== null) writeFileSync(join(dir, PRECON_FILENAME), precons.chosen.json, 'utf8');

    const identity = identityOf(entry.set.json);
    bundles.push({
      art,
      row: {
        stem,
        name: identity.name ?? basename(entry.set.path),
        code: identity.code,
        what: entry.set.what,
        cardCount: entry.set.cardCount,
        reduced: identity.reduced,
        setUrl: `${url}/set.json`,
        ...(art.status === 'staged' ? { artUrl: `${url}/${ART_MANIFEST_FILENAME}` } : {}),
        ...(precons.chosen === null ? {} : { preconUrl: `${url}/${PRECON_FILENAME}` }),
      },
    });
    if (entry.selected) selected = stem;
  }

  const first = bundles[0];
  if (first === undefined) throw new Error('stageSetBundles was given nothing to stage');
  const index: SetIndex = {
    formatVersion: SET_INDEX_VERSION,
    selected: selected ?? first.row.stem,
    sets: bundles.map((bundle) => bundle.row),
  };
  writeFileSync(join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return { index, bundles, refused: library.refused };
}

/**
 * The staging run's own line, and it names every set rather than only the one
 * being opened.
 *
 * A launcher that staged three sets and reported one would have looked exactly
 * like the launcher that staged one, which is the reading that made a stale
 * `public/set.json` invisible for as long as it was.
 */
export function describeBundles(staging: BundleStaging): string {
  const lines = staging.bundles.map((bundle) => {
    const mark = bundle.row.stem === staging.index.selected ? '*' : ' ';
    const art = bundle.art.status === 'staged' ? `${String(bundle.art.covered)} with art` : 'no art';
    const decks = bundle.row.preconUrl === undefined ? 'no decks' : 'decks';
    return `  ${mark} ${bundle.row.stem} — ${bundle.row.name}, ${String(bundle.row.cardCount)} cards, ${art}, ${decks}`;
  });
  const head =
    staging.bundles.length === 1
      ? 'Staged 1 set; the picker in the bar draws it as a label.'
      : `Staged ${String(staging.bundles.length)} sets; the picker in the bar switches between them (* opens first).`;
  return [head, ...lines, ...staging.refused.map((line) => `  ! ${line}`)].join('\n');
}
