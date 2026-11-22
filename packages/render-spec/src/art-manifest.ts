/**
 * The art manifest, in the one place every reader of it binds.
 *
 * Art arrives as *data*: a JSON document keyed by DSL card id, so adding art to
 * a set changes a file and no TypeScript. The anti-pattern that rule exists to
 * avoid is named in `the prior-project reuse audit` — a component with
 * about 120 hand-written static image imports, which does not survive contact
 * with a 250-card set.
 *
 * The document has three readers and they cannot share a package: the art pipeline
 * writes it and is Node-only, `@mtg/card-render` draws a printed proof from it,
 * and `@mtg/ui` draws the played table from it in a browser. Until `mtg-ey09`
 * there was no package all three could import, so each declared the shape and
 * the art pipeline's manifest test parsed one built manifest with every
 * reader to keep the copies from drifting. This file is that place, and the
 * copies are gone (`mtg-sn68`).
 *
 * What did not move is what each reader *decides*: the resolver that picks
 * which illustration a card gets is `@mtg/card-render`'s for a proof drawn once
 * and `@mtg/ui`'s for a table with object ids, and they answer differently on
 * purpose. One document, two readings of it.
 *
 * ## Why a card carries a list
 *
 * A real set prints several illustrations for each basic land, and five Swamps
 * in play that are five different pictures is most of what makes a board read
 * as a set rather than a spreadsheet. So `art[cardId]` is an array, never one
 * entry, and the renderer picks per object.
 *
 * ## Why version 2 replaces version 1 rather than joining it
 *
 * Format 1 mapped a card id to a single `{ href, alt }`. Accepting both that
 * and a one-element array would give one card two spellings with identical
 * meaning, so two manifests could describe one set and never compare equal —
 * the identity problem `canonicalJson` exists to avoid. The migration is cheap
 * because a manifest is generated output rather than a maintained document. A
 * v1 file that reaches a v2 reader fails the version literal, which every
 * reader turns into the labeled pending frame plus a sentence naming the file,
 * never a blank.
 */
import { z } from 'zod';

export const ART_MANIFEST_VERSION = 2;

/**
 * The format this one replaced, read for one reason: `out/art/xmp`, `xmp-v2`
 * and `xmp-v3` are every format-1 manifest this project ever wrote, and the
 * paid rasters beside them are not reproducible for free.
 */
export const ART_MANIFEST_VERSION_SINGLE = 1;

export const ArtManifestEntrySchema = z.object({
  /** A URL or a `data:` URI. Relative paths resolve against the manifest. */
  href: z.string().min(1),
  /**
   * Describes *this illustration*, not the card. Three Swamps are three
   * different pictures and get three different sentences, which is why the alt
   * lives on the variant rather than beside it: a screen reader that hears one
   * sentence for three faces has been told the set has one Swamp.
   */
  alt: z.string().min(1),
});

/**
 * A card's illustrations, best-known first.
 *
 * Non-empty, because an empty list would be a third state meaning what an
 * absent key already means, and a renderer would have to guess which one the
 * writer meant. A card with no art is a card with no entry.
 */
export const ArtManifestVariantsSchema = z.array(ArtManifestEntrySchema).min(1);

export const ArtManifestSchema = z.object({
  formatVersion: z.literal(ART_MANIFEST_VERSION),
  /** Card id to its illustrations. Ids are DSL card ids, so the join is exact. */
  art: z.record(z.string(), ArtManifestVariantsSchema),
});

/** Format 1: one illustration per card. Read only, to migrate. */
export const ArtManifestV1Schema = z.object({
  formatVersion: z.literal(ART_MANIFEST_VERSION_SINGLE),
  art: z.record(z.string(), ArtManifestEntrySchema),
});

export type ArtManifest = z.infer<typeof ArtManifestSchema>;
export type ArtManifestEntry = z.infer<typeof ArtManifestEntrySchema>;
export type ArtManifestV1 = z.infer<typeof ArtManifestV1Schema>;

/** Parses a manifest from disk or an API; throws with schema issues on bad input. */
export function parseArtManifest(input: unknown): ArtManifest {
  return ArtManifestSchema.parse(input);
}

/**
 * A format-1 document as format 2: one illustration each, which is what it said.
 *
 * Keys sorted, matching `buildArtManifest`, so a migrated manifest and a freshly
 * built one of the same content are the same bytes.
 */
export function migrateArtManifestV1(value: ArtManifestV1): ArtManifest {
  const art: Record<string, ArtManifestEntry[]> = {};
  for (const cardId of Object.keys(value.art).sort()) {
    const entry = value.art[cardId];
    if (entry !== undefined) art[cardId] = [entry];
  }
  return { formatVersion: ART_MANIFEST_VERSION, art };
}
