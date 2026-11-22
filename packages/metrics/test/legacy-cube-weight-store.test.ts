import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { readWeightStore, transitionWeights } from '../src/legacy-cube-calibration/weight-store';

const identity = { catalogSha256: 'a'.repeat(64), modelSha256: 'b'.repeat(64) };
const candidate = { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'fixture/v2', synergy: 1.25 };
const install = { kind: 'install', weights: candidate, decisionSha256: 'c'.repeat(64) };
async function inStore(run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), 'mtg-weight-store-'));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

it('installs and rolls back without overwriting any history or confusing storage with approval', async () => {
  await inStore(async (path) => {
    const initial = await readWeightStore(path, identity);
    expect(initial).toMatchObject({ head: null, weights: DEFAULT_ADVISOR_WEIGHTS, history: [] });
    expect(initial.transitionPending).toBe(false);
    const active = await transitionWeights(path, identity, null, install);
    expect(active.weights).toEqual(candidate);
    expect(active.history[0]?.action).toEqual(install);
    const first = await readFile(join(path, '00000001.json'), 'utf8');
    const rollback = await transitionWeights(path, identity, active.head, {
      kind: 'rollback',
      toSequence: 0,
    });
    expect(rollback.weights).toEqual(DEFAULT_ADVISOR_WEIGHTS);
    expect(rollback.history).toHaveLength(2);
    expect(await readFile(join(path, '00000001.json'), 'utf8')).toBe(first);
    const restored = await transitionWeights(path, identity, rollback.head, {
      kind: 'rollback',
      toSequence: 1,
    });
    expect(restored.weights).toEqual(candidate);
    expect(restored).not.toHaveProperty('adoptionEligible');
    expect(await readWeightStore(path, identity)).toEqual(restored);
  });
});

it('rejects stale writers and permits at most one concurrent transition', async () => {
  await inStore(async (path) => {
    const results = await Promise.allSettled([
      transitionWeights(path, identity, null, install),
      transitionWeights(path, identity, null, install),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(transitionWeights(path, identity, null, install)).rejects.toThrow(/stale/i);
    expect((await readWeightStore(path, identity)).history).toHaveLength(1);
  });
});

it('validates and snapshots all caller inputs before asynchronous work', async () => {
  await inStore(async (path) => {
    const mutable = structuredClone(install);
    const pending = transitionWeights(path, identity, null, mutable);
    mutable.weights.synergy = 4;
    expect((await pending).weights.synergy).toBe(1.25);
    const active = await readWeightStore(path, identity);
    for (const action of [
      { ...install, weights: { ...candidate, fixing: 5 } },
      { ...install, decisionSha256: 'invalid' },
      { ...install, approved: true },
      { kind: 'rollback', toSequence: 2 },
      { kind: 'rollback', toSequence: -1 },
    ])
      await expect(transitionWeights(path, identity, active.head, action)).rejects.toThrow();
    expect((await readWeightStore(path, identity)).history).toHaveLength(1);
  });
});

it('refuses stale catalogs, damaged records, and missing history rather than using defaults', async () => {
  await inStore(async (path) => {
    const active = await transitionWeights(path, identity, null, install);
    await expect(readWeightStore(path, { ...identity, catalogSha256: 'd'.repeat(64) })).rejects.toThrow();
    await transitionWeights(path, identity, active.head, { kind: 'rollback', toSequence: 0 });
    const recordPath = join(path, '00000001.json');
    const original = await readFile(recordPath, 'utf8');
    const modified = JSON.parse(original);
    modified.weights.synergy = 3;
    await writeFile(recordPath, JSON.stringify(modified));
    await expect(readWeightStore(path, identity)).rejects.toThrow();
    await rm(recordPath);
    await expect(readWeightStore(path, identity)).rejects.toThrow(/sequence/i);
  });
});

it('keeps interrupted locks visible and never publishes pending partial records', async () => {
  await inStore(async (path) => {
    await mkdir(join(path, '.weight-lock'));
    await writeFile(join(path, '.weight-lock', 'pending.json'), '{');
    expect((await readWeightStore(path, identity)).weights).toEqual(DEFAULT_ADVISOR_WEIGHTS);
    expect((await readWeightStore(path, identity)).transitionPending).toBe(true);
    await expect(transitionWeights(path, identity, null, install)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readdir(join(path, '.weight-lock'))).toEqual(['pending.json']);
  });
});

it('treats only an absent store as default and rejects unexpected history names', async () => {
  await inStore(async (path) => {
    expect((await readWeightStore(join(path, 'absent'), identity)).weights).toEqual(DEFAULT_ADVISOR_WEIGHTS);
    await writeFile(join(path, 'garbage.json'), '{}');
    await expect(readWeightStore(path, identity)).rejects.toThrow(/unexpected/i);
  });
});
