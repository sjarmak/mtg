/**
 * What goes in a card's text box, in order — the one composition both renderers
 * build from, hosted in `@mtg/card-geometry` and handed on here.
 *
 * The composition moved with the fit ladder (mtg-plgg), because the ladder
 * reads it: whether the flavor text is printed depends on the size the rules
 * text put the box at, and a ladder in a package that depends only on
 * `@mtg/dsl` cannot reach a composition that stayed behind React and the
 * kernel. `@mtg/card-geometry`'s `text-box.ts` holds the argument for the three
 * kinds of block and for the roman run inside a line.
 *
 * This module stays because it is the path `@mtg/ui`'s own modules and tests
 * read the composition through, and re-exports rather than re-declares so there
 * is exactly one definition of each name.
 */
export { composeTextBox, lineRuns, oracleBlocks, remindedBlocks } from '@mtg/card-geometry';
export type { BoxFits, LineRuns, TextBlock } from '@mtg/card-geometry';
