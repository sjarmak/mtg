/**
 * `@mtg/render-spec` — one specification, behind two renderers.
 *
 * ADR-0002 keeps `@mtg/ui`'s DOM face and `@mtg/card-render`'s printed SVG face
 * drawing the same card: same regions, same pips, same seals, same palette, same
 * words. That only holds if both read one statement of what a card face is, and
 * until `mtg-ey09` that statement lived in `@mtg/ui`. So an SVG print renderer
 * that draws no interface pulled React into its graph, and through `@mtg/ui`
 * also `@mtg/deckbuild`, `@mtg/kernel`, `@mtg/metrics`, `@mtg/netplay` and
 * `@mtg/sim`.
 *
 * What is here is what a renderer must agree on and no renderer decides: the
 * card's anatomy (its regions, its pip glyphs, its rarity and set seals, its
 * frame treatment, its collector line), the mana-symbol registry and the oracle
 * chunker that reads it, the color-identity palette both faces resolve through,
 * the CSS helpers that emit it, and the motion pace the palette declares a
 * default for. What is not here is anything that draws: no React, no SVG, no
 * DOM, and no route.
 *
 * It depends on `@mtg/dsl` for the card it describes and on
 * `@mtg/card-geometry` for the measurements it lays out, and on nothing else.
 * `packages/slice/test/package-surfaces.test.ts` fails on a third arrow.
 *
 * The measurements stay a package of their own, and `mtg-tniy` settled why:
 * `@mtg/setgen` and `@mtg/dsl-coverage` want a number about a rectangle without
 * the symbol registry, the palette, the seals and a zod schema that come with
 * this one. `packages/card-geometry/src/index.ts` states the rule that decides
 * which of the two a new constant goes in, and the last test in
 * `packages/card-geometry/test/geometry.test.ts` fails the day the split loses
 * its last consumer.
 */
export * from './anatomy';
export * from './art';
export * from './art-manifest';
export * from './identity';
export * from './number';
export * from './pace';
export * from './path';
export * from './set-icon';
export * from './set-seal';
export * from './symbols';
export * from './tokens';
