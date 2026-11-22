import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runLegacyCubeCalibrationCli } from '../src/legacy-cube-calibration/io';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

it('writes a replayable plan without launching Forge and refuses overwriting an output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-cube-calibration-test-'));
  roots.push(root);
  const out = join(root, 'plan');
  const args = ['--out', out, '--seed', 'io-smoke', '--split', 'holdout', '--plan-only'];
  const factory = async () => {
    throw new Error('Must not launch Forge for plan-only');
  };
  await runLegacyCubeCalibrationCli(args, factory);
  const plan = JSON.parse(await readFile(join(out, 'plan.json'), 'utf8')) as {
    provenance: { source: string };
    games: unknown[];
  };
  expect(plan.games).toHaveLength(6);
  expect(plan.provenance.source).toMatch(/^[a-f0-9]{64}$/);
  await expect(runLegacyCubeCalibrationCli(args, factory)).rejects.toThrow(/exist/i);
});

it('writes bot results and cleans up the installed runner even when a game fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-cube-calibration-test-'));
  roots.push(root);
  let closed = 0;
  const args = ['--out', join(root, 'run'), '--seed', 'io-smoke', '--split', 'tuning', '--policies', 'power'];
  await runLegacyCubeCalibrationCli(args, async () => ({
    bot: 'fixture',
    evidence: [],
    play: async () => ({ status: 'completed', winner: 0, artifact: 'fixture.json' }),
    dispose: async () => {
      closed += 1;
    },
  }));
  expect(closed).toBe(1);
  expect(JSON.parse(await readFile(join(root, 'run', 'report.json'), 'utf8'))).toHaveProperty('summary');
  await expect(
    runLegacyCubeCalibrationCli(['--out', join(root, 'failed'), ...args.slice(2)], async () => ({
      bot: 'fixture',
      evidence: [],
      play: async () => {
        throw new Error('Game failure');
      },
      dispose: async () => {
        closed += 1;
      },
    })),
  ).rejects.toThrow('Game failure');
  expect(closed).toBe(2);
});
