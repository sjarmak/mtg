/**
 * A printed line of rules text, with its brace tokens painted.
 *
 * The shape is Scryfall's, and it is chosen for what it keeps rather than for
 * what it draws: the token stays the element's own text, so find-in-page,
 * copy-paste, a screen reader and the cross-face word-parity assertions all
 * keep reading `{T}` off the page. The artwork sits on top of that text rather
 * than in place of it — the abbreviation is a box the size of a symbol, its own
 * text is indented out of view, and the drawing is laid over the box.
 *
 * Which drawing is `./symbols.ts`, never an import here. This file knows that a
 * symbol is a square that carries a token; it does not know whose square.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { PIP_GLYPH_SCALE, PIP_GLYPH_STROKE, PIP_GLYPH_UNITS } from './anatomy';
import type { PipGlyph } from './anatomy';
import { DEFAULT_SYMBOL_SET, oracleChunks, symbolArt, symbolLabel } from './symbols';
import type { SymbolSet } from './symbols';

/** The abbreviation a symbol is painted on. `styles/symbols.ts` sizes it. */
export const SYMBOL_CLASS = 'mtg-symbol';

/**
 * The authoring square, inflated so a glyph drawn in it covers exactly
 * `PIP_GLYPH_SCALE` of the symbol box — the same share of a symbol the cost
 * line's pips give their glyphs, computed rather than restated.
 */
const GLYPH_EXTENT = PIP_GLYPH_UNITS / PIP_GLYPH_SCALE;
const GLYPH_VIEW_BOX = `${String(-GLYPH_EXTENT)} ${String(-GLYPH_EXTENT)} ${String(GLYPH_EXTENT * 2)} ${String(GLYPH_EXTENT * 2)}`;

function drawnArt(shape: PipGlyph): ReactElement {
  const fill = createElement('path', { key: 'fill', className: 'mtg-pip__glyph-fill', d: shape.fill });
  const details = shape.lines.map((line, index) =>
    createElement('path', {
      key: `line${String(index)}`,
      className: 'mtg-pip__glyph-line',
      d: line,
      strokeWidth: PIP_GLYPH_STROKE,
      strokeLinecap: 'round',
    }),
  );
  return createElement(
    'svg',
    { className: `${SYMBOL_CLASS}__art`, viewBox: GLYPH_VIEW_BOX, 'aria-hidden': true },
    [fill, ...details],
  );
}

/**
 * One painted token.
 *
 * `data-symbol` carries the token as printed, which is what both faces are
 * checked on and what a proof sheet can key off. `data-glyph` is the identity
 * the disc is painted from and is absent for a referenced image, because that
 * file draws its own disc.
 */
export function symbolElement(key: string, token: string, symbols: SymbolSet): ReactElement | null {
  const art = symbolArt(token, symbols);
  const label = symbolLabel(token);
  if (art === null || label === null) return null;
  const printed = `{${token}}`;
  const shared = { key, className: SYMBOL_CLASS, 'data-symbol': printed, title: label };
  switch (art.kind) {
    case 'image':
      // Painted as a background rather than mounted as an `<img>`, which is
      // both what Scryfall's own markup does and what keeps the face to one
      // element: React hoists a `<link rel="preload">` above the document for
      // every image it renders, and a card face is not a document.
      return createElement('abbr', { ...shared, style: { backgroundImage: `url("${art.href}")` } }, printed);
    case 'drawn':
      return createElement('abbr', { ...shared, 'data-glyph': art.identity }, printed, drawnArt(art.glyph));
    case 'lettered':
      // The letter is generated content keyed off `data-letter`, not a child.
      // A child would put a second text node inside the abbreviation, so the
      // rules box would read `{3}3` to `textContent`, to a selection dragged
      // across it and to the cross-face word comparison. Generated content is
      // in none of the three.
      return createElement(
        'abbr',
        { ...shared, 'data-glyph': art.identity, 'data-letter': art.text },
        printed,
      );
    default: {
      const never: never = art;
      throw new Error(`symbols: unknown art kind ${String(never)}`);
    }
  }
}

/**
 * One printed line as nodes: strings for the text, a painted abbreviation for
 * each token the registry states. A line with no token comes back as itself,
 * so a face that carries no symbol carries no extra element either.
 */
export function symbolizeLine(line: string, symbols: SymbolSet = DEFAULT_SYMBOL_SET): readonly ReactNode[] {
  return oracleChunks(line).map((chunk, index) => {
    if (chunk.kind === 'text') return chunk.text;
    return symbolElement(`s${String(index)}`, chunk.token, symbols) ?? chunk.text;
  });
}
