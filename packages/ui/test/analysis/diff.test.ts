/**
 * The revision diff, including the case that breaks naive diffs.
 *
 * `run-a` measures ten color pairs and `run-b` measures eight, so
 * `balance.pair.BG` and `balance.pair.RG` exist on one side and not the other.
 * That asymmetry was produced by running a smaller sweep, not by deleting keys
 * from a fixture, because the shape of a real missing metric (gate absent, but
 * every neighboring gate present and comparable) is what the view has to
 * survive.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RevisionDiffPanel, diffRuns, formatDelta, formatObserved } from '../../src/routes/analysis/diff';
import { NOT_ENOUGH_EVIDENCE } from '../../src/routes/analysis/evidence';
import { loadRun } from './support/fixtures';

const A = loadRun('run-a');
const B = loadRun('run-b');
const STRICT = loadRun('run-strict');
const SPARSE = loadRun('run-sparse');

describe('diffRuns', () => {
  const rows = diffRuns(A, B);

  it('covers every gate in either run, exactly once', () => {
    const ids = new Set([...A.health.gates.map((gate) => gate.id), ...B.health.gates.map((gate) => gate.id)]);
    expect(rows.length).toBe(ids.size);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('keeps a metric the revision dropped, and refuses to invent a delta for it', () => {
    const dropped = rows.filter((row) => row.presence === 'baseOnly');
    expect(dropped.map((row) => row.id).sort()).toEqual(['balance.pair.BG', 'balance.pair.RG']);
    for (const row of dropped) {
      expect(row.delta).toBeNull();
      expect(row.withheld).toBe(`absent in ${B.label}`);
      expect(row.revision).toBeNull();
      expect(row.base).not.toBeNull();
    }
  });

  it('handles the mirror case, a metric only the revision has', () => {
    const rows = diffRuns(B, A);
    const added = rows.filter((row) => row.presence === 'revisionOnly');
    expect(added.map((row) => row.id).sort()).toEqual(['balance.pair.BG', 'balance.pair.RG']);
    for (const row of added) {
      expect(row.withheld).toBe(`absent in ${B.label}`);
      expect(row.base).toBeNull();
    }
  });

  it('computes a delta only where both sides have a number', () => {
    for (const row of rows) {
      const comparable = row.base?.observed !== undefined && row.revision?.observed !== undefined;
      expect(row.delta === null).toBe(
        !comparable || row.base?.observed === null || row.revision?.observed === null,
      );
    }
  });

  it('withholds the delta when either side had no evidence', () => {
    const rows = diffRuns(A, SPARSE);
    const withheld = rows.filter((row) => row.presence === 'both' && row.delta === null);
    expect(withheld.length).toBeGreaterThan(0);
    for (const row of withheld) {
      expect(row.withheld).toContain(NOT_ENOUGH_EVIDENCE);
    }
  });

  it('reads movement off the verdict, not the sign of the number', () => {
    const rows = diffRuns(A, STRICT);
    const regressed = rows.filter((row) => row.movement === 'regressed');
    expect(regressed.length).toBeGreaterThan(0);
    for (const row of regressed) {
      expect(row.base?.status).toBe('pass');
      expect(row.revision?.status).toBe('fail');
    }
    // Same games, tighter band: the observed numbers did not move at all.
    for (const row of regressed) expect(row.delta).toBe(0);
  });
});

describe('formatting', () => {
  it("uses the gate's own units, read off its stated bound", () => {
    const stall = A.health.gates.find((gate) => gate.id === 'decisiveness.stall');
    const median = A.health.gates.find((gate) => gate.id === 'length.median');
    expect(stall).toBeDefined();
    expect(median).toBeDefined();
    expect(formatObserved(stall ?? null)).toMatch(/%$/);
    expect(formatObserved(median ?? null)).not.toMatch(/%$/);
  });

  it('prints an absent side as a dash and a withheld one by name', () => {
    expect(formatObserved(null)).toBe('—');
    const underSampled = SPARSE.health.gates.find((gate) => gate.status === 'underSampled');
    expect(underSampled).toBeDefined();
    expect(formatObserved(underSampled ?? null)).toBe(NOT_ENOUGH_EVIDENCE);
  });

  it('prints no delta where there is none', () => {
    const dropped = diffRuns(A, B).find((row) => row.presence === 'baseOnly');
    expect(dropped).toBeDefined();
    if (dropped !== undefined) expect(formatDelta(dropped)).toBe('—');
  });
});

describe('RevisionDiffPanel', () => {
  it('renders both directions without throwing, and says what is one-sided', () => {
    const forward = renderToStaticMarkup(h(RevisionDiffPanel, { base: A, revision: B }));
    const backward = renderToStaticMarkup(h(RevisionDiffPanel, { base: B, revision: A }));
    for (const markup of [forward, backward]) {
      expect(markup).toContain('Metrics on one side only');
      expect(markup).toContain('absent in');
      expect(markup).toContain('mtg-chart__sample');
    }
  });

  it('counts regressions when a revision breaks a gate', () => {
    const markup = renderToStaticMarkup(h(RevisionDiffPanel, { base: A, revision: STRICT }));
    expect(markup).toContain('Gates regressed');
    expect(markup).toContain('regressed');
    expect(markup).toContain('data-direction="down"');
  });
});
