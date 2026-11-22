/**
 * The paired-campaign families: a directory holding `plan.json`, usually
 * `comparison.json`, sometimes `decision.json`, and a `trials.jsonl` that can
 * run to hundreds of megabytes.
 *
 * Three roots share this shape and are told apart by the plan's own version:
 * `out/isd-<stage>-holdout-v<n>/` and `out/legacy-cube-stage-tuning-v<n>/<builder or draft>/`
 * write `stage-strength-campaign-plan/v1`, and `out/bot-strength/<campaign>/` writes
 * `bot-strength-campaign-plan/v1`. The plan names the subjects (one per
 * format) and schedules units against each; the comparison states completion
 * per arm for the whole campaign and independent units per format; the
 * trials file holds one episode per row.
 *
 * Identity never comes from the trials. When `comparison.json` exists the
 * record is built from it and the trials are not opened; when it is absent
 * (a campaign that was interrupted, or is still running) the caller streams
 * the trials through `tallyTrial` under its byte budget and finishes the
 * record with `recordsFromTally`. A campaign over two formats yields two
 * records, one per join key, because a reader who selected `akh-hou` is owed
 * the campaigns that measured it and not only the ones that measured it alone.
 *
 * Each trial row's episode is validated through `BotEvidenceEpisodeSchema`'s
 * own `episode` and `outcome` members, reached by `.shape` because `.pick()`
 * throws on a refined object under zod 4. The refinements therefore still run
 * here, in Node, and the browser is handed the summary. The call that hands
 * `summarizeEpisode` a validated episode is also the compile-time check that
 * `EpisodeProjection` in `../src/routes/analysis/evidence-record.ts` still
 * names that schema's fields: that module imports nothing from
 * `@mtg/bot-evidence`, so a rename there fails here rather than in a browser.
 */
import { z } from 'zod';
import { BotEvidenceEpisodeSchema } from '@mtg/bot-evidence';
import { summarizeEpisode } from '../src/routes/analysis/evidence-record';
import type {
  ArmCount,
  EpisodeIdentitySummary,
  EvidenceRecord,
} from '../src/routes/analysis/evidence-record';
import { issueSentence, skip, subjectFor } from './ledger-families';
import type { FamilyRead, ReadContext } from './ledger-families';

const IdSchema = z.string().min(1);
const PolicySchema = z.object({ policyId: IdSchema });

const PlanSchema = z.object({
  version: z.enum(['stage-strength-campaign-plan/v1', 'bot-strength-campaign-plan/v1']),
  id: IdSchema,
  split: IdSchema,
  subjects: z.array(z.object({ id: IdSchema })).optional(),
  formats: z.array(z.object({ id: IdSchema })).optional(),
  policies: z.object({ baseline: PolicySchema, candidate: PolicySchema }),
  schedule: z.array(z.object({ subjectId: IdSchema.optional(), formatId: IdSchema.optional() })),
});
type Plan = z.infer<typeof PlanSchema>;

const CompletionSchema = z.object({
  attempted: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});
const UnitsBySubjectSchema = z.array(
  z.object({ id: IdSchema, independentUnits: z.number().int().nonnegative() }),
);

const ComparisonSchema = z.object({
  version: z.enum(['stage-strength-comparison/v1', 'bot-strength-comparison/v1']),
  completion: z.object({ baseline: CompletionSchema, candidate: CompletionSchema }),
  promotion: z.object({ status: IdSchema }),
  strength: z.object({
    independentUnits: z.number().int().nonnegative(),
    byFormat: UnitsBySubjectSchema.optional(),
    bySegment: z
      .array(
        z.object({ dimension: IdSchema, id: IdSchema, independentUnits: z.number().int().nonnegative() }),
      )
      .optional(),
  }),
});
type Comparison = z.infer<typeof ComparisonSchema>;

const DecisionSchema = z.object({
  version: z.literal('legacy-cube-tuning-decision/v1'),
  decision: IdSchema,
});

export const TrialRowSchema = z.object({
  unitId: IdSchema,
  arm: z.enum(['baseline', 'candidate']),
  episode: z.object({
    schemaVersion: z.literal(1),
    episode: BotEvidenceEpisodeSchema.shape.episode,
    outcome: BotEvidenceEpisodeSchema.shape.outcome,
  }),
});
export type TrialRow = z.infer<typeof TrialRowSchema>;

export interface StageStrengthFiles {
  readonly plan: unknown;
  readonly comparison: unknown | null;
  readonly decision: unknown | null;
}

export type StageStrengthRead =
  FamilyRead | { readonly kind: 'needs-trials'; readonly partials: readonly EvidenceRecord[] };

function familyOf(plan: Plan): EvidenceRecord['family'] {
  return plan.version === 'bot-strength-campaign-plan/v1' ? 'bot-strength' : 'stage-strength';
}

function subjectIds(plan: Plan): readonly string[] {
  return (plan.subjects ?? plan.formats ?? []).map((subject) => subject.id);
}

function scheduledUnits(plan: Plan, subjectId: string): number {
  return plan.schedule.filter((entry) => (entry.subjectId ?? entry.formatId) === subjectId).length;
}

/** Independent units the comparison states for one subject, or null when it states none. */
function unitsFor(comparison: Comparison, subjectId: string, subjects: number): number | null {
  if (subjects === 1) return comparison.strength.independentUnits;
  const byFormat = comparison.strength.byFormat?.find((entry) => entry.id === subjectId);
  if (byFormat !== undefined) return byFormat.independentUnits;
  const bySegment = comparison.strength.bySegment?.find(
    (entry) => entry.dimension === 'format' && entry.id === subjectId,
  );
  return bySegment === undefined ? null : bySegment.independentUnits;
}

function partialRecord(context: ReadContext, plan: Plan, subjectId: string): EvidenceRecord {
  return {
    family: familyOf(plan),
    path: context.path,
    version: plan.version,
    subject: subjectFor(subjectId, null),
    matchup: `${plan.policies.candidate.policyId} vs ${plan.policies.baseline.policyId}`,
    produced: context.modified,
    evidence: {
      strength: 'games',
      trials: { attempted: scheduledUnits(plan, subjectId), completed: 0 },
      arms: null,
      source: 'trials-stream',
      episode: null,
      status: null,
    },
  };
}

function withComparison(
  partial: EvidenceRecord,
  comparison: Comparison,
  subjects: number,
  decision: string | null,
): EvidenceRecord | null {
  if (partial.evidence.strength !== 'games') return null;
  const completed = unitsFor(comparison, partial.subject.id, subjects);
  if (completed === null) return null;
  const status =
    decision === null ? comparison.promotion.status : `${comparison.promotion.status}, decided ${decision}`;
  return {
    ...partial,
    evidence: {
      ...partial.evidence,
      trials: { attempted: partial.evidence.trials.attempted, completed },
      arms:
        subjects === 1
          ? { baseline: comparison.completion.baseline, candidate: comparison.completion.candidate }
          : null,
      source: 'comparison',
      status,
    },
  };
}

/**
 * A campaign directory, from its metadata alone. `records` when the comparison
 * is present, `needs-trials` with one partial per subject when it is not, or a
 * skip naming the file and field that refused.
 */
export function readStageStrengthDir(context: ReadContext, files: StageStrengthFiles): StageStrengthRead {
  const plan = PlanSchema.safeParse(files.plan);
  if (!plan.success) return skip(context.path, `plan.json ${issueSentence(plan.error)}`);
  const subjects = subjectIds(plan.data);
  if (subjects.length === 0)
    return skip(context.path, 'plan.json names no subject, so its evidence is about nothing selectable');
  const partials = subjects.map((subjectId) => partialRecord(context, plan.data, subjectId));
  if (files.comparison === null) return { kind: 'needs-trials', partials };
  const comparison = ComparisonSchema.safeParse(files.comparison);
  if (!comparison.success) return skip(context.path, `comparison.json ${issueSentence(comparison.error)}`);
  let decision: string | null = null;
  if (files.decision !== null) {
    const parsed = DecisionSchema.safeParse(files.decision);
    if (!parsed.success) return skip(context.path, `decision.json ${issueSentence(parsed.error)}`);
    decision = parsed.data.decision;
  }
  const records: EvidenceRecord[] = [];
  for (const partial of partials) {
    const record = withComparison(partial, comparison.data, subjects.length, decision);
    if (record === null) {
      return skip(context.path, `comparison.json states no independent units for ${partial.subject.id}`);
    }
    records.push(record);
  }
  return { kind: 'records', records };
}

/** Per-subject counts accumulated while streaming a trials file. */
export interface TrialTally {
  readonly arms: { baseline: ArmCount; candidate: ArmCount };
  /** Per unit, whether each arm finished, so a completed unit is one both arms finished. */
  readonly units: Map<string, { baseline: boolean; candidate: boolean }>;
  episode: EpisodeIdentitySummary | null;
}

export function emptyTally(): TrialTally {
  return {
    arms: { baseline: { attempted: 0, completed: 0 }, candidate: { attempted: 0, completed: 0 } },
    units: new Map(),
    episode: null,
  };
}

/** Folds one parsed trial row into the tally for its episode's format. */
export function tallyTrial(tallies: Map<string, TrialTally>, row: TrialRow): void {
  const formatId = row.episode.episode.subject.formatId;
  const tally = tallies.get(formatId) ?? emptyTally();
  tallies.set(formatId, tally);
  const finished = row.episode.outcome.status === 'completed';
  const arm = tally.arms[row.arm];
  arm.attempted += 1;
  if (finished) arm.completed += 1;
  const unit = tally.units.get(row.unitId) ?? { baseline: false, candidate: false };
  unit[row.arm] = unit[row.arm] || finished;
  tally.units.set(row.unitId, unit);
  tally.episode ??= summarizeEpisode(row.episode.episode);
}

/** Finishes each partial from what the stream tallied for its subject; an untallied subject keeps zero. */
export function recordsFromTally(
  partials: readonly EvidenceRecord[],
  tallies: ReadonlyMap<string, TrialTally>,
): EvidenceRecord[] {
  return partials.map((partial) => {
    const tally = tallies.get(partial.subject.id);
    if (tally === undefined || partial.evidence.strength !== 'games') return partial;
    const completed = [...tally.units.values()].filter((unit) => unit.baseline && unit.candidate).length;
    return {
      ...partial,
      evidence: {
        ...partial.evidence,
        trials: { attempted: Math.max(partial.evidence.trials.attempted, tally.units.size), completed },
        arms: { baseline: { ...tally.arms.baseline }, candidate: { ...tally.arms.candidate } },
        episode: tally.episode,
      },
    };
  });
}
