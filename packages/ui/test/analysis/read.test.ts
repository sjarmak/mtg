/**
 * The document reader, against real metrics output.
 *
 * Two properties matter here and they pull in opposite directions: the reader
 * has to accept exactly what `formatHealth()` writes, and it has to reject
 * anything else loudly. So the happy path is asserted against the committed
 * fixtures (which are that output, verbatim) and the sad paths are asserted by
 * corrupting a copy of one field at a time.
 */
import { describe, expect, it } from 'vitest';
import { AnalysisDataError, parseAnalysisRun, readAnalysisRun } from '../../src/routes/analysis/read';
import { fixtureJson, loadRun, loadSet } from './support/fixtures';

const FIXTURES = ['run-a', 'run-b', 'run-strict', 'run-sparse'] as const;

function mutate(change: (draft: Record<string, unknown>) => void): unknown {
  const draft = JSON.parse(JSON.stringify(fixtureJson('run-a'))) as Record<string, unknown>;
  change(draft);
  return draft;
}

describe('readAnalysisRun', () => {
  it('reads every committed fixture', () => {
    for (const name of FIXTURES) {
      const run = loadRun(name);
      expect(run.health.gates.length).toBeGreaterThan(0);
      expect(run.targets.curve.length).toBeGreaterThan(0);
      expect(run.cards.entries.length).toBeGreaterThan(0);
    }
  });

  it('keeps the run and the health block agreeing about the game count', () => {
    const run = loadRun('run-a');
    expect(run.health.games).toBe(5400);
    expect(run.health.distinctGames).toBeLessThanOrEqual(run.health.games);
  });

  it('preserves a withheld statistic as null rather than dropping it', () => {
    const sparse = loadRun('run-sparse');
    expect(sparse.health.gameLength.value).toBeNull();
    expect(sparse.health.gameLength.underSampled).toBe(true);
    expect(sparse.cards.entries.every((entry) => entry.winRate === null)).toBe(true);
  });

  it('names the missing field', () => {
    const broken = mutate((draft) => {
      delete draft['seed'];
    });
    expect(() => readAnalysisRun(broken)).toThrowError(AnalysisDataError);
    expect(() => readAnalysisRun(broken)).toThrowError(/run\.seed: missing/);
  });

  it('names a wrongly-typed nested field', () => {
    const broken = mutate((draft) => {
      const health = draft['health'] as Record<string, unknown>;
      health['duplicateShare'] = 'lots';
    });
    expect(() => readAnalysisRun(broken)).toThrowError(/run\.health\.duplicateShare/);
  });

  it('rejects an unknown gate status instead of rendering it', () => {
    const broken = mutate((draft) => {
      const health = draft['health'] as Record<string, unknown>;
      const gates = health['gates'] as Record<string, unknown>[];
      const first = gates[0];
      if (first === undefined) throw new Error('fixture has no gates');
      first['status'] = 'probably fine';
    });
    expect(() => readAnalysisRun(broken)).toThrowError(/unknown gate status/);
  });

  it('rejects an unknown color identity in the targets', () => {
    const broken = mutate((draft) => {
      const targets = draft['targets'] as Record<string, unknown>;
      const colors = targets['colors'] as Record<string, unknown>[];
      const first = colors[0];
      if (first === undefined) throw new Error('fixture has no color targets');
      first['identity'] = 'teal';
    });
    expect(() => readAnalysisRun(broken)).toThrowError(/unknown color identity/);
  });

  it('reports bad JSON without a stack of parser noise', () => {
    expect(() => parseAnalysisRun('{not json')).toThrowError(/not valid JSON/);
  });
});

describe('readSetDocument', () => {
  it('parses the set through the DSL, so an unrunnable card cannot be charted', () => {
    const set = loadSet();
    expect(set.code).toBe('TGR');
    expect(set.cards.length).toBe(90);
    expect(set.cards.every((card) => card.id.length > 0)).toBe(true);
  });
});
