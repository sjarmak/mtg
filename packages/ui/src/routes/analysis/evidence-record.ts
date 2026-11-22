/**
 * The staged evidence snapshot: what the ledgers under `out/` and the recorded
 * games under `data/gameplay/` say about each set, format and cube, in one shape
 * the browser can read without any of the tools that wrote them.
 *
 * One record per artifact, keyed for the page by `subject.id`, which is the
 * single join key between a browser selection and a ledger: a kernel set's code
 * (`set.code`, the set index row's `code`), a printed format's id (`isd`,
 * `akh-hou`, the id in `public/formats/index.json`) or the Legacy Cube's format
 * id (`LEGACY_CUBE_FORMAT` in `../legacy-cube/model.ts`). Every family states one
 * of those three without reading a trial, so the key costs nothing to derive
 * and the page does not have to guess.
 *
 * `evidence` is a union by strength, and that is the point of the shape. A
 * judgment artifact (a model's quality review) is structurally unable to carry
 * a game count, so nothing downstream can add it to one; a statistics record
 * carries a summary and no rows; a games record carries trial counts and, when
 * the scanner streamed the trials, the identity of the first episode. That
 * identity is a projection of `BotEvidenceEpisode['episode']`, which the scanner
 * validates in Node through `BotEvidenceEpisodeSchema.shape.episode` (its
 * refinements intact) before it lands here. This file restates only the four
 * fields it keeps, with plain zod, and imports nothing from `@mtg/bot-evidence`,
 * not even a type: that package reads `node:crypto` at module scope, the Vite
 * shim for it throws on call, and the workspace's dependency table draws no
 * arrow from this package's `src/` to it. The names are still checked against
 * the schema at compile time, at the one call site that hands a validated
 * episode to `summarizeEpisode`, in `../../../tools/stage-strength-family.ts`.
 *
 * Read the way `../../lab/set-index.ts` reads the staged set index: a parse
 * failure is one sentence naming the source and the first issue path, never a
 * throw, because the snapshot is a file another process wrote and a page that
 * dies on a stale one has nothing to say about how to fix it. The writer is
 * `../../../tools/stage-evidence.ts`; the section that draws this is
 * `./evidence-panel.ts`.
 */
import { z } from 'zod';

export const EVIDENCE_SNAPSHOT_VERSION = 'mtg-ui/analysis-evidence/1' as const;

/** Where `npm run play` stages the snapshot, relative to the document base. */
export const EVIDENCE_URL = 'analysis-evidence.json';

export const EVIDENCE_FAMILIES = [
  'legacy-cube-bot-calibration',
  'stage-strength',
  'bot-strength',
  'printed-observed-sweep',
  'legacy-cube-quality',
  'legacy-cube-deck-review',
  'recorded-games',
] as const;
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];

/** What each family is, in the words the panel prints beside a record. */
export const FAMILY_LABELS: Readonly<Record<EvidenceFamily, string>> = {
  'legacy-cube-bot-calibration': 'Legacy Cube bot calibration',
  'stage-strength': 'Stage strength campaign',
  'bot-strength': 'Bot strength campaign',
  'printed-observed-sweep': 'Printed observed sweep',
  'legacy-cube-quality': 'Legacy Cube quality review',
  'legacy-cube-deck-review': 'Legacy Cube deck review',
  'recorded-games': 'Recorded games',
};

export const SubjectSchema = z.strictObject({
  kind: z.enum(['set', 'format', 'cube']),
  /** The one join key: `set.code`, a printed `formats[].id`, or `LEGACY_CUBE_FORMAT`. */
  id: z.string().min(1),
  /** The printed set code beside a format id, when the artifact names one. */
  code: z.string().min(1).nullable(),
});
export type EvidenceSubject = z.infer<typeof SubjectSchema>;

/**
 * Projection of `BotEvidenceEpisode['episode']`: the four fields that say what
 * a trial was about. `EpisodeProjection` below is that episode as far as this
 * reads it, written structurally so this file names no Node-only package; the
 * scanner passes the validated episode itself, so a rename in that schema
 * fails at its call site rather than silently here.
 */
export const EpisodeIdentitySummarySchema = z.strictObject({
  id: z.string().min(1),
  stage: z.enum(['gameplay', 'draft', 'deckbuilding']),
  runtime: z.enum(['native', 'forge', 'analysis']),
  formatId: z.string().min(1),
});
export type EpisodeIdentitySummary = z.infer<typeof EpisodeIdentitySummarySchema>;
export interface EpisodeProjection {
  readonly id: string;
  readonly stage: EpisodeIdentitySummary['stage'];
  readonly runtime: { readonly kind: EpisodeIdentitySummary['runtime'] };
  readonly subject: { readonly formatId: string };
}

/** Reduces a validated episode identity to the summary the snapshot carries. */
export function summarizeEpisode(episode: EpisodeProjection): EpisodeIdentitySummary {
  return {
    id: episode.id,
    stage: episode.stage,
    runtime: episode.runtime.kind,
    formatId: episode.subject.formatId,
  };
}

const CountSchema = z.number().int().nonnegative();
const ArmCountSchema = z.strictObject({ attempted: CountSchema, completed: CountSchema });
export type ArmCount = z.infer<typeof ArmCountSchema>;

export const EVIDENCE_STRENGTHS = ['games', 'statistics', 'judgment'] as const;
export type EvidenceStrengthKind = (typeof EVIDENCE_STRENGTHS)[number];

export const EvidenceStrengthSchema = z.discriminatedUnion('strength', [
  z.strictObject({
    strength: z.literal('games'),
    /** Every trial the artifact scheduled, and how many of them finished. */
    trials: ArmCountSchema,
    /** The per-arm split of a paired campaign, or null for games with no arms. */
    arms: z.strictObject({ baseline: ArmCountSchema, candidate: ArmCountSchema }).nullable(),
    /** Where the counts came from, so a reader knows what was and was not opened. */
    source: z.enum(['comparison', 'trials-stream', 'report', 'gameplay-index']),
    /** The first streamed episode's identity; null when no trial was read. */
    episode: EpisodeIdentitySummarySchema.nullable(),
    /** The artifact's own verdict word (`retain-baseline`, `unproven`), when it states one. */
    status: z.string().min(1).nullable(),
  }),
  z.strictObject({
    strength: z.literal('statistics'),
    summary: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  }),
  z.strictObject({
    strength: z.literal('judgment'),
    origin: z.string().min(1),
    /** Null when the artifact does not state it, which the panel says. */
    independentHumanEvidence: z.boolean().nullable(),
    adoptionEligible: z.boolean().nullable(),
  }),
]);
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>;

export const EvidenceRecordSchema = z.strictObject({
  family: z.enum(EVIDENCE_FAMILIES),
  /** Repository-relative, as the scanner labels it: `out/<dir>` or `data/gameplay/index.jsonl`. */
  path: z.string().min(1),
  /** The artifact's own version string, or the schema name for a family that has none. */
  version: z.string().min(1),
  subject: SubjectSchema,
  /** The pairing the evidence is about (candidate against baseline, deck against deck), when it states one. */
  matchup: z.string().min(1).nullable(),
  /** ISO timestamp: the artifact's own when it states one, else its file's modification time. */
  produced: z.string().min(1).nullable(),
  evidence: EvidenceStrengthSchema,
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

const PathRow = z.string().min(1);

export const EvidenceSnapshotSchema = z.strictObject({
  formatVersion: z.literal(EVIDENCE_SNAPSHOT_VERSION),
  scannedAt: z.string().min(1),
  outRoot: z.string().min(1),
  gameplayRoot: z.string().min(1),
  records: z.array(EvidenceRecordSchema),
  skipped: z.array(z.strictObject({ path: PathRow, why: z.string().min(1) })),
  truncated: z.array(z.strictObject({ path: PathRow, bytes: CountSchema, budget: CountSchema })),
  scanned: z.array(z.strictObject({ path: PathRow, size: CountSchema, mtimeMs: z.number().nonnegative() })),
});
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;

export type EvidenceSnapshotResult =
  | { readonly ok: true; readonly snapshot: EvidenceSnapshot }
  | { readonly ok: false; readonly message: string };

/** Parses a staged evidence snapshot, or says what is wrong with it in one sentence. */
export function readEvidenceSnapshot(value: unknown, source: string): EvidenceSnapshotResult {
  const parsed = EvidenceSnapshotSchema.safeParse(value);
  if (parsed.success) return { ok: true, snapshot: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : ` at \`${issue.path.join('.')}\``;
  const why = issue?.message ?? 'did not match the staged evidence schema';
  return {
    ok: false,
    message: `${source} is not a staged evidence snapshot this build can read${where}: ${why}. Re-run \`npm run play\`.`,
  };
}

export type EvidenceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: EvidenceSnapshot }
  | { readonly status: 'absent' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * The records about one subject, or every record when the page has no
 * selection to scope by. The key is compared exactly: `XMP` and `xmp` are two
 * strings, and the writer of each artifact chose its own case on purpose.
 */
export function recordsFor(snapshot: EvidenceSnapshot, subjectKey: string | null): readonly EvidenceRecord[] {
  if (subjectKey === null) return snapshot.records;
  return snapshot.records.filter((record) => record.subject.id === subjectKey);
}
