import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildDeckReviewTask, parseDeckReviewJudgment } from '../src/legacy-cube-calibration/deck-review';
import { recordDeckReviewEvidence } from '../src/legacy-cube-calibration/deck-review-evidence';

const catalog = parsePrintedCardCatalog(catalogJson);
const pool = catalog.cards.slice(0, 45).map((card) => card.physicalId);
const selection = {
  pool,
  selected: pool.slice(0, 23),
  basics: { Plains: 17, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
};
const coordinates = { session: 'synthetic-deck', split: 'holdout' as const };
const provenance = {
  provider: 'codex-cli',
  authentication: 'chatgpt-oauth',
  cliVersion: 'fixture',
  requestedModel: null,
  resolvedModel: null,
  runId: 'synthetic-run',
  completedAt: '2026-09-11T03:00:00Z',
  generatorRuntimeSha256: '1'.repeat(64),
};
const task = () => buildDeckReviewTask(catalog, selection, coordinates);
const judgment = () => ({
  taskSha256: task().sha256,
  criteria: ['coherence', 'castability', 'pool-alternatives'].map((criterion) => ({
    criterion,
    assessment: 'uncertain',
    rationale: 'Synthetic harness response; no strategic evidence.',
    cards: [pool[0]!],
    improvements: ['Inspect the original Oracle context.'],
  })),
  uncertainty: ['Synthetic test fixture'],
});

it('builds a catalog-grounded finished-deck task without advisor scores or hidden opponents', () => {
  const input = { ...selection, opponentPools: ['secret'], weights: { quality: 4 }, seed: 'secret' };
  const result = buildDeckReviewTask(catalog, input, coordinates);
  expect(result).toEqual(task());
  expect(result.payload.pool).toHaveLength(45);
  expect(result.payload.deck.selected).toEqual(selection.selected);
  expect(result.payload.deck.report.cards).toBe(40);
  expect(result.payload.deck.report.legal).toBe(true);
  expect(result.payload.pool[0]!.faces).toEqual(catalog.cards[0]!.faces);
  expect(JSON.stringify(result.payload)).not.toMatch(/secret|weights|quality/);
  expect(result.instructions).toContain('not evidence about an earlier pick');
});

it('requires physical ownership, unique copies, exactly 45 drafted cards, and a legal deck', () => {
  for (const change of [
    { pool: pool.slice(0, 44) },
    { pool: [...pool.slice(1), pool[1]!] },
    { pool: ['absent', ...pool.slice(1)] },
    { selected: [...selection.selected.slice(1), catalog.cards[50]!.physicalId] },
    { selected: [pool[0]!, ...selection.selected.slice(0, 22)] },
    { basics: { ...selection.basics, Plains: -1 } },
    { basics: { ...selection.basics, Plains: 16 } },
  ]) {
    expect(() => buildDeckReviewTask(catalog, { ...selection, ...change }, coordinates)).toThrow();
  }
});

it('copies card and selection data and binds judgments to unchanged task content', () => {
  const original = task();
  const changed = task();
  changed.payload.pool[0]!.faces[0]!.name = 'changed fixture face';
  expect(task()).toEqual(original);
  expect(() => parseDeckReviewJudgment(changed, judgment())).toThrow(/Modified/);
  expect(() => parseDeckReviewJudgment(original, { ...judgment(), taskSha256: '0'.repeat(64) })).toThrow(
    /digest/,
  );
});

it('requires substantive coverage of all three criteria without promoting model judgment', () => {
  const result = parseDeckReviewJudgment(task(), judgment());
  expect(result.origin).toBe('model');
  expect(result.independentHumanEvidence).toBe(false);
  expect(result.adoptionEligible).toBe(false);
  expect(result.judgment.criteria).toHaveLength(3);
  for (const criteria of [
    judgment().criteria.slice(0, 2),
    judgment().criteria.map(() => judgment().criteria[0]!),
    judgment().criteria.map((criterion) => ({ ...criterion, rationale: '' })),
    judgment().criteria.map((criterion) => ({ ...criterion, cards: [catalog.cards[50]!.physicalId] })),
    judgment().criteria.map((criterion) => ({ ...criterion, cards: [pool[0]!, pool[0]!] })),
  ]) {
    expect(() => parseDeckReviewJudgment(task(), { ...judgment(), criteria })).toThrow();
  }
});

it('reconstructs imported deck tasks from the catalog and preserves declared provenance limitations', () => {
  const receipt = recordDeckReviewEvidence(catalog, task(), judgment(), provenance);
  expect(receipt.provenance.resolvedModel).toBeNull();
  expect(receipt.limitations).toContain('unreported-model-version');
  expect(receipt.limitations).toContain('operator-asserted-provenance');
  expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
  const changed = task();
  changed.payload.pool[0]!.faces[0]!.name = 'changed fixture face';
  expect(() => recordDeckReviewEvidence(catalog, changed, judgment(), provenance)).toThrow(/canonical/);
  expect(() =>
    recordDeckReviewEvidence(catalog, { ...task(), hidden: true }, judgment(), provenance),
  ).toThrow(/canonical/);
  expect(() =>
    recordDeckReviewEvidence(catalog, task(), judgment(), { ...provenance, token: 'bad' }),
  ).toThrow();
  const pinned = recordDeckReviewEvidence(catalog, task(), judgment(), {
    ...provenance,
    requestedModel: 'fixture-model',
    resolvedModel: 'fixture-snapshot',
  });
  expect(pinned.limitations).not.toContain('unreported-model-version');
  expect(pinned.adoptionEligible).toBe(false);
  const badReport = task();
  const altered = {
    ...badReport,
    payload: {
      ...badReport.payload,
      deck: { ...badReport.payload.deck, report: { ...badReport.payload.deck.report, cards: 41 } },
    },
  };
  expect(() => recordDeckReviewEvidence(catalog, altered, judgment(), provenance)).toThrow(/canonical/);
});

it('exports a real draft deck for review and imports a response without overwriting artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-deck-review-'));
  const invoke = promisify(execFile);
  const cli = (name: string) => fileURLToPath(new URL(`../tools/${name}.ts`, import.meta.url));
  try {
    const out = join(root, 'sample');
    const args = [
      '--import',
      'tsx',
      cli('legacy-cube-deck-sample'),
      '--seed',
      'fixture-deck-sample',
      '--split',
      'tuning',
      '--policy',
      'pin:reanimator',
      '--out',
      out,
    ];
    await invoke(process.execPath, args);
    const generated = JSON.parse(await readFile(join(out, 'task.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(generated.payload.pool).toHaveLength(45);
    expect(generated.payload.deck.report.cards).toBe(40);
    expect(manifest.taskSha256).toBe(generated.sha256);
    expect(manifest.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    const prompt = await readFile(join(out, 'prompt.txt'), 'utf8');
    expect(prompt).not.toContain(manifest.seed);
    expect(prompt).not.toContain(manifest.weights.revision);
    const response = {
      ...judgment(),
      taskSha256: generated.sha256,
      criteria: judgment().criteria.map((row) => ({ ...row, cards: [generated.payload.pool[0].physicalId] })),
    };
    await writeFile(join(out, 'response.json'), JSON.stringify(response), { flag: 'wx' });
    await writeFile(join(out, 'provenance.json'), JSON.stringify(provenance), { flag: 'wx' });
    const importArgs = [
      '--import',
      'tsx',
      cli('legacy-cube-model-import'),
      '--task',
      join(out, 'task.json'),
      '--response',
      join(out, 'response.json'),
      '--provenance',
      join(out, 'provenance.json'),
      '--out',
      join(out, 'receipt.json'),
    ];
    await invoke(process.execPath, importArgs);
    const receipt = JSON.parse(await readFile(join(out, 'receipt.json'), 'utf8'));
    expect(receipt).toEqual(recordDeckReviewEvidence(catalog, generated, response, provenance));
    // The three refusals read the artifacts written above and write nothing, so they are
    // independent; each is a fresh tsx process, and running them together is what keeps the
    // wall clock near one process rather than three.
    await Promise.all([
      expect(invoke(process.execPath, importArgs)).rejects.toThrow(/EEXIST/),
      expect(invoke(process.execPath, args)).rejects.toThrow(/EEXIST/),
      expect(invoke(process.execPath, [...args, '--unknown', 'bad'])).rejects.toThrow(/Invalid/),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  // Five tsx child processes, measured at 2.2-2.4s alone at load 14 (0.35-0.7s each). Each
  // process is CPU-bound start-up, so a host at load 30-50 stretches the whole test several
  // times over; the default 5s left no room for that (mtg-udi4x).
}, 30000);
