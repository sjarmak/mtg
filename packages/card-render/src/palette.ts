/**
 * The color layer — which is to say, the layer that names no colors.
 *
 * `@mtg/ui`'s `tokens.ts` is the single place in the lab where a color is
 * chosen, and this package does not get a second one. The SVG carries
 * `TOKEN_CSS` verbatim and every painted thing below resolves through
 * `var(--mtg-*)`, so a card rendered to a file and a card rendered in the web
 * board are the same seven frames by construction rather than by anybody
 * remembering to keep two palettes in step.
 *
 * Carrying the sheet verbatim also gets theme handling for free in both
 * embedding contexts. In a standalone `.svg` file the document root *is* the
 * `<svg>` element, so `:root` matches it and `data-theme` on that element pins
 * a theme; inlined into an HTML page, `:root` is `<html>`, the declarations are
 * identical to the ones `GlobalStyles` already put there, and the host page's
 * theme wins. Both are the behavior you want.
 *
 * Known constraint: this makes the file depend on a renderer that implements
 * CSS custom properties. Browsers do; some standalone rasterizers do not, and
 * will paint the frame with the initial `fill`. That is the price of having no
 * second palette, and it is the right price — a duplicated color drifts, a
 * missing rasterizer feature is a one-line note.
 */
import { COLOR_IDENTITIES, RARITY_SEAL_INK, TOKEN_CSS } from '@mtg/ui';
import type { ColorIdentity } from '@mtg/ui';

export { COLOR_IDENTITIES, TOKEN_CSS };
export type { ColorIdentity };

/** Root class of a rendered face; mirrors `@mtg/ui`'s `.mtg-card`. */
export const CARD_CLASS = 'mtg-card-svg';

/** Theme selection for a standalone file. `auto` follows the viewer. */
export type CardTheme = 'auto' | 'light' | 'dark';

const identityRule = (identity: ColorIdentity): string =>
  `.${CARD_CLASS}[data-identity='${identity}'] {` +
  ` --frame: var(--mtg-frame-${identity});` +
  ` --edge: var(--mtg-frame-${identity}-edge);` +
  ` --panel: var(--mtg-frame-${identity}-panel);` +
  ` --well: var(--mtg-frame-${identity}-well); }`;

/**
 * The set symbol's ink, one rule per rarity, off the specification's own record.
 *
 * The seal used to resolve `--seal` from the card's identity, which asked one
 * mark to carry two facts and left commons — the bulk of a set — with no ink of
 * their own. It is keyed on the rarity now, and `@mtg/ui`'s `styles/card.ts`
 * generates the same rules from the same record, so a rarity that gains an ink
 * paints on both faces or on neither.
 */
const sealRule = ([rarity, token]: readonly [string, string]): string =>
  `.${CARD_CLASS} .seal[data-rarity='${rarity}'] { fill: var(${token}); }`;

const pipRule = (identity: ColorIdentity): string =>
  `.${CARD_CLASS} .pip[data-pip='${identity}'] {` +
  ` --pip: var(--mtg-color-${identity});` +
  ` --pip-on: var(--mtg-color-${identity}-on); }`;

/**
 * A symbol set into a line of rules text resolves the same two channels a cost
 * pip does, off its own attribute rather than off `data-pip`: the cost run is a
 * fact about the card that proof sheets and the parity suite read out of the
 * markup, and a `{T}` in the middle of a sentence is not part of it.
 */
const symbolRule = (identity: ColorIdentity): string =>
  `.${CARD_CLASS} .sym[data-glyph='${identity}'] {` +
  ` --pip: var(--mtg-color-${identity});` +
  ` --pip-on: var(--mtg-color-${identity}-on); }`;

/**
 * Structure and type, in one sheet. Only `var(--mtg-*)` and the local channels
 * (`--frame`, `--panel`, `--well`, `--edge`, `--seal`, `--pip`) appear as
 * colors, which is the same convention `@mtg/ui` holds itself to.
 *
 * `--panel` and `--well` joined the list when the card's interior stopped being
 * neutral. Every panel used to be `--mtg-surface-raised` and the art window
 * `--mtg-surface-sunken`, so the only colored thing on a face was its ground and
 * the hairline round each box; a face is now its identity throughout, and the
 * two channels are how it gets there without this file learning a color name.
 *
 * The one exception is stated as a rule rather than as a value: a *pending* art
 * window keeps the neutral sunken ground. That window is not the card's picture,
 * it is a production notice printed in `--mtg-pending` amber over a hatch, and
 * amber does not clear AA on a tinted well. `@mtg/ui`'s `styles/card.ts` states
 * the same exception on `.mtg-art[data-art-state='pending']`.
 */
export const CARD_CSS = [
  ...COLOR_IDENTITIES.map(identityRule),
  ...COLOR_IDENTITIES.map(pipRule),
  `.${CARD_CLASS} .pip[data-pip='generic'] { --pip: var(--mtg-surface-inset); --pip-on: var(--mtg-ink-muted); }`,
  ...COLOR_IDENTITIES.map(symbolRule),
  `.${CARD_CLASS} .sym[data-glyph='generic'] { --pip: var(--mtg-surface-inset); --pip-on: var(--mtg-ink-muted); }`,
  `.${CARD_CLASS} .frame { fill: var(--frame); stroke: var(--edge); }`,
  `.${CARD_CLASS} .panel { fill: var(--panel); stroke: var(--edge); }`,
  `.${CARD_CLASS} .well { fill: var(--well); stroke: var(--edge); }`,
  `.${CARD_CLASS} .art[data-art-state='pending'] .well { fill: var(--mtg-surface-sunken); }`,
  `.${CARD_CLASS} .keyline { fill: none; stroke: var(--mtg-line); }`,
  ...Object.entries(RARITY_SEAL_INK).map(sealRule),
  `.${CARD_CLASS} .pip-disc { fill: var(--pip); stroke: var(--mtg-pip-ring); }`,
  `.${CARD_CLASS} .pip-glyph { fill: var(--pip-on); }`,
  `.${CARD_CLASS} .pip-glyph-line { fill: none; stroke: var(--pip-on); }`,
  `.${CARD_CLASS} .pip-digit { fill: var(--pip-on); font-family: var(--mtg-font-ui); font-weight: 700; }`,
  `.${CARD_CLASS} .ink { fill: var(--mtg-ink); }`,
  `.${CARD_CLASS} .ink-muted { fill: var(--mtg-ink-muted); }`,
  `.${CARD_CLASS} .pending-ink { fill: var(--mtg-pending); }`,
  `.${CARD_CLASS} .hatch-line { stroke: var(--mtg-hatch); fill: none; }`,
  `.${CARD_CLASS} .title-text { font-family: var(--mtg-font-card); font-weight: 700; }`,
  `.${CARD_CLASS} .type-text { font-family: var(--mtg-font-card); font-weight: 600; }`,
  `.${CARD_CLASS} .rules-text { font-family: var(--mtg-font-card); }`,
  // Reminder text and flavor text, which is the whole of how a printed card
  // tells them from the rules text it sets beside them. The DOM face italicizes
  // the same two block kinds (`@mtg/ui`'s `styles/card.ts`); which blocks those
  // are is `@mtg/ui`'s `text-box.ts` and neither renderer decides it.
  `.${CARD_CLASS} .italic { font-style: italic; }`,
  `.${CARD_CLASS} .pt-text { font-family: var(--mtg-font-card); font-weight: 700; }`,
  // A planeswalker's two badges and the rule between its ability rows. Both
  // badges are the card's own ink with the inverse ink set in them, which is
  // what makes a price read as a price against a sentence in the same box, and
  // `@mtg/ui`'s sheet paints `.mtg-card__loyalty` and `.mtg-card__shield` from
  // the same two tokens. The divider is the frame's edge color, so it is the
  // same line as the hairline round every panel on the face.
  `.${CARD_CLASS} .loyalty-badge { fill: var(--mtg-ink); }`,
  `.${CARD_CLASS} .loyalty-shield { fill: var(--mtg-ink); stroke: var(--edge); }`,
  `.${CARD_CLASS} .loyalty-cost { fill: var(--mtg-ink-inverse); font-family: var(--mtg-font-card); font-weight: 700; }`,
  `.${CARD_CLASS} .loyalty-ink { fill: var(--mtg-ink-inverse); font-family: var(--mtg-font-card); font-weight: 700; }`,
  `.${CARD_CLASS} .loyalty-rule { fill: none; stroke: var(--edge); }`,
  `.${CARD_CLASS} .meta-text { font-family: var(--mtg-font-ui); }`,
].join('\n');

/** The complete stylesheet embedded in a rendered card. */
export function cardStyleSheet(): string {
  return `${TOKEN_CSS}\n${CARD_CSS}\n`;
}
