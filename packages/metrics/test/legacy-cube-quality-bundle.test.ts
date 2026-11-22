import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import transferCorpus from '../data/legacy-cube-transfer-decks-v1.json';
import { exportQualityBundle, collectQualityBundle } from '../src/legacy-cube-calibration/quality-bundle';
import { recordDeckReviewEvidence } from '../src/legacy-cube-calibration/deck-review-evidence';
import { recordAdviceReviewEvidence } from '../src/legacy-cube-calibration/advice-review';
import { calibrationSourceFingerprint, calibrationSourceManifest } from '../src/legacy-cube-calibration/io';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 20.4 to 21.5 on 16
 * cores: the slowest test took 2.3 to 3.5s, the whole file 14.6 to 20.8s, so
 * 20s is about 5.7x the worst test.
 *
 * The default was too tight under load: on base f8f8d5047 at peak load 29.8,
 * six of the ten tests timed out at 5000ms. The ENOTEMPTY on rmdir in that run
 * came from cleanup racing a timed-out test that was still writing, so it
 * should go away with the timeouts.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

const catalog = parsePrintedCardCatalog(catalogJson);
const request = {
  root: 'quality-bundle-fixture',
  split: 'holdout',
  indices: [0],
  policies: ['current'],
  baseline: DEFAULT_ADVISOR_WEIGHTS,
  candidate: DEFAULT_ADVISOR_WEIGHTS,
  runtimeSha256: 'a'.repeat(64),
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mtg-quality-bundle-'));
  roots.push(root);
  return {
    root,
    bundle: join(root, 'bundle'),
    ledger: join(root, 'ledger'),
    receipts: join(root, 'receipts'),
    out: join(root, 'collected'),
  };
}
async function syntheticReceipts(
  bundle: string,
  out: string,
  runtimeSha256 = request.runtimeSha256,
  assessment: 'uncertain' | 'pass' = 'uncertain',
) {
  await mkdir(out);
  const provenance = {
    provider: 'codex-cli',
    authentication: 'chatgpt-oauth',
    cliVersion: 'fixture',
    requestedModel: null,
    resolvedModel: null,
    runId: 'synthetic-bundle-contract',
    completedAt: '2026-09-11T04:00:00Z',
    generatorRuntimeSha256: runtimeSha256,
  };
  for (const id of await readdir(join(bundle, 'tasks'))) {
    const task = JSON.parse(await readFile(join(bundle, 'tasks', id, 'task.json'), 'utf8')) as {
      version: string;
      sha256: string;
    };
    const deck = task.version === 'legacy-cube-deck-review-task/v1';
    const criteria = (
      deck
        ? ['coherence', 'castability', 'pool-alternatives']
        : ['explanation-accuracy', 'exploration-usefulness']
    ).map((criterion) => ({
      criterion,
      assessment,
      rationale: 'Synthetic contract fixture, not strategic evidence.',
      cards: [],
      ...(deck ? { improvements: [] } : { claims: [], archetypes: [], corrections: [] }),
    }));
    const record = deck ? recordDeckReviewEvidence : recordAdviceReviewEvidence;
    const receipt = record(catalog, task, { taskSha256: task.sha256, criteria, uncertainty: [] }, provenance);
    await writeFile(join(out, `${id}.json`), JSON.stringify(receipt));
  }
}

it('reserves before export, deduplicates identical tasks, and keeps arm labels out of prompts', async () => {
  const paths = await setup();
  const exported = await exportQualityBundle(paths.bundle, paths.ledger, catalog, request);
  expect(exported.manifest.pairs).toHaveLength(1);
  expect(exported.manifest.tasks).toHaveLength(7);
  expect(await readdir(paths.ledger)).toEqual([`quality-${exported.campaign.sha256}.json`]);
  for (const id of exported.manifest.tasks) {
    const dir = join(paths.bundle, 'tasks', id);
    const prompt = await readFile(join(dir, 'prompt.txt'), 'utf8');
    expect(prompt).not.toContain('"weights"');
    expect(prompt).not.toContain('quality-bundle-fixture');
    expect(prompt).toContain(`Task SHA-256: ${id}`);
    const schema: unknown = JSON.parse(await readFile(join(dir, 'response-schema.json'), 'utf8'));
    expect(schema).toHaveProperty('type', 'object');
    expect(schema).toHaveProperty('properties.taskSha256.enum', [id]);
  }
  await expect(
    exportQualityBundle(join(paths.root, 'again'), paths.ledger, catalog, request),
  ).rejects.toThrow(/used/i);
  await expect(readdir(join(paths.root, 'again'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('collects canonical receipts only against an existing reservation and complete export', async () => {
  const paths = await setup();
  await exportQualityBundle(paths.bundle, paths.ledger, catalog, request);
  await syntheticReceipts(paths.bundle, paths.receipts);
  const result = await collectQualityBundle(paths, catalog, request.runtimeSha256);
  expect(result.report.reservationVerified).toBe(true);
  expect(result.report.summary.independentSessions).toBe(1);
  expect(result.report.summary.criteria.every((row) => row.unresolvedSessions === 1)).toBe(true);
  expect(result.report.summary.adoptionEligible).toBe(false);
  expect(result.report.quality.status).toBe('retain-baseline');
  expect(result.report.quality.summary).toBe(result.report.summary.sha256);
  expect(result.report.quality.reasons).toContain('unresolved-quality-judgments');
  expect(JSON.parse(await readFile(join(paths.out, 'report.json'), 'utf8'))).toEqual(result.report);
  await expect(collectQualityBundle(paths, catalog, request.runtimeSha256)).rejects.toMatchObject({
    code: 'EEXIST',
  });
  await expect(
    collectQualityBundle({ ...paths, ledger: join(paths.root, 'absent') }, catalog, request.runtimeSha256),
  ).rejects.toThrow();
});

it('refuses incomplete receipts and modified manifests without publishing a report', async () => {
  const paths = await setup();
  await exportQualityBundle(paths.bundle, paths.ledger, catalog, request);
  await mkdir(paths.receipts);
  await expect(collectQualityBundle(paths, catalog, request.runtimeSha256)).rejects.toThrow();
  await expect(readFile(join(paths.out, 'report.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(paths.bundle, 'manifest.json'), '{}');
  await expect(collectQualityBundle(paths, catalog, request.runtimeSha256)).rejects.toThrow(/manifest/i);
});

it('allows identical recollection of the first collected review set', async () => {
  const paths = await setup();
  await exportQualityBundle(paths.bundle, paths.ledger, catalog, request);
  await syntheticReceipts(paths.bundle, paths.receipts);
  const first = await collectQualityBundle(paths, catalog, request.runtimeSha256);
  const repeated = await collectQualityBundle(
    { ...paths, out: join(paths.root, 'identical') },
    catalog,
    request.runtimeSha256,
  );
  expect(repeated.report).toEqual(first.report);
});

it('freezes the first collected review set against replacement receipts', async () => {
  const paths = await setup();
  await exportQualityBundle(paths.bundle, paths.ledger, catalog, request);
  await syntheticReceipts(paths.bundle, paths.receipts);
  await collectQualityBundle(paths, catalog, request.runtimeSha256);
  const replacements = join(paths.root, 'replacement-receipts');
  await syntheticReceipts(paths.bundle, replacements, request.runtimeSha256, 'pass');
  const out = join(paths.root, 'replacement-result');
  await expect(
    collectQualityBundle({ ...paths, receipts: replacements, out }, catalog, request.runtimeSha256),
  ).rejects.toThrow(/already collected.*different/i);
  await expect(readdir(out)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not release a reservation when export fails after it was claimed', async () => {
  const paths = await setup();
  await mkdir(paths.bundle);
  await expect(exportQualityBundle(paths.bundle, paths.ledger, catalog, request)).rejects.toMatchObject({
    code: 'EEXIST',
  });
  await expect(
    exportQualityBundle(join(paths.root, 'retry'), paths.ledger, catalog, request),
  ).rejects.toThrow(/used/i);
});

it('exports and collects through the actual offline command with pinned executable provenance', async () => {
  const paths = await setup();
  const runtime = await calibrationSourceFingerprint();
  const input = join(paths.root, 'request.json');
  await writeFile(input, JSON.stringify({ ...request, runtimeSha256: runtime }));
  const cli = fileURLToPath(new URL('../tools/legacy-cube-quality.ts', import.meta.url));
  const run = promisify(execFile);
  const exported = await run(process.execPath, [
    '--import',
    'tsx',
    cli,
    'export',
    '--request',
    input,
    '--ledger',
    paths.ledger,
    '--out',
    paths.bundle,
  ]);
  expect(JSON.parse(exported.stdout)).toHaveProperty('modelCalls', 0);
  await syntheticReceipts(paths.bundle, paths.receipts, runtime);
  const collected = await run(process.execPath, [
    '--import',
    'tsx',
    cli,
    'collect',
    '--bundle',
    paths.bundle,
    '--ledger',
    paths.ledger,
    '--receipts',
    paths.receipts,
    '--out',
    paths.out,
  ]);
  expect(JSON.parse(collected.stdout)).toMatchObject({ reservationVerified: true, adoptionEligible: false });
  expect(JSON.parse(collected.stdout)).toHaveProperty('quality', 'retain-baseline');
  expect((await calibrationSourceManifest()).map((row) => row.path)).toContain(
    'metrics/tools/legacy-cube-quality.ts',
  );
});

it('rejects stale runtime requests and malformed commands before reserving anything', async () => {
  const paths = await setup();
  const input = join(paths.root, 'stale.json');
  await writeFile(input, JSON.stringify(request));
  const cli = fileURLToPath(new URL('../tools/legacy-cube-quality.ts', import.meta.url));
  const run = promisify(execFile);
  await expect(
    run(process.execPath, [
      '--import',
      'tsx',
      cli,
      'export',
      '--request',
      input,
      '--ledger',
      paths.ledger,
      '--out',
      paths.bundle,
    ]),
  ).rejects.toThrow(/runtime mismatch/i);
  await expect(readdir(paths.ledger)).rejects.toMatchObject({ code: 'ENOENT' });
  for (const args of [[], ['install'], ['export', '--request', input], ['collect', '--unknown', input]])
    await expect(run(process.execPath, ['--import', 'tsx', cli, ...args])).rejects.toThrow();
});

it('retains defaults through the real adoption command when canonical reviews do not justify change', async () => {
  const paths = await setup();
  const runtime = await calibrationSourceFingerprint();
  await exportQualityBundle(paths.bundle, paths.ledger, catalog, { ...request, runtimeSha256: runtime });
  await syntheticReceipts(paths.bundle, paths.receipts, runtime);
  const corpus = join(paths.root, 'transfer-corpus.json');
  await writeFile(corpus, JSON.stringify(transferCorpus));
  const cli = fileURLToPath(new URL('../tools/legacy-cube-quality.ts', import.meta.url));
  const run = promisify(execFile);
  const result = await run(process.execPath, [
    '--import',
    'tsx',
    cli,
    'adopt',
    '--bundle',
    paths.bundle,
    '--ledger',
    paths.ledger,
    '--receipts',
    paths.receipts,
    '--transfer-corpus',
    corpus,
    '--transfer-receipts',
    join(paths.root, 'missing-transfer-receipts'),
    '--store',
    join(paths.root, 'weights'),
    '--out',
    paths.out,
  ]);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: 'retain-baseline',
    modelCalls: 0,
    activeHead: null,
  });
  const decision = JSON.parse(await readFile(join(paths.out, 'decision.json'), 'utf8'));
  expect(decision.reasons).toEqual(
    expect.arrayContaining(['missing-transfer-review', 'improvement-not-established']),
  );
  expect(decision.regressions).toBeNull();
  expect(decision.gameplayEvidenceUsed).toBe(false);
  await expect(readdir(join(paths.root, 'weights'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses missing, modified, or extra exported task artifacts even when receipts are canonical', async () => {
  const paths = await setup();
  const exported = await exportQualityBundle(paths.bundle, paths.ledger, catalog, request);
  await syntheticReceipts(paths.bundle, paths.receipts);
  const taskDir = join(paths.bundle, 'tasks', exported.manifest.tasks[0]!);
  for (const name of ['task.json', 'prompt.txt', 'response-schema.json']) {
    const path = join(taskDir, name);
    const original = await readFile(path, 'utf8');
    await writeFile(path, name === 'prompt.txt' ? 'Fabricated prompt' : '{}');
    await expect(collectQualityBundle(paths, catalog, request.runtimeSha256)).rejects.toThrow(/artifact/i);
    await rm(path);
    await expect(collectQualityBundle(paths, catalog, request.runtimeSha256)).rejects.toThrow();
    await writeFile(path, original);
  }
  await mkdir(join(paths.bundle, 'tasks', 'extra'));
  await expect(collectQualityBundle(paths, catalog, request.runtimeSha256)).rejects.toThrow(/artifact/i);
  await expect(readFile(join(paths.out, 'report.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
