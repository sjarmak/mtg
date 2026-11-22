import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import corpus from '../data/legacy-cube-transfer-holdout-decks-v1.json';
import {
  buildTransferReviewTasks,
  parseTransferJudgment,
  recordTransferReviewEvidence,
} from '../src/legacy-cube-calibration/transfer-review';

const catalog = parsePrintedCardCatalog(catalogJson);
const provenance = {
  provider: 'codex-cli',
  authentication: 'chatgpt-oauth',
  cliVersion: 'fixture',
  requestedModel: null,
  resolvedModel: null,
  runId: 'synthetic-test',
  completedAt: '2026-09-11T00:00:00Z',
  generatorRuntimeSha256: '0'.repeat(64),
};
const task = () => buildTransferReviewTasks(corpus, catalog, 'holdout')[0]!;
// Synthetic contract labels, not a claim about this human deck's strategic quality.
const judgment = (subject = task()) => ({
  taskSha256: subject.sha256,
  lessons: [
    {
      claim: 'A reanimation package needs targets and access to the graveyard.',
      applicability: 'conditional',
      sourceCards: ['Ashen Rider'],
      cubeCards: ['Reanimate'],
      rationale: 'The target differs; this does not validate the original deck in the pinned Cube.',
      conditions: ['Check available target and discard density.'],
    },
  ],
  environmentDifferences: ['The original deck includes cards absent from this Cube.'],
  uncertainty: ['Original draft packs are unavailable.'],
});

it('preserves the human source, absent cards, split, and current Oracle data without substitutions', () => {
  const subject = task();
  expect(subject.payload.original).toEqual(corpus.cases[0]);
  expect(subject.coordinates.split).toBe('holdout');
  expect(subject.payload.overlap.missingNames).toContain('Ashen Rider');
  expect(subject.payload.cube).toHaveLength(600);
  expect(subject.payload.cube.find((c) => c.name === 'Reanimate')?.faces).toEqual(
    catalog.cards.find((c) => c.correctedName === 'Reanimate')!.faces,
  );
  expect(subject.instructions).toContain('Do not reconstruct unseen packs');
  expect(buildTransferReviewTasks(corpus, catalog, 'holdout')).toEqual([subject]);
  expect(() => buildTransferReviewTasks(corpus, catalog, 'tuning')).toThrow(/tuning-only/);
});

it('keeps model interpretations distinct from the human source and retains uncertainty', () => {
  const subject = task();
  const result = parseTransferJudgment(subject, judgment(subject));
  expect(result).toMatchObject({ origin: 'model', independentHumanEvidence: false, adoptionEligible: false });
  expect(result.judgment.uncertainty).toHaveLength(1);
  expect(result.judgment.lessons[0]!.applicability).toBe('conditional');
  expect(subject.payload.original.source.origin).toBe('human');
});

it('rejects modified tasks, wrong receipts, unknown references, and duplicate references', () => {
  const subject = task();
  const input = judgment(subject);
  expect(() => parseTransferJudgment({ ...subject, instructions: 'changed' }, input)).toThrow(/Modified/);
  expect(() => parseTransferJudgment(subject, { ...input, taskSha256: '0'.repeat(64) })).toThrow(/digest/);
  for (const change of [
    { sourceCards: ['Not a source card'] },
    { cubeCards: ['Ashen Rider'] },
    { cubeCards: ['Reanimate', 'Reanimate'] },
    { applicability: 'conditional', conditions: [] },
  ]) {
    expect(() =>
      parseTransferJudgment(subject, { ...input, lessons: [{ ...input.lessons[0], ...change }] }),
    ).toThrow();
  }
});

it('does not manufacture transfer tasks for model, unknown, or matched evidence', () => {
  for (const change of [{ origin: 'model' }, { environment: 'unknown' }, { environment: 'matched' }]) {
    const original = corpus.cases[0]!;
    expect(
      buildTransferReviewTasks(
        { ...corpus, cases: [{ ...original, source: { ...original.source, ...change } }] },
        catalog,
      ),
    ).toEqual([]);
  }
});

it('exports the real adjacent holdout task and response schema through the read-only CLI', async () => {
  const cli = fileURLToPath(new URL('../tools/legacy-cube-evidence.ts', import.meta.url));
  const input = fileURLToPath(new URL('../data/legacy-cube-transfer-holdout-decks-v1.json', import.meta.url));
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', cli, '--report', 'transfer-tasks', '--corpus', input],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const exported = JSON.parse(result.stdout);
  expect(exported.tasks).toEqual([task()]);
  expect(exported.responseSchema.required).toContain('taskSha256');
  expect(exported.adoptionEligible).toBe(false);
});

it('archives reviews only against the supplied canonical corpus and catalog, including provenance', () => {
  const subject = task();
  const response = judgment(subject);
  const receipt = recordTransferReviewEvidence(catalog, corpus, subject, response, provenance);
  expect(receipt).toMatchObject({ origin: 'model', adoptionEligible: false, provenance });
  expect(receipt.limitations).toContain('unreported-model-version');
  expect(
    recordTransferReviewEvidence(catalog, corpus, subject, response, {
      ...provenance,
      resolvedModel: 'fixture',
    }).limitations,
  ).not.toContain('unreported-model-version');
  const modified = { ...subject, payload: { ...subject.payload, cube: [] } };
  const { sha256: _sha, ...body } = modified;
  const forged = { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
  expect(() => recordTransferReviewEvidence(catalog, corpus, forged, response, provenance)).toThrow(
    /canonical/,
  );
  expect(() =>
    recordTransferReviewEvidence(catalog, { ...corpus, cases: [] }, subject, response, provenance),
  ).toThrow(/canonical/);
  expect(() =>
    recordTransferReviewEvidence(catalog, corpus, subject, response, { ...provenance, provider: 'unknown' }),
  ).toThrow();
});

it('imports a transfer receipt through the existing CLI only with its source corpus', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-transfer-import-'));
  try {
    const subject = task();
    for (const [name, value] of Object.entries({ task: subject, response: judgment(subject), provenance }))
      await writeFile(join(directory, `${name}.json`), JSON.stringify(value));
    const cli = fileURLToPath(new URL('../tools/legacy-cube-model-import.ts', import.meta.url));
    const source = fileURLToPath(
      new URL('../data/legacy-cube-transfer-holdout-decks-v1.json', import.meta.url),
    );
    const args = [
      '--import',
      'tsx',
      cli,
      '--task',
      join(directory, 'task.json'),
      '--response',
      join(directory, 'response.json'),
      '--provenance',
      join(directory, 'provenance.json'),
      '--out',
      join(directory, 'receipt.json'),
    ];
    const run = promisify(execFile);
    await expect(run(process.execPath, args)).rejects.toThrow(/requires --corpus/);
    const result = await run(process.execPath, [...args, '--corpus', source]);
    expect(JSON.parse(result.stdout)).toMatchObject({ origin: 'model', adoptionEligible: false });
    expect(JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'))).toEqual(
      recordTransferReviewEvidence(catalog, corpus, subject, judgment(subject), provenance),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
