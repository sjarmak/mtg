/**
 * The card-design equivalent of the art pipeline's regeneration file: a durable place
 * to write "this card is not workable" so a later redesign pass has a work list
 * instead of a memory.
 *
 * `data/art-preferences/*.regenerate.json` is the precedent this mirrors, and
 * the reason it lives beside the pictures rather than the cards is only that
 * art curation happened first. The judgment recorded here is a different kind:
 * a picture is wrong because it does not look like the thing the card names, a
 * card is unworkable because the *design* does not hold up — the ability text
 * is confusing, the power level is off, the mechanic does not fit the set — and
 * that judgment belongs to the person who read the card, not to any automated
 * check the pipeline already runs (`validate/` catches a card that breaks a
 * rule; this file catches a card that follows every rule and is still wrong).
 *
 * `@mtg/setgen` is the home rather than `@mtg/dsl` or `@mtg/ui` because this is
 * a fixture-adjacent concern about a *generated set*, the same reason
 * `emit.ts`'s `SetFileSchema` lives here: a rework request names a card id in a
 * particular set file and is read back against that same file, which is exactly
 * the shape `SetFileSchema` and its readers already have. It depends on `@mtg/dsl`
 * for `CardSchema` alone, which this module already needs transitively through
 * `SetFile`.
 *
 * The validation idiom (Zod schema, `.strict()` to catch unknown keys, a
 * dedicated parse function that throws a message naming the offending entry) is
 * lifted from the curation endpoint that records the picture judgments. Unlike
 * that one, there
 * is no server here and no atomic-write path: nobody edits this file over a
 * network, so a person editing JSON by hand is the only writer, and the reader
 * below is the only new code — writing is `Write` or `Edit` on a text file, the
 * same as any other fixture in `data/`.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * How bad the card is, in the three grades a redesign pass actually needs.
 *
 * `unworkable` means cut it or replace it outright: the ability is nonsensical,
 * the design cannot be salvaged with a text edit. `rework` means the card has a
 * legitimate slot and a legitimate idea but the execution needs a real pass —
 * a costing fix, a clearer ability, a different mechanic on the same shell.
 * `watch` means nothing is wrong yet, but the card is worth a second look after
 * playtesting or after a sibling card changes, which is a judgment the art
 * file's binary "flagged or not" cannot express and this one intentionally can.
 */
export const REWORK_VERDICTS = ['unworkable', 'rework', 'watch'] as const;

export type ReworkVerdict = (typeof REWORK_VERDICTS)[number];

export const ReworkVerdictSchema = z.enum(REWORK_VERDICTS);

/**
 * One flagged card. `note` is required and non-empty, unlike the art file's
 * optional note, because a verdict with no explanation is not a work list entry
 * — it is a card id and a mood, and the person doing the redesign a session or
 * a month later has nothing to act on. `cardId` is unconstrained beyond
 * non-empty; it is checked against a real set elsewhere (`readReworkFile` does
 * not have a set to check against, and the committed test does, deliberately,
 * per file).
 */
export const ReworkRequestSchema = z
  .object({
    cardId: z.string().min(1, 'a rework entry needs a cardId'),
    verdict: ReworkVerdictSchema,
    note: z.string().min(1, 'a rework entry needs a non-empty note explaining the judgment'),
  })
  .strict();

export type ReworkRequest = z.infer<typeof ReworkRequestSchema>;

export const REWORK_FILE_VERSION = 1;

export const ReworkFileSchema = z
  .object({
    formatVersion: z.literal(REWORK_FILE_VERSION),
    requests: z.array(ReworkRequestSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.requests.forEach((request, index) => {
      if (seen.has(request.cardId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['requests', index, 'cardId'],
          message: `${request.cardId} is named more than once in this rework file; a card has one verdict`,
        });
        return;
      }
      seen.add(request.cardId);
    });
  });

export type ReworkFile = z.infer<typeof ReworkFileSchema>;

export const EMPTY_REWORK_FILE: ReworkFile = {
  formatVersion: REWORK_FILE_VERSION,
  requests: [],
};

/**
 * Parses a rework file, failing with a message that names the offending entry
 * rather than a generic Zod dump. Unknown keys, an empty note, an unrecognized
 * verdict and a duplicate `cardId` are all rejected here; nothing is silently
 * dropped or coerced.
 */
export function parseReworkFile(raw: unknown): ReworkFile {
  const result = ReworkFileSchema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? 'the rework file' : issue.path.join('.');
  throw new Error(`${where}: ${issue?.message ?? 'is not a valid rework file'}`);
}

/**
 * Reads a rework file from disk. A missing file throws rather than reading as
 * `EMPTY_REWORK_FILE`, because the two states are not the same thing: an empty
 * `requests` array is somebody saying nothing is wrong with this set, and a
 * missing path is a caller pointed at a set nobody has judged, which is worth
 * hearing about rather than reporting as a clean bill of health.
 */
export function readReworkFile(path: string): ReworkFile {
  return parseReworkFile(JSON.parse(readFileSync(path, 'utf8')));
}
