/**
 * The instrument that answers "how many sim pools were live at once".
 *
 * `pool-size.ts` narrows an unstated pool to a quarter of the cores because a
 * count of concurrent pools was measured once, by hand, and written into a
 * docblock. Two of the five files that docblock named had stopped opening a
 * pool by the time anybody re-read it. So what is tested here is the reading:
 * the peaks a timeline implies, the peaks over the unstated pools alone (the
 * only ones a share governs), and the two ways a many-writer file goes wrong.
 *
 * The writing half is tested through its off state and through a real pool,
 * because the interesting claim about it is that it costs nothing when nobody
 * asked for it and that a pool's own lifetime is what lands in the file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { PoolCensusRecord } from '@mtg/sim';
import { censusOf, parseCensus, POOL_CENSUS_ENV, recordPoolEvent, withSimPool } from '@mtg/sim';

const DIR = mkdtempSync(join(tmpdir(), 'mtg-pool-census-'));

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

function record(
  event: 'open' | 'close',
  id: string,
  at: number,
  workers: number,
  stated: boolean,
): PoolCensusRecord {
  return { event, id, at, pid: 1, workers, stated };
}

describe('what a timeline of pools adds up to', () => {
  it('counts the pools that overlap, not the pools that merely both happened', () => {
    // Three pools, two of which overlap: a-----a  b--b  and c spanning both.
    const records = [
      record('open', 'a', 0, 4, false),
      record('open', 'c', 1, 2, true),
      record('close', 'a', 2, 4, false),
      record('open', 'b', 3, 4, false),
      record('close', 'b', 4, 4, false),
      record('close', 'c', 5, 2, true),
    ];
    const census = censusOf(records);
    expect(census.pools).toBe(3);
    expect(census.peakLivePools).toBe(2);
    expect(census.peakLiveWorkers).toBe(6);
    expect(census.spanMillis).toBe(5);
  });

  it('reports the unstated pools separately, because they are the only ones a share governs', () => {
    // The measured shape of one `--project unit` run: many pools, almost all of
    // them stating their own width, and the default reaching just one of them.
    const records = [
      record('open', 'default', 0, 4, false),
      record('open', 'stated-1', 1, 5, true),
      record('open', 'stated-2', 2, 2, true),
      record('close', 'stated-1', 3, 5, true),
      record('close', 'stated-2', 4, 2, true),
      record('close', 'default', 5, 4, false),
    ];
    const census = censusOf(records);
    expect(census.pools).toBe(3);
    expect(census.unstatedPools).toBe(1);
    expect(census.peakLivePools).toBe(3);
    expect(census.peakLiveWorkers).toBe(11);
    expect(census.peakUnstatedPools).toBe(1);
    expect(census.peakUnstatedWorkers).toBe(4);
  });

  it('sorts by time, because many processes append in completion order', () => {
    const shuffled = [
      record('close', 'b', 40, 4, false),
      record('open', 'a', 10, 4, false),
      record('close', 'a', 30, 4, false),
      record('open', 'b', 20, 4, false),
    ];
    expect(censusOf(shuffled).peakLivePools).toBe(2);
    expect(censusOf(shuffled).spanMillis).toBe(30);
  });

  it('names a pool that never closed rather than folding it into the peaks', () => {
    const census = censusOf([
      record('open', 'a', 0, 4, false),
      record('open', 'b', 1, 4, false),
      record('close', 'b', 2, 4, false),
    ]);
    expect(census.unclosed).toBe(1);
  });

  it('ignores a close whose open was never in this file', () => {
    // A run pointed at a census file a previous run wrote to. Counting the
    // orphan close as minus one would understate every peak after it.
    const census = censusOf([
      record('close', 'stranger', 0, 8, false),
      record('open', 'a', 1, 4, false),
      record('close', 'a', 2, 4, false),
    ]);
    expect(census.pools).toBe(1);
    expect(census.peakLivePools).toBe(1);
    expect(census.peakLiveWorkers).toBe(4);
  });

  it('says nothing when it was never turned on', () => {
    expect(censusOf([])).toMatchObject({ pools: 0, peakLivePools: 0, peakLiveWorkers: 0, spanMillis: 0 });
  });
});

describe('reading the file', () => {
  it('round-trips what the recorder writes', () => {
    const path = join(DIR, 'round-trip.jsonl');
    const written = [record('open', '7-1', 100, 4, false), record('close', '7-1', 900, 4, false)];
    for (const one of written) recordPoolEvent({ [POOL_CENSUS_ENV]: path }, one);
    expect(parseCensus(readFileSync(path, 'utf8'))).toEqual(written);
  });

  it('refuses a torn line instead of reading it as a pool of no width', () => {
    // Many writers append to one file. A line that lost half of itself, read
    // charitably, is a pool that took no threads, which is a lie in the exact
    // direction the file exists to measure.
    const path = join(DIR, 'torn.jsonl');
    writeFileSync(path, '{"event":"open","id":"a","at":1,"pid":2,"workers":4,"stated":fa\n');
    expect(() => parseCensus(readFileSync(path, 'utf8'))).toThrow(/line 1 is not JSON/);

    writeFileSync(path, '{"event":"open","id":"a","at":1,"pid":2,"stated":false}\n');
    expect(() => parseCensus(readFileSync(path, 'utf8'))).toThrow(/no worker count/);

    writeFileSync(path, '{"event":"boot","id":"a","at":1,"pid":2,"workers":4,"stated":false}\n');
    expect(() => parseCensus(readFileSync(path, 'utf8'))).toThrow(/no open\/close event/);
  });

  it('skips blank lines, which a file appended to by several processes collects', () => {
    expect(parseCensus('\n\n')).toEqual([]);
  });
});

describe('what a real pool records', () => {
  it('writes nothing at all unless a file was named', () => {
    // The census is off in every run that did not ask for it, and the cost of
    // it being off has to be a lookup rather than a file handle.
    const path = join(DIR, 'never-written.jsonl');
    recordPoolEvent({}, record('open', 'a', 1, 4, false));
    recordPoolEvent({ [POOL_CENSUS_ENV]: '' }, record('open', 'a', 1, 4, false));
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });

  it('brackets the life of a real pool, and says the width was stated', async () => {
    const path = join(DIR, 'real-pool.jsonl');
    const previous = process.env[POOL_CENSUS_ENV];
    process.env[POOL_CENSUS_ENV] = path;
    try {
      await withSimPool({ workers: 1 }, () => Promise.resolve());
    } finally {
      if (previous === undefined) delete process.env[POOL_CENSUS_ENV];
      else process.env[POOL_CENSUS_ENV] = previous;
    }
    const census = censusOf(parseCensus(readFileSync(path, 'utf8')));
    expect(census.pools).toBe(1);
    expect(census.unstatedPools).toBe(0);
    expect(census.unclosed).toBe(0);
    expect(census.peakLiveWorkers).toBe(1);
  });
});
