import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import corpus from '../data/legacy-cube-transfer-holdout-decks-v1.json';
import { runTransferReviews } from '../src/legacy-cube-calibration/transfer-run';

const catalog = parsePrintedCardCatalog(catalogJson);
const runtime = 'a'.repeat(64);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const ledger = await mkdtemp(join(tmpdir(), 'mtg-transfer-run-'));
  roots.push(ledger);
  return { ledger, split: 'holdout', maxCalls: 1 };
}
function reviewer() {
  return {
    model: 'synthetic-reviewer',
    review: vi.fn(async (input: { prompt: string; schema: unknown; taskSha256: string }) => ({
      response: {
        taskSha256: input.taskSha256,
        lessons: [
          {
            claim: 'Synthetic contract fixture only.',
            applicability: 'uncertain',
            sourceCards: [],
            cubeCards: [],
            rationale: 'No strategic validation claimed.',
            conditions: [],
          },
        ],
        environmentDifferences: ['Source environment differs.'],
        uncertainty: ['Synthetic review.'],
      },
      provenance: {
        provider: 'codex-cli',
        authentication: 'chatgpt-oauth',
        cliVersion: 'fixture',
        requestedModel: 'synthetic-reviewer',
        resolvedModel: null,
        runId: input.taskSha256,
        completedAt: '2026-09-11T04:00:00Z',
        generatorRuntimeSha256: runtime,
      },
    })),
  };
}

it('archives canonical adjacent-source reviews as model evidence and resumes without calls', async () => {
  const paths = await setup();
  const model = reviewer();
  const result = await runTransferReviews(paths, corpus, catalog, runtime, model);
  expect(result.modelCalls).toBe(1);
  const files = await readdir(result.receipts);
  expect(files).toHaveLength(1);
  const receipt = JSON.parse(await readFile(join(result.receipts, files[0]!), 'utf8'));
  expect(receipt).toMatchObject({
    origin: 'model',
    independentHumanEvidence: false,
    adoptionEligible: false,
  });
  expect(receipt.task.payload.original).toEqual(corpus.cases[0]);
  const input = model.review.mock.calls[0]![0];
  expect(input.schema).toHaveProperty('properties.taskSha256.enum', [input.taskSha256]);
  expect(input.prompt).toContain('Do not reconstruct unseen packs');
  expect(
    (await runTransferReviews({ ...paths, maxCalls: 0 }, corpus, catalog, runtime, model)).modelCalls,
  ).toBe(0);
  expect(model.review).toHaveBeenCalledTimes(1);
});

it('checks the split and complete call budget before invoking a reviewer', async () => {
  const paths = await setup();
  const model = reviewer();
  await expect(
    runTransferReviews({ ...paths, maxCalls: 0 }, corpus, catalog, runtime, model),
  ).rejects.toThrow(/budget/i);
  await expect(
    runTransferReviews({ ...paths, split: 'tuning' }, corpus, catalog, runtime, model),
  ).rejects.toThrow(/tuning-only/i);
  expect(model.review).not.toHaveBeenCalled();
});

it('keeps a failed attempt and refuses automatic replacement sampling', async () => {
  const paths = await setup();
  const model = reviewer();
  model.review.mockRejectedValueOnce(new Error('Disconnected'));
  await expect(runTransferReviews(paths, corpus, catalog, runtime, model)).rejects.toThrow(/Disconnected/);
  await expect(runTransferReviews(paths, corpus, catalog, runtime, model)).rejects.toThrow(/incomplete/i);
  expect(model.review).toHaveBeenCalledTimes(1);
});

it('rejects changed receipts, model, or runtime without spending another call', async () => {
  const paths = await setup();
  const model = reviewer();
  const result = await runTransferReviews(paths, corpus, catalog, runtime, model);
  await expect(
    runTransferReviews(paths, corpus, catalog, runtime, { ...model, model: 'changed' }),
  ).rejects.toThrow(/configuration/i);
  await expect(runTransferReviews(paths, corpus, catalog, 'b'.repeat(64), model)).rejects.toThrow(
    /configuration/i,
  );
  const [file] = await readdir(result.receipts);
  await writeFile(join(result.receipts, file!), '{}');
  await expect(runTransferReviews(paths, corpus, catalog, runtime, model)).rejects.toThrow(/receipt/i);
  expect(model.review).toHaveBeenCalledTimes(1);
});

it('admits only the frozen model and runtime provenance', async () => {
  const paths = await setup();
  const model = reviewer();
  const invalid = await model.review({ prompt: '', schema: {}, taskSha256: 'a'.repeat(64) });
  model.review.mockClear();
  model.review.mockImplementationOnce(async (input) => ({
    ...invalid,
    response: { ...invalid.response, taskSha256: input.taskSha256 },
    provenance: { ...invalid.provenance, requestedModel: 'changed' },
  }));
  await expect(runTransferReviews(paths, corpus, catalog, runtime, model)).rejects.toThrow(/provenance/i);
});
