import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Card } from '@mtg/dsl';
import type { RecordedFixture, RunManifest } from '@mtg/llm';
import { readManifestFixtures, readRunManifest } from '@mtg/llm';
import type { SetgenStageResult } from '@mtg/slice';
import { defaultFixtureDir, resolveSliceOptions, runSetgenStage } from '@mtg/slice';
import type { SliceOptions } from '@mtg/slice';

export function tempDir(prefix = 'mtg-slice-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function optionsFor(outDir: string, overrides: Partial<SliceOptions> = {}): SliceOptions {
  return resolveSliceOptions({
    outDir,
    provider: 'fixture',
    skipForge: true,
    gamesPerMatchup: 2,
    benchGames: 3,
    forkIterations: 200,
    copyIterations: 5,
    metricsGate: 'advisory',
    ...overrides,
  });
}

let cached: SetgenStageResult | null = null;

/**
 * The recorded Tideglass Reach set, generated once per test process.
 *
 * Replaying the fixtures is cheap (tens of milliseconds) but not free, and
 * every stage downstream of generation needs the same 90 cards, so the result
 * is shared rather than regenerated per test.
 */
export async function recordedSet(): Promise<SetgenStageResult> {
  if (cached !== null) return cached;
  const dir = tempDir('mtg-slice-set-');
  try {
    cached = await runSetgenStage(optionsFor(dir));
    return cached;
  } finally {
    removeDir(dir);
  }
}

export async function recordedCards(): Promise<readonly Card[]> {
  return (await recordedSet()).cards;
}

export const TIDEGLASS_RUN = 'tideglass-reach-2026-08-09T22-30-10Z';

/** `fixtures/runs/`, beside the flat `fixtures/llm/` cache the manifests index. */
export function runManifestDir(): string {
  return join(dirname(defaultFixtureDir()), 'runs');
}

export interface RecordedRun {
  readonly manifest: RunManifest;
  /** The fixtures the manifest names, in the order the run first asked for them. */
  readonly fixtures: readonly RecordedFixture[];
}

/**
 * One recorded run, read off disk, named by its id.
 *
 * Synchronous and pipeline-free on purpose. A run's bill is history: what it
 * served is written in `fixtures/runs/<id>.json`, and computing it must not
 * depend on whether today's allocator still produces the prompts that were sent
 * that day. Deriving the same list by replaying was an earlier shape here, and
 * an allocator fix invalidated a $22 recording's key list without touching a
 * byte of the recording.
 *
 * By id rather than by brief, because a brief-named file is a file the next
 * recording overwrites, and that took the same $22 run's record out a second
 * time.
 */
export function recordedRun(id: string): RecordedRun {
  const manifest = readRunManifest(join(runManifestDir(), `${id}.json`));
  return { manifest, fixtures: readManifestFixtures(defaultFixtureDir(), manifest) };
}
