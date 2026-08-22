/**
 * The summary tiles, over a run that measured nothing.
 *
 * Every plotted mark on this route re-checks its sample floor, and
 * `sample-floor-hostile.test.ts` proves it. The tiles above the charts did not:
 * they counted verdicts and colored themselves from the count, so a run whose
 * every gate is under-sampled printed a green `0 pass · 0 fail` and a green
 * `0 / 0` pairs inside the band, directly above the sentence saying there was
 * no evidence. Green is the strongest claim on the page and it was the one
 * thing not checking its denominator.
 *
 * `run-sparse.json` is that run: 90 games, 25 gates, none of them judged.
 *
 * The "passed everything" run is `run-b`, not `run-a`: `run-a` holds a pair at
 * 39.7% against a 40% floor, which is a property of the frozen set and the
 * current engine rather than a number anybody picked.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalysisSurface } from '../../src/routes/analysis/AnalysisView';
import { ArchetypePanel } from '../../src/routes/analysis/archetypes';
import { RevisionDiffPanel, diffRuns } from '../../src/routes/analysis/diff';
import { NOT_ENOUGH_EVIDENCE } from '../../src/routes/analysis/evidence';
import { loadRun, loadSet } from './support/fixtures';

const SPARSE = loadRun('run-sparse');
const FULL = loadRun('run-a');
/** The run nothing fails on. */
const CLEAN = loadRun('run-b');
const STRICT = loadRun('run-strict');

/** The `data-tone` of the stat tile carrying `label`, or `null` when untoned. */
function statTone(markup: string, label: string): string | null {
  const at = markup.indexOf(`>${label}</span>`);
  expect(at, label).toBeGreaterThan(0);
  const open = markup.lastIndexOf('<div class="mtg-stat', at);
  const tag = markup.slice(open, markup.indexOf('>', open));
  return /data-tone="([a-z]+)"/.exec(tag)?.[1] ?? null;
}

function surface(runId: string): string {
  return renderToStaticMarkup(
    h(AnalysisSurface, {
      runs: {
        status: 'ready',
        runs: [
          { run: FULL, set: loadSet() },
          { run: CLEAN, set: loadSet() },
          { run: SPARSE, set: loadSet() },
        ],
      },
      games: { status: 'absent' },
      route: { mode: 'analysis', params: { run: runId } },
      onSetParams: () => undefined,
    }),
  );
}

describe('the gate tile', () => {
  it('is not green when nothing passed', () => {
    expect(statTone(surface('tgr-probe'), 'Gates')).not.toBe('positive');
  });

  it('is still green on a run that passed everything', () => {
    expect(statTone(surface('tgr-r2'), 'Gates')).toBe('positive');
  });

  it('is not green on a run with a failing gate', () => {
    expect(statTone(surface('tgr-r1'), 'Gates')).toBe('negative');
  });
});

describe('pairs inside the band', () => {
  it('is not green, and not a count, when no pair was judged', () => {
    const markup = renderToStaticMarkup(h(ArchetypePanel, { health: SPARSE.health }));
    expect(statTone(markup, 'Pairs inside the band')).not.toBe('positive');
    expect(markup).not.toContain('>0 / 0<');
  });

  it('still counts, and is green, when every pair cleared its floor', () => {
    const markup = renderToStaticMarkup(h(ArchetypePanel, { health: CLEAN.health }));
    expect(statTone(markup, 'Pairs inside the band')).toBe('positive');
    expect(markup).toContain('>8 / 8<');
  });

  it('counts a pair outside the band without dropping it from the denominator', () => {
    const markup = renderToStaticMarkup(h(ArchetypePanel, { health: FULL.health }));
    expect(markup).toContain('>9 / 10<');
  });
});

describe('a gate that stopped being measured', () => {
  const rows = diffRuns(STRICT, SPARSE);

  it('is not an improvement', () => {
    const lost = rows.filter((row) => row.base?.status === 'fail');
    expect(lost.length).toBe(3);
    for (const row of lost) {
      expect(row.revision?.status).toBe('underSampled');
      expect(row.movement).toBe('unknown');
    }
  });

  it('is not a regression in the other direction either', () => {
    const gained = diffRuns(SPARSE, STRICT).filter((row) => row.revision?.status === 'fail');
    expect(gained.length).toBe(3);
    for (const row of gained) expect(row.movement).toBe('unknown');
  });

  it('leaves the panel claiming no improvement it cannot show', () => {
    const markup = renderToStaticMarkup(h(RevisionDiffPanel, { base: STRICT, revision: SPARSE }));
    const improved = markup.indexOf('Gates improved');
    expect(improved).toBeGreaterThan(0);
    expect(markup.slice(improved, improved + 200)).toContain('nothing that failed now passes');
    expect(markup).toContain(NOT_ENOUGH_EVIDENCE);
  });
});
