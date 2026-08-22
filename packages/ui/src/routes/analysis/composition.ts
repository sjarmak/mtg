/**
 * Set composition, always against the skeleton it was generated from.
 *
 * The brief for this panel is that deviation is the visible thing. A curve
 * drawn on its own says "these are the mana values"; a curve drawn with its
 * target says "you are two cards short at three". So every bar here carries a
 * target tick, and the value beside it is the count *and* the signed miss.
 *
 * The +/-1 card tolerance is not invented here — it is the one
 * `@mtg/setgen`'s `validate/composition.ts` asserts, on the set-design lane's
 * reasoning that real WotC sets deviate from their own skeletons. Curve fitting
 * mirrors the same module's fill-to-capacity pass for the same reason:
 * published curve buckets overlap ("1-2" beside "2-2"), and first-match
 * assignment would pile every two-drop into the wider bucket and report a
 * mismatch that is not in the set. Two surfaces disagreeing about whether a set
 * conforms would be worse than either being wrong alone.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card } from '@mtg/dsl';
import { cardManaValue } from '@mtg/dsl';
import { cardColorIdentity } from '../../card/identity';
import { IDENTITY_LABELS } from '../../styles/tokens';
import type { ColorIdentity } from '../../styles/tokens';
import {
  ChartFigure,
  DataTable,
  Meter,
  Plot,
  Stat,
  axisTicks,
  barPathH,
  barPathV,
  gridLine,
  mark,
} from './chart';
import type { LegendEntry, MarkTone, TableRow } from './chart';
import { census, integer, percent } from './evidence';
import type { CurveTarget, SetDocument, SkeletonTargets } from './model';

/** One card of slack per bucket; `@mtg/setgen` asserts the same number. */
export const COMPOSITION_TOLERANCE = 1;

const TARGET_LEGEND: readonly LegendEntry[] = [
  { key: 'measured', label: 'printed', tone: 'accent' },
  { key: 'target', label: 'skeleton target', tone: 'target' },
];

export interface CompositionRow {
  readonly key: string;
  readonly label: string;
  readonly actual: number;
  readonly target: number;
  readonly identity?: ColorIdentity;
}

function miss(row: CompositionRow): number {
  return row.actual - row.target;
}

function toneFor(row: CompositionRow): MarkTone {
  return Math.abs(miss(row)) > COMPOSITION_TOLERANCE ? 'pending' : 'accent';
}

function signed(value: number): string {
  if (value === 0) return 'on target';
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Fill-to-capacity curve fit, ported from `@mtg/setgen`'s
 * `validate/composition.ts` so both surfaces bucket a set identically.
 */
export function fitCurve(manaValues: readonly number[], buckets: readonly CurveTarget[]): readonly number[] {
  const counts = buckets.map(() => 0);
  const fits = (bucket: CurveTarget, value: number): boolean =>
    value >= bucket.mvMin && (bucket.mvMax === null || value <= bucket.mvMax);
  for (const value of [...manaValues].sort((a, b) => a - b)) {
    const withRoom = buckets.findIndex(
      (bucket, index) => fits(bucket, value) && (counts[index] ?? 0) < bucket.cards,
    );
    const index = withRoom >= 0 ? withRoom : buckets.findIndex((bucket) => fits(bucket, value));
    if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

export interface Composition {
  readonly cards: number;
  readonly creatures: number;
  readonly creatureShare: number;
  readonly colors: readonly CompositionRow[];
  readonly rarities: readonly CompositionRow[];
  readonly curve: readonly CompositionRow[];
  /**
   * Creatures whose mana value falls in no target bucket.
   *
   * The fit drops them, as `@mtg/setgen` does, and a chart that drops cards
   * without saying so reports a curve for a set it did not finish reading.
   */
  readonly curveUnbucketed: number;
}

/** Counts a parsed set against its skeleton targets. Pure; no rendering. */
export function composeSet(set: SetDocument, targets: SkeletonTargets): Composition {
  const creatures = set.cards.filter((card) => card.kind === 'creature');
  const byIdentity = new Map<ColorIdentity, number>();
  for (const card of set.cards) {
    const id = cardColorIdentity(card);
    byIdentity.set(id, (byIdentity.get(id) ?? 0) + 1);
  }
  const byRarity = new Map<string, number>();
  for (const card of set.cards) byRarity.set(card.rarity, (byRarity.get(card.rarity) ?? 0) + 1);

  const curveCounts = fitCurve(
    creatures.map((card: Card) => cardManaValue(card)),
    targets.curve,
  );

  const bucketed = curveCounts.reduce((sum, count) => sum + count, 0);

  return {
    cards: set.cards.length,
    creatures: creatures.length,
    curveUnbucketed: creatures.length - bucketed,
    creatureShare: set.cards.length === 0 ? 0 : creatures.length / set.cards.length,
    colors: targets.colors.map((target) => ({
      key: `color-${target.identity}`,
      label: IDENTITY_LABELS[target.identity],
      actual: byIdentity.get(target.identity) ?? 0,
      target: target.cards,
      identity: target.identity,
    })),
    rarities: targets.rarities.map((target) => ({
      key: `rarity-${target.rarity}`,
      label: target.rarity,
      actual: byRarity.get(target.rarity) ?? 0,
      target: target.cards,
    })),
    curve: targets.curve.map((bucket, index) => ({
      key: `curve-${bucket.label}`,
      label: bucket.label,
      actual: curveCounts[index] ?? 0,
      target: bucket.cards,
    })),
  };
}

const ROW_HEIGHT = 26;
const BAR_HEIGHT = 14;
const LABEL_WIDTH = 116;
const VALUE_WIDTH = 150;
const PLOT_WIDTH = 640;

function rowsChart(title: string, rows: readonly CompositionRow[]): ReactElement {
  const plotLeft = LABEL_WIDTH;
  const plotRight = PLOT_WIDTH - VALUE_WIDTH;
  const span = plotRight - plotLeft;
  const ceiling = Math.max(1, ...rows.map((row) => Math.max(row.actual, row.target)));
  const height = rows.length * ROW_HEIGHT + 22;
  const scale = (value: number): number => (value / ceiling) * span;

  const grid = axisTicks(ceiling).map((tick) =>
    gridLine(`grid-${tick}`, plotLeft + scale(tick), 4, plotLeft + scale(tick), rows.length * ROW_HEIGHT),
  );
  const tickLabels = axisTicks(ceiling).map((tick) =>
    createElement(
      'text',
      {
        key: `tick-${tick}`,
        className: 'mtg-plot__tick',
        x: plotLeft + scale(tick),
        y: rows.length * ROW_HEIGHT + 14,
        textAnchor: 'middle',
      },
      integer(tick),
    ),
  );

  const marks = rows.flatMap((row, index) => {
    const top = index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
    const width = scale(row.actual);
    const targetX = plotLeft + scale(row.target);
    return [
      createElement(
        'text',
        {
          key: `${row.key}-label`,
          className: 'mtg-plot__label',
          x: plotLeft - 8,
          y: top + BAR_HEIGHT - 3,
          textAnchor: 'end',
        },
        row.label,
      ),
      mark(
        `${row.key}-bar`,
        barPathH(plotLeft, top, width, BAR_HEIGHT),
        toneFor(row),
        `${row.label}: ${integer(row.actual)} printed, ${integer(row.target)} planned (${signed(miss(row))})`,
      ),
      createElement('line', {
        key: `${row.key}-target`,
        className: 'mtg-plot__target',
        x1: targetX,
        y1: top - 3,
        x2: targetX,
        y2: top + BAR_HEIGHT + 3,
      }),
      createElement(
        'text',
        {
          key: `${row.key}-value`,
          className: 'mtg-plot__value',
          x: plotRight + 10,
          y: top + BAR_HEIGHT - 3,
        },
        `${integer(row.actual)} / ${integer(row.target)} · ${signed(miss(row))}`,
      ),
    ];
  });

  return createElement(Plot, {
    width: PLOT_WIDTH,
    height,
    label: title,
    children: [...grid, ...tickLabels, ...marks],
  });
}

const COLUMN_WIDTH = 22;
const COLUMN_GAP = 2;
const CURVE_HEIGHT = 168;

function curveChart(rows: readonly CompositionRow[]): ReactElement {
  const left = 34;
  const baseline = CURVE_HEIGHT - 34;
  const slot = Math.min(72, (PLOT_WIDTH - left - 16) / Math.max(1, rows.length));
  const ceiling = Math.max(1, ...rows.map((row) => Math.max(row.actual, row.target)));
  const toY = (value: number): number => baseline - (value / ceiling) * (baseline - 12);

  const grid = axisTicks(ceiling).flatMap((tick) => [
    gridLine(`grid-${tick}`, left, toY(tick), left + slot * rows.length, toY(tick)),
    createElement(
      'text',
      { key: `tick-${tick}`, className: 'mtg-plot__tick', x: left - 6, y: toY(tick) + 3, textAnchor: 'end' },
      integer(tick),
    ),
  ]);

  const marks = rows.flatMap((row, index) => {
    const center = left + slot * index + slot / 2;
    const x = center - COLUMN_WIDTH / 2 + COLUMN_GAP / 2;
    const top = toY(row.actual);
    const targetY = toY(row.target);
    return [
      mark(
        `${row.key}-col`,
        barPathV(x, top, COLUMN_WIDTH - COLUMN_GAP, baseline - top),
        toneFor(row),
        `MV ${row.label}: ${integer(row.actual)} printed, ${integer(row.target)} planned (${signed(miss(row))})`,
      ),
      createElement('line', {
        key: `${row.key}-target`,
        className: 'mtg-plot__target',
        x1: center - COLUMN_WIDTH / 2 - 3,
        y1: targetY,
        x2: center + COLUMN_WIDTH / 2 + 3,
        y2: targetY,
      }),
      createElement(
        'text',
        { key: `${row.key}-cap`, className: 'mtg-plot__value', x: center, y: top - 6, textAnchor: 'middle' },
        integer(row.actual),
      ),
      createElement(
        'text',
        {
          key: `${row.key}-axis`,
          className: 'mtg-plot__label',
          x: center,
          y: baseline + 16,
          textAnchor: 'middle',
        },
        row.label,
      ),
    ];
  });

  return createElement(Plot, {
    width: PLOT_WIDTH,
    height: CURVE_HEIGHT,
    label: 'Creature curve against the skeleton target',
    children: [
      ...grid,
      createElement('line', {
        key: 'baseline',
        className: 'mtg-plot__axis',
        x1: left,
        y1: baseline,
        x2: left + slot * rows.length,
        y2: baseline,
      }),
      ...marks,
    ],
  });
}

function rowTable(rows: readonly CompositionRow[], header: string): ReactElement {
  const tableRows: readonly TableRow[] = rows.map((row) => ({
    key: row.key,
    cells: [
      row.identity === undefined
        ? row.label
        : createElement(
            'span',
            { className: 'mtg-swatch-row' },
            createElement('span', { className: 'mtg-swatch', 'data-identity': row.identity }),
            createElement('span', { className: 'mtg-swatch-row__name' }, row.label),
          ),
      integer(row.actual),
      integer(row.target),
      signed(miss(row)),
    ],
  }));
  return createElement(DataTable, { columns: [header, 'Printed', 'Target', 'Miss'], rows: tableRows });
}

/** Names the creatures the curve could not place, when there are any. */
function unbucketedNote(composition: Composition): string {
  if (composition.curveUnbucketed === 0) return '';
  return ` ${integer(composition.curveUnbucketed)} of the ${integer(composition.creatures)} creatures in the set have a mana value no bucket covers, and are drawn in none of these bars.`;
}

export interface CompositionPanelProps {
  readonly set: SetDocument;
  readonly targets: SkeletonTargets;
}

export function CompositionPanel(props: CompositionPanelProps): ReactElement {
  const composition = composeSet(props.set, props.targets);
  const sample = census(composition.cards, 'cards');
  const shareMiss = composition.creatureShare - props.targets.creatureShare;
  const sizeMiss = composition.cards - props.targets.setSize;
  const offTarget = [...composition.colors, ...composition.rarities, ...composition.curve].filter(
    (row) => Math.abs(miss(row)) > COMPOSITION_TOLERANCE,
  );

  const stats: readonly ReactNode[] = [
    createElement(Stat, {
      key: 'size',
      label: 'Cards printed',
      value: integer(composition.cards),
      note: `target ${integer(props.targets.setSize)} · ${signed(sizeMiss)}`,
      ...(Math.abs(sizeMiss) > COMPOSITION_TOLERANCE ? { tone: 'pending' as const } : {}),
    }),
    createElement(Stat, {
      key: 'buckets',
      label: 'Buckets off target',
      value: integer(offTarget.length),
      note: `of ${integer(composition.colors.length + composition.rarities.length + composition.curve.length)}, tolerance +/-${COMPOSITION_TOLERANCE}`,
      ...(offTarget.length > 0 ? { tone: 'pending' as const } : { tone: 'positive' as const }),
    }),
    createElement(Stat, {
      key: 'profile',
      label: 'Skeleton profile',
      value: props.targets.profile,
      note: `${props.set.code} · ${props.set.name}`,
    }),
  ];

  return createElement(
    'section',
    { className: 'mtg-analysis', 'aria-label': 'Set composition' },
    createElement('div', { className: 'mtg-stats' }, ...stats),
    createElement(Meter, {
      label: 'Creature share',
      fill: composition.creatureShare,
      value: `${percent(composition.creatureShare)} of ${integer(composition.cards)}`,
      limit: props.targets.creatureShare,
      caption: `skeleton target ${percent(props.targets.creatureShare)} (tick) · ${integer(composition.creatures)} creatures · miss ${(shareMiss * 100).toFixed(1)}pp`,
      ...(Math.abs(shareMiss) > 0.05 ? { tone: 'pending' as const } : {}),
    }),
    createElement(
      'div',
      { className: 'mtg-analysis__row' },
      createElement(ChartFigure, {
        key: 'colors',
        title: 'Color balance against the skeleton',
        sample,
        legend: TARGET_LEGEND,
        chart: rowsChart('Cards per color identity against the skeleton target', composition.colors),
        table: rowTable(composition.colors, 'Identity'),
        note: 'Identity is the row label, not the bar color: the five color tokens are semantic (white is pale, colorless is gray) and fail the categorical contrast and color-vision checks, so they are never asked to carry identity on their own.',
      }),
      createElement(ChartFigure, {
        key: 'rarities',
        title: 'Rarity distribution against the skeleton',
        sample,
        legend: TARGET_LEGEND,
        chart: rowsChart('Cards per rarity against the skeleton target', composition.rarities),
        table: rowTable(composition.rarities, 'Rarity'),
      }),
    ),
    createElement(ChartFigure, {
      title: 'Creature curve against the skeleton',
      // The census counts the creatures the chart drew, not the ones it was
      // handed: a bucket list that does not cover the set leaves creatures out
      // of every bar, and the count under the title is what the bars add to.
      sample: census(composition.creatures - composition.curveUnbucketed, 'creatures'),
      legend: TARGET_LEGEND,
      chart: curveChart(composition.curve),
      table: rowTable(composition.curve, 'Mana value'),
      note: `Buckets are filled to capacity before spilling over, the same fit \`@mtg/setgen\` validates with, because published curve buckets overlap. Tolerance is +/-${COMPOSITION_TOLERANCE} card per bucket.${unbucketedNote(composition)}`,
    }),
  );
}
