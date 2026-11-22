import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { DEFAULT_ADVISOR_WEIGHTS, evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildModelReviewTask, sampleDraftReviewTasks } from '../src/legacy-cube-calibration/model-review';
import { draftCalibrationPool } from '../src/legacy-cube-calibration/draft';
import {
  buildAdviceReviewTask,
  readAdviceReviewEvidence,
  recordAdviceReviewEvidence,
} from '../src/legacy-cube-calibration/advice-review';

const catalog = parsePrintedCardCatalog(catalogJson);
const observed = {
  seats: 8,
  rounds: 3,
  packSize: 15,
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
};
const source = () =>
  buildModelReviewTask(catalog, observed, {
    session: 'advice-review-fixture',
    split: 'tuning',
    mode: 'explore',
    archetype: 'reanimator',
    replica: 0,
  });
const task = () => buildAdviceReviewTask(catalog, source(), DEFAULT_ADVISOR_WEIGHTS);
const provenance = {
  provider: 'codex-cli',
  authentication: 'chatgpt-oauth',
  cliVersion: 'fixture',
  requestedModel: null,
  resolvedModel: null,
  runId: 'fixture-run',
  completedAt: '2026-09-11T00:00:00.000Z',
  generatorRuntimeSha256: '1'.repeat(64),
};
const answer = () => ({
  taskSha256: task().sha256,
  criteria: ['explanation-accuracy', 'exploration-usefulness'].map((criterion) => ({
    criterion,
    assessment: 'uncertain',
    rationale: 'Synthetic schema fixture, not quality evidence.',
    claims: [task().payload.advice.claims[0]!.id],
    cards: [catalog.cards[0]!.physicalId],
    archetypes: ['reanimator'],
    corrections: [],
  })),
  uncertainty: ['No expert judgment provided.'],
});

it('reviews actual generated claims and all paths without numeric scores or hidden context', () => {
  const review = task();
  const advice = evaluateDraft(observed, LEGACY_CUBE_ADVISOR_MODEL, 'reanimator');
  expect(review.payload.advice.recommendations.map((r) => r.card)).toEqual(
    advice.recommendations.map((r) => r.card.physicalId),
  );
  expect(review.payload.advice.paths.map((p) => p.id)).toEqual(advice.archetypes.map((p) => p.id));
  expect(review.payload.advice.paths[0]).toMatchObject({
    signal: 'Unknown',
    fit: 'None',
    quality: 'Unknown',
    density: 'Scattered',
    structure: 'Incomplete',
  });
  expect(review.payload.advice.claims.map((c) => c.reason.text)).toContain(advice.cards[0]!.reasons[0]!.text);
  const prompt = JSON.stringify(review.payload);
  for (const forbidden of [
    'weights',
    'flexibleScore',
    'poolFit',
    'advice-review-fixture',
    'seed',
    'botHands',
  ])
    expect(prompt).not.toContain(forbidden);
  expect(review.payload.context).toEqual(source().payload);
  expect(review.instructions).toContain('not a gold answer');
  expect(review.instructions).toContain('Do not infer unseen card locations');
});

it('binds weights and canonical observed context while rejecting fabricated inputs', () => {
  expect(
    buildAdviceReviewTask(catalog, source(), { ...DEFAULT_ADVISOR_WEIGHTS, synergy: 1.25 }).sha256,
  ).not.toBe(task().sha256);
  expect(() =>
    buildAdviceReviewTask(catalog, { ...source(), hidden: 'secret' }, DEFAULT_ADVISOR_WEIGHTS),
  ).toThrow(/canonical/);
  expect(() =>
    buildAdviceReviewTask(catalog, source(), { ...DEFAULT_ADVISOR_WEIGHTS, synergy: -1 }),
  ).toThrow();
  const changed = source();
  changed.payload.observedCards[0]!.faces[0]!.name = 'Changed face';
  expect(() => buildAdviceReviewTask(catalog, changed, DEFAULT_ADVISOR_WEIGHTS)).toThrow(/canonical/);
});

it('preserves late-draft context and qualitative labels across a complete seeded draft', () => {
  const draft = draftCalibrationPool(catalog, 'advice-stage-fixture', 'pin:reanimator');
  const samples = sampleDraftReviewTasks(catalog, draft.trace, { session: 'stage-fixture', split: 'tuning' });
  const reviews = samples.map((sample) => buildAdviceReviewTask(catalog, sample, DEFAULT_ADVISOR_WEIGHTS));
  expect(reviews.map((r) => r.payload.context.picks.length)).toEqual([0, 7, 15, 29, 37, 44]);
  for (const review of reviews) {
    const seen = new Set(review.payload.context.observedCards.map((card) => card.physicalId));
    expect(
      review.payload.advice.claims.every((claim) => claim.reason.cards.every((card) => seen.has(card))),
    ).toBe(true);
    expect(new Set(review.payload.advice.claims.map((claim) => claim.id)).size).toBe(
      review.payload.advice.claims.length,
    );
    expect(review.payload.advice.paths).toHaveLength(17);
    expect(review.payload.advice.cards.map((card) => card.card).sort()).toEqual(
      [...review.payload.context.currentPack].sort(),
    );
  }
  expect(reviews.at(-1)!.payload.advice.paths.some((path) => path.fit === 'Strong')).toBe(true);
});

it('imports only grounded complete judgments and retains their model origin', () => {
  const receipt = recordAdviceReviewEvidence(catalog, task(), answer(), provenance);
  expect(receipt.origin).toBe('model');
  expect(receipt.independentHumanEvidence).toBe(false);
  expect(receipt.adoptionEligible).toBe(false);
  expect(receipt.limitations).toContain('semantic-accuracy-not-mechanically-proven');
  for (const patch of [
    { claims: ['absent-claim'] },
    { cards: [catalog.cards[100]!.physicalId] },
    { archetypes: ['absent-path'] },
    { claims: [task().payload.advice.claims[0]!.id, task().payload.advice.claims[0]!.id] },
  ]) {
    const value = answer();
    expect(() =>
      recordAdviceReviewEvidence(
        catalog,
        task(),
        {
          ...value,
          criteria: [{ ...value.criteria[0], ...patch }, value.criteria[1]],
        },
        provenance,
      ),
    ).toThrow(/reference/);
  }
  expect(() =>
    recordAdviceReviewEvidence(
      catalog,
      task(),
      { ...answer(), criteria: [answer().criteria[0], answer().criteria[0]] },
      provenance,
    ),
  ).toThrow(/criterion/);
  expect(() =>
    recordAdviceReviewEvidence(catalog, task(), { ...answer(), taskSha256: '0'.repeat(64) }, provenance),
  ).toThrow(/digest/);
});

it('recomputes advice before accepting receipts, rejecting altered prose and provenance', () => {
  const changed = task();
  changed.payload.advice.claims[0]!.reason.text = 'Forged explanation';
  expect(() => recordAdviceReviewEvidence(catalog, changed, answer(), provenance)).toThrow(/canonical/);
  expect(() =>
    recordAdviceReviewEvidence(catalog, task(), answer(), { ...provenance, token: 'secret' }),
  ).toThrow();
  expect(task().payload.advice.claims[0]!.reason.text).not.toBe('Forged explanation');
  const receipt = recordAdviceReviewEvidence(catalog, task(), answer(), provenance);
  expect(readAdviceReviewEvidence(catalog, receipt)).toEqual(receipt);
  expect(() => readAdviceReviewEvidence(catalog, { ...receipt, adoptionEligible: true })).toThrow(/receipt/);
  expect(() => readAdviceReviewEvidence(catalog, { ...receipt, origin: 'human' })).toThrow(/receipt/);
});

it('exports a blinded review and imports its receipt through the offline commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-advice-review-'));
  try {
    const input = join(root, 'input.json');
    const weights = join(root, 'weights.json');
    await writeFile(input, JSON.stringify(source()));
    await writeFile(weights, JSON.stringify(DEFAULT_ADVISOR_WEIGHTS));
    const invoke = promisify(execFile);
    const sample = fileURLToPath(new URL('../tools/legacy-cube-advice-sample.ts', import.meta.url));
    const out = join(root, 'sample');
    const args = ['--import', 'tsx', sample, '--task', input, '--weights', weights, '--out', out];
    await invoke(process.execPath, args);
    expect(JSON.parse(await readFile(join(out, 'task.json'), 'utf8'))).toEqual(task());
    const prompt = await readFile(join(out, 'prompt.txt'), 'utf8');
    expect(prompt).toContain(task().sha256);
    expect(prompt).not.toContain('advice-review-fixture');
    expect(prompt.includes('"weights":')).toBe(false);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.sourceTask).toBe(source().sha256);
    expect(manifest.task).toBe(task().sha256);
    expect(manifest.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(invoke(process.execPath, args)).rejects.toThrow(/EEXIST/);
    await writeFile(join(root, 'response.json'), JSON.stringify(answer()));
    await writeFile(join(root, 'provenance.json'), JSON.stringify(provenance));
    const importer = fileURLToPath(new URL('../tools/legacy-cube-model-import.ts', import.meta.url));
    const importArgs = [
      '--import',
      'tsx',
      importer,
      '--task',
      join(out, 'task.json'),
      '--response',
      join(root, 'response.json'),
      '--provenance',
      join(root, 'provenance.json'),
      '--out',
      join(root, 'receipt.json'),
    ];
    await invoke(process.execPath, importArgs);
    const receipt = JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8'));
    expect(receipt).toEqual(recordAdviceReviewEvidence(catalog, task(), answer(), provenance));
    await expect(invoke(process.execPath, importArgs)).rejects.toThrow(/EEXIST/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
