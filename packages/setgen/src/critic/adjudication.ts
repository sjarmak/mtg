/**
 * Pure helpers behind `tools/adjudicate.ts`, kept out of that file so the
 * argument parsing, resume logic and answer construction are testable without
 * a terminal. The file that actually talks to a human is intentionally thin
 * (`readline` calls and nothing else worth a unit test) — the same split
 * `../cli.ts` uses for `parseArgs`/`loadBrief`/`formatPins`.
 */
import { isAbsolute, resolve } from 'node:path';
import type { AdjudicationAnswer, AdjudicationFile } from './records';
import type { SampledEntry } from './sample';

export interface AdjudicateOptions {
  readonly seed: string;
  readonly size: number;
  readonly outPath: string;
  readonly rater?: string;
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

export function parseAdjudicateArgs(
  argv: readonly string[],
  defaultSeed: string,
  defaultSize: number,
  defaultOutPath: (seed: string) => string,
): AdjudicateOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) continue;
    values.set(key, next);
    index += 1;
  }

  const seed = values.get('seed') ?? defaultSeed;
  const sizeRaw = values.get('size') ?? String(defaultSize);
  const size = Number(sizeRaw);
  if (!Number.isInteger(size) || size <= 0)
    throw new Error(`--size must be a positive integer, got ${sizeRaw}`);
  const rater = values.get('rater');
  const out = values.get('out') ?? defaultOutPath(seed);
  return { seed, size, outPath: absolute(out), ...(rater === undefined ? {} : { rater }) };
}

/** Slot ids already answered in a resumed file. */
export function answeredSlotIds(file: AdjudicationFile): ReadonlySet<string> {
  return new Set(file.answers.map((answer) => answer.slotId));
}

/** Sampled entries still needing a human answer, in their original drawn order. */
export function pendingEntries(
  sample: readonly SampledEntry[],
  file: AdjudicationFile,
): readonly SampledEntry[] {
  const done = answeredSlotIds(file);
  return sample.filter((sampled) => !done.has(sampled.entry.slot.id));
}

/** Appends one answer, immutably; the file this session is resuming is never mutated in place. */
export function recordAnswer(file: AdjudicationFile, answer: AdjudicationAnswer): AdjudicationFile {
  return { ...file, answers: [...file.answers, answer] };
}
