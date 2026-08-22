/**
 * The two primitives every authored mark on this frame is written in.
 *
 * They lived in `./anatomy.ts` beside their first caller and moved here when
 * `./set-seal.ts` became a second one. A copy in each file would have been
 * cheaper to type and is the thing that goes wrong: `coord`'s precision is not
 * a formatting preference, it is what makes a re-render diff to nothing, and
 * two of it would drift the first time one side was tuned. One file, imported
 * twice.
 */

/** Path coordinates: fixed precision, no trailing zeros, so a re-render diffs to nothing. */
export function coord(value: number): string {
  const fixed = value.toFixed(3);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** A closed polygon through the points given, in order. */
export function polygon(points: readonly (readonly [number, number])[]): string {
  return `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${coord(x)} ${coord(y)}`).join(' ')} Z`;
}
