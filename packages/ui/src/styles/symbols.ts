/**
 * Symbols set into a line of rules text.
 *
 * Sized in `em` rather than in `rem`, which is the whole reason this is a sheet
 * of its own rather than three more rules beside `.mtg-pip`. A cost-line pip is
 * a fixed-size badge on a bar; a symbol in the rules box has to be the size of
 * the words around it, and the rules box is set at whatever size the face is
 * drawn at — full, compact or a battlefield thumbnail. One `rem` value cannot
 * be all three.
 *
 * The measurements are Scryfall's shipped stylesheet, and they are worth
 * copying because they are the difference between a symbol that sits in a line
 * and one that floats over it: a 0.94em square dropped 0.0625em below the
 * baseline, 0.0625em of side margin (so two adjacent symbols stand 0.125em
 * apart), a full corner radius, and a hard down-left drop shadow with no blur.
 * `@mtg/card-render`'s `text/symbols.ts` states the same three numbers for the
 * printed face, which is why they are named there rather than typed twice.
 *
 * The token itself is still the element's own text and is only *indented* out
 * of view, never removed: `../card/SymbolText.ts` says why. Nothing painted
 * over it is a second text node — a referenced symbol is a background image, a
 * drawn one is an `<svg>`, and a lettered one is generated content — so a
 * selection dragged across the rules box copies `{T}: Add {B}.` and the drawing
 * contributes nothing to it.
 */
import { COLOR_IDENTITIES } from './tokens';
import { cssNumber } from './number';
import { SYMBOL_BOX_EM, SYMBOL_MARGIN_EM } from '../card/symbols';

const BOX = `${cssNumber(SYMBOL_BOX_EM)}em`;
const MARGIN = `${cssNumber(SYMBOL_MARGIN_EM)}em`;

/** The disc a drawn or lettered symbol is painted on; a referenced image draws its own. */
const identityRule = (identity: string): string =>
  `.mtg-symbol[data-glyph='${identity}'] {` +
  ` background: var(--mtg-color-${identity});` +
  ` color: var(--mtg-color-${identity}-on); }`;

export const SYMBOL_CSS = [
  `.mtg-symbol {`,
  `  position: relative; display: inline-block; box-sizing: border-box;`,
  `  width: ${BOX}; height: ${BOX}; margin: 0 ${MARGIN}; bottom: -${MARGIN};`,
  `  vertical-align: baseline; border-radius: var(--mtg-radius-pill);`,
  `  overflow: hidden; white-space: nowrap; text-indent: -9999px;`,
  `  background-size: contain; background-repeat: no-repeat; background-position: center;`,
  `  text-decoration: none; border: 0;`,
  `  box-shadow: -${MARGIN} ${MARGIN} 0 var(--mtg-pip-ring);`,
  `}`,
  `.mtg-symbol__art {`,
  `  position: absolute; left: 0; top: 0; width: 100%; height: 100%;`,
  `  display: block; text-indent: 0; user-select: none; -webkit-user-select: none;`,
  `}`,
  `.mtg-symbol[data-letter]::after {`,
  `  content: attr(data-letter); position: absolute; inset: 0;`,
  `  display: flex; align-items: center; justify-content: center; text-indent: 0;`,
  `  font-family: var(--mtg-font-ui); font-weight: 700; font-size: 0.62em; line-height: 1;`,
  `  user-select: none; -webkit-user-select: none;`,
  `}`,
  ...COLOR_IDENTITIES.filter((identity) => identity !== 'm').map(identityRule),
  `.mtg-symbol[data-glyph='generic'] {`,
  ` background: var(--mtg-surface-inset); color: var(--mtg-ink-muted); }`,
  // A cost-line pip painted from the registry rather than drawn here. The rules
  // above dress a symbol in the rules box; this one undresses a pip in the
  // title bar, because `../card/Card.ts` now paints both from one set and a
  // referenced file draws its own disc. Two attribute selectors so it wins
  // over `card.ts`'s `[data-pip]` colors on specificity rather than on sheet
  // order, which is not this file's to decide.
  `.mtg-pip[data-pip][data-art='image'] {`,
  `  background-color: transparent; box-shadow: none;`,
  `  background-size: contain; background-repeat: no-repeat; background-position: center;`,
  `}`,
].join('\n');
