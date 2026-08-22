/** Checked, content-addressed targets derived from the committed reference profiles. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import {
  REFERENCE_PROFILE_PATH,
  REFERENCE_PROFILE_VERSION,
  TARGET_BAND_POLICY_VERSION,
  ReferenceProfileArtifactSchema,
  type PrimaryCoreEnvelopeMetric,
  type ReferenceProfileArtifact,
} from './profiles';

export const CALIBRATION_PROFILE_VERSION = 'reference-calibration-v1' as const;
export const CALIBRATION_HARNESS_VERSION = 'static-profile-consumer-v1' as const;
export const REFERENCE_PROFILE_SHA256 =
  '4d5b42281b72c341101d38b054f9e9de2a242c52d0936f2ff22d05fb9d5c4f58' as const;

export type CalibrationAxis = 'curve' | 'interaction' | 'complexity' | 'weak-card' | 'bomb-ceiling';
export type CalibrationTargetKind = 'recommendation' | 'constraint';

export interface CalibrationTarget {
  readonly id: string;
  readonly axis: CalibrationAxis;
  readonly kind: CalibrationTargetKind;
  readonly unit: PrimaryCoreEnvelopeMetric['unit'];
  readonly target: { readonly lower: number; readonly upper: number };
  readonly population: readonly {
    readonly source: 'M11' | 'M13';
    readonly id: string;
    readonly count: number;
    readonly description: string;
  }[];
  readonly provenance: {
    readonly policyVersion: typeof TARGET_BAND_POLICY_VERSION;
    readonly resolution: PrimaryCoreEnvelopeMetric['resolution'];
    readonly selectedSource?: 'M11' | 'M13' | undefined;
    readonly rationale: string;
    readonly anchors: PrimaryCoreEnvelopeMetric['anchors'];
  };
  readonly caveat: string;
}

export interface CalibrationProfile {
  readonly schemaVersion: 1;
  readonly profileVersion: typeof CALIBRATION_PROFILE_VERSION;
  readonly harnessVersion: typeof CALIBRATION_HARNESS_VERSION;
  readonly source: {
    readonly artifactSchemaVersion: 1;
    readonly artifactProfileVersion: typeof REFERENCE_PROFILE_VERSION;
    readonly artifactPolicyVersion: typeof TARGET_BAND_POLICY_VERSION;
    readonly artifactSha256: string;
    readonly corpus: {
      readonly schemaVersion: 1;
      readonly provider: 'MTGJSON';
      readonly version: string;
      readonly builtDate: string;
    };
    readonly sets: readonly {
      readonly code: 'M11' | 'M13';
      readonly sourceSha256: string;
      readonly population: number;
    }[];
  };
  readonly derivation: {
    readonly builtDate: string;
    readonly builtDateSemantics: 'source-snapshot-date';
    readonly seedPolicy: {
      readonly applicability: 'not-applicable';
      readonly seeds: readonly [];
      readonly rationale: string;
    };
  };
  readonly evidence: {
    readonly kind: 'static-proxy';
    readonly claimsNativePlay: false;
    readonly claimsHumanEvidence: false;
    readonly caveat: string;
  };
  readonly precedence: {
    readonly default: 'M11' | 'M13';
    readonly strategy: 'intersection-else-precedence';
    readonly rationale: string;
  };
  readonly targets: readonly CalibrationTarget[];
  readonly contentAddress: { readonly algorithm: 'sha256'; readonly digest: string };
}

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BandSchema = z
  .object({ lower: z.number().nonnegative(), upper: z.number().nonnegative() })
  .refine((band) => band.lower <= band.upper, { message: 'lower must not exceed upper' });
const AnchorSchema = z.object({
  setCode: z.enum(['M11', 'M13']),
  exactValue: z.number(),
  band: BandSchema,
  populationId: z.string().min(1),
});
const PopulationSchema = z.object({
  source: z.enum(['M11', 'M13']),
  id: z.string().min(1),
  count: z.number().int().positive(),
  description: z.string().min(1),
});
const CalibrationTargetBaseSchema = z.object({
  id: z.string().min(1),
  unit: z.enum(['share', 'mana-value', 'words-per-card', 'lines-per-card', 'stats-per-mana']),
  target: BandSchema,
  population: z.tuple([
    PopulationSchema.extend({ source: z.literal('M11') }),
    PopulationSchema.extend({ source: z.literal('M13') }),
  ]),
  provenance: z.object({
    policyVersion: z.literal(TARGET_BAND_POLICY_VERSION),
    resolution: z.enum(['intersection', 'precedence']),
    selectedSource: z.enum(['M11', 'M13']).optional(),
    rationale: z.string().min(1),
    anchors: z.tuple([
      AnchorSchema.extend({ setCode: z.literal('M11') }),
      AnchorSchema.extend({ setCode: z.literal('M13') }),
    ]),
  }),
  caveat: z.string().min(1),
});
const CalibrationTargetSchema = z.discriminatedUnion('kind', [
  CalibrationTargetBaseSchema.extend({
    kind: z.literal('recommendation'),
    axis: z.enum(['curve', 'interaction']),
  }),
  CalibrationTargetBaseSchema.extend({
    kind: z.literal('constraint'),
    axis: z.enum(['complexity', 'weak-card', 'bomb-ceiling']),
  }),
]);
const CalibrationTargetsSchema = z
  .array(CalibrationTargetSchema)
  .min(1)
  .superRefine((targets, context) => {
    const seen = new Set<string>();
    for (const [index, target] of targets.entries()) {
      if (seen.has(target.id)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate target id ${target.id}`,
          path: [index, 'id'],
        });
      }
      if (target.provenance.resolution === 'precedence' && target.provenance.selectedSource === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'precedence resolution requires selectedSource',
          path: [index, 'provenance', 'selectedSource'],
        });
      }
      if (target.provenance.resolution === 'intersection' && target.provenance.selectedSource !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'intersection resolution must not select a source',
          path: [index, 'provenance', 'selectedSource'],
        });
      }
      seen.add(target.id);
    }
  });
const CalibrationProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileVersion: z.literal(CALIBRATION_PROFILE_VERSION),
  harnessVersion: z.literal(CALIBRATION_HARNESS_VERSION),
  source: z.object({
    artifactSchemaVersion: z.literal(1),
    artifactProfileVersion: z.literal(REFERENCE_PROFILE_VERSION),
    artifactPolicyVersion: z.literal(TARGET_BAND_POLICY_VERSION),
    artifactSha256: z.string().regex(SHA256),
    corpus: z.object({
      schemaVersion: z.literal(1),
      provider: z.literal('MTGJSON'),
      version: z.string().min(1),
      builtDate: z.string().regex(ISO_DATE),
    }),
    sets: z.tuple([
      z.object({
        code: z.literal('M11'),
        sourceSha256: z.string().regex(SHA256),
        population: z.number().int().positive(),
      }),
      z.object({
        code: z.literal('M13'),
        sourceSha256: z.string().regex(SHA256),
        population: z.number().int().positive(),
      }),
    ]),
  }),
  derivation: z.object({
    builtDate: z.string().regex(ISO_DATE),
    builtDateSemantics: z.literal('source-snapshot-date'),
    seedPolicy: z.object({
      applicability: z.literal('not-applicable'),
      seeds: z.tuple([]),
      rationale: z.string().min(1),
    }),
  }),
  evidence: z.object({
    kind: z.literal('static-proxy'),
    claimsNativePlay: z.literal(false),
    claimsHumanEvidence: z.literal(false),
    caveat: z.string().min(1),
  }),
  precedence: z.object({
    default: z.enum(['M11', 'M13']),
    strategy: z.literal('intersection-else-precedence'),
    rationale: z.string().min(1),
  }),
  targets: CalibrationTargetsSchema,
  contentAddress: z.object({ algorithm: z.literal('sha256'), digest: z.string().regex(SHA256) }),
});

const TARGET_AXES: Readonly<Record<string, { axis: CalibrationAxis; kind: CalibrationTargetKind }>> = {
  'mean-mana-value': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-0': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-1': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-2': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-3': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-4': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-5': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-6': { axis: 'curve', kind: 'recommendation' },
  'mana-curve-7+': { axis: 'curve', kind: 'recommendation' },
  'removal-density': { axis: 'interaction', kind: 'recommendation' },
  'interaction-density': { axis: 'interaction', kind: 'recommendation' },
  'mean-oracle-words': { axis: 'complexity', kind: 'constraint' },
  'mean-ability-lines': { axis: 'complexity', kind: 'constraint' },
  'keyword-density': { axis: 'complexity', kind: 'constraint' },
  'decision-marker-density': { axis: 'complexity', kind: 'constraint' },
  'unplayable-risk-proxy': { axis: 'weak-card', kind: 'constraint' },
  'bomb-risk-proxy': { axis: 'bomb-ceiling', kind: 'constraint' },
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function digestProfile(profile: Omit<CalibrationProfile, 'contentAddress'>): string {
  return sha256(JSON.stringify(stableValue(profile)));
}

export function buildCalibrationProfile(
  artifact: ReferenceProfileArtifact,
  artifactSha256: string,
): CalibrationProfile {
  const profiles = new Map(artifact.profiles.map((profile) => [profile.set.code, profile]));
  const sourceSets = (['M11', 'M13'] as const).map((code) => {
    const profile = profiles.get(code);
    if (profile === undefined) throw new Error(`calibration profile: source profile ${code} is missing`);
    return {
      code,
      sourceSha256: profile.provenance.sourceSha256,
      population: profile.populations.mainCards.count,
    };
  });
  const targets = artifact.primaryCore.metrics.flatMap((metric): CalibrationTarget[] => {
    const classification = TARGET_AXES[metric.id];
    if (classification === undefined) return [];
    return [
      {
        id: metric.id,
        ...classification,
        unit: metric.unit,
        target: metric.target,
        population: metric.anchors.map((anchor) => {
          const profile = profiles.get(anchor.setCode);
          const population =
            profile === undefined
              ? undefined
              : Object.values(profile.populations).find((candidate) => candidate.id === anchor.populationId);
          if (population === undefined) {
            throw new InvalidInputError(
              'calibration profile',
              `target ${metric.id} names missing ${anchor.setCode} population ${anchor.populationId}`,
            );
          }
          return {
            source: anchor.setCode,
            id: population.id,
            count: population.count,
            description: population.description,
          };
        }),
        provenance: {
          policyVersion: artifact.primaryCore.policyVersion,
          resolution: metric.resolution,
          ...(metric.selectedSet === undefined ? {} : { selectedSource: metric.selectedSet }),
          rationale: metric.rationale,
          anchors: metric.anchors,
        },
        caveat:
          'This target is a deterministic static proxy over the named collector population; it is not native-play or human evidence.',
      },
    ];
  });
  const payload: Omit<CalibrationProfile, 'contentAddress'> = {
    schemaVersion: 1,
    profileVersion: CALIBRATION_PROFILE_VERSION,
    harnessVersion: CALIBRATION_HARNESS_VERSION,
    source: {
      artifactSchemaVersion: artifact.schemaVersion,
      artifactProfileVersion: artifact.profileVersion,
      artifactPolicyVersion: artifact.primaryCore.policyVersion,
      artifactSha256,
      corpus: {
        schemaVersion: artifact.sourceCorpus.schemaVersion,
        provider: artifact.sourceCorpus.provider,
        version: artifact.sourceCorpus.version,
        builtDate: artifact.sourceCorpus.builtDate,
      },
      sets: sourceSets,
    },
    derivation: {
      builtDate: artifact.sourceCorpus.builtDate,
      builtDateSemantics: 'source-snapshot-date',
      seedPolicy: {
        applicability: 'not-applicable',
        seeds: [],
        rationale:
          'Every target is a deterministic static census; no randomized harness ran and no seed applies.',
      },
    },
    evidence: {
      kind: 'static-proxy',
      claimsNativePlay: false,
      claimsHumanEvidence: false,
      caveat:
        'This static proxy evidence does not establish native-play behavior, card strength, draft quality, or human outcomes.',
    },
    precedence: {
      default: artifact.primaryCore.precedence,
      strategy: 'intersection-else-precedence',
      rationale:
        'Use the M11/M13 overlap when it exists; on disjoint policy bands, select the configured source while retaining both anchors and the metric rationale.',
    },
    targets,
  };
  return verifyCalibrationProfile({
    ...payload,
    contentAddress: { algorithm: 'sha256', digest: digestProfile(payload) },
  });
}

export function verifyCalibrationProfile(value: unknown): CalibrationProfile {
  const parsed = CalibrationProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidInputError(
      'calibration profile',
      `incompatible consumer document: ${parsed.error.message}`,
    );
  }
  const { contentAddress, ...payload } = parsed.data;
  const received = digestProfile(payload as Omit<CalibrationProfile, 'contentAddress'>);
  if (contentAddress.digest !== received) {
    throw new InvalidInputError(
      'calibration profile',
      `content checksum mismatch: expected ${contentAddress.digest}, received ${received}`,
    );
  }
  return parsed.data as CalibrationProfile;
}

export interface LoadCalibrationProfileOptions {
  readonly path?: string;
  readonly expectedArtifactSha256?: string;
  readonly expectedCorpusVersion?: string;
}

export function loadCalibrationProfile(options: LoadCalibrationProfileOptions = {}): CalibrationProfile {
  const path = options.path ?? REFERENCE_PROFILE_PATH;
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new InvalidInputError(
      'calibration profile',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable artifact`,
    );
  }
  const expectedSha256 = options.expectedArtifactSha256 ?? REFERENCE_PROFILE_SHA256;
  const receivedSha256 = sha256(source);
  if (receivedSha256 !== expectedSha256) {
    throw new InvalidInputError(
      'calibration profile',
      `${path}: checksum mismatch; expected ${expectedSha256}, received ${receivedSha256}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'calibration profile',
      cause instanceof Error ? `${path}: incompatible JSON: ${cause.message}` : `${path}: incompatible JSON`,
    );
  }
  const parsed = ReferenceProfileArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    const profileVersion =
      raw !== null && typeof raw === 'object' && 'profileVersion' in raw
        ? String((raw as { profileVersion?: unknown }).profileVersion)
        : 'missing';
    throw new InvalidInputError(
      'calibration profile',
      `${path}: incompatible artifact profile ${profileVersion}: ${parsed.error.message}`,
    );
  }
  const expectedCorpusVersion = options.expectedCorpusVersion ?? '5.3.0+20260814';
  if (parsed.data.sourceCorpus.version !== expectedCorpusVersion) {
    throw new InvalidInputError(
      'calibration profile',
      `${path}: stale corpus version; expected ${expectedCorpusVersion}, received ${parsed.data.sourceCorpus.version}`,
    );
  }
  return verifyCalibrationProfile(buildCalibrationProfile(parsed.data, receivedSha256));
}

export { CalibrationProfileSchema };
