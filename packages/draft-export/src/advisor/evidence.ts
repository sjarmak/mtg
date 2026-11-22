import type { AdvisorCard } from './state';
import type { Archetype, CardProfile, SynergyPackage } from './types';
import type { AdvisorWeights } from './weights';

export interface AdvisorModel {
  readonly weights?: AdvisorWeights;
  readonly archetypes: readonly Archetype[];
  readonly profiles: readonly CardProfile[];
  readonly profilesByName?: ReadonlyMap<string, CardProfile>;
  readonly packages: readonly SynergyPackage[];
}

export interface Reason {
  readonly code: string;
  readonly text: string;
  readonly cards: readonly string[];
  readonly polarity: 'positive' | 'negative' | 'neutral';
  readonly archetype?: string;
  readonly package?: string;
  readonly round?: number;
  readonly pickNumber?: number;
  readonly weight?: number;
}

export type Grade = 'Excellent' | 'Strong' | 'Reasonable' | 'Speculative' | 'Poor';
export type Confidence = 'Low' | 'Medium' | 'High';

/** Keep the full evidence for debugging, but explain only the selected objective. */
export function reasonsForPath(
  entries: readonly Reason[],
  path: string | null,
  model: AdvisorModel,
): readonly Reason[] {
  if (path === null) return entries;
  const packages = model.archetypes.find((a) => a.id === path)?.packages ?? [];
  return entries.filter(
    (r) =>
      (r.archetype === undefined || r.archetype === path) &&
      (r.package === undefined || packages.includes(r.package)),
  );
}

export function grade(score: number): Grade {
  return score >= 7
    ? 'Excellent'
    : score >= 5
      ? 'Strong'
      : score >= 3
        ? 'Reasonable'
        : score >= 1
          ? 'Speculative'
          : 'Poor';
}

export function profileOf(model: AdvisorModel, card: AdvisorCard): CardProfile {
  const profile =
    model.profilesByName === undefined
      ? model.profiles.find((p) => p.name === card.correctedName)
      : model.profilesByName.get(card.correctedName);
  if (profile === undefined) throw new Error(`Advisor metadata missing for ${card.correctedName}`);
  return profile;
}

export function reason(
  code: string,
  text: string,
  cards: readonly string[],
  polarity: Reason['polarity'] = 'positive',
): Reason {
  return { code, text, cards, polarity };
}
