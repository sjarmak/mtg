/**
 * Set-level findings: what deterministic validation says about a generated set.
 *
 * A finding is not a `Violation` — `@mtg/dsl` violations are about one card's
 * legality, findings are about the set as a design artifact (conformance to the
 * skeleton, color-pie placement, complexity budget, duplication). Every finding
 * names the slots it blames, because that list is exactly what the regeneration
 * loop retries: failures never trigger a whole-set redo.
 *
 * Most codes here are raised by the deterministic validators in this directory.
 * Two are not: the `AUTHORED_*` pair comes from `authored.ts`, and
 * `CRITIQUE_UNRESOLVED` comes from `report.ts`, which lands the design
 * reviewer's unmet asks here so that everything reading findings reads them too.
 * Both arrive after validation, so neither can enter the retry loop.
 */

export const FINDING_CODES = [
  // Per-slot conformance.
  'SLOT_UNFILLED',
  'CARD_INVALID',
  'SLOT_KIND_MISMATCH',
  'SLOT_COLOR_MISMATCH',
  'SLOT_MANA_VALUE_MISS',
  'SLOT_EFFECT_NOT_ALLOWED',
  'SLOT_ABILITY_NOT_ALLOWED',
  'SLOT_AURA_MISMATCH',
  'SLOT_TRIGGER_MISMATCH',
  'SLOT_PART_MISSING',
  'SLOT_SACRIFICE_MISMATCH',
  'SLOT_SUPPLY_MISSING',
  'SLOT_UNFILLABLE',
  'SLOT_ROLE_UNFILLABLE',
  'OFF_PIE',
  // Set-level composition.
  'TERTIARY_OVER_BUDGET',
  'NWO_MULTI_RED_FLAG',
  'NWO_BUDGET_EXCEEDED',
  'CURVE_MISMATCH',
  'CREATURE_SHARE_BAND',
  'RARITY_DISTRIBUTION',
  'DUPLICATE_NAME',
  'DUPLICATE_IDENTITY',
  'DUPLICATE_MECHANICS',
  // One printed effect on several cards (`reprint.ts`).
  'FUNCTIONAL_REPRINT_SPREAD',
  'FUNCTIONAL_REPRINT_GLUT',
  // A subject printed in a color the set's own signature declares absent
  // (`signature.ts`). Narrower than `OFF_PIE`, and stated by the brief.
  'OFF_SIGNATURE',
  'DUPLICATE_TOKEN_NAME',
  'BOMB_TEMPLATE_REPEATED',
  'TEMPLATE_OVER_CYCLE',
  'BLANK_CARD',
  'RATE_ABOVE_CURVE',
  'STAT_BELOW_FLOOR',
  'MECHANIC_ABSENT_AT_COMMON',
  'MECHANIC_UNPLACEABLE',
  'MECHANIC_PARTLY_PRINTED',
  'MECHANIC_UNPRINTED',
  'MECHANIC_KEYWORD_UNPRINTED',
  'REQUIRED_CARD_MISSING',
  'STATED_ROLE_UNPRINTED',
  'SACRIFICE_SUBTYPE_UNSUPPLIED',
  'TOKEN_MINTED_UNSPENT',
  // Cards the brief handed the pipeline finished (`authored.ts`).
  'AUTHORED_CARD_INVALID',
  'AUTHORED_CARD_COLLIDES',
  // The design critique's asks that the set does not carry (`report.ts`).
  'CRITIQUE_UNRESOLVED',
  // Per-color-pair archetype viability.
  'ARCHETYPE_UNDERSIZED',
  'ARCHETYPE_UNDIFFERENTIATED',
  'ARCHETYPE_THIN',
  'ARCHETYPE_NO_BODIES',
  'ARCHETYPE_NO_ANSWERS',
  'ARCHETYPE_THIN_ANSWERS',
  'ARCHETYPE_INERT_GLUT',
  'ARCHETYPE_NO_SIGNPOST',
  'ARCHETYPE_SIGNPOST_SHARED',
  'ARCHETYPE_SIGNPOST_OFF_PLAN',
  'ARCHETYPE_CURVE_HOLE',
  'ARCHETYPE_CURVE_GAP',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/** `error` blocks the set and drives regeneration; `warning` is reported only. */
export type FindingSeverity = 'error' | 'warning';

export interface SetFinding {
  readonly code: FindingCode;
  readonly severity: FindingSeverity;
  readonly message: string;
  /** Slots to regenerate to clear this finding; may be empty for whole-set facts. */
  readonly slotIds: readonly string[];
}

export function finding(
  code: FindingCode,
  severity: FindingSeverity,
  message: string,
  slotIds: readonly string[] = [],
): SetFinding {
  return { code, severity, message, slotIds };
}

export function errors(findings: readonly SetFinding[]): SetFinding[] {
  return findings.filter((item) => item.severity === 'error');
}

export function warnings(findings: readonly SetFinding[]): SetFinding[] {
  return findings.filter((item) => item.severity === 'warning');
}

/** Slots named by at least one error, in first-seen order. */
export function failingSlotIds(findings: readonly SetFinding[]): string[] {
  const seen = new Set<string>();
  for (const item of errors(findings)) {
    for (const slotId of item.slotIds) seen.add(slotId);
  }
  return [...seen];
}

/** Every error message that blames a given slot; fed back to the model on retry. */
export function feedbackForSlot(findings: readonly SetFinding[], slotId: string): string[] {
  return errors(findings)
    .filter((item) => item.slotIds.includes(slotId))
    .map((item) => `${item.code}: ${item.message}`);
}

export function formatFindings(findings: readonly SetFinding[]): string {
  return findings
    .map(
      (item) =>
        `[${item.severity}] ${item.code}${item.slotIds.length > 0 ? ` (${item.slotIds.join(', ')})` : ''}: ${item.message}`,
    )
    .join('\n');
}
