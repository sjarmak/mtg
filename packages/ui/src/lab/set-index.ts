/**
 * The index of staged set bundles, and the only place its shape is checked.
 *
 * The lab used to be one set per server restart: `npm run play` picked exactly
 * one candidate, copied it to `public/set.json`, and the page fetched that fixed
 * path. Comparing the flagship against a reduced reference set was three server
 * restarts. So the launcher now stages every set it found, each as a *bundle* —
 * its own directory holding its set document, its art manifest and that
 * manifest's rasters — and writes this index beside them.
 *
 * # Why a bundle rather than a file
 *
 * Three things travel with a set and all three used to be staged into single
 * fixed paths: the set document, its art manifest, and the rasters that manifest
 * names. Its collation rides inside the document, so it comes along for free.
 * A picker that swapped only the document would leave the previous set's art
 * resolving against the new set's card ids, which is the defect this repository
 * has already shipped once — the launcher chose a manifest by existence rather
 * than by coverage and drew a full board of pending frames with the right
 * rasters one directory away. The unit the picker switches between is therefore
 * the whole bundle, and this index names all of its parts at once.
 *
 * # Read here, written by the launcher
 *
 * `tools/stage-set-bundles.ts` writes it and imports this module to do so, so
 * there is one declaration of the shape rather than a producer and a consumer
 * that agree by habit. That is the arrangement `deck-artifact.ts` and
 * `precon-file.ts` already use, and the reason is the same: the launcher runs in
 * Node and reaches the filesystem, the page runs in a browser and reaches
 * neither, and only the schema is common to both.
 *
 * A result rather than a throw, for the reason every other reader in this
 * directory gives: the page prints the message and keeps its empty state, and a
 * raw `ZodError` is not a sentence anybody wants on screen.
 */
import { z } from 'zod';

/**
 * Must match what `tools/stage-set-bundles.ts` stamps. Bump it when a row gains
 * a field the page cannot do without, so a stale index fails with a version
 * message rather than resolving to a picker that is quietly missing a set.
 */
export const SET_INDEX_VERSION = 1;

/** The directory under `public/` that holds every staged bundle, and the URL prefix. */
export const STAGED_SETS_DIR = 'sets';

/** Where the page fetches the index from, relative to the document base. */
export const SET_INDEX_URL = `${STAGED_SETS_DIR}/index.json`;

const RowSchema = z.object({
  /**
   * The bundle's directory name, and the identity the picker selects by.
   *
   * Not the set code: two candidates can be builds of the same set — a paid
   * generation run and the committed fixture both call themselves XMP — and a
   * picker that could not tell them apart would be a picker that hides one.
   */
  stem: z.string().min(1),
  /** The set's own name, which is what the picker draws. */
  name: z.string().min(1),
  /** The set's own code, or null for a document that names none. */
  code: z.string().min(1).nullable(),
  /**
   * Where this build came from, in the launcher's own words.
   *
   * Carried because the name alone does not separate two builds of one set, and
   * that is the case the launcher's candidate list produces every day: `out/`
   * holds a generation run and the repository holds the committed fixture.
   */
  what: z.string().min(1),
  cardCount: z.number().int().positive(),
  /** True for a reduced reference build, which the shell already discloses. */
  reduced: z.boolean(),
  setUrl: z.string().min(1),
  /** Absent when no manifest covers this set, which is the ordinary state. */
  artUrl: z.string().min(1).optional(),
  /** Absent when nothing on disk holds decks cut from this set. */
  preconUrl: z.string().min(1).optional(),
});

const SetIndexSchema = z
  .object({
    formatVersion: z.literal(SET_INDEX_VERSION),
    /**
     * The stem the page opens on: the launcher's own choice, which is what its
     * candidate order and its flagship filter have always computed. The filter
     * stopped being a discard when the launcher started staging everything; it
     * is an ordering and a default now, which is what it always was.
     */
    selected: z.string().min(1),
    sets: z.array(RowSchema).min(1),
  })
  .superRefine((index, ctx) => {
    const seen = new Set<string>();
    for (const row of index.sets) {
      if (seen.has(row.stem)) {
        ctx.addIssue({ code: 'custom', message: `two staged sets share the stem ${row.stem}` });
      }
      seen.add(row.stem);
    }
    if (!seen.has(index.selected)) {
      ctx.addIssue({
        code: 'custom',
        message: `selected names ${index.selected}, which is not a staged set`,
      });
    }
  });

export type StagedSetRow = z.infer<typeof RowSchema>;
export type SetIndex = z.infer<typeof SetIndexSchema>;

export type SetIndexResult =
  { readonly ok: true; readonly index: SetIndex } | { readonly ok: false; readonly message: string };

/** Parses a staged set index, or says what is wrong with it in one sentence. */
export function readSetIndex(value: unknown, source: string): SetIndexResult {
  const parsed = SetIndexSchema.safeParse(value);
  if (parsed.success) return { ok: true, index: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at \`${issue.path.join('.')}\``;
  const why = issue?.message ?? 'did not match the staged set index schema';
  return {
    ok: false,
    message: `${source} is not a staged set index this build can read${where}: ${why}. Re-run \`npm run play\`.`,
  };
}

/**
 * The row a stem names, or the index's own default when it names none.
 *
 * A stem that is no longer in the index is the state a page left open across a
 * staging run arrives in: the launcher restaged and the set the reader was
 * looking at is gone. Falling back to the default is what keeps that a change of
 * set rather than a blank page, and the schema has already proved the default
 * names a row.
 */
export function selectedRow(index: SetIndex, stem: string | null): StagedSetRow {
  const found = stem === null ? undefined : index.sets.find((row) => row.stem === stem);
  if (found !== undefined) return found;
  const fallback = index.sets.find((row) => row.stem === index.selected);
  if (fallback === undefined)
    throw new Error(`staged set index selects ${index.selected}, which it does not list`);
  return fallback;
}
