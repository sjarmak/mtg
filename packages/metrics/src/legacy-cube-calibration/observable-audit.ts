/** Structural checks only: cited observations are not proof of sound strategic judgment. */
import { readDraftMemory } from '@mtg/draft-export';
import type { AdvisorModel, DraftAdvice, ObservedDraft, Reason } from '@mtg/draft-export';

type Violation = { readonly code: string; readonly context: string };
const sameRoster = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  new Set(actual).size === actual.length &&
  expected.every((id) => actual.includes(id));

function allReasons(advice: DraftAdvice): readonly Reason[] {
  return [
    ...advice.recommendations.flatMap((r) => r.reasons),
    ...advice.archetypes.flatMap((p) => [...p.reasons, ...p.openness.observations]),
    ...advice.cards.flatMap((c) => [
      ...c.reasons,
      ...c.synergies,
      ...c.liabilities,
      ...c.opportunityCosts,
      ...c.archetypeAssessments.flatMap((p) => p.reasons),
      ...c.effectOnArchetypes.flatMap((p) => p.reasons),
    ]),
  ];
}

export function auditObservableAdvice(observed: ObservedDraft, advice: DraftAdvice, model: AdvisorModel) {
  const memory = readDraftMemory(observed);
  const seen = new Set(observed.observations.flatMap((p) => p.cards.map((c) => c.physicalId)));
  const pool = new Set(observed.picks);
  const current = memory.current?.cards.map((c) => c.physicalId) ?? [];
  const reasons = allReasons(advice);
  const violations: readonly Violation[] = [
    ...(!sameRoster(
      advice.archetypes.map((p) => p.id),
      model.archetypes.map((p) => p.id),
    )
      ? [{ code: 'path-roster-mismatch', context: 'archetypes' }]
      : []),
    ...(!sameRoster(
      advice.cards.map((c) => c.card.physicalId),
      current,
    )
      ? [{ code: 'pack-roster-mismatch', context: 'cards' }]
      : []),
    ...advice.recommendations
      .filter((r) => !current.includes(r.card.physicalId))
      .map((r) => ({ code: 'unavailable-recommendation', context: r.mode })),
    ...reasons.flatMap((reason) => [
      ...reason.cards
        .filter((id) => !seen.has(id))
        .map((id) => ({ code: 'unobserved-reference', context: `${reason.code}:${id}` })),
      ...((reason.round !== undefined || reason.pickNumber !== undefined) &&
      !observed.observations.some(
        (p) =>
          p.round === reason.round &&
          p.pickNumber === reason.pickNumber &&
          reason.cards.every((id) => p.cards.some((c) => c.physicalId === id)),
      )
        ? [{ code: 'unobserved-timestamp', context: reason.code }]
        : []),
    ]),
    ...advice.archetypes.flatMap((path) => {
      const pieces = [...path.pieces, ...path.missing, ...path.surplus];
      return [
        ...[...path.contributors, ...path.stranded, ...pieces.flatMap((p) => p.cards)]
          .filter((id) => !pool.has(id))
          .map((id) => ({ code: 'undrafted-pool-reference', context: `${path.id}:${id}` })),
        ...pieces
          .filter((p) => p.count !== p.cards.length || new Set(p.cards).size !== p.cards.length)
          .map((p) => ({ code: 'piece-count-mismatch', context: `${path.id}:${p.tag}` })),
      ];
    }),
  ];
  return {
    version: 'observable-structure/v1',
    passed: violations.length === 0,
    violations,
    strategicTruth: 'unmeasured' as const,
  };
}
