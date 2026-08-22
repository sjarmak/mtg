/**
 * How many sim pools a run actually held open at once, and how wide each was.
 *
 * `pool-size.ts` narrows an unstated pool to a share of the cores because "up
 * to five pools were live at once" was measured. That sentence is the whole
 * derivation of the constant, it was written by hand from a process-tree
 * sample, and by the time anybody wanted to revisit it (mtg-es2) there was no
 * way to re-take the reading except to patch `pool.ts` again. Two of the five
 * files it names had drifted: `closure-stats.test.ts` opens no pool at all, and
 * the fifth default-width holder is `packages/ui/test/analysis/round-trip.test.ts`.
 * A constant whose premise cannot be re-measured is a constant that rots, so
 * the reading is an instrument rather than a paragraph.
 *
 * It is **off unless `MTG_SIM_POOL_CENSUS` names a file**, and when it is off
 * it costs one environment lookup per pool. When it is on, every pool in the
 * run appends an open and a close record to that one file — including pools in
 * other processes, which is the part a per-process counter could never do:
 * the five concurrent pools live in five different vitest forks, and one of
 * them lives in a different vitest instance entirely, the child process
 * `gate-wiring.test.ts` starts. Append-only records from many writers is what
 * makes that one timeline instead of five.
 *
 * Reading is separate from writing on purpose: `censusOf` is a pure function
 * over records, so what the numbers mean is testable without a run. To take a
 * reading, point `MTG_SIM_POOL_CENSUS` at a file that does not exist yet and
 * run whatever you want to measure; `parseCensus` turns the file back into
 * records and `censusOf` turns the records into the peaks.
 */
import { appendFileSync } from 'node:fs';

/** The environment variable that turns the census on, by naming its file. */
export const POOL_CENSUS_ENV = 'MTG_SIM_POOL_CENSUS';

/** One pool opening or closing, as one line of the census file. */
export interface PoolCensusRecord {
  readonly event: 'open' | 'close';
  /** Unique across the run: the writing process and the pool's ordinal in it. */
  readonly id: string;
  /** `Date.now()` at the event. */
  readonly at: number;
  readonly pid: number;
  /** Worker threads this pool booted. */
  readonly workers: number;
  /** Whether the caller stated the width, or took `pool-size.ts`'s default. */
  readonly stated: boolean;
}

/** What a run's records add up to. */
export interface PoolCensus {
  readonly pools: number;
  /** Pools that took the unstated default. These are what a share governs. */
  readonly unstatedPools: number;
  readonly peakLivePools: number;
  readonly peakLiveWorkers: number;
  /** The same two peaks over the unstated pools alone. */
  readonly peakUnstatedPools: number;
  readonly peakUnstatedWorkers: number;
  /** Pools still open when the records ran out; a leak, or a killed process. */
  readonly unclosed: number;
  readonly spanMillis: number;
}

/**
 * The peaks a set of records describes.
 *
 * Records are sorted here rather than assumed ordered: many processes append to
 * one file, so the file is in completion order and not in event order.
 *
 * A close with no open is dropped rather than counted as a negative. It happens
 * when a run starts against a census file another run already wrote to, and
 * silently going below zero would understate every peak after it.
 */
export function censusOf(records: readonly PoolCensusRecord[]): PoolCensus {
  const ordered = [...records].sort((left, right) => left.at - right.at);
  const opens = new Map<string, PoolCensusRecord>();
  for (const record of ordered) if (record.event === 'open') opens.set(record.id, record);

  const live = new Map<string, PoolCensusRecord>();
  let peakLivePools = 0;
  let peakLiveWorkers = 0;
  let peakUnstatedPools = 0;
  let peakUnstatedWorkers = 0;

  for (const record of ordered) {
    const open = opens.get(record.id);
    if (open === undefined) continue;
    if (record.event === 'open') live.set(record.id, open);
    else live.delete(record.id);

    const values = [...live.values()];
    const unstated = values.filter((pool) => !pool.stated);
    peakLivePools = Math.max(peakLivePools, values.length);
    peakLiveWorkers = Math.max(peakLiveWorkers, sum(values));
    peakUnstatedPools = Math.max(peakUnstatedPools, unstated.length);
    peakUnstatedWorkers = Math.max(peakUnstatedWorkers, sum(unstated));
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    pools: opens.size,
    unstatedPools: [...opens.values()].filter((pool) => !pool.stated).length,
    peakLivePools,
    peakLiveWorkers,
    peakUnstatedPools,
    peakUnstatedWorkers,
    unclosed: live.size,
    spanMillis: first === undefined || last === undefined ? 0 : last.at - first.at,
  };
}

function sum(pools: readonly PoolCensusRecord[]): number {
  return pools.reduce((total, pool) => total + pool.workers, 0);
}

/**
 * Parses a census file's contents.
 *
 * Every field is checked, because concurrent appenders are exactly the writers
 * that can interleave a torn line, and a torn line read as a zero-width pool
 * would understate the thing the file exists to measure. A bad line names
 * itself rather than being skipped.
 */
export function parseCensus(contents: string): readonly PoolCensusRecord[] {
  const records: PoolCensusRecord[] = [];
  for (const [index, line] of contents.split('\n').entries()) {
    if (line.trim() === '') continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error: unknown) {
      throw new Error(`census line ${index + 1} is not JSON: ${String(error)}`);
    }
    records.push(checkRecord(raw, index + 1));
  }
  return records;
}

function checkRecord(raw: unknown, line: number): PoolCensusRecord {
  if (typeof raw !== 'object' || raw === null) throw new Error(`census line ${line} is not an object`);
  const fields = raw as Record<string, unknown>;
  const event = fields['event'];
  const id = fields['id'];
  const at = fields['at'];
  const pid = fields['pid'];
  const workers = fields['workers'];
  const stated = fields['stated'];
  if (event !== 'open' && event !== 'close') throw new Error(`census line ${line} has no open/close event`);
  if (typeof id !== 'string' || id === '') throw new Error(`census line ${line} has no pool id`);
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error(`census line ${line} has no timestamp`);
  if (typeof pid !== 'number' || !Number.isInteger(pid)) throw new Error(`census line ${line} has no pid`);
  if (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 0)
    throw new Error(`census line ${line} has no worker count`);
  if (typeof stated !== 'boolean')
    throw new Error(`census line ${line} does not say whether the width was stated`);
  return { event, id, at, pid, workers, stated };
}

/**
 * Appends one record, when the census is on.
 *
 * A single `appendFileSync` of a line well under a pipe buffer is what keeps
 * many writers from tearing each other's lines; `parseCensus` still checks,
 * because "well under" is an argument and not a guarantee. A census that cannot
 * be written is not worth failing a simulation over, so the error goes to
 * stderr and the run continues — the reading is a diagnostic, and losing it
 * must never be the reason a sweep goes red.
 */
export function recordPoolEvent(
  env: Readonly<Record<string, string | undefined>>,
  record: PoolCensusRecord,
): void {
  const path = env[POOL_CENSUS_ENV];
  if (path === undefined || path === '') return;
  try {
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch (error: unknown) {
    process.stderr.write(`sim pool census could not write to ${path}: ${String(error)}\n`);
  }
}
