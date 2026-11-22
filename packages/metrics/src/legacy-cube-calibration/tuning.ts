/** Tuning-only proposal selection. It cannot authorize or persist an adopted weight change. */
import { createHash } from 'node:crypto';
import {
  DEFAULT_ADVISOR_WEIGHTS,
  advisorModelIdentityText,
  evaluateDraft,
  LEGACY_CUBE_ADVISOR_MODEL,
  validateAdvisorMetadata,
} from '@mtg/draft-export';
import type { AdvisorWeights, ObservedDraft } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { admitHumanEvidence } from './human-evidence';
import { proposeCalibrationWeights } from './proposals';
import { auditObservableAdvice } from './observable-audit';

type AdmittedCase = ReturnType<typeof admitHumanEvidence>['admitted'][number];
type PickCase = Extract<AdmittedCase, { kind: 'pick' }>;
export const advisorModelFingerprint = () =>
  createHash('sha256').update(advisorModelIdentityText()).digest('hex');
const REVIEW_REQUIRED = [
  'independent-holdout',
  'coherent-castable-decks',
  'observable-explanation-truth',
  'archetype-exploration',
  'regression-gates',
  'competent-bots-if-games-used',
] as const;

export function preparePick(entry: PickCase, catalog: PrintedCardCatalog) {
  const resolve = (name: string) => {
    const card = catalog.cards.find(
      (c) => c.correctedName === name || c.name === name || c.faces.some((f) => f.name === name),
    );
    if (!card) throw new Error(`Admitted card missing from catalog: ${name}`);
    return card;
  };
  const observed: ObservedDraft = {
    seats: 8,
    rounds: 3,
    packSize: 15,
    picks: entry.picks.map((name) => resolve(name).physicalId),
    observations: entry.observations.map((o) => ({ ...o, cards: o.cards.map(resolve) })),
  };
  return { entry, observed, acceptable: entry.preference.acceptable.map((name) => resolve(name).physicalId) };
}

export function replayCandidate(picks: readonly ReturnType<typeof preparePick>[], weights: AdvisorWeights) {
  if (!picks.length) throw new Error('Cannot replay an empty pick comparison');
  const results = picks.map(({ entry, observed, acceptable }) => {
    return {
      id: entry.id,
      session: entry.source.session,
      ...replayObservablePick(observed, entry.preference, acceptable, weights),
    };
  });
  const sessions = [...new Set(results.map((r) => r.session))].sort().map((session) => {
    const rows = results.filter((r) => r.session === session);
    return { session, cases: rows.length, agreement: rows.filter((r) => r.agrees).length / rows.length };
  });
  return {
    weights,
    picks: results,
    sessions,
    agreement: sessions.reduce((sum, s) => sum + s.agreement, 0) / sessions.length,
  };
}

/** Shared deterministic evaluation; callers retain their own evidence origin and aggregation. */
export function replayObservablePick(
  observed: ObservedDraft,
  preference: { mode: 'current' | 'flexible' | 'pivot' | 'explore'; archetype?: string | null },
  acceptable: readonly string[],
  weights: AdvisorWeights,
) {
  const requestedArchetype = preference.mode === 'explore' ? (preference.archetype ?? null) : null;
  const advice = evaluateDraft(observed, { ...LEGACY_CUBE_ADVISOR_MODEL, weights }, requestedArchetype);
  const choice = advice.recommendations.find((r) => r.mode === preference.mode);
  return {
    requestedMode: preference.mode,
    requestedArchetype,
    chosen: choice?.card.physicalId ?? null,
    acceptable: [...acceptable],
    agrees: choice !== undefined && acceptable.includes(choice.card.physicalId),
    reasons: choice?.reasons ?? [],
    diagnostics: choice === undefined ? ['requested-mode-unavailable'] : [],
    structuralAudit: auditObservableAdvice(observed, advice, LEGACY_CUBE_ADVISOR_MODEL),
  };
}

export function selectTuningCandidate(
  input: unknown,
  catalog: PrintedCardCatalog,
  baseline: AdvisorWeights = DEFAULT_ADVISOR_WEIGHTS,
  step = 0.25,
) {
  const admission = admitHumanEvidence(input, catalog, 'tuning');
  const errors = validateAdvisorMetadata(catalog).errors;
  if (errors.length) throw new Error(`Stale advisor metadata: ${errors.join('; ')}`);
  const proposals = proposeCalibrationWeights(baseline, step);
  const picks = admission.admitted
    .filter((c): c is PickCase => c.kind === 'pick')
    .map((c) => preparePick(c, catalog));
  const candidates = picks.length ? proposals.map((weights) => replayCandidate(picks, weights)) : [];
  // Strictly greater preserves baseline on ties, then the documented coordinate order.
  const winner = candidates.reduce<(typeof candidates)[number] | undefined>(
    (best, candidate) => (best === undefined || candidate.agreement > best.agreement ? candidate : best),
    undefined,
  );
  return {
    status:
      winner === undefined
        ? 'insufficient-evidence'
        : winner === candidates[0]
          ? 'baseline-retained'
          : 'candidate-proposed',
    selected: winner?.weights ?? proposals[0]!,
    adoptionEligible: false as const,
    reviewRequired: REVIEW_REQUIRED,
    provenance: {
      version: 'legacy-cube-tuning/v1',
      catalog: catalog.contentSha256,
      tuningCorpus: admission.corpusSha256,
      model: advisorModelFingerprint(),
    },
    search: { step, baseline: proposals[0]!, candidates: proposals.length },
    admission,
    unscoredDecks: admission.admitted.filter((c) => c.kind === 'deck').map((c) => c.id),
    candidates,
  };
}
