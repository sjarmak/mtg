/** Deterministic greedy seed selection for residual printed-card coverage. */
import { z } from 'zod';

export type PrintedObservedMode = 'draft' | 'sealed';

const ObservedSeedPlanSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('printed-observed-seed-plan'),
  mode: z.enum(['draft', 'sealed']),
  selected: z
    .array(z.object({ seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }))
    .min(1)
    .max(100),
});

export interface PrintedCoverageCandidate {
  readonly seed: number;
  readonly deckPrintingIds: readonly string[];
  readonly poolPrintingIds: readonly string[];
}

export interface PrintedCoverageBaseline {
  readonly deckPrintingIds: readonly string[];
  readonly poolPrintingIds: readonly string[];
}

export interface SelectedPrintedCoverageCandidate extends PrintedCoverageCandidate {
  readonly newDeckPrintings: number;
  readonly newPoolPrintings: number;
}

function gain(values: readonly string[], covered: ReadonlySet<string>): number {
  return new Set(values.filter((value) => !covered.has(value))).size;
}

export function observedSeedsFromPlan(input: unknown, expectedMode: PrintedObservedMode): readonly number[] {
  const plan = ObservedSeedPlanSchema.parse(input);
  if (plan.mode !== expectedMode)
    throw new Error(`Observed seed plan mode mismatch: expected ${expectedMode}, received ${plan.mode}`);
  const seeds = plan.selected.map(({ seed }) => seed);
  if (new Set(seeds).size !== seeds.length)
    throw new Error('Observed seed plan selected seeds must be unique');
  return seeds;
}

/**
 * Uses the standard greedy set-cover approximation. Deck exposure wins ties in
 * substance because a printing in a pool cannot exercise a Forge interaction;
 * pool exposure and ascending seed provide stable secondary ordering.
 */
export function selectCoverageSeeds(
  candidates: readonly PrintedCoverageCandidate[],
  baseline: PrintedCoverageBaseline,
  count: number,
): readonly SelectedPrintedCoverageCandidate[] {
  if (!Number.isInteger(count) || count < 1 || count > candidates.length)
    throw new Error('Coverage seed count must be a positive integer within the candidate set');
  if (new Set(candidates.map((candidate) => candidate.seed)).size !== candidates.length)
    throw new Error('Coverage candidate seeds must be unique');

  const coveredDeck = new Set(baseline.deckPrintingIds);
  const coveredPool = new Set(baseline.poolPrintingIds);
  let remaining = [...candidates];
  const selected: SelectedPrintedCoverageCandidate[] = [];

  while (selected.length < count) {
    const ranked = remaining
      .map((candidate) => ({
        ...candidate,
        newDeckPrintings: gain(candidate.deckPrintingIds, coveredDeck),
        newPoolPrintings: gain(candidate.poolPrintingIds, coveredPool),
      }))
      .sort(
        (left, right) =>
          right.newDeckPrintings - left.newDeckPrintings ||
          right.newPoolPrintings - left.newPoolPrintings ||
          left.seed - right.seed,
      );
    const best = ranked[0]!;
    selected.push(best);
    best.deckPrintingIds.forEach((id) => coveredDeck.add(id));
    best.poolPrintingIds.forEach((id) => coveredPool.add(id));
    remaining = remaining.filter((candidate) => candidate.seed !== best.seed);
  }

  return selected;
}
