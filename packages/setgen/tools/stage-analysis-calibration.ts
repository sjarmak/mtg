/** Build the browser-safe Analysis calibration document staged by `npm run play`. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  deriveCardSetProfile,
  loadCalibrationProfile,
  loadReferenceProfileArtifact,
  verifyCalibrationProfile,
  type CalibrationProfile,
  type ComparableScalar,
  type MetricPopulation,
  type ReferenceProfileArtifact,
  type StaticProfileCard,
  type StaticSetProfile,
} from '@mtg/data';
import { cardManaValue, parseCard, renderOracleText } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { evaluateSetCalibration } from '../src/calibration';
import type { CalibrationMetricEvaluation } from '../src/calibration';

type CalibrationStatus = 'below' | 'inside' | 'above';
type ReferenceCode =
  'M11' | 'M13' | 'M15' | 'M20' | 'ORI' | 'ISD' | 'RTR' | 'RAV' | 'ROE' | 'SOM' | 'KTK' | 'MH2';

export interface CalibrationSetInput {
  readonly path: string;
  readonly what: string;
  readonly json: string;
}

interface PrimaryMetricWire {
  readonly id: string;
  readonly unit: ComparableScalar['unit'];
  readonly subject: { readonly value: number; readonly population: MetricPopulation };
  readonly anchors: readonly {
    readonly setCode: 'M11' | 'M13';
    readonly exactValue: number;
    readonly band: { readonly lower: number; readonly upper: number };
    readonly population: MetricPopulation;
  }[];
  readonly target: { readonly lower: number; readonly upper: number };
  readonly status: CalibrationStatus;
  readonly deltaToBand: number;
  readonly resolution: 'intersection' | 'precedence';
  readonly selectedSet?: 'M11' | 'M13' | undefined;
  readonly rationale: string;
  readonly scope: 'canonical-target' | 'reference-context';
}

function typeName(kind: Card['kind']): string {
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function staticCard(card: Card): StaticProfileCard {
  return {
    id: card.id,
    name: card.name,
    rarity: card.rarity,
    colors: card.colors,
    colorIdentity: card.colors,
    types: card.kind === 'creature' && card.artifact ? ['Artifact', 'Creature'] : [typeName(card.kind)],
    keywords: card.keywords,
    text: card.oracleText ?? renderOracleText(card),
    ...(card.kind === 'land' ? {} : { manaValue: cardManaValue(card) }),
    ...(card.kind === 'creature' ? { power: card.power, toughness: card.toughness } : {}),
  };
}

function population(profile: StaticSetProfile, id: string): MetricPopulation {
  const found = Object.values(profile.populations).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${profile.set.code} lacks metric population ${id}`);
  return found;
}

function scalar(profile: StaticSetProfile, id: string): ComparableScalar {
  const found = profile.comparableScalars.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${profile.set.code} lacks comparable metric ${id}`);
  return found;
}

function anchors(artifact: ReferenceProfileArtifact): readonly [StaticSetProfile, StaticSetProfile] {
  const m11 = artifact.profiles.find((profile) => profile.set.code === 'M11');
  const m13 = artifact.profiles.find((profile) => profile.set.code === 'M13');
  if (m11 === undefined || m13 === undefined) throw new Error('reference profiles lack M11 or M13');
  return [m11, m13];
}

function warningFinding(card: StaticProfileCard, m11: StaticSetProfile, m13: StaticSetProfile) {
  const single = deriveCardSetProfile({
    code: 'ONE',
    name: card.name,
    cards: [card],
    provenance: { kind: 'executable-dsl', source: card.id },
  });
  const rarity = card.rarity.toLowerCase();
  const usesBombProxy = rarity === 'rare' || rarity === 'mythic';
  const subjectRate = usesBombProxy ? single.riskProxies.bombRisk : single.riskProxies.unplayableRisk;
  const status = subjectRate.numerator > 0 ? (usesBombProxy ? 'bomb-risk' : 'weak-risk') : 'healthy';
  const rateFor = (profile: StaticSetProfile) =>
    usesBombProxy ? profile.riskProxies.bombRisk : profile.riskProxies.unplayableRisk;
  return {
    id: card.id,
    name: card.name,
    rarity: card.rarity,
    status,
    basis:
      status === 'healthy'
        ? `The card does not cross the versioned static ${usesBombProxy ? 'bomb' : 'weak-card'} warning proxy.`
        : `The card crosses the versioned static ${usesBombProxy ? 'bomb' : 'weak-card'} warning proxy.`,
    observations: 1,
    anchors: [m11, m13].map((profile) => {
      const rate = rateFor(profile);
      return {
        setCode: profile.set.code as 'M11' | 'M13',
        flagged: rate.numerator,
        population: rate.denominator.count,
      };
    }),
  };
}

function referenceProfile(target: StaticSetProfile, subject: StaticSetProfile) {
  return {
    code: target.set.code as ReferenceCode,
    name: target.set.name,
    role: target.role as Exclude<StaticSetProfile['role'], 'subject'>,
    mainSetSize: target.set.mainSetSize,
    cardFaceRecords: target.set.cardFaceRecords,
    provenance: {
      provider: target.provenance.provider,
      sourceVersion: target.provenance.sourceVersion,
      builtDate: target.provenance.builtDate,
    },
    evidence: { kind: 'static-proxy', caveat: target.evidence.caveat },
    metrics: target.comparableScalars.map((metric) => {
      const subjectMetric = scalar(subject, metric.id);
      return {
        id: metric.id,
        unit: metric.unit,
        subject: subjectMetric.value,
        reference: metric.value,
        delta: subjectMetric.value - metric.value,
        population: population(target, metric.populationId),
      };
    }),
  };
}

function primaryMetric(
  referenceMetric: ReferenceProfileArtifact['primaryCore']['metrics'][number],
  subject: StaticSetProfile,
  m11: StaticSetProfile,
  m13: StaticSetProfile,
  evaluation: CalibrationMetricEvaluation | undefined,
): PrimaryMetricWire {
  const subjectMetric = scalar(subject, referenceMetric.id);
  if (evaluation !== undefined) {
    if (evaluation.status === 'missing' || evaluation.value === null || evaluation.deltaToBand === null) {
      throw new Error(`calibration consumer did not evaluate subject metric ${referenceMetric.id}`);
    }
    return {
      id: evaluation.id,
      unit: evaluation.unit,
      subject: {
        value: evaluation.value,
        population: population(subject, subjectMetric.populationId),
      },
      anchors: evaluation.provenance.anchors.map((anchor) => {
        const anchorPopulation = evaluation.population.find((entry) => entry.source === anchor.setCode);
        if (anchorPopulation === undefined) {
          throw new Error(`calibration target ${evaluation.id} lacks ${anchor.setCode} population`);
        }
        return {
          setCode: anchor.setCode,
          exactValue: anchor.exactValue,
          band: anchor.band,
          population: {
            id: anchorPopulation.id,
            count: anchorPopulation.count,
            description: anchorPopulation.description,
          },
        };
      }),
      target: evaluation.target,
      status: evaluation.status,
      deltaToBand: evaluation.deltaToBand,
      resolution: evaluation.provenance.resolution,
      ...(evaluation.provenance.selectedSource === undefined
        ? {}
        : { selectedSet: evaluation.provenance.selectedSource }),
      rationale: evaluation.provenance.rationale,
      scope: 'canonical-target',
    };
  }

  const value = subjectMetric.value;
  const status: CalibrationStatus =
    value < referenceMetric.target.lower
      ? 'below'
      : value > referenceMetric.target.upper
        ? 'above'
        : 'inside';
  const deltaToBand =
    status === 'below'
      ? value - referenceMetric.target.lower
      : status === 'above'
        ? value - referenceMetric.target.upper
        : 0;
  return {
    id: referenceMetric.id,
    unit: referenceMetric.unit,
    subject: { value, population: population(subject, subjectMetric.populationId) },
    anchors: referenceMetric.anchors.map((entry) => {
      const profile = entry.setCode === 'M11' ? m11 : m13;
      return {
        setCode: entry.setCode,
        exactValue: entry.exactValue,
        band: entry.band,
        population: population(profile, entry.populationId),
      };
    }),
    target: referenceMetric.target,
    status,
    deltaToBand,
    resolution: referenceMetric.resolution,
    ...(referenceMetric.selectedSet === undefined ? {} : { selectedSet: referenceMetric.selectedSet }),
    rationale: referenceMetric.rationale,
    scope: 'reference-context',
  };
}

interface ParsedSet {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly Card[];
  readonly document: unknown;
}

function parsedSet(set: CalibrationSetInput): ParsedSet {
  const value: unknown = JSON.parse(set.json);
  if (typeof value !== 'object' || value === null || !('set' in value) || !('cards' in value)) {
    throw new Error(`${set.path} is not a set document`);
  }
  const raw = value as { readonly set: unknown; readonly cards: unknown };
  if (typeof raw.set !== 'object' || raw.set === null || !('code' in raw.set) || !('name' in raw.set)) {
    throw new Error(`${set.path} has no set identity`);
  }
  const identity = raw.set as { readonly code: unknown; readonly name: unknown };
  if (typeof identity.code !== 'string' || typeof identity.name !== 'string' || !Array.isArray(raw.cards)) {
    throw new Error(`${set.path} has an invalid set identity or card list`);
  }
  return {
    code: identity.code,
    name: identity.name,
    cards: raw.cards.map((card) => parseCard(card)),
    document: value,
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

/** Pure producer used by the launcher and the real 253-card integration test. */
export function buildCalibrationArtifact(
  set: CalibrationSetInput,
  calibrationInput: unknown = loadCalibrationProfile(),
) {
  const parsed = parsedSet(set);
  const calibration: CalibrationProfile = verifyCalibrationProfile(calibrationInput);
  const reference = loadReferenceProfileArtifact();
  const cards = parsed.cards.map(staticCard);
  const subject = deriveCardSetProfile({
    code: parsed.code,
    name: parsed.name,
    cards,
    provenance: { kind: 'executable-dsl', source: set.what },
  });
  const evaluation = evaluateSetCalibration(subject, calibration);
  const [m11, m13] = anchors(reference);
  const evaluated = new Map(evaluation.metrics.map((metric) => [metric.id, metric]));
  const primaryMetrics = reference.primaryCore.metrics.map((metric) =>
    primaryMetric(metric, subject, m11, m13, evaluated.get(metric.id)),
  );
  const payload = {
    schemaVersion: 1 as const,
    profileVersion: evaluation.profile.profileVersion,
    harnessVersion: evaluation.profile.harnessVersion,
    profileDigest: evaluation.profile.digest,
    referenceProfileVersion: reference.profileVersion,
    sourceCorpus: {
      provider: reference.sourceCorpus.provider,
      version: reference.sourceCorpus.version,
      builtDate: reference.sourceCorpus.builtDate,
    },
    subject: {
      code: evaluation.subject.code,
      name: evaluation.subject.name,
      fingerprint: `sha256:${digest(parsed.document)}`,
      source: set.what,
      evidence: { kind: 'static-proxy', caveat: subject.evidence.caveat },
    },
    primaryCore: {
      policyVersion: calibration.source.artifactPolicyVersion,
      precedence: calibration.precedence.default,
      caveat:
        `${calibration.evidence.caveat} ` +
        'Seventeen metrics are canonical actionable targets; four are checked reference context only.',
      metrics: primaryMetrics,
    },
    references: reference.profiles.map((profile) => referenceProfile(profile, subject)),
    findings: {
      population: {
        id: 'executable-cards',
        count: cards.length,
        description: 'Every executable card in the staged subject set, one observation per card.',
      },
      evidence: {
        kind: 'static-proxy',
        uncertainty: 'Deterministic census proxy; no confidence interval applies.',
        caveat:
          'Weak-risk, healthy, and bomb-risk are versioned text and printed-stat warning labels. They are not gameplay strength, draft pick quality, or human evidence.',
      },
      cards: cards.map((card) => warningFinding(card, m11, m13)),
    },
    formats: {
      draft: {
        status: 'static-only',
        evidence:
          'The executable-card census provides checked color-pair card-supply evidence. Booster collation and mechanic as-fan remain unavailable.',
        caveat: 'No native draft games or human draft evidence are present in this calibration artifact.',
        collation: {
          status: 'unavailable',
          population: subject.populations.mainCards,
          reason: 'No checked booster collation is carried by the executable set document.',
        },
        mechanicAsFan:
          subject.mechanicAsFan.status === 'available'
            ? {
                status: 'checked',
                population: subject.populations.mainCards,
                mechanics: subject.mechanicAsFan.mechanics,
                evidence: subject.mechanicAsFan.methodology,
              }
            : {
                status: 'unavailable',
                population: subject.populations.mainCards,
                reason: subject.mechanicAsFan.reason,
              },
        archetypeSupport: {
          status: 'checked',
          population: subject.archetypeSupport.denominator,
          pairs: subject.archetypeSupport.pairs,
          evidence: subject.archetypeSupport.methodology,
        },
      },
      sealed: {
        status: 'unavailable',
        evidence: 'No sealed calibration artifact is present.',
        caveat: 'Draft proxies are not substituted for sealed evidence.',
      },
      native: {
        status: 'subject-executable',
        subjectCards: cards.length,
        anchorCards: { M11: 0, M13: 0 },
        evidence: `All ${String(cards.length)} subject cards passed the executable DSL boundary used by npm run play.`,
        caveat:
          'M11 and M13 remain static anchors here. No reference card is counted as natively exact until its current Oracle semantics execute in the kernel.',
      },
      human: {
        status: 'unavailable',
        observations: 0,
        evidence: 'No human checkpoint artifact is present.',
        caveat:
          'Bot capability and static evidence are not presented as human preference or play-pattern evidence.',
      },
    },
  };
  return { ...payload, payloadDigest: digest(payload) };
}

export interface StagedCalibration {
  readonly artifact: ReturnType<typeof buildCalibrationArtifact>;
  readonly summary: string;
}

export function stageCalibration(set: CalibrationSetInput, target: string): StagedCalibration {
  const artifact = buildCalibrationArtifact(set);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return {
    artifact,
    summary:
      `Staged ${String(artifact.references.length)} reference profiles, ` +
      `${String(artifact.primaryCore.metrics.length)} metrics, and ` +
      `${String(artifact.findings.cards.length)} card findings for ${artifact.subject.code}.`,
  };
}

export function stageCalibrationFile(path: string, target: string): StagedCalibration {
  return stageCalibration(
    { path, what: 'the set selected by npm run play', json: readFileSync(path, 'utf8') },
    target,
  );
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  const path = process.argv[2];
  const target = process.argv[3];
  if (path === undefined || target === undefined) {
    process.stderr.write('usage: stage-analysis-calibration.ts <set.json> <calibration.json>\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${stageCalibrationFile(path, target).summary}\n`);
    } catch (cause: unknown) {
      process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      process.exitCode = 1;
    }
  }
}
