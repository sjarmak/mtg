/**
 * Archetype health: ten color pairs, their win rates, and how much of each
 * number is real.
 *
 * A forest plot rather than a bar chart, and the choice is the point. Bars from
 * a zero baseline invite reading length as magnitude, but nobody cares that a
 * pair won 30% *of something* — they care where it sits relative to 50% and
 * whether the interval crosses the band. A dot with its 95% Wilson interval
 * says exactly that, and a pair whose interval is wide is visibly a pair we
 * know less about.
 *
 * The 40-70% band is drawn as a region behind the marks rather than as two
 * lines, so "inside the band" is a place rather than an arithmetic exercise.
 * It is the the prior project precedent `@mtg/metrics` asserts on, not a number
 * chosen here.
 *
 * Pairs below the distinct-game floor get no dot at all. Drawing a faded dot
 * for them would still read as a measurement, and the run this dashboard exists
 * to judge is exactly the kind that produces confident-looking rates off
 * repeated identical games.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { COLOR_IDENTITIES } from '../../styles/tokens';
import type { ColorIdentity } from '../../styles/tokens';
import { ChartFigure, DataTable, Plot, Stat, gridLine } from './chart';
import type { LegendEntry, TableRow } from './chart';
import { NOT_ENOUGH_EVIDENCE, evidenceFor, integer, percent, sampleSize } from './evidence';
import type { Evidence } from './evidence';
import type { ColorPairRecord, RunHealth, WinRateInterval } from './model';

const PLOT_WIDTH = 640;
const LABEL_WIDTH = 96;
const VALUE_WIDTH = 196;
const ROW_HEIGHT = 26;
const DOT_RADIUS = 5;

const LEGEND: readonly LegendEntry[] = [
  { key: 'inside', label: 'win rate, inside the band', tone: 'accent' },
  { key: 'outside', label: 'win rate, outside the band', tone: 'negative' },
  { key: 'band', label: 'the 40-70% band', tone: 'band' },
];

/** Color letters of a pair key, as identities for the swatch chips. */
export function pairIdentities(pair: string): readonly ColorIdentity[] {
  return [...pair.toLowerCase()].flatMap((letter) => {
    const match = COLOR_IDENTITIES.find((identity) => identity === letter);
    return match === undefined || match === 'm' ? [] : [match];
  });
}

export interface PairEvidence {
  readonly record: ColorPairRecord;
  readonly winRate: Evidence<number>;
  readonly interval: WinRateInterval | null;
  readonly outOfBand: boolean;
}

/** Applies the floor to every pair, and says which ones left the band. */
export function pairEvidence(health: RunHealth): readonly PairEvidence[] {
  const band = health.bands.balance.colorPairWinRate;
  return health.colorPairs.records.map((record) => {
    const sample = sampleSize(record.winRate.samples, record.winRate.distinctSamples, record.winRate.floor);
    const winRate = evidenceFor(record.winRate.value, sample);
    const interval = record.interval.value;
    return {
      record,
      winRate,
      interval: winRate.plotted ? interval : null,
      outOfBand: winRate.plotted && (winRate.value < band.min || winRate.value > band.max),
    };
  });
}

function pairLabel(pair: string): ReactElement {
  return createElement(
    'span',
    { className: 'mtg-swatch-row' },
    ...pairIdentities(pair).map((identity) =>
      createElement('span', { key: identity, className: 'mtg-swatch', 'data-identity': identity }),
    ),
    createElement('span', { className: 'mtg-swatch-row__name' }, pair),
  );
}

function forestPlot(rows: readonly PairEvidence[], band: { min: number; max: number }): ReactElement {
  const left = LABEL_WIDTH;
  const right = PLOT_WIDTH - VALUE_WIDTH;
  const span = right - left;
  const toX = (rate: number): number => left + rate * span;
  const height = rows.length * ROW_HEIGHT + 22;
  const plotBottom = rows.length * ROW_HEIGHT;

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const chrome: ReactNode[] = [
    createElement('rect', {
      key: 'band',
      className: 'mtg-plot__band',
      x: toX(band.min),
      y: 0,
      width: toX(band.max) - toX(band.min),
      height: plotBottom,
    }),
    ...ticks.map((tick) => gridLine(`grid-${tick}`, toX(tick), 0, toX(tick), plotBottom)),
    ...ticks.map((tick) =>
      createElement(
        'text',
        {
          key: `tick-${tick}`,
          className: 'mtg-plot__tick',
          x: toX(tick),
          y: plotBottom + 14,
          textAnchor: 'middle',
        },
        percent(tick, 0),
      ),
    ),
  ];

  const marks = rows.flatMap((row, index) => {
    const y = index * ROW_HEIGHT + ROW_HEIGHT / 2;
    const label = createElement(
      'text',
      {
        key: `${row.record.pair}-label`,
        className: 'mtg-plot__label',
        x: left - 8,
        y: y + 4,
        textAnchor: 'end',
      },
      row.record.pair,
    );
    if (!row.winRate.plotted) {
      return [
        label,
        createElement(
          'text',
          { key: `${row.record.pair}-none`, className: 'mtg-plot__tick', x: left + 6, y: y + 4 },
          `${NOT_ENOUGH_EVIDENCE} · ${row.winRate.reason}`,
        ),
      ];
    }
    const tone = row.outOfBand ? 'negative' : 'accent';
    const rate = row.winRate.value;
    const interval = row.interval;
    const whisker =
      interval === null
        ? []
        : [
            createElement('line', {
              key: `${row.record.pair}-ci`,
              className: 'mtg-plot__whisker',
              'data-tone': tone,
              x1: toX(interval.low),
              y1: y,
              x2: toX(interval.high),
              y2: y,
            }),
          ];
    return [
      label,
      ...whisker,
      createElement(
        'circle',
        {
          key: `${row.record.pair}-dot`,
          className: 'mtg-plot__mark mtg-plot__ring',
          'data-tone': tone,
          cx: toX(rate),
          cy: y,
          r: DOT_RADIUS,
        },
        createElement(
          'title',
          { key: 'title' },
          `${row.record.pair}: ${percent(rate)}${interval === null ? '' : ` [95% CI ${percent(interval.low)}-${percent(interval.high)}]`} over ${integer(row.record.wins + row.record.losses)} decided games`,
        ),
      ),
      createElement(
        'text',
        { key: `${row.record.pair}-value`, className: 'mtg-plot__value', x: right + 10, y: y + 4 },
        interval === null
          ? percent(rate)
          : `${percent(rate)}  [${percent(interval.low)}-${percent(interval.high)}]`,
      ),
    ];
  });

  return createElement(Plot, {
    width: PLOT_WIDTH,
    height,
    label: 'Win rate with 95% confidence interval per color pair, against the 40-70% band',
    children: [...chrome, ...marks],
  });
}

function pairTable(rows: readonly PairEvidence[]): ReactElement {
  const tableRows: readonly TableRow[] = rows.map((row) => ({
    key: row.record.pair,
    cells: [
      pairLabel(row.record.pair),
      integer(row.record.games),
      `${integer(row.record.wins)}-${integer(row.record.losses)}-${integer(row.record.draws)}`,
      row.winRate.plotted ? percent(row.winRate.value) : NOT_ENOUGH_EVIDENCE,
      row.interval === null ? '—' : `${percent(row.interval.low)}-${percent(row.interval.high)}`,
      integer(row.record.winRate.distinctSamples),
    ],
  }));
  return createElement(DataTable, {
    columns: ['Pair', 'Games', 'W-L-D', 'Win rate', '95% CI', 'Distinct'],
    rows: tableRows,
  });
}

export interface ArchetypePanelProps {
  readonly health: RunHealth;
}

export function ArchetypePanel(props: ArchetypePanelProps): ReactElement {
  const rows = pairEvidence(props.health);
  const band = props.health.bands.balance.colorPairWinRate;
  const judged = rows.filter((row) => row.winRate.plotted);
  const outside = judged.filter((row) => row.outOfBand);
  const spread = props.health.colorPairs.spread;
  const maxSpread = props.health.bands.balance.maxWinRateSpread;
  const floor = rows[0]?.record.winRate.floor ?? 0;

  const sample = sampleSize(props.health.games, props.health.distinctGames, floor);

  const spreadStat =
    spread === null
      ? createElement(Stat, {
          key: 'spread',
          label: 'Win-rate spread',
          value: NOT_ENOUGH_EVIDENCE,
          note: 'fewer than two pairs cleared their sample floor',
          tone: 'pending',
        })
      : createElement(Stat, {
          key: 'spread',
          label: 'Win-rate spread',
          value: percent(spread),
          note: `best minus worst measured pair · limit ${percent(maxSpread)}`,
          tone: spread > maxSpread ? 'negative' : 'positive',
        });

  return createElement(
    'section',
    { className: 'mtg-analysis', 'aria-label': 'Archetype health' },
    createElement(
      'div',
      { className: 'mtg-stats' },
      spreadStat,
      createElement(Stat, {
        key: 'inside',
        label: 'Pairs inside the band',
        // Nothing judged is not "every pair inside the band": there is no
        // fraction to print and nothing to be green about.
        value:
          judged.length === 0
            ? NOT_ENOUGH_EVIDENCE
            : `${integer(judged.length - outside.length)} / ${integer(judged.length)}`,
        note: `${percent(band.min, 0)}-${percent(band.max, 0)} · ${integer(rows.length - judged.length)} pairs unjudged`,
        tone: judged.length === 0 ? 'pending' : outside.length === 0 ? 'positive' : 'negative',
      }),
      createElement(Stat, {
        key: 'mirrors',
        label: 'Mirror games excluded',
        value: integer(props.health.colorPairs.mirrorGames),
        note: 'a pair playing itself drags every rate toward 50%',
      }),
    ),
    createElement(ChartFigure, {
      title: 'Color-pair win rate with 95% confidence interval',
      sample,
      legend: LEGEND,
      chart: forestPlot(rows, band),
      table: pairTable(rows),
      note: `Intervals are Wilson score at 95%. Each pair is judged against its own distinct-game floor of ${integer(floor)}; a pair below it is not plotted, because a seeded run that replays one line is one piece of evidence however many rows it wrote.`,
    }),
  );
}
