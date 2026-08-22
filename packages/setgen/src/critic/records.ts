/**
 * On-disk shapes for the two independent records this bead produces, and
 * nothing else: the playtester's adjudication and the critic's own verdicts.
 *
 * Independent is the load-bearing word. `tools/adjudicate.ts` reads and writes
 * only `AdjudicationFile`; `tools/run-critic.ts` reads and writes only
 * `VerdictsFile`. Neither module imports the other's file format, so there is
 * no code path by which the adjudication tool could read a critic verdict
 * before recording her judgment — the contamination the dispatch brief warns
 * against is structurally unreachable rather than merely avoided by
 * discipline. `./agreement.ts` is the one module allowed to read both, and
 * only after each is complete.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CriterionVerdictSchema, FAITHFULNESS_CRITERIA, FAITHFULNESS_LABELS } from './rubric';

const NOTE_MAX = 240;

export const AdjudicationCriterionAnswerSchema = z.object({
  criterion: z.enum(FAITHFULNESS_CRITERIA),
  label: z.enum(FAITHFULNESS_LABELS),
  note: z.string().max(NOTE_MAX).optional(),
});
export type AdjudicationCriterionAnswer = z.infer<typeof AdjudicationCriterionAnswerSchema>;

export const AdjudicationAnswerSchema = z.object({
  slotId: z.string().min(1),
  cardName: z.string().min(1),
  position: z.int().min(1),
  criteria: z.array(AdjudicationCriterionAnswerSchema).min(1),
  overall: z.object({ label: z.enum(FAITHFULNESS_LABELS), note: z.string().max(NOTE_MAX).optional() }),
  answeredAt: z.string().min(1),
});
export type AdjudicationAnswer = z.infer<typeof AdjudicationAnswerSchema>;

export const AdjudicationFileSchema = z.object({
  seed: z.string().min(1),
  size: z.int().min(1),
  rater: z.string().min(1).optional(),
  answers: z.array(AdjudicationAnswerSchema),
});
export type AdjudicationFile = z.infer<typeof AdjudicationFileSchema>;

export function emptyAdjudicationFile(seed: string, size: number, rater?: string): AdjudicationFile {
  return { seed, size, ...(rater === undefined ? {} : { rater }), answers: [] };
}

/** Absent file reads as an empty one — a fresh adjudication session, not an error. */
export function loadAdjudicationFile(path: string, seed: string, size: number): AdjudicationFile {
  if (!existsSync(path)) return emptyAdjudicationFile(seed, size);
  const parsed = AdjudicationFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (parsed.seed !== seed || parsed.size !== size) {
    throw new Error(
      `${path} was built with seed "${parsed.seed}" size ${parsed.size}, not seed "${seed}" size ${size}: ` +
        'resuming against a different sample would silently mix two draws',
    );
  }
  return parsed;
}

export function saveAdjudicationFile(path: string, file: AdjudicationFile): void {
  AdjudicationFileSchema.parse(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export const VerdictRecordSchema = z.object({
  slotId: z.string().min(1),
  cardName: z.string().min(1),
  position: z.int().min(1),
  /** Absent when the critic call failed; `error` names why. */
  criteria: z.array(CriterionVerdictSchema).optional(),
  overall: z.object({ label: z.enum(FAITHFULNESS_LABELS), reason: z.string().min(1) }).optional(),
  error: z.string().optional(),
});
export type VerdictRecord = z.infer<typeof VerdictRecordSchema>;

export const VerdictsFileSchema = z.object({
  seed: z.string().min(1),
  size: z.int().min(1),
  recordedAt: z.string().min(1),
  results: z.array(VerdictRecordSchema),
});
export type VerdictsFile = z.infer<typeof VerdictsFileSchema>;

export function loadVerdictsFile(path: string): VerdictsFile {
  return VerdictsFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function saveVerdictsFile(path: string, file: VerdictsFile): void {
  VerdictsFileSchema.parse(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}
