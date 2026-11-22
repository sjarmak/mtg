/** Orchestrator contracts with a synthetic quality collector; not calibration evidence. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADVISOR_WEIGHTS, LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import corpus from '../data/legacy-cube-transfer-decks-v1.json';
import { buildQualityCampaign } from '../src/legacy-cube-calibration/quality-ledger';
import {
  buildTransferReviewTasks,
  recordTransferReviewEvidence,
} from '../src/legacy-cube-calibration/transfer-review';
import { readWeightStore } from '../src/legacy-cube-calibration/weight-store';
import { advisorModelFingerprint } from '../src/legacy-cube-calibration/tuning';
import { adoptQualityCalibration } from '../src/legacy-cube-calibration/adopt';
import { exportAdvisorCalibration } from '../src/legacy-cube-calibration/export-active';

const doubles = vi.hoisted(() => ({ collect: vi.fn(), regressions: vi.fn(), runtime: vi.fn() }));
vi.mock('../src/legacy-cube-calibration/quality-bundle', () => ({ collectQualityBundle: doubles.collect }));
vi.mock('../src/legacy-cube-calibration/adoption-regressions', () => ({
  runAdoptionRegressions: doubles.regressions,
}));
vi.mock('../src/legacy-cube-calibration/io', async (original) => ({
  ...(await original<object>()),
  calibrationSourceFingerprint: doubles.runtime,
}));
const catalog = parsePrintedCardCatalog(catalogJson);
const runtime = 'a'.repeat(64);
const candidate = { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'synthetic-trial/v1', synergy: 1.25 };
const identity = { catalogSha256: catalog.contentSha256, modelSha256: advisorModelFingerprint() };
const provenance = {
  provider: 'codex-cli',
  authentication: 'chatgpt-oauth',
  cliVersion: 'synthetic',
  requestedModel: 'synthetic-model',
  resolvedModel: null,
  runId: 'fixture',
  completedAt: '2026-09-11T04:00:00Z',
  generatorRuntimeSha256: runtime,
};
const roots: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  doubles.runtime.mockResolvedValue(runtime);
  doubles.regressions.mockResolvedValue({ passed: true, checks: [], sha256: 'b'.repeat(64) });
});
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mtg-adopt-'));
  roots.push(root);
  const paths = {
    bundle: join(root, 'bundle'),
    ledger: join(root, 'ledger'),
    receipts: join(root, 'receipts'),
    store: join(root, 'store'),
    out: join(root, 'decision'),
    transferCorpus: join(root, 'corpus.json'),
    transferReceipts: join(root, 'transfer'),
  };
  await mkdir(paths.transferReceipts);
  await writeFile(paths.transferCorpus, JSON.stringify(corpus));
  for (const task of buildTransferReviewTasks(corpus, catalog)) {
    const receipt = recordTransferReviewEvidence(
      catalog,
      corpus,
      task,
      {
        taskSha256: task.sha256,
        lessons: [
          {
            claim: 'Synthetic receipt only.',
            applicability: 'uncertain',
            sourceCards: [],
            cubeCards: [],
            rationale: 'No strategic evidence.',
            conditions: [],
          },
        ],
        environmentDifferences: ['Different list.'],
        uncertainty: ['Synthetic.'],
      },
      provenance,
    );
    await writeFile(join(paths.transferReceipts, `${task.sha256}.json`), JSON.stringify(receipt));
  }
  const campaign = buildQualityCampaign(catalog, {
    root: 'synthetic-adoption',
    split: 'holdout',
    indices: [0, 1],
    policies: [
      'current',
      'flexible',
      'pivot',
      ...LEGACY_CUBE_ADVISOR_MODEL.archetypes.map((a) => `pin:${a.id}`),
    ],
    baseline: DEFAULT_ADVISOR_WEIGHTS,
    candidate,
    runtimeSha256: runtime,
  });
  await mkdir(paths.bundle);
  await writeFile(join(paths.bundle, 'campaign.json'), JSON.stringify(campaign));
  const collected = {
    campaign,
    report: {
      sha256: 'c'.repeat(64),
      quality: { status: 'quality-supported', reasons: [], sha256: 'd'.repeat(64) },
    },
    reviews: [
      { baseline: { deck: { provenance }, advice: [] }, candidate: { deck: { provenance }, advice: [] } },
    ],
  };
  doubles.collect.mockResolvedValue(collected);
  return { root, paths, collected };
}

it('installs a supported provisional trial through canonical collection and preserves rollback history', async () => {
  const { paths } = await setup();
  const result = await adoptQualityCalibration(paths, catalog);
  expect(doubles.collect).toHaveBeenCalledWith(
    expect.objectContaining({ bundle: paths.bundle, receipts: paths.receipts }),
    catalog,
    runtime,
  );
  expect(doubles.regressions).toHaveBeenCalledOnce();
  expect(result.decision).toMatchObject({
    status: 'provisional-adopt',
    independentHumanValidation: false,
    gameplayEvidenceUsed: false,
  });
  expect(result.decision.limitations).toContain('model-judgment-not-independent-human-validation');
  const active = await readWeightStore(paths.store, identity);
  expect(active.weights).toEqual(candidate);
  expect(active.history[0]!.action).toMatchObject({ decisionSha256: result.decision.sha256 });
  expect(JSON.parse(await readFile(join(paths.out, 'decision.json'), 'utf8'))).toEqual(result.decision);
  const snapshot = await exportAdvisorCalibration(
    { store: paths.store, decision: join(paths.out, 'decision.json'), out: join(paths.out, 'advisor.json') },
    catalog,
  );
  expect(snapshot.weights).toEqual(candidate);
  expect(snapshot.provenance.transitionSha256).toBe(active.head);
  expect(snapshot.provenance.botValidated).toBe(false);
  await expect(
    exportAdvisorCalibration(
      {
        store: paths.store,
        decision: join(paths.out, 'decision.json'),
        out: join(paths.out, 'advisor.json'),
      },
      catalog,
    ),
  ).rejects.toMatchObject({ code: 'EEXIST' });
  doubles.runtime.mockResolvedValue('f'.repeat(64));
  await expect(
    exportAdvisorCalibration(
      { store: paths.store, decision: join(paths.out, 'decision.json'), out: join(paths.out, 'stale.json') },
      catalog,
    ),
  ).rejects.toThrow(/stale/);
});

it('retains authored weights for missing evidence and never labels a skipped regression as passed', async () => {
  const { paths, collected } = await setup();
  doubles.collect.mockResolvedValue({
    ...collected,
    report: {
      ...collected.report,
      quality: { status: 'retain-baseline', reasons: ['improvement-not-established'] },
    },
  });
  const result = await adoptQualityCalibration(paths, catalog);
  expect(result.decision.status).toBe('retain-baseline');
  expect(result.decision.reasons).toContain('improvement-not-established');
  expect(result.decision.regressions).toBeNull();
  expect(doubles.regressions).not.toHaveBeenCalled();
  await expect(readdir(paths.store)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('records missing quality receipts as missing evidence, without installing or claiming a validated tie', async () => {
  const { paths } = await setup();
  doubles.collect.mockRejectedValue(
    Object.assign(new Error('Missing review'), {
      code: 'ENOENT',
      path: join(paths.receipts, `${'e'.repeat(64)}.json`),
    }),
  );
  const result = await adoptQualityCalibration(paths, catalog);
  expect(result.decision.status).toBe('retain-baseline');
  expect(result.decision.reasons).toContain('missing-quality-review');
  expect(result.decision.quality).toBeNull();
  expect(result.decision.collection).toBeNull();
  expect(result.decision.transfer.role).toBe('context-only-not-held-out-validation');
  expect(result.decision.transfer.sourceSplits).toEqual(['tuning']);
  expect(doubles.regressions).not.toHaveBeenCalled();
});

it('refuses unpinned reviewers, incomplete exploration coverage, and a stale installed baseline', async () => {
  const { paths, collected } = await setup();
  const campaign = buildQualityCampaign(catalog, {
    ...collected.campaign.request,
    baseline: candidate,
    policies: ['current'],
  });
  await writeFile(join(paths.bundle, 'campaign.json'), JSON.stringify(campaign));
  doubles.collect.mockResolvedValue({
    ...collected,
    campaign,
    reviews: [
      {
        baseline: { deck: { provenance: { ...provenance, requestedModel: null } }, advice: [] },
        candidate: { deck: { provenance }, advice: [] },
      },
    ],
  });
  const result = await adoptQualityCalibration(paths, catalog);
  expect(result.decision.reasons).toEqual(
    expect.arrayContaining([
      'baseline-does-not-match-active-weights',
      'incomplete-exploration-coverage',
      'unpinned-or-inconsistent-reviewers',
    ]),
  );
  expect(doubles.regressions).not.toHaveBeenCalled();
});

it('keeps regressions and source changes from installing a candidate', async () => {
  const { paths } = await setup();
  doubles.regressions.mockResolvedValue({ passed: false, checks: [], sha256: 'b'.repeat(64) });
  doubles.runtime.mockResolvedValueOnce(runtime).mockResolvedValue('f'.repeat(64));
  const result = await adoptQualityCalibration(paths, catalog);
  expect(result.decision.reasons).toEqual(
    expect.arrayContaining(['regression-gates-failed', 'runtime-changed-during-review']),
  );
  expect((await readWeightStore(paths.store, identity)).head).toBeNull();
});

it('reports missing transfer receipts, rejects modified receipts, and refuses a pending store transition', async () => {
  const { paths } = await setup();
  const [name] = await readdir(paths.transferReceipts);
  await rm(join(paths.transferReceipts, name!));
  const missing = await adoptQualityCalibration(paths, catalog);
  expect(missing.decision.reasons).toContain('missing-transfer-review');
  await writeFile(join(paths.transferReceipts, name!), '{}');
  await expect(adoptQualityCalibration({ ...paths, out: `${paths.out}-bad` }, catalog)).rejects.toThrow();
  await mkdir(join(paths.store, '.weight-lock'), { recursive: true });
  await expect(adoptQualityCalibration({ ...paths, out: `${paths.out}-pending` }, catalog)).rejects.toThrow(
    /pending/i,
  );
});
