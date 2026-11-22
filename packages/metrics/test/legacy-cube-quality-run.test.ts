import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { exportQualityBundle, collectQualityBundle } from '../src/legacy-cube-calibration/quality-bundle';
import { runQualityReviews } from '../src/legacy-cube-calibration/quality-run';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 10.4 to 13.2 on 16
 * cores: the first test (a cold import of the run pipeline) took 2.3 to 2.7s
 * and the other six 0.7 to 1.3s, so 20s is about 7x the worst run.
 *
 * The default was too tight for the load other lanes put on this box: the same
 * file was seen at 4995ms of 5000ms at load 20.4 on base e4d72e78, and over
 * 5000ms on a merged tree, so the default decided which lane went red.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

const catalog = parsePrintedCardCatalog(catalogJson);
const runtime = 'a'.repeat(64);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mtg-quality-run-'));
  roots.push(root);
  const paths = { bundle: join(root, 'bundle'), ledger: join(root, 'ledger'), maxCalls: 7 };
  await exportQualityBundle(paths.bundle, paths.ledger, catalog, {
    root: 'automated-review-contract',
    split: 'holdout',
    indices: [0],
    policies: ['current'],
    baseline: DEFAULT_ADVISOR_WEIGHTS,
    candidate: DEFAULT_ADVISOR_WEIGHTS,
    runtimeSha256: runtime,
  });
  return { root, paths };
}
function reviewer() {
  return {
    model: 'synthetic-reviewer',
    review: vi.fn(async (input: { prompt: string; taskSha256: string }) => {
      const deck = input.prompt.includes('"selected"');
      return {
        response: {
          taskSha256: input.taskSha256,
          criteria: (deck
            ? ['coherence', 'castability', 'pool-alternatives']
            : ['explanation-accuracy', 'exploration-usefulness']
          ).map((criterion) => ({
            criterion,
            assessment: 'uncertain',
            rationale: 'Synthetic software fixture only.',
            cards: [],
            ...(deck ? { improvements: [] } : { claims: [], archetypes: [], corrections: [] }),
          })),
          uncertainty: [],
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
      };
    }),
  };
}

it('reviews canonical deduplicated tasks once and collects honest uncertain evidence', async () => {
  const { root, paths } = await setup();
  const model = reviewer();
  const result = await runQualityReviews(paths, catalog, runtime, model);
  expect(result.modelCalls).toBe(7);
  expect(model.review).toHaveBeenCalledTimes(7);
  const collected = await collectQualityBundle(
    { ...paths, receipts: result.receipts, out: join(root, 'result') },
    catalog,
    runtime,
  );
  expect(collected.report.quality.status).toBe('retain-baseline');
  const resumed = await runQualityReviews(paths, catalog, runtime, model);
  expect(resumed.modelCalls).toBe(0);
  expect(model.review).toHaveBeenCalledTimes(7);
  await expect(runQualityReviews(paths, catalog, runtime, { ...model, model: 'different' })).rejects.toThrow(
    /configuration/i,
  );
});

it('checks the full bundle and call budget before invoking the reviewer', async () => {
  const { paths } = await setup();
  const model = reviewer();
  await expect(runQualityReviews({ ...paths, maxCalls: 6 }, catalog, runtime, model)).rejects.toThrow(
    /budget/i,
  );
  expect(model.review).not.toHaveBeenCalled();
  await writeFile(join(paths.bundle, 'manifest.json'), '{}');
  await expect(runQualityReviews(paths, catalog, runtime, model)).rejects.toThrow(/manifest/i);
  expect(model.review).not.toHaveBeenCalled();
});

it('retains a failed attempt and refuses to sample a replacement on resume', async () => {
  const { paths } = await setup();
  const model = reviewer();
  model.review.mockRejectedValueOnce(new Error('Reviewer disconnected'));
  await expect(runQualityReviews(paths, catalog, runtime, model)).rejects.toThrow(/disconnected/);
  await expect(runQualityReviews(paths, catalog, runtime, model)).rejects.toThrow(/attempt.*incomplete/i);
  expect(model.review).toHaveBeenCalledTimes(1);
});

it('archives but never accepts mismatched reviewer provenance', async () => {
  const { paths } = await setup();
  const model = reviewer();
  const valid = model.review.getMockImplementation()!;
  model.review.mockImplementation(async (input) => {
    const response = await valid(input);
    return { ...response, provenance: { ...response.provenance, requestedModel: 'wrong' } };
  });
  await expect(runQualityReviews(paths, catalog, runtime, model)).rejects.toThrow(/provenance/i);
  await expect(runQualityReviews(paths, catalog, runtime, reviewer())).rejects.toThrow(
    /attempt.*incomplete/i,
  );
});

it('refuses changed receipts on resume without new model calls', async () => {
  const { paths } = await setup();
  const model = reviewer();
  const result = await runQualityReviews(paths, catalog, runtime, model);
  const manifest = JSON.parse(await readFile(join(paths.bundle, 'manifest.json'), 'utf8')) as {
    tasks: string[];
  };
  await writeFile(join(result.receipts, `${manifest.tasks[0]}.json`), '{}');
  await expect(runQualityReviews(paths, catalog, runtime, model)).rejects.toThrow();
  expect(model.review).toHaveBeenCalledTimes(7);
});

it('preflights all old attempt claims before spending calls on any unstarted task', async () => {
  const { paths } = await setup();
  const model = reviewer();
  await expect(runQualityReviews({ ...paths, maxCalls: 0 }, catalog, runtime, model)).rejects.toThrow(
    /budget/i,
  );
  const manifest = JSON.parse(await readFile(join(paths.bundle, 'manifest.json'), 'utf8')) as {
    campaign: string;
    tasks: string[];
  };
  await mkdir(join(paths.ledger, `reviews-${manifest.campaign}`, 'attempts', manifest.tasks.at(-1)!));
  await expect(runQualityReviews(paths, catalog, runtime, model)).rejects.toThrow(/attempt.*incomplete/i);
  expect(model.review).not.toHaveBeenCalled();
});

it('cannot concurrently sample the same task twice', async () => {
  const { paths } = await setup();
  const model = reviewer();
  const outcomes = await Promise.allSettled([
    runQualityReviews(paths, catalog, runtime, model),
    runQualityReviews(paths, catalog, runtime, model),
  ]);
  expect(outcomes.some((result) => result.status === 'fulfilled')).toBe(true);
  const ids = model.review.mock.calls.map(([input]) => input.taskSha256);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(7);
});
