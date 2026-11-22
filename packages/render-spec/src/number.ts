/**
 * A value on its way into a stylesheet: a number, a selector, a block.
 *
 * The stylesheets in `@mtg/ui`'s `styles/` are strings, and `uiStyleSheet()`
 * hands the assembled text to `createElement('style', …)`. So a `${…}` in one
 * of them is not a value inside a declaration — it is characters in live CSS.
 * JavaScript stringifies whatever it is handed and TypeScript constrains a
 * template placeholder not at all, which makes the interpolation sites a
 * standing injection primitive: a value carrying `}` closes its rule early and
 * everything after it is selectors and declarations nobody here wrote.
 * `background: url(…)` behind an attribute selector exfiltrates; a
 * full-viewport rule redresses the surface underneath it.
 *
 * Every value that reaches those sites today is an anatomy constant written out
 * in this repository, and the explicit `number` annotations in
 * `./anatomy.ts` are what keeps it that way at compile time: re-deriving
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

/**
 * A selector on its way into a stylesheet.
 *
 * `scopedPalette` and `viewportScheme` interpolate a selector and two blocks of
 * declarations, which is the same injection primitive one shape up: a `}` in
 * any of the three closes the rule early and what follows is a selector block
 * nobody wrote. `mtg-bc2.109` filed it as latent rather than live, because the
 * only caller is a registry of literals in the same file, and latent is a fact
 * about today's callers rather than about the function.
 *
 * A selector is a small vocabulary and there is no reason to accept more of it
 * than the sheet uses: names, classes, ids, attribute selectors, the
 * combinators, and the pseudo-class forms `routeScope` and `viewportScheme`
 * build. Braces, semicolons, at-rules and comments are not in it.
 */
export function cssSelector(selector: string): string {
  if (typeof selector !== 'string' || selector.trim() === '') {
    throw new Error(`css: expected a selector, got ${typeof selector} ${String(selector)}`);
  }
  if (!/^[\w\s.#[\]='"^$*|~():>+-]+$/u.test(selector)) {
    throw new Error(`css: selector holds a character a selector cannot: ${selector}`);
  }
  return selector;
}

/**
 * A block of declarations on its way between a rule's braces.
 *
 * It refuses a brace outright rather than escaping one, for the reason
 * `cssNumber` refuses a non-number: a declaration block that opens a rule is a
 * bug in the caller and there is no salvageable rendering of it. Comments are
 * allowed because palettes carry them and `nativeDeclarations` already strips
 * them; an unterminated one is refused, since it would swallow the closing
 * brace this function was called to protect.
 */
export function cssBlock(block: string): string {
  if (typeof block !== 'string') {
    throw new Error(`css: expected a declaration block, got ${typeof block} ${String(block)}`);
  }
  if (block.includes('{') || block.includes('}')) {
    throw new Error(`css: a declaration block may not open or close a rule: ${block.trim().slice(0, 60)}`);
  }
  const opened = block.split('/*').length - 1;
  if (opened !== block.split('*/').length - 1) {
    throw new Error(`css: a declaration block holds an unterminated comment: ${block.trim().slice(0, 60)}`);
  }
  return block;
}

/**
 * The Micro-Label Rule as one declaration rather than twenty-one copies.
 *
 * Twenty-one rules in five stylesheet modules label a region the same way --
 * extra-small, semibold, uppercase, tracked a little wider so the caps do not
 * jam. They agreed on the four values and on nothing else: the declarations
 * arrived in four different orders, split across one line or two, so a sweep
 * looking for the rule had to read every ordering rather than one string. What
 * a site still decides for itself is its ink, because that is the part that
 * carries meaning -- faint for a caption, muted for a thing the eye should
 * find, the pending amber for a frame with no art yet.
 *
 * Interpolate it; do not restate it. `polish.test.ts` asserts that every
 * uppercase rule in the emitted sheet came from here.
 */
export const MICRO_LABEL =
  'font-size: var(--mtg-text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;';
