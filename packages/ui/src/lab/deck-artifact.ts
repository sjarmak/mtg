/**
 * The contract for a staged deck document, and the only place it is validated.
 *
 * `@mtg/decklab`'s `toDeckArtifact` writes this shape; `npm run lab` stages it
 * and this page reads it. The two sides are deliberately not linked by an
 * import: `@mtg/decklab` reaches the card store through `better-sqlite3`, and a
 * type-only dependency would still put that package on the browser's module
 * graph. So the producer owns the writing and this file owns the reading, and
 * the seam between them is checked rather than assumed — a drifted artifact
 * fails here, naming the field, before Vite ever starts.
 *
 * Everything the page prints is in the document, including the castability
 * bands. The UI holds no opinion about what 0.9 means; it renders the number
 * the deck was actually held to.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';
import { CURVE_BUCKETS } from '@mtg/deckbuild';

/**
 * Must equal `DECK_ARTIFACT_VERSION` in `@mtg/decklab/src/artifact.ts`. The two
 * constants are the seam described above: bump them together, and a stale
 * artifact then fails with a version message instead of a missing section.
 *
 * `sideboard` arrived under `mtg-o5z1` and deliberately did **not** move this
 * number. The rule the paragraph above states is that a bump is for a field that
 * changed meaning or left; an optional field that arrives changes how nothing
 * already written is read, and bumping would make every artifact on disk fail to
 * parse in order to announce something none of them had an opinion about.
 *
 * Optional rather than required, because absent and empty are different claims
 * and the pane draws them differently. `@mtg/decklab` proposes exactly the deck
 * and leaves nothing over, so it writes no sideboard at all and the page draws
 * no sideboard pane — it has not been told this deck has none, only that nobody
 * said. A document that carries the field, empty, is a builder that does set
 * cards aside saying this deck set none aside, and that pane is drawn and says
 * so. A required field would collapse the two into one empty pane over every
 * deck ever built.
 */
export const DECK_ARTIFACT_VERSION = 1;

const ArtSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  artist: z.string().nullable(),
  setCode: z.string().min(1),
});

const EntrySchema = z.object({
  name: z.string().min(1),
  count: z.int().min(1),
  manaCost: z.string().nullable(),
  manaValue: z.number().min(0),
  typeLine: z.string(),
  colorIdentity: z.string(),
  priceUsd: z.number().nullable(),
  criteria: z.array(z.string()),
  reason: z.string(),
  art: ArtSchema.nullable(),
});

const CheckSchema = z.object({
  cardName: z.string().min(1),
  pips: z.int().min(1),
  manaValue: z.number().min(0),
  target: z.number().min(0).max(1),
});

const ColorReportSchema = z.object({
  color: z.enum(COLORS),
  pipCount: z.number().min(0),
  weightedDemand: z.number().min(0),
  sources: z.int().min(0),
  basicSources: z.int().min(0),
  nonBasicSources: z.int().min(0),
  sourceFloor: z.int().min(0),
  castability: z.number().min(0).max(1),
  meetsTarget: z.boolean(),
  binding: CheckSchema.nullable(),
});

const CriterionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['structural', 'semantic']),
  statement: z.string().min(1),
});

/** One count per bucket, built from the shared bucket list rather than restated. */
const HistogramSchema = z.object(
  Object.fromEntries(CURVE_BUCKETS.map((bucket) => [String(bucket), z.int().min(0)])) as Record<
    string,
    z.ZodNumber
  >,
);

export const DeckArtifactSchema = z.object({
  version: z.literal(DECK_ARTIFACT_VERSION),
  prompt: z.string().min(1),
  format: z.string().min(1),
  colors: z.array(z.enum(COLORS)),
  criteria: z.array(CriterionSchema),
  plan: z.string(),
  totalCards: z.int().min(0),
  priceUsd: z.number().min(0),
  universeSize: z.int().min(0),
  landPlan: z.object({
    count: z.int().min(0),
    /** `LandCountSource` in `@mtg/decklab`: the player said so, or the model decided. */
    source: z.enum(['stated', 'model']),
    reason: z.string(),
  }),
  spells: z.array(EntrySchema),
  lands: z.array(EntrySchema),
  basics: z.array(EntrySchema),
  /** Cards set aside rather than played. Absent is not empty; see the version's docblock. */
  sideboard: z.array(EntrySchema).optional(),
  manaBase: z.object({
    totalLands: z.int().min(0),
    nonBasicLands: z.int().min(0),
    castabilityTarget: z.number().min(0).max(1),
    heavyCastabilityTarget: z.number().min(0).max(1),
    colors: z.array(ColorReportSchema),
  }),
  curve: z.object({
    histogram: HistogramSchema,
    averageManaValue: z.number().min(0),
  }),
  shortfalls: z.array(z.string()),
});

export type DeckArtifact = z.infer<typeof DeckArtifactSchema>;
export type DeckArtifactEntry = z.infer<typeof EntrySchema>;
export type DeckArtifactColor = z.infer<typeof ColorReportSchema>;
export type DeckArtifactCheck = z.infer<typeof CheckSchema>;
export type DeckArt = z.infer<typeof ArtSchema>;

/**
 * Parses a deck document, or says what is wrong with it in one sentence.
 *
 * Returns a result rather than throwing because both callers want the message
 * as text: the launcher prints it to a terminal and exits, and the page renders
 * it where the deck would have been. A raw `ZodError` serves neither.
 */
export type DeckArtifactResult =
  { readonly ok: true; readonly deck: DeckArtifact } | { readonly ok: false; readonly message: string };

export function readDeckArtifact(value: unknown, source: string): DeckArtifactResult {
  const parsed = DeckArtifactSchema.safeParse(value);
  if (parsed.success) return { ok: true, deck: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at \`${issue.path.join('.')}\``;
  const why = issue?.message ?? 'did not match the deck artifact schema';
  return {
    ok: false,
    message:
      `${source} is not a deck artifact this build can read${where}: ${why}. ` +
      `Rebuild it with \`npx tsx packages/decklab/src/cli.ts … --artifact <path>\`.`,
  };
}
