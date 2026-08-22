/**
 * Mechanical transform from Zod issues to typed violations.
 *
 * Schema failures are still violations with actionable codes — a generated
 * card with an off-vocabulary effect must report `UNKNOWN_EFFECT_KIND`, not a
 * generic parse error, so the set generator's retry loop can act on it.
 */
import type { Violation, ViolationCode } from '../violations';
import { formatPath, violation } from '../violations';

export interface SchemaIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

function codeForPath(segments: ReadonlyArray<PropertyKey>): ViolationCode {
  const parts = segments.map((segment) => String(segment));
  const last = parts[parts.length - 1];
  if (last === 'kind') {
    if (parts.includes('target')) return 'UNKNOWN_TARGET_KIND';
    if (parts.includes('effects')) return 'UNKNOWN_EFFECT_KIND';
    if (parts.length === 1) return 'UNKNOWN_CARD_KIND';
  }
  // `distinct` only accepts `true`, so the one way to fail it is `false` — the
  // redundant spelling of an absent flag. It belongs with the other things
  // wrong with the flag rather than under a generic parse code, so the
  // generator's retry loop and the set-validation report read one code for all
  // of them.
  if (last === 'distinct' && parts.includes('target')) return 'ILLEGAL_DISTINCT_TARGET';
  if (parts.includes('keywords')) return 'UNKNOWN_KEYWORD';
  if (parts.includes('colors')) return 'UNKNOWN_COLOR';
  if (parts[0] === 'rarity') return 'UNKNOWN_RARITY';
  if (parts[0] === 'manaCost') return 'MALFORMED_MANA_COST';
  return 'SCHEMA_INVALID';
}

/** Converts a Zod issue list into violations, preserving order. */
export function schemaIssuesToViolations(issues: readonly SchemaIssue[]): Violation[] {
  return issues.map((issue) => violation(codeForPath(issue.path), formatPath(issue.path), issue.message));
}
