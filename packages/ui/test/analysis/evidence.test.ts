/**
 * The sample-size discipline, tested where it actually has to hold: over a real
 * run that is genuinely too thin to judge.
 *
 * `run-sparse.json` is two games per matchup — ninety games, every statistic
 * under its floor. It is real `@mtg/metrics` output, not a hand-written stub,
 * because the failure mode this route exists to prevent is precisely a
 * dashboard that has only ever been shown well-fed data.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArchetypePanel, pairEvidence } from '../../src/routes/analysis/archetypes';
import { CardPerformancePanel, RARITY_ANY, cardRows } from '../../src/routes/analysis/card-performance';
import { GameShapePanel } from '../../src/routes/analysis/game-shape';
import { NOT_ENOUGH_EVIDENCE, evidenceFor, sampleNote, sampleSize } from '../../src/routes/analysis/evidence';
import { loadRun } from './support/fixtures';

const SPARSE = loadRun('run-sparse');
const FULL = loadRun('run-a');

function occurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

describe('evidenceFor', () => {
  it('withholds below the floor even when the producer supplied a value', () => {
    const result = evidenceFor(0.62, sampleSize(1000, 12, 200));
    expect(result.plotted).toBe(false);
    if (!result.plotted) expect(result.reason).toContain('floor 200');
  });

  it('withholds when the producer withheld', () => {
    const result = evidenceFor(null, sampleSize(4000, 3200, 200));
    expect(result.plotted).toBe(false);
  });

  it('plots when the distinct count clears the floor', () => {
    const result = evidenceFor(0.51, sampleSize(4000, 3200, 200));
    expect(result.plotted).toBe(true);
    if (result.plotted) expect(result.value).toBe(0.51);
  });

  it('counts distinct trajectories, not rows', () => {
    const illusion = evidenceFor(0.9, sampleSize(10000, 4, 200));
    expect(illusion.plotted).toBe(false);
  });
});

describe('sampleNote', () => {
  it('always names the denominator', () => {
    expect(sampleNote(sampleSize(5400, 5400, 200))).toBe('5,400 games · floor 200');
    expect(sampleNote(sampleSize(5400, 900, 200))).toBe('5,400 games · 900 distinct · floor 200');
  });
});

describe('a run below every floor', () => {
  it('withholds every color-pair win rate', () => {
    const rows = pairEvidence(SPARSE.health);
    expect(rows.length).toBe(10);
    expect(rows.every((row) => !row.winRate.plotted)).toBe(true);
  });

  it('says so in the archetype plot instead of drawing a dot', () => {
    const markup = renderToStaticMarkup(h(ArchetypePanel, { health: SPARSE.health }));
    expect(occurrences(markup, 'mtg-plot__ring')).toBe(0);
    expect(occurrences(markup, 'mtg-plot__whisker')).toBe(0);
    expect(occurrences(markup, NOT_ENOUGH_EVIDENCE)).toBeGreaterThanOrEqual(10);
  });

  it('replaces the length histogram with a named empty state', () => {
    const markup = renderToStaticMarkup(h(GameShapePanel, { health: SPARSE.health }));
    expect(markup).toContain('class="mtg-evidence"');
    expect(markup).toContain('game-length distribution');
    expect(markup).toContain('stall and decisiveness rates');
    expect(markup).toContain(NOT_ENOUGH_EVIDENCE);
    expect(occurrences(markup, 'mtg-meter__limit')).toBe(0);
  });

  it('nulls every card rather than drawing a short bar', () => {
    const rows = cardRows(SPARSE.cards);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.winRate.plotted)).toBe(true);
    const markup = renderToStaticMarkup(
      h(CardPerformancePanel, {
        cards: SPARSE.cards,
        rarity: RARITY_ANY,
        onSelectRarity: () => undefined,
      }),
    );
    expect(occurrences(markup, 'mtg-rowbar__fill')).toBe(0);
    expect(occurrences(markup, 'class="mtg-withheld"')).toBe(rows.length);
  });

  it('still states the sample size that was too small', () => {
    const markup = renderToStaticMarkup(h(GameShapePanel, { health: SPARSE.health }));
    expect(markup).toContain('90 games');
    expect(markup).toContain('floor 100');
  });
});

describe('a producer that forgot to null an under-sampled card', () => {
  it('is overruled here', () => {
    const smuggled = {
      ...FULL.cards,
      floor: 100_000,
      entries: FULL.cards.entries.slice(0, 3),
    };
    const rows = cardRows(smuggled);
    expect(rows.every((row) => !row.winRate.plotted)).toBe(true);
    const markup = renderToStaticMarkup(
      h(CardPerformancePanel, {
        cards: smuggled,
        rarity: RARITY_ANY,
        onSelectRarity: () => undefined,
      }),
    );
    expect(occurrences(markup, 'mtg-rowbar__fill')).toBe(0);
  });
});
