import { expect, it } from 'vitest';
import { DEFAULT_ADVISOR_WEIGHTS, LEGACY_CUBE_ADVISOR_MODEL } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import corpus from '../data/legacy-cube-transfer-decks-v1.json';
import { buildMixedProposalCampaign } from '../src/legacy-cube-calibration/mixed-proposal';
import { buildModelReviewTask } from '../src/legacy-cube-calibration/model-review';
import { recordModelEvidence } from '../src/legacy-cube-calibration/model-evidence';
import { calibrationSeed } from '../src/legacy-cube-calibration/draft';

const catalog = parsePrintedCardCatalog(catalogJson);
const request = {
  root: 'mixed-proposal-fixture',
  indices: [0, 1],
  runtimeSha256: 'a'.repeat(64),
  baseline: DEFAULT_ADVISOR_WEIGHTS,
  step: 0.25,
};
it('retains active weights without manufacturing pick labels from adjacent decks', () => {
  const result = buildMixedProposalCampaign(catalog, corpus, [], request);
  expect(result.status).toBe('insufficient-evidence');
  expect(result.selected).toEqual(DEFAULT_ADVISOR_WEIGHTS);
  expect(result.adoptionEligible).toBe(false);
  expect(result.campaign.request.split).toBe('holdout');
  expect(result.campaign.request.policies).toHaveLength(3 + LEGACY_CUBE_ADVISOR_MODEL.archetypes.length);
  expect(result.campaign.request.baseline).toEqual(result.campaign.request.candidate);
  expect(result.context.cases).toHaveLength(corpus.cases.length);
  expect(result.context.cases[0]!.original).toEqual(corpus.cases[0]);
  expect(buildMixedProposalCampaign(catalog, corpus, [], request)).toEqual(result);
});
it('starts coordinate search from the supplied active revision rather than defaults', () => {
  const baseline = { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'installed-fixture', synergy: 2 };
  const result = buildMixedProposalCampaign(catalog, corpus, [], { ...request, baseline });
  expect(result.selected).toEqual(baseline);
  expect(result.campaign.request.baseline).toEqual(baseline);
});
it('rejects holdout human input before any candidate selection', () => {
  const heldout = { ...corpus, cases: corpus.cases.map((entry) => ({ ...entry, split: 'holdout' })) };
  expect(() => buildMixedProposalCampaign(catalog, heldout, [], request)).toThrow(/tuning-only/);
});

function modelReceipt(split: 'tuning' | 'holdout', session = 'fixture') {
  const task = buildModelReviewTask(
    catalog,
    {
      seats: 8,
      rounds: 3,
      packSize: 15,
      picks: [],
      observations: [{ round: 1, pickNumber: 1, cards: catalog.cards.slice(0, 15) }],
    },
    { session, split, mode: 'flexible', archetype: null, replica: 0 },
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
      uncertainty: ['Synthetic contract fixture'],
    },
    {
      provider: 'codex-cli',
      authentication: 'chatgpt-oauth',
      cliVersion: 'fixture',
      requestedModel: 'fixture',
      resolvedModel: null,
      runId: 'fixture',
      completedAt: '2026-09-11T04:00:00Z',
      generatorRuntimeSha256: request.runtimeSha256,
    },
  );
}
it('uses model agreement only as a labeled tuning diagnostic and keeps baseline on ties', () => {
  const result = buildMixedProposalCampaign(catalog, corpus, [modelReceipt('tuning')], request);
  expect(result.status).toBe('baseline-retained');
  expect(result.candidates).toHaveLength(21);
  expect(result.candidates.every((row) => row.modelAgreement === 1)).toBe(true);
  expect(result.candidates.every((row) => row.humanAgreement === null)).toBe(true);
  expect(result.selected).toEqual(request.baseline);
  expect(result.limitations).toContain('model-agreement-is-not-deck-quality');
});
it('refuses any holdout model receipts rather than silently filtering them from tuning', () => {
  expect(() => buildMixedProposalCampaign(catalog, corpus, [modelReceipt('holdout')], request)).toThrow(
    /holdout/,
  );
});

it('rejects a tuning-labeled receipt that already used a proposed holdout session', () => {
  const session = calibrationSeed(request.root, 'holdout', 'draft', 0);
  expect(() =>
    buildMixedProposalCampaign(catalog, corpus, [modelReceipt('tuning', session)], request),
  ).toThrow(/session.*overlap/i);
});
