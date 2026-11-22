/** Static, explainable metadata used by the draft advisor. */

export type CardRole =
  | 'build-around'
  | 'payoff'
  | 'enabler'
  | 'core'
  | 'support/glue'
  | 'interaction'
  | 'threat'
  | 'finisher'
  | 'fixing'
  | 'accelerator'
  | 'card-advantage'
  | 'removal'
  | 'land';

export interface ArchetypeNeed {
  readonly tag: string;
  readonly label: string;
  readonly min: number;
  readonly critical: boolean;
}

export interface ArchetypeAssessment {
  readonly archetype: string;
  /** 1 = incidental, 2 = useful, 3 = central to this lane. */
  readonly strength: 1 | 2 | 3;
  readonly roles: readonly string[];
  /** How informative seeing this card is as evidence that the lane is open. */
  readonly signal: number;
}

export interface CardProfile {
  readonly name: string;
  readonly quality: number;
  readonly flexibility: number;
  readonly neutral: boolean;
  readonly roles: readonly string[];
  readonly tags: readonly string[];
  /** Color letters or fixing capabilities (for example ['W', 'U']). */
  readonly fixing: readonly string[];
  /** Drafted single-color sources, distinct from multicolor flexibility. */
  readonly sources?: readonly string[];
  readonly archetypes: readonly ArchetypeAssessment[];
}

export interface Archetype {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];
  readonly description: string;
  readonly needs: readonly ArchetypeNeed[];
  readonly packages: readonly string[];
  readonly fixingRequired: number;
  readonly roles: readonly string[];
  readonly finishers: readonly string[];
  readonly pitfalls: readonly string[];
}

export interface SynergyPackage {
  /** Recipes sharing a group are alternatives, not cumulative requirements. */
  readonly alternativeGroup?: string;
  readonly id: string;
  readonly name: string;
  readonly archetypes: readonly string[];
  readonly needs: readonly ArchetypeNeed[];
  readonly description: string;
  readonly examples: readonly string[];
}
