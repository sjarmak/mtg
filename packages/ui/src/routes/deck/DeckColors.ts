/**
 * What colors the deck is, as pips rather than as a sentence.
 *
 * `mtg-84703`. Both builders printed `Colors: blue, black and red` on the bar
 * over their panes, and the playtester read the same defect there that she read over
 * the pool's columns: "no need to put White , Blue , Black etc text labels but
 * just a small indicator of the count for each color would be sufficient". The
 * words are the widest thing on a row that also has to hold four controls and a
 * pane switch, and the fact they carry is five bits.
 *
 * The sentence is not deleted, it is moved off the glass: `./deck-counts.ts`'s
 * `deckColorsNote` becomes the element's accessible name, so a screen reader
 * still hears "Colors: blue, black and red" and a pip's own name -- which is the
 * pip -- never reaches it. That is the same split `./CurveColumns.ts` makes
 * between what a column head draws and what it says.
 *
 * A deck with nothing in it keeps the words. `No colors yet` is a sentence about
 * a deck rather than a list of colors, there is no pip that means it, and an
 * empty element in the middle of the bar reads as a readout that failed to fill.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { symbolElement } from '../../card/SymbolText';
import { DEFAULT_SYMBOL_SET } from '../../card/symbols';
import { deckColorsNote } from './deck-counts';

/** The bar's color readout: one pip per color, in the order the deck states. */
export function deckColorsIndicator(colors: readonly string[]): ReactElement {
  const note = deckColorsNote(colors);
  if (colors.length === 0) return createElement('span', { className: 'mtg-builder__colors' }, note);
  return createElement(
    'span',
    { className: 'mtg-builder__colors', 'aria-label': note },
    ...colors.map((color) => {
      const token = color.toUpperCase();
      // A color the registry has no token for is drawn as itself rather than
      // dropped: the readout is what the deck is, and a silently missing pip
      // makes a three-color deck look like a two-color one.
      return symbolElement(`deck-color-${token}`, token, DEFAULT_SYMBOL_SET) ?? token;
    }),
  );
}
