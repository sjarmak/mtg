import type { AdvisorModel, Reason } from './evidence';
import { reason, reasonsForPath } from './evidence';
import type { AdvisorCard, DraftMemory, ObservedDraft } from './state';
import { readDraftMemory } from './state';
import type { ArchetypeAssessment } from './pool';
import { poolAssessment } from './pool';
import type { CardAssessment } from './cards';
import { assessCard } from './cards';
import { DEFAULT_ADVISOR_WEIGHTS, parseAdvisorWeights } from './weights';
import type { AdvisorWeights } from './weights';

export interface Recommendation {
  readonly mode: 'current' | 'flexible' | 'pivot' | 'explore';
  readonly card: AdvisorCard;
  readonly archetype: string | null;
  readonly reasons: readonly Reason[];
}
export interface DraftAdvice {
  readonly weights: AdvisorWeights;
  readonly memory: DraftMemory;
  readonly archetypes: readonly ArchetypeAssessment[];
  readonly cards: readonly CardAssessment[];
  readonly recommendations: readonly Recommendation[];
  readonly pinned: string | null;
}
function pathScore(card: CardAssessment, id: string): number {
  return card.archetypeAssessments.find((a) => a.archetype === id)?.score ?? -Infinity;
}
function best(
  cards: readonly CardAssessment[],
  score: (c: CardAssessment) => number,
): CardAssessment | undefined {
  return [...cards].sort(
    (a, b) => score(b) - score(a) || a.card.physicalId.localeCompare(b.card.physicalId),
  )[0];
}
function recommendation(
  mode: Recommendation['mode'],
  card: CardAssessment,
  archetype: string | null,
  model: AdvisorModel,
): Recommendation {
  return {
    mode,
    card: card.card,
    archetype,
    reasons: [
      ...card.reasons.filter((r) => r.code !== 'fills-need'),
      ...(archetype === null
        ? []
        : (card.archetypeAssessments.find((a) => a.archetype === archetype)?.reasons ?? [])),
      ...reasonsForPath(card.synergies, archetype, model),
      ...reasonsForPath(card.liabilities, archetype, model),
    ],
  };
}

function opportunityCosts(
  card: CardAssessment,
  cards: readonly CardAssessment[],
  recommendations: readonly Recommendation[],
  model: AdvisorModel,
): readonly Reason[] {
  const alternatives = recommendations.filter((r) => r.card.physicalId !== card.card.physicalId);
  if (alternatives.length)
    return alternatives.map((r) =>
      reason(
        'opportunity-cost',
        `${r.card.name} is the ${r.mode === 'current' ? 'current-plan' : r.mode} choice${r.archetype === null ? '' : ` for ${model.archetypes.find((a) => a.id === r.archetype)!.name}`}.`,
        [r.card.physicalId],
        'neutral',
      ),
    );
  const runnerUp = best(
    cards.filter((c) => c.card.physicalId !== card.card.physicalId),
    (c) => c.flexibleScore,
  );
  return runnerUp === undefined
    ? []
    : [
        reason(
          'alternative',
          `Taking this passes ${runnerUp.card.name}, the next flexible alternative.`,
          [runnerUp.card.physicalId],
          'neutral',
        ),
      ];
}

/** Pure, deterministic and only as informed as the one human's transcript. */
export function evaluateDraft(
  state: ObservedDraft,
  model: AdvisorModel,
  pinned: string | null = null,
): DraftAdvice {
  const weights = model.weights === undefined ? DEFAULT_ADVISOR_WEIGHTS : parseAdvisorWeights(model.weights);
  const weightedModel = { ...model, weights };
  const memory = readDraftMemory(state);
  if (pinned !== null && !model.archetypes.some((a) => a.id === pinned))
    throw new Error(`Unknown exploration path: ${pinned}`);
  const archetypes = model.archetypes
    .map((a) => poolAssessment(state, memory.pool, model, a))
    .sort((a, b) => b.poolFit - a.poolFit || b.completeness - a.completeness || a.id.localeCompare(b.id));
  const cards = (memory.current?.cards ?? []).map((c) =>
    assessCard(c, memory.pool, weightedModel, archetypes),
  );
  const recommendations: Recommendation[] = [];
  const flexible = best(cards, (c) => c.flexibleScore);
  if (flexible !== undefined) recommendations.push(recommendation('flexible', flexible, null, model));
  const current = archetypes.find((a) => a.contributors.length > 0);
  if (current !== undefined) {
    const choice = best(cards, (c) => pathScore(c, current.id));
    if (choice !== undefined) recommendations.push(recommendation('current', choice, current.id, model));
  }
  const pivot = archetypes
    .filter(
      (a) =>
        a.id !== current?.id &&
        a.openness.score >= 2.5 &&
        a.openness.confidence !== 'Low' &&
        a.pivotCost !== 'High',
    )
    .sort((a, b) => b.openness.score - a.openness.score || a.id.localeCompare(b.id))[0];
  if (pivot !== undefined) {
    const choice = best(
      cards.filter((c) =>
        c.archetypeAssessments.some(
          (a) => a.archetype === pivot.id && (a.effect === '↑' || a.effect === '↑↑'),
        ),
      ),
      (c) => pathScore(c, pivot.id),
    );
    if (choice !== undefined)
      recommendations.push({
        ...recommendation('pivot', choice, pivot.id, model),
        reasons: [
          ...recommendation('pivot', choice, pivot.id, model).reasons,
          ...pivot.openness.observations,
        ],
      });
  }
  if (pinned !== null) {
    const choice = best(cards, (c) => pathScore(c, pinned));
    if (choice !== undefined) recommendations.push(recommendation('explore', choice, pinned, model));
  }
  return {
    weights,
    memory,
    archetypes,
    pinned,
    recommendations,
    cards: cards.map((card) => ({
      ...card,
      opportunityCosts: opportunityCosts(card, cards, recommendations, model),
    })),
  };
}
