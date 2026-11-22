import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { DEFAULT_ADVISOR_WEIGHTS, evaluateDraft, LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { selectTuningCandidate } from '../src/legacy-cube-calibration/tuning';
import { sealTuningProposal, reviewHeldOutPicks } from '../src/legacy-cube-calibration/holdout';
import { runHeldOutPickReview } from '../src/legacy-cube-calibration/review-run';

const catalog = parsePrintedCardCatalog(catalogJson);
const names = catalog.cards.slice(0, 15).map((c) => c.correctedName);
// Synthetic contract fixtures, not independent human calibration evidence.
const pick = (id: string, split: 'tuning' | 'holdout') => ({
  id,
  split,
  kind: 'pick',
  picks: [],
  observations: [{ round: 1, pickNumber: 1, cards: names }],
  preference: { mode: 'flexible', acceptable: names },
  source: {
    author: 'Fixture',
    url: `https://example.org/${id}`,
    published: '2021-08-25',
    session: id,
    origin: 'human',
    environment: 'matched',
    locator: 'Synthetic fixture',
  },
});
const corpus = (cases: readonly unknown[]) => ({
  schemaVersion: 1,
  catalogSha256: catalog.contentSha256,
  cases,
});
const runtime = { source: 'a'.repeat(64), node: process.version };
const tuning = () => selectTuningCandidate(corpus([pick('training', 'tuning')]), catalog);
const seal = () => sealTuningProposal(tuning(), runtime);

it('compares only frozen baseline and selected arms and preserves replay explanations', () => {
  const frozen = seal();
  const report = reviewHeldOutPicks(frozen, corpus([pick('test', 'holdout')]), catalog, runtime);
  expect(report.status).toBe('compared');
  expect(report.adoptionEligible).toBe(false);
  expect(report.baseline!.weights).toEqual(DEFAULT_ADVISOR_WEIGHTS);
  expect(report.selected!.weights).toEqual(frozen.selected);
  expect(report.baseline!.picks[0]!.reasons.length).toBeGreaterThan(0);
  expect(report.difference).toMatchObject({ sessions: 1, mean: 0, interval: null });
  expect(report.proposal).toBe(frozen.sha256);
  expect(reviewHeldOutPicks(frozen, corpus([pick('test', 'holdout')]), catalog, runtime)).toEqual(report);
});

it('refuses source and session leakage across separate corpora, including excluded tuning records', () => {
  const entry = pick('test', 'holdout');
  for (const source of [
    { ...entry.source, session: 'training' },
    { ...entry.source, url: 'https://example.org/training/?utm_source=test#frame' },
  ])
    expect(() => reviewHeldOutPicks(seal(), corpus([{ ...entry, source }]), catalog, runtime)).toThrow(
      /source\/session/i,
    );
  const excluded = pick('excluded', 'tuning');
  const result = selectTuningCandidate(
    corpus([pick('training', 'tuning'), { ...excluded, source: { ...excluded.source, origin: 'model' } }]),
    catalog,
  );
  expect(() =>
    reviewHeldOutPicks(
      sealTuningProposal(result, runtime),
      corpus([{ ...entry, source: { ...entry.source, url: excluded.source.url } }]),
      catalog,
      runtime,
    ),
  ).toThrow(/source\/session/i);
});

it('keeps distinct content query IDs separate and rejects excluded or wrong-split holdout', () => {
  const training = pick('training', 'tuning');
  const result = selectTuningCandidate(
    corpus([{ ...training, source: { ...training.source, url: 'https://example.org/watch?v=one' } }]),
    catalog,
  );
  const entry = pick('test', 'holdout');
  expect(
    reviewHeldOutPicks(
      sealTuningProposal(result, runtime),
      corpus([{ ...entry, source: { ...entry.source, url: 'https://example.org/watch?v=two' } }]),
      catalog,
      runtime,
    ).status,
  ).toBe('compared');
  expect(() =>
    reviewHeldOutPicks(
      seal(),
      corpus([{ ...entry, source: { ...entry.source, origin: 'model' } }]),
      catalog,
      runtime,
    ),
  ).toThrow(/excluded/i);
  expect(() => reviewHeldOutPicks(seal(), corpus([pick('test', 'tuning')]), catalog, runtime)).toThrow(
    /holdout/i,
  );
});

it('refuses modified artifacts and stale runtime/model identities', () => {
  const frozen = seal();
  const test = corpus([pick('test', 'holdout')]);
  expect(() =>
    reviewHeldOutPicks({ ...frozen, selected: { ...frozen.selected, quality: 2 } }, test, catalog, runtime),
  ).toThrow(/digest/i);
  expect(() => reviewHeldOutPicks(frozen, test, catalog, { ...runtime, source: 'b'.repeat(64) })).toThrow(
    /runtime/i,
  );
  expect(Object.isFrozen(frozen.selected)).toBe(true);
  expect(Object.isFrozen(frozen.sources)).toBe(true);
  expect(() => sealTuningProposal(selectTuningCandidate(corpus([]), catalog), runtime)).toThrow(
    /insufficient/i,
  );
  const proposal = tuning();
  for (const provenance of [
    { ...proposal.provenance, model: 'c'.repeat(64) },
    { ...proposal.provenance, catalog: 'd'.repeat(64) },
  ])
    expect(() =>
      reviewHeldOutPicks(sealTuningProposal({ ...proposal, provenance }, runtime), test, catalog, runtime),
    ).toThrow(/catalog\/model/i);
});

it('reports disagreement with a changed candidate without selecting again on holdout', () => {
  const baseline = {
    ...DEFAULT_ADVISOR_WEIGHTS,
    quality: 0,
    flexibility: 0,
    fixing: 0,
    structure: 0,
    manaRisk: 0,
    commitment: 0,
  };
  const observed = {
    seats: 8,
    rounds: 3,
    packSize: 15,
    picks: [],
    observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
  };
  const choice = (weights: typeof baseline) =>
    evaluateDraft(observed, { ...LEGACY_CUBE_ADVISOR_MODEL, weights }).recommendations[0]!.card.correctedName;
  const baseChoice = choice(baseline);
  const improved = choice({ ...baseline, quality: 1 });
  expect(baseChoice).not.toBe(improved);
  const entry = pick('training', 'tuning');
  const proposal = selectTuningCandidate(
    corpus([{ ...entry, preference: { mode: 'flexible', acceptable: [improved] } }]),
    catalog,
    baseline,
    1,
  );
  expect(proposal.status).toBe('candidate-proposed');
  const frozen = sealTuningProposal(proposal, runtime);
  const test = pick('test', 'holdout');
  const review = reviewHeldOutPicks(
    frozen,
    corpus([{ ...test, preference: { mode: 'flexible', acceptable: [baseChoice] } }]),
    catalog,
    runtime,
  );
  expect(review.difference!.mean).toBe(-1);
  expect(review.selected!.weights).toEqual(frozen.selected);
  expect(review.adoptionEligible).toBe(false);
});

it('reports empty or deck-only holdout as insufficient, not validated no-change', () => {
  const entry = pick('deck', 'holdout');
  const deck = {
    id: entry.id,
    split: entry.split,
    source: entry.source,
    kind: 'deck',
    cards: [
      ...catalog.cards.slice(0, 23).map((c) => ({ name: c.correctedName, count: 1 })),
      { name: 'Plains', count: 17 },
    ],
  };
  for (const input of [corpus([]), corpus([deck])]) {
    const result = reviewHeldOutPicks(seal(), input, catalog, runtime);
    expect(result.status).toBe('insufficient-evidence');
    expect(result.baseline).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.adoptionEligible).toBe(false);
  }
});

it('reports paired session differences without choosing weights from holdout labels', () => {
  const frozen = seal();
  const report = reviewHeldOutPicks(
    frozen,
    corpus([pick('test-one', 'holdout'), pick('test-two', 'holdout')]),
    catalog,
    runtime,
  );
  expect(report.difference).toMatchObject({ sessions: 2, mean: 0 });
  expect(report.difference!.interval).toEqual({ low: -1, high: 1 });
  expect(report.selected!.weights).toEqual(frozen.selected);
  expect(report.unmeasured).toContain('coherent-castable-decks');
  expect(report.unmeasured).toContain('observable-explanation-truth');
});

it('reserves evidence before durable review and refuses a second evaluation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-held-out-run-'));
  try {
    const input = corpus([pick('test', 'holdout')]);
    const result = await runHeldOutPickReview(seal(), input, catalog, runtime, directory);
    expect(result.review.status).toBe('compared');
    expect(result.review.adoptionEligible).toBe(false);
    expect(result.review.unmeasured).not.toContain('holdout-use-ledger');
    expect(JSON.parse(await readFile(result.path!, 'utf8'))).toEqual(result.review);
    await expect(runHeldOutPickReview(seal(), input, catalog, runtime, directory)).rejects.toThrow(/used/i);
    const empty = await runHeldOutPickReview(seal(), corpus([]), catalog, runtime, directory);
    expect(empty.review.status).toBe('insufficient-evidence');
    expect(empty.path).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
