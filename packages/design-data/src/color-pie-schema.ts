/**
 * Zod schemas for the mechanical color-pie table.
 *
 * The table is keyed by the pinned slice vocabulary, so the schema pins it too:
 * a row whose subject is not a slice keyword or effect kind, or whose subject
 * kind disagrees with which list it came from, fails at load.
 */
import { z } from 'zod';
import { EFFECT_KINDS, KEYWORDS } from '@mtg/dsl';
import { CitationConfidenceSchema, CitedDocumentHeaderSchema } from './citations';

export const PIE_LEVELS = ['primary', 'secondary', 'tertiary', 'offPie'] as const;
export const PieLevelSchema = z.enum(PIE_LEVELS);
export type PieLevel = (typeof PIE_LEVELS)[number];

/** Pass/warn/fail policy. Tertiary is budgeted, off-pie is a design error. */
export const PIE_VERDICTS = ['pass', 'warn', 'fail'] as const;
export type PieVerdict = (typeof PIE_VERDICTS)[number];

export const PIE_LEVEL_VERDICT: Readonly<Record<PieLevel, PieVerdict>> = {
  primary: 'pass',
  secondary: 'pass',
  tertiary: 'warn',
  offPie: 'fail',
};

export const COLOR_PIE_SUBJECTS = [...KEYWORDS, ...EFFECT_KINDS] as const;
export type ColorPieSubject = (typeof COLOR_PIE_SUBJECTS)[number];
export const ColorPieSubjectSchema = z.enum(COLOR_PIE_SUBJECTS);

export const SUBJECT_KINDS = ['keyword', 'effect'] as const;
export type ColorPieSubjectKind = (typeof SUBJECT_KINDS)[number];

const keywordSet: ReadonlySet<string> = new Set<string>(KEYWORDS);
const effectSet: ReadonlySet<string> = new Set<string>(EFFECT_KINDS);
const subjectSet: ReadonlySet<string> = new Set<string>(COLOR_PIE_SUBJECTS);

export function isColorPieSubject(name: string): name is ColorPieSubject {
  return subjectSet.has(name);
}

export function subjectKindOf(subject: ColorPieSubject): ColorPieSubjectKind {
  return keywordSet.has(subject) ? 'keyword' : 'effect';
}

export const ColorPieRowSchema = z
  .object({
    subject: ColorPieSubjectSchema,
    subjectKind: z.enum(SUBJECT_KINDS),
    /** How the source names the ability; the slice subject may be coarser. */
    canonEntry: z.string().min(1),
    levels: z.object({
      W: PieLevelSchema,
      U: PieLevelSchema,
      B: PieLevelSchema,
      R: PieLevelSchema,
      G: PieLevelSchema,
    }),
    confidence: CitationConfidenceSchema,
    source: z.string().min(1),
    quote: z.string().min(1),
    note: z.string().min(1).optional(),
  })
  .refine(
    (row) => (row.subjectKind === 'keyword' ? keywordSet.has(row.subject) : effectSet.has(row.subject)),
    { message: 'subjectKind must match the vocabulary list the subject came from' },
  )
  .refine((row) => row.confidence !== 'inferred' || (row.note ?? '').length > 0, {
    message: 'an inferred row must carry a note explaining the reasoning',
  });

export type ColorPieRow = z.infer<typeof ColorPieRowSchema>;

export const ColorPieDocumentSchema = CitedDocumentHeaderSchema.extend({
  table: z.string().min(1),
  conventions: z.array(z.string().min(1)).min(1),
  rows: z.array(ColorPieRowSchema).min(1),
})
  .refine((doc) => new Set(doc.rows.map((row) => row.subject)).size === doc.rows.length, {
    message: 'each subject may appear at most once',
  })
  .refine((doc) => COLOR_PIE_SUBJECTS.every((subject) => doc.rows.some((row) => row.subject === subject)), {
    message: 'every pinned vocabulary subject needs a row',
  })
  .refine((doc) => doc.rows.every((row) => doc.sources[row.source] !== undefined), {
    message: 'every row must name a source present in the sources table',
  });

export type ColorPieDocument = z.infer<typeof ColorPieDocumentSchema>;
