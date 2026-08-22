/**
 * Audit: the sample floor, tested with a hostile fixture built here.
 *
 * The rule under test is "a statistic below its floor renders an explicit empty
 * state, never a plotted value". The adversarial case is a producer that
 * reports a value anyway — `value` non-null, `underSampled` false — while the
 * distinct-trajectory count sits under the floor recorded beside it. The route
 * is supposed to re-apply the floor rather than trust the flag.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArchetypePanel } from '../../src/routes/analysis/archetypes';
import { CardPerformancePanel, RARITY_ANY } from '../../src/routes/analysis/card-performance';
import { GameShapePanel } from '../../src/routes/analysis/game-shape';
import { NOT_ENOUGH_EVIDENCE } from '../../src/routes/analysis/evidence';
import { readAnalysisRun } from '../../src/routes/analysis/read';
import { fixtureJson } from './support/fixtures';

type Json = Record<string, unknown>;

/** Drops every distinct count under its own floor, leaving the values in place. */
function starve(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(starve);
  if (node === null || typeof node !== 'object') return node;
  const record = { ...(node as Json) };
  for (const [key, value] of Object.entries(record)) record[key] = starve(value);
  if ('floor' in record && 'distinctSamples' in record && typeof record.floor === 'number') {
    record.distinctSamples = Math.max(0, record.floor - 1);
    record.underSampled = false; // the hostile bit: producer says it is fine
  }
  return record;
}

function starvedRun(): ReturnType<typeof readAnalysisRun> {
  const raw = starve(fixtureJson('run-a')) as Json;
  const run = raw as unknown as {
    health: { distinctGames: number };
    cards: { floor: number; entries: { distinctGames: number }[] };
  };
  run.health.distinctGames = 1;
  for (const entry of run.cards.entries) entry.distinctGames = Math.max(0, run.cards.floor - 1);
  return readAnalysisRun(raw, 'run-starved');
}

function occurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

describe('audit: a run whose distinct counts are all below their floors', () => {
  const run = starvedRun();

  it('plots no archetype dot and no interval', () => {
    const markup = renderToStaticMarkup(h(ArchetypePanel, { health: run.health }));
    expect(occurrences(markup, 'mtg-plot__ring')).toBe(0);
    expect(occurrences(markup, 'mtg-plot__whisker')).toBe(0);
    expect(markup).toContain(NOT_ENOUGH_EVIDENCE);
  });

  it('plots no game-shape figure', () => {
    const markup = renderToStaticMarkup(h(GameShapePanel, { health: run.health }));
    expect(markup).toContain(NOT_ENOUGH_EVIDENCE);
    expect(occurrences(markup, 'mtg-plot__value')).toBe(0);
  });

  it('withholds every card rate rather than printing a short bar', () => {
    const markup = renderToStaticMarkup(
      h(CardPerformancePanel, {
        cards: run.cards,
        rarity: RARITY_ANY,
        onSelectRarity: () => undefined,
      }),
    );
    expect(markup).toContain(NOT_ENOUGH_EVIDENCE);
    expect(occurrences(markup, 'mtg-rowbar__fill')).toBe(0);
  });
});
