/**
 * Strict boundary between pinned printing data and measured executable cards.
 *
 * This module assembles no rules text and makes no semantic repair. A card
 * crosses the seam only when one current coverage row names the exact source
 * collector position, admits no approximation, and carries evidence that the
 * kernel reached it. The resulting artifact is coverage-checked; calling a set
 * playable remains a later whole-format acceptance decision.
 *
 * The per-position machinery below is exported because `partial.ts` builds the
 * reduced artifact out of the same pieces, and applies `exactCard` unchanged to
 * every position it keeps. That is what makes the two builders one standard
 * rather than two: the reduced set holds exactly the cards this builder would
 * have held, and differs only in refusing to throw away the ones it can.
 */
import { createHash } from 'node:crypto';
import { CardSchema, safeParseCard, type Card } from '@mtg/dsl';
import { z } from 'zod';
import {
  ReferenceCardSchema,
  ReferenceCorpusSchema,
  ReferenceSetSchema,
  type ReferenceCard,
  type ReferenceCorpus,
  type ReferenceSet,
} from './schemas';

const NonemptyString = z.string().min(1);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Must track the evidence contract emitted by `@mtg/dsl-coverage`. */
export const EXECUTABLE_COVERAGE_INSTRUMENT_VERSION = 3 as const;
export const EXECUTABLE_REFERENCE_SCHEMA_VERSION = 1 as const;

export const ExecutableCoverageOutcomeSchema = z.enum([
  'covered',
  'approximated',
  'untranslatable',
  'invalidAnswer',
  'invalidDsl',
  'kernelThrew',
  'unreached',
  'callFailed',
]);
export type ExecutableCoverageOutcome = z.infer<typeof ExecutableCoverageOutcomeSchema>;

export const ExecutableCoverageRowSchema = z.object({
  instrumentVersion: z.literal(EXECUTABLE_COVERAGE_INSTRUMENT_VERSION),
  setCode: NonemptyString,
  collectorNumber: z.number().int().positive(),
  sourceFingerprint: Sha256Schema,
  translationSourceFingerprint: Sha256Schema,
  oracleId: NonemptyString,
  outcome: ExecutableCoverageOutcomeSchema,
  approximations: z.array(NonemptyString),
  problems: z.array(NonemptyString),
  evidence: z.array(NonemptyString),
  card: CardSchema.nullable(),
});
export type ExecutableCoverageRow = z.infer<typeof ExecutableCoverageRowSchema>;

export const ExecutableCoverageEvidenceSchema = z.object({
  schemaVersion: z.literal(EXECUTABLE_REFERENCE_SCHEMA_VERSION),
  instrumentVersion: z.literal(EXECUTABLE_COVERAGE_INSTRUMENT_VERSION),
  corpus: z.object({
    schemaVersion: z.literal(1),
    provider: z.literal('MTGJSON'),
    version: NonemptyString,
    builtDate: NonemptyString,
  }),
  set: z.object({ code: NonemptyString, sourceSha256: Sha256Schema }),
  rows: z.array(ExecutableCoverageRowSchema).min(1),
});
export type ExecutableCoverageEvidence = z.infer<typeof ExecutableCoverageEvidenceSchema>;

export const ExecutableReferenceSetSchema = z.object({
  schemaVersion: z.literal(EXECUTABLE_REFERENCE_SCHEMA_VERSION),
  kind: z.literal('coverage-checked-reference-set'),
  coverage: ExecutableCoverageEvidenceSchema,
  sourceSet: ReferenceSetSchema,
  cards: z.array(CardSchema).min(1),
});
export type ExecutableReferenceSet = z.infer<typeof ExecutableReferenceSetSchema>;

export type ExecutableReferenceErrorCode =
  | 'INVALID_CORPUS'
  | 'INVALID_EVIDENCE'
  | 'STALE_CORPUS'
  | 'STALE_SET'
  | 'INVALID_MEMBERSHIP'
  | 'DUPLICATE_POSITION'
  | 'MISSING_POSITION'
  | 'STALE_POSITION'
  | 'STALE_ORACLE'
  | 'NONEXACT_OUTCOME'
  | 'APPROXIMATION'
  | 'UNPROBED'
  | 'INVALID_TRANSLATION'
  | 'STALE_TRANSLATION';

/** A machine-readable refusal with the exact collector position when known. */
export class ExecutableReferenceError extends Error {
  readonly collectorNumber: number | undefined;
  readonly outcome: ExecutableCoverageOutcome | undefined;

  constructor(
    readonly code: ExecutableReferenceErrorCode,
    detail: string,
    fields: {
      readonly collectorNumber?: number;
      readonly outcome?: ExecutableCoverageOutcome;
    } = {},
  ) {
    super(`Executable reference ${code}: ${detail}`);
    this.name = 'ExecutableReferenceError';
    this.collectorNumber = fields.collectorNumber;
    this.outcome = fields.outcome;
  }
}

/** Hashes the exact normalized face records in their corpus order. */
export function referencePositionFingerprint(faces: readonly ReferenceCard[]): string {
  const parsed = z.array(ReferenceCardSchema).min(1).parse(faces);
  return createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
}

export function parseCorpus(input: unknown): ReferenceCorpus {
  const parsed = ReferenceCorpusSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExecutableReferenceError('INVALID_CORPUS', parsed.error.message);
  }
  return parsed.data;
}

export function parseEvidence(input: unknown): ExecutableCoverageEvidence {
  const parsed = ExecutableCoverageEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExecutableReferenceError('INVALID_EVIDENCE', parsed.error.message);
  }
  return parsed.data;
}

export function assertCorpusIdentity(
  corpus: ReferenceCorpus,
  evidence: ExecutableCoverageEvidence,
): ReferenceSet {
  const expectedCorpus = {
    schemaVersion: corpus.schemaVersion,
    provider: corpus.source.provider,
    version: corpus.source.version,
    builtDate: corpus.source.builtDate,
  };
  if (JSON.stringify(evidence.corpus) !== JSON.stringify(expectedCorpus)) {
    throw new ExecutableReferenceError(
      'STALE_CORPUS',
      `evidence names ${JSON.stringify(evidence.corpus)}, expected ${JSON.stringify(expectedCorpus)}`,
    );
  }
  const set = corpus.sets.find((candidate) => candidate.code === evidence.set.code);
  if (set === undefined) {
    throw new ExecutableReferenceError('STALE_SET', `set ${evidence.set.code} is absent from the corpus`);
  }
  if (set.sourceSha256 !== evidence.set.sourceSha256) {
    throw new ExecutableReferenceError(
      'STALE_SET',
      `${set.code} evidence source is ${evidence.set.sourceSha256}, expected ${set.sourceSha256}`,
    );
  }
  return set;
}

function collectorNumber(card: ReferenceCard): number | null {
  if (!/^\d+$/.test(card.number)) return null;
  const number = Number.parseInt(card.number, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function mainSetPositions(set: ReferenceSet): ReadonlyMap<number, readonly ReferenceCard[]> {
  const positions = new Map<number, ReferenceCard[]>();
  for (const card of set.cards) {
    if (!card.roles.includes('main-set')) continue;
    const number = collectorNumber(card);
    if (number === null || number > set.mainSetSize) {
      throw new ExecutableReferenceError(
        'INVALID_MEMBERSHIP',
        `${set.code} main-set face ${card.uuid} has collector number ${card.number}`,
      );
    }
    const faces = positions.get(number) ?? [];
    faces.push(card);
    positions.set(number, faces);
  }
  for (let number = 1; number <= set.mainSetSize; number += 1) {
    if (!positions.has(number)) {
      throw new ExecutableReferenceError(
        'INVALID_MEMBERSHIP',
        `${set.code} source is missing main-set collector position ${number}`,
        { collectorNumber: number },
      );
    }
  }
  if (positions.size !== set.mainSetSize) {
    throw new ExecutableReferenceError(
      'INVALID_MEMBERSHIP',
      `${set.code} has ${positions.size} main-set positions, expected ${set.mainSetSize}`,
    );
  }
  return positions;
}

export function rowsByPosition(
  set: ReferenceSet,
  evidence: ExecutableCoverageEvidence,
): ReadonlyMap<number, ExecutableCoverageRow> {
  const rows = new Map<number, ExecutableCoverageRow>();
  for (const row of evidence.rows) {
    if (row.setCode !== set.code) {
      throw new ExecutableReferenceError(
        'STALE_POSITION',
        `collector position ${row.collectorNumber} names set ${row.setCode}, expected ${set.code}`,
        { collectorNumber: row.collectorNumber },
      );
    }
    if (rows.has(row.collectorNumber)) {
      throw new ExecutableReferenceError(
        'DUPLICATE_POSITION',
        `${set.code} collector position ${row.collectorNumber} has more than one row`,
        { collectorNumber: row.collectorNumber },
      );
    }
    rows.set(row.collectorNumber, row);
  }
  return rows;
}

function soleOracleId(faces: readonly ReferenceCard[], number: number): string {
  const oracleIds = new Set(
    faces
      .map((face) => face.identifiers['scryfallOracleId'])
      .filter((id): id is string => typeof id === 'string'),
  );
  if (oracleIds.size !== 1) {
    throw new ExecutableReferenceError(
      'INVALID_MEMBERSHIP',
      `collector position ${number} must have one shared Scryfall Oracle identity`,
      { collectorNumber: number },
    );
  }
  const oracleId = [...oracleIds][0];
  if (oracleId === undefined) throw new Error('single Oracle identity invariant failed');
  return oracleId;
}

function assertMeasuredIdentity(
  set: ReferenceSet,
  faces: readonly ReferenceCard[],
  row: ExecutableCoverageRow,
): void {
  const number = row.collectorNumber;
  if (row.sourceFingerprint !== referencePositionFingerprint(faces)) {
    throw new ExecutableReferenceError(
      'STALE_POSITION',
      `${set.code} collector position ${number} no longer matches the measured faces`,
      { collectorNumber: number },
    );
  }
  if (row.oracleId !== soleOracleId(faces, number)) {
    throw new ExecutableReferenceError(
      'STALE_ORACLE',
      `${set.code} collector position ${number} no longer matches Oracle identity ${row.oracleId}`,
      { collectorNumber: number },
    );
  }
}

function assertExactOutcome(set: ReferenceSet, row: ExecutableCoverageRow): void {
  const number = row.collectorNumber;
  if (row.outcome !== 'covered') {
    throw new ExecutableReferenceError(
      'NONEXACT_OUTCOME',
      `${set.code} collector position ${number} ended as ${row.outcome}`,
      { collectorNumber: number, outcome: row.outcome },
    );
  }
  if (row.approximations.length > 0) {
    throw new ExecutableReferenceError(
      'APPROXIMATION',
      `${set.code} collector position ${number} admits: ${row.approximations.join('; ')}`,
      { collectorNumber: number },
    );
  }
  if (row.evidence.length === 0) {
    throw new ExecutableReferenceError(
      'UNPROBED',
      `${set.code} collector position ${number} has no kernel reach evidence`,
      { collectorNumber: number },
    );
  }
  if (row.problems.length > 0) {
    throw new ExecutableReferenceError(
      'INVALID_TRANSLATION',
      `${set.code} collector position ${number} retained problems: ${row.problems.join('; ')}`,
      { collectorNumber: number },
    );
  }
  if (row.card === null) {
    throw new ExecutableReferenceError(
      'INVALID_TRANSLATION',
      `${set.code} collector position ${number} has no executable card`,
      { collectorNumber: number },
    );
  }
}

function bindSourceIdentity(
  set: ReferenceSet,
  faces: readonly ReferenceCard[],
  row: ExecutableCoverageRow,
): Card {
  const number = row.collectorNumber;
  if (row.card === null) throw new Error('executable card invariant failed');
  const sourceName = faces[0]?.name;
  if (sourceName === undefined) throw new Error('nonempty face invariant failed');
  if (row.card.name !== sourceName) {
    throw new ExecutableReferenceError(
      'STALE_TRANSLATION',
      `${set.code} collector position ${number} translated ${row.card.name}, expected ${sourceName}`,
      { collectorNumber: number },
    );
  }
  const rarities = new Set(faces.map((face) => face.rarity));
  if (rarities.size !== 1) {
    throw new ExecutableReferenceError(
      'INVALID_MEMBERSHIP',
      `${set.code} collector position ${number} has conflicting face rarities`,
      { collectorNumber: number },
    );
  }
  const rarity = [...rarities][0];
  if (rarity === undefined) throw new Error('single rarity invariant failed');
  const rebound = safeParseCard({
    ...row.card,
    id: `${set.code.toLowerCase()}-${number}`,
    name: sourceName,
    rarity,
    set: { code: set.code, collectorNumber: number },
  });
  if (!rebound.ok) {
    const problems = rebound.violations.map((violation) => violation.message).join('; ');
    throw new ExecutableReferenceError(
      'INVALID_TRANSLATION',
      `${set.code} collector position ${number} is invalid after identity binding: ${problems}`,
      { collectorNumber: number },
    );
  }
  return rebound.card;
}

/**
 * The whole standard, in one call: current against the source, exact in
 * outcome, unapproximated, kernel-reached, and re-bound to the printed
 * identity. It throws an `ExecutableReferenceError` naming the position, which
 * is both this builder's refusal and the reduced builder's drop reason.
 */
export function exactCard(
  set: ReferenceSet,
  faces: readonly ReferenceCard[],
  row: ExecutableCoverageRow,
): Card {
  assertMeasuredIdentity(set, faces, row);
  assertExactOutcome(set, row);
  return bindSourceIdentity(set, faces, row);
}

/**
 * Builds a full main-set artifact. Every original main collector position must
 * have exactly one current, exact, kernel-reached evidence row.
 */
export function buildExecutableReferenceSet(
  corpusInput: unknown,
  evidenceInput: unknown,
): ExecutableReferenceSet {
  const corpus = parseCorpus(corpusInput);
  const evidence = parseEvidence(evidenceInput);
  const set = assertCorpusIdentity(corpus, evidence);
  const positions = mainSetPositions(set);
  const rows = rowsByPosition(set, evidence);
  const cards: Card[] = [];
  for (let number = 1; number <= set.mainSetSize; number += 1) {
    const faces = positions.get(number);
    if (faces === undefined) throw new Error('complete membership invariant failed');
    const row = rows.get(number);
    if (row === undefined) {
      throw new ExecutableReferenceError(
        'MISSING_POSITION',
        `${set.code} collector position ${number} has no coverage row`,
        { collectorNumber: number },
      );
    }
    cards.push(exactCard(set, faces, row));
  }
  if (rows.size !== set.mainSetSize) {
    const unexpected = [...rows.keys()].find((number) => !positions.has(number));
    throw new ExecutableReferenceError(
      'STALE_POSITION',
      `${set.code} evidence includes unexpected collector position ${String(unexpected)}`,
      unexpected === undefined ? {} : { collectorNumber: unexpected },
    );
  }
  return ExecutableReferenceSetSchema.parse({
    schemaVersion: EXECUTABLE_REFERENCE_SCHEMA_VERSION,
    kind: 'coverage-checked-reference-set',
    coverage: evidence,
    sourceSet: set,
    cards,
  });
}
