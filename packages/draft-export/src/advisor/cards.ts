import type { AdvisorModel, Grade, Reason } from './evidence';
import { grade, profileOf, reason } from './evidence';
import type { AdvisorCard } from './state';
import { compatible, countPieces, manaRisk } from './pool';
import type { ArchetypeAssessment } from './pool';
import { selectRecipes } from './recipes';
import { DEFAULT_ADVISOR_WEIGHTS } from './weights';

export interface CardPathAssessment {
  readonly archetype: string;
  readonly assessment: Grade;
  readonly score: number;
  readonly effect: '↑↑' | '↑' | '↔' | '↓';
  readonly reasons: readonly Reason[];
}
export interface CardAssessment {
  readonly card: AdvisorCard;
  readonly overallAssessment: Grade;
  readonly currentPath: string | null;
  readonly archetypeAssessments: readonly CardPathAssessment[];
  readonly reasons: readonly Reason[];
  readonly synergies: readonly Reason[];
  readonly liabilities: readonly Reason[];
  readonly opportunityCosts: readonly Reason[];
  readonly effectOnArchetypes: readonly CardPathAssessment[];
  readonly flexibleScore: number;
}

function packagesFor(
  card: AdvisorCard,
  pool: readonly AdvisorCard[],
  model: AdvisorModel,
): { synergies: readonly Reason[]; liabilities: readonly Reason[] } {
  const tags = profileOf(model, card).tags;
  const relevant = selectRecipes(
    model.packages.filter((p) => p.needs.some((n) => tags.includes(n.tag))),
    [...pool, card],
    model,
  );
  const synergies: Reason[] = [];
  const liabilities: Reason[] = [];
  for (const pkg of relevant) {
    const before = countPieces(pool, model, pkg.needs);
    const after = countPieces([...pool, card], model, pkg.needs);
    const partners = [...new Set(before.flatMap((n) => n.cards))];
    if (partners.length && before.some((n) => n.count > 0 && !tags.includes(n.tag))) {
      synergies.push({
        ...reason(
          'package-partners',
          `${pkg.name}: works with ${pool
            .filter((c) => partners.includes(c.physicalId))
            .map((c) => c.name)
            .join(', ')}.`,
          [card.physicalId, ...partners],
        ),
        package: pkg.id,
      });
    }
    const missing = after.filter((n) => n.count < n.min);
    if (missing.length && profileOf(model, card).flexibility < 0.5) {
      liabilities.push({
        ...reason(
          'missing-package',
          `${pkg.name} still needs ${missing.map((n) => `${String(n.min - n.count)} ${n.label}`).join(', ')}.`,
          [card.physicalId, ...partners],
          'negative',
        ),
        package: pkg.id,
      });
    }
  }
  return { synergies, liabilities };
}

function assessPath(
  card: AdvisorCard,
  model: AdvisorModel,
  path: ArchetypeAssessment,
  packages: ReturnType<typeof packagesFor>,
  risk: number,
  structural: number,
): CardPathAssessment {
  const weights = model.weights ?? DEFAULT_ADVISOR_WEIGHTS;
  const profile = profileOf(model, card);
  const archetype = model.archetypes.find((a) => a.id === path.id)!;
  const member = profile.archetypes.find((a) => a.archetype === path.id);
  const castable = compatible(card, archetype.colors);
  const needs = path.missing.filter(
    (n) => profile.tags.includes(n.tag) && (castable || member !== undefined),
  );
  const filled = needs.length ? Math.max(...needs.map((n) => (n.critical ? 2.2 : 1.2))) : 0;
  const support = member?.strength ?? (castable ? profile.flexibility : 0);
  const established = path.contributors.length >= 3;
  const relevant = (r: Reason): boolean => archetype.packages.includes(r.package ?? '');
  const synergy = packages.synergies.filter(relevant).length;
  const dependencyRisk = Math.min(2, packages.liabilities.filter(relevant).length);
  const score =
    profile.quality * weights.quality +
    support * (established ? 1 : 0.4) * weights.pathSupport +
    filled * weights.missingPieces +
    Math.min(1.5, synergy * 0.5) * weights.synergy +
    structural * weights.structure -
    risk * weights.manaRisk -
    dependencyRisk * weights.dependencyRisk -
    (!castable && member === undefined ? 3 : 0) * weights.commitment -
    (profile.flexibility < 0.5 && path.contributors.length === 0 ? 1.5 : 0) * weights.commitment;
  const reasons: Reason[] = [
    {
      ...reason(
        'path-role',
        member
          ? `${archetype.name}: ${member.roles.join(', ')}.`
          : castable
            ? `Flexible support for ${archetype.name}.`
            : `Outside ${archetype.name}'s usual colors.`,
        [card.physicalId],
        castable || member ? 'positive' : 'negative',
      ),
      archetype: path.id,
    },
    ...needs.map((n) => ({
      ...reason(
        'fills-need',
        `Adds ${n.label}: ${String(n.count)} toward ${String(n.min)} before this pick.`,
        [card.physicalId, ...n.cards],
      ),
      archetype: path.id,
    })),
  ];
  const effect =
    !castable && member === undefined ? '↓' : filled >= 2 && member ? '↑↑' : member || filled > 0 ? '↑' : '↔';
  return { archetype: path.id, assessment: grade(score), score, effect, reasons };
}

export function assessCard(
  card: AdvisorCard,
  pool: readonly AdvisorCard[],
  model: AdvisorModel,
  paths: readonly ArchetypeAssessment[],
): CardAssessment {
  const weights = model.weights ?? DEFAULT_ADVISOR_WEIGHTS;
  const profile = profileOf(model, card);
  const packages = packagesFor(card, pool, model);
  const risk = manaRisk(card, pool, model);
  const curve = pool.filter((c) => c.manaValue <= 2 && !c.typeLine.includes('Land')).length;
  const interaction = pool.filter((c) => profileOf(model, c).tags.includes('interaction')).length;
  const expensive = pool.filter((c) => c.manaValue >= 5).length;
  const structural =
    (card.manaValue <= 2 && !card.typeLine.includes('Land') && curve < 5 ? 0.4 : 0) +
    (profile.tags.includes('interaction') && interaction < 5 ? 0.4 : 0) -
    (card.manaValue >= 5 && expensive >= 4 ? 0.8 : 0);
  const archetypeAssessments = paths.map((path) => assessPath(card, model, path, packages, risk, structural));
  const reasons = [
    reason(
      'baseline-quality',
      `${grade(profile.quality + 1)} standalone quality${profile.flexibility >= 0.7 ? '; useful across several plans' : ''}.`,
      [card.physicalId],
    ),
    ...archetypeAssessments.flatMap((a) => a.reasons).filter((r) => r.code === 'fills-need'),
  ];
  if (card.manaValue <= 2 && !card.typeLine.includes('Land') && curve < 5)
    reasons.push(
      reason(
        'curve',
        `Adds an early play; your pool currently has ${String(curve)} spells costing two or less.`,
        [card.physicalId],
      ),
    );
  if (profile.tags.includes('interaction') && interaction < 5)
    reasons.push(
      reason('interaction', `Adds interaction; ${String(interaction)} drafted so far.`, [card.physicalId]),
    );
  if (profile.fixing.length)
    reasons.push(
      reason(
        'fixing',
        `Supports ${profile.fixing.join('/')} mana; fixing preserves paths as your colors develop.`,
        [card.physicalId],
      ),
    );
  const liabilities = [...packages.liabilities];
  if (risk >= 1.5)
    liabilities.push(
      reason(
        'mana-risk',
        'Your drafted colors and fixing do not yet support this cost reliably; extra colors or repeated colored pips increase commitment.',
        [card.physicalId],
        'negative',
      ),
    );
  if (card.manaValue >= 5 && expensive >= 4)
    liabilities.push(
      reason(
        'top-heavy',
        `Already ${String(expensive)} cards costing five or more; another expensive card competes for a finisher slot.`,
        [card.physicalId],
        'negative',
      ),
    );
  const flexibleScore =
    profile.quality * weights.quality +
    profile.flexibility * 2 * weights.flexibility +
    Math.min(0.8, profile.archetypes.length * 0.15) * weights.flexibility +
    (profile.fixing.length ? 0.7 : 0) * weights.fixing +
    structural * 0.5 * weights.structure -
    risk * weights.manaRisk -
    (profile.flexibility < 0.5 ? 0.8 : 0) * weights.commitment;
  const currentPath = paths.find((p) => p.contributors.length > 0)?.id ?? null;
  const current = archetypeAssessments.find((p) => p.archetype === currentPath);
  return {
    card,
    currentPath,
    overallAssessment: grade(current?.score ?? flexibleScore),
    archetypeAssessments,
    reasons,
    synergies: packages.synergies,
    liabilities,
    opportunityCosts: [],
    effectOnArchetypes: archetypeAssessments,
    flexibleScore,
  };
}
