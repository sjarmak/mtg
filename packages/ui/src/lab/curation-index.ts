/**
 * The reading half of the curation index, and the only place the page validates it.
 *
 * the art pipeline writes this document and its staging tool puts it where the page
 * can fetch it; the curation grid reads it from there. The schema is
 * declared twice on purpose, the way the art manifest already is: the art pipeline is
 * Node-only and reaches image backends and the filesystem, and it already
 * depends on `@mtg/card-render`, which depends on this package, so an import
 * either way closes a cycle. the art pipeline's own curation test builds with
 * the real builder and parses with this reader, so the copies cannot diverge
 * without a red test.
 *
 * A result rather than a throw, for the reason the deck and manifest readers
 * give: the page draws the message and stays usable, and a raw `ZodError` is
 * not a sentence anybody wants on a tablet.
 */
import { z } from 'zod';

/** Must equal the `CURATION_INDEX_VERSION` the art pipeline declares. */
export const CURATION_INDEX_VERSION = 1;

const CandidateSchema = z.object({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  run: z.string().min(1),
  alt: z.string().min(1),
  thumb: z.string().min(1),
  full: z.string().min(1),
});

const CardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  candidates: z.array(CandidateSchema).min(1),
});

const IndexSchema = z.object({
  formatVersion: z.literal(CURATION_INDEX_VERSION),
  cards: z.array(CardSchema),
});

export type CurationCandidate = z.infer<typeof CandidateSchema>;
export type CurationCard = z.infer<typeof CardSchema>;
export type CurationIndex = z.infer<typeof IndexSchema>;

export type CurationIndexResult =
  { readonly ok: true; readonly index: CurationIndex } | { readonly ok: false; readonly message: string };

/** Parses a staged curation index, or says in one sentence what is wrong with it. */
export function readCurationIndex(value: unknown, source: string): CurationIndexResult {
  const parsed = IndexSchema.safeParse(value);
  if (parsed.success) return { ok: true, index: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at \`${issue.path.join('.')}\``;
  const why = issue?.message ?? 'did not match the curation index schema';
  return {
    ok: false,
    message:
      `${source} is not a curation index this build can read${where}: ${why}. ` +
      'Rebuild it with `npm run curate`.',
  };
}
