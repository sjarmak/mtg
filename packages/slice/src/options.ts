/**
 * Everything the loop can be told, in one resolved object.
 *
 * Defaults are chosen so that `npm run slice` is unattended, hermetic and free:
 * the recorded fixture provider, a fixed run seed, and a game count high enough
 * that no metrics gate reports `underSampled` (measured: 60 games per matchup
 * over 45 matchups puts every color pair above the 200-distinct-game floor).
 * A live model run is opt-in through `--provider claude-cli`, never the
 * accident of which binaries happen to be on the machine.
 */
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderName } from '@mtg/llm';

/** Repository root, derived from this file's location inside the workspace. */
export function repoRoot(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
}

export function absolutePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

/**
 * How a failing metrics gate is treated.
 *
 * `strict` — a failing band ends the run with a no-go verdict. This is the
 * default because the brief's "balance is a CI assertion, not a vibe" applies
 * to anyone running the loop by hand.
 *
 * `advisory` — bands are measured and reported, and only a *stage* failure ends
 * the run. Used by the CI job whose contract is the pipeline rather than the
 * content, with the balance job asserting bands separately.
 */
export type MetricsGate = 'strict' | 'advisory';

export const METRICS_GATES: readonly MetricsGate[] = ['strict', 'advisory'];

export function isMetricsGate(value: string): value is MetricsGate {
  return (METRICS_GATES as readonly string[]).includes(value);
}

export interface SliceOptions {
  /** Seeds every simulation in the run. The set's own seed lives in the brief. */
  readonly runSeed: string;
  readonly briefPath: string;
  readonly fixtureDir: string;
  readonly outDir: string;
  readonly provider: ProviderName;
  /** Ceiling on live model spend; `null` means no ceiling (fixtures cost nothing). */
  readonly maxUsd: number | null;
  readonly critique: boolean;
  readonly gamesPerMatchup: number;
  /** 0 or 1 runs the simulation in-process; higher spreads it over worker threads. */
  readonly workers: number;
  readonly metricsGate: MetricsGate;
  /** Skip the Forge gate entirely, as opposed to skipping because Forge is absent. */
  readonly skipForge: boolean;
  readonly forgeHome: string | null;
  /** Games for the raw single-threaded kernel throughput number. */
  readonly benchGames: number;
  readonly forkIterations: number;
  readonly copyIterations: number;
  /** Optional SQLite store the generated set is written to as `source = 'lab'`. */
  readonly storePath: string | null;
}

export type SliceOptionsInput = Partial<SliceOptions>;

export const DEFAULT_RUN_SEED = 'slice/v0';
export const DEFAULT_GAMES_PER_MATCHUP = 60;
export const DEFAULT_BENCH_GAMES = 200;
export const DEFAULT_FORK_ITERATIONS = 200_000;
export const DEFAULT_COPY_ITERATIONS = 500;

export function defaultBriefPath(): string {
  return join(repoRoot(), 'packages', 'setgen', 'briefs', 'tideglass-reach.json');
}

export function defaultFixtureDir(): string {
  return join(repoRoot(), 'packages', 'setgen', 'fixtures', 'llm');
}

export function defaultOutDir(): string {
  return join(repoRoot(), 'out', 'slice');
}

export function defaultSliceOptions(): SliceOptions {
  return {
    runSeed: DEFAULT_RUN_SEED,
    briefPath: defaultBriefPath(),
    fixtureDir: defaultFixtureDir(),
    outDir: defaultOutDir(),
    provider: 'fixture',
    maxUsd: null,
    critique: true,
    gamesPerMatchup: DEFAULT_GAMES_PER_MATCHUP,
    workers: 0,
    metricsGate: 'strict',
    skipForge: false,
    forgeHome: null,
    benchGames: DEFAULT_BENCH_GAMES,
    forkIterations: DEFAULT_FORK_ITERATIONS,
    copyIterations: DEFAULT_COPY_ITERATIONS,
    storePath: null,
  };
}

export function resolveSliceOptions(input: SliceOptionsInput = {}): SliceOptions {
  const base = defaultSliceOptions();
  const merged: SliceOptions = { ...base, ...input };
  return {
    ...merged,
    briefPath: absolutePath(merged.briefPath),
    fixtureDir: absolutePath(merged.fixtureDir),
    outDir: absolutePath(merged.outDir),
    forgeHome: merged.forgeHome === null ? null : absolutePath(merged.forgeHome),
    storePath: merged.storePath === null ? null : absolutePath(merged.storePath),
  };
}
