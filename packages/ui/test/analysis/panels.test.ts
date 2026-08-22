/**
 * Every panel, over a full run, rendered for real.
 *
 * The headline assertion is structural rather than cosmetic: a figure and its
 * sample-size line come in pairs, always, in every panel and every run. That is
 * the one rule the whole surface rests on, so it is checked by counting rather
 * than by spot-checking one chart.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArchetypePanel } from '../../src/routes/analysis/archetypes';
import { CardPerformancePanel, RARITY_ANY } from '../../src/routes/analysis/card-performance';
import { CompositionPanel, composeSet } from '../../src/routes/analysis/composition';
import { GameShapePanel } from '../../src/routes/analysis/game-shape';
import type { FixtureName } from './support/fixtures';
import { loadRun, loadSet } from './support/fixtures';

const SET = loadSet();

function occurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

function panelsFor(name: FixtureName): Readonly<Record<string, string>> {
  const run = loadRun(name);
  return {
    composition: renderToStaticMarkup(h(CompositionPanel, { set: SET, targets: run.targets })),
    archetypes: renderToStaticMarkup(h(ArchetypePanel, { health: run.health })),
    shape: renderToStaticMarkup(h(GameShapePanel, { health: run.health })),
    cards: renderToStaticMarkup(
      h(CardPerformancePanel, {
        cards: run.cards,
        rarity: RARITY_ANY,
        onSelectRarity: () => undefined,
      }),
    ),
  };
}

describe('the rarity filter', () => {
  it('lists rarities in rarity order, so a mythic is not filed second', () => {
    const run = loadRun('run-a');
    const promoted = {
      ...run.cards,
      entries: run.cards.entries.map((card, index) =>
        index === 0 ? { ...card, rarity: 'mythic' as const } : card,
      ),
    };
    const markup = renderToStaticMarkup(
      h(CardPerformancePanel, { cards: promoted, rarity: RARITY_ANY, onSelectRarity: () => undefined }),
    );
    const order = [...markup.matchAll(/<option value="([a-z]+)"/g)].map((match) => match[1]);
    // Alphabetically mythic sorts between common and rare; in rarity order it is last.
    expect(order.filter((value) => value !== 'all')).toStrictEqual(
      ['common', 'uncommon', 'rare', 'mythic'].filter((rarity) => order.includes(rarity)),
    );
    expect(order).toContain('mythic');
  });
});

describe('every panel over a full run', () => {
  const panels = panelsFor('run-a');

  it('renders without throwing', () => {
    for (const [name, markup] of Object.entries(panels)) {
      expect(markup.length, name).toBeGreaterThan(200);
    }
  });

  it('states a sample size on every figure', () => {
    for (const [name, markup] of Object.entries(panels)) {
      const titles = occurrences(markup, 'mtg-chart__title');
      expect(titles, name).toBeGreaterThan(0);
      expect(occurrences(markup, 'mtg-chart__sample'), name).toBeGreaterThanOrEqual(titles);
    }
  });

  it('gives every figure a table twin, so no value is hover-only', () => {
    for (const [name, markup] of Object.entries(panels)) {
      const figures = occurrences(markup, 'mtg-chart__title');
      expect(occurrences(markup, 'mtg-chart__data'), name).toBe(figures);
    }
  });

  it('withholds nothing when the run cleared its floors', () => {
    for (const [name, markup] of Object.entries(panels)) {
      // The copy explaining what withholding looks like is prose; the classes
      // below are the marks that actually stand in for a plotted value.
      expect(occurrences(markup, 'class="mtg-evidence"'), name).toBe(0);
      expect(occurrences(markup, 'class="mtg-withheld"'), name).toBe(0);
    }
  });
});

describe('set composition against the skeleton', () => {
  const run = loadRun('run-a');
  const markup = renderToStaticMarkup(h(CompositionPanel, { set: SET, targets: run.targets }));

  it('counts the whole set', () => {
    const composition = composeSet(SET, run.targets);
    expect(composition.cards).toBe(SET.cards.length);
    expect(composition.creatures).toBeGreaterThan(0);
    const bucketed = composition.curve.reduce((sum, row) => sum + row.actual, 0);
    expect(bucketed).toBe(composition.creatures);
  });

  it('gives every color, rarity and curve bucket a target tick', () => {
    const composition = composeSet(SET, run.targets);
    const rows = composition.colors.length + composition.rarities.length + composition.curve.length;
    expect(occurrences(markup, 'mtg-plot__target')).toBe(rows);
  });

  it('prints the deviation beside the count rather than the count alone', () => {
    expect(markup).toContain('on target');
    expect(markup).toContain('skeleton target');
  });

  it('names the identity in text, never color alone', () => {
    for (const target of run.targets.colors) {
      expect(markup).toContain(`data-identity="${target.identity}"`);
    }
    expect(markup).toContain('White');
    expect(markup).toContain('Colorless');
  });
});

describe('archetype health', () => {
  const run = loadRun('run-a');
  const markup = renderToStaticMarkup(h(ArchetypePanel, { health: run.health }));

  it('draws one dot per judged pair and the band behind them', () => {
    const judged = run.health.colorPairs.records.filter((record) => record.winRate.value !== null);
    expect(judged.length).toBe(10);
    expect(occurrences(markup, 'mtg-plot__ring')).toBe(judged.length);
    expect(occurrences(markup, 'mtg-plot__band"')).toBe(1);
  });

  it('draws a confidence interval for every dot', () => {
    expect(occurrences(markup, 'mtg-plot__whisker')).toBe(10);
  });

  it('calls out the spread against its limit', () => {
    expect(markup).toContain('Win-rate spread');
    expect(markup).toContain('best minus worst measured pair');
  });

  it('marks pairs outside the band as a state, with a word beside it', () => {
    const strict = loadRun('run-strict');
    const strictMarkup = renderToStaticMarkup(h(ArchetypePanel, { health: strict.health }));
    expect(strictMarkup).toContain('data-tone="negative"');
    expect(strictMarkup).toContain('Pairs inside the band');
  });
});

describe('game shape', () => {
  const run = loadRun('run-a');
  const markup = renderToStaticMarkup(h(GameShapePanel, { health: run.health }));

  it('draws the Limited median window behind the histogram', () => {
    expect(occurrences(markup, 'mtg-plot__band"')).toBe(1);
    expect(markup).toContain('median');
  });

  it('gives stall and decisiveness a limit tick each', () => {
    expect(occurrences(markup, 'mtg-meter__limit')).toBe(4);
    expect(markup).toContain('Turn-cap stalls');
    expect(markup).toContain('Inert turns');
  });
});

describe('per-card performance', () => {
  const run = loadRun('run-a');
  const markup = renderToStaticMarkup(
    h(CardPerformancePanel, {
      cards: run.cards,
      rarity: RARITY_ANY,
      onSelectRarity: () => undefined,
    }),
  );

  it('names the statistic it is actually showing', () => {
    expect(markup).toContain(run.cards.statistic);
    expect(markup).toContain('games played, not games in hand');
  });

  it('sorts best first', () => {
    const rates = run.cards.entries
      .flatMap((entry) => (entry.winRate === null ? [] : [entry.winRate]))
      .sort((a, b) => b - a);
    const first = rates[0];
    expect(first).toBeDefined();
    const firstCell = markup.indexOf('mtg-rowbar__value');
    expect(firstCell).toBeGreaterThan(0);
    if (first !== undefined) {
      expect(markup.slice(firstCell, firstCell + 80)).toContain(`${(first * 100).toFixed(1)}%`);
    }
  });
});

describe('plot geometry', () => {
  const run = loadRun('run-a');
  const markups = [
    renderToStaticMarkup(h(CompositionPanel, { set: SET, targets: run.targets })),
    renderToStaticMarkup(h(ArchetypePanel, { health: run.health })),
    renderToStaticMarkup(h(GameShapePanel, { health: run.health })),
  ];

  it('keeps every mark inside its own viewBox', () => {
    for (const markup of markups) {
      for (const svg of markup.split('<svg').slice(1)) {
        const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
        expect(viewBox).not.toBeNull();
        const width = Number(viewBox?.[1] ?? 0);
        const height = Number(viewBox?.[2] ?? 0);
        const plot = svg.slice(0, svg.indexOf('</svg>'));
        for (const match of plot.matchAll(/\b(x|cx|x1|x2)="(-?[\d.]+)"/g)) {
          expect(Number(match[2]), `${match[1]}=${match[2]} of ${width}`).toBeLessThanOrEqual(width);
          expect(Number(match[2])).toBeGreaterThanOrEqual(0);
        }
        for (const match of plot.matchAll(/\b(y|cy|y1|y2)="(-?[\d.]+)"/g)) {
          expect(Number(match[2]), `${match[1]}=${match[2]} of ${height}`).toBeLessThanOrEqual(height);
          expect(Number(match[2]), `${match[1]}=${match[2]}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
