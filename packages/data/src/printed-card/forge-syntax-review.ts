/**
 * Format-neutral review of Forge script syntax tokens, keyed by the reviewed Forge jar.
 *
 * A token is reviewed once, for the whole installed library, and every printed
 * format reads the same table. The pinned Legacy Cube table is its oldest
 * layer and stays checksum-pinned on its own; this table is the union that
 * grows, and `forge-syntax-review.test.ts` refuses a union that drops or
 * rewrites a pinned entry.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import { LegacyCubeDecisionFamilySchema } from '../legacy-cube/decision-ledger';

export const FORGE_SYNTAX_REVIEW_PATH = fileURLToPath(
  new URL('../../data/forge-syntax-review-v1.json', import.meta.url),
);

export const ForgeSyntaxReviewEntrySchema = z.strictObject({
  kind: z.enum(['line-kind', 'ability-api', 'parameter-key', 'keyword', 'semantic-marker']),
  token: z.string().min(1),
  disposition: z.enum(['mapped', 'non-choice']),
  families: z.array(LegacyCubeDecisionFamilySchema),
  evidence: z.string().min(1),
});
export type ForgeSyntaxReviewEntry = z.infer<typeof ForgeSyntaxReviewEntrySchema>;

export const ForgeSyntaxReviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  classifierVersion: z.literal('forge-script-controller-family-v1'),
  forge: z.strictObject({
    version: z.string().min(1),
    jarSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  entries: z.array(ForgeSyntaxReviewEntrySchema).min(1),
});
export type ForgeSyntaxReview = z.infer<typeof ForgeSyntaxReviewSchema>;

/** The `kind:token` key every closure and classification step joins on. */
export const forgeSyntaxKey = (entry: { readonly kind: string; readonly token: string }): string =>
  `${entry.kind}:${entry.token}`;

/** Validates a review table: unique keys, and a disposition that agrees with its families. */
export function parseForgeSyntaxReview(value: unknown): ForgeSyntaxReview {
  const parsed = ForgeSyntaxReviewSchema.safeParse(value);
  if (!parsed.success) throw new InvalidInputError('Forge syntax review', parsed.error.message);
  const seen = new Set<string>();
  for (const entry of parsed.data.entries) {
    const key = forgeSyntaxKey(entry);
    if (seen.has(key)) throw new InvalidInputError('Forge syntax review', `duplicate reviewed token: ${key}`);
    seen.add(key);
    const mismatch =
      (entry.disposition === 'mapped' && entry.families.length === 0) ||
      (entry.disposition === 'non-choice' && entry.families.length > 0);
    if (mismatch) {
      throw new InvalidInputError('Forge syntax review', `invalid affirmative syntax disposition for ${key}`);
    }
  }
  return parsed.data;
}

export function loadForgeSyntaxReview(path: string = FORGE_SYNTAX_REVIEW_PATH): ForgeSyntaxReview {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'Forge syntax review',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  return parseForgeSyntaxReview(value);
}
