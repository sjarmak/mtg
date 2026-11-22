import type { CubeFinding } from './validate';
import type { Claim, ClaimLimit, FormatClaims } from './claims';

/**
 * The claims block as the Analysis document carries it.
 *
 * `@mtg/ui` declares this shape in `src/routes/analysis/model.ts` and validates
 * it in `read.ts`, and neither package imports the other: this one reaches
 * `@mtg/decklab` and therefore `better-sqlite3`, which cannot enter a browser
 * bundle. So the two ends agree through JSON, and the only difference from
 * `FormatClaims` is that the nested `limits` object is flattened — a document
 * field is read by a path, and one fewer level is one fewer place to disagree.
 */
export interface AnalysisClaimsBlock {
  readonly claims: readonly Claim[];
  readonly unclaimed: readonly CubeFinding[];
  readonly reported: readonly CubeFinding[];
  readonly limitsKind: string;
  readonly limits: readonly ClaimLimit[];
  readonly draftProvenance: FormatClaims['draftProvenance'];
  readonly ok: boolean;
}

export function analysisClaimsBlock(claims: FormatClaims): AnalysisClaimsBlock {
  return {
    claims: claims.claims,
    unclaimed: claims.unclaimed,
    reported: claims.reported,
    limitsKind: claims.limits.kind,
    limits: claims.limits.limits,
    draftProvenance: claims.draftProvenance,
    ok: claims.ok,
  };
}
