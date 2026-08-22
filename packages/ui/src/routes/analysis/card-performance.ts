/**
 * Per-card performance: the self-play analogue of 17lands' GIH WR.
 *
 * A table, not a chart. Ninety cards is far past the point where color classes
 * stop being distinguishable, and the reader's job here is ranking and lookup
 * rather than shape — so the form is a sorted table with an inline bar for
 * scanning, and the bar is the same single hue for every row because its length
 * already carries the value.
 *
 * Two properties are load-bearing.
 *
 * **The statistic names itself.** 17lands' GIH WR needs to know which cards
 * were in hand, and the sim's replay schema records per-turn aggregates rather
 * than card instances, so what a run can actually measure is not always the
 * same statistic. The document says which one it measured and this view prints
 * that sentence rather than assuming.
 *
 * **Under-sampled cards are nulled, not dimmed.** 17lands' own `card_ratings`
 * endpoint returns null below its threshold rather than publishing noise; a
 * dashboard that renders those as a short bar has published the noise anyway.
 * The floor is re-checked here against distinct trajectories, so a producer
 * with a looser floor cannot smuggle a rate through.
 */
import { createElement } from 'react';
import { RARITIES } from '@mtg/dsl';
import type { ReactElement, ReactNode } from 'react';
import { ChartFigure, DataTable, Stat } from './chart';
import type { TableRow } from './chart';
import { NOT_ENOUGH_EVIDENCE, evidenceFor, integer, percent, sampleSize } from './evidence';
import type { Evidence } from './evidence';
import type { CardPerformance, CardPerformanceBlock } from './model';

/** 17lands marks an outlier at 1.5 standard deviations; `@mtg/metrics` copies it. */
export const OUTLIER_SIGMA = 1.5;

export interface CardRow {
  readonly card: CardPerformance;
  readonly winRate: Evidence<number>;
  /** Signed z-score against the judged cards, or `null` when not judged. */
  readonly z: number | null;
}

function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Applies the floor, sorts best-first, and pushes withheld cards to the end.
 *
 * Withheld cards sort last rather than being dropped: a card nobody has enough
 * evidence about is a fact about the run, and hiding it makes a thin run look
 * like a complete one.
 */
export function cardRows(block: CardPerformanceBlock): readonly CardRow[] {
  const withEvidence = block.entries.map((card) => ({
    card,
    winRate: evidenceFor(card.winRate, sampleSize(card.games, card.distinctGames, block.floor)),
  }));
  const judged = withEvidence.flatMap((row) => (row.winRate.plotted ? [row.winRate.value] : []));
  const deviation = standardDeviation(judged);
  const average = judged.length === 0 ? 0 : judged.reduce((sum, value) => sum + value, 0) / judged.length;

  const rows: readonly CardRow[] = withEvidence.map((row) => ({
    ...row,
    z:
      row.winRate.plotted && deviation !== null && deviation > 0
        ? (row.winRate.value - average) / deviation
        : null,
  }));

  return [...rows].sort((a, b) => {
    if (a.winRate.plotted !== b.winRate.plotted) return a.winRate.plotted ? -1 : 1;
    if (a.winRate.plotted && b.winRate.plotted) {
      if (b.winRate.value !== a.winRate.value) return b.winRate.value - a.winRate.value;
    }
    return a.card.name.localeCompare(b.card.name);
  });
}

function rateCell(row: CardRow): ReactNode {
  if (!row.winRate.plotted) {
    return createElement(
      'span',
      { className: 'mtg-withheld', title: row.winRate.reason },
      NOT_ENOUGH_EVIDENCE,
    );
  }
  const rate = row.winRate.value;
  const tone =
    row.z === null
      ? undefined
      : row.z >= OUTLIER_SIGMA
        ? 'positive'
        : row.z <= -OUTLIER_SIGMA
          ? 'negative'
          : undefined;
  return createElement(
    'span',
    tone === undefined ? { className: 'mtg-rowbar' } : { className: 'mtg-rowbar', 'data-tone': tone },
    createElement(
      'span',
      { className: 'mtg-rowbar__track' },
      createElement('span', {
        className: 'mtg-rowbar__fill',
        style: { width: `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(1)}%` },
      }),
    ),
    createElement('span', { className: 'mtg-rowbar__value' }, percent(rate)),
  );
}

function nameCell(row: CardRow): ReactNode {
  return createElement(
    'span',
    { className: 'mtg-swatch-row' },
    createElement('span', { className: 'mtg-swatch', 'data-identity': row.card.identity }),
    createElement('span', { className: 'mtg-swatch-row__name' }, row.card.name),
  );
}

function sigmaCell(row: CardRow): string {
  if (row.z === null) return '—';
  if (row.z >= OUTLIER_SIGMA) return `+${row.z.toFixed(1)}σ`;
  if (row.z <= -OUTLIER_SIGMA) return `${row.z.toFixed(1)}σ`;
  return '';
}

export const RARITY_ANY = 'all';

export interface CardPanelProps {
  readonly cards: CardPerformanceBlock;
  /** Rarity filter from the route params; `all` or a rarity name. */
  readonly rarity: string;
  readonly onSelectRarity: (rarity: string) => void;
}

export function CardPerformancePanel(props: CardPanelProps): ReactElement {
  const all = cardRows(props.cards);
  // Rarity order, not alphabetical order: `.sort()` reads common, mythic, rare,
  // uncommon, which puts the top tier second in the filter the day a set prints
  // one. A rarity the artifact carries that the DSL does not know sorts last
  // rather than disappearing.
  const present = new Set(all.map((row) => row.card.rarity));
  const rarities = [
    ...RARITIES.filter((rarity) => present.has(rarity)),
    ...[...present].filter((rarity) => !RARITIES.some((known) => known === rarity)).sort(),
  ];
  const rows = props.rarity === RARITY_ANY ? all : all.filter((row) => row.card.rarity === props.rarity);
  const judged = rows.filter((row) => row.winRate.plotted);
  const observations = rows.reduce((sum, row) => sum + row.card.games, 0);
  const distinct = rows.reduce((sum, row) => sum + row.card.distinctGames, 0);
  const sample = sampleSize(observations, distinct, props.cards.floor, 'card observations');

  const tableRows: readonly TableRow[] = rows.map((row) => ({
    key: row.card.cardId,
    cells: [
      nameCell(row),
      row.card.rarity,
      rateCell(row),
      integer(row.card.games),
      integer(row.card.distinctGames),
      sigmaCell(row),
    ],
  }));

  const filter = createElement(
    'div',
    { className: 'mtg-filters' },
    createElement('span', { className: 'mtg-filters__label' }, 'Rarity'),
    createElement(
      'label',
      { className: 'mtg-field' },
      createElement('span', { className: 'mtg-field__label' }, 'Show'),
      createElement(
        'select',
        {
          className: 'mtg-select',
          value: props.rarity,
          onChange: (event: { target: { value: string } }) => {
            props.onSelectRarity(event.target.value);
          },
        },
        createElement('option', { key: RARITY_ANY, value: RARITY_ANY }, 'all rarities'),
        ...rarities.map((rarity) => createElement('option', { key: rarity, value: rarity }, rarity)),
      ),
    ),
  );

  return createElement(
    'section',
    { className: 'mtg-analysis', 'aria-label': 'Per-card performance' },
    filter,
    createElement(
      'div',
      { className: 'mtg-stats' },
      createElement(Stat, {
        key: 'judged',
        label: 'Cards with enough evidence',
        value: `${integer(judged.length)} / ${integer(rows.length)}`,
        note: `distinct-game floor ${integer(props.cards.floor)} per card`,
        ...(judged.length === rows.length ? { tone: 'positive' as const } : { tone: 'pending' as const }),
      }),
      createElement(Stat, {
        key: 'outliers',
        label: 'Outliers',
        value: integer(rows.filter((row) => row.z !== null && Math.abs(row.z) >= OUTLIER_SIGMA).length),
        note: `at ${OUTLIER_SIGMA} standard deviations, 17lands' convention`,
      }),
      createElement(Stat, {
        key: 'statistic',
        label: 'Statistic',
        value: props.cards.statistic,
        note: props.cards.definition,
      }),
    ),
    createElement(ChartFigure, {
      title: `Per-card ${props.cards.statistic}, best first`,
      sample,
      chart: createElement(DataTable, {
        columns: ['Card', 'Rarity', props.cards.statistic, 'Observations', 'Distinct', 'Outlier'],
        rows: tableRows,
        numericFrom: 3,
      }),
      table: createElement(DataTable, {
        columns: ['Card', 'Rarity', 'Rate', 'Observations', 'Distinct', 'Wins'],
        rows: rows.map((row) => ({
          key: `${row.card.cardId}-text`,
          cells: [
            row.card.name,
            row.card.rarity,
            row.winRate.plotted ? percent(row.winRate.value) : NOT_ENOUGH_EVIDENCE,
            integer(row.card.games),
            integer(row.card.distinctGames),
            integer(row.card.wins),
          ],
        })),
        numericFrom: 2,
      }),
      note: `${props.cards.definition} A card below the floor prints "${NOT_ENOUGH_EVIDENCE}" rather than a short bar, because a short bar is still a claim.`,
    }),
  );
}
