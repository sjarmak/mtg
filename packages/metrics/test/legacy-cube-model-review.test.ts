import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import {
  buildModelReviewTask,
  parseModelJudgment,
  sampleDraftReviewTasks,
} from '../src/legacy-cube-calibration/model-review';
import { draftCalibrationPool } from '../src/legacy-cube-calibration/draft';

const catalog = parsePrintedCardCatalog(catalogJson);
const cards = catalog.cards.slice(0, 15);
const observed = {
  seats: 8,
  rounds: 3,
  packSize: 15,
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards }],
};
const coordinates = {
  session: 'fixture-session',
  split: 'tuning' as const,
  mode: 'explore' as const,
  archetype: 'reanimator',
  replica: 0 as const,
};
const task = () => buildModelReviewTask(catalog, observed, coordinates);
const answer = () => ({
  taskSha256: task().sha256,
  acceptable: [cards[0]!.physicalId],
  confidence: 'low',
  pros: [{ text: 'Fixture assertion, not strategic evidence.', cards: [cards[0]!.physicalId] }],
  cons: [],
  paths: [
    { archetype: 'reanimator', status: 'Speculative', missing: ['Setup and targets'], pivotCost: 'Low' },
  ],
  uncertainty: ['Synthetic test label'],
});

it('emits a reproducible offline sample bundle and refuses an existing output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-model-sampling-'));
  try {
    const cli = fileURLToPath(new URL('../tools/legacy-cube-model-sample.ts', import.meta.url));
    const invoke = promisify(execFile);
    const out = join(root, 'sample');
    const args = [
      '--import',
      'tsx',
      cli,
      '--seed',
      'fixture-model-sampling',
      '--split',
      'tuning',
      '--policy',
      'pin:reanimator',
      '--out',
      out,
    ];
    await invoke(process.execPath, args);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.origin).toBe('simulation');
    expect(manifest.tasks).toHaveLength(6);
    expect(manifest.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    const input = JSON.parse(await readFile(join(out, 'task-0.json'), 'utf8'));
    expect(input.payload.picks).toEqual([]);
    const prompt = await readFile(join(out, 'prompt-0.txt'), 'utf8');
    expect(prompt).toContain(input.sha256);
    expect(prompt).not.toContain('fixture-model-sampling');
    await expect(invoke(process.execPath, args)).rejects.toThrow(/EEXIST/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('blinds reviewer inputs to authored scores, preferred picks, seed, and hidden draft information', () => {
  const leaked = {
    ...observed,
    botHands: ['secret-hand'],
    seed: 'secret-seed',
    weights: { bad: 4 },
    observations: observed.observations.map((o) => ({
      ...o,
      cards: o.cards.map((c) => ({ ...c, quality: 99 })),
    })),
  };
  expect(buildModelReviewTask(catalog, leaked, coordinates)).toEqual(task());
  const serialized = JSON.stringify(task().payload);
  for (const hidden of ['secret-hand', 'secret-seed', 'quality', 'weights', 'acceptable'])
    expect(serialized).not.toContain(hidden);
  expect(task().payload.cube).toHaveLength(600);
  expect(task().payload.observedCards).toHaveLength(15);
});

it('counterbalances pack presentation while retaining the same observation history', () => {
  const a = task();
  const b = buildModelReviewTask(catalog, observed, { ...coordinates, replica: 1 });
  expect(b.payload.currentPack).toEqual([...a.payload.currentPack].reverse());
  expect(b.payload.observations).toEqual(a.payload.observations);
  expect(b.sha256).not.toBe(a.sha256);
});

it('detects changed tasks and does not share mutable catalog or taxonomy objects', () => {
  const original = task();
  const changed = task();
  changed.payload.observedCards[0]!.faces[0]!.name = 'Changed face';
  changed.payload.archetypes[0]!.name = 'Changed path';
  expect(task()).toEqual(original);
  expect(() => parseModelJudgment(changed, answer())).toThrow(/Modified/);
});

it('rejects unsupported draft dimensions, unknown cards, and invalid objectives', () => {
  expect(() => buildModelReviewTask(catalog, { ...observed, seats: 7 }, coordinates)).toThrow(/eight-seat/);
  const unknown = { ...cards[0]!, physicalId: 'unknown' };
  expect(() =>
    buildModelReviewTask(
      catalog,
      { ...observed, observations: [{ round: 1, pickNumber: 1, cards: [unknown, ...cards.slice(1)] }] },
      coordinates,
    ),
  ).toThrow(/Unknown observed/);
  expect(() => buildModelReviewTask(catalog, observed, { ...coordinates, mode: 'flexible' })).toThrow(
    /objective/,
  );
  expect(() => sampleDraftReviewTasks(catalog, [], { session: 'fixture', split: 'tuning' })).toThrow(
    /complete/,
  );
});

it('validates labels against their exact task and keeps model judgments nonhuman', () => {
  const result = parseModelJudgment(task(), answer());
  expect(result.origin).toBe('model');
  expect(result.independentHumanEvidence).toBe(false);
  expect(result.judgment.acceptable).toEqual([cards[0]!.physicalId]);
  expect(() => parseModelJudgment(task(), { ...answer(), taskSha256: '0'.repeat(64) })).toThrow(/task/);
  expect(() =>
    parseModelJudgment(task(), { ...answer(), acceptable: [catalog.cards[20]!.physicalId] }),
  ).toThrow(/current pack/);
  expect(() =>
    parseModelJudgment(task(), {
      ...answer(),
      pros: [{ text: 'Unseen', cards: [catalog.cards[20]!.physicalId] }],
    }),
  ).toThrow(/unobserved/);
  expect(() =>
    parseModelJudgment(task(), { ...answer(), acceptable: [cards[0]!.physicalId, cards[0]!.physicalId] }),
  ).toThrow(/Duplicate/);
});

it('rejects unknown archetypes and malformed or completed observations before model use', () => {
  expect(() => buildModelReviewTask(catalog, observed, { ...coordinates, archetype: 'invented' })).toThrow(
    /archetype/,
  );
  expect(() => buildModelReviewTask(catalog, { ...observed, picks: ['absent'] }, coordinates)).toThrow();
  expect(() =>
    parseModelJudgment(task(), { ...answer(), paths: [{ ...answer().paths[0]!, archetype: 'invented' }] }),
  ).toThrow(/archetype/);
});

it('samples early, middle, and late observations from real seeded drafts without future picks', () => {
  const draft = draftCalibrationPool(catalog, 'model-review-fixture', 'pin:reanimator');
  const tasks = sampleDraftReviewTasks(catalog, draft.trace, { session: 'fixture-draft', split: 'tuning' });
  expect(tasks).toHaveLength(6);
  expect(tasks.map((t) => t.payload.picks.length)).toEqual([0, 7, 15, 29, 37, 44]);
  expect(tasks.every((t) => t.payload.objective.archetype === 'reanimator')).toBe(true);
  for (const sampled of tasks) {
    const n = sampled.payload.picks.length;
    expect(sampled.payload.picks).toEqual(draft.trace.slice(0, n).map((p) => p.chosen));
    expect(sampled.payload.observations).toHaveLength(n + 1);
    expect(sampled.payload.currentPack).toEqual(draft.trace[n]!.seen);
  }
  expect(LEGACY_CUBE_ADVISOR_MODEL.archetypes.some((a) => a.id === 'reanimator')).toBe(true);
});
