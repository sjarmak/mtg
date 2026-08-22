/**
 * Two charts against data the committed fixtures cannot produce.
 *
 * `run-a` is a healthy sweep of a set built from the skeleton it is measured
 * against, so both of these charts are drawn on their happy path forever: the
 * Limited window always overlaps the rounds the games took, and every creature
 * lands in some curve bucket. Neither is guaranteed. A set generated against a
 * different skeleton than the document records has creatures no bucket covers,
 * and a run of four-round games has no overlap with a 6-13 round window at all.
 *
 * Both cases used to produce a picture that looked finished and was not: a band
 * parked 185 units outside the plot, and a curve whose bars summed to 24 under
 * a caption reading `62 creatures`.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompositionPanel, composeSet, fitCurve } from '../../src/routes/analysis/composition';
import { GameShapePanel } from '../../src/routes/analysis/game-shape';
import type { GameLength, RunHealth } from '../../src/routes/analysis/model';
import { loadRun, loadSet } from './support/fixtures';

const RUN = loadRun('run-a');
const SET = loadSet();

function occurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

/** Every svg in `markup`, as its viewBox size and the coordinates inside it. */
function plots(markup: string): readonly { width: number; height: number; xs: number[] }[] {
  return markup
    .split('<svg')
    .slice(1)
    .map((svg) => {
      const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
      const body = svg.slice(0, svg.indexOf('</svg>'));
      return {
        width: Number(viewBox?.[1] ?? 0),
        height: Number(viewBox?.[2] ?? 0),
        xs: [...body.matchAll(/\b(x|cx|x1|x2)="(-?[\d.]+)"/g)].map((match) => Number(match[2])),
      };
    });
}

/** The same health, with every game over by `lastRound`. */
function endingBy(lastRound: number): RunHealth {
  const length = RUN.health.gameLength.value;
  if (length === null) throw new Error('run-a has a length distribution');
  const histogram = Array.from({ length: lastRound + 1 }, (_, round) => (round < 2 ? 0 : 100));
  const finished = histogram.map((_, round) => (round < 2 ? 0 : round / lastRound));
  const rounds: GameLength['rounds'] = { ...length.rounds, median: lastRound - 1, max: lastRound, min: 2 };
  return {
    ...RUN.health,
    gameLength: {
      ...RUN.health.gameLength,
      value: { ...length, rounds, roundHistogram: histogram, finishedByRound: finished },
    },
  };
}

describe('the Limited median window', () => {
  it('is drawn once, inside the plot, on a run that overlaps it', () => {
    const markup = renderToStaticMarkup(h(GameShapePanel, { health: RUN.health }));
    expect(occurrences(markup, 'mtg-plot__band"')).toBe(1);
    const rect = /<rect class="mtg-plot__band" x="([\d.]+)"[^>]*width="([\d.]+)"/.exec(markup);
    expect(rect).not.toBeNull();
    expect(Number(rect?.[2] ?? 0)).toBeGreaterThan(0);
  });

  it('is not drawn at all when no game reached it', () => {
    const markup = renderToStaticMarkup(h(GameShapePanel, { health: endingBy(4) }));
    expect(occurrences(markup, 'mtg-plot__band"')).toBe(0);
    for (const plot of plots(markup)) {
      for (const x of plot.xs) {
        expect(x, `x=${x} of ${plot.width}`).toBeLessThanOrEqual(plot.width);
        expect(x).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is clipped to the rounds drawn when it only partly overlaps', () => {
    const markup = renderToStaticMarkup(h(GameShapePanel, { health: endingBy(8) }));
    const rect = /<rect class="mtg-plot__band" x="([\d.]+)"[^>]*width="([\d.]+)"/.exec(markup);
    expect(rect).not.toBeNull();
    const [left, width] = [Number(rect?.[1] ?? 0), Number(rect?.[2] ?? 0)];
    expect(width).toBeGreaterThan(0);
    const plot = plots(markup)[0];
    expect(plot).toBeDefined();
    expect(left + width).toBeLessThanOrEqual(plot?.width ?? 0);
  });
});

describe('creatures no curve bucket covers', () => {
  // The document's own buckets, cut to MV 1-2, which is what a run measured
  // against one skeleton and rendered against another looks like.
  const clipped = { ...RUN.targets, curve: RUN.targets.curve.slice(0, 2) };

  it('are counted rather than silently dropped', () => {
    const full = composeSet(SET, RUN.targets);
    expect(full.curveUnbucketed).toBe(0);
    const partial = composeSet(SET, clipped);
    const drawn = partial.curve.reduce((sum, row) => sum + row.actual, 0);
    expect(drawn).toBeLessThan(partial.creatures);
    expect(partial.curveUnbucketed).toBe(partial.creatures - drawn);
  });

  it('leave the figure counting what it drew, and saying what it did not', () => {
    const markup = renderToStaticMarkup(h(CompositionPanel, { set: SET, targets: clipped }));
    const partial = composeSet(SET, clipped);
    const drawn = partial.curve.reduce((sum, row) => sum + row.actual, 0);
    expect(markup).toContain(`${drawn} creatures · floor 1`);
    expect(markup).not.toContain(`${partial.creatures} creatures · floor 1`);
    expect(markup).toContain(
      `${partial.curveUnbucketed} of the ${partial.creatures} creatures in the set have a mana value no bucket covers`,
    );
  });

  it('say nothing when every creature is covered', () => {
    const markup = renderToStaticMarkup(h(CompositionPanel, { set: SET, targets: RUN.targets }));
    expect(markup).toContain('62 creatures · floor 1');
    expect(markup).not.toContain('no bucket covers');
  });
});

/**
 * The fit itself, on buckets that overlap.
 *
 * `fitCurve` is a port of `@mtg/setgen`'s `validate/composition.ts`, and the
 * reason for the port is that published curve buckets overlap: `1-2` sits
 * beside `2-2`, so first-match assignment piles every two-drop into whichever
 * bucket is listed first and reports a mismatch the set does not have. Two
 * surfaces disagreeing about whether a set conforms is worse than either being
 * wrong alone, which makes "the same fit" a claim worth checking. Every
 * committed fixture is a set built from the skeleton it is measured against,
 * so replacing the whole capacity pass with a first-match one left the suite
 * green until this.
 */
describe('fitCurve', () => {
  const buckets = [
    { label: '1', mvMin: 1, mvMax: 1, cards: 1 },
    { label: '1-2', mvMin: 1, mvMax: 2, cards: 4 },
    { label: '2', mvMin: 2, mvMax: 2, cards: 18 },
  ] as const;

  it('fills a bucket to capacity before spilling into the next one that fits', () => {
    // First-match would answer [3, 2, 0]: three ones in a bucket that plans
    // for one, and a mismatch reported against a set that has none.
    expect(fitCurve([1, 1, 1, 2, 2], buckets)).toEqual([1, 4, 0]);
  });

  it('reads the buckets in order rather than by width', () => {
    expect(fitCurve([2, 2], buckets)).toEqual([0, 2, 0]);
  });

  it('overfills rather than drops when every fitting bucket is full', () => {
    expect(fitCurve([1, 1], [buckets[0]])).toEqual([2]);
  });

  it('drops a mana value no bucket covers, which is what the panel counts', () => {
    expect(fitCurve([0, 9], buckets)).toEqual([0, 0, 0]);
  });
});
