import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildModelReviewTask } from '../src/legacy-cube-calibration/model-review';
import { recordModelEvidence } from '../src/legacy-cube-calibration/model-evidence';

const catalog = parsePrintedCardCatalog(catalogJson);
const task = buildModelReviewTask(
  catalog,
  {
    seats: 8,
    rounds: 3,
    packSize: 15,
    picks: [],
    observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
  },
  { session: 'fixture-only', split: 'tuning', mode: 'flexible', archetype: null, replica: 0 },
);
const answer = {
  taskSha256: task.sha256,
  acceptable: [task.payload.currentPack[0]],
  confidence: 'low',
  pros: [],
  cons: [],
  paths: [],
  uncertainty: ['Synthetic fixture, not strategic evidence'],
};
const provenance = {
  provider: 'codex-cli',
  authentication: 'chatgpt-oauth',
  cliVersion: 'fixture-version',
  requestedModel: null,
  resolvedModel: null,
  runId: 'fixture-run',
  completedAt: '2026-09-10T23:00:00Z',
  generatorRuntimeSha256: '1'.repeat(64),
};

it('records an unpinned response without promoting it to benchmark or human evidence', () => {
  const result = recordModelEvidence(catalog, task, answer, provenance);
  expect(result.origin).toBe('model');
  expect(result.independentHumanEvidence).toBe(false);
  expect(result.adoptionEligible).toBe(false);
  expect(result.limitations).toContain('unreported-model-version');
  expect(result.limitations).toContain('strategic-truth-unmeasured');
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(recordModelEvidence(catalog, task, answer, provenance)).toEqual(result);
});

it('preserves declared model identity but does not authenticate it or approve adoption', () => {
  const result = recordModelEvidence(catalog, task, answer, {
    ...provenance,
    requestedModel: 'fixture-model',
    resolvedModel: 'fixture-snapshot',
  });
  expect(result.provenance.resolvedModel).toBe('fixture-snapshot');
  expect(result.limitations).not.toContain('unreported-model-version');
  expect(result.limitations).toContain('operator-asserted-provenance');
  expect(result.adoptionEligible).toBe(false);
});

it('reconstructs the exact task from catalog data instead of trusting imported Oracle text', () => {
  const changed = structuredClone(task);
  changed.payload.observedCards[0]!.faces[0]!.name = 'Forged';
  expect(() => recordModelEvidence(catalog, changed, answer, provenance)).toThrow(/canonical/);
  expect(() => recordModelEvidence(catalog, { ...task, hidden: true }, answer, provenance)).toThrow(
    /canonical/,
  );
  const unknown = structuredClone(task);
  unknown.payload.observations[0]!.cards[0] = 'unknown';
  expect(() => recordModelEvidence(catalog, unknown, answer, provenance)).toThrow(/Unknown/);
});

it('rejects wrong responses, malformed tasks, and undeclared provenance fields', () => {
  expect(() =>
    recordModelEvidence(catalog, task, { ...answer, taskSha256: '0'.repeat(64) }, provenance),
  ).toThrow();
  expect(() => recordModelEvidence(catalog, {}, answer, provenance)).toThrow();
  expect(() =>
    recordModelEvidence(catalog, task, answer, { ...provenance, credential: 'forbidden' }),
  ).toThrow();
  expect(() =>
    recordModelEvidence(catalog, task, answer, { ...provenance, completedAt: 'yesterday' }),
  ).toThrow();
});

it('owns snapshots so later caller changes cannot rewrite archived evidence', () => {
  const input = structuredClone(task);
  const response = structuredClone(answer);
  const identity = { ...provenance };
  const result = recordModelEvidence(catalog, input, response, identity);
  response.uncertainty[0] = 'Changed';
  input.payload.cube[0] = 'Changed';
  identity.runId = 'Changed';
  expect(result).toEqual(recordModelEvidence(catalog, task, answer, provenance));
});

it('imports through the bounded offline command without overwriting the receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtg-model-evidence-'));
  try {
    await Promise.all(
      [
        ['task', task],
        ['response', answer],
        ['provenance', provenance],
      ].map(([name, value]) =>
        writeFile(join(root, `${String(name)}.json`), JSON.stringify(value), { flag: 'wx' }),
      ),
    );
    const cli = fileURLToPath(new URL('../tools/legacy-cube-model-import.ts', import.meta.url));
    const args = [
      '--import',
      'tsx',
      cli,
      '--task',
      join(root, 'task.json'),
      '--response',
      join(root, 'response.json'),
      '--provenance',
      join(root, 'provenance.json'),
      '--out',
      join(root, 'receipt.json'),
    ];
    const invoke = promisify(execFile);
    const run = await invoke(process.execPath, args);
    expect(JSON.parse(run.stdout).adoptionEligible).toBe(false);
    const receipt = JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8'));
    expect(receipt).toEqual(recordModelEvidence(catalog, task, answer, provenance));
    await expect(invoke(process.execPath, args)).rejects.toThrow(/EEXIST/);
    await expect(invoke(process.execPath, [...args, '--unknown', 'x'])).rejects.toThrow(/Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
