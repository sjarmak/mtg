/**
 * How many distinct face heights a row drew, with the tolerance stated.
 *
 * `mtg-aud`. The invariant the board rigs assert is "one distinct face height
 * per seat per row", and on 2026-08-14 the opponent row of `uniformity-12` at
 * 1440x900 read two: 73.6 and 73.5, a spread of a tenth of a pixel. That is the
 * sub-pixel residue of a flex row handing out a fractional remainder, not the
 * ragged row the invariant exists to catch, and the rig was right to report it
 * because exact-value counting is what it did.
 *
 * Both rigs' docblocks already claimed the tolerance existed — "heights are
 * rounded to a tenth before they are counted distinct, so a sub-pixel
 * difference between two faces is not reported as two heights" — and rounding
 * to a tenth does not do that. It collapses differences below a hundredth of a
 * pixel. So the claim was true of a rule nobody had written. This is the rule.
 *
 * # Half a CSS pixel
 *
 * A difference below half a CSS pixel cannot move a drawn edge by a whole
 * device pixel at device-pixel-ratio 1, and moves it by at most one at ratio 2.
 * Nobody can see a row as ragged on that.
 *
 * The headroom is the other half of the argument, because a tolerance that
 * could hide the defect would be worse than no tolerance. The defect is
 * The playtester's, 2026-08-13: "some of the cards end up taller than the others but
 * I want them uniform". Measured, it is tens of pixels — `card-uniformity.ts`
 * records a seat's row of twelve at three heights, 138.2, 144.6 and 155.4, so
 * spreads of 6.4 and 10.8. Half a pixel sits more than an order of magnitude
 * under the smallest of those and two hundred times over the reading it is
 * here to absorb.
 *
 * # Anchored, not chained
 *
 * A cluster is measured from its own first member rather than from the value
 * before it, so a run of within-tolerance steps cannot walk a row of any spread
 * into one height: 73.5, 73.9, 74.3 is two heights, not one, because 74.3 is
 * 0.8 from the anchor even though it is 0.4 from its neighbor. A rule that
 * chained would let a genuinely ragged row of many faces report clean, which is
 * the failure a tolerance is most likely to introduce.
 *
 * # One source, two runtimes
 *
 * `distinctHeights` runs in Node, where this module's own test calls it, and in
 * the browser, where `card-uniformity.ts` and `hand-scale.ts` interpolate it
 * into their measuring script with `String(distinctHeights)`. A second copy
 * written out by hand is a second rule, and the one in the browser is the one
 * nothing can reach to check. So its body has to survive being read as plain
 * JavaScript with the types stripped off: nothing TypeScript-only inside it,
 * and no reference to anything outside its own parameters, because in the page
 * it is a function expression with no module around it.
 */

/** A face-height difference at or below this is one height. */
export const HEIGHT_TOLERANCE_PX = 0.5;

/**
 * Distinct heights among `values`, counting two as one when they are within
 * `tolerance` of the same cluster's first member. Zero for an empty row.
 */
export function distinctHeights(values: readonly number[], tolerance: number): number {
  const sorted = values.slice().sort(function (a, b) {
    return a - b;
  });
  let count = 0;
  let anchor = 0;
  for (const value of sorted) {
    if (count === 0 || value - anchor > tolerance) {
      count += 1;
      anchor = value;
    }
  }
  return count;
}
