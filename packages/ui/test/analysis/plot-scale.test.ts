/**
 * A plot renders at the width its type was drawn for.
 *
 * Every chart on this route is a fixed 640-unit coordinate system with
 * absolute type inside it: `.mtg-plot__label` is 11px, `.mtg-plot__tick` is
 * 10px. Those sizes hold only while the `<svg>` renders at its design width.
 * The sheet says `width: 100%`, so it did not. Measured in Chrome on these
 * fixtures before the fix: the forest plot rendered 1297x571 against a 640x282
 * viewBox at a 1440px window (2.03x, its 11px labels at 22px), and the
 * composition color chart rendered 331px wide inside the row's two columns at
 * a 900px window (0.52x, labels at 5.7px). Neither shows up in markup, which
 * is why it survived to here.
 *
 * Two things hold the scale: the element caps at the width its viewBox
 * declares, and the multi-column analysis row states its column minimum in
 * terms of that width. Measured again after: 640x282 for the forest plot at
 * 1440, and 640 for the composition color chart at 900.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_CSS } from '../../src/routes/analysis/styles';
import { ArchetypePanel } from '../../src/routes/analysis/archetypes';
import { CompositionPanel } from '../../src/routes/analysis/composition';
import { GameShapePanel } from '../../src/routes/analysis/game-shape';
import { loadRun, loadSet } from './support/fixtures';

const RUN = loadRun('run-a');
const SET = loadSet();

const MARKUP: readonly string[] = [
  renderToStaticMarkup(h(CompositionPanel, { set: SET, targets: RUN.targets })),
  renderToStaticMarkup(h(ArchetypePanel, { health: RUN.health })),
  renderToStaticMarkup(h(GameShapePanel, { health: RUN.health })),
];

interface Plot {
  readonly designWidth: number;
  readonly maxWidth: number | null;
}

function plots(markup: string): readonly Plot[] {
  return markup
    .split('<svg')
    .slice(1)
    .map((svg) => {
      const tag = svg.slice(0, svg.indexOf('>'));
      return {
        designWidth: Number(/viewBox="0 0 (\d+) \d+"/.exec(tag)?.[1] ?? 0),
        maxWidth: tag.includes('max-width')
          ? Number(/max-width:\s*(\d+)px/.exec(tag)?.[1] ?? Number.NaN)
          : null,
      };
    });
}

const ALL: readonly Plot[] = MARKUP.flatMap((markup) => plots(markup));

describe('every plot', () => {
  it('is found, so the assertions below are about something', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(4);
    for (const plot of ALL) expect(plot.designWidth).toBeGreaterThan(0);
  });

  it('caps at the width its own coordinate system was drawn for', () => {
    for (const plot of ALL) expect(plot.maxWidth).toBe(plot.designWidth);
  });

  it('may still shrink below it, so a narrow page has no sideways scroll', () => {
    expect(ANALYSIS_CSS).toContain('.mtg-plot { display: block; width: 100%;');
  });
});

describe('the two-column analysis row', () => {
  /**
   * The declared minimum, not the measured one. Chrome computes the repetition
   * count of `auto-fit` with a percentage minimum as if that minimum were
   * indefinite, so a 1440px window still lays two 601px columns rather than
   * one — 0.94x, close enough to read. What this pins is the intent: the
   * minimum is stated in terms of the plots, so a chart drawn wider than the
   * row was written for fails here rather than shrinking silently in a lab.
   * The `min(100%, …)` form is load-bearing too: a bare `40rem` minimum
   * overflows a phone-width page sideways.
   */
  it('states a column minimum at least as wide as the plots it holds', () => {
    const widest = Math.max(...ALL.map((plot) => plot.designWidth));
    const column = /\.mtg-analysis__row \{[^}]*minmax\(min\(100%, ([\d.]+)rem\)/.exec(ANALYSIS_CSS);
    expect(column, '.mtg-analysis__row must size its columns with minmax(min(100%, Nrem), …)').not.toBeNull();
    expect(Number(column?.[1] ?? 0) * 16).toBeGreaterThanOrEqual(widest);
  });
});
