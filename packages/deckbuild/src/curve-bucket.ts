/**
 * Curve buckets: mana value 0-5 map to themselves, everything 6 and above
 * collapses into the top bucket. Limited curve discussion is always framed in
 * these buckets ("mass at 2-4, two or three cards at 5+"), so the deck builder
 * targets and reports in them rather than in raw mana values.
 */
export const CURVE_BUCKETS = [0, 1, 2, 3, 4, 5, 6] as const;

export type CurveBucket = (typeof CURVE_BUCKETS)[number];

/** The bucket that also absorbs every higher mana value. */
export const TOP_CURVE_BUCKET: CurveBucket = 6;

/** A count per bucket: used for both the target curve and the achieved curve. */
export type CurveHistogram = Readonly<Record<CurveBucket, number>>;

/** Maps a mana value onto its bucket, collapsing 6+ into the top bucket. */
export function curveBucket(manaValue: number): CurveBucket {
  if (!Number.isFinite(manaValue) || manaValue < 0) {
    throw new Error(`curveBucket: mana value must be a non-negative number, got ${manaValue}`);
  }
  const floored = Math.floor(manaValue);
  if (floored >= TOP_CURVE_BUCKET) return TOP_CURVE_BUCKET;
  // Narrowing is safe: floored is an integer in [0, TOP_CURVE_BUCKET).
  return CURVE_BUCKETS[floored] ?? 0;
}

/** Human label for a bucket; the top bucket prints as `6+`. */
export function curveBucketLabel(bucket: CurveBucket): string {
  return bucket === TOP_CURVE_BUCKET ? `${TOP_CURVE_BUCKET}+` : String(bucket);
}

/** An all-zero histogram; callers accumulate into a copy of it. */
export function emptyCurveHistogram(): Record<CurveBucket, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

/** Total cards described by a histogram. */
export function curveTotal(histogram: CurveHistogram): number {
  return CURVE_BUCKETS.reduce<number>((sum, bucket) => sum + histogram[bucket], 0);
}
