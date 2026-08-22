/**
 * Citation plumbing shared by every canon data file in this package.
 *
 * The rule this module exists to enforce: no number ships as design canon
 * without a source and the line it was read from. A citation table maps a
 * dotted path into the data to the source that justifies it; a citation on an
 * ancestor path covers every number beneath it (one quote can legitimately
 * carry a whole table of slots).
 */
import { z } from 'zod';

export const SOURCE_KINDS = ['first-party', 'community'] as const;
export const SourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SourceSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  year: z.int().min(1993),
  kind: SourceKindSchema,
});
export type Source = z.infer<typeof SourceSchema>;

/**
 * `sourced` — read directly off a first-party article, quote verified.
 * `community` — read off a community codification of a first-party claim.
 * `inferred` — our own reading; the quote supports it but does not state it.
 */
export const CITATION_CONFIDENCES = ['sourced', 'community', 'inferred'] as const;
export const CitationConfidenceSchema = z.enum(CITATION_CONFIDENCES);
export type CitationConfidence = (typeof CITATION_CONFIDENCES)[number];

export const CitationSchema = z.object({
  /** Key into the document's `sources` table. */
  source: z.string().min(1),
  /** Further source keys that independently agree with the same number. */
  crossCheck: z.array(z.string().min(1)).default([]),
  confidence: CitationConfidenceSchema,
  /** The line the number was read from. Short excerpt, kept for auditability. */
  quote: z.string().min(1),
  note: z.string().min(1).optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const IsoDateSchema = z.string().regex(ISO_DATE_PATTERN, 'expected an ISO date (YYYY-MM-DD)');

/** Fields every canon document in this package carries. */
export const CitedDocumentHeaderSchema = z.object({
  version: z.int().min(1),
  verifiedOn: IsoDateSchema,
  rights: z.string().min(1),
  sources: z.record(z.string().min(1), SourceSchema),
});

/** Collects the dotted path of every numeric leaf, in document order. */
export function numericPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'number') return [prefix];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numericPaths(item, `${prefix}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      numericPaths(item, prefix.length === 0 ? key : `${prefix}.${key}`),
    );
  }
  return [];
}

/** True when a citation registered at `key` covers `path` (exact or ancestor). */
export function coversPath(key: string, path: string): boolean {
  return path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`);
}

/** Numeric leaves with no citation at their own path or any ancestor path. */
export function uncitedNumericPaths(data: unknown, citations: Readonly<Record<string, Citation>>): string[] {
  const keys = Object.keys(citations);
  return numericPaths(data).filter((path) => !keys.some((key) => coversPath(key, path)));
}

/** Resolves a dotted citation key against the data, or `undefined` if absent. */
export function resolvePath(data: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, segment) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Record<string, unknown>)[segment];
  }, data);
}

/** Citation keys that no longer point at anything — stale after a data edit. */
export function danglingCitationKeys(data: unknown, citations: Readonly<Record<string, Citation>>): string[] {
  return Object.keys(citations).filter((key) => resolvePath(data, key) === undefined);
}

/** Citation entries naming a source id the document's source table lacks. */
export function unknownCitationSources(
  citations: Readonly<Record<string, Citation>>,
  sources: Readonly<Record<string, Source>>,
): string[] {
  const known = new Set(Object.keys(sources));
  return Object.entries(citations).flatMap(([key, citation]) => {
    const missing = [citation.source, ...citation.crossCheck].filter((id) => !known.has(id));
    return missing.map((id) => `${key} -> ${id}`);
  });
}

/** Finds the citation covering a data path, preferring the most specific key. */
export function citationForPath(
  citations: Readonly<Record<string, Citation>>,
  path: string,
): Citation | undefined {
  const match = Object.keys(citations)
    .filter((key) => coversPath(key, path))
    .sort((a, b) => b.length - a.length)[0];
  return match === undefined ? undefined : citations[match];
}
