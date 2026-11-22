import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ADVISOR_WEIGHTS, evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import excludedCorpus from '../data/legacy-cube-human-evidence-v1.json';
import { selectTuningCandidate } from '../src/legacy-cube-calibration/tuning';

const catalog = parsePrintedCardCatalog(catalogJson);
const cards = catalog.cards.slice(0, 15);
const names = cards.map((c) => c.correctedName);
const observed = {
  seats: 8,
  rounds: 3,
  packSize: 15,
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards }],
};
const chosen = evaluateDraft(observed, LEGACY_CUBE_ADVISOR_MODEL).recommendations[0]!.card;
// Synthetic harness fixtures, never checked-in human research or calibration evidence.
const fixture = (id: string, session: string, acceptable = [chosen.name]) => ({
  id,
  split: 'tuning',
  kind: 'pick',
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards: names }],
  preference: { mode: 'flexible', acceptable },
  source: {
    author: 'Fixture author',
    url: `https://example.org/${session}`,
    published: '2021-08-25',
    session,
    origin: 'human',
    environment: 'matched',
    locator: 'Synthetic harness fixture',
  },
});
const corpus = (cases: readonly unknown[]) => ({
  schemaVersion: 1,
  catalogSha256: catalog.contentSha256,
  cases,
});

it('replays the existing advisor, retains machine-readable reasons, and prefers baseline ties', () => {
  const result = selectTuningCandidate(corpus([fixture('one', 'one')]), catalog);
  expect(result.status).toBe('baseline-retained');
  expect(result.selected).toEqual(DEFAULT_ADVISOR_WEIGHTS);
  expect(result.adoptionEligible).toBe(false);
  expect(result.candidates[0]!.picks[0]).toMatchObject({
    id: 'one',
    requestedMode: 'flexible',
    chosen: chosen.physicalId,
    agrees: true,
  });
  expect(result.candidates[0]!.picks[0]!.reasons).toEqual(
    evaluateDraft(observed, LEGACY_CUBE_ADVISOR_MODEL).recommendations[0]!.reasons,
  );
  expect(result.provenance.tuningCorpus).toMatch(/^[a-f0-9]{64}$/);
  expect(result.provenance.catalog).toBe(catalog.contentSha256);
  expect(result.provenance.model).toMatch(/^[a-f0-9]{64}$/);
  expect(selectTuningCandidate(corpus([fixture('one', 'one')]), catalog)).toEqual(result);
});

it('averages sessions rather than treating every label as an independent draft', () => {
  const other = names.find((name) => name !== chosen.name)!;
  const cases = [fixture('a', 'one'), fixture('b', 'one'), fixture('c', 'two', [other])];
  const result = selectTuningCandidate(corpus(cases), catalog);
  expect(result.candidates[0]!.agreement).toBe(0.5);
  expect(result.candidates[0]!.sessions).toHaveLength(2);
});

it('does not replace a missing requested strategy with the flexible recommendation', () => {
  const pick = fixture('one', 'one');
  const result = selectTuningCandidate(
    corpus([{ ...pick, preference: { ...pick.preference, mode: 'pivot' } }]),
    catalog,
  );
  expect(result.candidates[0]!.picks[0]).toMatchObject({
    requestedMode: 'pivot',
    chosen: null,
    agrees: false,
  });
  expect(result.candidates[0]!.picks[0]!.diagnostics).toContain('requested-mode-unavailable');
  expect(result.candidates[0]!.agreement).toBe(0);
});

it('replays every pinned exploration path through the real evaluator without changing the requested objective', () => {
  for (const path of LEGACY_CUBE_ADVISOR_MODEL.archetypes) {
    const expected = evaluateDraft(observed, LEGACY_CUBE_ADVISOR_MODEL, path.id).recommendations.find(
      (r) => r.mode === 'explore',
    )!;
    const entry = {
      ...fixture(path.id, path.id),
      preference: { mode: 'explore', archetype: path.id, acceptable: [expected.card.name] },
    };
    const result = selectTuningCandidate(corpus([entry]), catalog);
    const pick = result.candidates[0]!.picks[0]!;
    expect(pick).toMatchObject({
      requestedMode: 'explore',
      requestedArchetype: path.id,
      chosen: expected.card.physicalId,
      agrees: true,
      reasons: expected.reasons,
    });
    expect(result.adoptionEligible).toBe(false);
  }
});

it('rejects all holdout input, including evidence that admission would exclude', () => {
  const holdout = { ...fixture('holdout', 'holdout'), split: 'holdout' };
  expect(() => selectTuningCandidate(corpus([holdout]), catalog)).toThrow(/tuning/i);
  expect(() =>
    selectTuningCandidate(corpus([{ ...holdout, source: { ...holdout.source, origin: 'model' } }]), catalog),
  ).toThrow(/tuning/i);
});

it('reports missing evidence instead of a successful no-change comparison', () => {
  for (const input of [corpus([]), excludedCorpus]) {
    const result = selectTuningCandidate(input, catalog);
    expect(result.status).toBe('insufficient-evidence');
    expect(result.candidates).toEqual([]);
    expect(result.selected).toEqual(DEFAULT_ADVISOR_WEIGHTS);
    expect(result.adoptionEligible).toBe(false);
  }
});

it('does not turn mere deck membership into a positive quality label', () => {
  const pick = fixture('deck', 'deck');
  const deck = {
    id: pick.id,
    split: pick.split,
    source: pick.source,
    kind: 'deck',
    cards: [
      ...catalog.cards.slice(0, 23).map((c) => ({ name: c.correctedName, count: 1 })),
      { name: 'Plains', count: 17 },
    ],
  };
  const result = selectTuningCandidate(corpus([deck]), catalog);
  expect(result.status).toBe('insufficient-evidence');
  expect(result.unscoredDecks).toEqual(['deck']);
});

it('can propose changed weights without claiming they passed adoption review', () => {
  const baseline = {
    ...DEFAULT_ADVISOR_WEIGHTS,
    quality: 0,
    flexibility: 0,
    fixing: 0,
    structure: 0,
    manaRisk: 0,
    commitment: 0,
  };
  const qualityChoice = evaluateDraft(observed, {
    ...LEGACY_CUBE_ADVISOR_MODEL,
    weights: { ...baseline, quality: 1 },
  }).recommendations[0]!.card;
  const original = evaluateDraft(observed, { ...LEGACY_CUBE_ADVISOR_MODEL, weights: baseline })
    .recommendations[0]!.card;
  expect(qualityChoice.physicalId).not.toBe(original.physicalId);
  const result = selectTuningCandidate(
    corpus([fixture('one', 'one', [qualityChoice.name])]),
    catalog,
    baseline,
    1,
  );
  expect(result.status).toBe('candidate-proposed');
  expect(result.selected).not.toEqual(baseline);
  expect(result.adoptionEligible).toBe(false);
  expect(result.reviewRequired).toContain('independent-holdout');
});

it('runs an offline proposal audit and refuses unsupported CLI arguments', async () => {
  const cli = fileURLToPath(new URL('../tools/legacy-cube-propose.ts', import.meta.url));
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, ['--import', 'tsx', cli]);
  const report = JSON.parse(stdout) as { status: string; provenance: { source: string } };
  expect(report.status).toBe('insufficient-evidence');
  expect(report.provenance.source).toMatch(/^[a-f0-9]{64}$/);
  await expect(run(process.execPath, ['--import', 'tsx', cli, '--holdout', 'unused'])).rejects.toThrow();
});
