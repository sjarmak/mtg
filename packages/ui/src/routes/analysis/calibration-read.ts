/** Checked readers for the two untrusted calibration documents fetched by the lab. */
import {
  REFERENCE_CODES,
  REFERENCE_CONTEXT_METRICS,
  type CalibrationAnchor,
  type CalibrationArtifact,
  type CalibrationPopulation,
  type CalibrationRole,
  type CalibrationState,
  type CalibrationStatus,
  type CalibrationUnit,
  type CardCalibrationFinding,
  type CardFindingStatus,
  type PrimaryCalibrationMetric,
  type ReferenceCalibrationMetric,
  type ReferenceCalibrationProfile,
  type ReferenceCode,
  type RetuneArtifact,
  type RetuneState,
} from './calibration-model';

/** Duplicated deliberately: importing `@mtg/data` here would put `node:fs` in the browser bundle. */
export const EXPECTED_CALIBRATION_PROFILE_VERSION = 'reference-calibration-v1';
export const EXPECTED_CALIBRATION_HARNESS_VERSION = 'static-profile-consumer-v1';
export const EXPECTED_CALIBRATION_PROFILE_DIGEST =
  '7850c31fad7a62bc37465c13a291d37ffdcb012801bf176fbabc93edc660b44e';
export const EXPECTED_REFERENCE_PROFILE_VERSION = 'reference-static-v1';
const MAX_COPY = 500;
const METRIC_COUNT = 21;
const MAX_CARD_FINDINGS = 1_000;
const MAX_RETUNE_CHANGES = 1_000;
const SHA256 = /^[0-9a-f]{64}$/;

export interface CalibrationSetIdentity {
  readonly code: string;
  readonly fingerprint: string;
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const SHA256_ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

/** Browser-safe SHA-256 for origins where SubtleCrypto is deliberately unavailable. */
function portableSha256(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state: number[] = [...SHA256_INITIAL];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15] ?? 0;
      const right = words[index - 2] ?? 0;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + (SHA256_ROUND[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    const block = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < state.length; index += 1) {
      state[index] = ((state[index] ?? 0) + (block[index] ?? 0)) >>> 0;
    }
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function subtleDigestOf(
  source: unknown,
): ((algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>) | null {
  if (typeof source !== 'object' || source === null || !('subtle' in source)) return null;
  const { subtle } = source as { readonly subtle: unknown };
  if (typeof subtle !== 'object' || subtle === null || !('digest' in subtle)) return null;
  const { digest } = subtle as { readonly digest: unknown };
  return typeof digest === 'function'
    ? (algorithm, data) =>
        (digest as (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>).call(
          subtle,
          algorithm,
          data,
        )
    : null;
}

/** SHA-256 with a browser-native fast path and a plain-HTTP fallback. */
export async function sha256Text(value: string, cryptoSource: unknown = globalThis.crypto): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = subtleDigestOf(cryptoSource);
  if (digest !== null) {
    try {
      const result = new Uint8Array(await digest('SHA-256', bytes));
      if (result.length === 32) {
        return [...result].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      }
    } catch {
      // Some embedded browsers expose the property but reject it outside a secure context.
    }
  }
  return portableSha256(bytes);
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

/** Canonical payload addressed by `payloadDigest`; the digest field never addresses itself. */
export function calibrationPayloadText(value: unknown): string {
  const raw = record(value, 'calibration');
  const { payloadDigest: _payloadDigest, ...payload } = raw;
  return canonicalJsonText(payload);
}

/** Stable JSON shared by staged-set fingerprinting and calibration self-addressing. */
export function canonicalJsonText(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export class CalibrationDataError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`calibration document ${path}: ${message}`);
    this.name = 'CalibrationDataError';
  }
}

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown, path: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CalibrationDataError(path, 'expected an object');
  }
  return value as Raw;
}

function field(source: Raw, key: string, path: string): unknown {
  if (!(key in source)) throw new CalibrationDataError(`${path}.${key}`, 'missing');
  return source[key];
}

function nested(source: Raw, key: string, path: string): { readonly raw: Raw; readonly path: string } {
  const next = `${path}.${key}`;
  return { raw: record(field(source, key, path), next), path: next };
}

function list(source: Raw, key: string, path: string): readonly unknown[] {
  const value = field(source, key, path);
  if (!Array.isArray(value)) throw new CalibrationDataError(`${path}.${key}`, 'expected an array');
  return value;
}

function str(source: Raw, key: string, path: string): string {
  const value = field(source, key, path);
  if (typeof value !== 'string') throw new CalibrationDataError(`${path}.${key}`, 'expected a string');
  if (value.length === 0 || value.length > MAX_COPY) {
    throw new CalibrationDataError(`${path}.${key}`, `expected 1-${String(MAX_COPY)} characters`);
  }
  return value;
}

function sha256(source: Raw, key: string, path: string): string {
  const value = str(source, key, path);
  if (!SHA256.test(value)) throw new CalibrationDataError(`${path}.${key}`, 'expected a SHA-256 digest');
  return value;
}

function finite(source: Raw, key: string, path: string): number {
  const value = field(source, key, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CalibrationDataError(`${path}.${key}`, 'expected a finite number');
  }
  return value;
}

function nonnegative(source: Raw, key: string, path: string): number {
  const value = finite(source, key, path);
  if (value < 0) throw new CalibrationDataError(`${path}.${key}`, 'expected a nonnegative number');
  return value;
}

function share(source: Raw, key: string, path: string): number {
  const value = finite(source, key, path);
  if (value < 0 || value > 1) {
    throw new CalibrationDataError(`${path}.${key}`, 'expected a value from zero through one');
  }
  return value;
}

function count(source: Raw, key: string, path: string): number {
  const value = finite(source, key, path);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CalibrationDataError(`${path}.${key}`, 'expected a nonnegative safe integer');
  }
  return value;
}

function literal<T extends string>(source: Raw, key: string, path: string, values: readonly T[]): T {
  const value = str(source, key, path);
  const known = values.find((entry) => entry === value);
  if (known === undefined) {
    throw new CalibrationDataError(`${path}.${key}`, `expected one of ${values.join(', ')}`);
  }
  return known;
}

function pair(source: Raw, key: string, path: string): { readonly lower: number; readonly upper: number } {
  const inner = nested(source, key, path);
  const lower = finite(inner.raw, 'lower', inner.path);
  const upper = finite(inner.raw, 'upper', inner.path);
  if (lower > upper) throw new CalibrationDataError(inner.path, 'lower must not exceed upper');
  return { lower, upper };
}

function population(value: unknown, path: string): CalibrationPopulation {
  const raw = record(value, path);
  return {
    id: str(raw, 'id', path),
    count: count(raw, 'count', path),
    description: str(raw, 'description', path),
  };
}

function anchor(value: unknown, path: string): CalibrationAnchor {
  const raw = record(value, path);
  return {
    setCode: literal(raw, 'setCode', path, ['M11', 'M13'] as const),
    exactValue: finite(raw, 'exactValue', path),
    band: pair(raw, 'band', path),
    population: population(field(raw, 'population', path), `${path}.population`),
  };
}

function primaryMetric(value: unknown, path: string): PrimaryCalibrationMetric {
  const raw = record(value, path);
  const subject = nested(raw, 'subject', path);
  const anchors = list(raw, 'anchors', path).map((entry, index) =>
    anchor(entry, `${path}.anchors[${String(index)}]`),
  );
  if (anchors.length !== 2 || anchors[0]?.setCode !== 'M11' || anchors[1]?.setCode !== 'M13') {
    throw new CalibrationDataError(`${path}.anchors`, 'expected M11 then M13');
  }
  const resolution = literal(raw, 'resolution', path, ['intersection', 'precedence'] as const);
  const selected =
    'selectedSet' in raw ? literal(raw, 'selectedSet', path, ['M11', 'M13'] as const) : undefined;
  if ((resolution === 'precedence') !== (selected !== undefined)) {
    throw new CalibrationDataError(`${path}.selectedSet`, 'is required exactly for precedence metrics');
  }
  return {
    id: str(raw, 'id', path),
    unit: literal(raw, 'unit', path, [
      'share',
      'mana-value',
      'words-per-card',
      'lines-per-card',
      'stats-per-mana',
    ] as const) satisfies CalibrationUnit,
    subject: {
      value: finite(subject.raw, 'value', subject.path),
      population: population(field(subject.raw, 'population', subject.path), `${subject.path}.population`),
    },
    anchors,
    target: pair(raw, 'target', path),
    status: literal(raw, 'status', path, ['below', 'inside', 'above'] as const) satisfies CalibrationStatus,
    deltaToBand: finite(raw, 'deltaToBand', path),
    resolution,
    ...(selected === undefined ? {} : { selectedSet: selected }),
    rationale: str(raw, 'rationale', path),
    scope: literal(raw, 'scope', path, ['canonical-target', 'reference-context'] as const),
  };
}

function referenceMetric(value: unknown, path: string): ReferenceCalibrationMetric {
  const raw = record(value, path);
  return {
    id: str(raw, 'id', path),
    unit: literal(raw, 'unit', path, [
      'share',
      'mana-value',
      'words-per-card',
      'lines-per-card',
      'stats-per-mana',
    ] as const),
    subject: finite(raw, 'subject', path),
    reference: finite(raw, 'reference', path),
    delta: finite(raw, 'delta', path),
    population: population(field(raw, 'population', path), `${path}.population`),
  };
}

function reference(value: unknown, path: string): ReferenceCalibrationProfile {
  const raw = record(value, path);
  const provenance = nested(raw, 'provenance', path);
  const evidence = nested(raw, 'evidence', path);
  const metrics = list(raw, 'metrics', path).map((entry, index) =>
    referenceMetric(entry, `${path}.metrics[${String(index)}]`),
  );
  if (metrics.length !== METRIC_COUNT) {
    throw new CalibrationDataError(`${path}.metrics`, `expected ${String(METRIC_COUNT)} metrics`);
  }
  return {
    code: literal(raw, 'code', path, REFERENCE_CODES) satisfies ReferenceCode,
    name: str(raw, 'name', path),
    role: literal(raw, 'role', path, [
      'primary-core',
      'secondary-core',
      'expansion',
      'stress-only',
    ] as const) satisfies CalibrationRole,
    mainSetSize: count(raw, 'mainSetSize', path),
    cardFaceRecords: count(raw, 'cardFaceRecords', path),
    provenance: {
      provider: str(provenance.raw, 'provider', provenance.path),
      sourceVersion: str(provenance.raw, 'sourceVersion', provenance.path),
      builtDate: str(provenance.raw, 'builtDate', provenance.path),
    },
    evidence: {
      kind: literal(evidence.raw, 'kind', evidence.path, ['static-proxy'] as const),
      caveat: str(evidence.raw, 'caveat', evidence.path),
    },
    metrics,
  };
}

function cardFinding(value: unknown, path: string): CardCalibrationFinding {
  const raw = record(value, path);
  const anchors = list(raw, 'anchors', path).map((entry, index) => {
    const at = `${path}.anchors[${String(index)}]`;
    const item = record(entry, at);
    return {
      setCode: literal(item, 'setCode', at, ['M11', 'M13'] as const),
      flagged: count(item, 'flagged', at),
      population: count(item, 'population', at),
    };
  });
  if (anchors.length !== 2 || anchors[0]?.setCode !== 'M11' || anchors[1]?.setCode !== 'M13') {
    throw new CalibrationDataError(`${path}.anchors`, 'expected M11 then M13');
  }
  const observations = count(raw, 'observations', path);
  if (observations !== 1) throw new CalibrationDataError(`${path}.observations`, 'expected one card');
  return {
    id: str(raw, 'id', path),
    name: str(raw, 'name', path),
    rarity: str(raw, 'rarity', path),
    status: literal(raw, 'status', path, [
      'weak-risk',
      'healthy',
      'bomb-risk',
    ] as const) satisfies CardFindingStatus,
    basis: str(raw, 'basis', path),
    observations: 1,
    anchors,
  };
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new CalibrationDataError(path, 'values must be unique');
}

function readDraftCollation(
  value: unknown,
  path: string,
): CalibrationArtifact['formats']['draft']['collation'] {
  const raw = record(value, path);
  const status = literal(raw, 'status', path, ['checked', 'unavailable'] as const);
  const measured = population(field(raw, 'population', path), `${path}.population`);
  return status === 'checked'
    ? { status, population: measured, evidence: str(raw, 'evidence', path) }
    : { status, population: measured, reason: str(raw, 'reason', path) };
}

function readMechanicAsFan(
  value: unknown,
  path: string,
): CalibrationArtifact['formats']['draft']['mechanicAsFan'] {
  const raw = record(value, path);
  const status = literal(raw, 'status', path, ['checked', 'unavailable'] as const);
  const measured = population(field(raw, 'population', path), `${path}.population`);
  if (status === 'unavailable') return { status, population: measured, reason: str(raw, 'reason', path) };
  const mechanics = list(raw, 'mechanics', path).map((entry, index) => {
    const at = `${path}.mechanics[${String(index)}]`;
    const mechanic = record(entry, at);
    return {
      mechanic: str(mechanic, 'mechanic', at),
      expectedCardsPerBooster: nonnegative(mechanic, 'expectedCardsPerBooster', at),
      shareOfBooster: share(mechanic, 'shareOfBooster', at),
    };
  });
  unique(
    mechanics.map((entry) => entry.mechanic),
    `${path}.mechanics`,
  );
  return { status, population: measured, mechanics, evidence: str(raw, 'evidence', path) };
}

function readArchetypeSupport(
  value: unknown,
  path: string,
): CalibrationArtifact['formats']['draft']['archetypeSupport'] {
  const raw = record(value, path);
  const status = literal(raw, 'status', path, ['checked'] as const);
  const pairs = list(raw, 'pairs', path).map((entry, index) => {
    const at = `${path}.pairs[${String(index)}]`;
    const pair = record(entry, at);
    return {
      pair: str(pair, 'pair', at),
      exactMulticolorCards: count(pair, 'exactMulticolorCards', at),
      firstColorCards: count(pair, 'firstColorCards', at),
      secondColorCards: count(pair, 'secondColorCards', at),
      fixingCards: count(pair, 'fixingCards', at),
      supportShare: share(pair, 'supportShare', at),
    };
  });
  if (pairs.length === 0) throw new CalibrationDataError(`${path}.pairs`, 'expected at least one color pair');
  unique(
    pairs.map((pair) => pair.pair),
    `${path}.pairs`,
  );
  return {
    status,
    population: population(field(raw, 'population', path), `${path}.population`),
    pairs,
    evidence: str(raw, 'evidence', path),
  };
}

/** Parse one complete calibration document and reject partial or hostile shapes. */
export function readCalibrationArtifact(value: unknown): CalibrationArtifact {
  const path = 'calibration';
  const raw = record(value, path);
  const schemaVersion = count(raw, 'schemaVersion', path);
  if (schemaVersion !== 1) throw new CalibrationDataError(`${path}.schemaVersion`, 'expected 1');
  const source = nested(raw, 'sourceCorpus', path);
  const subject = nested(raw, 'subject', path);
  const subjectEvidence = nested(subject.raw, 'evidence', subject.path);
  const primary = nested(raw, 'primaryCore', path);
  const metrics = list(primary.raw, 'metrics', primary.path).map((entry, index) =>
    primaryMetric(entry, `${primary.path}.metrics[${String(index)}]`),
  );
  if (metrics.length !== METRIC_COUNT) {
    throw new CalibrationDataError(`${primary.path}.metrics`, `expected ${String(METRIC_COUNT)} metrics`);
  }
  unique(
    metrics.map((metric) => metric.id),
    `${primary.path}.metrics`,
  );
  const contextMetrics = metrics.filter((metric) => metric.scope === 'reference-context');
  if (
    contextMetrics.length !== REFERENCE_CONTEXT_METRICS.length ||
    REFERENCE_CONTEXT_METRICS.some((id, index) => contextMetrics[index]?.id !== id)
  ) {
    throw new CalibrationDataError(
      `${primary.path}.metrics`,
      `expected only ${REFERENCE_CONTEXT_METRICS.join(', ')} as reference context`,
    );
  }

  const references = list(raw, 'references', path).map((entry, index) =>
    reference(entry, `${path}.references[${String(index)}]`),
  );
  if (
    references.length !== REFERENCE_CODES.length ||
    REFERENCE_CODES.some((code, index) => references[index]?.code !== code)
  ) {
    throw new CalibrationDataError(`${path}.references`, `expected ${REFERENCE_CODES.join(', ')} in order`);
  }
  for (const profile of references) {
    const ids = profile.metrics.map((metric) => metric.id);
    unique(ids, `${path}.references.${profile.code}.metrics`);
    if (ids.some((id, index) => id !== metrics[index]?.id)) {
      throw new CalibrationDataError(
        `${path}.references.${profile.code}.metrics`,
        'must match primary metric order',
      );
    }
  }

  const findings = nested(raw, 'findings', path);
  const findingsEvidence = nested(findings.raw, 'evidence', findings.path);
  const findingPopulation = population(
    field(findings.raw, 'population', findings.path),
    `${findings.path}.population`,
  );
  const cards = list(findings.raw, 'cards', findings.path).map((entry, index) =>
    cardFinding(entry, `${findings.path}.cards[${String(index)}]`),
  );
  if (cards.length > MAX_CARD_FINDINGS) {
    throw new CalibrationDataError(
      `${findings.path}.cards`,
      `expected at most ${String(MAX_CARD_FINDINGS)} card findings`,
    );
  }
  if (findingPopulation.count !== cards.length) {
    throw new CalibrationDataError(`${findings.path}.population.count`, 'must equal the card findings count');
  }
  unique(
    cards.map((card) => card.id),
    `${findings.path}.cards`,
  );

  const formats = nested(raw, 'formats', path);
  const draft = nested(formats.raw, 'draft', formats.path);
  const sealed = nested(formats.raw, 'sealed', formats.path);
  const native = nested(formats.raw, 'native', formats.path);
  const anchorCards = nested(native.raw, 'anchorCards', native.path);
  const human = nested(formats.raw, 'human', formats.path);

  return {
    schemaVersion: 1,
    payloadDigest: sha256(raw, 'payloadDigest', path),
    profileVersion: str(raw, 'profileVersion', path),
    harnessVersion: str(raw, 'harnessVersion', path),
    profileDigest: sha256(raw, 'profileDigest', path),
    referenceProfileVersion: str(raw, 'referenceProfileVersion', path),
    sourceCorpus: {
      provider: str(source.raw, 'provider', source.path),
      version: str(source.raw, 'version', source.path),
      builtDate: str(source.raw, 'builtDate', source.path),
    },
    subject: {
      code: str(subject.raw, 'code', subject.path),
      name: str(subject.raw, 'name', subject.path),
      fingerprint: str(subject.raw, 'fingerprint', subject.path),
      source: str(subject.raw, 'source', subject.path),
      evidence: {
        kind: literal(subjectEvidence.raw, 'kind', subjectEvidence.path, ['static-proxy'] as const),
        caveat: str(subjectEvidence.raw, 'caveat', subjectEvidence.path),
      },
    },
    primaryCore: {
      policyVersion: str(primary.raw, 'policyVersion', primary.path),
      precedence: literal(primary.raw, 'precedence', primary.path, ['M11', 'M13'] as const),
      caveat: str(primary.raw, 'caveat', primary.path),
      metrics,
    },
    references,
    findings: {
      population: findingPopulation,
      evidence: {
        kind: literal(findingsEvidence.raw, 'kind', findingsEvidence.path, ['static-proxy'] as const),
        uncertainty: str(findingsEvidence.raw, 'uncertainty', findingsEvidence.path),
        caveat: str(findingsEvidence.raw, 'caveat', findingsEvidence.path),
      },
      cards,
    },
    formats: {
      draft: {
        status: literal(draft.raw, 'status', draft.path, ['static-only', 'unavailable'] as const),
        evidence: str(draft.raw, 'evidence', draft.path),
        caveat: str(draft.raw, 'caveat', draft.path),
        collation: readDraftCollation(field(draft.raw, 'collation', draft.path), `${draft.path}.collation`),
        mechanicAsFan: readMechanicAsFan(
          field(draft.raw, 'mechanicAsFan', draft.path),
          `${draft.path}.mechanicAsFan`,
        ),
        archetypeSupport: readArchetypeSupport(
          field(draft.raw, 'archetypeSupport', draft.path),
          `${draft.path}.archetypeSupport`,
        ),
      },
      sealed: {
        status: literal(sealed.raw, 'status', sealed.path, ['static-only', 'unavailable'] as const),
        evidence: str(sealed.raw, 'evidence', sealed.path),
        caveat: str(sealed.raw, 'caveat', sealed.path),
      },
      native: {
        status: literal(native.raw, 'status', native.path, ['subject-executable', 'unavailable'] as const),
        subjectCards: count(native.raw, 'subjectCards', native.path),
        anchorCards: {
          M11: count(anchorCards.raw, 'M11', anchorCards.path),
          M13: count(anchorCards.raw, 'M13', anchorCards.path),
        },
        evidence: str(native.raw, 'evidence', native.path),
        caveat: str(native.raw, 'caveat', native.path),
      },
      human: {
        status: literal(human.raw, 'status', human.path, ['unavailable', 'observed'] as const),
        observations: count(human.raw, 'observations', human.path),
        evidence: str(human.raw, 'evidence', human.path),
        caveat: str(human.raw, 'caveat', human.path),
      },
    },
  };
}

function scalar(value: unknown, path: string): string | number {
  if (typeof value === 'string') {
    if (value.length === 0 || value.length > MAX_COPY) {
      throw new CalibrationDataError(path, `expected 1-${String(MAX_COPY)} characters`);
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new CalibrationDataError(path, 'expected a finite number or bounded string');
}

function simulationEvidence(
  raw: Raw,
  path: string,
): Extract<RetuneArtifact['evidence'], { kind: 'simulation' }> {
  const beforeSamples = count(raw, 'beforeSamples', path);
  const afterSamples = count(raw, 'afterSamples', path);
  if (beforeSamples === 0 || afterSamples === 0) {
    throw new CalibrationDataError(path, 'simulation sample counts must be positive');
  }
  return {
    kind: 'simulation',
    beforeSamples,
    afterSamples,
    measurementStatus: literal(raw, 'measurementStatus', path, ['measured', 'under-sampled'] as const),
    gateStatus: literal(raw, 'gateStatus', path, ['pass', 'fail', 'under-sampled'] as const),
    uncertaintyStatus: literal(raw, 'uncertaintyStatus', path, ['measured', 'under-sampled'] as const),
    uncertainty: str(raw, 'uncertainty', path),
    caveat: str(raw, 'caveat', path),
  };
}

/** Parse one optional before/after proposal. Empty changes are invalid, not "no proposal". */
export function readRetuneArtifact(value: unknown): RetuneArtifact {
  const path = 'retune';
  const raw = record(value, path);
  const schemaVersion = count(raw, 'schemaVersion', path);
  if (schemaVersion !== 1) throw new CalibrationDataError(`${path}.schemaVersion`, 'expected 1');
  const baseline = nested(raw, 'baseline', path);
  const candidate = nested(raw, 'candidate', path);
  const parsedBaseline = {
    fingerprint: str(baseline.raw, 'fingerprint', baseline.path),
    runId: str(baseline.raw, 'runId', baseline.path),
  };
  const parsedCandidate = {
    fingerprint: str(candidate.raw, 'fingerprint', candidate.path),
    runId: str(candidate.raw, 'runId', candidate.path),
  };
  if (parsedBaseline.fingerprint === parsedCandidate.fingerprint) {
    throw new CalibrationDataError(`${path}.candidate.fingerprint`, 'must differ from baseline');
  }
  if (parsedBaseline.runId === parsedCandidate.runId) {
    throw new CalibrationDataError(`${path}.candidate.runId`, 'must differ from baseline');
  }
  const changes = list(raw, 'changes', path).map((entry, index) => {
    const at = `${path}.changes[${String(index)}]`;
    const change = record(entry, at);
    const before = scalar(field(change, 'before', at), `${at}.before`);
    const after = scalar(field(change, 'after', at), `${at}.after`);
    if (Object.is(before, after)) {
      throw new CalibrationDataError(at, 'before and after must differ');
    }
    return {
      kind: literal(change, 'kind', at, ['card', 'deck'] as const),
      id: str(change, 'id', at),
      label: str(change, 'label', at),
      field: str(change, 'field', at),
      before,
      after,
    };
  });
  if (changes.length === 0) throw new CalibrationDataError(`${path}.changes`, 'expected at least one change');
  if (changes.length > MAX_RETUNE_CHANGES) {
    throw new CalibrationDataError(
      `${path}.changes`,
      `expected at most ${String(MAX_RETUNE_CHANGES)} changes`,
    );
  }
  const evidence = nested(raw, 'evidence', path);
  const evidenceKind = literal(evidence.raw, 'kind', evidence.path, ['simulation', 'none'] as const);
  const parsedEvidence: RetuneArtifact['evidence'] =
    evidenceKind === 'none'
      ? { kind: 'none', caveat: str(evidence.raw, 'caveat', evidence.path) }
      : simulationEvidence(evidence.raw, evidence.path);
  return {
    schemaVersion: 1,
    profileVersion: str(raw, 'profileVersion', path),
    profileDigest: sha256(raw, 'profileDigest', path),
    setCode: str(raw, 'setCode', path),
    proposalId: str(raw, 'proposalId', path),
    baseline: parsedBaseline,
    candidate: parsedCandidate,
    changes,
    evidence: parsedEvidence,
  };
}

export async function classifyCalibration(
  value: unknown | null,
  set: CalibrationSetIdentity,
): Promise<CalibrationState> {
  if (value === null) return { status: 'absent' };
  let artifact: CalibrationArtifact;
  try {
    artifact = readCalibrationArtifact(value);
  } catch (cause: unknown) {
    return { status: 'invalid', message: cause instanceof Error ? cause.message : String(cause) };
  }
  try {
    const received = await sha256Text(calibrationPayloadText(value));
    if (received !== artifact.payloadDigest) {
      return { status: 'invalid', message: 'Calibration payload checksum does not match its contents.' };
    }
  } catch (cause: unknown) {
    return { status: 'invalid', message: cause instanceof Error ? cause.message : String(cause) };
  }
  if (
    artifact.profileVersion !== EXPECTED_CALIBRATION_PROFILE_VERSION ||
    artifact.harnessVersion !== EXPECTED_CALIBRATION_HARNESS_VERSION ||
    artifact.profileDigest !== EXPECTED_CALIBRATION_PROFILE_DIGEST ||
    artifact.referenceProfileVersion !== EXPECTED_REFERENCE_PROFILE_VERSION
  ) {
    return {
      status: 'stale',
      message: 'Calibration profile identity does not match this UI build. Run npm run play again.',
    };
  }
  if (artifact.subject.code !== set.code || artifact.subject.fingerprint !== set.fingerprint) {
    return {
      status: 'stale',
      message: 'Calibration does not match the exact staged set fingerprint. Run npm run play again.',
    };
  }
  return { status: 'ready', artifact };
}

export function classifyRetune(value: unknown | null, calibration: CalibrationArtifact): RetuneState {
  if (value === null) return { status: 'absent' };
  let artifact: RetuneArtifact;
  try {
    artifact = readRetuneArtifact(value);
  } catch (cause: unknown) {
    return { status: 'invalid', message: cause instanceof Error ? cause.message : String(cause) };
  }
  if (
    artifact.profileVersion !== calibration.profileVersion ||
    artifact.profileDigest !== calibration.profileDigest ||
    artifact.setCode !== calibration.subject.code ||
    artifact.baseline.fingerprint !== calibration.subject.fingerprint
  ) {
    return {
      status: 'stale',
      message: 'The proposal does not match the staged set fingerprint and calibration profile.',
    };
  }
  return artifact.evidence.kind === 'none' ||
    artifact.evidence.measurementStatus === 'under-sampled' ||
    artifact.evidence.gateStatus === 'under-sampled' ||
    artifact.evidence.uncertaintyStatus === 'under-sampled'
    ? { status: 'underSampled', artifact }
    : { status: 'ready', artifact };
}
