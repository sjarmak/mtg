/**
 * Puts each card's preferred illustration first, before the manifest is staged.
 *
 * the art pipeline's collation orders a card's illustrations by adoption order — which
 * run was named on the command line, which supersedes edge was declared, which
 * candidate the pillarbox gate refused. That is a production fact, not a
 * judgment, and the renderer now paints position zero for every named card
 * (`src/lab/art-manifest.ts`'s `selectIllustration`). So position zero has to
 * mean *preferred*, and the only record of what anybody prefers is
 * `data/art-preferences/<set>.json`, written by `npm run curate` and edited by
 * hand.
 *
 * ## Reordering, not replacing
 *
 * the art pipeline's own `resolvePreferences` resolves a preference into a manifest by
 * looking every hash up in an index built over the whole art root, and it treats
 * an unresolvable hash as a loud error. That is the right rule for producing a
 * canonical manifest: the caller named a raster and it must exist somewhere
 * under `out/art/`.
 *
 * It is the wrong rule here. Staging works from *one* manifest — whichever run
 * covers this set best — and a preference file spans every run ever collated,
 * so it legitimately names rasters this manifest does not carry. Building a
 * 4.2 GB hash index to open a lab is also not a thing a launcher should do. So
 * this reorders the entries the chosen manifest already has, by the hashes of
 * the rasters it already points at: a named hash that is present leads, one that
 * is absent is reported and otherwise ignored, and no entry is ever dropped.
 * Cards with no preference keep the collation's order untouched.
 *
 * ## Why the launcher and not the art pipeline
 *
 * the art pipeline depends on `@mtg/card-render`, which depends on `@mtg/ui`, so this
 * package cannot import that one without closing a cycle — the same constraint
 * `src/lab/art-manifest.ts` states for the manifest schema and pays for with a
 * cross-parse test. The schema below is deliberately the narrow half of
 * the art pipeline's `ArtPreferencesSchema` (card id to a non-empty ordered list of
 * lowercase sha256), and `test/lab/art-preference-order.test.ts` parses a
 * document through both readers so the two cannot drift apart quietly.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import type { ArtManifest, ArtManifestEntry } from '../src/lab/art-manifest';

/** Where curated picks live. Tracked, unlike the rasters they name. */
export const PREFERENCES_DIR = join('data', 'art-preferences');

/**
 * Must stay the narrow half of the art package's `ArtPreferencesSchema`; the
 * cross-parse test guards the pair.
 */
const PreferencesSchema = z.record(z.string().min(1), z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1));

export type ArtPreferences = z.infer<typeof PreferencesSchema>;

export interface PreferenceOrdering {
  /** The manifest with every preferred illustration moved to position zero. */
  readonly manifest: ArtManifest;
  /** The preferences file read, or `null` when the set has none. */
  readonly path: string | null;
  /** Card ids whose illustration order this changed. */
  readonly reordered: readonly string[];
  /** Cards whose preferred raster is not in this manifest, so it could not lead. */
  readonly unavailable: readonly string[];
  /** Recorded picks for a card this manifest has no illustration of at all. */
  readonly unknown: readonly string[];
}

/**
 * The preferences file belonging to a set file, by the naming the repository
 * already uses: `…/<stem>.set.json` is curated in
 * `data/art-preferences/<stem>.json`, beside `…/<stem>.regenerate.json` and the
 * card-preferences file of the same stem. A set with no such file is the normal state and is not an
 * error — it means nobody has picked yet, and the collation's order stands.
 */
export function preferencesPathFor(setPath: string, repoRoot: string): string | null {
  const stem = basename(setPath)
    .replace(/\.set\.json$/, '')
    .replace(/\.json$/, '');
  if (stem.length === 0) return null;
  const path = resolve(repoRoot, PREFERENCES_DIR, `${stem}.json`);
  return existsSync(path) ? path : null;
}

/** Parses a preferences document, throwing with the schema's own message. */
export function parsePreferences(value: unknown): ArtPreferences {
  return PreferencesSchema.parse(value);
}

export function readPreferences(path: string): ArtPreferences {
  return parsePreferences(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/**
 * The sha256 of the raster an entry points at, or `null` when it is not a local
 * file this process can open — a remote `href` or a `data:` URI has no raster on
 * disk, and a manifest naming a file that is gone is `stageSetArt`'s finding to
 * report rather than this function's to throw over.
 */
function digestOf(entry: ArtManifestEntry, manifestDir: string): string | null {
  if (/^(https?:|data:)/.test(entry.href)) return null;
  const file = resolve(manifestDir, entry.href);
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * One card's entries, ordered by the preference and otherwise left alone.
 *
 * A named hash sorts to its position in the preference; everything else keeps
 * its collation order behind them. `Array.prototype.sort` is stable, so two
 * unnamed entries never swap and the result is a function of the two documents
 * rather than of the filesystem's listing order.
 */
function ordered(
  entries: readonly ArtManifestEntry[],
  hashes: readonly string[],
  manifestDir: string,
): { readonly entries: readonly ArtManifestEntry[]; readonly matched: number } {
  const rank = new Map(hashes.map((digest, index) => [digest, index]));
  const keyed = entries.map((entry, index) => {
    const digest = digestOf(entry, manifestDir);
    const named = digest === null ? undefined : rank.get(digest);
    return { entry, index, rank: named ?? Number.MAX_SAFE_INTEGER };
  });
  const sorted = [...keyed].sort((a, b) => a.rank - b.rank || a.index - b.index);
  return {
    entries: sorted.map((item) => item.entry),
    matched: keyed.filter((item) => item.rank !== Number.MAX_SAFE_INTEGER).length,
  };
}

/**
 * The manifest with preferred illustrations leading, and what that changed.
 *
 * `unavailable` is the line worth printing: a card with a recorded pick whose
 * raster lives in a run this manifest is not from paints something the person
 * who curated it did not choose, and silently painting it was the bug this
 * whole lane is about.
 *
 * `unknown` is the same argument one step earlier. The loop walks the manifest,
 * so a preference keyed to an id the manifest has never heard of is read by
 * nobody and reported by nobody: `xmp-gloom-hand` sat in the flagship's
 * preferences naming a card the set calls `xmp-gloom-hands`, and the pick it
 * recorded was the right raster for the right card under a stale id. A file
 * that is quietly one id out of date looks exactly like a file that is obeyed.
 */
export function orderByPreference(
  manifest: ArtManifest,
  manifestDir: string,
  preferences: ArtPreferences,
  path: string | null = null,
): PreferenceOrdering {
  const art: Record<string, ArtManifestEntry[]> = {};
  const reordered: string[] = [];
  const unavailable: string[] = [];
  const unknown = Object.keys(preferences).filter((cardId) => manifest.art[cardId] === undefined);
  for (const [cardId, entries] of Object.entries(manifest.art)) {
    const hashes = preferences[cardId];
    if (hashes === undefined || entries.length < 2) {
      art[cardId] = [...entries];
      continue;
    }
    const result = ordered(entries, hashes, manifestDir);
    art[cardId] = [...result.entries];
    if (result.matched === 0) unavailable.push(cardId);
    else if (result.entries[0] !== entries[0]) reordered.push(cardId);
  }
  return {
    manifest: { formatVersion: manifest.formatVersion, art },
    path,
    reordered: reordered.sort(),
    unavailable: unavailable.sort(),
    unknown: unknown.sort(),
  };
}

/**
 * The whole step as a launcher runs it: find the set's preferences, apply them,
 * and hand back the manifest to stage. A set with no preferences file gets its
 * manifest back unchanged, which is the untouched case rather than a failure.
 */
export function applyArtPreferences(
  manifest: ArtManifest,
  manifestDir: string,
  setPath: string,
  repoRoot: string,
): PreferenceOrdering {
  const path = preferencesPathFor(setPath, repoRoot);
  if (path === null) {
    return { manifest, path: null, reordered: [], unavailable: [], unknown: [] };
  }
  return orderByPreference(manifest, manifestDir, readPreferences(path), path);
}

/** One sentence for the launcher's stdout, or nothing when there was no file. */
export function describePreferenceOrdering(ordering: PreferenceOrdering): string {
  if (ordering.path === null) {
    return 'No art preferences for this set, so each card paints the collation’s first illustration.';
  }
  const head = `Preferred art from ${ordering.path}: ${String(ordering.reordered.length)} card(s) reordered.`;
  const lines = [head];
  if (ordering.unavailable.length > 0) {
    lines.push(
      `${String(ordering.unavailable.length)} card(s) have a recorded pick this manifest does not carry, ` +
        'so they paint what it does have:',
      ...ordering.unavailable.map((cardId) => `  - ${cardId}`),
    );
  }
  if (ordering.unknown.length > 0) {
    lines.push(
      `${String(ordering.unknown.length)} recorded pick(s) name a card this manifest has no art for, ` +
        'so nothing reads them:',
      ...ordering.unknown.map((cardId) => `  - ${cardId}`),
    );
  }
  return lines.join('\n');
}
