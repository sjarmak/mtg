/**
 * A number on its way into a stylesheet.
 *
 * The sheets in this directory are strings, and `uiStyleSheet()` hands the
 * assembled text to `createElement('style', …)`. So a `${…}` in one of them is
 * not a value inside a declaration — it is characters in live CSS. JavaScript
 * stringifies whatever it is handed and TypeScript constrains a template
 * placeholder not at all, which makes the interpolation sites a standing
 * injection primitive: a value carrying `}` closes its rule early and everything
 * after it is selectors and declarations nobody here wrote. `background:
 * url(…)` behind an attribute selector exfiltrates; a full-viewport rule
 * redresses the surface underneath it.
 *
 * Every value that reaches those sites today is an anatomy constant written out
 * in this repository, and the explicit `number` annotations in
 * `../card/anatomy.ts` are what keeps it that way at compile time: re-deriving
 * one of them from a string-typed source stops compiling at the declaration.
 * This is the other half — the check that still runs when a value arrives from
 * somewhere `tsc` could not see, such as a config read or a JSON parse that was
 * cast on the way through.
 *
 * It takes the value alone and nothing else, because a guard that costs a second
 * argument is a guard the next interpolation quietly skips; the throw's own
 * stack names the sheet and the line, and these literals are evaluated at module
 * load, so the failure is at import rather than at first paint.
 */

/**
 * The text of `value`, or a thrown error. `Number.isFinite` does not coerce, so
 * a string, `null`, an object and `NaN` all fail it — which is the point, since
 * those are what a laundered external value arrives as. It rejects rather than
 * sanitizes: a stylesheet number that is not a number is a bug in the caller and
 * there is no salvageable rendering of it.
 */
export function cssNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`css: expected a finite number, got ${typeof value} ${String(value)}`);
  }
  return String(value);
}
