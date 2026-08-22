/**
 * Mana pips.
 *
 * The printed string comes from the DSL (`formatManaCost`) and becomes the
 * accessible name; the pips themselves are decorative repeats of it, so a
 * screen reader hears `{1}{R}` once instead of four disconnected glyphs.
 *
 * **Which drawing goes in a pip is `./symbols.ts`, not this file.** It was
 * `./anatomy.ts` until the lab started staging its symbols locally, and that
 * left one card holding two vocabularies: the rules box asked the registry and
 * painted whatever set the face was given, while the title bar drew the lab's
 * own outline whatever anyone said. A card could show a pale drawn `{2}` above
 * a referenced `{1}`. So a pip now names its token (`anatomy.ts`'s `pipToken`)
 * and the registry says what that token looks like — the same two steps a brace
 * token in the rules box goes through, and the same answer.
 *
 * `pipArt` survives as the floor under that. The registry states `{0}`..`{20}`
 * and a cost may name a larger generic amount, so a token no set states falls
 * back to the numeral in a disc rather than to nothing.
 */
import { createElement } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { ManaCost } from '@mtg/dsl';
import { formatManaCost } from '@mtg/dsl';
import { PIP_GLYPH_STROKE, PIP_GLYPH_VIEW_BOX, costPips, pipArt, pipToken } from './anatomy';
import type { PipGlyph, PipSpec } from './anatomy';
import { DEFAULT_SYMBOL_SET, symbolArt } from './symbols';
import type { SymbolSet } from './symbols';
import type { ColorIdentity } from '../styles/tokens';

export interface ManaPipsProps {
  readonly cost: ManaCost;
  /** Which drawing to paint. Absent takes the registry's default for this face. */
  readonly symbols?: SymbolSet;
}

/**
 * One pip: the disc, the identity it is painted from, and whatever is drawn
 * inside it. Exported because the board's floating mana pool is this same
 * element fed from a pool rather than a cost, and a pool that spelled its
 * colors while the face drew them would be the only place on screen where a
 * mana symbol is a letter.
 */
export function manaPip(key: string, kind: ColorIdentity | 'generic', art: ReactNode): ReactElement {
  return createElement('span', { key, className: 'mtg-pip', 'data-pip': kind, 'aria-hidden': true }, art);
}

/**
 * One pip whose artwork is a file this tree does not hold.
 *
 * Painted as a background rather than mounted as an `<img>`, which is what
 * `./SymbolText.ts` does for the same artwork in a line of rules text and for
 * the same reason: React hoists a `<link rel="preload">` above the document for
 * every image it renders, and a card face is not a document. `data-art` is what
 * `../styles/symbols.ts` keys the disc off — a referenced symbol draws its own
 * disc, so the identity color and the ring behind it have to come off.
 */
export function manaPipImage(key: string, kind: ColorIdentity | 'generic', href: string): ReactElement {
  const style: CSSProperties = { backgroundImage: `url("${href}")` };
  return createElement('span', {
    key,
    className: 'mtg-pip',
    'data-pip': kind,
    'data-art': 'image',
    'aria-hidden': true,
    style,
  });
}

/**
 * A drawn symbol, mounted from the shared outline the way `Card.ts` mounts the
 * rarity seal. The glyph is authored in a resolution-independent square, so the
 * screen pip and the printed pip are the same drawing at two sizes rather than
 * two drawings of the same idea.
 */
export function pipGlyph(shape: PipGlyph): ReactElement {
  const outline = createElement('path', { key: 'fill', className: 'mtg-pip__glyph-fill', d: shape.fill });
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
    { className: 'mtg-pip__glyph', viewBox: PIP_GLYPH_VIEW_BOX, 'aria-hidden': true },
    [outline, ...details],
  );
}

/**
 * One pip of a run, drawn from the registry.
 *
 * Exported because everything on screen that shows a mana symbol outside a
 * printed line of rules text goes through here: the title bar's cost, the
 * board's floating pool, anything later. A caller that reached for `manaPip`
 * directly would be choosing a drawing again, which is the thing this replaces.
 */
export function registryPip(
  key: string,
  token: string,
  kind: ColorIdentity | 'generic',
  symbols: SymbolSet,
  fallback: ReactNode,
): ReactElement {
  const art = symbolArt(token, symbols);
  if (art === null) return manaPip(key, kind, fallback);
  switch (art.kind) {
    case 'image':
      return manaPipImage(key, kind, art.href);
    case 'drawn':
      return manaPip(key, kind, pipGlyph(art.glyph));
    case 'lettered':
      return manaPip(key, kind, art.text);
    default: {
      const never: never = art;
      throw new Error(`ManaPips: unknown art kind ${String(never)}`);
    }
  }
}

/** The drawing a pip falls back to when no set states its token. */
function drawnFallback(spec: PipSpec): ReactNode {
  const art = pipArt(spec);
  return art.kind === 'glyph' ? pipGlyph(art.glyph) : art.text;
}

/**
 * What a cost is called when it is spoken rather than drawn.
 *
 * Exported because the face spells its cost twice for two different readers:
 * here, on the pip run, and again inside the face's own accessible name
 * (`./Card.ts`). A card that said `Mana cost {1}{W}` in one of those places and
 * something else in the other would be two cards to a screen reader.
 */
export function manaCostLabel(cost: ManaCost): string {
  return `Mana cost ${formatManaCost(cost)}`;
}

/**
 * Renders `{2}{U}{U}` as a generic pip followed by two blue pips. Which pips and
 * in what order is `./anatomy.ts`; what each one is drawn as is `./symbols.ts`.
 * Both faces read the same two answers, so a cost can never read differently on
 * screen than on paper.
 */
export function ManaPips({ cost, symbols }: ManaPipsProps): ReactElement {
  const set = symbols ?? DEFAULT_SYMBOL_SET;
  const pips = costPips(cost).map((spec, index) => {
    const key = spec.kind === 'color' ? `${spec.color}${String(index)}` : 'generic';
    const kind = spec.kind === 'color' ? spec.identity : 'generic';
    return registryPip(key, pipToken(spec), kind, set, drawnFallback(spec));
  });
  return createElement(
    'span',
    { className: 'mtg-cost', role: 'img', 'aria-label': manaCostLabel(cost) },
    pips,
  );
}
