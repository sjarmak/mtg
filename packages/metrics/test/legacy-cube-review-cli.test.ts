import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { calibrationSourceManifest } from '../src/legacy-cube-calibration/io';
import {
  CALIBRATION_INPUT_LIMIT,
  parseCalibrationPaths,
  readCalibrationJson,
  readCalibrationText,
} from '../src/legacy-cube-calibration/artifact-io';

const run = promisify(execFile);
const proposalCli = fileURLToPath(new URL('../tools/legacy-cube-propose.ts', import.meta.url));
const reviewCli = fileURLToPath(new URL('../tools/legacy-cube-review.ts', import.meta.url));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'mtg-review-cli-'));
  roots.push(path);
  return path;
}
// Parser/executable fixtures only. These are not curated human judgments.
const evidence = (id: string, split: 'tuning' | 'holdout') => ({
  schemaVersion: 1,
  catalogSha256: catalog.contentSha256,
  cases: [
    {
      id,
      split,
      kind: 'pick',
      picks: [],
      observations: [
        { round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15).map((c) => c.correctedName) },
      ],
      preference: { mode: 'flexible', acceptable: catalog.cards.slice(0, 15).map((c) => c.correctedName) },
      source: {
        author: 'Fixture',
        url: `https://example.org/${id}`,
        session: id,
        published: '2021-08-25',
        origin: 'human',
        environment: 'matched',
        locator: 'Synthetic fixture',
      },
    },
  ],
});

it('seals tuning and runs a reserved two-arm review through the actual offline commands', async () => {
  const root = await directory();
  const input = join(root, 'tuning.json');
  const holdout = join(root, 'holdout.json');
  const sealed = join(root, 'sealed.json');
  await writeFile(input, JSON.stringify(evidence('train', 'tuning')));
  await writeFile(holdout, JSON.stringify(evidence('test', 'holdout')));
  await run(process.execPath, ['--import', 'tsx', proposalCli, '--corpus', input, '--seal-out', sealed]);
  const args = [
    '--import',
    'tsx',
    reviewCli,
    '--proposal',
    sealed,
    '--holdout',
    holdout,
    '--ledger',
    join(root, 'ledger'),
  ];
  const { stdout } = await run(process.execPath, args);
  const result = JSON.parse(stdout) as {
    review: { status: string; adoptionEligible: boolean };
    path: string;
  };
  expect(result.review).toMatchObject({ status: 'compared', adoptionEligible: false });
  expect(JSON.parse(await readFile(result.path, 'utf8'))).toEqual(result.review);
  await expect(run(process.execPath, args)).rejects.toThrow(/used/i);
  await expect(
    run(process.execPath, ['--import', 'tsx', proposalCli, '--corpus', input, '--seal-out', sealed]),
  ).rejects.toThrow(/exist/i);
});

it('refuses malformed options, non-files, and sealing insufficient evidence', async () => {
  const root = await directory();
  for (const args of [
    [],
    ['--proposal', 'missing'],
    ['--proposal', 'x', '--holdout', 'y', '--ledger', 'z', '--ledger', 'q'],
  ])
    await expect(run(process.execPath, ['--import', 'tsx', reviewCli, ...args])).rejects.toThrow();
  await expect(run(process.execPath, ['--import', 'tsx', proposalCli, '--corpus', root])).rejects.toThrow(
    /regular file/i,
  );
  await expect(
    run(process.execPath, ['--import', 'tsx', proposalCli, '--seal-out', join(root, 'empty.json')]),
  ).rejects.toThrow(/insufficient/i);
});

it('pins executables, dependency lockfile, and printed-card parsing in source provenance', async () => {
  const manifest = await calibrationSourceManifest();
  for (const path of [
    '../package-lock.json',
    'metrics/tools/legacy-cube-propose.ts',
    'metrics/tools/legacy-cube-review.ts',
    'printed-card/src/artifact.ts',
  ])
    expect(manifest.map((entry) => entry.path)).toContain(path);
  expect(manifest.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
  expect(manifest).toEqual(await calibrationSourceManifest());
});

it('bounds JSON inputs and refuses streams without waiting for a writer', async () => {
  const root = await directory();
  const large = join(root, 'large.json');
  const file = await open(large, 'wx');
  try {
    await file.truncate(CALIBRATION_INPUT_LIMIT + 1);
  } finally {
    await file.close();
  }
  await expect(readCalibrationJson(large)).rejects.toThrow(/32 MiB/);
  const malformed = join(root, 'malformed.json');
  await writeFile(malformed, '{');
  await expect(readCalibrationJson(malformed)).rejects.toThrow(SyntaxError);
  const pipe = join(root, 'pipe');
  await run('mkfifo', [pipe]);
  await expect(readCalibrationJson(pipe)).rejects.toThrow(/regular file/);
  await expect(readCalibrationJson(join(root, 'absent'))).rejects.toThrow(/ENOENT/);
});

it('reads a file in full across read chunks, up to exactly the size limit', async () => {
  const root = await directory();
  // A three-byte character straddles the first 1 MiB chunk boundary, so a chunk decoded on its own would corrupt it.
  const straddling = `${'a'.repeat(1024 * 1024 - 1)}\u20ac${'b'.repeat(1024 * 1024 + 7)}`;
  const spanning = join(root, 'spanning.txt');
  await writeFile(spanning, straddling);
  expect(await readCalibrationText(spanning)).toBe(straddling);
  const atLimit = join(root, 'at-limit.txt');
  await writeFile(atLimit, 'x'.repeat(CALIBRATION_INPUT_LIMIT));
  expect((await readCalibrationText(atLimit)).length).toBe(CALIBRATION_INPUT_LIMIT);
  const empty = join(root, 'empty.txt');
  await writeFile(empty, '');
  expect(await readCalibrationText(empty)).toBe('');
});

it('rejects unknown, duplicate, missing, and invalid path arguments', () => {
  for (const args of [
    ['--unknown', 'x'],
    ['--corpus'],
    ['--corpus', ''],
    ['--corpus', '--seal-out'],
    ['--corpus', 'x', '--corpus', 'y'],
    ['--corpus', 'a'.repeat(4097)],
    ['--corpus', 'a\0b'],
  ])
    expect(() => parseCalibrationPaths(args, ['--corpus'])).toThrow(/Invalid/);
  expect(parseCalibrationPaths([], ['--corpus'])).toEqual({});
  expect(parseCalibrationPaths(['--corpus', 'input.json'], ['--corpus'], ['--corpus'])).toEqual({
    '--corpus': 'input.json',
  });
});
