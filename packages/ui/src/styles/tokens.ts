/**
 * The route palettes: the blocks a single route re-values for itself, and the
 * rules that put them on the page.
 *
 * The palette they re-value is `@mtg/render-spec`'s `tokens.ts`, and this file
 * re-exports it, so nothing in this package changed module path when the halves
 * split (`mtg-ey09`). The split line is a route: `UI_MODES` is the app's own
 * list of tabs, and a printed card file has no tabs, so everything below needs
 * `../app/router` and nothing above it may.
 */
import { UI_MODES } from '../app/router';
import { cssBlock, cssSelector } from './number';
import { LIGHT_TOKENS, MAT_LIGHT_TOKENS } from '@mtg/render-spec';
import type { UiMode, UiSub } from '../app/router';

export {
  BOARD_SURFACE_TOKEN,
  COLOR_IDENTITIES,
  DARK_TOKENS,
  IDENTITY_LABELS,
  LIGHT_TOKENS,
  MAT_DARK_TOKENS,
  MAT_LIGHT_TOKENS,
  MAT_TOKEN_CSS,
  SCALE_TOKENS,
  TOKEN_CSS,
} from '@mtg/render-spec';
export type { ColorIdentity } from '@mtg/render-spec';

/**
 * The attribute the shell stamps with the route it is showing. Written once
 * here and read by `app/Shell.ts`, so the markup and the selector cannot end up
 * naming two different things.
 */
export const ROUTE_SCOPE_ATTRIBUTE = 'data-mtg-mode';

/** The selector matching the shell while it is showing `mode`. */
export function routeScope(mode: UiMode): string {
  return `[${ROUTE_SCOPE_ATTRIBUTE}='${mode}']`;
}

/**
 * The second attribute the shell stamps: which section of the mode it is
 * showing. A sheet that is about one section — the replay viewer's column, the
 * deck editor's phone rows — keys on the pair rather than on the mode, since
 * `mtg-a982g.1` made those sections of a destination rather than tabs.
 */
export const SUB_SCOPE_ATTRIBUTE = 'data-mtg-sub';

/** The selector matching the shell while it is showing `sub`, in any mode. */
export function subScope(sub: UiSub): string {
  return `[${SUB_SCOPE_ATTRIBUTE}='${sub}']`;
}

/**
 * The selector matching the shell while it is showing exactly `sub` of `mode`.
 *
 * The section half is wrapped in `:where()`, which contributes nothing to
 * specificity, so this selector weighs exactly what a bare `routeScope` does:
 * one attribute. That is load-bearing for `./board/geometry.ts`, whose `:is()`
 * list of fitted-board scopes takes the weight of its widest argument. When the
 * replay scope was the plain pair, every rule under that list gained an
 * attribute over the unscoped overrides written to tie with it, and a tapped
 * slot on the played table kept the printed trim instead of its square.
 */
export function viewScope(mode: UiMode, sub: UiSub): string {
  return `${routeScope(mode)}:where(${subScope(sub)})`;
}

/** A palette narrower than the document: the same token names, re-valued. */
export interface ScopedPalette {
  readonly light: string;
  readonly dark: string;
}

/**
 * The same three-way theme resolution `TOKEN_CSS` performs, under a selector
 * rather than at the document root: the bare selector carries light, and the
 * two dark blocks nest the root-level guards ahead of it so a viewer who pinned
 * light still gets light inside the scope.
 *
 * A scope's light block does not compete with `:root` at all, and the earlier
 * explanation that it ties on specificity and wins on order was wrong
 * (`mtg-bc2.108`, disproved in a real CSS engine rather than argued). `:root`
 * matches `html` and the scope matches the shell `div`, so the two are
 * declarations on different elements: the div's own value beats the value it
 * would otherwise inherit, at any source order, and a JSDOM probe reads the
 * scope's value identically with the sheet ordered either way.
 *
 * `uiStyleSheet()` still appends these after `TOKEN_CSS`, and `viewportScheme`
 * below is the reason. That rule lands on the root element, where it really
 * does tie with `TOKEN_CSS`'s own root guards and really does win on order
 * alone.
 */
export function scopedPalette(rawSelector: string, rawLight: string, rawDark: string): string {
  // Guarded rather than trusted (`mtg-bc2.109`): all three arguments land in
  // live CSS, and a `}` in any of them closes the rule early. The registry
  // below is literals in this file, which makes the hole latent; latent is a
  // fact about today's callers rather than about this function.
  const selector = cssSelector(rawSelector);
  const light = cssBlock(rawLight);
  const dark = cssBlock(rawDark);
  return `${selector} {${light}}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) ${selector} {${dark}}
}

:root[data-theme='dark'] ${selector} {${dark}}
`;
}

/**
 * The route palette: paper, for every viewer, in every theme.
 *
 * The whole light palette rather than a chosen subset of it, and that is the
 * decision rather than laziness. The mat holds cards, and a card's frame, its
 * pips, its seal and its ground come from the identity tokens, the surfaces and
 * the ink; the moves under it are buttons, which reach for the accent and its
 * hover and its disabled ground; a permanent's marks reach for positive,
 * negative and pending. Pinning the table to paper and leaving the cards on it
 * dark is not half a fix, it is a worse surface than either theme on its own, so
 * the route's palette travels as one thing.
 *
 * Written as the two light blocks themselves rather than as a copy of their
 * values: a copy is a second palette to keep level with the first by hand, and
 * a card whose identity the copy had never heard of would resolve to whatever
 * the document said, which on this route is the bug being fixed. The seven
 * `--mtg-frame-<identity>` fills ride along unused — `@mtg/card-render` is their
 * only consumer — because carrying the block whole is what makes the drift
 * impossible.
 *
 * Both blocks are the same text, which `scopedPalette` emits three times: the
 * bare selector, the dark-preference guard, and the pinned-dark guard. That is
 * the point. `packages/ui/test/tokens.test.ts` holds a scope to declaring the
 * same *names* in light and dark, not to declaring different values, and a route
 * that must not follow the viewer's theme is exactly the case where the same
 * values in both is the correct answer.
 */
const PAPER_PALETTE = `${LIGHT_TOKENS}${MAT_LIGHT_TOKENS}`;

/**
 * Routes that re-value tokens for themselves: all of them.
 *
 * `mtg-bc2.46` shipped the playmat as a recomposition of the document palette
 * and registered nothing here, which left a viewer whose system prefers dark
 * looking at a table that had never been reviewed: the dark half of the mat pair
 * is not a darker paper but the generic dark surface family's blue hue wearing
 * the mat's name. Registering the play route fixed the table and left the other
 * tabs following the system, on the reading that they are reading surfaces
 * and a person who set their machine to dark meant it about those. Looking at
 * the running app settled it the other way: the tabs are one app, the mockup
 * that was reviewed is hard-stamped `data-theme="light"`, and half a themed app
 * is a worse surface than either theme whole.
 *
 * Built from `UI_MODES` rather than written out entry by entry, because a list
 * of near-identical registrations is the shape where the sixth route is the one
 * nobody remembers: no test can miss a route that no source file names. The cost
 * of deriving it is that every future mode is paper by default and a mode that
 * wanted its own palette would have to say so here, which is the right way round
 * while the answer for every route is the same answer.
 *
 * A `Map` rather than a partial record because the sheet below iterates it and
 * a partial record's entries arrive as possibly-undefined, which would buy a
 * branch that can never run.
 */
export const SCOPED_PALETTES: ReadonlyMap<UiMode, ScopedPalette> = new Map(
  UI_MODES.map((mode) => [mode, { light: PAPER_PALETTE, dark: PAPER_PALETTE }]),
);

/**
 * The declarations in a palette block that are not custom properties.
 *
 * A palette is nearly all `--mtg-*` names, and those reach everything under the
 * block that declares them by inheriting, which is the whole of what a scope on
 * `.mtg-shell` has to do. `color-scheme` is the exception in both directions: it
 * is not a custom property, and the thing that reads it is not an element the
 * scope contains. It tells the browser which way round to draw the chrome the
 * sheet never touches — the scrollbar, the ground under a `<select>`, a date
 * field's own controls — and the *viewport's* scrollbar is drawn from the value
 * on the root element, one level above every scope.
 *
 * Lifted out of the palette rather than named here, so a route that stopped
 * being paper would take the chrome with it. Nothing filters to nothing, which
 * is the case a palette narrowed past this declaration would produce, and
 * `test/tokens.test.ts` fails a registered scope that hands the viewport an
 * empty rule.
 */
export function nativeDeclarations(block: string): string {
  return (
    block
      // A comment is not a declaration, and one holding a colon reads as one to
      // the filter below. A palette says why its values are what they are, so
      // this is a thing palettes contain rather than a hypothetical.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration.includes(':') && !declaration.startsWith('--'))
      .map((declaration) => `\n  ${declaration};`)
      .join('')
  );
}

/**
 * What a route hands the root element, under the same three-way resolution the
 * palettes get.
 *
 * `:has()` is the whole mechanism: a scope is registered on the shell, and this
 * is the one direction CSS lets a rule read the other way, so the root can ask
 * which route is on the page. Every guard is the root-level guard with the
 * question appended, so the scope's light block and its dark block land where
 * the scope's own palette lands and a viewer who pinned light still gets light.
 *
 * `:root:has(SCOPE)` ties with `TOKEN_CSS`'s `:root:not([data-theme='light'])`
 * on specificity, so it wins on order alone, the same way a scope's light block
 * wins over `:root`. `uiStyleSheet()` appending this after `TOKEN_CSS` is what
 * makes that true.
 */
export function viewportScheme(rawSelector: string, rawLight: string, rawDark: string): string {
  const selector = cssSelector(rawSelector);
  const light = cssBlock(rawLight);
  const dark = cssBlock(rawDark);
  return `:root:has(${selector}) {${light}}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):has(${selector}) {${dark}}
}

:root[data-theme='dark']:has(${selector}) {${dark}}
`;
}

/**
 * Every registered scope, in one block, for `uiStyleSheet()` to append: the
 * palette on the shell, and the chrome the shell cannot reach on the root.
 */
export const SCOPED_TOKEN_CSS: string = [...SCOPED_PALETTES]
  .map(
    ([mode, palette]) =>
      `${scopedPalette(routeScope(mode), palette.light, palette.dark)}${viewportScheme(
        routeScope(mode),
        nativeDeclarations(palette.light),
        nativeDeclarations(palette.dark),
      )}`,
  )
  .join('\n');
