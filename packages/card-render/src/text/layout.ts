/**
 * Line breaking and auto-fit.
 *
 * This is the part that breaks at set scale. A fixed font size chosen against a
 * two-line common creature clips the moment a rare shows up with a keyword line
 * and three sentences, and a set of ninety cards always contains that rare. So
 * the rules box is fitted rather than sized: for each candidate size, from
 * largest down, the text is wrapped at that size and the resulting block is
 * checked against the box in both axes. The first size that fits wins, and if
 * none does the caller is told which card and by how much rather than being
 * handed a quietly clipped face.
 *
 * Hard-wrapping single long words is deliberate and load-bearing: a word wider
 * than the box (a 30-letter generated creature name in a token clause) would
 * otherwise loop forever or silently overflow. It is broken at the character
 * that fits, which is ugly and visible — which is what you want, because ugly
 * and visible gets fixed and silent overflow does not.
 */
import { DEFAULT_LINE_HEIGHT, GLYPH_ASCENT, GLYPH_DESCENT, measureText } from './metrics';
import type { MeasureOptions } from './metrics';
import { breakPoints, measureRich } from './symbols';

/** One laid-out line: the text, its measured width, and its baseline offset. */
export interface LayoutLine {
  readonly text: string;
  readonly width: number;
  /** Baseline y, relative to the top of the text block. */
  readonly baseline: number;
  /** Index of the source paragraph this line came from. */
  readonly paragraph: number;
}

export interface WrapOptions extends Omit<MeasureOptions, 'fontSize'> {
  readonly fontSize: number;
  readonly maxWidth: number;
}

/**
 * Greedy word wrap of one paragraph. Returns at least one line, even for the
 * empty string, so callers never have to special-case a blank paragraph.
 *
 * Measured with `measureRich`, so a `{T}` in the text is charged the width of
 * the square the face draws rather than the width of three characters it does
 * not. A paragraph with no brace token measures exactly as it always did.
 */
export function wrapParagraph(text: string, options: WrapOptions): readonly string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measureRich(candidate, options) <= options.maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
    if (measureRich(word, options) <= options.maxWidth) {
      current = word;
      continue;
    }
    const pieces = breakLongWord(word, options);
    const last = pieces[pieces.length - 1];
    lines.push(...pieces.slice(0, -1));
    current = last ?? '';
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Splits a word wider than the box into box-width pieces. Never loops.
 *
 * The pieces it may break between are `breakPoints`', which is one character of
 * text or one whole symbol: a break inside `{T}` would leave a brace on one
 * line and a token half on the next, and nothing downstream could repair it.
 */
function breakLongWord(word: string, options: WrapOptions): readonly string[] {
  const pieces: string[] = [];
  let current = '';
  for (const atom of breakPoints(word)) {
    const candidate = current + atom;
    if (current.length > 0 && measureRich(candidate, options) > options.maxWidth) {
      pieces.push(current);
      current = atom;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

/** A block of wrapped text that fit its box, with everything the SVG needs. */
export interface BlockLayout {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly lines: readonly LayoutLine[];
  /** Widest line, in user units. */
  readonly width: number;
  /** Total height of the block, in user units. */
  readonly height: number;
}

export interface FitBounds {
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Largest font size to try, in user units. */
  readonly maxSize: number;
  /** Smallest acceptable font size. Below this the fit is reported as failed. */
  readonly minSize: number;
  /** Size decrement between candidates. Defaults to 0.5 user units (0.05 mm). */
  readonly step?: number;
  /** Line box as a multiple of font size. Defaults to `DEFAULT_LINE_HEIGHT`. */
  readonly lineHeight?: number;
  /** Extra leading between paragraphs, as a multiple of font size. Default 0.35. */
  readonly paragraphGap?: number;
  /**
   * Left inset per paragraph, in user units: how much of the box that
   * paragraph does not get, because something else is drawn in it.
   *
   * A planeswalker's ability row is two columns, and the second one is where
   * the sentence goes. Without this the wrap would fit the sentence to the
   * whole box and the renderer would then shift it right, which puts the tail
   * of every line past the edge — the fit would be measured against a box the
   * text is not set in. Charging the inset here instead means the wrap, the
   * height check and the width check all describe the column the words are
   * actually in.
   *
   * Indexed by paragraph, and short or absent means zero, so an ordinary card
   * passes nothing and is laid out exactly as it always was. The width the
   * block reports is still measured against the *whole* box — a line's inset is
   * added back before it is compared — so `maxWidth` keeps meaning the box
   * rather than meaning whichever column happens to be widest.
   */
  readonly insets?: readonly number[];
}

/** Why a fit failed, with the numbers that make it actionable. */
export interface FitFailure {
  readonly reason: 'width' | 'height';
  /** Overflow at `minSize`, in user units. */
  readonly overflow: number;
  /** The line that did not fit, for a width failure. */
  readonly line?: string;
  readonly minSize: number;
}

export type FitResult =
  { readonly ok: true; readonly layout: BlockLayout } | { readonly ok: false; readonly failure: FitFailure };

/**
 * Fits paragraphs into a box by shrinking until they fit.
 *
 * Descending linear scan rather than a binary search: fitting is not monotone
 * in a way a bisection can be trusted with, because a smaller size can add a
 * line where a word ordering changes, and the candidate set is ~30 sizes wide,
 * so the scan is both cheaper to reason about and fast enough to run over a
 * whole set in milliseconds.
 */
export function fitParagraphs(
  paragraphs: readonly string[],
  bounds: FitBounds,
  options: Omit<MeasureOptions, 'fontSize'> = {},
): FitResult {
  const step = bounds.step ?? 0.5;
  const lineHeightRatio = bounds.lineHeight ?? DEFAULT_LINE_HEIGHT;
  if (lineHeightRatio < MIN_LINE_HEIGHT) {
    throw new Error(
      `fitParagraphs: line height ${lineHeightRatio} is tighter than the glyph extent ${MIN_LINE_HEIGHT}`,
    );
  }
  const paragraphGap = bounds.paragraphGap ?? 0.35;
  const insets = bounds.insets ?? [];
  let lastLayout: BlockLayout | null = null;

  for (const size of candidateSizes(bounds.maxSize, bounds.minSize, step)) {
    const layout = layoutAt(paragraphs, size, {
      ...options,
      maxWidth: bounds.maxWidth,
      lineHeightRatio,
      paragraphGap,
      insets,
    });
    lastLayout = layout;
    if (layout.width <= bounds.maxWidth + 1e-9 && layout.height <= bounds.maxHeight + 1e-9) {
      return { ok: true, layout };
    }
  }

  const layout = lastLayout ?? emptyLayout(bounds.minSize, lineHeightRatio);
  if (layout.width > bounds.maxWidth + 1e-9) {
    const widest = widestLine(layout);
    return {
      ok: false,
      failure: {
        reason: 'width',
        overflow: layout.width - bounds.maxWidth,
        ...(widest === null ? {} : { line: widest }),
        minSize: bounds.minSize,
      },
    };
  }
  return {
    ok: false,
    failure: {
      reason: 'height',
      overflow: layout.height - bounds.maxHeight,
      minSize: bounds.minSize,
    },
  };
}

/**
 * Baseline of a line, measured from the top of the block.
 *
 * The baseline is pinned to the *bottom* of the line box less the descender
 * room, rather than to a fraction of the line box. That makes the last line's
 * ink end exactly at the bottom of the block for any line height, so "the block
 * fits the box" and "the ink fits the box" are the same statement rather than
 * two statements that agree while there happens to be slack.
 */
function baselineIn(top: number, lineHeight: number, fontSize: number): number {
  return top + lineHeight - fontSize * GLYPH_DESCENT;
}

/** The tightest line height that still contains a line's ink. */
export const MIN_LINE_HEIGHT = GLYPH_ASCENT + GLYPH_DESCENT;

/**
 * Candidate sizes, largest first, derived from an integer step index so a long
 * descending scan cannot drift off the grid the way repeated subtraction does.
 */
export function candidateSizes(maxSize: number, minSize: number, step: number): readonly number[] {
  if (step <= 0) throw new Error(`candidateSizes: step must be positive, got ${step}`);
  if (maxSize < minSize) return [];
  const count = Math.floor((maxSize - minSize) / step + 1e-9);
  return Array.from({ length: count + 1 }, (_, index) => Number((maxSize - index * step).toFixed(4)));
}

interface LayoutAtOptions extends Omit<MeasureOptions, 'fontSize'> {
  readonly maxWidth: number;
  readonly lineHeightRatio: number;
  readonly paragraphGap: number;
  /** See `FitBounds.insets`. Empty is the ordinary card. */
  readonly insets: readonly number[];
}

function layoutAt(paragraphs: readonly string[], fontSize: number, options: LayoutAtOptions): BlockLayout {
  const lineHeight = fontSize * options.lineHeightRatio;
  const gap = fontSize * options.paragraphGap;
  const lines: LayoutLine[] = [];
  let cursor = 0;
  let widest = 0;

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) cursor += gap;
    // The column this paragraph is set in, which is the box less whatever is
    // drawn to its left. `widest` adds the inset back, so the block's reported
    // width is still the distance from the left edge of the box to the last
    // glyph on the widest line rather than the width of the widest column.
    const indent = options.insets[index] ?? 0;
    const wrapped = wrapParagraph(paragraph, {
      ...options,
      fontSize,
      maxWidth: options.maxWidth - indent,
    });
    for (const text of wrapped) {
      const width = measureRich(text, { ...options, fontSize });
      if (width + indent > widest) widest = width + indent;
      lines.push({ text, width, baseline: baselineIn(cursor, lineHeight, fontSize), paragraph: index });
      cursor += lineHeight;
    }
  });

  return { fontSize, lineHeight, lines, width: widest, height: cursor };
}

function emptyLayout(fontSize: number, lineHeightRatio: number): BlockLayout {
  return { fontSize, lineHeight: fontSize * lineHeightRatio, lines: [], width: 0, height: 0 };
}

function widestLine(layout: BlockLayout): string | null {
  let widest: LayoutLine | null = null;
  for (const line of layout.lines) {
    if (widest === null || line.width > widest.width) widest = line;
  }
  return widest === null ? null : widest.text;
}

/** Single-line fit: the largest size at which `text` fits, or a failure. */
export function fitLine(
  text: string,
  bounds: Omit<FitBounds, 'maxHeight'> & { readonly maxHeight?: number },
  options: Omit<MeasureOptions, 'fontSize'> = {},
): FitResult {
  const step = bounds.step ?? 0.5;
  const lineHeightRatio = bounds.lineHeight ?? DEFAULT_LINE_HEIGHT;
  for (const size of candidateSizes(bounds.maxSize, bounds.minSize, step)) {
    const width = measureText(text, { ...options, fontSize: size });
    if (width > bounds.maxWidth + 1e-9) continue;
    const lineHeight = size * lineHeightRatio;
    return {
      ok: true,
      layout: {
        fontSize: size,
        lineHeight,
        lines: [{ text, width, baseline: baselineIn(0, lineHeight, size), paragraph: 0 }],
        width,
        height: lineHeight,
      },
    };
  }
  const width = measureText(text, { ...options, fontSize: bounds.minSize });
  return {
    ok: false,
    failure: {
      reason: 'width',
      overflow: width - bounds.maxWidth,
      line: text,
      minSize: bounds.minSize,
    },
  };
}
