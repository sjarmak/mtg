/**
 * Symbols set into a printed line.
 *
 * A line of rules text used to be one `<text>` element with a committed
 * `textLength`, and `overflow.ts` re-derived its rectangle from exactly those
 * attributes. A line carrying `{T}` cannot be one element any more, so it
 * becomes several: a run of text, a positioned group, a run of text. That is
 * the real cost of symbolizing the box, and the whole of it is paid here and in
 * `overflow.ts` — every piece still declares its own rectangle, so the
 * independent check still covers the line rather than covering the parts of it
 * that happen to be text.
 *
 * Two rules keep the pieces in step with the measurement in `text/symbols.ts`:
 *
 *  * the cursor advances by the *measured* width of each piece, including the
 *    whitespace a run is trimmed of before it is emitted, so what is drawn and
 *    what was measured describe the same line;
 *  * a symbol's box is `SYMBOL_BOX_EM` and its advance `SYMBOL_ADVANCE_EM`,
 *    read from `@mtg/ui`'s registry rather than restated.
 *
 * Which drawing goes in the box is the registry's, never an import. The
 * referenced set names a file this tree does not hold; the original set is the
 * cost line's own pip, drawn smaller.
 *
 * The default here is `PRINTED_SYMBOL_SET` rather than the web face's, and the
 * two parted company when the lab started staging its symbols locally: a page
 * can reference `symbols/T.svg` beside itself, and a file on its way to a
 * printer cannot, because it will be opened somewhere this repository is not.
 */
import { PRINTED_SYMBOL_SET, symbolArt, symbolLabel } from '@mtg/ui';
import type { SymbolSet } from '@mtg/ui';
import { genericMarkup, glyphMarkup } from './pips';
import { el, num, textEl } from './svg';
import { textRun } from './text/emit';
import { measureText } from './text/metrics';
import { oracleChunks, SYMBOL_BOX_EM, SYMBOL_DROP_EM, SYMBOL_MARGIN_EM, symbolAdvance } from './text/symbols';

export interface RichLineOptions {
  /** Left edge of the line. */
  readonly x: number;
  /** Baseline the line is set on. */
  readonly y: number;
  readonly fontSize: number;
  /** Class of the text runs; a symbol group carries its own. */
  readonly className: string;
  /** Region the pieces declare themselves in, for the overflow check. */
  readonly region: string;
  /**
   * Which line of the region these pieces are, written onto every one of them.
   *
   * A line used to be one element, so "these words are one line" was something
   * the markup said by construction. It is several elements now, and a reader
   * putting the line back together — a proof sheet, the cross-face word
   * comparison — would otherwise have to infer the break from coordinates.
   */
  readonly line: number;
  /**
   * Right edge a run of text is committed no further than. The line breaker has
   * already fitted the line, so this bites only on a card the fit report has
   * failed — where it tightens the tracking rather than letting the run spill,
   * which is what a single-run line did before it was several.
   */
  readonly right?: number;
  readonly symbols?: SymbolSet;
  readonly widthSafety?: number;
}

/** Class every printed symbol group carries. `palette.ts` paints from it. */
export const SYMBOL_GROUP_CLASS = 'sym';

/**
 * One printed line as the pieces that draw it, in reading order.
 *
 * A line with no brace token comes back as the single text run it always was,
 * so nothing about the title bar, the type line or a card without symbols
 * changes shape.
 */
export function richLine(text: string, options: RichLineOptions): readonly string[] {
  const set = options.symbols ?? PRINTED_SYMBOL_SET;
  const safety = options.widthSafety === undefined ? {} : { widthSafety: options.widthSafety };
  const measure = { fontSize: options.fontSize, ...safety };
  const pieces: string[] = [];
  let cursor = options.x;
  for (const chunk of oracleChunks(text)) {
    if (chunk.kind === 'text') {
      pieces.push(...textPiece(chunk.text, cursor, options));
      cursor += measureText(chunk.text, measure);
      continue;
    }
    pieces.push(symbolPiece(chunk.token, chunk.text, cursor, set, options));
    cursor += symbolAdvance(options.fontSize);
  }
  return pieces;
}

/**
 * A run of set text, emitted whole rather than trimmed.
 *
 * The space before `{W}` in `: Add {W}.` belongs to the run that precedes the
 * symbol, and it is committed to that run's `textLength` — so the run has to
 * actually draw it. An SVG viewer collapses leading and trailing whitespace out
 * of a `<text>` unless the element says otherwise, which would leave the run
 * stretched by `lengthAdjust` across a width it no longer fills; `xml:space` is
 * what makes the drawn run and the measured run the same run. It is stated only
 * where it changes something, so a line with no symbol on it emits exactly the
 * markup it always did.
 */
function textPiece(text: string, x: number, options: RichLineOptions): readonly string[] {
  if (text.length === 0) return [];
  const safety = options.widthSafety === undefined ? {} : { widthSafety: options.widthSafety };
  const measured = measureText(text, { fontSize: options.fontSize, ...safety });
  const room = options.right === undefined ? measured : Math.max(0, options.right - x);
  const padded = text !== text.trim();
  return [
    textRun(text, {
      className: options.className,
      x,
      y: options.y,
      fontSize: options.fontSize,
      width: Math.min(measured, room),
      extra: {
        'data-region': options.region,
        'data-line': options.line,
        ...(padded ? { 'xml:space': 'preserve' } : {}),
      },
      ...safety,
    }),
  ];
}

/**
 * One symbol, as a group that declares the box it occupies.
 *
 * `data-sym-*` is what `overflow.ts` re-derives the rectangle from, and it is a
 * separate spelling from a region's `data-box-*` on purpose: a symbol is inside
 * a region rather than being one, and a checker that confused the two would
 * measure every symbol against itself.
 */
function symbolPiece(
  token: string,
  printed: string,
  x: number,
  set: SymbolSet,
  options: RichLineOptions,
): string {
  const { fontSize } = options;
  const size = fontSize * SYMBOL_BOX_EM;
  const left = x + fontSize * SYMBOL_MARGIN_EM;
  const top = options.y + fontSize * SYMBOL_DROP_EM - size;
  const art = symbolArt(token, set);
  const label = symbolLabel(token);
  if (art === null || label === null) {
    return textRun(printed, {
      className: options.className,
      x,
      y: options.y,
      fontSize,
      extra: { 'data-region': options.region, 'data-line': options.line },
      ...(options.widthSafety === undefined ? {} : { widthSafety: options.widthSafety }),
    });
  }
  const radius = size / 2;
  const children: string[] = [textEl('title', {}, printed)];
  let identity: string | null = null;
  switch (art.kind) {
    case 'image':
      // An external reference, never a copy: nothing in this tree holds the
      // file, and `--symbols original` renders a face that names no host.
      children.push(
        el('image', {
          x: -radius,
          y: -radius,
          width: size,
          height: size,
          href: art.href,
          'xlink:href': art.href,
        }),
      );
      break;
    case 'drawn':
      identity = art.identity;
      children.push(
        el('circle', { class: 'pip-disc', cx: 0, cy: 0, r: radius, 'stroke-width': 1.4 }),
        ...glyphMarkup(art.glyph, radius),
      );
      break;
    case 'lettered':
      identity = art.identity;
      children.push(
        el('circle', { class: 'pip-disc', cx: 0, cy: 0, r: radius, 'stroke-width': 1.4 }),
        genericMarkup(art.text, radius, options.widthSafety),
      );
      break;
    default: {
      const never: never = art;
      throw new Error(`symbols: unknown art kind ${String(never)}`);
    }
  }
  return el(
    'g',
    {
      class: SYMBOL_GROUP_CLASS,
      'data-region': options.region,
      'data-line': options.line,
      'data-symbol': printed,
      ...(identity === null ? {} : { 'data-glyph': identity }),
      'data-sym-x': left,
      'data-sym-y': top,
      'data-sym-size': size,
      role: 'img',
      'aria-label': printed,
      transform: `translate(${num(left + radius)} ${num(top + radius)})`,
    },
    children,
  );
}
