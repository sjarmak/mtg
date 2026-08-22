/**
 * Validation violations. Validators never throw for expected invalidity —
 * they return a typed array of violations with a machine code, a
 * human-readable message and a path into the record.
 */

export const VIOLATION_CODES = [
  // Schema-shape failures, mapped from Zod issues.
  'SCHEMA_INVALID',
  'UNKNOWN_CARD_KIND',
  'UNKNOWN_EFFECT_KIND',
  'UNKNOWN_KEYWORD',
  'UNKNOWN_TARGET_KIND',
  'UNKNOWN_COLOR',
  'UNKNOWN_RARITY',
  'MALFORMED_MANA_COST',
  // Mana-cost well-formedness.
  'MANA_COST_NEGATIVE',
  'MANA_COST_OUT_OF_RANGE',
  'COST_REDUCTION_ILLEGAL_ON_CARD_TYPE',
  // Color identity.
  'COLOR_IDENTITY_MISMATCH',
  'ARTIFACT_NOT_COLORLESS',
  'LAND_NOT_COLORLESS',
  'LAND_MANA_MISMATCH',
  'LAND_BASIC_TYPE_MISMATCH',
  'LAND_ENTRY_CONDITION_INVALID',
  'TOKEN_COLOR_OFF_IDENTITY',
  // Type line.
  'SUPERTYPE_ILLEGAL_ON_CARD_TYPE',
  'DUPLICATE_SUPERTYPE',
  'INVALID_SUBTYPE',
  'DUPLICATE_SUBTYPE',
  'SUBTYPE_ILLEGAL_ON_CARD_TYPE',
  'AURA_INVALID',
  // Creature stats.
  'CREATURE_STATS_ON_NONCREATURE',
  'CREATURE_STATS_OUT_OF_RANGE',
  'CHARACTERISTIC_POWER_TOUGHNESS_CONFLICT',
  // Keywords.
  'KEYWORD_ILLEGAL_ON_CARD_TYPE',
  'DUPLICATE_KEYWORD',
  // Effects.
  'EFFECT_ILLEGAL_ON_CARD_TYPE',
  'SPELL_WITHOUT_EFFECT',
  'EFFECT_PARAM_OUT_OF_RANGE',
  // A one-shot stat change whose magnitude is a rate, in a shape the printed
  // sentence cannot carry: one half a rate and the other a numeral, or two
  // halves charged against two different tallies.
  'PUMP_RATE_INVALID',
  'ILLEGAL_TARGET_FOR_EFFECT',
  'ILLEGAL_DISTINCT_TARGET',
  'ILLEGAL_TARGET_RESTRICTION',
  'ILLEGAL_TARGET_FILTER',
  // The same class of mistake one filter over: a `CardFilter` that contradicts
  // itself or states a value twice, on a search, a graveyard choice or a
  // revealed-hand choice.
  'ILLEGAL_CARD_FILTER',
  'ILLEGAL_TARGET_COUNT',
  // A back-reference ("that creature", "that player", "that creature's
  // controller") with nothing behind it: no earlier effect in the same list
  // chooses an object of the space the phrase needs, or more than one does and
  // the phrase has two readings. Its own code rather than
  // `ILLEGAL_TARGET_FOR_EFFECT`, because that code answers "may this effect
  // point here at all", which is a fact about one effect, and this one answers
  // "does this phrase have a referent", which is a fact about the list around
  // it — the author fixing the first edits `target.kind` and the author fixing
  // the second edits a different effect.
  'ILLEGAL_REFERENT_TARGET',
  'INVALID_TOKEN_SUBTYPE',
  'INVALID_TOKEN_NAME',
  'TOKEN_STATS_INCOMPLETE',
  'DUPLICATE_EFFECT',
  'CHOSEN_X_WITHOUT_X_COST',
  'ILLEGAL_EFFECT_SCOPE',
  'MODES_ILLEGAL_ON_CARD_TYPE',
  'EFFECTS_AND_MODES_BOTH_PRESENT',
  'MAY_ILLEGAL_ON_CARD_TYPE',
  'MAY_AND_MODES_BOTH_PRESENT',
  'UNLESS_ILLEGAL_ON_CARD_TYPE',
  'UNLESS_AND_MODES_BOTH_PRESENT',
  'UNLESS_AND_MAY_BOTH_PRESENT',
  'UNLESS_NEEDS_ONE_EFFECT',
  'UNLESS_PAYER_HAS_NO_TARGET',
  'UNLESS_COST_IS_FREE',
  'UNLESS_COST_IS_VARIABLE',
  // Abilities.
  'ABILITY_ILLEGAL_ON_CARD_TYPE',
  'ABILITY_COUNT_INVALID',
  'ABILITY_COST_INVALID',
  'ABILITY_WITHOUT_EFFECT',
  'EQUIP_ABILITY_INVALID',
  'REGENERATION_ABILITY_INVALID',
  'MANA_ABILITY_INVALID',
  'OPTIONAL_TRIGGER_INVALID',
  'ILLEGAL_TARGET_IN_ABILITY',
  'STATIC_MODIFICATION_OUT_OF_RANGE',
  'DUPLICATE_MODIFICATION',
  'STATIC_SUBTYPE_ILLEGAL_ON_SCOPE',
  'DEFINE_PT_ILLEGAL_ON_SCOPE',
  'DUPLICATE_ABILITY',
  'CONDITION_THRESHOLD_OUT_OF_RANGE',
  'PLANESWALKER_INVALID',
  // Derived text.
  'ORACLE_TEXT_MISMATCH',
  // Authored text.
  'FLAVOR_TEXT_INVALID',
  // Set-level.
  'DUPLICATE_CARD_ID',
  'DUPLICATE_COLLECTOR_NUMBER',
  'DUPLICATE_FINGERPRINT',
  'DUPLICATE_TOKEN_NAME',
  'DUPLICATE_TOKEN_ID',
  // A static whose modification is a CR 614 replacement rather than a CR 613
  // layer, printed with a scope that claims to reach other permanents.
  'REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE',
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface Violation {
  /** Stable machine code; consumers branch on this, never on the message. */
  readonly code: ViolationCode;
  /** Actionable English: what is wrong and what would be legal. */
  readonly message: string;
  /** Location inside the record, e.g. `effects[0].target.kind`. Empty at root. */
  readonly path: string;
}

/** Renders a Zod-style path array as `a.b[0].c`. */
export function formatPath(segments: ReadonlyArray<string | number | symbol>): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    const key = String(segment);
    return acc.length === 0 ? key : `${acc}.${key}`;
  }, '');
}

export function violation(code: ViolationCode, path: string, message: string): Violation {
  return { code, message, path };
}

/** True when any violation carries the given code. */
export function hasViolation(violations: readonly Violation[], code: ViolationCode): boolean {
  return violations.some((v) => v.code === code);
}

/** One-line summary used in thrown-error messages and CI output. */
export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.code}${v.path.length > 0 ? ` at ${v.path}` : ''}: ${v.message}`)
    .join('; ');
}
