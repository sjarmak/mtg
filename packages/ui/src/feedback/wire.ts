/**
 * What a filed UI/UX report is, on the wire and on disk.
 *
 * `mtg-fvuyq`. One shape, read by both ends: the panel (`FeedbackOverlay.ts`)
 * composes it and `../../tools/feedback/server.ts` checks it with the schema
 * before writing a byte. The schema is the boundary: a body the browser did not
 * send, or sent malformed, is refused by name rather than written into
 * `data/feedback/` as a report nobody can read.
 *
 * The context half (`FeedbackContext`) is what the page can state about itself
 * without being asked — where it was, how big it was, what it was showing —
 * and `gather.ts` is the one function that fills it. The subject is the
 * position under the report: a kernel game is its config plus its choice list,
 * which is the entire game (`@mtg/kernel`'s `session.ts` argues why), so an
 * agent can reopen the exact board the report was written over. An observed
 * table promises nothing of the kind and carries its projection instead.
 */
import { z } from 'zod';

/** Half a megabyte of prose is a novel, not a report. */
export const MAX_TEXT_CHARS = 20_000;

/** A retina CleanShot of a whole lab window, base64: ~5 MB raw is generous. */
export const MAX_IMAGE_BASE64_CHARS = 12 * 1024 * 1024;

export const FEEDBACK_PRIORITIES = ['P1', 'P2', 'P3'] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

const Text = z.string().max(MAX_TEXT_CHARS);

export const PointedElementSchema = z.object({
  /** `main > div.mtg-live > section.mtg-hand > button.mtg-card`, outermost first. */
  path: z.string().max(2000),
  /** The nearest ancestor that names a surface (`data-mtg-*` or a `mtg-` class). */
  surface: z.string().max(200).nullable(),
  /** The element's own text, trimmed and cut, so a report says "the End turn button". */
  text: z.string().max(200),
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type PointedElement = z.infer<typeof PointedElementSchema>;

export const KernelGameSubjectSchema = z.object({
  kind: z.literal('kernel-game'),
  /** `PlayConfig`, as the play route holds it; JSON already, since the recorder sends it. */
  config: z.unknown(),
  choices: z.array(z.unknown()).readonly(),
  /** Which beat the board was on when the report was written. */
  beat: z.unknown(),
  finished: z.boolean(),
});
export type KernelGameSubject = z.infer<typeof KernelGameSubjectSchema>;

export const ObservedTableSubjectSchema = z.object({
  kind: z.literal('observed-table'),
  token: z.string().max(200),
  revision: z.number().int().nonnegative(),
  view: z.unknown(),
});
export type ObservedTableSubject = z.infer<typeof ObservedTableSubjectSchema>;

export const FeedbackSubjectSchema = z.discriminatedUnion('kind', [
  KernelGameSubjectSchema,
  ObservedTableSubjectSchema,
]);
export type FeedbackSubject = z.infer<typeof FeedbackSubjectSchema>;

export const FeedbackContextSchema = z.object({
  capturedAt: z.string(),
  hash: z.string().max(2000),
  href: z.string().max(4000),
  title: z.string().max(500),
  viewport: z.object({ width: z.number(), height: z.number(), devicePixelRatio: z.number() }),
  userAgent: z.string().max(1000),
  /** Every `mtg.*` preference the page keeps, by key, as stored. */
  preferences: z.record(z.string(), z.string()),
  subject: FeedbackSubjectSchema.nullable(),
});
export type FeedbackContext = z.infer<typeof FeedbackContextSchema>;

export const PastedImageSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  base64: z.string().max(MAX_IMAGE_BASE64_CHARS),
});
export type PastedImage = z.infer<typeof PastedImageSchema>;

/**
 * What the optional model round wrote for the bead (`mtg-fvuyq.6`). `question`
 * is the one clarifying question it may ask; `answer` is what the reporter
 * typed back, appended at filing rather than sent for a second round.
 */
export const BeadDraftSchema = z.object({
  title: z.string().min(1).max(200),
  /** The fix where the report states one; otherwise the problem, restated. */
  description: Text.min(1),
  acceptance: z.array(z.string().min(1).max(2000)).min(1).max(12),
  question: z.string().max(500).nullable(),
});
export type BeadDraft = z.infer<typeof BeadDraftSchema>;

export const FiledDraftSchema = BeadDraftSchema.extend({ answer: Text });
export type FiledDraft = z.infer<typeof FiledDraftSchema>;

export const FeedbackReportSchema = z.object({
  title: z.string().min(1).max(200),
  /** What is wrong, in the reporter's words. */
  description: Text.min(1),
  /** What should happen instead; the bead's fix is written from this. */
  desired: Text,
  priority: z.enum(FEEDBACK_PRIORITIES),
  /** Ticked when the report is a choice for the playtester rather than a fix for an agent. */
  designQuestion: z.boolean(),
  element: PointedElementSchema.nullable(),
  image: PastedImageSchema.nullable(),
  context: FeedbackContextSchema,
  /** Present only when the model round ran and the reporter kept its draft. */
  draft: FiledDraftSchema.nullable().optional(),
});
export type FeedbackReport = z.infer<typeof FeedbackReportSchema>;

/** The extension a pasted image is written under, by its MIME type. */
export function imageExtension(mime: PastedImage['mime']): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
  }
}
