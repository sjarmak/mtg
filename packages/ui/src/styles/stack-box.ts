/**
 * The token a pane sets when its scrollport has a height of its own.
 *
 * `mtg-47xi`. A strip column's box is a constant unless the pane around it can
 * say how much room there is, and whether it can is exactly the question the
 * frame blocks in `./deck.ts` and `./panel.ts` already answer.
 * `../routes/deck/stack-box.ts` argues at length why the answer crosses as one
 * declared token rather than as a media query spelled a second time in JS.
 *
 * Its own file since `mtg-v7sg`, which is a fact about module graphs rather than
 * about layout: the draft screen's pool declares the token too, that block lives
 * in `./panel.ts`, and `./deck.ts` already reads `./panel.ts`'s `SCREEN_QUERY`.
 * Two sheets importing each other is a cycle, and under ESM a cycle resolves as
 * a constant read before it is initialized -- the whole stylesheet throwing at
 * import time, in whichever direction the entry point happens to reach first. A
 * leaf both can read has no direction to get wrong.
 */

/** The custom property a scrollport declares its own height with. */
export const STACK_BOX_SOURCE_PROPERTY = '--strip-box-from';

/** Its one meaningful value. Anything else, absence included, means the constant. */
export const STACK_BOX_FROM_PANE = 'pane';

/**
 * What a strips region spends on chrome above and below its columns, in CSS
 * pixels: the count row, the gap under it, and the padding the region reserves
 * for its own sideways scrollbar.
 *
 * `mtg-qs2d`. A caller that states a floor for the *scrollport* a region is
 * drawn in is stating it about a box that has to hold this as well as a column,
 * and the draft pool's did not: `./panel.ts` floored the pool at the same 240px
 * `../routes/deck/strips.ts` lays its columns out against, so a pool at its
 * floor was 32px short of the column it was the floor for and scrolled itself,
 * cutting the whole card at the foot of the deepest column through the art.
 *
 * The three lengths are `./deck.ts`'s: `.mtg-strips__head`'s `min-block-size` is
 * `1.5rem`, `.mtg-strips__col`'s gap and `.mtg-strips`'s `padding-block-end` are
 * both `--mtg-space-1`. A number rather than a `calc()` string because a floor
 * is added to a floor and both ends of that sum are measured in a browser:
 * `../../test/draft/pool-columns.browser.test.ts` reads the same two lengths off
 * a real region through `roomOf` and fails when this stops being their sum, so
 * the constant cannot drift away from the sheet it is derived from without a
 * red gate saying so.
 */
export const STRIP_REGION_CHROME_PX = 32;

/**
 * What a strips region's own sideways scrollbar takes, in CSS pixels.
 *
 * Separate from the chrome above because it is the one term a floor cannot
 * measure: the region scrolls sideways whenever its columns run off the right,
 * and on a classic-scrollbar platform that scrollbar *grows* a content-sized
 * region rather than being drawn inside it. So a pool floored at the column plus
 * the chrome was still a scrollbar short, and at a full pack the pool scrolled
 * 11px to reach a scrollbar that was itself half under the fold.
 *
 * 15 is what chrome-headless-shell draws here, and reserving it is deliberately
 * an over-reservation on a platform that draws an overlay scrollbar instead:
 * a floor that is 15px generous costs the pack 15px it gives back the moment a
 * pick is made, and a floor that is 15px short cuts a card.
 * `../../test/draft/pool-columns.browser.test.ts` fails if a real region ever
 * draws one wider than this.
 */
export const STRIP_REGION_SCROLLBAR_PX = 15;
