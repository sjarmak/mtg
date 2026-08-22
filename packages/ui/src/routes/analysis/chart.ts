/**
 * Chart primitives, shared by every panel on this route.
 *
 * Three rules are built into the primitives rather than left to each caller,
 * because a rule a caller has to remember is a rule that eventually gets
 * forgotten in a hurry:
 *
 *  1. **A figure cannot be rendered without its sample size.** `ChartFigure`
 *     takes `sample` as a required prop; there is no overload without it.
 *  2. **Every figure ships a table twin.** The `table` prop is required too, so
 *     no value on this route is reachable only by hovering a mark. The table
 *     rides in a `<details>` so it is one keypress away without crowding the
 *     page.
 *  3. **Marks carry a `<title>`.** That is the hover and focus readout, and it
 *     costs no DOM access, which this package does not have (`lib: dom` is off
 *     by design — see `src/index.ts`).
 *
 * Bar geometry follows the mark spec: 4px rounded at the data end, square at
 * the baseline, and a 2px surface gap between neighbors rather than a stroke.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderCopy } from '../../copy';
import { SampleNote } from './evidence';
import type { SampleSize } from './evidence';
import { ANALYSIS_CSS } from './styles';

/** Mount once per analysis surface, above the panels. */
export function AnalysisStyles(): ReactElement {
  return createElement('style', { 'data-mtg-ui': 'analysis' }, ANALYSIS_CSS);
}

/** Marks are one hue unless the value's meaning is a state. */
export type MarkTone = 'accent' | 'positive' | 'negative' | 'pending' | 'muted';

export const BAR_RADIUS = 4;
/** Mark spec ceiling: never let a bar fill its band. */
export const MAX_BAR_THICKNESS = 24;

/** Horizontal bar growing right from `x`; the right end is the data end. */
export function barPathH(x: number, y: number, width: number, height: number): string {
  const r = Math.max(0, Math.min(BAR_RADIUS, width / 2, height / 2));
  if (width <= 0) return '';
  const right = x + width;
  const bottom = y + height;
  return [
    `M ${x} ${y}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    `V ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H ${x}`,
    'Z',
  ].join(' ');
}

/** Column growing up to `y`; the top is the data end, the baseline is square. */
export function barPathV(x: number, y: number, width: number, height: number): string {
  const r = Math.max(0, Math.min(BAR_RADIUS, width / 2, height / 2));
  if (height <= 0) return '';
  const right = x + width;
  const bottom = y + height;
  return [
    `M ${x} ${bottom}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `H ${right - r}`,
    `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
    `V ${bottom}`,
    'Z',
  ].join(' ');
}

export interface PlotProps {
  readonly width: number;
  readonly height: number;
  /** The chart's accessible name; the reader gets this before any mark. */
  readonly label: string;
  readonly children: readonly ReactNode[];
}

export function Plot(props: PlotProps): ReactElement {
  return createElement(
    'svg',
    {
      className: 'mtg-plot',
      viewBox: `0 0 ${props.width} ${props.height}`,
      role: 'img',
      'aria-label': props.label,
      preserveAspectRatio: 'xMinYMin meet',
      // A plot is a fixed coordinate system with absolute type inside it: the
      // 11px label and 10px tick are those sizes only while the element
      // renders at the width the geometry was laid out for. Left to fill its
      // container it does not: measured in Chrome at a 1440px window, the
      // forest plot came out 1297x571 against a 640x282 viewBox, its labels
      // at 22px. The cap travels with the viewBox rather than living in the
      // sheet, so the two cannot disagree.
      style: { maxWidth: `${props.width}px` },
    },
    ...props.children,
  );
}

/** A mark with its own hover/focus readout. */
export function mark(key: string, d: string, tone: MarkTone, title: string): ReactElement {
  return createElement(
    'path',
    { key, className: 'mtg-plot__mark', 'data-tone': tone, d },
    createElement('title', { key: 'title' }, title),
  );
}

export interface LegendEntry {
  readonly key: string;
  readonly label: string;
  readonly tone: MarkTone | 'target' | 'band';
}

export function Legend(props: { readonly entries: readonly LegendEntry[] }): ReactElement | null {
  if (props.entries.length < 2) return null;
  return createElement(
    'div',
    { className: 'mtg-chart__legend' },
    ...props.entries.map((entry) =>
      createElement(
        'span',
        { key: entry.key, className: 'mtg-key', 'data-tone': entry.tone },
        createElement('span', { className: 'mtg-key__mark' }),
        entry.label,
      ),
    ),
  );
}

export interface TableRow {
  readonly key: string;
  readonly cells: readonly ReactNode[];
}

export interface DataTableProps {
  readonly columns: readonly string[];
  readonly rows: readonly TableRow[];
  /** Columns after this index are right-aligned numbers. */
  readonly numericFrom?: number;
}

/** The WCAG-clean twin of a chart: the same numbers, as text. */
export function DataTable(props: DataTableProps): ReactElement {
  const numericFrom = props.numericFrom ?? 1;
  const head = createElement(
    'tr',
    null,
    ...props.columns.map((column, index) =>
      createElement(
        'th',
        index >= numericFrom ? { key: column, 'data-align': 'right' } : { key: column },
        column,
      ),
    ),
  );
  const body = props.rows.map((row) =>
    createElement(
      'tr',
      { key: row.key },
      ...row.cells.map((cell, index) =>
        createElement(
          'td',
          index >= numericFrom
            ? { key: String(index), 'data-align': 'right', className: 'mtg-num' }
            : { key: String(index) },
          cell,
        ),
      ),
    ),
  );
  return createElement(
    'div',
    { className: 'mtg-scroll' },
    createElement(
      'table',
      { className: 'mtg-table' },
      createElement('thead', null, head),
      createElement('tbody', null, ...body),
    ),
  );
}

export interface ChartFigureProps {
  readonly title: string;
  /** Required. A chart without its denominator is a vibe, not a measurement. */
  readonly sample: SampleSize;
  readonly note?: string;
  readonly legend?: readonly LegendEntry[];
  /** The plot, or the `NoEvidence` block that stands in for it. */
  readonly chart: ReactNode;
  /** Required. Every value stays reachable without hovering anything. */
  readonly table: ReactNode;
}

export function ChartFigure(props: ChartFigureProps): ReactElement {
  return createElement(
    'figure',
    { className: 'mtg-chart' },
    createElement(
      'figcaption',
      { className: 'mtg-chart__head' },
      createElement('span', { className: 'mtg-chart__title' }, props.title),
      createElement(SampleNote, { sample: props.sample }),
    ),
    props.legend === undefined ? null : createElement(Legend, { entries: props.legend }),
    createElement('div', { className: 'mtg-chart__body' }, props.chart),
    props.note === undefined
      ? null
      : createElement('p', { className: 'mtg-chart__note' }, renderCopy(props.note)),
    createElement(
      'details',
      { className: 'mtg-chart__data' },
      createElement('summary', null, 'Table view'),
      props.table,
    ),
  );
}

export interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly tone?: 'positive' | 'negative' | 'pending';
}

export function Stat(props: StatProps): ReactElement {
  return createElement(
    'div',
    props.tone === undefined ? { className: 'mtg-stat' } : { className: 'mtg-stat', 'data-tone': props.tone },
    createElement('span', { className: 'mtg-stat__label' }, props.label),
    createElement('span', { className: 'mtg-stat__value' }, props.value),
    props.note === undefined
      ? null
      : createElement('span', { className: 'mtg-stat__note' }, renderCopy(props.note)),
  );
}

export interface MeterProps {
  readonly label: string;
  /** 0-1 share of the track. */
  readonly fill: number;
  readonly value: string;
  /** 0-1 position of the limit tick, when the value is judged against one. */
  readonly limit?: number;
  readonly caption?: string;
  readonly tone?: 'positive' | 'negative' | 'pending';
}

/** A single ratio against a limit — the form a one-bar bar chart should be. */
export function Meter(props: MeterProps): ReactElement {
  const clamped = Math.max(0, Math.min(1, props.fill));
  return createElement(
    'div',
    props.tone === undefined
      ? { className: 'mtg-meter' }
      : { className: 'mtg-meter', 'data-tone': props.tone },
    createElement('span', { className: 'mtg-meter__label' }, props.label),
    createElement('span', { className: 'mtg-meter__value' }, props.value),
    createElement(
      'div',
      { className: 'mtg-meter__track' },
      createElement('span', {
        className: 'mtg-meter__fill',
        style: { width: `${(clamped * 100).toFixed(2)}%` },
      }),
      props.limit === undefined
        ? null
        : createElement('span', {
            className: 'mtg-meter__limit',
            style: { left: `${(Math.max(0, Math.min(1, props.limit)) * 100).toFixed(2)}%` },
          }),
    ),
    props.caption === undefined
      ? null
      : createElement('span', { className: 'mtg-meter__caption' }, props.caption),
  );
}

/**
 * Round tick values for an axis running 0..max.
 *
 * The last tick never exceeds `max`, because a tick above the domain lands
 * outside the plot: gridlines run off the right edge and their labels off the
 * top. `test/analysis/panels.test.ts` asserts no mark escapes its viewBox,
 * which is how that showed up.
 */
export function axisTicks(max: number, count = 4): readonly number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rough) ?? magnitude;
  const out: number[] = [];
  for (let value = 0; value <= max; value += step) out.push(Number(value.toFixed(6)));
  return out;
}

/** Recessive hairline, solid — never dashed. */
export function gridLine(key: string, x1: number, y1: number, x2: number, y2: number): ReactElement {
  return createElement('line', { key, className: 'mtg-plot__grid', x1, y1, x2, y2 });
}
