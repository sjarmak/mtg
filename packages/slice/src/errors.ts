/**
 * Stage attribution.
 *
 * The slice is a chain of six stages, and a chain is only useful if a break in
 * it names itself. Every failure that escapes a stage is wrapped in a
 * `SliceStageError` carrying the stage id, so the operator never has to read a
 * stack trace to learn which link went. Nothing here recovers from anything:
 * a stage that cannot produce its output ends the run rather than handing the
 * next stage a default, because a deck built from a set that failed validation
 * would produce win rates nobody chose to measure.
 */

export const SLICE_STAGES = ['setgen', 'deckbuild', 'sim', 'metrics', 'bench', 'forge'] as const;

export type SliceStage = (typeof SLICE_STAGES)[number];

export const STAGE_LABELS: Readonly<Record<SliceStage, string>> = {
  setgen: 'set generation (LLM slot-fill + DSL validators + critique)',
  deckbuild: 'deck construction (deterministic pool -> 40-card decks)',
  sim: 'seeded mass simulation',
  metrics: 'format-health metrics and gates',
  bench: 'kernel throughput and fork-cost measurement',
  forge: 'Forge boot gate (conformance oracle)',
};

/** A failure attributed to exactly one stage of the loop. */
export class SliceStageError extends Error {
  override readonly name = 'SliceStageError';
  readonly stage: SliceStage;
  readonly reason: string;

  constructor(stage: SliceStage, reason: string, options?: { readonly cause?: unknown }) {
    super(`stage "${stage}" failed: ${reason}`, options === undefined ? undefined : { cause: options.cause });
    this.stage = stage;
    this.reason = reason;
  }
}

export function isSliceStageError(error: unknown): error is SliceStageError {
  return error instanceof SliceStageError;
}

/** Ends the run, naming the stage and the reason. */
export function failStage(stage: SliceStage, reason: string, cause?: unknown): never {
  throw new SliceStageError(stage, reason, cause === undefined ? undefined : { cause });
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Runs one stage. Anything the stage throws that is not already attributed gets
 * attributed here; an already-attributed error passes through untouched so the
 * innermost stage keeps the blame.
 */
export async function runStage<T>(stage: SliceStage, body: () => Promise<T> | T): Promise<T> {
  try {
    return await body();
  } catch (error: unknown) {
    if (isSliceStageError(error)) throw error;
    throw new SliceStageError(stage, describe(error), { cause: error });
  }
}
