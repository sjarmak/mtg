/**
 * The independent overflow check.
 *
 * This module deliberately does not trust `render.ts`. It reads an emitted SVG
 * as text, pulls the region boxes out of their `data-box-*` attributes and the
 * text runs out of their `x` / `y` / `font-size` / `textLength` / `text-anchor`
 * attributes, re-derives each run's ink rectangle from scratch, and reports
 * anything that leaves its box. A renderer bug that mis-reports a fit therefore
 * still fails the check, which is the only version of this check worth having:
 * a checker built on the renderer's own fit records would agree with the
 * renderer by construction and catch nothing.
 *
 * It covers two kinds of piece, because a line does: runs of set text, and the
 * symbol boxes the renderer draws where the DSL printed a brace token. Both
 * declare their own rectangle in the markup and both are checked against the
 * region that contains them.
 *
 * It parses with regular expressions rather than a DOM, on purpose. The input
 * is not arbitrary SVG — it is the output of `svg.ts`, whose attribute
 * serializer is nine lines long — and the alternative is a DOM dependency in a
 * package whose whole point is not needing one.
 */
import { GLYPH_ASCENT, GLYPH_DESCENT } from './text/metrics';

/** One run of text that leaves its region box. */
export interface OverflowFinding {
  readonly region: string;
  readonly text: string;
  readonly edge: 'left' | 'right' | 'top' | 'bottom';
  /** How far past the box edge the ink reaches, in user units. */
  readonly overflow: number;
}

/** A region box as declared in the markup. */
interface RegionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const REGION_RE = /<g\b[^>]*\bdata-region="([^"]+)"[^>]*\bdata-box-x="([^"]*)"[^>]*>/g;
const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

function attr(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(source);
  return match === null ? null : (match[1] ?? null);
}

function numAttr(source: string, name: string): number | null {
  const raw = attr(source, name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function unescapeText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Region boxes declared in the document, keyed by region name. */
export function regionBoxes(svg: string): ReadonlyMap<string, RegionBox> {
  const boxes = new Map<string, RegionBox>();
  REGION_RE.lastIndex = 0;
  for (let match = REGION_RE.exec(svg); match !== null; match = REGION_RE.exec(svg)) {
    const tag = match[0];
    const region = match[1];
    if (region === undefined) continue;
    const x = numAttr(tag, 'data-box-x');
    const y = numAttr(tag, 'data-box-y');
    const width = numAttr(tag, 'data-box-w');
    const height = numAttr(tag, 'data-box-h');
    if (x === null || y === null || width === null || height === null) {
      throw new Error(`overflow: region "${region}" declares an incomplete box`);
    }
    boxes.set(region, { x, y, width, height });
  }
  return boxes;
}

/** A text run's ink rectangle, re-derived from its own attributes. */
export interface InkRect {
  readonly region: string;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Every text run in the document, with the rectangle its ink occupies.
 *
 * Width comes from `textLength`, which is the width the renderer *committed*
 * the run to rather than a width this checker estimates: a viewer honoring
 * `textLength` produces exactly that width, so checking it is checking what
 * will be painted.
 */
export function inkRects(svg: string): readonly InkRect[] {
  const rects: InkRect[] = [];
  TEXT_RE.lastIndex = 0;
  for (let match = TEXT_RE.exec(svg); match !== null; match = TEXT_RE.exec(svg)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const region = attr(attrs, 'data-region');
    if (region === null) continue;
    const x = numAttr(attrs, 'x');
    const y = numAttr(attrs, 'y');
    const fontSize = numAttr(attrs, 'font-size');
    const width = numAttr(attrs, 'textLength');
    if (x === null || y === null || fontSize === null || width === null) {
      throw new Error(`overflow: text run in region "${region}" is missing layout attributes`);
    }
    const anchor = attr(attrs, 'text-anchor') ?? 'start';
    const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    rects.push({
      region,
      text: unescapeText(body),
      left,
      right: left + width,
      top: y - fontSize * GLYPH_ASCENT,
      bottom: y + fontSize * GLYPH_DESCENT,
    });
  }
  return rects;
}

const SYMBOL_RE = /<g\b([^>]*\bdata-sym-x="[^"]*"[^>]*)>/g;

/**
 * Every drawn symbol in the document, with the rectangle it occupies.
 *
 * A line of rules text carrying `{T}` is no longer one `<text>` element, so a
 * check that read only text runs would silently stop covering the part of the
 * line that is drawn — and drawn is exactly the part a viewer cannot squeeze to
 * fit. Each symbol group therefore declares its own box, and the box is the one
 * `symbols.ts` drew, re-read from the file rather than taken on trust.
 */
export function symbolRects(svg: string): readonly InkRect[] {
  const rects: InkRect[] = [];
  SYMBOL_RE.lastIndex = 0;
  for (let match = SYMBOL_RE.exec(svg); match !== null; match = SYMBOL_RE.exec(svg)) {
    const attrs = match[1] ?? '';
    const region = attr(attrs, 'data-region');
    if (region === null) continue;
    const x = numAttr(attrs, 'data-sym-x');
    const y = numAttr(attrs, 'data-sym-y');
    const size = numAttr(attrs, 'data-sym-size');
    if (x === null || y === null || size === null) {
      throw new Error(`overflow: symbol in region "${region}" is missing layout attributes`);
    }
    rects.push({
      region,
      text: unescapeText(attr(attrs, 'data-symbol') ?? ''),
      left: x,
      right: x + size,
      top: y,
      bottom: y + size,
    });
  }
  return rects;
}

/** Tolerance, in user units, for float noise in the emitted attributes. */
export const OVERFLOW_EPSILON = 0.05;

/**
 * Every text run that leaves its declared box. Empty means the face is clean.
 *
 * Throws when a run names a region the document never declared a box for —
 * silently skipping such a run would let a renderer bug hide by omitting an
 * attribute.
 */
export function checkSvgOverflow(svg: string): readonly OverflowFinding[] {
  const boxes = regionBoxes(svg);
  const findings: OverflowFinding[] = [];
  for (const ink of [...inkRects(svg), ...symbolRects(svg)]) {
    const box = boxes.get(ink.region);
    if (box === undefined) {
      throw new Error(`overflow: text run names region "${ink.region}", which declares no box`);
    }
    const edges: ReadonlyArray<readonly [OverflowFinding['edge'], number]> = [
      ['left', box.x - ink.left],
      ['right', ink.right - (box.x + box.width)],
      ['top', box.y - ink.top],
      ['bottom', ink.bottom - (box.y + box.height)],
    ];
    for (const [edge, overflow] of edges) {
      if (overflow > OVERFLOW_EPSILON) {
        findings.push({ region: ink.region, text: ink.text, edge, overflow });
      }
    }
  }
  return findings;
}
