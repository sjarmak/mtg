/**
 * Mechanical color-pie lookup and the pass/warn/fail gate built on it.
 *
 * Policy (prior-art set-design section 10, check 4): primary or secondary
 * passes, tertiary warns against a per-set budget, off-pie fails unless a
 * design note declares a deliberate bend. Breaks are never auto-approved.
 */
import type { Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { Citation, CitationConfidence, Source } from './citations';
import type {
  ColorPieDocument,
  ColorPieRow,
  ColorPieSubject,
  ColorPieSubjectKind,
  PieLevel,
  PieVerdict,
} from './color-pie-schema';
import {
  COLOR_PIE_SUBJECTS,
  ColorPieDocumentSchema,
  PIE_LEVEL_VERDICT,
  PIE_LEVELS,
} from './color-pie-schema';
import { loadCanon } from './load';

export const COLOR_PIE_2021: ColorPieDocument = loadCanon('color-pie-2021.json', ColorPieDocumentSchema);

export interface ColorPieClassification {
  readonly subject: ColorPieSubject;
  readonly subjectKind: ColorPieSubjectKind;
  readonly color: Color;
  readonly level: PieLevel;
  readonly verdict: PieVerdict;
  readonly confidence: CitationConfidence;
  readonly canonEntry: string;
  readonly sourceUrl: string;
  readonly quote: string;
  readonly note?: string;
}

function rowIndex(doc: ColorPieDocument): ReadonlyMap<ColorPieSubject, ColorPieRow> {
  return new Map(doc.rows.map((row) => [row.subject, row]));
}

const DEFAULT_INDEX = rowIndex(COLOR_PIE_2021);

function indexFor(doc: ColorPieDocument): ReadonlyMap<ColorPieSubject, ColorPieRow> {
  return doc === COLOR_PIE_2021 ? DEFAULT_INDEX : rowIndex(doc);
}

/**
 * The table row for a subject. The schema guarantees one row per pinned
 * vocabulary entry, so a miss here means the caller bypassed validation.
 */
export function colorPieRow(subject: ColorPieSubject, doc: ColorPieDocument = COLOR_PIE_2021): ColorPieRow {
  const row = indexFor(doc).get(subject);
  if (row === undefined) {
    throw new Error(`colorPieRow: no row for subject "${subject}" in table "${doc.table}"`);
  }
  return row;
}

export function levelFor(
  subject: ColorPieSubject,
  color: Color,
  doc: ColorPieDocument = COLOR_PIE_2021,
): PieLevel {
  return colorPieRow(subject, doc).levels[color];
}

export function verdictForLevel(level: PieLevel): PieVerdict {
  return PIE_LEVEL_VERDICT[level];
}

/** Full ruling for one (subject, color) pair, carrying its own provenance. */
export function classify(
  subject: ColorPieSubject,
  color: Color,
  doc: ColorPieDocument = COLOR_PIE_2021,
): ColorPieClassification {
  const row = colorPieRow(subject, doc);
  const level = row.levels[color];
  const source: Source | undefined = doc.sources[row.source];
  return {
    subject: row.subject,
    subjectKind: row.subjectKind,
    color,
    level,
    verdict: PIE_LEVEL_VERDICT[level],
    confidence: row.confidence,
    canonEntry: row.canonEntry,
    sourceUrl: source?.url ?? '',
    quote: row.quote,
    ...(row.note === undefined ? {} : { note: row.note }),
  };
}

/** Classifies a subject against several colors, e.g. a card's color identity. */
export function classifyForColors(
  subject: ColorPieSubject,
  colors: readonly Color[],
  doc: ColorPieDocument = COLOR_PIE_2021,
): ColorPieClassification[] {
  return colors.map((color) => classify(subject, color, doc));
}

/**
 * The single verdict for a subject printed on a card of several colors: the
 * best available placement wins, because a card is on-pie if any of its colors
 * legitimately carries the ability. A colorless card has no color to justify
 * an ability, so it fails.
 */
export function bestVerdict(classifications: readonly ColorPieClassification[]): PieVerdict {
  const rank: Readonly<Record<PieVerdict, number>> = { pass: 0, warn: 1, fail: 2 };
  return classifications.reduce<PieVerdict>(
    (best, item) => (rank[item.verdict] < rank[best] ? item.verdict : best),
    'fail',
  );
}

export function colorsAtLevel(
  subject: ColorPieSubject,
  level: PieLevel,
  doc: ColorPieDocument = COLOR_PIE_2021,
): Color[] {
  const row = colorPieRow(subject, doc);
  return COLORS.filter((color) => row.levels[color] === level);
}

export function subjectsForColor(
  color: Color,
  level: PieLevel,
  doc: ColorPieDocument = COLOR_PIE_2021,
): ColorPieSubject[] {
  return doc.rows.filter((row) => row.levels[color] === level).map((row) => row.subject);
}

/** Subjects whose classification we could not source directly. */
export function inferredSubjects(doc: ColorPieDocument = COLOR_PIE_2021): ColorPieSubject[] {
  return doc.rows.filter((row) => row.confidence === 'inferred').map((row) => row.subject);
}

/** The citations table: one entry per subject, mapping it to its source line. */
export function colorPieCitations(doc: ColorPieDocument = COLOR_PIE_2021): Record<string, Citation> {
  const entries = doc.rows.map<[string, Citation]>((row) => [
    row.subject,
    {
      source: row.source,
      crossCheck: [],
      confidence: row.confidence,
      quote: row.quote,
      ...(row.note === undefined ? {} : { note: row.note }),
    },
  ]);
  return Object.fromEntries(entries);
}

/** Pinned vocabulary entries with no row, and rows missing a color. */
export function missingCoverage(doc: ColorPieDocument = COLOR_PIE_2021): string[] {
  const present = new Set(doc.rows.map((row) => row.subject));
  const missingRows = COLOR_PIE_SUBJECTS.filter((subject) => !present.has(subject)).map(
    (subject) => `missing row: ${subject}`,
  );
  const levelSet: ReadonlySet<string> = new Set<string>(PIE_LEVELS);
  const missingCells = doc.rows.flatMap((row) =>
    COLORS.filter((color) => !levelSet.has(row.levels[color])).map(
      (color) => `missing level: ${row.subject}/${color}`,
    ),
  );
  return [...missingRows, ...missingCells];
}
