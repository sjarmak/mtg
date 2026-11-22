import { expect, it, vi } from 'vitest';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildQualityReviewPair, readQualityReviewPair } from '../src/legacy-cube-calibration/quality-pair';
import {
  compareQualityReviewPair,
  readQualityComparison,
} from '../src/legacy-cube-calibration/quality-comparison';
import { recordDeckReviewEvidence } from '../src/legacy-cube-calibration/deck-review-evidence';
import { recordAdviceReviewEvidence } from '../src/legacy-cube-calibration/advice-review';
import { buildQualityCampaign } from '../src/legacy-cube-calibration/quality-ledger';
import { summarizeQualityCampaign } from '../src/legacy-cube-calibration/quality-summary';
import * as draftModule from '../src/legacy-cube-calibration/draft';

/**
 * Budgeted at 10s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 15.7 to 16.7 on 16
 * cores: the slowest test ("counts a shared draft seed once across six advice
 * stages and two policies") took 2.16 to 2.26s, so 10s is about 4.5x the
 * worst run. It timed out at the 5s default under the heavier load a review
 * gate runs at.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (mtg-mitcn, same pattern as mtg-tqwbq).
 */
vi.setConfig({ testTimeout: 10_000 });

const catalog = parsePrintedCardCatalog(catalogJson);
const request = {
  root: 'quality-pair-fixture',
  split: 'holdout',
  index: 0,
  policy: 'pin:reanimator',
  baseline: DEFAULT_ADVISOR_WEIGHTS,
  candidate: { ...DEFAULT_ADVISOR_WEIGHTS, synergy: 1.25 },
  runtimeSha256: 'a'.repeat(64),
};

const provenance = {
  provider: 'codex-cli',
  authentication: 'chatgpt-oauth',
  cliVersion: 'fixture',
  requestedModel: null,
  resolvedModel: null,
  runId: 'synthetic-quality-review',
  completedAt: '2026-09-11T03:00:00Z',
  generatorRuntimeSha256: request.runtimeSha256,
};

it('simulates equal weight arms once without sharing their output objects', () => {
  const simulate = vi.spyOn(draftModule, 'draftCalibrationPool');
  try {
    const pair = buildQualityReviewPair(catalog, {
      ...request,
      candidate: { ...request.baseline },
    });
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(pair.candidate).toEqual(pair.baseline);
    expect(pair.candidate).not.toBe(pair.baseline);
    expect(pair.candidate.deck.payload).not.toBe(pair.baseline.deck.payload);
    expect(pair.candidate.advice[0]!.payload).not.toBe(pair.baseline.advice[0]!.payload);
  } finally {
    simulate.mockRestore();
  }
});

it('simulates both arms whenever a weight differs', () => {
  const simulate = vi.spyOn(draftModule, 'draftCalibrationPool');
  try {
    const pair = buildQualityReviewPair(catalog, request);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(pair.candidate.advice[0]!.weights).toEqual(request.candidate);
    expect(pair.baseline.advice[0]!.weights).toEqual(request.baseline);
  } finally {
    simulate.mockRestore();
  }
});

it('counts a shared draft seed once across six advice stages and two policies', () => {
  const { index, policy, ...common } = request;
  const campaign = buildQualityCampaign(catalog, {
    ...common,
    indices: [index],
    policies: [policy, 'current'],
  });
  const reviews = campaign.units.map((unit) => {
    const pair = buildQualityReviewPair(catalog, { ...request, policy: unit.policy });
    return {
      pair,
      comparison: compareQualityReviewPair(
        catalog,
        pair,
        {
          baseline: receipts(pair.baseline, 'pass'),
          candidate: receipts(pair.candidate, 'pass'),
        },
        request.runtimeSha256,
      ),
    };
  });
  const report = summarizeQualityCampaign(catalog, campaign, reviews, request.runtimeSha256);
  expect(report.independentSessions).toBe(1);
  expect(report.policyUnits).toBe(2);
  expect(report.criteria).toHaveLength(5);
  for (const criterion of report.criteria) {
    expect(criterion.sessions).toHaveLength(1);
    expect(criterion.meanPairedDifference).toBe(0);
    expect(criterion.sessions[0]!.policies).toHaveLength(2);
    expect(criterion.sessions[0]!.policies.every((p) => p.candidate.fail === 0)).toBe(true);
    expect(criterion.sessions[0]!.policies.every((p) => p.candidate.pass === p.observations)).toBe(true);
  }
  expect(report.criteria.find((row) => row.criterion === 'explanation-accuracy')!.observations).toBe(12);
  expect(report.adoptionEligible).toBe(false);
  expect(() => summarizeQualityCampaign(catalog, campaign, reviews.slice(1), request.runtimeSha256)).toThrow(
    /matrix/i,
  );
  expect(() =>
    summarizeQualityCampaign(catalog, campaign, [reviews[0], reviews[0]], request.runtimeSha256),
  ).toThrow(/matrix/i);
});

it('does not turn uncertainty or inconsistent judgments of unchanged subjects into measured gains', () => {
  const { index, policy, ...common } = request;
  const campaign = buildQualityCampaign(catalog, {
    ...common,
    candidate: common.baseline,
    indices: [index],
    policies: [policy],
  });
  const pair = buildQualityReviewPair(catalog, { ...request, candidate: request.baseline });
  for (const assessment of ['uncertain', 'fail']) {
    const comparison = compareQualityReviewPair(
      catalog,
      pair,
      {
        baseline: receipts(pair.baseline, assessment),
        candidate: receipts(pair.candidate, 'pass'),
      },
      request.runtimeSha256,
    );
    const report = summarizeQualityCampaign(catalog, campaign, [{ pair, comparison }], request.runtimeSha256);
    expect(report.criteria.every((row) => row.meanPairedDifference === null)).toBe(true);
    expect(report.criteria.every((row) => row.unresolvedSessions === 1)).toBe(true);
  }
});
function receipts(arm: ReturnType<typeof buildQualityReviewPair>['baseline'], assessment: string) {
  return {
    deck: recordDeckReviewEvidence(
      catalog,
      arm.deck,
      {
        taskSha256: arm.deck.sha256,
        criteria: ['coherence', 'castability', 'pool-alternatives'].map((criterion) => ({
          criterion,
          assessment,
          rationale: 'Synthetic contract fixture, not quality evidence.',
          cards: [],
          improvements: [],
        })),
        uncertainty: [],
      },
      provenance,
    ),
    advice: arm.advice.map((task) =>
      recordAdviceReviewEvidence(
        catalog,
        task,
        {
          taskSha256: task.sha256,
          criteria: ['explanation-accuracy', 'exploration-usefulness'].map((criterion) => ({
            criterion,
            assessment,
            rationale: 'Synthetic contract fixture, not quality evidence.',
            claims: [],
            cards: [],
            archetypes: [],
            corrections: [],
          })),
          uncertainty: [],
        },
        provenance,
      ),
    ),
  };
}

it('binds both arms to matched draft seeds and real decks with six observable review stages', () => {
  const pair = buildQualityReviewPair(catalog, request);
  expect(pair.baseline.deck.coordinates).toEqual(pair.candidate.deck.coordinates);
  for (const arm of [pair.baseline, pair.candidate]) {
    expect(arm.deck.payload.deck.report.legal).toBe(true);
    expect(arm.deck.payload.deck.report.cards).toBe(40);
    expect(arm.advice.map((task) => task.payload.context.picks.length)).toEqual([0, 7, 15, 29, 37, 44]);
    expect(arm.advice.at(-1)!.payload.context.picks).toEqual(
      arm.deck.payload.pool.slice(0, 44).map((c) => c.physicalId),
    );
    expect(arm.advice.every((task) => task.source.coordinates.session === pair.session)).toBe(true);
    expect(JSON.stringify(arm.deck.payload)).not.toContain('opponentPools');
  }
  expect(pair.baseline.advice[0]!.payload.context).toEqual(pair.candidate.advice[0]!.payload.context);
  expect(pair.baseline.advice.every((task) => task.weights.synergy === request.baseline.synergy)).toBe(true);
  expect(pair.candidate.advice.every((task) => task.weights.synergy === request.candidate.synergy)).toBe(
    true,
  );
});

it('reconstructs pair ownership instead of trusting task hashes or split labels', () => {
  const pair = buildQualityReviewPair(catalog, request);
  expect(readQualityReviewPair(catalog, pair, request.runtimeSha256)).toEqual(pair);
  expect(() => readQualityReviewPair(catalog, pair, 'b'.repeat(64))).toThrow(/runtime/i);
  expect(() =>
    readQualityReviewPair(catalog, { ...pair, candidate: pair.baseline }, request.runtimeSha256),
  ).toThrow(/canonical/i);
  expect(() =>
    readQualityReviewPair(
      catalog,
      { ...pair, request: { ...pair.request, split: 'tuning' } },
      request.runtimeSha256,
    ),
  ).toThrow(/canonical/i);
  expect(() => buildQualityReviewPair(catalog, { ...request, hidden: [] })).toThrow();
  expect(() => buildQualityReviewPair(catalog, { ...request, policy: 'pin:absent' })).toThrow(/archetype/i);
});

it('compares all five substantive criteria while retaining uncertainty and model provenance', () => {
  const pair = buildQualityReviewPair(catalog, request);
  const evidence = {
    baseline: receipts(pair.baseline, 'uncertain'),
    candidate: receipts(pair.candidate, 'pass'),
  };
  const report = compareQualityReviewPair(catalog, pair, evidence, request.runtimeSha256);
  expect(report.criteria).toHaveLength(5);
  expect(
    report.criteria.every((c) => c.baseline.uncertain === c.samples && c.candidate.pass === c.samples),
  ).toBe(true);
  expect(report.criteria.find((c) => c.criterion === 'explanation-accuracy')?.samples).toBe(6);
  expect(report.criteria.find((c) => c.criterion === 'castability')?.samples).toBe(1);
  expect(report.independentHumanEvidence).toBe(false);
  expect(report.adoptionEligible).toBe(false);
  expect(report.limitations).toContain('uncertain-is-not-a-failure-or-improvement');
  expect(readQualityComparison(catalog, pair, report, request.runtimeSha256)).toEqual(report);
  expect(() =>
    readQualityComparison(catalog, pair, { ...report, criteria: [] }, request.runtimeSha256),
  ).toThrow(/canonical/i);
});

it('rejects swapped arms, missing stages and forged receipt authority', () => {
  const pair = buildQualityReviewPair(catalog, request);
  const baseline = receipts(pair.baseline, 'fail');
  const candidate = receipts(pair.candidate, 'pass');
  for (const invalid of [
    { baseline, candidate: baseline },
    { baseline, candidate: { ...candidate, advice: candidate.advice.slice(1) } },
    { baseline, candidate: { ...candidate, deck: { ...candidate.deck, adoptionEligible: true } } },
  ])
    expect(() => compareQualityReviewPair(catalog, pair, invalid, request.runtimeSha256)).toThrow();
});

it('flags changed judgments of identical subjects instead of presenting them as a weight improvement', () => {
  const pair = buildQualityReviewPair(catalog, { ...request, candidate: request.baseline });
  const report = compareQualityReviewPair(
    catalog,
    pair,
    {
      baseline: receipts(pair.baseline, 'fail'),
      candidate: receipts(pair.candidate, 'pass'),
    },
    request.runtimeSha256,
  );
  expect(report.criteria.every((row) => row.transitions.every((t) => !t.subjectChanged))).toBe(true);
  expect(report.criteria.every((row) => row.discordantUnchanged === row.samples)).toBe(true);
});

it('hands each caller its own pair, so mutating one build cannot change the next', () => {
  const first = buildQualityReviewPair(catalog, request);
  first.baseline.advice.length = 0;
  first.session = 'tampered';
  const second = buildQualityReviewPair(catalog, request);
  const third = buildQualityReviewPair(catalog, request);
  expect(second.session).not.toBe('tampered');
  expect(second.baseline.advice.length).toBeGreaterThan(0);
  expect(third).toEqual(second);
  expect(third).not.toBe(second);
  expect(() => readQualityReviewPair(catalog, second, request.runtimeSha256)).not.toThrow();
});
