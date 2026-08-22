/**
 * Text measurement.
 *
 * An SVG has no layout engine for prose: `<text>` does not wrap, so the
 * renderer has to break lines itself, and to break lines it has to measure.
 * There is no font file in this tree to measure against (see the package
 * README), so measurement runs against the generated advance-width table in
 * `metrics-data.ts`, which is a per-character *upper bound* across two
 * reference serif faces.
 *
 * Three layers of conservatism, in order of how much they buy:
 *
 *  1. the table is a maximum rather than an average, so any reference face fits;
 *  2. `DEFAULT_WIDTH_SAFETY` widens every measurement, covering faces outside
 *     the reference set that a viewer might resolve from the declared stack;
 *  3. the renderer emits `textLength` on every line, so a viewer whose font is
 *     wider still than the allowance tightens the tracking instead of spilling
 *     out of the box. That last one is the hard guarantee; the first two exist
 *     so it almost never has to do anything visible.
 *
 * An unknown character measures as `FALLBACK_ADVANCE`, the widest entry in the
 * table, so exotic input can only ever be over-measured.
 */
import { METRIC_ADVANCES, METRIC_CHARS, METRIC_EM } from './metrics-data';

export { METRIC_CHARS, METRIC_EM, METRIC_SOURCES } from './metrics-data';

/**
 * Multiplier applied to every measured width. 1.08 is not a guess about a
 * specific font; it is the margin that keeps normal running text off the
 * `textLength` fallback for faces a little wider than the reference set.
 */
export const DEFAULT_WIDTH_SAFETY = 1.08;

/** Line box height as a multiple of the font size, for wrapped prose. */
export const DEFAULT_LINE_HEIGHT = 1.22;

/**
 * Vertical glyph extent above and below the baseline, as multiples of the font
 * size. Generous relative to the reference faces (DejaVu Serif's tallest
 * lowercase reaches 0.76 em and its descenders 0.24 em) because the emitter and
 * the independent overflow checker both use these numbers, and a check that
 * under-states the ink is a check that passes a clipped card.
 */
export const GLYPH_ASCENT = 0.8;
export const GLYPH_DESCENT = 0.26;

/** Baseline offset from a box's vertical center that centers one line of text. */
export const CENTERED_BASELINE = (GLYPH_ASCENT - GLYPH_DESCENT) / 2;

const ADVANCE_BY_CHAR: ReadonlyMap<string, number> = new Map(
  [...METRIC_CHARS].map((char, index) => [char, METRIC_ADVANCES[index] ?? 0]),
);

/** Widest entry in the table; what an uncovered character is charged. */
export const FALLBACK_ADVANCE = METRIC_ADVANCES.reduce((max, w) => (w > max ? w : max), 0);

/** Advance width of one character, in em units (`METRIC_EM` per em). */
export function charAdvance(char: string): number {
  return ADVANCE_BY_CHAR.get(char) ?? FALLBACK_ADVANCE;
}

/** Advance width of a string, in em units. */
export function advanceOf(text: string): number {
  let total = 0;
  for (const char of text) total += charAdvance(char);
  return total;
}

export interface MeasureOptions {
  /** Font size in user units. */
  readonly fontSize: number;
  /** Extra allowance over the table. Defaults to `DEFAULT_WIDTH_SAFETY`. */
  readonly widthSafety?: number;
  /** Weight multiplier for bold runs; bold sets wider than regular. */
  readonly boldFactor?: number;
}

/**
 * Bold faces set wider than their regular companions, and the table only covers
 * the regular weights. Bold-to-regular advance ratios over letters and digits
 * across the reference pair: DejaVu Serif mean 1.095 / max 1.188, Liberation
 * Serif mean 1.057 / max 1.333. The constant takes the worse of the two maxima,
 * so bold runs are measured at their widest rather than their average — bold is
 * only used for short single-line runs (the card name, the P/T), where paying
 * for the worst case costs nothing and being wrong clips a name.
 *
 * Reproduce with `python3 packages/card-render/tools/measure-font-metrics.py
 * --bold-report`.
 */
export const BOLD_WIDTH_FACTOR = 1.34;

/** Width of `text` at a given size, in user units. Never under-reports. */
export function measureText(text: string, options: MeasureOptions): number {
  if (text.length === 0) return 0;
  const safety = options.widthSafety ?? DEFAULT_WIDTH_SAFETY;
  const bold = options.boldFactor ?? 1;
  return (advanceOf(text) / METRIC_EM) * options.fontSize * bold * safety;
}

/**
 * Largest font size at which `text` fits `maxWidth` on one line, or `null` when
 * even `minSize` overflows. Solved directly rather than searched: width is
 * linear in size, so the answer is one division, floored to `step` so the
 * emitted sizes stay on a tidy grid instead of carrying float noise.
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  bounds: { readonly maxSize: number; readonly minSize: number; readonly step?: number },
  options: Omit<MeasureOptions, 'fontSize'> = {},
): number | null {
  const step = bounds.step ?? 0.5;
  const unit = measureText(text, { ...options, fontSize: 1 });
  if (unit <= 0) return bounds.maxSize;
  const exact = maxWidth / unit;
  const snapped = Math.floor(exact / step) * step;
  if (snapped >= bounds.maxSize) return bounds.maxSize;
  if (snapped < bounds.minSize) return null;
  return snapped;
}
