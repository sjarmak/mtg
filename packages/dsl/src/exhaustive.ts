/**
 * Compile-time guards that the pinned vocabulary tuples and the schema-derived
 * unions never drift apart.
 *
 * Each `…Covered` alias resolves to `true` only when the two sides are mutually
 * assignable; a test assigns `true` to each one, so adding an effect primitive
 * (or a keyword, target kind, card kind) without updating the vocabulary tuple
 * fails `npm run typecheck` rather than a runtime assertion.
 */
import type { Ability, StaticModification } from './abilities';
import type { Card, KeywordAbility } from './card';
import type { Effect } from './effects';
import type { ModelTargetKind, TargetSpec } from './targets';
import type {
  ABILITY_KINDS,
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  KEYWORD_ABILITY_KINDS,
  KEYWORDS,
  MODEL_TARGET_KINDS,
  STATIC_MODIFICATION_KINDS,
  TARGET_KINDS,
  CARD_KINDS,
} from './vocabulary';
import type { GrantableKeywordAbilityKind, Keyword } from './vocabulary';

/** `true` when A and B denote exactly the same union. */
export type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export type EffectKindsCovered = MutuallyAssignable<Effect['kind'], (typeof ALL_EFFECT_KINDS)[number]>;

/**
 * Containment rather than equality, the second guard here that is deliberately
 * one-directional, and for a reason `ModelTargetKindsAreTargetKinds` below
 * states in the other direction.
 *
 * `EFFECT_KINDS` is the half of the vocabulary two packages outside this one are
 * keyed by — `@mtg/design-data`'s color pie, whose document schema refuses to
 * load without a row per subject, and `@mtg/setgen`'s `EFFECT_RANGES` prompt
 * text. `UNPRICED_EFFECT_KINDS` is the half neither has ruled on yet. Asking for
 * mutual assignability against `Effect['kind']` here would fail the moment the
 * kernel learns a primitive, which is the event this guard exists to allow.
 * What it does catch is a name in the priced tuple that no schema member
 * carries.
 */
export type PricedEffectKindsAreEffectKinds = (typeof EFFECT_KINDS)[number] extends Effect['kind']
  ? true
  : never;
export type TargetKindsCovered = MutuallyAssignable<TargetSpec['kind'], (typeof TARGET_KINDS)[number]>;
export type CardKindsCovered = MutuallyAssignable<Card['kind'], (typeof CARD_KINDS)[number]>;

/**
 * Containment rather than equality, and the one guard here that is deliberately
 * one-directional. `MODEL_TARGET_KINDS` is a frozen subset of `TARGET_KINDS`
 * (`vocabulary.ts` says why), so asking for mutual assignability would fail the
 * moment the engine's tuple grows — which is the event this guard exists to
 * allow. What it does catch is the direction that breaks a generated card: a
 * model kind the engine has no word for resolves to `never`.
 */
export type ModelTargetKindsAreTargetKinds = ModelTargetKind extends (typeof TARGET_KINDS)[number]
  ? (typeof MODEL_TARGET_KINDS)[number] extends ModelTargetKind
    ? true
    : never
  : never;
export type KeywordsCovered = MutuallyAssignable<Keyword, (typeof KEYWORDS)[number]>;

/** Has teeth: `AbilitySchema` writes each `kind` as a hand-written literal. */
export type AbilityKindsCovered = MutuallyAssignable<Ability['kind'], (typeof ABILITY_KINDS)[number]>;

/**
 * Has teeth: `KeywordAbilitySchema` writes each `kind` as a hand-written
 * literal, the same as `AbilityKindsCovered` above. A sixth `KeywordAbility`
 * kind added to the schema without a matching entry in `KEYWORD_ABILITY_KINDS`
 * fails here, before `reminder.test.ts`'s runtime check ever gets a chance to
 * notice the kind prints with no reminder (mtg-josx).
 */
export type KeywordAbilityKindsCovered = MutuallyAssignable<
  KeywordAbility['kind'],
  (typeof KEYWORD_ABILITY_KINDS)[number]
>;

/**
 * The rule `GRANTABLE_KEYWORD_ABILITY_KINDS` states in prose, as a type error.
 *
 * A `grantKeyword` record carries one name and nothing else, so a keyword
 * ability that needs a second field — `landwalk`'s land type, `protection`'s
 * quality — cannot be spelled by one. Extracting the named kinds out of
 * `KeywordAbility` and asking them to be mutually assignable with the bare
 * `{ kind }` records is what catches `'landwalk'` added to the tuple: the
 * extraction keeps `landType`, the bare record does not, and the alias resolves
 * to `never`. Containment in the other direction comes free — the extraction is
 * empty for a name `KeywordAbilitySchema` does not carry, and an empty union is
 * not mutually assignable with a populated one.
 */
export type GrantableKeywordAbilitiesAreParameterless = MutuallyAssignable<
  Extract<KeywordAbility, { kind: GrantableKeywordAbilityKind }>,
  { kind: GrantableKeywordAbilityKind }
>;

/** Has teeth: `StaticModificationSchema` writes each `kind` as a hand-written literal. */
export type StaticModificationsCovered = MutuallyAssignable<
  StaticModification['kind'],
  (typeof STATIC_MODIFICATION_KINDS)[number]
>;

// Deliberately absent: `StaticScope` is `z.enum(STATIC_SCOPES)`, so the union is
// *derived from* the tuple and a guard between them is `true` by construction.
// Its equivalent protection is `staticSubject` in `oracle.ts` and
// `staticFilterFor` in the kernel, both exhaustive switches over the scope.
