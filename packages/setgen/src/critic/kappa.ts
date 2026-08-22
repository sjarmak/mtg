/**
 * Cohen's kappa: inter-rater agreement between two categorical raters,
 * corrected for the agreement chance alone would produce.
 *
 *   κ = (p_o - p_e) / (1 - p_e)
 *
 * `p_o` is the fraction of items both raters gave the same label; `p_e` is
 * the fraction they would be expected to agree on if each rated independently
 * according to their own marginal label frequencies. This module computes
 * both from a list of paired ratings and is generic over the label alphabet,
 * so it serves the tri-state faithfulness scale (`./rubric.ts`) without
 * hard-coding it.
 *
 * This module is deliberately not wired to any real adjudication data by this
 * change. `mtg-bc2.152.9` forbids computing an actual κ in this session — that
 * requires the playtester's genuine, independent judgment on the held-out sample,
 * which cannot be simulated or fabricated without producing a worthless
 * number. What is tested here is the arithmetic alone, against known worked
 * examples and edge cases; see `../../test/critic/kappa.test.ts`.
 */

export interface RatingPair {
  /** What the pair is about, for a confusion-matrix breakdown or an error message. */
  readonly itemId: string;
  readonly a: string;
  readonly b: string;
}

export interface KappaResult {
  readonly kappa: number;
  readonly observedAgreement: number;
  readonly expectedAgreement: number;
  readonly n: number;
  readonly labels: readonly string[];
  /** `matrix.get(labelA)?.get(labelB)` — count of items rater A called `labelA` and B called `labelB`. */
  readonly confusionMatrix: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export function cohensKappa(pairs: readonly RatingPair[]): KappaResult {
  if (pairs.length === 0) throw new Error('cohensKappa needs at least one rated pair');

  const labels = [...new Set(pairs.flatMap((pair) => [pair.a, pair.b]))].sort();
  const matrix = new Map<string, Map<string, number>>(labels.map((label) => [label, new Map()]));
  const aTotals = new Map<string, number>(labels.map((label) => [label, 0]));
  const bTotals = new Map<string, number>(labels.map((label) => [label, 0]));

  for (const pair of pairs) {
    const row = matrix.get(pair.a);
    if (row === undefined) throw new Error(`unreachable: label "${pair.a}" missing its confusion-matrix row`);
    row.set(pair.b, (row.get(pair.b) ?? 0) + 1);
    aTotals.set(pair.a, (aTotals.get(pair.a) ?? 0) + 1);
    bTotals.set(pair.b, (bTotals.get(pair.b) ?? 0) + 1);
  }

  const n = pairs.length;
  const observedAgreement = pairs.filter((pair) => pair.a === pair.b).length / n;

  let expectedAgreement = 0;
  for (const label of labels) {
    expectedAgreement += ((aTotals.get(label) ?? 0) / n) * ((bTotals.get(label) ?? 0) / n);
  }

  // p_e = 1 only when every rating from both raters is the one same label —
  // there is then nothing left for chance to explain, and p_o is 1 too (the
  // only possible pairing is a match), so the honest value is perfect
  // agreement rather than the undefined 0/0 the formula would otherwise give.
  const kappa =
    expectedAgreement === 1 ? 1 : (observedAgreement - expectedAgreement) / (1 - expectedAgreement);

  return {
    kappa,
    observedAgreement,
    expectedAgreement,
    n,
    labels,
    confusionMatrix: matrix,
  };
}
