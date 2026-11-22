import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildModelReviewTask } from '../src/legacy-cube-calibration/model-review';
import { recordModelEvidence, readModelEvidence } from '../src/legacy-cube-calibration/model-evidence';
import { compareModelEvidence } from '../src/legacy-cube-calibration/model-comparison';

const catalog = parsePrintedCardCatalog(catalogJson);
function receipt(
  replica: 0 | 1 = 0,
  split: 'tuning' | 'holdout' = 'tuning',
  session = 'fixture',
  mode: 'flexible' | 'explore' | 'pivot' = 'flexible',
) {
  const task = buildModelReviewTask(
    catalog,
    {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks: [],
      observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
    },
    { session, split, mode, archetype: mode === 'explore' ? 'reanimator' : null, replica },
  );
  return recordModelEvidence(
    catalog,
    task,
    {
      taskSha256: task.sha256,
      acceptable: task.payload.currentPack,
      confidence: 'low',
      pros: [],
      cons: [],
      paths: [],
      uncertainty: ['Synthetic fixture only'],
    },
    {
      provider: 'codex-cli',
      authentication: 'chatgpt-oauth',
      cliVersion: 'fixture',
      requestedModel: null,
      resolvedModel: null,
      runId: `fixture-${replica}`,
      completedAt: '2026-09-10T23:00:00Z',
      generatorRuntimeSha256: '1'.repeat(64),
    },
  );
}
const compare = (inputs: unknown[]) =>
  compareModelEvidence(catalog, inputs, 'tuning', DEFAULT_ADVISOR_WEIGHTS, DEFAULT_ADVISOR_WEIGHTS);

it('reconstructs receipts and rejects changes to answers, origin, limitations, and digest', () => {
  const input = receipt();
  expect(readModelEvidence(catalog, input)).toEqual(input);
  for (const changed of [
    { ...input, origin: 'human' },
    { ...input, limitations: [] },
    { ...input, sha256: '0'.repeat(64) },
    { ...input, judgment: { ...input.judgment, confidence: 'high' } },
  ])
    expect(() => readModelEvidence(catalog, changed)).toThrow();
});

it('replays both frozen arms with observable explanations but never approves model-only adoption', () => {
  const report = compare([receipt()]);
  expect(report.origin).toBe('model');
  expect(report.adoptionEligible).toBe(false);
  expect(report.strategicTruth).toBe('unmeasured');
  expect(report.baseline).toEqual(report.candidate);
  expect(report.baseline.agreement).toBe(1);
  expect(report.baseline.picks[0]!.structuralAudit.passed).toBe(true);
  expect(report.baseline.picks[0]!.reasons.length).toBeGreaterThan(0);
  expect(report.receipts[0]!.limitations).toContain('unreported-model-version');
  expect(compare([receipt()])).toEqual(report);
});

it('preserves the requested exploration objective and reports an unavailable pivot honestly', () => {
  const candidate = { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'fixture-candidate', synergy: 1.25 };
  const result = compareModelEvidence(
    catalog,
    [receipt(0, 'tuning', 'fixture', 'explore')],
    'tuning',
    DEFAULT_ADVISOR_WEIGHTS,
    candidate,
  );
  expect(result.candidate.weights).toEqual(candidate);
  expect(result.candidate.picks[0]!.requestedArchetype).toBe('reanimator');
  expect(result.candidate.picks[0]!.requestedMode).toBe('explore');
  const pivot = compare([receipt(0, 'tuning', 'fixture', 'pivot')]).baseline.picks[0]!;
  expect(pivot.chosen).toBeNull();
  expect(pivot.diagnostics).toEqual(['requested-mode-unavailable']);
  expect(pivot.agrees).toBe(false);
});

it('groups reordered replicas as one decision rather than two independent cases', () => {
  const report = compare([receipt(), receipt(1)]);
  expect(report.baseline.sessions).toHaveLength(1);
  expect(report.baseline.sessions[0]!.decisions).toBe(1);
  expect(report.baseline.picks).toHaveLength(2);
  expect(report.baseline.agreement).toBe(1);
});

it('keeps conflicting replica judgments visible instead of turning them into consensus', () => {
  const original = receipt();
  const chosen = compare([original]).baseline.picks[0]!.chosen;
  const second = receipt(1);
  const disagreement = recordModelEvidence(
    catalog,
    second.task,
    {
      ...second.judgment,
      acceptable: second.judgment.acceptable.filter((id) => id !== chosen),
    },
    second.provenance,
  );
  const report = compare([original, disagreement]);
  expect(report.baseline.agreement).toBe(0.5);
  expect(report.baseline.sessions[0]!.decisions).toBe(1);
  expect(report.baseline.picks.map((p) => p.agrees).sort()).toEqual([false, true]);
});

it('rejects renamed later observations from the same draft across splits', () => {
  const original = receipt();
  const task = buildModelReviewTask(
    catalog,
    {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks: [catalog.cards[0]!.physicalId],
      observations: [
        { round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) },
        { round: 1, pickNumber: 2, cards: catalog.cards.slice(15, 29) },
      ],
    },
    { session: 'renamed', split: 'holdout', mode: 'flexible', archetype: null, replica: 0 },
  );
  const later = recordModelEvidence(
    catalog,
    task,
    {
      ...original.judgment,
      taskSha256: task.sha256,
      acceptable: task.payload.currentPack,
    },
    original.provenance,
  );
  expect(() => compare([original, later])).toThrow(/split/i);
});

it('rejects duplicate tasks and split leakage including renamed sessions', () => {
  expect(() => compare([receipt(), receipt()])).toThrow(/Duplicate/);
  expect(() => compare([receipt(), receipt(1, 'holdout')])).toThrow(/split/i);
  expect(() => compare([receipt(), receipt(1, 'holdout', 'renamed')])).toThrow(/split/i);
  expect(() => compare([receipt(), receipt(1, 'tuning', 'renamed')])).toThrow(/session/i);
});

it('validates excluded receipts before filtering and refuses empty comparisons or invalid weights', () => {
  expect(() => compare([])).toThrow(/empty/i);
  expect(() => compare([receipt(0, 'holdout')])).toThrow(/empty/i);
  expect(() => compare([receipt(), { ...receipt(1, 'holdout'), sha256: 'bad' }])).toThrow();
  expect(() =>
    compareModelEvidence(
      catalog,
      [receipt()],
      'tuning',
      { ...DEFAULT_ADVISOR_WEIGHTS, quality: NaN },
      DEFAULT_ADVISOR_WEIGHTS,
    ),
  ).toThrow();
});

it('runs the offline comparison command with exclusive output and runtime provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-model-compare-'));
  try {
    await Promise.all([
      writeFile(join(root, 'receipts.json'), JSON.stringify([receipt()])),
      writeFile(join(root, 'weights.json'), JSON.stringify(DEFAULT_ADVISOR_WEIGHTS)),
    ]);
    const args = [
      '--import',
      'tsx',
      'packages/metrics/tools/legacy-cube-model-compare.ts',
      '--receipts',
      join(root, 'receipts.json'),
      '--split',
      'tuning',
      '--baseline',
      join(root, 'weights.json'),
      '--candidate',
      join(root, 'weights.json'),
      '--out',
      join(root, 'comparison.json'),
    ];
    const invoke = promisify(execFile);
    const run = await invoke(process.execPath, args);
    expect(JSON.parse(run.stdout).adoptionEligible).toBe(false);
    const output = JSON.parse(await readFile(join(root, 'comparison.json'), 'utf8'));
    expect(output.comparison).toEqual(compare([receipt()]));
    expect(output.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(invoke(process.execPath, args)).rejects.toThrow(/EEXIST/);
    await expect(invoke(process.execPath, [...args, '--unknown', 'x'])).rejects.toThrow(/Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
