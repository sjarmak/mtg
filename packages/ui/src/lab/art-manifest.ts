/**
 * The contract for a staged art manifest, and the only place it is validated.
 *
 * the art pipeline writes this shape beside the rasters it generates; `npm run play`
 * stages both and this page reads it. As with the deck artifact, the two sides
 * are deliberately not linked by an import: the art pipeline runs headless and reaches
 * image backends and the filesystem, and it already depends on `@mtg/card-render`
 * which depends on this package, so an import in the other direction would be a
 * cycle. So the producer owns the writing and this file owns the reading.
 *
 * That makes three declarations of one schema — here, the art pipeline's own manifest module
 * and `@mtg/card-render/src/art.ts` — which is a cost paid deliberately and
 * guarded rather than assumed: the art pipeline's manifest test builds a
 * manifest with the real builder and parses it with both readers, so the copies
 * cannot drift apart without a red test.
 *
 * A card with no entry is not an error. It renders the pending frame, which is
 * the governance rule the art slot exists for: an unfinished surface announces
 * itself, so a set half-way through its art run is self-describing.
 */
import { z } from 'zod';
import type { Card as DslCard } from '@mtg/dsl';
import type { CardArt } from '../card/ArtSlot';

/**
 * Must equal `ART_MANIFEST_VERSION` in the art pipeline's own manifest module. Bump them
 * together; a stale manifest then fails with a version message rather than
 * resolving to nothing and looking like a set whose art was never run.
 */
export const ART_MANIFEST_VERSION = 2;

const EntrySchema = z.object({
  /** A URL, a `data:` URI, or a path relative to the manifest. */
  href: z.string().min(1),
  /** Describes the illustration, not the card; the card name is already text. */
  alt: z.string().min(1),
});

const ArtManifestSchema = z.object({
  formatVersion: z.literal(ART_MANIFEST_VERSION),
  /**
   * Card id to its illustrations, best-known first. Ids are DSL card ids, so the
   * join is exact; the list is non-empty because a card with no art has no entry.
   */
  art: z.record(z.string(), z.array(EntrySchema).min(1)),
});

/**
 * Must equal `ART_MANIFEST_VERSION_SINGLE` in the art pipeline's own manifest module.
 *
 * The format this one replaced: one illustration per card rather than a list of
 * them. Read only, and read at all only because three run directories on disk
 * still hold it — `out/art/xmp`, `xmp-v2` and `xmp-v3` are every format-1
 * manifest this project ever wrote, and the paid renders beside them are not
 * reproducible for free.
 */
export const ART_MANIFEST_VERSION_SINGLE = 1;

const ArtManifestV1Schema = z.object({
  formatVersion: z.literal(ART_MANIFEST_VERSION_SINGLE),
  art: z.record(z.string(), EntrySchema),
});

export type ArtManifest = z.infer<typeof ArtManifestSchema>;
export type ArtManifestEntry = z.infer<typeof EntrySchema>;

/**
 * A format-1 document as format 2: one illustration each, which is what it said.
 *
 * Keys sorted, matching `buildArtManifest`, so a migrated manifest and a freshly
 * built one of the same content are the same bytes.
 */
function migrated(value: z.infer<typeof ArtManifestV1Schema>): ArtManifest {
  const art: Record<string, ArtManifestEntry[]> = {};
  for (const cardId of Object.keys(value.art).sort()) {
    const entry = value.art[cardId];
    if (entry !== undefined) art[cardId] = [entry];
  }
  return { formatVersion: ART_MANIFEST_VERSION, art };
}

/** The document's own `formatVersion`, when it names one as a number. */
function formatVersionOf(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('formatVersion' in value)) return undefined;
  const version = (value as { formatVersion: unknown }).formatVersion;
  return typeof version === 'number' ? version : undefined;
}

/**
 * Resolves art for a card, or `null` when the set has none for it yet.
 *
 * `copy` distinguishes one printing of a card from another at the same table:
 * the fifth Swamp is copy 4 and gets the picture copy 4 is owed. Optional
 * because most callers draw a card once — the Cards gallery, a deck tile, a
 * stack entry — and one drawing has no copies to tell apart.
 */
export type ArtResolver = (card: DslCard, copy?: number) => CardArt | null;

export type ArtManifestResult =
  { readonly ok: true; readonly manifest: ArtManifest } | { readonly ok: false; readonly message: string };

/**
 * Parses an art manifest, or says what is wrong with it in one sentence.
 *
 * A result rather than a throw, for the reason the deck reader gives: the
 * launcher prints the message and carries on without art, and a raw `ZodError`
 * is not a sentence anyone wants in a terminal.
 *
 * Strictly the current format, and deliberately: everything this reader sees has
 * been staged by a launcher, so a card has exactly one encoding by the time the
 * page opens. `readMigratedArtManifest` below is where an older file is
 * accepted, and it is not this function because a browser that quietly reads two
 * encodings is a browser where the staged file's shape is no longer knowable.
 */
export function readArtManifest(value: unknown, source: string): ArtManifestResult {
  const parsed = ArtManifestSchema.safeParse(value);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at \`${issue.path.join('.')}\``;
  const why = issue?.message ?? 'did not match the art manifest schema';
  return {
    ok: false,
    message:
      `${source} is not an art manifest this build can read${where}: ${why}. ` +
      'Rebuild it with `npm run art -- generate --set <set.json> --out <dir>`.',
  };
}

/**
 * The same read, plus the one-pass conversion from the format this one replaced.
 *
 * For the staging boundary rather than the page. A format-1 file used to fail
 * `readArtManifest`'s version literal exactly like a corrupt one and be told to
 * rebuild with `art generate` — advice to spend money on an image backend to
 * reproduce rasters that already exist, and every format-1 manifest this project
 * wrote sits beside paid renders. The conversion reaches no backend and no
 * network, so refusing was never the cheaper answer.
 *
 * Converting here rather than in `readArtManifest` is what keeps the page's
 * one-encoding property: the launcher migrates on read and stages format 2, so
 * the browser still only ever sees one shape.
 *
 * Which of the two ways it failed matters to whoever reads the message, so the
 * refusal says so: a document naming an older version that still cannot be
 * converted is broken in its own shape, and only then is a rebuild the answer.
 */
export function readMigratedArtManifest(value: unknown, source: string): ArtManifestResult {
  const older = ArtManifestV1Schema.safeParse(value);
  if (older.success) return { ok: true, manifest: migrated(older.data) };

  const version = formatVersionOf(value);
  if (version !== undefined && version < ART_MANIFEST_VERSION) {
    const issue = older.error.issues[0];
    const why = issue?.message ?? 'did not match that format either';
    return {
      ok: false,
      message:
        `${source} names formatVersion ${String(version)}, which this build migrates for free, but the ` +
        `document does not match that format: ${why}. So it is broken rather than merely old. ` +
        'Rebuild it with `npm run art -- generate --set <set.json> --out <dir>`.',
    };
  }
  return readArtManifest(value, source);
}

/**
 * Which of a card's illustrations copy number `copy` shows.
 *
 * Round-robin, and that is the spread rule: copy 0 takes the first picture, copy
 * 1 the second, copy 5 of three pictures takes the third again. Over any run of
 * consecutive copies the illustrations come out balanced to within one, so a
 * deck's Swamps use every Swamp art it has rather than landing on one five times
 * — which is what a hash of the object id would do often enough to notice, since
 * a hash is uniform per draw and says nothing about the draws beside it.
 *
 * It decides nothing on its own: `copy` is supplied by the caller and has to be
 * stable for the life of the permanent, which is `routes/play/position.ts`'s
 * job. Nothing here calls a clock or a random source, so a replayed game paints
 * the board the game painted.
 */
export function pickVariant<T>(variants: readonly T[], copy: number): T | null {
  if (variants.length === 0) return null;
  const index = ((copy % variants.length) + variants.length) % variants.length;
  return variants[index] ?? null;
}

/**
 * Whether this card's illustrations rotate, or whether it has one preferred picture.
 *
 * Only basic lands rotate. That is the whole rule, and it is narrower than the
 * one that shipped first: `pickVariant` was applied to every card with more than
 * one entry, so a creature collated from three runs showed all three pictures
 * across a game, including the one somebody had already decided against. A real
 * set prints five Swamps and one Deathbringer, and the manifest's several
 * entries for a named card are *candidates* rather than printings — the reason
 * `data/art-preferences/` exists at all is that somebody is expected to choose
 * between them.
 *
 * `basicLandType` rather than the `basic` supertype, because that is the field
 * `@mtg/dsl`'s `setBasics` already identifies a set's basics by, and a second
 * derivation of "is this a Swamp" is a second chance to disagree with the one
 * that mints the card and keys the manifest.
 */
export function rotatesIllustrations(card: DslCard): boolean {
  return card.kind === 'land' && card.basicLandType !== undefined;
}

/**
 * The one illustration a given copy of a card draws.
 *
 * A named card draws position zero every time, whatever copy it is. Position
 * zero is the *preferred* picture rather than merely the first on disk: the
 * launcher reorders each card's list by `data/art-preferences/<set>.json` before
 * staging it (`tools/art-preference-order.ts`), so a recorded pick leads the
 * list and a card nobody has an opinion about keeps the collation's own order,
 * which is deterministic and never drawn.
 *
 * A basic land keeps the round-robin, which is what `copy` was computed for.
 */
export function selectIllustration<T>(card: DslCard, variants: readonly T[], copy: number): T | null {
  if (!rotatesIllustrations(card)) return variants[0] ?? null;
  return pickVariant(variants, copy);
}

/**
 * A resolver over a validated manifest — the `artFor` the card view takes.
 *
 * The manifest speaks `href` because it is the wire format both renderers read;
 * this page speaks `src` because it renders an `<img>`. The conversion is here
 * so neither the manifest nor the component has to know about the other.
 */
export function artResolver(manifest: ArtManifest): ArtResolver {
  const byId = new Map(Object.entries(manifest.art));
  return (card, copy = 0) => {
    const variants = byId.get(card.id);
    if (variants === undefined) return null;
    const entry = selectIllustration(card, variants, copy);
    return entry === null ? null : { src: entry.href, alt: entry.alt };
  };
}
