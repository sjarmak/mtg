/**
 * Measuring a line that carries symbols.
 *
 * SVG has no layout engine, so this package breaks its own lines, and a line
 * that carries `{T}` is no longer a string whose width the advance-width table
 * can answer: three characters of text have become a square the renderer draws
 * itself. Measuring it as text would under-measure `{20}` and over-measure
 * `{T}`, and either way the committed `textLength` would describe a line the
 * face does not draw.
 *
 * So a symbol is charged a *fixed* advance — `SYMBOL_ADVANCE_EM` from
 * `@mtg/ui`'s registry, the same number `styles/symbols.ts` writes into the web
 * sheet and `../symbols.ts` draws the box at. The three uses share one
 * declaration on purpose: measure at one width and draw at another and the
 * renderer reports a clean fit for a card that overflows.
 *
 * Nothing here emits markup. `../symbols.ts` does, and it is a separate module
 * because that one reaches the pip drawings and this one is imported by the
 * line breaker underneath them.
 */
import { oracleChunks, SYMBOL_ADVANCE_EM, SYMBOL_BOX_EM, SYMBOL_DROP_EM, SYMBOL_MARGIN_EM } from '@mtg/ui';
import type { OracleChunk } from '@mtg/ui';
import { measureText } from './metrics';
import type { MeasureOptions } from './metrics';

export { SYMBOL_ADVANCE_EM, SYMBOL_BOX_EM, SYMBOL_DROP_EM, SYMBOL_MARGIN_EM };
export { oracleChunks };
export type { OracleChunk };

/** Width of one symbol's advance at a font size, in user units. */
export function symbolAdvance(fontSize: number): number {
  return fontSize * SYMBOL_ADVANCE_EM;
}

/**
 * Width of a printed line, charging each symbol its fixed advance and every
 * other character the table's. Identical to `measureText` for a line with no
 * token in it, which is every title, type line and collector line in the lab.
 */
export function measureRich(text: string, options: MeasureOptions): number {
  if (text.length === 0) return 0;
  let total = 0;
  for (const chunk of oracleChunks(text)) {
    total += chunk.kind === 'text' ? measureText(chunk.text, options) : symbolAdvance(options.fontSize);
  }
  return total;
}

/**
 * The pieces a word may be broken between when it is wider than its box.
 *
 * A symbol is one piece and is never split, which is what keeps a hard wrap
 * from putting `{` on one line and `T}` on the next — a break the reader could
 * not repair, because by then neither half is text. Text is split by character,
 * exactly as the line breaker did before symbols existed.
 */
export function breakPoints(word: string): readonly string[] {
  const pieces: string[] = [];
  for (const chunk of oracleChunks(word)) {
    if (chunk.kind === 'symbol') {
      pieces.push(chunk.text);
      continue;
    }
    for (const char of chunk.text) pieces.push(char);
  }
  return pieces;
}
