/** Offline inventory and replay; overlap is not a judgment that a strategy transfers. */
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import type { AdvisorWeights } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { admitHumanEvidence, parseEvidenceCorpus } from './human-evidence';
import { preparePick, replayCandidate } from './tuning';

type EvidenceCase = ReturnType<typeof parseEvidenceCorpus>['cases'][number];
const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);

function lane(entry: EvidenceCase) {
  if (entry.source.origin !== 'human') return entry.source.origin;
  if (entry.source.environment === 'matched') return 'human-matched';
  if (entry.source.environment === 'transfer') return 'human-transfer';
  return 'human-unknown';
}

function referencedNames(entry: EvidenceCase) {
  return [
    ...new Set(
      entry.kind === 'deck'
        ? entry.cards.map((c) => c.name).filter((n) => !BASICS.has(n))
        : [...entry.picks, ...entry.observations.flatMap((o) => o.cards), ...entry.preference.acceptable],
    ),
  ];
}

/** No pooled score: each original observation retains its origin and limitations. */
export function auditMixedEvidence(
  input: unknown,
  catalog: PrintedCardCatalog,
  requiredSplit?: 'tuning' | 'holdout',
  weights: AdvisorWeights = DEFAULT_ADVISOR_WEIGHTS,
) {
  const corpus = parseEvidenceCorpus(input, catalog, requiredSplit);
  const strictHuman = admitHumanEvidence(corpus, catalog, requiredSplit);
  const cases = corpus.cases.map((original) => {
    const reasons = strictHuman.excluded.find((c) => c.id === original.id)?.reasons ?? [];
    const blockers = reasons.filter((r) => r.code !== 'nonhuman-label' && r.code !== 'environment-mismatch');
    const names = referencedNames(original);
    const missingNames = reasons.filter((r) => r.code === 'unknown-card').map((r) => r.detail);
    const replayable =
      original.kind === 'pick' && blockers.length === 0 && original.source.environment !== 'unknown';
    return {
      original,
      lane: lane(original),
      overlap: {
        referencedNames: names.length,
        matchedNames: names.length - missingNames.length,
        missingNames,
      },
      blockers,
      contextReview:
        original.source.environment === 'matched' ? ('not-required' as const) : ('required' as const),
      replay:
        replayable && original.kind === 'pick'
          ? replayCandidate([preparePick(original, catalog)], weights)
          : null,
      unmeasured: ['source-authenticity', 'strategic-truth', 'deck-quality', 'model-review-independence'],
    };
  });
  return {
    version: 'legacy-cube-mixed-evidence/v1',
    corpusSha256: strictHuman.corpusSha256,
    catalogSha256: catalog.contentSha256,
    strictHuman,
    cases,
    adoptionEligible: false as const,
  };
}
