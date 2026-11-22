import type { Archetype } from './types';
import type { AdvisorModel, Confidence, Reason } from './evidence';
import { profileOf, reason } from './evidence';
import type { AdvisorCard, ObservedDraft } from './state';
import { inferOpenness } from './signals';
import type { Openness } from './signals';
import { selectRecipes } from './recipes';

export interface PieceCount {
  readonly tag: string;
  readonly label: string;
  readonly min: number;
  readonly critical: boolean;
  readonly count: number;
  readonly cards: readonly string[];
}
export interface ArchetypeAssessment {
  readonly id: string;
  readonly name: string;
  readonly status: 'Established' | 'Emerging' | 'Plausible' | 'Speculative' | 'Unsupported';
  readonly poolFit: number;
  readonly quality: number;
  readonly completeness: number;
  readonly synergyDensity: number;
  readonly manaFeasibility: 'Comfortable' | 'Needs fixing';
  readonly pivotCost: 'Low' | 'Medium' | 'High';
  readonly stranded: readonly string[];
  readonly confidence: Confidence;
  readonly contributors: readonly string[];
  readonly pieces: readonly PieceCount[];
  readonly missing: readonly PieceCount[];
  readonly surplus: readonly PieceCount[];
  readonly openness: Openness;
  readonly reasons: readonly Reason[];
}

export function countPieces(
  pool: readonly AdvisorCard[],
  model: AdvisorModel,
  needs: Archetype['needs'],
): readonly PieceCount[] {
  return needs.map((need) => {
    const cards = pool.filter((c) => profileOf(model, c).tags.includes(need.tag)).map((c) => c.physicalId);
    return { ...need, count: cards.length, cards };
  });
}

export function compatible(card: AdvisorCard, colors: readonly string[]): boolean {
  return card.colors.every((color) => colors.includes(color));
}

/** Count each physical fixer once; a five-color source is not five lands. */
export function fixingCount(
  pool: readonly AdvisorCard[],
  model: AdvisorModel,
  colors: readonly string[],
): number {
  return pool.filter((card) => profileOf(model, card).fixing.some((c) => colors.includes(c))).length;
}

const MIN_SPLASH_SOURCES = 2;

/** Basics can supply two primary colors; additional colors need observed sources.
 * This is a pool warning, not a finished-deck castability guarantee.
 */
function unsupportedPoolColors(pool: readonly AdvisorCard[], model: AdvisorModel): readonly string[] {
  const demands = ['W', 'U', 'B', 'R', 'G']
    .map((color) => ({ color, count: pool.filter((card) => card.colors.includes(color)).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
  return demands
    .slice(2)
    .filter(
      ({ color }) =>
        pool.filter((card) => {
          const profile = profileOf(model, card);
          return profile.fixing.includes(color) || profile.sources?.includes(color);
        }).length < MIN_SPLASH_SOURCES,
    )
    .map(({ color }) => color)
    .sort();
}

export function poolAssessment(
  state: ObservedDraft,
  pool: readonly AdvisorCard[],
  model: AdvisorModel,
  archetype: Archetype,
): ArchetypeAssessment {
  const contributors = pool.filter((c) =>
    profileOf(model, c).archetypes.some((a) => a.archetype === archetype.id),
  );
  const eligible = pool.filter((c) => compatible(c, archetype.colors) || contributors.includes(c));
  const alternatives = selectRecipes(
    model.packages.filter((p) => archetype.packages.includes(p.id) && p.alternativeGroup !== undefined),
    eligible,
    model,
  );
  const pieces = countPieces(eligible, model, [...archetype.needs, ...alternatives.flatMap((p) => p.needs)]);
  const missing = pieces.filter((p) => p.count < p.min);
  const criticalMissing = missing.filter((p) => p.critical);
  const fit = contributors.reduce(
    (sum, c) =>
      sum + (profileOf(model, c).archetypes.find((a) => a.archetype === archetype.id)?.strength ?? 0),
    0,
  );
  const openness = inferOpenness(state, model, archetype.id);
  const stranded = pool
    .filter(
      (c) =>
        !compatible(c, archetype.colors) &&
        !profileOf(model, c).archetypes.some((a) => a.archetype === archetype.id),
    )
    .map((c) => c.physicalId);
  const pivotCost = stranded.length >= 8 ? 'High' : stranded.length >= 4 ? 'Medium' : 'Low';
  const status =
    contributors.length >= 8 && criticalMissing.length === 0
      ? 'Established'
      : contributors.length >= 3
        ? 'Emerging'
        : contributors.length >= 1
          ? 'Plausible'
          : openness.score >= 1
            ? 'Speculative'
            : 'Unsupported';
  const unsupportedColors = unsupportedPoolColors(eligible, model);
  const manaFeasibility =
    fixingCount(eligible, model, archetype.colors) >= archetype.fixingRequired &&
    unsupportedColors.length === 0
      ? 'Comfortable'
      : 'Needs fixing';
  return {
    id: archetype.id,
    name: archetype.name,
    status,
    poolFit: fit,
    quality: contributors.length
      ? contributors.reduce((sum, c) => sum + profileOf(model, c).quality, 0) / contributors.length
      : 0,
    completeness: pieces.length
      ? pieces.reduce((sum, p) => sum + Math.min(1, p.count / p.min), 0) / pieces.length
      : 0,
    synergyDensity: pool.length ? contributors.length / pool.length : 0,
    manaFeasibility,
    pivotCost,
    stranded,
    confidence: contributors.length >= 8 ? 'High' : contributors.length >= 3 ? 'Medium' : 'Low',
    contributors: contributors.map((c) => c.physicalId),
    pieces,
    missing,
    surplus: pieces.filter((p) => p.count > p.min * 1.5),
    openness,
    reasons: [
      reason(
        'pool-support',
        `${String(contributors.length)} drafted cards support ${archetype.name}.`,
        contributors.map((c) => c.physicalId),
        contributors.length ? 'positive' : 'neutral',
      ),
      ...criticalMissing.map((p) =>
        reason('missing-critical', `Still needs ${String(p.min - p.count)} ${p.label}.`, p.cards, 'negative'),
      ),
      ...(unsupportedColors.length
        ? [
            reason(
              'unsupported-mana-colors',
              `Beyond the pool's two primary colors, ${unsupportedColors.join(', ')} lack two drafted sources each. Add fixing or narrow the colors you play; this is not a finished-deck castability check.`,
              eligible
                .filter((card) => card.colors.some((color) => unsupportedColors.includes(color)))
                .map((card) => card.physicalId),
              'negative',
            ),
          ]
        : []),
      reason(
        'pivot-cost',
        `${pivotCost} pivot cost: ${String(stranded.length)} drafted cards fall outside this path's usual colors and roles.`,
        stranded,
        stranded.length ? 'negative' : 'neutral',
      ),
    ],
  };
}

/** Colored pip counts are syntax, not an interpretation of Oracle rules. */
export function manaRisk(card: AdvisorCard, pool: readonly AdvisorCard[], model: AdvisorModel): number {
  if (card.colors.length === 0) return 0;
  const colorCounts = ['W', 'U', 'B', 'R', 'G']
    .map((color) => ({ color, count: pool.filter((c) => c.colors.includes(color)).length }))
    .sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
  const committed = colorCounts
    .filter((c) => c.count >= 2)
    .slice(0, 2)
    .map((c) => c.color);
  const extra = card.colors.filter((c) => !committed.includes(c));
  const uncovered = extra.filter(
    (c) =>
      pool.filter((p) => {
        const profile = profileOf(model, p);
        return profile.fixing.includes(c) || profile.sources?.includes(c);
      }).length < 2,
  );
  const pips = extra.reduce(
    (sum, c) => sum + Math.max(0, (card.manaCost?.split(`{${c}}`).length ?? 1) - 2),
    0,
  );
  const early = pool.length < 3;
  return (
    (early ? Math.max(0, card.colors.length - 1) * 0.8 : uncovered.length * 1.6) +
    (early ? 0 : pips * 0.8) +
    Math.max(0, card.colors.length - 2) * 0.8
  );
}
