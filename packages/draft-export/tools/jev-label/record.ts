/**
 * The study's record: one JSON line per Jev answer, appended as it arrives.
 *
 * A run makes about a thousand slow, rate-limited calls and can be stopped at
 * any of them, so the file is the resume point as well as the evidence. Each
 * line holds the exact request sent and the exact body received (`raw`), which
 * is what lets every number in the write-up be recomputed without calling Jev
 * again. A line that does not parse is an error, not a line to skip: a resume
 * that silently dropped an answer would spend a call to replace it and hide
 * that the file was damaged.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { EvaluateResponseSchema } from './jev-client';
import { QUESTION_ID } from './questions';

const AnswerRecordSchema = z
  .object({
    kind: z.literal('answer'),
    key: z.string().min(1),
    /** 0 is the study's own label; 1 and up are repeat calls on the same input. */
    repeat: z.number().int().min(0),
    podSeed: z.string().min(1),
    round: z.number().int().positive(),
    pickNumber: z.number().int().positive(),
    botPickId: z.string().min(1),
    packIds: z.array(z.string()).min(2),
    poolIds: z.array(z.string()),
    at: z.string(),
    latencyMs: z.number().min(0),
    request: z.unknown(),
    raw: z.unknown(),
  })
  .strict();

export const STOP_REASONS = ['done', 'cap', 'rate-limit', 'spend', 'budget', 'auth', 'error'] as const;

const StopRecordSchema = z
  .object({
    kind: z.literal('stop'),
    reason: z.enum(STOP_REASONS),
    at: z.string(),
    detail: z.string(),
    /** Gateway requests this run made, including any that failed. */
    requests: z.number().int().min(0),
    /** Answers this run recorded. */
    recorded: z.number().int().min(0),
    /** Cumulative charge or conservative spend bound across the record; absent before budgets existed. */
    spentUsd: z.number().min(0).optional(),
  })
  .strict();

const StoredRecordSchema = z.discriminatedUnion('kind', [AnswerRecordSchema, StopRecordSchema]);

export type AnswerRecord = z.infer<typeof AnswerRecordSchema>;
export type StopRecord = z.infer<typeof StopRecordSchema>;
export type StoredRecord = z.infer<typeof StoredRecordSchema>;
export type StopReason = (typeof STOP_REASONS)[number];

export function readRecords(path: string): readonly StoredRecord[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  return lines.flatMap((line, index) => {
    if (line.trim() === '') return [];
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${path} line ${String(index + 1)} is not JSON`);
    }
    const parsed = StoredRecordSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`${path} line ${String(index + 1)} is not a study record: ${parsed.error.message}`);
    }
    return [parsed.data];
  });
}

export function appendRecord(path: string, record: StoredRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export function answersOf(records: readonly StoredRecord[]): readonly AnswerRecord[] {
  return records.flatMap((record) => (record.kind === 'answer' ? [record] : []));
}

/** What one stored answer says, read back out of the raw body. */
export interface AnswerView {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number | null;
  /** The gateway's charge for the call, as a number; the free tier reports 0. NaN when it is absent or not a number. */
  readonly cost: number;
}

/** The gateway's stated charge for one stored answer; NaN when the body does not state one, because that cannot show it was free. */
export function answerCost(record: AnswerRecord): number {
  const parsed = EvaluateResponseSchema.parse(record.raw);
  // A body that does not state a charge cannot show it was free, so it reads as an unknown charge.
  const stated = parsed.providerMetadata?.['gateway']?.['cost'];
  const charge = stated === undefined || stated === null || stated === '' ? Number.NaN : Number(stated);
  return Number.isFinite(charge) ? charge : Number.NaN;
}

/**
 * What a record has already cost. Derived from the stored answers rather than
 * kept in a running total, so it cannot drift from the evidence and a resume
 * reloads it for free. `unknown` counts answers whose charge is not stated.
 */
export interface Spend {
  readonly totalUsd: number;
  /** The dearest single call so far: what the next call is assumed able to cost. */
  readonly peakUsd: number;
  readonly unknown: number;
}

export function spendOf(answers: readonly AnswerRecord[]): Spend {
  let totalUsd = 0;
  let peakUsd = 0;
  let unknown = 0;
  for (const record of answers) {
    const cost = answerCost(record);
    if (Number.isNaN(cost)) unknown += 1;
    else {
      totalUsd += cost;
      peakUsd = Math.max(peakUsd, cost);
    }
  }
  return { totalUsd, peakUsd, unknown };
}

export function answerView(record: AnswerRecord): AnswerView {
  const parsed = EvaluateResponseSchema.parse(record.raw);
  const answer = parsed.answers[QUESTION_ID];
  if (answer === undefined)
    throw new Error(`${record.key} (repeat ${String(record.repeat)}) has no ${QUESTION_ID} answer`);
  const probabilities = answer.probabilities;
  if (probabilities === undefined) {
    throw new Error(
      `${record.key} (repeat ${String(record.repeat)}) answered without per-option probabilities`,
    );
  }
  const confidences = parsed.providerMetadata?.['typesafe']?.['confidence'];
  const confidence =
    typeof confidences === 'object' && confidences !== null
      ? (confidences as Record<string, unknown>)[QUESTION_ID]
      : undefined;
  return {
    choice: answer.choice,
    probabilities,
    confidence: typeof confidence === 'number' ? confidence : null,
    cost: answerCost(record),
  };
}
