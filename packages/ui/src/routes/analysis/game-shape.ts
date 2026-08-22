/**
 * Game shape: how long games run, and whether they end.
 *
 * The length histogram is drawn against the Limited window rather than on its
 * own axis, because "median 9.4 rounds" means nothing without knowing that
 * human Limited medians cluster at 8.4-10.2 (metrics report §2.5, §4.1). The
 * shaded region is `@mtg/metrics`' own `length.medianRounds` band, so the
 * picture and the CI gate cannot disagree about where the target is.
 *
 * Stall and decisiveness are ratios against limits, which is a meter, not a
 * chart — a one-bar bar chart is a stat tile that got lost. Each meter carries
 * its limit as a tick so a rate that is fine and a rate that is one point from
 * failing do not look the same.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  ChartFigure,
  DataTable,
  MAX_BAR_THICKNESS,
  Meter,
  Plot,
  Stat,
  axisTicks,
  barPathV,
  gridLine,
  mark,
} from './chart';
import type { LegendEntry, TableRow } from './chart';
import { NoEvidence, evidenceFor, integer, percent, sampleSize } from './evidence';
import type { Evidence } from './evidence';
import type { Decisiveness, GameLength, RunHealth } from './model';

const PLOT_WIDTH = 640;
const PLOT_HEIGHT = 200;
const COLUMN_GAP = 2;

const LEGEND: readonly LegendEntry[] = [
  { key: 'games', label: 'games ending on that round', tone: 'accent' },
  { key: 'long', label: 'the long-game tail', tone: 'pending' },
  { key: 'band', label: 'the Limited median window', tone: 'band' },
];

function histogramChart(
  length: GameLength,
  band: { min: number; max: number },
  longGameRound: number,
): ReactElement {
  const counts = length.roundHistogram;
  const lastRound = counts.length - 1;
  const firstRound = Math.max(
    1,
    counts.findIndex((count, index) => index > 0 && count > 0),
  );
  const rounds: readonly number[] = Array.from(
    { length: Math.max(1, lastRound - firstRound + 1) },
    (_, index) => firstRound + index,
  );
  const left = 38;
  const right = PLOT_WIDTH - 12;
  const baseline = PLOT_HEIGHT - 34;
  const slot = (right - left) / rounds.length;
  const columnWidth = Math.min(MAX_BAR_THICKNESS, Math.max(3, slot - COLUMN_GAP));
  const ceiling = Math.max(1, ...counts);
  const toY = (value: number): number => baseline - (value / ceiling) * (baseline - 14);
  const toX = (round: number): number => left + (round - firstRound) * slot;

  // The window is drawn only where it overlaps the rounds this run actually
  // took. A sweep whose games all end before the window opens has no band at
  // all: the alternative was a zero-width rectangle parked outside the plot,
  // which reads as "no window drawn" for the same reason but also puts a mark
  // 185 units past the viewBox in the one case a reader most needs the window.
  const windowFrom = Math.max(firstRound, band.min);
  const windowTo = Math.min(lastRound + 1, band.max + 1);

  const chrome: ReactNode[] = [
    ...(windowTo <= windowFrom
      ? []
      : [
          createElement('rect', {
            key: 'band',
            className: 'mtg-plot__band',
            x: toX(windowFrom),
            y: 8,
            width: toX(windowTo) - toX(windowFrom),
            height: baseline - 8,
          }),
        ]),
    ...axisTicks(ceiling).flatMap((tick) => [
      gridLine(`grid-${tick}`, left, toY(tick), right, toY(tick)),
      createElement(
        'text',
        {
          key: `tick-${tick}`,
          className: 'mtg-plot__tick',
          x: left - 6,
          y: toY(tick) + 3,
          textAnchor: 'end',
        },
        integer(tick),
      ),
    ]),
    createElement('line', {
      key: 'baseline',
      className: 'mtg-plot__axis',
      x1: left,
      y1: baseline,
      x2: right,
      y2: baseline,
    }),
    createElement('line', {
      key: 'median',
      className: 'mtg-plot__target',
      x1: toX(length.rounds.median) + columnWidth / 2,
      y1: 8,
      x2: toX(length.rounds.median) + columnWidth / 2,
      y2: baseline,
    }),
    createElement(
      'text',
      {
        key: 'median-label',
        className: 'mtg-plot__value',
        x: toX(length.rounds.median) + columnWidth / 2 + 6,
        y: 16,
      },
      `median ${length.rounds.median.toFixed(1)}`,
    ),
  ];

  const columns = rounds.map((round) => {
    const count = counts[round] ?? 0;
    const top = toY(count);
    const tone = round >= longGameRound ? 'pending' : 'accent';
    return mark(
      `round-${round}`,
      barPathV(toX(round), top, columnWidth, baseline - top),
      tone,
      `round ${round}: ${integer(count)} games (${percent(length.finishedByRound[round] ?? 0)} finished by here)`,
    );
  });

  const axisLabels = rounds
    .filter((round) => round % 2 === 0 || rounds.length <= 12)
    .map((round) =>
      createElement(
        'text',
        {
          key: `axis-${round}`,
          className: 'mtg-plot__tick',
          x: toX(round) + columnWidth / 2,
          y: baseline + 15,
          textAnchor: 'middle',
        },
        String(round),
      ),
    );

  return createElement(Plot, {
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    label: 'Games ending on each round, against the Limited median window',
    children: [
      ...chrome,
      ...columns,
      ...axisLabels,
      createElement(
        'text',
        { key: 'axis-title', className: 'mtg-plot__tick', x: left, y: PLOT_HEIGHT - 4 },
        'rounds (both players took a turn)',
      ),
    ],
  });
}

function histogramTable(length: GameLength): ReactElement {
  const rows: readonly TableRow[] = length.roundHistogram.flatMap((count, round) =>
    round === 0 || count === 0
      ? []
      : [
          {
            key: `round-${round}`,
            cells: [String(round), integer(count), percent(length.finishedByRound[round] ?? 0)],
          },
        ],
  );
  return createElement(DataTable, { columns: ['Round', 'Games ended', 'Finished by'], rows });
}

interface MeterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly limit: number;
  readonly direction: 'atMost' | 'atLeast';
  readonly caption: string;
}

function decisivenessMeters(result: Decisiveness, health: RunHealth): readonly ReactNode[] {
  const bands = health.bands.decisiveness;
  const specs: readonly MeterSpec[] = [
    {
      key: 'stall',
      label: 'Turn-cap stalls',
      value: result.stallRate,
      limit: bands.maxStallRate,
      direction: 'atMost',
      caption: `games that hit the turn cap · limit ${percent(bands.maxStallRate)}`,
    },
    {
      key: 'decided',
      label: `Decided by round ${integer(result.decisiveRound)}`,
      value: result.decidedByRound,
      limit: bands.minDecidedByRound,
      direction: 'atLeast',
      caption: `Browne's decisiveness criterion · floor ${percent(bands.minDecidedByRound)}`,
    },
    {
      key: 'deckOut',
      label: 'Decked out',
      value: result.deckOutRate,
      limit: bands.maxDeckOutRate,
      direction: 'atMost',
      caption: `games ending on an empty library · limit ${percent(bands.maxDeckOutRate)}`,
    },
    {
      key: 'inert',
      label: 'Inert turns',
      value: result.inertTurnRate,
      limit: bands.maxInertTurnRate,
      direction: 'atMost',
      caption: `turns where nobody advanced the board · limit ${percent(bands.maxInertTurnRate)}`,
    },
  ];
  return specs.map((spec) => {
    const failing = spec.direction === 'atMost' ? spec.value > spec.limit : spec.value < spec.limit;
    return createElement(Meter, {
      key: spec.key,
      label: spec.label,
      fill: spec.value,
      value: percent(spec.value),
      limit: spec.limit,
      caption: spec.caption,
      tone: failing ? 'negative' : 'positive',
    });
  });
}

function meterTable(result: Decisiveness, health: RunHealth): ReactElement {
  const bands = health.bands.decisiveness;
  const rows: readonly TableRow[] = [
    {
      key: 'stall',
      cells: ['Turn-cap stalls', percent(result.stallRate), `<= ${percent(bands.maxStallRate)}`],
    },
    {
      key: 'decided',
      cells: [
        `Decided by round ${integer(result.decisiveRound)}`,
        percent(result.decidedByRound),
        `>= ${percent(bands.minDecidedByRound)}`,
      ],
    },
    {
      key: 'deckOut',
      cells: ['Decked out', percent(result.deckOutRate), `<= ${percent(bands.maxDeckOutRate)}`],
    },
    { key: 'draw', cells: ['Drawn', percent(result.drawRate), '—'] },
    {
      key: 'inert',
      cells: ['Inert turns', percent(result.inertTurnRate), `<= ${percent(bands.maxInertTurnRate)}`],
    },
  ];
  return createElement(DataTable, { columns: ['Statistic', 'Observed', 'Bound'], rows, numericFrom: 1 });
}

export interface GameShapePanelProps {
  readonly health: RunHealth;
}

export function GameShapePanel(props: GameShapePanelProps): ReactElement {
  const health = props.health;
  const lengthSample = sampleSize(
    health.gameLength.samples,
    health.gameLength.distinctSamples,
    health.gameLength.floor,
  );
  const length: Evidence<GameLength> = evidenceFor(health.gameLength.value, lengthSample);
  const decisiveSample = sampleSize(
    health.decisiveness.samples,
    health.decisiveness.distinctSamples,
    health.decisiveness.floor,
  );
  const resolution: Evidence<Decisiveness> = evidenceFor(health.decisiveness.value, decisiveSample);
  const band = health.bands.length.medianRounds;

  const lengthStats: readonly ReactNode[] = length.plotted
    ? [
        createElement(Stat, {
          key: 'median',
          label: 'Median length',
          value: `${length.value.rounds.median.toFixed(1)} rounds`,
          note: `window ${band.min}-${band.max} · IQR ${length.value.rounds.iqr.toFixed(1)}`,
          tone:
            length.value.rounds.median < band.min || length.value.rounds.median > band.max
              ? 'negative'
              : 'positive',
        }),
        createElement(Stat, {
          key: 'tail',
          label: 'Long-game tail',
          value: percent(length.value.longGameShare),
          note: `round ${health.bands.length.longGameRound}+ · limit ${percent(health.bands.length.maxLongGameShare)}`,
          tone: length.value.longGameShare > health.bands.length.maxLongGameShare ? 'negative' : 'positive',
        }),
        createElement(Stat, {
          key: 'blowout',
          label: 'Blowouts',
          value: percent(length.value.blowoutShare),
          note: 'decided in four rounds or fewer',
        }),
      ]
    : [];

  return createElement(
    'section',
    { className: 'mtg-analysis', 'aria-label': 'Game shape' },
    lengthStats.length === 0 ? null : createElement('div', { className: 'mtg-stats' }, ...lengthStats),
    createElement(ChartFigure, {
      title: 'Game length against the Limited window',
      sample: lengthSample,
      legend: LEGEND,
      chart: length.plotted
        ? histogramChart(length.value, band, health.bands.length.longGameRound)
        : createElement(NoEvidence, {
            statistic: 'game-length distribution',
            reason: length.reason,
            sample: lengthSample,
          }),
      table: length.plotted
        ? histogramTable(length.value)
        : createElement(DataTable, { columns: ['Round', 'Games ended', 'Finished by'], rows: [] }),
      note: 'The shaded region is the 6-13 round median window `@mtg/metrics` gates on, widened from the human Limited cluster (8.4-10.2) because kernel v0 has no mulligans and bot play distorts length in a measured direction.',
    }),
    createElement(ChartFigure, {
      title: 'Stall and decisiveness',
      sample: decisiveSample,
      chart: resolution.plotted
        ? createElement('div', { className: 'mtg-analysis' }, ...decisivenessMeters(resolution.value, health))
        : createElement(NoEvidence, {
            statistic: 'stall and decisiveness rates',
            reason: resolution.reason,
            sample: decisiveSample,
          }),
      table: resolution.plotted
        ? meterTable(resolution.value, health)
        : createElement(DataTable, { columns: ['Statistic', 'Observed', 'Bound'], rows: [] }),
      note: 'Each meter fills to the observed rate; the tick is the bound. A rate inside its bound and a rate one point from failing should not look alike.',
    }),
  );
}
