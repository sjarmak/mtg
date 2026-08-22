/**
 * Plan surgery: the small, shared edits a group plan takes when a later pass
 * has to move a card from one side of the group to the other.
 *
 * Two passes do this. Archetype reservation converts a battlefield-inert spell
 * slot into a body so a color pair is playable; required-card reservation
 * converts whichever side has room into the kind the brief named. Both have to
 * keep the group internally consistent - `allocateGroup` throws when the curve
 * stops summing to the creature count - and both have to keep keyword density
 * on the profile's own ratio rather than letting it drift with the body count.
 *
 * Nothing here decides *whether* to move a card. That judgment belongs to the
 * pass; this is the arithmetic.
 */
import type { CurveBucket, SliceKeywordBudget } from '@mtg/design-data';
import { roundHalfUp } from '@mtg/design-data';
import { apportion } from '@mtg/dsl';

export interface CurveChange {
  readonly curve: readonly CurveBucket[];
  /** The bucket the body was added to or taken from, as `min-max`. */
  readonly label: string;
}

/** Adds one body at a mana value, widening the curve when no bucket covers it. */
export function addToCurve(curve: readonly CurveBucket[], manaValue: number): CurveChange {
  const index = curve.findIndex((bucket) => manaValue >= bucket.mvMin && manaValue <= bucket.mvMax);
  const existing = index < 0 ? undefined : curve[index];
  if (existing !== undefined) {
    return {
      curve: curve.map((item, position) => (position === index ? { ...item, count: item.count + 1 } : item)),
      label: `${existing.mvMin}-${existing.mvMax}`,
    };
  }
  const created: CurveBucket = { mvMin: manaValue, mvMax: manaValue, count: 1 };
  return {
    curve: [...curve, created].sort((a, b) => a.mvMin - b.mvMin || a.mvMax - b.mvMax),
    label: `${manaValue}-${manaValue}`,
  };
}

/**
 * Takes one body out of the fullest bucket, dearest bucket first on a tie.
 *
 * The fullest bucket is the one whose shape survives losing a card best, and
 * breaking the tie toward the top of the curve keeps the cheap end - the part
 * of the curve a Limited format is decided on - intact longest. Returns
 * `undefined` when the group has no body to give, which is the caller's signal
 * to stop rather than to build an inconsistent plan.
 */
export function dropFromCurve(curve: readonly CurveBucket[]): CurveChange | undefined {
  let index = -1;
  let best: CurveBucket | undefined;
  for (const [position, bucket] of curve.entries()) {
    if (bucket.count < 1) continue;
    if (
      best === undefined ||
      bucket.count > best.count ||
      (bucket.count === best.count && bucket.mvMin > best.mvMin)
    ) {
      index = position;
      best = bucket;
    }
  }
  if (best === undefined) return undefined;
  return {
    curve: curve.map((item, position) => (position === index ? { ...item, count: item.count - 1 } : item)),
    label: `${best.mvMin}-${best.mvMax}`,
  };
}

/** Keeps keyword density on the profile's own creature ratio as bodies move. */
export function rescaleKeywords(
  keywords: readonly SliceKeywordBudget[],
  fromCreatures: number,
  toCreatures: number,
): readonly SliceKeywordBudget[] {
  const weights = keywords.map((entry) => entry.count);
  const total = weights.reduce((sum, count) => sum + count, 0);
  if (total === 0 || fromCreatures <= 0) return keywords;
  const wanted = Math.min(toCreatures, roundHalfUp((total * toCreatures) / fromCreatures));
  const counts = apportion(wanted, weights);
  return keywords.map((entry, index) => ({ keyword: entry.keyword, count: counts[index] ?? 0 }));
}
