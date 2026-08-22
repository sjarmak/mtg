/** Browser-safe wire vocabulary for reference-format calibration evidence. */

export const REFERENCE_CODES = [
  'M11',
  'M13',
  'M15',
  'M20',
  'ORI',
  'ISD',
  'RTR',
  'RAV',
  'ROE',
  'SOM',
  'KTK',
  'MH2',
] as const;
export type ReferenceCode = (typeof REFERENCE_CODES)[number];
export type CalibrationRole = 'primary-core' | 'secondary-core' | 'expansion' | 'stress-only';
export type CalibrationUnit = 'share' | 'mana-value' | 'words-per-card' | 'lines-per-card' | 'stats-per-mana';
export type CalibrationStatus = 'below' | 'inside' | 'above';

/** Checked static metrics which inform the screen but are not actionable consumer targets. */
export const REFERENCE_CONTEXT_METRICS = [
  'creature-rate',
  'fixing-density',
  'mean-stat-efficiency',
  'combat-keyword-share',
] as const;

export interface CalibrationPopulation {
  readonly id: string;
  readonly count: number;
  readonly description: string;
}

export interface CalibrationAnchor {
  readonly setCode: 'M11' | 'M13';
  readonly exactValue: number;
  readonly band: { readonly lower: number; readonly upper: number };
  readonly population: CalibrationPopulation;
}

export interface PrimaryCalibrationMetric {
  readonly id: string;
  readonly unit: CalibrationUnit;
  readonly subject: { readonly value: number; readonly population: CalibrationPopulation };
  readonly anchors: readonly CalibrationAnchor[];
  readonly target: { readonly lower: number; readonly upper: number };
  readonly status: CalibrationStatus;
  readonly deltaToBand: number;
  readonly resolution: 'intersection' | 'precedence';
  readonly selectedSet?: 'M11' | 'M13' | undefined;
  readonly rationale: string;
  /** Only canonical targets are governed by the calibration consumer digest. */
  readonly scope: 'canonical-target' | 'reference-context';
}

export interface ReferenceCalibrationMetric {
  readonly id: string;
  readonly unit: CalibrationUnit;
  readonly subject: number;
  readonly reference: number;
  readonly delta: number;
  readonly population: CalibrationPopulation;
}

export interface ReferenceCalibrationProfile {
  readonly code: ReferenceCode;
  readonly name: string;
  readonly role: CalibrationRole;
  readonly mainSetSize: number;
  readonly cardFaceRecords: number;
  readonly provenance: {
    readonly provider: string;
    readonly sourceVersion: string;
    readonly builtDate: string;
  };
  readonly evidence: { readonly kind: 'static-proxy'; readonly caveat: string };
  readonly metrics: readonly ReferenceCalibrationMetric[];
}

export type CardFindingStatus = 'weak-risk' | 'healthy' | 'bomb-risk';

export interface CardCalibrationFinding {
  readonly id: string;
  readonly name: string;
  readonly rarity: string;
  readonly status: CardFindingStatus;
  readonly basis: string;
  /** This is a deterministic one-card classification, never a game sample. */
  readonly observations: 1;
  readonly anchors: readonly {
    readonly setCode: 'M11' | 'M13';
    readonly flagged: number;
    readonly population: number;
  }[];
}

export interface CalibrationArtifact {
  readonly schemaVersion: 1;
  /** SHA-256 over the complete artifact except this field. */
  readonly payloadDigest: string;
  readonly profileVersion: string;
  readonly harnessVersion: string;
  readonly profileDigest: string;
  readonly referenceProfileVersion: string;
  readonly sourceCorpus: {
    readonly provider: string;
    readonly version: string;
    readonly builtDate: string;
  };
  readonly subject: {
    readonly code: string;
    readonly name: string;
    readonly fingerprint: string;
    readonly source: string;
    readonly evidence: { readonly kind: 'static-proxy'; readonly caveat: string };
  };
  readonly primaryCore: {
    readonly policyVersion: string;
    readonly precedence: 'M11' | 'M13';
    readonly caveat: string;
    readonly metrics: readonly PrimaryCalibrationMetric[];
  };
  readonly references: readonly ReferenceCalibrationProfile[];
  readonly findings: {
    readonly population: CalibrationPopulation;
    readonly evidence: {
      readonly kind: 'static-proxy';
      readonly uncertainty: string;
      readonly caveat: string;
    };
    readonly cards: readonly CardCalibrationFinding[];
  };
  readonly formats: {
    readonly draft: {
      readonly status: 'static-only' | 'unavailable';
      readonly evidence: string;
      readonly caveat: string;
      readonly collation:
        | {
            readonly status: 'checked';
            readonly population: CalibrationPopulation;
            readonly evidence: string;
          }
        | {
            readonly status: 'unavailable';
            readonly population: CalibrationPopulation;
            readonly reason: string;
          };
      readonly mechanicAsFan:
        | {
            readonly status: 'checked';
            readonly population: CalibrationPopulation;
            readonly mechanics: readonly {
              readonly mechanic: string;
              readonly expectedCardsPerBooster: number;
              readonly shareOfBooster: number;
            }[];
            readonly evidence: string;
          }
        | {
            readonly status: 'unavailable';
            readonly population: CalibrationPopulation;
            readonly reason: string;
          };
      readonly archetypeSupport: {
        readonly status: 'checked';
        readonly population: CalibrationPopulation;
        readonly pairs: readonly {
          readonly pair: string;
          readonly exactMulticolorCards: number;
          readonly firstColorCards: number;
          readonly secondColorCards: number;
          readonly fixingCards: number;
          readonly supportShare: number;
        }[];
        readonly evidence: string;
      };
    };
    readonly sealed: {
      readonly status: 'static-only' | 'unavailable';
      readonly evidence: string;
      readonly caveat: string;
    };
    readonly native: {
      readonly status: 'subject-executable' | 'unavailable';
      readonly subjectCards: number;
      readonly anchorCards: { readonly M11: number; readonly M13: number };
      readonly evidence: string;
      readonly caveat: string;
    };
    readonly human: {
      readonly status: 'unavailable' | 'observed';
      readonly observations: number;
      readonly evidence: string;
      readonly caveat: string;
    };
  };
}

export interface RetuneArtifact {
  readonly schemaVersion: 1;
  readonly profileVersion: string;
  readonly profileDigest: string;
  readonly setCode: string;
  readonly proposalId: string;
  readonly baseline: { readonly fingerprint: string; readonly runId: string };
  readonly candidate: { readonly fingerprint: string; readonly runId: string };
  readonly changes: readonly {
    readonly kind: 'card' | 'deck';
    readonly id: string;
    readonly label: string;
    readonly field: string;
    readonly before: string | number;
    readonly after: string | number;
  }[];
  readonly evidence:
    | {
        readonly kind: 'simulation';
        readonly beforeSamples: number;
        readonly afterSamples: number;
        readonly measurementStatus: 'measured' | 'under-sampled';
        readonly gateStatus: 'pass' | 'fail' | 'under-sampled';
        readonly uncertaintyStatus: 'measured' | 'under-sampled';
        readonly uncertainty: string;
        readonly caveat: string;
      }
    | { readonly kind: 'none'; readonly caveat: string };
}

export type CalibrationState =
  | { readonly status: 'loading' }
  | { readonly status: 'absent' }
  | { readonly status: 'stale'; readonly message: string }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'ready'; readonly artifact: CalibrationArtifact };

export type RetuneState =
  | { readonly status: 'loading' }
  | { readonly status: 'blocked'; readonly message: string }
  | { readonly status: 'absent' }
  | { readonly status: 'stale'; readonly message: string }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'underSampled'; readonly artifact: RetuneArtifact }
  | { readonly status: 'ready'; readonly artifact: RetuneArtifact };
