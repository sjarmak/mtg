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
  'CREATION_POWER_TOUGHNESS_CONFLICT',
  'DUPLICATE_ENTRY_MODE',
  // Keywords.
  'KEYWORD_ILLEGAL_ON_CARD_TYPE',
  'DUPLICATE_KEYWORD',
  'KEYWORD_LINE_GROUPS_MISMATCH',
  'HYBRID_MANA_REMINDER_INVALID',
  // Effects.
  'EFFECT_ILLEGAL_ON_CARD_TYPE',
  'CASTING_RULE_ILLEGAL_ON_CARD_TYPE',
  'INVALID_OVERLOAD_PAIR',
  'SPELL_WITHOUT_EFFECT',
  'EFFECT_PARAM_OUT_OF_RANGE',
  'MILL_PRESENTATION_INVALID',
  'RANDOM_BRANCH_INVALID',
  // A one-shot stat change whose magnitude is a rate, in a shape the printed
  // sentence cannot carry: one half a rate and the other a numeral, or two
  // halves charged against two different tallies.
  'PUMP_RATE_INVALID',
  // A hand-authored duration-first pump outside the one exact rate-plus-rider
  // sentence that needs that presentation.
  'PUMP_PRESENTATION_INVALID',
  'ILLEGAL_TARGET_FOR_EFFECT',
  'ILLEGAL_DISTINCT_TARGET',
  'ILLEGAL_TARGET_RESTRICTION',
  'ILLEGAL_TARGET_FILTER',
  // The same class of mistake one filter over: a `CardFilter` that contradicts
  // itself or states a value twice, on a search, a graveyard choice or a
  // revealed-hand choice.
  'ILLEGAL_CARD_FILTER',
  'ILLEGAL_TARGET_COUNT',
  'INVALID_DAMAGE_DIVISION',
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
  // A computed amount such as "that creature's toughness" with no single
  // earlier creature-target instruction to supply its antecedent.
  'ILLEGAL_REFERENT_AMOUNT',
  // A target that excludes the ability's own source outside a reviewed
  // source-relative shape whose context supplies that source.
  'SOURCE_EXCLUSION_INVALID',
  // A source-linked exile reader without a writer on the same permanent, or a
  // reader outside the matching source-departure trigger whose retained
  // relation supplies it.
  'SOURCE_LINKED_EXILE_INVALID',
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
  'UNLESS_DUPLICATED',
  'UNLESS_NEEDS_ONE_EFFECT',
  'UNLESS_PAYER_HAS_NO_TARGET',
  'UNLESS_COST_IS_FREE',
  'UNLESS_COST_IS_VARIABLE',
  'UNLESS_CHOSEN_X_WITHOUT_X_COST',
  // Abilities.
  'ABILITY_ILLEGAL_ON_CARD_TYPE',
  'ABILITY_COUNT_INVALID',
  'ABILITY_COST_INVALID',
  'ABILITY_WITHOUT_EFFECT',
  'FILTERED_ATTACK_TRIGGER_INVALID',
  'EQUIP_ABILITY_INVALID',
  'REGENERATION_ABILITY_INVALID',
  'MANA_ABILITY_INVALID',
  'OPTIONAL_TRIGGER_INVALID',
  'PAID_OPTIONAL_TRIGGER_INVALID',
  'RETURN_ANOTHER_CREATURE_OR_SACRIFICE_INVALID',
  'DAMAGE_TARGET_AND_SAME_NAME_INVALID',
  'COUNTER_TRIGGER_INVALID',
  'TRIGGER_UNLESS_INVALID',
  'ILLEGAL_TARGET_IN_ABILITY',
  'STATIC_MODIFICATION_OUT_OF_RANGE',
  'DUPLICATE_MODIFICATION',
  'STATIC_SUBTYPE_ILLEGAL_ON_SCOPE',
  'STATIC_FILTER_ILLEGAL_ON_SCOPE',
  'STATIC_PLAYER_RULE_SCOPE_INVALID',
  'DEFINE_PT_ILLEGAL_ON_SCOPE',
  'DUPLICATE_ABILITY',
  'CONDITION_THRESHOLD_OUT_OF_RANGE',
  'PLANESWALKER_INVALID',
  'BATTLE_INVALID',
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
  // Replacement statics compile outside the CR 613 condition evaluator, so a
  // battlefield predicate on one would print a condition the kernel ignores.
  'REPLACEMENT_CONDITION_UNSUPPORTED',
  'DELAYED_COUNTER_PLACEMENT_INVALID',
  'EFFECT_CONDITION_INVALID',
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
