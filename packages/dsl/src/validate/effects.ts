/**
 * Effect-parameter sanity, per-effect targeting legality, and effect placement
 * by card type.
 *
 * A card's own `effects` list is what a spell does when it resolves, so it is
 * legal only on instants and sorceries. A permanent's effects are printed
 * inside a triggered ability and validated there (`validate/abilities.ts`),
 * which is what `checkEffects` tells an author to do rather than refusing the
 * effect outright. `checkEffectParams` and `LIMITS` are exported to that file
 * so one range table covers both placements.
 *
 * Everything this file knows *per primitive* is stated once, in `EFFECT_RULES`.
 * `LEGAL_TARGETS`, `HAND_AUTHORED_TARGETS` and `checkEffectParams` keep their
 * names and their behavior and are now derived from it, so adding a primitive to
 * the vocabulary is one row here rather than a targeting entry and a `switch`
 * arm a reader has to know to write in two places.
 */
import type { ComputedAmount, PumpAmount } from '../amount';
import { isLiteralAmount, isRateAmount } from '../amount';
import type { Card } from '../card';
import type {
  AnyEffectKind,
  CardFilter,
  Effect,
  GraveyardArrivalGrant,
  TargetedEffect,
  TokenSpec,
} from '../effects';
import {
  effectAllowsAnyNumberTargets,
  effectAllowsTargetCount,
  effectChoosesTarget,
  effectUsesPaidSacrificePower,
  effectUsesPaidSacrificeToughness,
  effectUsesPaidDiscardManaValue,
  playerReferentAmountSourceIndex,
  hasTarget,
  isCreatureTokenSpec,
  isSourceBodyEffect,
  isTargetedFight,
  isSourceLinkedExileWriter,
  MAX_MANA_PRODUCED,
  referentAmountSourceIndex,
  referentSourceIndex,
  sacrificedPermanentAmountSourceIndex,
  revealedCardAmountSourceIndex,
} from '../effects';
import { tokenCard } from '../token';
import { canonicalJson } from '../canonical-json';
import { manaValue } from '../mana';
import { UNLESS_PAYER_TARGETS, unlessPayerPhrase } from '../unless';
import { withArticle } from '../text-util';
import type { TargetFilter, TargetKind, TargetSpec } from '../targets';
import {
  cardTypeFilterFitsTargetKind,
  filterFitsTargetKind,
  isGraveyardCardTargetKind,
  isSourceAttackTarget,
  isSourceAttachmentTarget,
  isSourceBodyOnlyTarget,
  isMultipleTargetSpec,
  referentSourceSpace,
  requiresDistinctTarget,
  restrictionFitsTargetKind,
  targetCountOf,
  targetMinimumOf,
  targetFilterIsEmpty,
  targetFilterOf,
  targetKindNamesACreature,
  targetKindNamesAPlayer,
  targetKindNamesAPlayerOrPlaneswalker,
  targetKindsCanCollide,
  targetRestrictionOf,
  targetsAnyNumber,
} from '../targets';
import type { Violation, ViolationCode } from '../violations';
import { violation } from '../violations';
import { checkAbilities } from './abilities';
import { checkKeywords } from './typeline';
import type { CardKind, Color } from '../vocabulary';
import type { EffectScope } from '../vocabulary';
import {
  ALL_EFFECT_KINDS,
  BASIC_LAND_TYPES,
  CARD_KINDS,
  EFFECT_SCOPE_SUBJECT,
  PERMANENT_CARD_KINDS,
  SPELL_CARD_KINDS,
  SUBTYPE_PATTERN,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_NAME_PATTERN,
} from '../vocabulary';

function checkGrantKeywordParams(effect: EffectOf<'grantKeywordUntilEndOfTurn'>, path: string): Violation[] {
  const keywords = [effect.keyword, ...(effect.additionalKeywords ?? [])];
  const duplicate = keywords.find((keyword, index) => keywords.indexOf(keyword) !== index);
  if (duplicate !== undefined) {
    return [
      violation(
        'DUPLICATE_KEYWORD',
        `${path}.additionalKeywords`,
        `the temporary grant names ${duplicate} more than once`,
      ),
    ];
  }
  return [];
}

/** The one effect the union carries for a given kind. */
type EffectOf<K extends AnyEffectKind> = Extract<Effect, { readonly kind: K }>;

/** The structural contract shared by even division and chosen allocations. */
function checkDamageDivision(effect: EffectOf<'dealDamage'>, path: string): Violation[] {
  const plural = isMultipleTargetSpec(effect.target);
  if (effect.division === undefined) {
    return plural
      ? [
          violation(
            'INVALID_DAMAGE_DIVISION',
            `${path}.division`,
            'damage with a plural target slot must state how its amount is divided',
          ),
        ]
      : [];
  }
  if (!plural) {
    return [
      violation(
        'INVALID_DAMAGE_DIVISION',
        `${path}.division`,
        'damage division needs one plural target slot; use count or anyNumber on the target',
      ),
    ];
  }
  if (effect.division.kind === 'asYouChoose' && !isLiteralAmount(effect.amount)) {
    return [
      violation(
        'INVALID_DAMAGE_DIVISION',
        `${path}.amount`,
        'a chosen allocation needs a fixed positive total when targets are chosen',
      ),
    ];
  }
  if (
    effect.division.kind === 'asYouChoose' &&
    isLiteralAmount(effect.amount) &&
    targetMinimumOf(effect.target) > effect.amount
  ) {
    return [
      violation(
        'INVALID_DAMAGE_DIVISION',
        `${path}.target.minimum`,
        'a positive allocation cannot satisfy more required targets than the fixed damage total',
      ),
    ];
  }
  return [];
}

/** Validates the three narrow, hand-authored riders used by M13 damage cohorts. */
function checkDamageCohortRiders(effect: EffectOf<'dealDamage'>, path: string): Violation[] {
  const found: Violation[] = [];
  if (effect.eachScopedPermanentDealsToItsController === true) {
    const exactCohortSourceShape =
      effect.scope !== undefined &&
      EFFECT_SCOPE_SUBJECT[effect.scope] === 'resolvingController' &&
      effect.target.kind === 'noTarget' &&
      effect.players === undefined &&
      effect.division === undefined &&
      effect.additionalScopeFilter === undefined &&
      effect.scopeAmount === undefined &&
      effect.tapScopeGroup !== true &&
      effect.exileDamagedCreatureIfItWouldDieThisTurn !== true;
    if (!exactCohortSourceShape) {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.eachScopedPermanentDealsToItsController`,
          'cohort-source damage requires one untargeted resolving-controller scope with no second recipient or post-damage rider',
        ),
      );
    }
  }
  if (effect.exileDamagedCreatureIfItWouldDieThisTurn === true) {
    const hasExactLinkedShape =
      effect.target.kind === 'anyTarget' &&
      effect.scope === undefined &&
      effect.players === undefined &&
      effect.division === undefined &&
      effect.preventable !== false &&
      effect.additionalScopeFilter === undefined &&
      effect.scopeAmount === undefined &&
      effect.tapScopeGroup !== true;
    if (!hasExactLinkedShape) {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.exileDamagedCreatureIfItWouldDieThisTurn`,
          'the damage-linked death replacement is source-attested only on one preventable any-target damage instruction',
        ),
      );
    }
  }
  const additional = effect.additionalScopeFilter;
  if (additional !== undefined) {
    if (effect.scope !== 'allPermanents' || effect.scopeFilter === undefined) {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.additionalScopeFilter`,
          'an additional damage cohort is legal only beside an allPermanents scope and its primary scopeFilter',
        ),
      );
    }
    found.push(
      ...checkFilterLists(additional, `${path}.additionalScopeFilter`, PERMANENT_CARD_KINDS, 'a permanent'),
    );
    const missed = unreachableSweepBodies(additional, DAMAGEABLE_CARD_KINDS);
    if (missed !== null) {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.additionalScopeFilter.${missed.field}`,
          `damage is dealt only to ${DAMAGEABLE_CARD_KINDS.join(' and ')} permanents, and this branch names ${describeSweepBodies(missed)}`,
        ),
      );
    }
    if (effect.scopeFilter !== undefined && canonicalJson(additional) === canonicalJson(effect.scopeFilter)) {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.additionalScopeFilter`,
          'the additional damage cohort repeats the primary scopeFilter; drop the duplicate branch',
        ),
      );
    }
  }
  if (effect.scopeAmount !== undefined) {
    if (effect.scope !== 'targetAndPermanentsItsPlayerControls') {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scopeAmount`,
          'a distinct cohort amount is legal only on targetAndPermanentsItsPlayerControls damage',
        ),
      );
    }
    found.push(...checkAmountRange(effect.scopeAmount, LIMITS.damage, `${path}.scopeAmount`, 'damage'));
  }
  if (effect.tapScopeGroup === true) {
    const creatureOnly =
      effect.scopeFilter?.cardTypes?.length === 1 && effect.scopeFilter.cardTypes[0] === 'creature';
    if (effect.scope === undefined || !creatureOnly || additional !== undefined) {
      found.push(
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.tapScopeGroup`,
          'tapping the retained damage cohort requires one scoped, creature-only permanent group',
        ),
      );
    }
  }
  return found;
}

/**
 * The target kinds a `pumpUntilEndOfTurn` keyword rider may ride on.
 *
 * A subset of the pump's own slots rather than all of them, and the missing
 * three say why: `targetPlayer` and `targetOpponent` are the handle a *scope*
 * reads a group off, and `noTarget` is the untargeted sweeper's slot. None of
 * the three names a body, so a keyword hung on one is a grant with no recipient
 * — it would parse, print a sentence, and land on nobody, which is the same
 * silent no-op `UNSCOPED_MAY_NAME_A_PLAYER` refuses further down this file.
 *
 * `targetCreatureDefendingPlayerControls` is here beside the two obvious ones
 * because it is a creature slot like any other; the rule that keeps it to a
 * `selfAttacks` trigger is `checkAbilityEffectTarget`'s and not this one's.
 */
const PUMP_KEYWORD_RIDER_TARGETS: readonly TargetKind[] = [
  'targetCreature',
  'targetCreatureDefendingPlayerControls',
  'selfCreature',
  'thatCreature',
];

/**
 * The two rules that keep the keyword rider from being a second spelling of
 * something the vocabulary already says.
 *
 * The scope rule is the load-bearing one, and what it protects changed when
 * `grantKeywordUntilEndOfTurn` grew a scope of its own (`mtg-nhyv.15`). It used
 * to say a mass grant was a capability nothing had, so a scoped pump wearing a
 * rider would reach it sideways for the cards that happen to also pump. Now the
 * mass grant has a name, and the rule says the same thing from the other end: a
 * scoped pump with a keyword on it and a scoped pump beside a scoped grant are
 * one card with two encodings, and two encodings do not compare byte-identical
 * under `canonicalJson`. A vocabulary with one word for a thing is the property
 * this package exists to hold either way.
 *
 * The target rule is the plain one: a rider needs a body to land on.
 */
function checkPumpKeywordRider(effect: EffectOf<'pumpUntilEndOfTurn'>, path: string): readonly Violation[] {
  if (effect.keyword === undefined) return [];
  const found: Violation[] = [];
  if (effect.scope !== undefined) {
    found.push(
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        path,
        'a keyword rider names one body, so it cannot ride a scoped pump; a mass keyword grant is spelled as a scoped grantKeywordUntilEndOfTurn beside the pump',
      ),
    );
  }
  if (!PUMP_KEYWORD_RIDER_TARGETS.includes(effect.target.kind)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        path,
        `a keyword rider needs a creature to land on and "${effect.target.kind}" names none`,
      ),
    );
  }
  return found;
}

/** Chorus of Might's source-attested word order, withheld from every model-facing union. */
function checkPumpPresentation(effect: EffectOf<'pumpUntilEndOfTurn'>, path: string): readonly Violation[] {
  if (effect.printedDurationFirst !== true) return [];
  if (effect.keyword !== undefined && isRateAmount(effect.power) && isRateAmount(effect.toughness)) {
    return [];
  }
  return [
    violation(
      'PUMP_PRESENTATION_INVALID',
      `${path}.printedDurationFirst`,
      'duration-first pump text is legal only for a rate-bearing pump with a same-target keyword rider',
    ),
  ];
}

/**
 * Everything the pump's two magnitudes have to be, including the three ways a
 * rate can be written down that no card can print.
 *
 * The rate rules are all one rule seen from three sides: Magic names the count
 * once, at the end of the sentence, and that one clause covers the whole P/T
 * line ("All creatures get -1/-1 until end of turn for each Swamp you
 * control"). So both halves are rates or neither is — a numeral beside a rate
 * would need two clauses in a frame that has room for one — and two rates are
 * charged against the same tally, because the sentence has one "for each" in it
 * and no way to say which half the second tally belongs to.
 *
 * They are refused here rather than in the schema because `RatePerSchema` is
 * declared once and used in two independent fields; a schema that could see
 * across the pair would have to be a schema for the pair, which is a second
 * spelling of the pump. `renderPump` throws on both shapes rather than
 * inventing a sentence for them, and this is the check whose absence would let
 * one reach it.
 *
 * The no-op rule reads the rates as well as the numerals for the same reason it
 * exists at all: `+0/+0 for each Swamp you control` is a no-op with extra words
 * on it, and the vocabulary already has one spelling of "does nothing" too many.
 */
/**
 * The two numerals a base P/T set may print.
 *
 * `checkRange` rather than `checkAmountRange`, and the difference is the whole
 * shape of the kind: a pump's halves are `Amount`s because a pump may count
 * something, and these are plain integers because a base P/T that counts
 * something is layer 7a and a different record (`effects.ts` argues it at the
 * factory). There is no no-op rule to write either — "base power and toughness
 * 0/1" says something about a 5/5 that "+0/+0" never says.
 */
function checkBasePtParams(effect: EffectOf<'setBasePtUntilEndOfTurn'>, path: string): Violation[] {
  return [
    ...checkRange(effect.power, LIMITS.basePower, `${path}.power`, 'base power'),
    ...checkRange(effect.toughness, LIMITS.baseToughness, `${path}.toughness`, 'base toughness'),
  ];
}

function checkLandAnimationParams(
  effect: EffectOf<'animateLandWhileSourceOnBattlefield'>,
  path: string,
): Violation[] {
  const found = [
    ...checkRange(effect.power, LIMITS.basePower, `${path}.power`, 'base power'),
    ...checkRange(effect.toughness, LIMITS.baseToughness, `${path}.toughness`, 'base toughness'),
  ];
  const filter = effect.target.filter;
  const guaranteesLand =
    filter?.cardTypes?.every((kind) => kind === 'land') === true ||
    filter?.allCardTypes?.includes('land') === true ||
    filter?.subtypes?.every((subtype) => BASIC_LAND_TYPES.some((landType) => landType === subtype)) === true;
  if (effect.target.kind === 'targetPermanent' && !guaranteesLand) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.target.filter`,
        'animateLandWhileSourceOnBattlefield says the target is still a land, so its filter must select only lands or basic land types',
      ),
    );
  }
  return found;
}

/** The two source-attested attachment sweeps currently executable end to end. */
function checkDestroyAttachedPermanentsParams(
  effect: EffectOf<'destroyAttachedPermanents'>,
  path: string,
): Violation[] {
  const attachmentFilter = canonicalJson(effect.filter);
  const targetFilter = canonicalJson(targetFilterOf(effect.target));
  const turnToSlag =
    effect.target.kind === 'thatCreature' && attachmentFilter === '{"subtypes":["Equipment"]}';
  const streetSweeper =
    effect.target.kind === 'targetPermanent' &&
    targetFilter === '{"cardTypes":["land"]}' &&
    attachmentFilter === '{"subtypes":["Aura"]}';
  if (turnToSlag || streetSweeper) return [];
  return [
    violation(
      'ILLEGAL_TARGET_FILTER',
      path,
      'attached-permanent destruction supports only Equipment on the retained creature or Auras on a land-filtered permanent target',
    ),
  ];
}

/** Locks the Destroy the Evidence rider to its one source-attested profile. */
function checkDestroyPermanentParams(effect: EffectOf<'destroyPermanent'>, path: string): Violation[] {
  if (effect.controllerLibraryFollowup === undefined) return [];
  const exactLandTarget =
    effect.scope === undefined &&
    effect.target.kind === 'targetPermanent' &&
    canonicalJson(targetFilterOf(effect.target)) === '{"cardTypes":["land"]}';
  return exactLandTarget
    ? []
    : [
        violation(
          'ILLEGAL_TARGET_FILTER',
          path,
          'the retained-controller library follow-up is source-attested only after destroying exactly one land-filtered permanent target',
        ),
      ];
}

function checkSourceAnimationParams(
  effect: EffectOf<'animateSourceUntilEndOfTurn'>,
  path: string,
): Violation[] {
  const found = [
    ...checkRange(effect.power, LIMITS.basePower, `${path}.power`, 'base power'),
    ...checkRange(effect.toughness, LIMITS.baseToughness, `${path}.toughness`, 'base toughness'),
  ];
  for (const [index, subtype] of effect.subtypes.entries()) {
    if (!SUBTYPE_PATTERN.test(subtype)) {
      found.push(
        violation(
          'INVALID_SUBTYPE',
          `${path}.subtypes[${String(index)}]`,
          `animation subtype "${subtype}" must start with an uppercase letter and contain only letters, digits, spaces, apostrophes, or hyphens`,
        ),
      );
    }
  }
  const duplicateSubtype = effect.subtypes.find(
    (subtype, index) => effect.subtypes.indexOf(subtype) !== index,
  );
  if (duplicateSubtype !== undefined) {
    found.push(
      violation(
        'DUPLICATE_SUBTYPE',
        `${path}.subtypes`,
        `animation subtype "${duplicateSubtype}" is listed more than once`,
      ),
    );
  }
  const duplicateKeyword = effect.keywords.find(
    (keyword, index) => effect.keywords.indexOf(keyword) !== index,
  );
  if (duplicateKeyword !== undefined) {
    found.push(
      violation(
        'DUPLICATE_KEYWORD',
        `${path}.keywords`,
        `animation keyword "${duplicateKeyword}" is listed more than once`,
      ),
    );
  }
  return found;
}

function checkPumpParams(effect: EffectOf<'pumpUntilEndOfTurn'>, path: string): Violation[] {
  const found = [
    ...checkAmountRange(effect.power, LIMITS.pumpDelta, `${path}.power`, 'power delta'),
    ...checkAmountRange(effect.toughness, LIMITS.pumpDelta, `${path}.toughness`, 'toughness delta'),
  ];
  const power = effect.power;
  const toughness = effect.toughness;
  if (isRateAmount(power) !== isRateAmount(toughness)) {
    found.push(
      violation(
        'PUMP_RATE_INVALID',
        path,
        'a rate covers the whole stat line, so both halves of the pump must be rates or neither may be',
      ),
    );
  } else if (
    isRateAmount(power) &&
    isRateAmount(toughness) &&
    canonicalJson(power.each) !== canonicalJson(toughness.each)
  ) {
    found.push(
      violation(
        'PUMP_RATE_INVALID',
        path,
        'a pump prints one "for each" clause, so both halves must be charged against the same tally',
      ),
    );
  }
  const noop = isRateAmount(power)
    ? isRateAmount(toughness) && power.rate === 0 && toughness.rate === 0
    : power === 0 && toughness === 0;
  if (noop) {
    // Said unconditionally, keyword rider or not. "Gains flying until end
    // of turn" already has an encoding — `grantKeywordUntilEndOfTurn` — and
    // a +0/+0 pump wearing the rider would be a second spelling of it that
    // does not compare byte-identical under `canonicalJson`, which is the
    // ambiguity `TargetSpecSchema` pins `distinct` to `literal(true)` for.
    found.push(
      violation('EFFECT_PARAM_OUT_OF_RANGE', path, 'a +0/+0 pump is a no-op; give it a nonzero delta'),
    );
  }
  return [...found, ...checkPumpKeywordRider(effect, path), ...checkPumpPresentation(effect, path)];
}

/**
 * The generator's ordinary draw ceiling remains six. Hand-authored player
 * sweeps reach seven for Time Reversal, and plural player targets reach twenty
 * for Jace, Memory Adept. Both carriers are absent from every model-facing
 * effect union, so these branches widen the engine without widening what a
 * generated slot may propose.
 */
function checkDrawParams(effect: EffectOf<'drawCards'>, path: string): Violation[] {
  const maximum =
    effect.players !== undefined ? 7 : isMultipleTargetSpec(effect.target) ? 20 : LIMITS.draw.max;
  const range = { min: LIMITS.draw.min, max: maximum };
  return checkAmountRange(effect.count, range, `${path}.count`, 'card count');
}

/**
 * What the validator knows about one effect primitive: where it may point, and
 * what its own parameters must be.
 *
 * One declaration per primitive rather than a targeting table here and a
 * `switch` over the same discriminant a hundred lines down, for the reason
 * `counters.ts` gives at its own `DECLARATIONS`. The two questions arrive
 * together — an effect that takes a target takes parameters — and splitting them
 * made adding a primitive two edits a reader had to know to make twice.
 */
interface EffectRules<K extends AnyEffectKind = AnyEffectKind> {
  /**
   * Per-effect targeting legality **the set generator is held to**, and the
   * exact bytes the fill prompt prints.
   *
   * The second half of that sentence is not a note, it is why this is one field
   * of two. `@mtg/setgen`'s `vocabularySection` writes
   * `target.kind: ${LEGAL_TARGETS[kind].join(' | ')}` straight into the prompt,
   * and a fixture key is a hash of the prompt, so a member added to a row a slot
   * can offer renames every recorded response behind it. Adding `targetOpponent`
   * to `dealDamage` here was tried and did exactly that: four assertions across
   * two recorded runs went looking for fixture `8a81986a…` and it no longer
   * existed. A re-record costs paid model calls, which is a decision belonging
   * to whoever authorizes a generation run rather than to a kernel change.
   *
   * So everything here is something the generator could be shown, and
   * `handAuthoredTargets` holds what only a hand-written card may name. An
   * unpriced kind is safe here — `vocabularySection` only ever asks about kinds
   * a slot offers, and no slot can offer one.
   */
  readonly generatableTargets: readonly TargetKind[];
  /**
   * Target kinds a **hand-authored** card may name that the generator may not.
   *
   * One row carries this, and it is the whole point of the split: "target
   * opponent" is CR 115.4's restriction, the engine now enforces it, and
   * `dealDamage` is the row the card that asked for it needs. Writing it here
   * rather than in `generatableTargets` keeps the prompt's bytes and every
   * recorded fixture exactly where they were.
   *
   * A field here is not a widening deferred. It is a statement that the engine
   * enforces a restriction the model is not taught, which is the same asymmetry
   * `MODEL_TARGET_KINDS` and `ModelEffectSchema` already carry — the generator's
   * output space stays *inside* the engine's, never equal to it. When a
   * generation run is authorized and its fixtures are re-recorded anyway, moving
   * an entry into `generatableTargets` is what admitting it costs.
   *
   * Absent and empty mean the same thing, so a row with nothing extra to say
   * omits it rather than writing an empty array.
   */
  readonly handAuthoredTargets?: readonly TargetKind[];
  /**
   * Range and shape of this effect's own parameters, wherever it is printed.
   * Reached from a spell's effect list and from a triggered ability's
   * (`validate/abilities.ts`), so one range table covers both placements.
   */
  readonly checkParams: (effect: EffectOf<K>, path: string, cardColors: readonly Color[]) => Violation[];
}

/**
 * Every primitive's rules. Mapped over the whole union, so a primitive added to
 * the vocabulary without stated targeting and parameter rules is a compile error
 * here, exactly as the `assertNever` default it replaces was.
 */
export type EffectRulesTable = { readonly [K in AnyEffectKind]: EffectRules<K> };

/**
 * One row with the caller's kind unknown: the union of the rows, not
 * `EffectRules<AnyEffectKind>`. `checkParams`'s parameter is contravariant, so
 * the widened row is a type no row satisfies.
 */
type EffectRulesRow = EffectRulesTable[AnyEffectKind];

/** Nothing to check: the effect carries no parameters of its own. */
const noParams = (): Violation[] => [];

function checkAddedSubtype(effect: EffectOf<'addSubtype'>, path: string): Violation[] {
  return SUBTYPE_PATTERN.test(effect.subtype)
    ? []
    : [
        violation(
          'INVALID_SUBTYPE',
          `${path}.subtype`,
          `subtype "${effect.subtype}" must be a capitalized word such as "Vampire"`,
        ),
      ];
}

function checkCoinFlipParams(effect: EffectOf<'flipCoin'>, path: string): Violation[] {
  const branches = [['winEffects', effect.winEffects] as const, ['loseEffects', effect.loseEffects] as const];
  const found: Violation[] = [];
  if (branches.every(([, effects]) => effects === undefined)) {
    found.push(
      violation(
        'RANDOM_BRANCH_INVALID',
        path,
        'a coin flip with neither a win nor a loss branch changes no outcome; provide at least one branch',
      ),
    );
  }
  for (const [field, effects] of branches) {
    for (const [index, nested] of (effects ?? []).entries()) {
      const target = hasTarget(nested) ? nested.target.kind : null;
      if (
        effectChoosesTarget(nested) ||
        (target !== null && target !== 'noTarget' && !isSourceBodyOnlyTarget(target))
      ) {
        found.push(
          violation(
            'RANDOM_BRANCH_INVALID',
            `${path}.${field}[${index}]`,
            'a coin-flip branch may use no target or its ability source; a separately chosen or externally retained target needs a nested target-binding contract',
          ),
        );
      }
    }
  }
  return found;
}

/** Switcheroo's one exact CR 701.10 target shape. */
function checkExchangeControlParams(effect: EffectOf<'exchangeControl'>, path: string): Violation[] {
  const switcheroo =
    effect.exchangeSource === undefined &&
    canonicalJson(effect.target) === '{"count":2,"kind":"targetCreature","minimum":2}';
  const conjuredCurrency =
    effect.exchangeSource === true &&
    canonicalJson(effect.target) === '{"kind":"targetPermanentYouNeitherOwnNorControl"}';
  return switcheroo || conjuredCurrency
    ? []
    : [
        violation(
          'ILLEGAL_TARGET_FOR_EFFECT',
          `${path}.target`,
          'exchange control requires exactly two target creatures unless using the exact source-and-permanent profile',
        ),
      ];
}

/** Keeps Augur's legacy selector and Grisly Salvage's new bundle indivisible. */
function checkSelectFromTopLibraryParams(
  effect: EffectOf<'selectFromTopLibrary'>,
  path: string,
): Violation[] {
  const grisly =
    effect.grislySalvageProfile === true &&
    effect.count === 5 &&
    effect.rest === 'graveyard' &&
    effect.revealAll === true &&
    canonicalJson(effect.filter) === '{"cardTypes":["creature","land"]}';
  const legacy =
    effect.grislySalvageProfile === undefined &&
    effect.count === 3 &&
    effect.rest === 'bottom' &&
    effect.revealAll === undefined;
  return grisly || legacy
    ? []
    : [
        violation(
          'EFFECT_CONDITION_INVALID',
          path,
          'selectFromTopLibrary admits only the legacy three-card bottom profile or the atomic Grisly Salvage five-card creature-or-land graveyard profile',
        ),
      ];
}

export const EFFECT_RULES: EffectRulesTable = {
  dealDamage: {
    generatableTargets: ['anyTarget', 'targetCreature', 'targetPlayer'],
    // `targetPlayerOrPlaneswalker` is the current Oracle wording of every burn
    // spell printed before planeswalkers were folded into the damage rules, and
    // it is hand-authored for `targetOpponent`'s reason at this same field: the
    // fill prompt prints the generatable list verbatim and every recorded
    // fixture is keyed to those bytes. Lava Axe and Chandra's Fury are the M13
    // cards that read it.
    //
    // `noTarget` is both a board sweep's slot and the source-controller slot:
    // Pyroclasm chooses nothing and reads a region of the board, while Jinxed
    // Idol chooses nobody and damages the controller fixed on its stack entry.
    // Both are hand-authored, so generated burn retains its narrower target
    // vocabulary.
    //
    // `thatCreaturesController` is Chandra's Outrage (M11 #128), the card this
    // whole referent lane exists for: "deals 4 damage to target creature and 2
    // damage to that creature's controller". Hand-authored for the reason every
    // other kind at this field is — the fill prompt prints the generatable list
    // verbatim and every recorded fixture is keyed to those bytes — and only
    // this one of the three referents, because no card in M11 or M13 deals
    // damage to a creature an earlier slot already chose, and a widening
    // arrives with the card that needs it.
    //
    // `triggeringPlayer` is Ash Zealot's retained caster. It is not a chosen
    // target and remains hand-authored; `checkAbilityEffectTarget` admits it
    // only when the surrounding trigger is in `TRIGGERING_PLAYER_CONDITIONS`.
    handAuthoredTargets: [
      'targetOpponent',
      'targetPlayerOrPlaneswalker',
      'noTarget',
      'thatCreaturesController',
      'targetCreatureDefendingPlayerControls',
      'targetCreatureYouDontControl',
      'chosenPlayer',
      'selfPermanent',
      'triggeringPlayer',
    ],
    checkParams: (effect, path) => [
      ...checkAmountRange(effect.amount, LIMITS.damage, `${path}.amount`, 'damage'),
      ...checkDamageDivision(effect, path),
      ...checkDamageCohortRiders(effect, path),
      ...(effect.opponentPlayerOrPlaneswalkerOnly === true &&
      effect.target.kind !== 'targetPlayerOrPlaneswalker'
        ? [
            violation(
              'ILLEGAL_TARGET_FOR_EFFECT',
              `${path}.opponentPlayerOrPlaneswalkerOnly`,
              'opponentPlayerOrPlaneswalkerOnly requires targetPlayerOrPlaneswalker',
            ),
          ]
        : []),
    ],
  },
  destroyPermanent: {
    generatableTargets: ['targetCreature'],
    // The sweeper half, hand-authored for the reason `putCounters`'s row gives
    // at the same field: a scoped form reaches a *player* and the permanents
    // are not targets (CR 115.1), and this kind is priced, so the fill prompt
    // prints its generatable list verbatim and every recorded fixture is keyed
    // to those bytes. Both player kinds, because a one-sided sweep is a card
    // aimed either way and neither direction is a gift to the wrong player.
    //
    // `targetArtifactOrEnchantment` is Disenchant, and it is hand-authored for
    // the first of those reasons only: the kind is legal in the engine and the
    // prompt's bytes are what keep it out of a generated card for now. This is
    // the row that made `removalArtifactEnchantment` print a tap instead.
    //
    // `targetPermanent` is the widest of them and the one the filter narrows:
    // Craterize, Demolish, Acidic Slime and Smelt are four printed cards that
    // differ only in which card types they admit, so the space is every
    // permanent and `TargetSpec.filter` says which. Hand-authored for the same
    // prompt-bytes reason as its neighbors.
    //
    // `noTarget` is Day of Judgment's slot, added with the untargeted scopes:
    // "destroy all creatures" chooses nothing (CR 115.1), so the space scope
    // needs a target spec that says so. `checkEffectScope` refuses an unscoped
    // destroy aimed at nobody.
    handAuthoredTargets: [
      'targetPlayer',
      'targetOpponent',
      'targetCreatureOpponentControls',
      'targetArtifactOrEnchantment',
      'targetArtifactYouDontControl',
      'targetPermanent',
      'noTarget',
      'selfPermanent',
    ],
    checkParams: checkDestroyPermanentParams,
  },
  pumpUntilEndOfTurn: {
    generatableTargets: ['targetCreature'],
    // CR 506.2's defending player, and the second row to state a hand-authored
    // extra. It sits here rather than in `generatableTargets` for the reason
    // `dealDamage`'s `targetOpponent` does — the prompt prints the generatable
    // half verbatim and every recorded fixture is keyed to those bytes — and
    // for a second reason of its own: the kind is legal only under a
    // `selfAttacks` trigger, and a slot menu cannot say that, so a generator
    // shown it would answer with it on a spell and fail validation.
    //
    // `selfCreature` is listed here, unlike `triggeringCreature` two rows up,
    // because the two kinds are gated at different layers. `triggeringCreature`
    // needs an ability-*condition* permission this table cannot express
    // (exalted, or `selfDealsCombatDamageToCreature`), so it bypasses this list
    // entirely through `checkAbilityEffectTarget`'s own permission check.
    // `selfCreature` needs only a fact about the *card* (`card.kind ===
    // 'creature'`), which `checkSourceReferentTarget` (`validate/abilities.ts`)
    // checks independently of this list rather than instead of it — so this
    // row still has to say the kind is targeting-legal on `pumpUntilEndOfTurn`
    // at all, the same statement every other member of this array makes.
    //
    // `noTarget` is Glorious Charge's slot, added with the untargeted scopes for
    // the reason `destroyPermanent`'s row gives at the same field.
    handAuthoredTargets: [
      'targetCreatureDefendingPlayerControls',
      'targetCreatureYouControl',
      'targetCreatureYouDontControl',
      'targetPlayer',
      'targetOpponent',
      'selfCreature',
      'enchantedCreature',
      'noTarget',
      // Traitorous Instinct retains the creature chosen by its temporary-
      // control effect. This is a reference, not another target choice, and
      // remains hand-authored so the model-visible target surface is unchanged.
      'thatCreature',
      'thatCreaturesController',
    ],
    checkParams: (effect, path) => checkPumpParams(effect, path),
  },
  drawCards: {
    generatableTargets: ['noTarget', 'targetPlayer'],
    // Righteous Authority's retained active player. Whole-ability validation
    // admits this only inside the atomic enchanted-controller draw-step bundle.
    handAuthoredTargets: ['triggeringPlayer'],
    checkParams: checkDrawParams,
  },
  gainLife: {
    generatableTargets: ['noTarget', 'targetPlayer'],
    handAuthoredTargets: ['thatCreaturesController'],
    checkParams: (effect, path) =>
      effect.amountFrom === 'thatPlayersHandSize'
        ? []
        : checkAmountRange(effect.amount, LIMITS.life, `${path}.amount`, 'life amount'),
  },
  counterSpell: {
    generatableTargets: [],
    // The one row whose parameters include a filter, because this is the one
    // primitive that narrows its target without carrying a `TargetSpec`: a
    // spell on the stack is outside the pinned targeting vocabulary, so Essence
    // Scatter and Negate say which spell through `spellFilter` instead.
    checkParams: (effect, path) => {
      const found = checkSpellFilter(effect.spellFilter, `${path}.spellFilter`);
      if (effect.unlessCost !== undefined && !('kind' in effect.unlessCost) && effect.unlessCost.hasX) {
        found.push(
          violation(
            'UNLESS_COST_IS_VARIABLE',
            `${path}.unlessCost`,
            'an {X} counter toll names no value chosen by the player being charged; state a fixed price',
          ),
        );
      } else if (
        effect.unlessCost !== undefined &&
        !('kind' in effect.unlessCost) &&
        manaValue(effect.unlessCost) === 0
      ) {
        found.push(
          violation(
            'UNLESS_COST_IS_FREE',
            `${path}.unlessCost`,
            'a counter toll of {0} never changes resolution; state a price or remove the toll',
          ),
        );
      }
      if (
        effect.dealDamageToControllerEqualToSpellPower === true &&
        !(
          effect.spellFilter?.cardTypes?.length === 1 &&
          effect.spellFilter.cardTypes[0] === 'creature' &&
          Object.keys(effect.spellFilter).length === 1
        )
      ) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${path}.dealDamageToControllerEqualToSpellPower`,
            'spell power is defined here only for a counter instruction restricted exactly to creature spells',
          ),
        );
      }
      return found;
    },
  },
  changeSpellTargets: {
    generatableTargets: [],
    checkParams: (effect, path) => checkSpellFilter(effect.spellFilter, `${path}.spellFilter`),
  },
  copySpell: {
    generatableTargets: [],
    checkParams: (effect, path) => checkCopySpellFilter(effect.spellFilter, `${path}.spellFilter`),
  },
  copyNextInstantOrSorceryThisTurn: {
    generatableTargets: [],
    checkParams: noParams,
  },
  populate: { generatableTargets: [], checkParams: noParams },
  createTokenCopyOfSelf: { generatableTargets: [], checkParams: noParams },
  createToken: {
    generatableTargets: [],
    checkParams: (effect, path) => [
      ...checkAmountRange(effect.count, LIMITS.tokenCount, `${path}.count`, 'token count'),
      ...checkTokenSpec(effect.token, `${path}.token`),
    ],
  },
  tapPermanent: {
    generatableTargets: ['targetCreature'],
    // The sweeper half, hand-authored for the reason `putCounters`'s row gives
    // at the same field: a scoped form reaches a *player* and the permanents
    // are not targets (CR 115.1), and this kind is priced, so the fill prompt
    // prints its generatable list verbatim and every recorded fixture is keyed
    // to those bytes. Both player kinds, because a one-sided sweep is a card
    // aimed either way and neither direction is a gift to the wrong player.
    //
    // `thatCreature` is Stabbing Pain (M11 #118): "Target creature gets -1/-1
    // until end of turn. Tap that creature." The pump slot ahead of it is the
    // one this kind reads (`referentSourceIndex`), and it needed no permission
    // of its own — a back-reference widens the row it is printed on, never the
    // row it points at.
    handAuthoredTargets: [
      'targetPlayer',
      'targetOpponent',
      'targetPermanent',
      'targetCreatureYouDontControl',
      'thatCreature',
    ],
    checkParams: noParams,
  },
  returnToHand: {
    generatableTargets: ['targetCreature'],
    // Blue's answer to a permanent it cannot destroy, and the reason this kind
    // is on three rows rather than one: without it a color with no destroy has
    // no answer to an artifact at all, which is a hole in the pie rather than a
    // deliberate weakness. Hand-authored because the prompt prints the
    // generatable half verbatim and every recorded fixture is keyed to it.
    handAuthoredTargets: [
      'targetArtifactOrEnchantment',
      'targetNonlandPermanentOpponentControls',
      'targetNonlandPermanentYouDontControl',
      'targetCreatureDefendingPlayerControls',
      'targetCardInYourGraveyard',
      'targetCardInAGraveyard',
      'selfPermanent',
    ],
    checkParams: noParams,
  },
  millCards: {
    generatableTargets: ['noTarget', 'targetPlayer'],
    // Mind Sculpt (M13 61) is "target opponent mills seven cards", and the
    // restriction is the whole card: a mill aimed at yourself is a self-mill
    // deck's engine and a mill aimed at the table is a different, symmetrical
    // effect. `discardCards` above carries the identical pair for the identical
    // reason — `MODEL_TARGET_KINDS` is the frozen four and has no
    // `targetOpponent`, so the narrow kind is stated here where it costs
    // nothing rather than in the prompt where it would re-record every fixture.
    // Crosstown Courier retains the player its source dealt combat damage to;
    // that event referent is not a CR 115 target and is available only inside
    // a trigger whose condition supplies it. The ability validator enforces
    // that second half, while keeping this widening outside the generator.
    handAuthoredTargets: ['targetOpponent', 'triggeringPlayer'],
    checkParams: checkMillParams,
  },
  putCounters: {
    // Fuse reads "target creature you control", and this is the only row that
    // may say so. `targetCreatureYouControl` arrived for that card; offering it
    // to `destroyPermanent` or a pump as well would be four rows widened by a
    // card nobody has designed, which is the growth this table is written by
    // hand to stop. The wider `targetCreature` stays legal beside it, because a
    // part fused onto an opponent's creature is a legal play and a bad one.
    generatableTargets: ['targetCreature', 'targetCreatureYouControl'],
    // The sweeper half, and it is hand-authored rather than generatable for the
    // reason `dealDamage`'s row states: this kind is priced, so the fill prompt
    // prints its generatable list verbatim and every recorded fixture is keyed
    // to those bytes. A scoped `putCounters` reaches a player and a player is
    // the one thing the unscoped form must never name, so the widening lands
    // here where no prompt can see it.
    //
    // `selfPermanent` is the flagship set's legendary artifact cycle
    // (`mtg-rji`): an artifact whose own upkeep trigger puts a counter on the
    // artifact. Before this word that card was unprintable twice over — no
    // kind in this row reached the ability's own source at all, and the one
    // kind that reaches a source anywhere in the vocabulary, `selfCreature`,
    // is refused on a card that is not a creature. It is hand-authored for the
    // same fixture-bytes reason as the row above, and it earns a second one:
    // the generator picks a slot's target from a menu with no card in front of
    // it, so a menu that offered "the source itself" would put the word on
    // spells, where `checkEffectTarget` refuses it.
    //
    // `selfCreature` is Quirion Dryad's exact current wording. It is distinct
    // from `selfPermanent`: the creature-only kind prints "this creature" and
    // `checkSourceReferentTarget` refuses it on noncreatures, while the broader
    // kind lets artifacts such as that cycle print "this permanent".
    // Both stay hand-authored so the generator's target menu remains unchanged.
    //
    // `noTarget` is Steel Overseer's slot (M11 214, `mtg-hfex`), and it arrives
    // with `permanentsYouControl` in `SCOPES_LEGAL_ON` below for the reason
    // `destroyPermanent`'s row gives at the same field: "put a +1/+1 counter on
    // each artifact creature you control" chooses nothing (CR 115.1) and reads
    // a region of the board, so the target spec has to be able to say "nobody".
    // `checkEffectScope` refuses the pairing it opens up — an unscoped counter
    // placement aimed at nobody, which would resolve into no game action.
    //
    // `targetCreatureDefendingPlayerControls` is CR 506.2's defending player,
    // hand-authored here for `pumpUntilEndOfTurn`'s two reasons at the same
    // field (`mtg-fz3s`): the generatable half's bytes are printed verbatim
    // into the fill prompt, and the kind is legal only under a `selfAttacks`
    // trigger, which a slot menu cannot say. "Whenever this creature attacks,
    // put a -1/-1 counter on target creature defending player controls" is the
    // standard attack-trigger template, and it was the one shape the set's
    // gloom vocabulary could not print.
    //
    // `thatCreature` is Mark of Mutiny (M13 141): the control effect chooses
    // one creature and the following counter instruction refers to that same
    // object without targeting it again. The shared referent validator proves
    // there is exactly one earlier creature target, so this adds no choice and
    // does not widen the generator-facing target menu.
    handAuthoredTargets: [
      'targetOpponent',
      'thatCreature',
      'selfCreature',
      'selfPermanent',
      'noTarget',
      'targetCreatureDefendingPlayerControls',
      'enchantedCreature',
      'equippedCreature',
    ],
    checkParams: (effect, path) => [
      ...checkAmountRange(effect.count, LIMITS.counterCount, `${path}.count`, 'counter count'),
      ...(effect.timing === 'nextEndStep' &&
      (effect.target.kind !== 'selfPermanent' || effect.scope !== undefined || effect.keyword !== undefined)
        ? [
            violation(
              'DELAYED_COUNTER_PLACEMENT_INVALID',
              path,
              'next-end-step counter placement must name only the source permanent, with no scope or keyword rider',
            ),
          ]
        : []),
      ...(effect.recipientCondition !== undefined &&
      (effect.target.kind !== 'equippedCreature' || effect.scope !== undefined)
        ? [
            violation(
              'EFFECT_CONDITION_INVALID',
              `${path}.recipientCondition`,
              'a counter recipient condition is legal only on one live equippedCreature referent',
            ),
          ]
        : []),
    ],
  },
  exileTarget: {
    // Three forms split by `scope`. Unscoped, this is `destroyPermanent`'s row
    // with one word changed and answers a creature. A targeted-player scope
    // targets the player and not the creatures (CR 115.1). A board-region scope
    // targets nothing and uses `scopeFilter` to name the permanents. The row has
    // to admit all three target shapes, and `checkEffectScope` below is what
    // stops them being mixed.
    //
    // Which of those the *generator* may reach was settled the moment `mtg-q5yg`
    // priced this kind, because a priced kind's generatable list is printed
    // verbatim into the fill prompt. `ZoneReachingModelEffectSchema` shows the
    // model this primitive without its scope, so the scoped half is unreachable
    // and a player kind offered here would be a target the model can name and
    // the validator must then refuse. It moves down to `handAuthoredTargets`
    // beside the artifact-or-enchantment kind, which moves for the neighboring
    // reason: `MODEL_TARGET_KINDS` is the frozen four and has no word for it.
    // Altar's Light is still the printing a hand-authored card gets from it:
    // "Exile target artifact or enchantment."
    generatableTargets: ['targetCreature'],
    // `targetPermanent` is Celestial Purge, "exile target black or red
    // permanent", and it joins for `destroyPermanent`'s reason at the same
    // field: one space and a filter, rather than a kind per printed selector.
    // `noTarget` is Mass Polymorph's board-region sweep; the scope/filter pair
    // makes "all creatures you control" complete without choosing anything.
    handAuthoredTargets: [
      'targetOpponent',
      'targetArtifactOrEnchantment',
      'targetPermanent',
      'targetCreatureOpponentControls',
      'targetCardInYourGraveyard',
      'targetCardInOpponentsGraveyard',
      'targetCardInAGraveyard',
      'noTarget',
    ],
    checkParams: (effect, path) => {
      const cohort = effect.sameNameCohort;
      const mixedCreatures = effect.creatureBattlefieldOrGraveyard === true;
      const exactCohortTarget =
        effect.target.kind === 'targetPermanent' &&
        canonicalJson(effect.target) === '{"filter":{"excludeCardTypes":["land"]},"kind":"targetPermanent"}';
      return [
        ...(mixedCreatures &&
        (effect.linkToSource !== true ||
          effect.scope !== undefined ||
          effect.returnAtNextEndStep !== undefined ||
          cohort !== undefined ||
          canonicalJson(effect.target) !==
            '{"count":3,"excludeSource":true,"filter":{"cardTypes":["creature"]},"kind":"targetPermanent"}')
          ? [
              violation(
                'SOURCE_LINKED_EXILE_INVALID',
                path,
                'creatureBattlefieldOrGraveyard is exactly the source-linked up-to-three other-creature target with no other exile riders',
              ),
            ]
          : []),
        ...(cohort !== undefined &&
        (effect.linkToSource !== true ||
          effect.scope !== undefined ||
          effect.returnAtNextEndStep !== undefined ||
          !exactCohortTarget)
          ? [
              violation(
                'SOURCE_LINKED_EXILE_INVALID',
                path,
                'sameNameCohort is exactly the unscoped source-linked nonland-permanent target with no other target riders',
              ),
            ]
          : []),
        ...(effect.linkToSource !== true
          ? []
          : [
              ...(effect.scope !== undefined || effect.returnAtNextEndStep !== undefined
                ? [
                    violation(
                      'SOURCE_LINKED_EXILE_INVALID',
                      path,
                      'a source-linked targeted exile is unscoped and has no delayed return; its paired source trigger owns the return',
                    ),
                  ]
                : []),
              ...(effect.target.kind !== 'targetPermanent' ||
              (cohort === undefined && effect.target.excludeSource !== true) ||
              (cohort !== undefined && effect.target.excludeSource === true)
                ? [
                    violation(
                      'SOURCE_LINKED_EXILE_INVALID',
                      `${path}.target`,
                      cohort === undefined
                        ? 'a source-linked targeted exile names another target permanent so the source cannot enter its own relation'
                        : 'the same-name cohort excludes every permanent with the printed forbidden name rather than only the source object',
                    ),
                  ]
                : []),
            ]),
      ];
    },
  },
  revealHand: {
    // A hand is somebody's, so this reaches a player and nothing else. The
    // generator retains the opponent-only shape it was priced around; the
    // hand-authored widening is Search Warrant's source-attested "target
    // player", which may legally name its caster too.
    generatableTargets: ['targetOpponent'],
    handAuthoredTargets: ['targetPlayer'],
    checkParams: noParams,
  },
  revealRandomCardFromHand: {
    // Merfolk Spy names the player its combat-damage event already supplied.
    // No CR 115 target is chosen, and admitting an ordinary player target here
    // would silently turn "that player" into a different card.
    generatableTargets: [],
    handAuthoredTargets: ['triggeringPlayer'],
    checkParams: noParams,
  },
  playRandomHandCardWithoutPayingManaCost: {
    // The upkeep event supplies the affected player. Keeping ordinary targets
    // out prevents hand-authored cards from redirecting the retained random
    // choice after the trigger has fired.
    generatableTargets: [],
    handAuthoredTargets: ['triggeringPlayer'],
    checkParams: noParams,
  },
  scry: { generatableTargets: [], checkParams: noParams },
  reorderTopLibrary: { generatableTargets: [], checkParams: noParams },
  selectFromTopLibrary: {
    generatableTargets: [],
    checkParams: checkSelectFromTopLibraryParams,
  },
  separateTopLibraryIntoPiles: { generatableTargets: [], checkParams: noParams },
  returnFromGraveyard: {
    // A graveyard is somebody's, so this reaches a player and nothing else —
    // `revealHand`'s reasoning one row up, with the opposite width. Both kinds
    // are legal, because "return all creature cards from your graveyard" and
    // "…from target opponent's graveyard" are both cards somebody would print,
    // and each returns those cards under their own owner's control, so neither
    // is a gift to the wrong player.
    //
    // Only the wider of the two is generatable, and the split is `exileTarget`'s
    // one row up: `MODEL_TARGET_KINDS` has `targetPlayer` and no `targetOpponent`,
    // so offering the narrower kind in the prompt would name a word the model
    // cannot say. Nothing is lost by it — `targetPlayer` reaches an opponent as
    // readily as it reaches you, and which one a given card should aim at is the
    // model's decision rather than the vocabulary's.
    generatableTargets: ['targetPlayer'],
    handAuthoredTargets: [
      'targetOpponent',
      'noTarget',
      'targetCardInYourGraveyard',
      'targetCardInAGraveyard',
    ],
    checkParams: checkReturnFromGraveyardParams,
  },
  addMana: {
    // No target at all, `scry`'s shape: mana goes to the ability's own
    // controller, which `ApplyContext` already carries, and "add mana to target
    // player's pool" is not a sentence Magic prints.
    generatableTargets: [],
    checkParams: (effect, path) =>
      checkAmountRange(effect.amount, LIMITS.manaAmount, `${path}.amount`, 'mana amount'),
  },
  createEmblem: { generatableTargets: [], checkParams: noParams },
  fight: {
    // Stated as generatable rather than hand-authored, and the generator still
    // cannot reach it. `LEGAL_TARGETS` is built from this half alone, and
    // `exhaustiveness.test.ts` asserts a targeted kind has a non-empty entry
    // there — so an empty list here would make the one totality gate over this
    // table read `fight` as untargeted. `revealHand` is the standing precedent
    // for an unpriced kind stating a generatable target. What keeps the model
    // out is `ModelEffectSchema`, which has no `fight` member at all, and
    // `RoleProfile.effectKinds`, which is `readonly EffectKind[]` and so cannot
    // name an unpriced kind.
    generatableTargets: ['targetCreatureYouDontControl'],
    // Cyclops Gladiator's attack trigger names CR 506.2's defending player.
    // The target kind is hand-authored because it is legal only inside a
    // `selfAttacks` trigger, a placement constraint the generator schema does
    // not express; `checkAbilityEffectTarget` enforces that boundary.
    handAuthoredTargets: ['targetCreatureDefendingPlayerControls'],
    checkParams: noParams,
  },
  petrifyCreature: {
    // The primitive itself is absent from ModelEffectSchema; this nonempty row
    // states that its one target-bearing shape is a creature.
    generatableTargets: ['targetCreature'],
    checkParams: noParams,
  },
  // The library and graveyard block. Four of the five state no targets at all,
  // and that is a fact about the zones rather than a narrowing: a library and a
  // graveyard are reached by whose they are, and each of these four says whose
  // in a field of its own — the controller for three of them, `whose` for the
  // fourth. There is nothing left for a `TargetSpec` to name.
  shuffleLibrary: { generatableTargets: [], checkParams: noParams },
  revealTopCards: { generatableTargets: [], checkParams: noParams },
  revealTopCardToHand: { generatableTargets: [], checkParams: noParams },
  putOnLibrary: {
    // The one targeted member, and it points where `returnToHand` points: at a
    // permanent, which is the only card a `TargetKind` can name outside a
    // public zone. Artifacts and enchantments are hand-authored beside it for
    // `exileTarget`'s stated reason — `MODEL_TARGET_KINDS` is the frozen four
    // and has no word for that kind — and `fight` is the standing precedent for
    // an unpriced row stating a generatable target that no model can reach,
    // because `ModelEffectSchema` has no member for this kind at all.
    generatableTargets: ['targetCreature'],
    handAuthoredTargets: ['targetArtifactOrEnchantment'],
    checkParams: noParams,
  },
  putSourceAndTargetOnOwnersLibrariesThenShuffle: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature'],
    checkParams: noParams,
  },
  exileGraveyard: {
    generatableTargets: [],
    handAuthoredTargets: ['targetPlayer'],
    checkParams: noParams,
  },
  shuffleGraveyardIntoLibrary: { generatableTargets: [], checkParams: noParams },
  searchLibrary: {
    generatableTargets: [],
    checkParams: checkSearchLibraryParams,
  },
  moveSourceLinkedExile: { generatableTargets: [], checkParams: noParams },
  exileNonbasicGraveyardAndMatchingLibrary: {
    generatableTargets: [],
    handAuthoredTargets: ['targetPlayer'],
    checkParams: noParams,
  },
  eachPlayerNamesCardThenRevealsTop: { generatableTargets: [], checkParams: noParams },
  nameNonlandCardAndExileMatchingOpponentZones: {
    generatableTargets: [],
    handAuthoredTargets: ['targetOpponent'],
    checkParams: noParams,
  },
  revealUntilCreatureCards: { generatableTargets: [], checkParams: noParams },
  // The hand block. Both reach a *player*, because a hand is somebody's, and
  // both stop the resolution to ask which cards leave it — so neither names a
  // card, and there is nothing here for a second `TargetSpec` slot to hold.
  // The printed count is bounded by `MAX_DISCARD_COUNT` in the schema, which
  // is where `scry` and `revealTopCards` already put theirs, so `chooseDiscard`
  // has nothing left to check; the one thing `discardCards` checks is the pair
  // its `noTarget` slot belongs to.
  discardCards: {
    // Both choosing player kinds, and the wider one is the generatable half for
    // `returnFromGraveyard`'s stated reason: `MODEL_TARGET_KINDS` has
    // `targetPlayer` and no `targetOpponent`. A discard aimed at yourself is a
    // real card rather than a degenerate one — every looting and madness
    // enabler is exactly that — so nothing is lost by offering the wide kind.
    //
    // `noTarget` is hand-authored for both untargeted controller discards
    // (Thoughtflare) and player sweeps (Liliana's Specter). `players`, when
    // present, replaces the controller with its named seats; when absent, the
    // resolving controller owns the hand. It stays off `generatableTargets`
    // because the whole effect kind remains outside `ModelEffectSchema`.
    // `thatCreaturesController` is the retained, non-choosing projection used
    // when an earlier effect targeted a creature; admitting it here adds no
    // second target slot and no model-visible shape.
    generatableTargets: ['targetPlayer'],
    handAuthoredTargets: [
      'targetOpponent',
      'noTarget',
      // Rakdos Ringleader's combat-damage event supplies the damaged player;
      // this is a retained referent, not a second CR 115 choice.
      'triggeringPlayer',
      'thatCreaturesController',
      'thatPlayerOrPlaneswalkerController',
    ],
    checkParams: (effect, path) =>
      effect.countFrom === 'chosenX' && effect.count !== 1
        ? [
            violation(
              'ILLEGAL_REFERENT_AMOUNT',
              `${path}.count`,
              'countFrom chosenX supplies the whole discard count, so the literal count sentinel must be 1',
            ),
          ]
        : [],
  },
  chooseDiscard: {
    // `revealHand`'s row, narrowed the same way and for the same sentence: a
    // hand is somebody's, and "reveal your own hand and choose a card you
    // discard" is a clause no card in this vocabulary wants. It is the rider
    // that row's docblock says the vocabulary had no way to print, so the two
    // agree on width by construction rather than by coincidence.
    generatableTargets: ['targetOpponent'],
    // The filter is optional here where `searchLibrary` and
    // `chooseFromGraveyard` both require one, so this is the row that has to
    // ask whether there is anything to check at all.
    checkParams: (effect, path) =>
      effect.filter === undefined ? [] : checkCardFilterLists(effect.filter, `${path}.filter`),
  },
  chooseFromRevealedHand: {
    // Mindclaw chooses a target opponent when its trigger is stacked; Shimian
    // reads the damaged player retained by its combat-damage trigger. Those are
    // the two source-attested player slots and no permanent-shaped slot is
    // admitted merely because every object has an owner.
    generatableTargets: ['targetOpponent'],
    handAuthoredTargets: ['triggeringPlayer'],
    checkParams: (effect, path) => checkCardFilterLists(effect.filter, `${path}.filter`),
  },
  loseLife: {
    // `gainLife`'s two slots plus the one that says whose loss it is. All three
    // are stated as generatable and none of them is reachable by a model, for
    // `fight`'s stated reason: the kind is absent from `EFFECT_KINDS`, so no
    // slot menu can offer it, and `LEGAL_TARGETS` is built from this half
    // alone — an empty list here would make the one totality gate over this
    // table read a targeted kind as untargeted.
    //
    // `targetOpponent` is the row that matters, and it is here for the printed
    // targeted line alone: "target opponent loses 2 life". It used to be here
    // for "each opponent loses 2 life" as well, on the argument that a two-seat
    // kernel makes the one opponent the whole group. That line is a scope now
    // (`players: 'eachOpponent'`, `PLAYER_SWEEP_FIELD` in `effects.ts`), and it
    // never was this row: CR 115.1 makes a target chosen and a scope not, which
    // is a difference in what the kernel does rather than in how many seats it
    // does it to. The sweep is unreachable from here in any case, because
    // `players` is not a target and this table only says which slots may be
    // filled.
    generatableTargets: ['noTarget', 'targetPlayer', 'targetOpponent'],
    // `thatPlayer` is Sign in Blood (M11 #117, M13 #110), whose printed
    // sentence names one person and whose DSL encoding is two effects — so
    // before this row the second effect chose its own player and the kernel
    // offered a cast that drew for one and drained the other. Hand-authored
    // rather than generatable for the reason `dealDamage`'s referent row is:
    // the fill prompt prints the generatable list verbatim and the recorded
    // fixtures are keyed to those bytes.
    // `thatCreaturesController` is Launch Party (RTR #69): the destroy effect
    // chooses the creature and the following life loss projects its controller
    // without adding another target. Like the other retained slots, it stays
    // hand-authored so this exact card does not widen the generator menu.
    handAuthoredTargets: ['thatPlayer', 'thatCreaturesController', 'triggeringPlayer'],
    checkParams: (effect, path) =>
      effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp'
        ? effect.amount === 0
          ? []
          : [
              violation(
                'ILLEGAL_REFERENT_AMOUNT',
                `${path}.amount`,
                'triggeringPlayerLifeHalfRoundedUp supplies the whole live amount, so the literal amount field must be 0',
              ),
            ]
        : checkAmountRange(effect.amount, LIMITS.life, `${path}.amount`, 'life amount'),
  },
  setLife: {
    // No target at all, `scry`'s shape and `addMana`'s reason: the life total
    // set is the controller's, which `ApplyContext` already carries, and every
    // card that prints the line says "your" rather than "target".
    generatableTargets: [],
    // The same range a life gain is held to, and a floor of one for the reason
    // that row has one: a card whose text sets a life total to zero is a card
    // that reads "you lose the game", which is not what any printing of this
    // line says. A computed amount that *evaluates* to zero is a different
    // matter and is left alone — Touch of the Eternal counts artifacts, and
    // controlling none of them is a board state rather than a printed lie.
    checkParams: (effect, path) =>
      checkAmountRange(effect.amount, LIMITS.life, `${path}.amount`, 'life total'),
  },
  loseGame: {
    generatableTargets: [],
    // Vraska's Assassin token retains the player it dealt combat damage to;
    // this is a trigger referent, not a second CR 115 choice.
    handAuthoredTargets: ['targetPlayer', 'triggeringPlayer'],
    checkParams: noParams,
  },
  winGame: { generatableTargets: [], checkParams: noParams },
  preventCombatDamage: { generatableTargets: [], checkParams: noParams },
  preventCombatDamageToYou: { generatableTargets: [], checkParams: noParams },
  detainPermanent: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreatureOpponentControls', 'targetNonlandPermanentOpponentControls'],
    checkParams: noParams,
  },
  chooseBlockersThisCombat: { generatableTargets: [], checkParams: noParams },
  preventAllDamageToYouAndCreaturesYouControl: { generatableTargets: [], checkParams: noParams },
  preventNextDamageToYouAndRetaliate: {
    generatableTargets: ['targetPlayerOrPlaneswalker'],
    handAuthoredTargets: ['noTarget'],
    checkParams: (effect, path) => {
      const found = checkAmountRange(effect.amount, LIMITS.damage, `${path}.amount`, 'prevention amount');
      if (
        effect.target.kind !== 'noTarget' &&
        (isLiteralAmount(effect.amount) || effect.amount.kind !== 'chosenX')
      ) {
        found.push(
          violation(
            'EFFECT_CONDITION_INVALID',
            `${path}.amount`,
            'the retaliation arm reads the X announced by its activation; only the untargeted shield arm may state another amount',
          ),
        );
      }
      return found;
    },
  },
  cantCastSpellsThisTurn: { generatableTargets: [], checkParams: noParams },
  protectSpellsAndCreaturesFromSpellColorsThisTurn: {
    generatableTargets: [],
    checkParams: noParams,
  },
  flipCoin: { generatableTargets: [], checkParams: checkCoinFlipParams },
  // The sibling CR 615 shape: not a wider Fog, the *other* printed card
  // (Dawn Charm's first mode). Stated as generatable rather than
  // hand-authored, `fight`'s and `putCounters`' reason exactly: the target
  // list is what `LEGAL_TARGETS` reads, and `handAuthoredTargets` is for
  // widening a row that is otherwise reachable — this kind is not, the whole
  // of it is off `EFFECT_KINDS` and `MODEL_EFFECT_KINDS`, so there is nothing
  // for the target rider to widen past.
  preventAllDamageToTarget: { generatableTargets: ['targetCreature'], checkParams: noParams },
  // `searchLibrary`'s targeting row exactly, and for its sentence: the effect
  // names no target, and the graveyard it reads is named by `whose` rather than
  // targeted, which is where this row would otherwise have had something to
  // say. Its parameters no longer all fit in the schema, though. `whose`,
  // `destination` and `maxManaValue` are still pinned by their own types, and a
  // `CardFilter` whose every field is absent is Demonic Tutor rather than a
  // mistake — but `control` and `alsoBecomes` are legal only against a
  // battlefield destination, and Zod cannot say that about a sibling field
  // without turning the object into a union the generator would have to read.
  chooseFromGraveyard: { generatableTargets: [], checkParams: checkGraveyardChoiceParams },
  chooseFromBattlefield: {
    generatableTargets: [],
    checkParams: (effect, path) => checkPermanentFilterLists(effect.filter, `${path}.filter`),
  },
  // Three kinds and no `handAuthoredTargets`, `preventAllDamageToTarget`'s
  // arrangement one row up and for its reason: the whole of this kind is off
  // `EFFECT_KINDS` and `MODEL_EFFECT_KINDS`, so there is no generatable row for
  // a hand-authored rider to widen past and the list is simply stated.
  //
  // `targetPermanent` is the space Voltaic Key needs and the only one a
  // `TargetSpec.filter` may narrow (`checkTargetFilter` refuses a card-type
  // filter on every kind that has already fixed its types by being the kind it
  // is), so "untap target artifact" and "untap target land" are this kind
  // wearing a filter rather than two more members of `TARGET_KINDS`.
  //
  // The two creature kinds are here because they are what the printed sentence
  // says, not because the space needs them: "untap target creature you control"
  // is a different English clause from "untap target permanent" aimed at the
  // same board, and a card that means the first should not have to print the
  // second. `thatCreature` is Act of Treason's second clause. The shared
  // referent machinery validates and resolves its one earlier creature slot,
  // so it creates no second choice.
  untapPermanent: {
    generatableTargets: ['targetPermanent', 'targetCreature', 'targetCreatureYouControl'],
    handAuthoredTargets: ['selfCreature', 'thatCreature'],
    checkParams: noParams,
  },
  // A resolution-time battlefield choice, not a CR 115 target. The schema
  // bounds the count and requires the filter; no target mode is legal here.
  untapPermanents: { generatableTargets: [], checkParams: noParams },
  // The unpriced one-shot hold reaches a permanent directly when a spell
  // chooses one. An ability may project a retained `triggeringCreature` into
  // either of these unrestricted permanent spaces, but only after its trigger
  // grants the referent; `checkAbilityEffectTarget` checks both halves.
  skipNextUntap: {
    generatableTargets: ['targetPermanent', 'targetCreature'],
    checkParams: noParams,
  },
  // Every creature slot the combat trick beside it reaches, and no wider.
  //
  // `pumpUntilEndOfTurn` states one generatable kind and hands the rest to
  // `handAuthoredTargets` because its prompt bytes are pinned to recorded
  // fixtures. This kind has no prompt at all — it is off `EFFECT_KINDS`
  // entirely — so the whole list is stated here and there is nothing for a
  // hand-authored row to widen past, which is `untapPermanent`'s arrangement
  // one row up.
  //
  // The three are the three English subjects a printed keyword grant has that
  // this table is the right one to say: the spell's chosen creature, the
  // chosen creature it is allowed to own, and the ability's own source
  // ("whenever this creature attacks, it gains trample"). `targetPermanent` is
  // absent and stays absent -- `AbilityChangeEffect` adds an ability to
  // whatever it names, and "target land gains flying" is a sentence the layer
  // would honor and no card in this world wants to print.
  //
  // `triggeringCreature` is absent for the reason `pumpUntilEndOfTurn` leaves
  // it out of both its lists: `checkAbilityEffectTarget` answers that kind from
  // the printed trigger's permissions and returns before it ever reads this
  // table, so a row here would be a claim no checker consults and one the
  // Forge conformance test would then have to be told to ignore.
  //
  // `noTarget` is Overwhelming Stampede's slot, and it arrived with the scope
  // (`mtg-nhyv.15`) for the reason `pumpUntilEndOfTurn`'s row gives at the same
  // field: a space scope chooses nobody (CR 115.1), so the card needs a slot
  // that names nobody. It is a fourth English subject rather than a fourth
  // creature — the group the spell's controller already has — and
  // `checkEffectScope` is what keeps it from ever standing alone, since an
  // unscoped grant aimed at nothing lands on nobody.
  grantKeywordUntilEndOfTurn: {
    generatableTargets: ['targetCreature', 'targetCreatureYouControl', 'selfCreature', 'noTarget'],
    handAuthoredTargets: ['thatCreature', 'equippedCreature'],
    checkParams: (effect, path) => checkGrantKeywordParams(effect, path),
  },
  regeneratePermanent: {
    generatableTargets: [],
    handAuthoredTargets: ['equippedCreature', 'noTarget'],
    checkParams: noParams,
  },
  // One creature, whoever controls it. The whole list sits in
  // `generatableTargets` for the reason the row above states: this kind is off
  // `EFFECT_KINDS`, so no prompt prints it and there is nothing for a
  // hand-authored row to widen past.
  //
  // `targetCreature` and nothing narrower, because Goblin Tunneler's line
  // ("target creature with power 2 or less") narrows through a
  // `TargetRestriction` rather than through a target kind, and nothing wider,
  // because CR 509.1b is a rule about blocking a *creature* and "target
  // permanent can't be blocked" is a sentence with no referent.
  cantBeBlockedThisTurn: {
    generatableTargets: ['targetCreature'],
    handAuthoredTargets: ['targetCreatureYouControl', 'selfCreature', 'thatCreature'],
    checkParams: noParams,
  },
  // The blocker-side restriction names exactly one creature. It is
  // hand-authored by containment, so this row changes no model prompt.
  cantBlockThisTurn: {
    generatableTargets: ['targetCreature'],
    checkParams: noParams,
  },
  // Courtly names one creature; Predatory Rampage names a controller-relative
  // board region and therefore carries `noTarget` plus a creature filter.
  blocksThisTurnIfAble: {
    generatableTargets: ['targetCreature', 'noTarget'],
    checkParams: noParams,
  },
  // One creature, and only one an opponent controls. The requirement names the
  // ability's controller as the defender, so aimed at a creature that player
  // already controls it is a sentence asking a creature to attack its own
  // controller — CR 508.1a makes that unsatisfiable rather than illegal, and a
  // row that admits it would be a printed line the kernel silently ignores.
  // Alluring Siren says "target creature an opponent controls" for exactly this
  // reason and the row says the same thing.
  attacksYouThisTurnIfAble: {
    generatableTargets: ['targetCreatureYouDontControl'],
    checkParams: noParams,
  },
  // The source and nothing else. `selfCreature` is a retained referent rather
  // than a chosen target (CR 115.6a), and carrying it is what makes the effect
  // print the noun the card prints — "sacrifice this creature" — without a
  // card-kind parameter reaching `renderEffect`.
  //
  // `selfPermanent` is the noncreature source spelling Sorcerer's Strongbox
  // needs. `checkSourceReferentTarget` keeps a creature on `selfCreature`, so
  // the wider row does not let one creature card spell the same behavior two
  // ways.
  //
  // Nothing generatable, which is a stronger statement than the empty rows
  // above it: `scry` and `addMana` state `[]` because they name no target at
  // all, and this one states `[]` because the one kind it admits is
  // hand-authored. The kind is off `EFFECT_KINDS` entirely, so there is no
  // prompt whose printed list this narrows and nothing keyed to those bytes.
  sacrificeSelf: {
    generatableTargets: [],
    handAuthoredTargets: ['selfCreature', 'selfPermanent'],
    checkParams: noParams,
  },
  // The two player kinds, `discardCards`' exact split and for the same
  // reason: `targetPlayer` is the wide generatable half `MODEL_TARGET_KINDS`
  // carries, `targetOpponent` is hand-authored only. `sacrificePermanent` is
  // itself off `generatableEffects` (`mtg-4g77`'s containment cut, matching
  // `discardCards`), so neither list is read by a model prompt today — this
  // is the row a future generator lane finds already correct rather than
  // still to write.
  //
  // `noTarget` is the player sweep's slot, Destructive Force's addition. It is
  // hand-authored for the same containment reason as the whole primitive, and
  // `checkSacrificePermanentParams` refuses it without `players` while the
  // shared `checkPlayerSweep` refuses the inverse mismatch.
  sacrificePermanent: {
    generatableTargets: ['targetPlayer'],
    handAuthoredTargets: [
      'targetOpponent',
      'triggeringPlayer',
      'noTarget',
      'thatPlayerOrPlaneswalkerController',
    ],
    checkParams: checkSacrificePermanentParams,
  },
  // `sacrificeSelf`'s empty generatable half, for the same reason stated one
  // different way: this kind is off `EFFECT_KINDS`, so no fill prompt prints
  // this list and no `EFFECT_RANGES` line prices it. `targetCreature` and
  // nothing else — Diminish names a creature, and a base P/T on anything that
  // is not a creature is a record layer 7b has nowhere to put.
  setBasePtUntilEndOfTurn: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature'],
    checkParams: checkBasePtParams,
  },
  animateLandWhileSourceOnBattlefield: {
    generatableTargets: [],
    handAuthoredTargets: ['targetPermanent'],
    checkParams: checkLandAnimationParams,
  },
  animateSourceUntilEndOfTurn: {
    generatableTargets: [],
    handAuthoredTargets: ['selfPermanent'],
    checkParams: checkSourceAnimationParams,
  },
  returnSourceFromGraveyard: { generatableTargets: [], checkParams: noParams },
  returnDepartedSourceToOwnerHand: { generatableTargets: [], checkParams: noParams },
  putDepartedSourceOnTopOfOwnerLibrary: { generatableTargets: [], checkParams: noParams },
  shuffleSourceIntoOwnerLibrary: { generatableTargets: [], checkParams: noParams },
  setColorsUntilEndOfTurn: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature'],
    checkParams: noParams,
  },
  attacksThisTurnIfAble: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature', 'thatCreature'],
    checkParams: noParams,
  },
  shuffleHandsAndGraveyardsIntoLibraries: { generatableTargets: [], checkParams: noParams },
  exileHandsAndGraveyards: { generatableTargets: [], checkParams: noParams },
  exileThisSpell: { generatableTargets: [], checkParams: noParams },
  castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts: {
    generatableTargets: [],
    checkParams: noParams,
  },
  // Act of Treason's first clause and nothing wider. Later effects retain this
  // slot through `thatCreature`; this effect itself is the one real choice.
  gainControlUntilEndOfTurn: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature'],
    checkParams: noParams,
  },
  gainControl: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature'],
    checkParams: noParams,
  },
  exchangeControl: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature', 'targetPermanentYouNeitherOwnNorControl'],
    checkParams: checkExchangeControlParams,
  },
  addSubtype: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreature', 'thatCreature'],
    checkParams: checkAddedSubtype,
  },
  // The opponent is the target; the affected permanent is the ability source.
  // This is Jinxed Idol's exact hand-authored envelope rather than a wider
  // player-selection primitive the corpus has not established.
  targetPlayerGainsControlOfSelfPermanent: {
    generatableTargets: [],
    handAuthoredTargets: ['targetOpponent'],
    checkParams: noParams,
  },
  returnSourceAuraAttached: {
    generatableTargets: [],
    handAuthoredTargets: ['targetCreatureYouDontControl'],
    checkParams: noParams,
  },
  doubleSourceCounters: {
    generatableTargets: [],
    checkParams: noParams,
  },
  destroyAttachedPermanents: {
    generatableTargets: [],
    handAuthoredTargets: ['thatCreature', 'targetPermanent'],
    checkParams: checkDestroyAttachedPermanentsParams,
  },
};

/**
 * The generatable half of `EFFECT_RULES`, which is what the fill prompt prints.
 * Derived rather than restated, so the prompt and the validator cannot disagree.
 */
export const LEGAL_TARGETS: Readonly<Record<AnyEffectKind, readonly TargetKind[]>> = (() => {
  const table = {} as Record<AnyEffectKind, readonly TargetKind[]>;
  for (const kind of ALL_EFFECT_KINDS) table[kind] = EFFECT_RULES[kind].generatableTargets;
  return table;
})();

/** The hand-authored half of `EFFECT_RULES`, keyed only where a row states one. */
export const HAND_AUTHORED_TARGETS: Readonly<Partial<Record<AnyEffectKind, readonly TargetKind[]>>> = (() => {
  const table: Partial<Record<AnyEffectKind, readonly TargetKind[]>> = {};
  for (const kind of ALL_EFFECT_KINDS) {
    const extra = EFFECT_RULES[kind].handAuthoredTargets;
    if (extra !== undefined) table[kind] = extra;
  }
  return table;
})();

/**
 * Every target kind an effect may name, whoever wrote the card.
 *
 * The one table the validator, the kernel's recheck and the Forge mapping are
 * all asserted against; the two halves above exist only so the prompt can read
 * the narrower one.
 */
export function legalTargetsFor(kind: AnyEffectKind): readonly TargetKind[] {
  const extra = HAND_AUTHORED_TARGETS[kind];
  return extra === undefined ? LEGAL_TARGETS[kind] : [...LEGAL_TARGETS[kind], ...extra];
}

/**
 * Numeric ranges the vocabulary is allowed to name. Exported because
 * `validate/abilities.ts` checks a printed modification's numbers against the
 * same table a spell's are checked against.
 *
 * `pumpDelta` and `statBonusDelta` were one entry until 2026-08-13, on the
 * argument that a static ability's P/T bonus is the same quantity a pump is.
 * They are two now, and the reason is a card: Last-Blow Obliterator prints
 * `+99/-3`, so the ceiling on a *printed, permanent* modification had to move
 * and the ceiling on a one-shot pump spell did not. Splitting them is what kept
 * the widening to the thing that asked for it — every `pumpUntilEndOfTurn` in
 * the vocabulary is still held to `-8..8`.
 *
 * `statBonusDelta` is deliberately still one entry for both placements a
 * modification has, a lord's static line and a weapon's equip clause, because
 * `checkModification` reads it for both: a weapon that could ship a bonus a lord
 * could not would be a rule about where a number is printed rather than about
 * the number.
 *
 * Two digits is what the wider bound means, and it is a statement about what a
 * card face can print and a renderer can fit, not about what a format can
 * survive. Whether a set is playable at these numbers is measured rather than
 * asserted, by the seeded balance gate in `@mtg/metrics`.
 */
export const LIMITS = {
  damage: { min: 1, max: 12 },
  pumpDelta: { min: -8, max: 8 },
  statBonusDelta: { min: -99, max: 99 },
  draw: { min: 1, max: 6 },
  life: { min: 1, max: 20 },
  mill: { min: 1, max: 20 },
  sacrificeCount: { min: 1, max: 20 },
  tokenCount: { min: 1, max: 8 },
  tokenPower: { min: 0, max: 12 },
  tokenToughness: { min: 1, max: 12 },
  /**
   * What `setBasePtUntilEndOfTurn` may print, and deliberately the same two
   * bounds as the token stat line directly above rather than a reference to
   * it: both bound a *printed* creature's power and toughness, so today they
   * agree, but they answer to different pressures — the token bounds move when
   * what a generator may mint moves, and these move when what a
   * characteristic-setting spell may say moves. One name per bound, so a
   * change to either states which one it meant.
   *
   * Toughness floors at 1 for the reason a token's does: a base toughness of 0
   * is a creature that dies as a state-based action the instant the effect
   * applies, which is a destroy spell written the long way round.
   */
  basePower: { min: 0, max: 12 },
  baseToughness: { min: 1, max: 12 },
  // Five is source-attested by RTR's fixed-power scavenge creatures. The
  // primitive remains hand-authored-only, so this does not widen model output.
  counterCount: { min: 1, max: 5 },
  /**
   * `controlsSubtype`'s floor. A threshold above roughly a deck's worth of one
   * subtype is unreachable on any board this generator can build, so it is a
   * printed lie in the same way a damage effect above `damage.max` is: the
   * number is decorative because the game the card describes never happens.
   */
  conditionThreshold: { min: 1, max: 20 },
  /**
   * How much mana one `addMana` may add.
   *
   * The ceiling is `MAX_MANA_PRODUCED`, which is also `producesMana`'s length
   * bound, and the two are the same number on purpose (that constant's
   * docblock says why). The floor is one, because a mana ability that adds
   * nothing is a card that prints a sentence and does not do it — the same
   * failure `draw` and `life` have floors of one for.
   */
  manaAmount: { min: 1, max: MAX_MANA_PRODUCED },
} as const;

export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * The message is shared and the code is not: a range is a range wherever it is
 * checked, but the caller decides which part of the card the reader should look
 * at, and consumers branch on the code rather than the words.
 */
export function checkRange(
  value: number,
  range: Range,
  path: string,
  label: string,
  code: ViolationCode = 'EFFECT_PARAM_OUT_OF_RANGE',
): Violation[] {
  if (value >= range.min && value <= range.max) return [];
  return [violation(code, path, `${label} must be between ${range.min} and ${range.max}, got ${value}`)];
}

/**
 * The same range check, applied to the half of an `Amount` that has a range.
 *
 * **The range table is about literals only, and that is a decision rather than
 * an omission.** `LIMITS` exists to stop the generator printing 40 damage; it is
 * a guard on numerals a model chose. A computed amount has no numeral to check —
 * "the number of cards exiled this way" is between zero and the size of a board
 * — and the two ways of pretending otherwise are both worse than declining.
 * Refusing every computed amount would delete the primitive; clamping one at
 * resolution would print a card that says one number and deals another, which
 * is the exact failure this whole vocabulary exists to prevent.
 *
 * What keeps it safe is the other gate: no generated card can carry a computed
 * amount, because `ModelEffectSchema` is built over `z.int()`. So the unchecked
 * half is the hand-authored half, and a hand-authored number is somebody's
 * decision rather than a model's.
 *
 * A rate is the one computed shape that does have a numeral, and it gets the
 * check: "-1/-1 for each Swamp you control" prints the -1 outright, and the
 * argument above for declining does not reach it — the count is what nobody can
 * bound, not the rate. The range is charged against the rate rather than
 * against the product, which is the same reading `LIMITS.pumpDelta` already has
 * for `statBonusPer` and the only one available: a rate times a board is
 * unbounded by construction, and a card that says -1 per Swamp is a normal card
 * on a board with nine of them.
 */
function checkAmountRange(
  amount: PumpAmount,
  range: Range,
  path: string,
  label: string,
  code: ViolationCode = 'EFFECT_PARAM_OUT_OF_RANGE',
): Violation[] {
  if (isLiteralAmount(amount)) return checkRange(amount, range, path, label, code);
  return isRateAmount(amount) ? checkRange(amount.rate, range, `${path}.rate`, `${label} rate`, code) : [];
}

function checkMillParams(effect: EffectOf<'millCards'>, path: string): Violation[] {
  const found = [...checkAmountRange(effect.count, LIMITS.mill, `${path}.count`, 'mill count')];
  if (effect.printedVariable === 'X' && isLiteralAmount(effect.count)) {
    found.push(
      violation(
        'MILL_PRESENTATION_INVALID',
        `${path}.printedVariable`,
        'the printed X form needs a computed count to define X; use the literal count directly',
      ),
    );
  }
  if (
    effect.printedOneCardReminder === true &&
    (effect.count !== 1 || (effect.target.kind !== 'targetPlayer' && effect.target.kind !== 'targetOpponent'))
  ) {
    found.push(
      violation(
        'MILL_PRESENTATION_INVALID',
        `${path}.printedOneCardReminder`,
        'the one-card mill reminder is legal only on a one-card effect targeting a player',
      ),
    );
  }
  if (
    !isLiteralAmount(effect.count) &&
    effect.count.kind === 'halfTargetLibraryRoundedDown' &&
    effect.target.kind !== 'targetPlayer' &&
    effect.target.kind !== 'targetOpponent'
  ) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.count.kind`,
        'halfTargetLibraryRoundedDown reads the chosen player library, so the mill effect needs a player target',
      ),
    );
  }
  return found;
}

/** The canonical sacrifice forms: one targeted seat, this controller, or a player sweep. */
function checkSacrificePermanentParams(effect: EffectOf<'sacrificePermanent'>, path: string): Violation[] {
  const found =
    effect.count === undefined
      ? []
      : checkRange(effect.count, LIMITS.sacrificeCount, `${path}.count`, 'sacrifice count');
  if (effect.filter !== undefined) {
    // Unlike an ordinary target filter, an empty sacrifice filter is not a
    // second spelling of omission: omission is the canonical one-creature
    // edict, while `{}` explicitly means every permanent.
    if (!targetFilterIsEmpty(effect.filter)) {
      found.push(...checkPermanentFilterLists(effect.filter, `${path}.filter`));
    }
  }
  return found;
}

export function effectUsesChosenX(effect: unknown): boolean {
  const contains = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(contains);
    if (typeof value !== 'object' || value === null) return false;
    if ('countFrom' in value && (value as { readonly countFrom?: unknown }).countFrom === 'chosenX') {
      return true;
    }
    if ('kind' in value && (value as { readonly kind?: unknown }).kind === 'chosenX') return true;
    return Object.values(value).some(contains);
  };
  return contains(effect);
}

/**
 * A token states a body or states none, and stating half of one is neither.
 *
 * `TokenSpec` leaves `power` and `toughness` optional so that "an artifact
 * token with no power or toughness" is expressible without a 0/0 the
 * state-based actions would bury (`effects.ts`, `token.ts`). The pair is the
 * type line: both means a creature token, neither means an artifact token, and
 * one means a design nobody wrote. `tokenCard` reads it that way and would
 * silently drop the lone number, so the coded violation is what stops that
 * being silent — the same argument `checkCreatureStats` makes when it refuses
 * an instant carrying a power.
 */
function checkTokenBody(token: TokenSpec, path: string): Violation[] {
  if (token.creationPowerToughness !== undefined) {
    if (
      token.characteristicPowerToughness !== undefined ||
      !isCreatureTokenSpec(token) ||
      token.power !== 0 ||
      token.toughness !== 0
    ) {
      return [
        violation(
          'CREATION_POWER_TOUGHNESS_CONFLICT',
          `${path}.creationPowerToughness`,
          'a creation-defined token is a creature and uses canonical 0/0 storage with no characteristic-defining value',
        ),
      ];
    }
    return [];
  }
  if (token.characteristicPowerToughness !== undefined) {
    if (!isCreatureTokenSpec(token) || token.power !== 0 || token.toughness !== 0) {
      return [
        violation(
          'CHARACTERISTIC_POWER_TOUGHNESS_CONFLICT',
          `${path}.characteristicPowerToughness`,
          'a characteristic-defining token is a creature and uses canonical 0/0 storage rather than fixed printed stats',
        ),
      ];
    }
    return [];
  }
  if (isCreatureTokenSpec(token)) {
    return [
      ...checkRange(token.power, LIMITS.tokenPower, `${path}.power`, 'token power'),
      ...checkRange(token.toughness, LIMITS.tokenToughness, `${path}.toughness`, 'token toughness'),
    ];
  }
  if (token.power === undefined && token.toughness === undefined) return [];
  const stated = token.power === undefined ? 'toughness' : 'power';
  const missing = token.power === undefined ? 'power' : 'toughness';
  return [
    violation(
      'TOKEN_STATS_INCOMPLETE',
      `${path}.${missing}`,
      `this token states a ${stated} and no ${missing}; a creature token states both, and an artifact token states neither`,
    ),
  ];
}

/**
 * Every violation, moved under the path of the effect that declares the token.
 *
 * The checks below are run against the card the kernel will actually build for
 * this token, so they report paths inside that card (`abilities[0].cost`). A
 * repair loop is editing the *creating* card, where that ability sits at
 * `effects[0].token.abilities[0].cost`, so the prefix is prepended rather than
 * the messages being rewritten.
 */
function underToken(path: string, found: readonly Violation[]): Violation[] {
  return found.map((entry) =>
    violation(entry.code, entry.path.length === 0 ? path : `${path}.${entry.path}`, entry.message),
  );
}

/**
 * A token's name is a name, not its printed line.
 *
 * `TokenSpecSchema` caps the field at 80 characters and can say nothing else
 * about it, so a generator that packs the token's rules text into the name emits
 * a set that parses and is wrong everywhere the name is shown: on the
 * battlefield, inside the oracle text of every card that creates it, in the
 * Forge token script, and in the id `tokenSlug` derives for its art. Observed in
 * a live regeneration of the flagship set as
 * `Wyrmhead Horn — Fuse: Sacrifice this: +1/+1 counter on a creature you control`.
 *
 * Same family as `TOKEN_STATS_INCOMPLETE`: a shape the schema cannot express,
 * checked where the token's other fields are checked.
 *
 * Shape and length are two checks because they catch two mistakes. The pattern
 * catches the punctuation only rules text carries; the bound catches the same
 * paragraph written in plain words, which every character class here admits. A
 * 71-character run of ordinary capitalized words passed this function until
 * `TOKEN_NAME_MAX_LENGTH` was added beside the pattern, and that is the shape a
 * repair produces when it is told to take the punctuation out and nothing tells
 * it to say less.
 */
function checkTokenName(token: TokenSpec, path: string): Violation[] {
  if (!TOKEN_NAME_PATTERN.test(token.name)) {
    return [
      violation(
        'INVALID_TOKEN_NAME',
        `${path}.name`,
        `token name ${JSON.stringify(token.name)} is not a name: a token is named in capitalised words, apostrophes and hyphens ("Reaper's Scythe"), and anything else here is rules text that landed in the name field`,
      ),
    ];
  }
  if (token.name.length <= TOKEN_NAME_MAX_LENGTH) return [];
  return [
    violation(
      'INVALID_TOKEN_NAME',
      `${path}.name`,
      `token name ${JSON.stringify(token.name)} is ${token.name.length} characters; a token is named in at most ${TOKEN_NAME_MAX_LENGTH}, which is what a card face draws, and a longer one is rules text that landed in the name field`,
    ),
  ];
}

/**
 * `control` and `alsoBecomes` are sentences about a permanent, so the only
 * destination that can read either is the battlefield. A card put into its
 * owner's hand or shuffled into a library has an owner and no controller, and
 * shows none of its characteristics to anything; CR 400.7 then makes the object
 * that arrives a new object, so a grant recorded on the way there would be a
 * grant on something that no longer exists. Refusing the combination here is
 * the difference between an author being told and the kernel quietly dropping
 * the field.
 *
 * A grant with neither list is the same shape of nothing. `GraveyardArrivalGrant`
 * makes each list optional so a card may add types without colors or colors
 * without types, which leaves `{}` as the one combination that adds nothing "in
 * addition to its other" anything.
 */
/**
 * A `CardFilter` that cannot be satisfied, or that says one thing twice.
 *
 * `checkFilterLists` for the other filter, and only the two rules that survive
 * the move. That function also refuses card types the *slot* can never hold —
 * a permanent is never an instant — and there is no such rule here: this filter
 * reads a library, a graveyard or a revealed hand, and every card type reaches
 * all three. What is left is the pair of mistakes that are wrong about the
 * filter itself rather than about where it points.
 *
 * One function for all three effects that carry a `CardFilter`, which is
 * `asPrintedFilter`'s argument in `kernel/src/scry.ts` said on the validation
 * side: `searchLibrary`, `chooseFromGraveyard` and `chooseDiscard` read one
 * shape, so a rule wired into one of them and not the others would make the
 * same printed mistake legal on two cards out of three.
 *
 * It arrived with `excludeCardTypes` and it is why that field could be added
 * without widening a gap. Before it, this filter had no validator at all, on
 * the stated ground that "a `CardFilter` whose every field is absent is Demonic
 * Tutor rather than a mistake" — true of an *empty* filter, and no argument at
 * all about a filter that wants and refuses the same card type. That one names
 * the empty set while reading as though it selects, which is exactly the class
 * of card this lane was opened to stop shipping.
 */
export function checkCardFilterLists(filter: CardFilter, path: string): Violation[] {
  const found: Violation[] = [];
  if (filter.anyOf !== undefined) {
    return filter.anyOf.flatMap((alternative, index) =>
      checkCardFilterLists(alternative, `${path}.anyOf[${String(index)}]`),
    );
  }
  const lists: readonly (readonly [string, readonly string[] | undefined])[] = [
    ['cardTypes', filter.cardTypes],
    ['excludeCardTypes', filter.excludeCardTypes],
    ['subtypes', filter.subtypes],
    ['supertypes', filter.supertypes],
    ['colors', filter.colors],
    ['keywords', filter.keywords],
    ['names', filter.names],
  ];
  for (const [field, list] of lists) {
    if (list === undefined) continue;
    if (new Set(list).size !== list.length) {
      found.push(
        violation('ILLEGAL_CARD_FILTER', `${path}.${field}`, `"${field}" names the same value twice`),
      );
    }
  }
  const both = (filter.cardTypes ?? []).filter((kind) => (filter.excludeCardTypes ?? []).includes(kind));
  if (both.length > 0) {
    found.push(
      violation(
        'ILLEGAL_CARD_FILTER',
        path,
        `card type "${both.join(', ')}" is listed as both wanted and excluded, so nothing can ever satisfy this filter`,
      ),
    );
  }
  return found;
}

function checkSearchLibraryParams(effect: EffectOf<'searchLibrary'>, path: string): Violation[] {
  const filterQuotas = effect.filterQuotas;
  const found =
    filterQuotas !== undefined
      ? filterQuotas.flatMap((quota, index) =>
          checkCardFilterLists(quota.filter, `${path}.filterQuotas[${String(index)}].filter`),
        )
      : effect.filter === undefined
        ? [violation('ILLEGAL_CARD_FILTER', `${path}.filter`, 'a homogeneous search needs a card filter')]
        : checkCardFilterLists(effect.filter, `${path}.filter`);
  if (
    effect.destination === 'libraryTop' &&
    ((filterQuotas !== undefined && filterQuotas.reduce((sum, quota) => sum + quota.count, 0) !== 1) ||
      (filterQuotas === undefined && effect.count !== undefined && effect.count !== 1))
  ) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.count`,
        'the library-top search destination places one chosen card on top; use a one-card search',
      ),
    );
  }
  if (
    effect.destination === 'sourceLinkedExile' &&
    ((filterQuotas !== undefined && filterQuotas.reduce((sum, quota) => sum + quota.count, 0) !== 1) ||
      (filterQuotas === undefined && effect.count !== undefined && effect.count !== 1))
  ) {
    found.push(
      violation(
        'SOURCE_LINKED_EXILE_INVALID',
        `${path}.count`,
        'the current linked return says "the exiled card" and therefore needs a one-card search; add plural linked-return vocabulary before widening this count',
      ),
    );
  }
  if (typeof effect.destination === 'string') return found;
  if (effect.destination.kind === 'oneAndRest' && effect.destination.one === effect.destination.rest) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.destination`,
        'a one-and-rest search must name two different destinations; use the single destination form otherwise',
      ),
    );
  }
  if (
    filterQuotas !== undefined ||
    effect.count === undefined ||
    (typeof effect.count === 'number' && effect.count < 2)
  ) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.count`,
        'a one-and-rest search needs a count that can find at least two cards so both destinations are reachable',
      ),
    );
  }
  return found;
}

function checkGraveyardArrivalParams(
  destination: 'battlefield' | 'hand' | 'exile',
  control: 'you' | 'owner' | undefined,
  grant: GraveyardArrivalGrant | undefined,
  path: string,
): Violation[] {
  const found: Violation[] = [];
  if (destination !== 'battlefield') {
    if (control !== undefined) {
      found.push(
        violation(
          'EFFECT_PARAM_OUT_OF_RANGE',
          `${path}.control`,
          `control is a property of a permanent, and a card put into a ${destination} has an owner and no controller; drop the field or send the card to the battlefield`,
        ),
      );
    }
    if (grant !== undefined) {
      found.push(
        violation(
          'EFFECT_PARAM_OUT_OF_RANGE',
          `${path}.alsoBecomes`,
          `an added color or type is read off a permanent, and a card put into a ${destination} shows neither; drop the field or send the card to the battlefield`,
        ),
      );
    }
  }
  if (grant === undefined) return found;
  if (grant.colors === undefined && grant.subtypes === undefined) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.alsoBecomes`,
        'an arrival grant with neither colors nor subtypes adds nothing; state one of the two lists or drop the field',
      ),
    );
  }
  for (const [index, subtype] of (grant.subtypes ?? []).entries()) {
    if (!SUBTYPE_PATTERN.test(subtype)) {
      found.push(
        violation(
          'INVALID_SUBTYPE',
          `${path}.alsoBecomes.subtypes[${index}]`,
          `subtype "${subtype}" must be a capitalized word such as "Zombie"`,
        ),
      );
    }
  }
  return found;
}

function checkReturnFromGraveyardParams(effect: EffectOf<'returnFromGraveyard'>, path: string): Violation[] {
  const found = [
    ...checkGraveyardArrivalParams(
      effect.destination ?? 'battlefield',
      effect.control,
      effect.alsoBecomes,
      path,
    ),
    ...(effect.scope !== undefined && effect.alsoBecomes !== undefined
      ? [
          violation(
            'EFFECT_PARAM_OUT_OF_RANGE',
            `${path}.alsoBecomes`,
            'an arrival grant refers to the one targeted card; a scoped graveyard return moves a group and cannot supply that singular referent',
          ),
        ]
      : []),
  ];
  if (effect.fromBattlefieldThisTurn !== true) return found;
  if (effect.scope !== undefined) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.scope`,
        'the battlefield-this-turn selector already defines the complete graveyard cohort',
      ),
    );
  }
  if (effect.destination === 'hand') {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.destination`,
        'the battlefield-this-turn cohort returns to the battlefield',
      ),
    );
  }
  if (effect.control !== undefined) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.control`,
        'the battlefield-this-turn cohort returns each card under its ordinary controller',
      ),
    );
  }
  if (effect.alsoBecomes !== undefined) {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.alsoBecomes`,
        'the battlefield-this-turn cohort grants no arrival characteristics',
      ),
    );
  }
  if (effect.target.kind !== 'noTarget') {
    found.push(
      violation(
        'EFFECT_PARAM_OUT_OF_RANGE',
        `${path}.target`,
        "the battlefield-this-turn cohort is untargeted and reads the resolving controller's graveyard",
      ),
    );
  }
  return found;
}

function checkGraveyardChoiceParams(effect: EffectOf<'chooseFromGraveyard'>, path: string): Violation[] {
  return [
    ...checkCardFilterLists(effect.filter, `${path}.filter`),
    ...checkGraveyardArrivalParams(effect.destination, effect.control, effect.alsoBecomes, path),
  ];
}

function checkTokenSpec(token: TokenSpec, path: string): Violation[] {
  const found: Violation[] = [...checkTokenName(token, path), ...checkTokenBody(token, path)];
  if (token.inlineQuotedAbilities === true && token.quoteAbilities !== true) {
    found.push(
      violation(
        'EFFECT_CONDITION_INVALID',
        `${path}.inlineQuotedAbilities`,
        'inlineQuotedAbilities is a presentation of quoted token rules and requires quoteAbilities',
      ),
    );
  }
  if (token.printedKeywordReminder !== undefined && !token.keywords.includes(token.printedKeywordReminder)) {
    found.push(
      violation(
        'EFFECT_CONDITION_INVALID',
        `${path}.printedKeywordReminder`,
        `the printed ${token.printedKeywordReminder} reminder requires the token to have that keyword`,
      ),
    );
  }
  for (const [index, subtype] of token.subtypes.entries()) {
    if (!SUBTYPE_PATTERN.test(subtype)) {
      found.push(
        violation(
          'INVALID_TOKEN_SUBTYPE',
          `${path}.subtypes[${index}]`,
          `token subtype "${subtype}" must be a capitalised word such as "Beast"`,
        ),
      );
    }
  }
  // A token's keywords and printed abilities are legal exactly where the same
  // keywords and abilities are legal on the card the token becomes, so they go
  // through the card's own checks rather than through a token-shaped copy of
  // them. That is what makes "a `self` static needs a creature" and "abilities
  // belong on permanents" true of a token for free, and what stops a token
  // vocabulary drifting away from a card's.
  const card = tokenCard(token);
  found.push(...underToken(path, [...checkKeywords(card), ...checkAbilities(card)]));
  return found;
}

/**
 * Range and shape of one effect's own parameters, wherever the effect is
 * printed. Exported because a triggered ability carries the same effects a
 * spell does (`validate/abilities.ts`), and two hand-maintained copies of the
 * damage range are two chances to widen one of them.
 */
export function checkEffectParams(
  effect: Effect,
  path: string,
  cardColors: readonly Color[],
  allowSourceExclusion = false,
): Violation[] {
  const rules: EffectRulesRow = EFFECT_RULES[effect.kind];
  // The one place this file narrows by assertion rather than by control flow.
  // `rules` is the union of rows and `effect` is the union of effects, and
  // TypeScript will not relate the two through a shared index it has already
  // read; the mapped table above is what makes the pairing true for every key,
  // so the assertion restates a fact the type of `EFFECT_RULES` proves.
  const check = rules.checkParams as (e: Effect, p: string, c: readonly Color[]) => Violation[];
  const sourceExclusionInvalid =
    hasTarget(effect) &&
    effect.target.excludeSource === true &&
    !isSourceLinkedExileWriter(effect) &&
    !allowSourceExclusion;
  const sourceExclusion = !sourceExclusionInvalid
    ? []
    : effect.target.kind === 'targetPermanent'
      ? [
          violation(
            'SOURCE_LINKED_EXILE_INVALID',
            `${path}.target.excludeSource`,
            'excludeSource on a permanent target is legal only on the reviewed source-linked targeted exile shape',
          ),
        ]
      : [
          violation(
            'SOURCE_EXCLUSION_INVALID',
            `${path}.target.excludeSource`,
            'excludeSource is legal only when the containing ability supplies a reviewed source-relative target context',
          ),
        ];
  const targetedFightShape =
    isTargetedFight(effect) && canonicalJson(effect.target) !== '{"kind":"targetCreatureYouDontControl"}'
      ? [
          violation(
            'ILLEGAL_TARGET_FOR_EFFECT',
            `${path}.target`,
            'the targeted fight form requires exactly targetCreatureYouDontControl with no riders',
          ),
        ]
      : [];
  return [...sourceExclusion, ...targetedFightShape, ...check(effect, path, cardColors)];
}

function checkEffectTarget(effect: Effect, path: string): Violation[] {
  if (!hasTarget(effect)) return [];
  if (effect.target.kind === 'triggeringCreature') {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        'triggeringCreature is a retained trigger referent, not a target a spell may choose',
      ),
    ];
  }
  if (effect.target.kind === 'triggeringPlayer') {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        'triggeringPlayer is a retained trigger referent, not a target a spell may choose',
      ),
    ];
  }
  if (effect.target.kind === 'chosenPlayer') {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        'chosenPlayer is retained by a linked permanent trigger, not a target a spell may choose',
      ),
    ];
  }
  if (isSourceBodyOnlyTarget(effect.target.kind)) {
    // A spell on the stack is not a permanent, so it has no source body for
    // "this creature" or "this permanent" to name — the same absence
    // `unless.ts`'s `UNLESS_PAYER_TARGETS` docblock gives for
    // `triggeringCreature`, one row up: the referent these kinds retain is a
    // fact about an *ability*, and a spell's own effect list is not printed on
    // one.
    //
    // Asked of `SOURCE_BODY_ONLY_TARGETS` rather than of the one literal it
    // used to name, so `selfPermanent` (`mtg-rji`) was refused on instants and
    // sorceries the moment it was appended. The message names the kind it
    // caught, which is what the literal form gave for free and a list form has
    // to do on purpose.
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        `${effect.target.kind} names the ability's own source, not a target a spell may choose`,
      ),
    ];
  }
  if (isSourceAttachmentTarget(effect.target.kind)) {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        `${effect.target.kind} names the permanent attached to an ability's source, not a target a spell may choose`,
      ),
    ];
  }
  if (isSourceAttackTarget(effect.target.kind)) {
    // "Defending player" is CR 506.2, a role that exists only inside a combat
    // this source is attacking in. A spell has no such combat to read, so this
    // is refused here for the same reason `triggeringCreature` is one clause
    // up: the phrase would print without a referent.
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        'targetCreatureDefendingPlayerControls needs an ability whose source is attacking and is never legal on a spell',
      ),
    ];
  }
  const legal = legalTargetsFor(effect.kind);
  if (!legal.includes(effect.target.kind)) {
    return [
      violation(
        'ILLEGAL_TARGET_FOR_EFFECT',
        `${path}.target.kind`,
        `${effect.kind} cannot use target "${effect.target.kind}"; legal targets are ${legal.join(', ')}`,
      ),
    ];
  }
  return [
    ...checkTargetRestriction(effect.target, path),
    ...checkTargetFilter(effect.target, path),
    ...checkTargetCardinality(effect, path),
  ];
}

/**
 * The card types that reach the stack as a spell, which is every kind but a
 * land: playing a land uses no stack at all (CR 305.9), so it is never a spell
 * and never counterable.
 *
 * Derived from `CARD_KINDS` rather than listed, so a card type added later is
 * counterable the day it is added unless it is a second land-like kind, which
 * would be the one thing worth failing here.
 */
const SPELL_CASTABLE_CARD_KINDS: readonly CardKind[] = CARD_KINDS.filter((kind) => kind !== 'land');

/**
 * The rules a filter's own lists obey wherever it is read: a target slot, a
 * board sweep's `scopeFilter`, or the stack.
 *
 * Nine of them, and every one closes a second spelling of a card or a slot
 * nothing can ever fill rather than a mechanically impossible one. An empty filter is "no constraint" written the
 * long way, and `checkDuplicateEffects` compares effects by `canonicalJson`, so
 * `[destroy{filter:{}}, destroy]` would print one sentence twice and compare as
 * two different effects. A repeated member is the same trick inside one list. A
 * value in both a positive and its negative list is a slot nothing can ever
 * fill, which is a card that reads like removal and plays like a blank. And a
 * card type outside the space the filter is read against — an instant on the
 * battlefield, a land on the stack — is the same blank with a different cause.
 *
 * The two that arrived with `subtypes` (`mtg-nhyv.56`) are a subtype beside a
 * card type — CR 205.3 gives each subtype to one card type, so the pair says
 * the dimension twice and leaves `targetNounPhrase` two candidates for one
 * noun — and a subtype that is not a capitalized word, which is the identical
 * check `Card.subtypes` gets in `validate/typeline.ts` and the reason the field
 * holds free strings rather than an enum.
 *
 * The three that arrived with `allCardTypes` (`mtg-nhyv.2`) are the union and
 * the conjunction in one filter — the dimension stated twice, and the same
 * duplicate-encoding argument `min(2)` makes inside the field itself — a
 * conjunction naming an instant or a sorcery beside a second type, which CR
 * 205.2a says no object is, and the same wanted-and-excluded check the union
 * already gets.
 *
 * `subject` names the space in the message, because the author reading it needs
 * to know which of the two halves refused them.
 */
function checkFilterLists(
  filter: TargetFilter,
  path: string,
  reachableCardTypes: readonly CardKind[],
  subject: string,
): Violation[] {
  const found: Violation[] = [];
  if (targetFilterIsEmpty(filter)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        path,
        'a filter that states no constraint is "no filter" written the long way; leave the field out',
      ),
    );
    return found;
  }
  if (filter.cardTypes !== undefined && filter.allCardTypes !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        path,
        '"cardTypes" asks which of these types the object may be and "allCardTypes" asks which of them it must all be; a filter carrying both states the dimension twice, and one card must have one encoding',
      ),
    );
  }
  // CR 205.3: a subtype belongs to exactly one card type, so naming both says
  // the dimension twice and names the objects the subtype alone already names.
  // It is also what keeps one printed sentence per filter: `targetNounPhrase`
  // hands the noun to the subtype on `targetPermanent`, so a filter carrying
  // both would have two candidates for one noun and "target Forest land" would
  // be a second spelling of "target Forest" (`mtg-nhyv.56`).
  if (filter.subtypes !== undefined && (filter.cardTypes ?? filter.allCardTypes) !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        path,
        `subtype "${filter.subtypes.join('", "')}" already fixes the card type it can appear on (CR 205.3), so naming a card type beside it states the dimension twice; drop the card types`,
      ),
    );
  }
  for (const subtype of filter.subtypes ?? []) {
    if (SUBTYPE_PATTERN.test(subtype)) continue;
    found.push(
      violation(
        'INVALID_SUBTYPE',
        `${path}.subtypes`,
        `subtype "${subtype}" must be a capitalized word such as "Goblin"`,
      ),
    );
  }
  const spellKinds = (filter.allCardTypes ?? []).filter((kind) => SPELL_CARD_KINDS.includes(kind));
  if (spellKinds.length > 0 && (filter.allCardTypes ?? []).length > 1) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.allCardTypes`,
        `an ${spellKinds.join(' or ')} is never anything else (CR 205.2a), so a conjunction naming it beside another card type is a filter nothing can ever satisfy`,
      ),
    );
  }
  const lists: readonly (readonly [string, readonly string[] | undefined])[] = [
    ['cardTypes', filter.cardTypes],
    ['allCardTypes', filter.allCardTypes],
    ['excludeCardTypes', filter.excludeCardTypes],
    ['subtypes', filter.subtypes],
    ['colors', filter.colors],
    ['excludeColors', filter.excludeColors],
    ['keywords', filter.keywords],
    ['excludeKeywords', filter.excludeKeywords],
  ];
  for (const [field, list] of lists) {
    if (list === undefined) continue;
    if (new Set(list).size !== list.length) {
      found.push(
        violation('ILLEGAL_TARGET_FILTER', `${path}.${field}`, `"${field}" names the same value twice`),
      );
    }
  }
  const pairs: readonly (readonly [string, readonly string[] | undefined, readonly string[] | undefined])[] =
    [
      ['card type', filter.cardTypes, filter.excludeCardTypes],
      ['card type', filter.allCardTypes, filter.excludeCardTypes],
      ['color', filter.colors, filter.excludeColors],
      ['keyword', filter.keywords, filter.excludeKeywords],
    ];
  for (const [what, wanted, excluded] of pairs) {
    if (wanted === undefined || excluded === undefined) continue;
    const both = wanted.filter((value) => excluded.includes(value));
    if (both.length > 0) {
      found.push(
        violation(
          'ILLEGAL_TARGET_FILTER',
          path,
          `${what} "${both.join(', ')}" is listed as both wanted and excluded, so nothing can ever satisfy this filter`,
        ),
      );
    }
  }
  for (const [field, list] of [
    ['cardTypes', filter.cardTypes],
    ['allCardTypes', filter.allCardTypes],
    ['excludeCardTypes', filter.excludeCardTypes],
  ] as const) {
    const unreachable = (list ?? []).filter((kind) => !reachableCardTypes.includes(kind));
    if (unreachable.length > 0) {
      found.push(
        violation(
          'ILLEGAL_TARGET_FILTER',
          `${path}.${field}`,
          `${subject} is never ${unreachable.join(' or ')}; legal card types here are ${reachableCardTypes.join(', ')}`,
        ),
      );
    }
  }
  return found;
}

/** Validates a current-characteristic filter read over battlefield permanents. */
export function checkPermanentFilterLists(filter: TargetFilter, path: string): Violation[] {
  return checkFilterLists(filter, path, PERMANENT_CARD_KINDS, 'a permanent');
}

/**
 * A filter narrows a choice among objects, so it is legal on the kinds that
 * make one among objects only.
 *
 * The refusal worth stating is the one for `anyTarget` and
 * `targetPlayerOrPlaneswalker`: both draw from a player space and an object
 * space at once, so a filter on either would enforce the printed condition
 * against half the slot's own legal targets and say nothing about the rest —
 * a card that reads as narrow and plays as wide against the wrong board.
 *
 * The card-type half is narrower again, and it closes a duplicate encoding
 * rather than an impossibility: `targetPermanent` with `{artifact,
 * enchantment}` is `targetArtifactOrEnchantment` spelled a second way, and one
 * card must have one encoding for `checkDuplicateEffects` to be able to compare
 * two effects at all. That kind keeps the pair because 177 cards in Forge's
 * 2.0.14 `res/cardsfolder` write it as one selector and every committed card
 * that answers a permanent already names it.
 */
function checkTargetFilter(target: TargetSpec, path: string): Violation[] {
  const filter = targetFilterOf(target);
  if (filter === null) return [];
  const at = `${path}.target.filter`;
  if (!filterFitsTargetKind(target.kind)) {
    return [
      violation(
        'ILLEGAL_TARGET_FILTER',
        at,
        `a filter narrows a choice among objects; "${target.kind}" names ${targetKindNamesAPlayer(target.kind) ? 'a player' : 'no object to narrow, or draws from a player as well'}`,
      ),
    ];
  }
  const found: Violation[] = [];
  const graveyardTarget = isGraveyardCardTargetKind(target.kind);
  const namesACardType =
    filter.cardTypes !== undefined ||
    filter.allCardTypes !== undefined ||
    filter.excludeCardTypes !== undefined;
  if (namesACardType && !cardTypeFilterFitsTargetKind(target.kind)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        at,
        `"${target.kind}" has already fixed its card types by being the kind it is; only "targetPermanent" and graveyard-card targets leave that question open`,
      ),
    );
  }
  // The one field this filter carries that a target slot already had a word
  // for. `TargetRestriction.withKeyword` is where Plummet and Air Servant write
  // it, and admitting both spellings on one slot would give "destroy target
  // creature with flying" two canonical forms — `checkDuplicateEffects`
  // compares effects by `canonicalJson`, so the two would stop comparing equal
  // and one card would have two encodings. The field exists for the group a
  // restriction cannot reach: a board sweep names `noTarget`, and
  // `checkTargetRestriction` refuses a restriction there because it is not a
  // choice at all.
  if (filter.keywords !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.keywords`,
        `a target slot names a keyword with the "withKeyword" restriction; write { restriction: { kind: "withKeyword", keyword: "${filter.keywords[0] ?? 'flying'}" } } instead, so one card has one encoding`,
      ),
    );
  }
  if (filter.excludeKeywords !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.excludeKeywords`,
        `a target slot names a missing keyword with the "withoutKeyword" restriction; write { restriction: { kind: "withoutKeyword", keyword: "${filter.excludeKeywords[0] ?? 'flying'}" } } instead, so one card has one encoding`,
      ),
    );
  }
  const wanted = filter.cardTypes ?? [];
  if (
    !graveyardTarget &&
    wanted.length === 2 &&
    wanted.includes('artifact') &&
    wanted.includes('enchantment')
  ) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.cardTypes`,
        'this is the filter spelling of the "targetArtifactOrEnchantment" kind; name that kind instead, so one card has one encoding',
      ),
    );
  }
  if (graveyardTarget && filter.combat !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.combat`,
        'a card in a graveyard is not attacking or blocking, so a combat-role filter can never match it',
      ),
    );
  }
  if (graveyardTarget && filter.dealtDamageThisTurn !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${at}.dealtDamageThisTurn`,
        'damage-source history names a live battlefield incarnation, not a card in a graveyard',
      ),
    );
  }
  return [
    ...found,
    ...checkFilterLists(
      filter,
      at,
      graveyardTarget ? CARD_KINDS : PERMANENT_CARD_KINDS,
      graveyardTarget ? 'a card in a graveyard' : 'a permanent',
    ),
  ];
}

/**
 * The stack half of the same filter, and the three dimensions that do not carry
 * over.
 *
 * A combat role is a property of a permanent in a combat (CR 506.4); nothing on
 * the stack is attacking, so the field would print a word no board can answer.
 * A keyword is the same objection one rule out: CR 613.1 runs on permanents, so
 * `spellSatisfiesFilter` reads a spell at its printed values, and the field
 * would quietly mean printed-flying here where it means current-flying on the
 * battlefield. A land is never a spell (CR 305.9) — playing one uses no stack
 * at all — so a counter that named it would be a card that can never be cast.
 * Everything else a `TargetFilter` says means the same thing in both places,
 * which is why this reuses the type rather than declaring a stack-shaped twin.
 */
function checkSpellFilter(filter: TargetFilter | undefined, path: string): Violation[] {
  if (filter === undefined) return [];
  const found: Violation[] = [];
  if (filter.keywords !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.keywords`,
        'CR 613.1 applies to permanents, so a spell on the stack is read at its printed values; "with flying" would mean something narrower here than the one place this field is admitted, and no card in this population counters a spell by keyword',
      ),
    );
  }
  if (filter.excludeKeywords !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.excludeKeywords`,
        'a keyword absence on a spell is a printed-value query, while this filter dimension is defined against live battlefield characteristics; no reviewed stack effect has this shape',
      ),
    );
  }
  if (filter.combat !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.combat`,
        'a combat role is a property of a permanent in a combat; nothing on the stack is attacking or blocking',
      ),
    );
  }
  if (filter.dealtDamageThisTurn !== undefined) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.dealtDamageThisTurn`,
        'damage-source history names a live battlefield incarnation, not a spell on the stack',
      ),
    );
  }
  return [...found, ...checkFilterLists(filter, path, SPELL_CASTABLE_CARD_KINDS, 'a spell on the stack')];
}

/**
 * The executable subset of CR 707 spell copies.
 *
 * A copied instant or sorcery resolves entirely from its retained card and
 * stack choices. A copied permanent spell instead becomes a token as it
 * resolves, which is a distinct kernel path this primitive does not yet own.
 * Requiring the positive type filter keeps every accepted hand-authored card
 * inside the engine's enforceable space while leaving that future extension
 * explicit rather than failing only after a copied permanent reaches the top.
 */
function checkCopySpellFilter(filter: TargetFilter | undefined, path: string): Violation[] {
  const found = checkSpellFilter(filter, path);
  const cardTypes = filter?.cardTypes;
  if (
    cardTypes === undefined ||
    cardTypes.length === 0 ||
    cardTypes.some((kind) => kind !== 'instant' && kind !== 'sorcery')
  ) {
    found.push(
      violation(
        'ILLEGAL_TARGET_FILTER',
        `${path}.cardTypes`,
        'copySpell currently supports only a positive instant-or-sorcery spell filter; copied permanent spells need their own token-resolution path',
      ),
    );
  }
  return found;
}

/**
 * A restriction narrows a choice among creatures, so it is legal on the kinds
 * that make one and on nothing else.
 *
 * The refusal is worth stating rather than leaving to the schema: a player has
 * no power and no keywords, so "target player with power 3 or less" is not a
 * narrower card, it is a card that can never be cast. `noTarget`,
 * `triggeringCreature` and `selfCreature` are refused on the same footing and
 * for a second reason — none of the three is a choice at all, so a restriction
 * on any of them would print a condition the caster never gets to satisfy.
 */
function checkTargetRestriction(target: TargetSpec, path: string): Violation[] {
  const restriction = targetRestrictionOf(target);
  if (restriction === null) return [];
  if (restrictionFitsTargetKind(target.kind, restriction)) return [];
  const expected = restriction.kind === 'playerLostLifeThisTurn' ? 'players' : 'creatures';
  return [
    violation(
      'ILLEGAL_TARGET_RESTRICTION',
      `${path}.target.restriction`,
      `a "${restriction.kind}" restriction narrows a choice among ${expected}; "${target.kind}" names no ${expected.slice(0, -1)} to narrow`,
    ),
  ];
}

/**
 * Plural cardinality turns one target slot into either "up to N target
 * creatures" or "any number of target players". The chosen spelling, target
 * kind, effect execution, and sibling constraints must agree.
 *
 * A bounded `count` greater than one is legal on `targetCreature`, or on
 * `anyTarget` for divided damage. A count of one is the generic optional form
 * of an otherwise legal singular slot: every effect already knows how to
 * apply itself to its one chosen object, so it needs no plural execution arm.
 * "Up to two target players" and "up to two target permanents" are not
 * templates this vocabulary has a printed card for, and widening the space a
 * counted slot draws from is a second decision this check should not make
 * silently by leaving it unchecked. It is legal
 * only where `effectAllowsTargetCount` says the effect kind's resolution
 * already knows how to fold N objects into one application — see that table's
 * docblock in `@mtg/dsl`'s `effects.ts` for why the gate is per-effect rather
 * than per-target-kind. And it is mutually exclusive with `distinct`: the two
 * fields answer the same question, how many objects does this slot pick, and
 * `distinct` already answers it by being on a second, independent effect —
 * see `TargetSpecSchema`'s docblock. `anyNumber` has parallel kind and effect
 * gates because its maximum is the live legal-candidate population.
 */
export function checkTargetCardinality(effect: TargetedEffect, path: string): Violation[] {
  const count = targetCountOf(effect.target);
  const minimum = targetMinimumOf(effect.target);
  const anyNumber = targetsAnyNumber(effect.target);
  if (count === null && !anyNumber && minimum === 0) return [];
  const found: Violation[] = [];
  const countKindIsLegal =
    effect.target.kind === 'targetCreature' ||
    (effect.kind === 'exileTarget' && effect.creatureBattlefieldOrGraveyard === true) ||
    (effect.kind === 'detainPermanent' &&
      (effect.target.kind === 'targetCreatureOpponentControls' ||
        effect.target.kind === 'targetNonlandPermanentOpponentControls')) ||
    (effect.kind === 'dealDamage' && effect.target.kind === 'anyTarget');
  if (count !== null && !countKindIsLegal) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.count`,
        `a counted ${effect.kind} slot cannot use "${effect.target.kind}"`,
      ),
    );
  }
  if (
    count !== null &&
    count > 1 &&
    (!effectAllowsTargetCount(effect.kind) ||
      (effect.kind === 'exileTarget' && effect.creatureBattlefieldOrGraveyard !== true))
  ) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.count`,
        `${effect.kind} has no printed way to apply itself to more than one chosen object at once`,
      ),
    );
  }
  const anyNumberKindIsLegal =
    effect.target.kind === 'targetPlayer' ||
    (effect.kind === 'dealDamage' && effect.target.kind === 'anyTarget');
  if (anyNumber && !anyNumberKindIsLegal) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.anyNumber`,
        `"any number" is printed only on "targetPlayer"; "${effect.target.kind}" has no such template`,
      ),
    );
  }
  if (anyNumber && !effectAllowsAnyNumberTargets(effect.kind)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.anyNumber`,
        `${effect.kind} has no native way to apply itself to any number of chosen targets at once`,
      ),
    );
  }
  if (count !== null && anyNumber) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.anyNumber`,
        '"count" and "anyNumber" are two different maximums for one target slot; choose one cardinality',
      ),
    );
  }
  if (minimum > 0 && count === null) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.minimum`,
        'a minimum needs a bounded count that states the same slot maximum',
      ),
    );
  }
  if (count !== null && minimum > count) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.minimum`,
        `the minimum ${String(minimum)} cannot exceed the maximum ${String(count)}`,
      ),
    );
  }
  if (count === 1 && minimum === 1) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.minimum`,
        'a one-target minimum is the ordinary mandatory target slot; omit both cardinality fields for its canonical spelling',
      ),
    );
  }
  if (requiresDistinctTarget(effect.target)) {
    found.push(
      violation(
        'ILLEGAL_TARGET_COUNT',
        `${path}.target.${anyNumber ? 'anyNumber' : 'count'}`,
        'plural target cardinality and "distinct" both answer how many objects this slot picks; a slot cannot answer that twice',
      ),
    );
  }
  return found;
}

/**
 * A one-shot scope and its target slot are one statement, and this is where the
 * halves are held to each other.
 *
 * `scope` changes what the slot is *for*. Unscoped, `exileTarget` names the
 * creature it exiles. A targeted-player scope names the player whose creatures
 * it exiles; a board-region scope chooses nothing and lets its filter select
 * the group. In both scoped forms the creatures are not targets (CR 115.1), so
 * the group may contain hexproof bodies. Nothing in the schema can relate
 * these optional fields, so `{ scope: 'creaturesThatPlayerControls', target:
 * targetCreature }` parses and means nothing. Coded rather than silently
 * ignored, because a card whose text and behavior disagree is the failure the
 * vocabulary exists to prevent.
 */
/**
 * The kinds that carry a `scope` field, read off the union rather than listed.
 *
 * A hand-written list would be a fourth place a scoped primitive has to be
 * remembered, and the one place nothing would fail if it were forgotten: a kind
 * missing from it would simply never have its scope checked.
 */
type ScopedEffectKind = {
  [K in AnyEffectKind]: 'scope' extends keyof EffectOf<K> ? K : never;
}[AnyEffectKind];

/**
 * Which scopes each scoped primitive admits, and the answers are not the same
 * because the zones a scope names are not all zones the primitive can act on.
 *
 * `exileTarget` takes the three targeted-player zone scopes: exile is a zone change and `moveObject`'s
 * switches are total over `ZoneId`, so a card leaving a hand or a graveyard is
 * as ordinary as a permanent leaving the battlefield.
 *
 * `putCounters` takes the battlefield scopes alone. A counter is something an
 * object on the battlefield carries; a card in a hand or a graveyard has only
 * what is printed on it (CR 611.2c, and `@mtg/kernel`'s `zone-filter.ts` at
 * length), so "put a gloom counter on each creature card in target opponent's
 * graveyard" is a sentence with nowhere to put the counter.
 *
 * `returnFromGraveyard` takes the graveyard scope alone, which is the same
 * sentence from the other end: the primitive is defined as a move *out of* a
 * graveyard, so a scope naming any other zone would name cards that are not
 * where the effect reaches.
 *
 * The four sweepers take the battlefield scopes alone, and each for the reason
 * `putCounters` does one paragraph up rather than for a shared one. Damage is
 * marked on a permanent (CR 120.3), destruction is a move *off* the
 * battlefield, a P/T modification is a layer-7c effect over objects the layer
 * system applies to (CR 611.2c), and tapping is a status only a permanent has
 * (CR 110.5). None of the four has anything to say about a card in a hand or a
 * graveyard, so the groups they can reach are on the battlefield.
 *
 * The **untargeted** scopes are spread across those four rows by census rather
 * than by rule, and the census is M11 and M13's nine printed sweepers
 * (`mtg-9u18`). Every one of them is a destroy, a damage or a pump, so
 * `tapPermanent` gains nothing: the tappers of the era all name a player
 * (Sleep, Frost Breath) and were already expressible. Three of them name a
 * whole board and none names one side of it, so `destroyPermanent` and
 * `dealDamage` take `allPermanents` alone — Day of Judgment, Back to Nature,
 * Planar Cleansing, Pyroclasm and Rain of Blades. Only the pump names a side:
 * Glorious Charge and Inspired Charge are `permanentsYouControl` and Cower in
 * Fear is `permanentsOpponentsControl`, which is why that row is the wide one.
 * A scope no printed card in the population uses would be a widening nothing
 * measured, so each row moves when a card asks it to and not before. That is
 * how `permanentsYouControl` reached `putCounters` and no further: Steel
 * Overseer (M11 214) asks for it by name, nothing in the population puts a
 * counter on a whole board or on the other side of one, and the two rows that
 * would say so stayed where they were.
 *
 * `exileTarget` names those three scopes outright and adds one reviewed space
 * scope for Mass Polymorph: `permanentsYouControl` plus a creature filter.
 * Spreading `EFFECT_SCOPES` would silently admit other board regions no card in
 * the measured population asks this zone move to reach.
 *
 * `grantKeywordUntilEndOfTurn` takes one scope, and it is the narrowest row in
 * this table for the census reason the paragraph above gives. Every printed
 * mass keyword grant in reach — Overwhelming Stampede (M11 189), Overrun,
 * Cleaver Riot — says "creatures you control" and nothing else says anything:
 * no card hands the other side of the board a keyword, none hands one to a
 * whole board, and none reads a *targeted* player's creatures, so the three
 * older scopes are as absent as the two other space ones. A row that admitted
 * them would be four spellings nothing prints guarding one that everything
 * does.
 */
const SCOPES_LEGAL_ON = {
  exileTarget: [
    'creaturesThatPlayerControls',
    'creatureCardsInPlayerHand',
    'creatureCardsInPlayerGraveyard',
    'permanentsYouControl',
    'allPermanents',
  ],
  putCounters: ['creaturesThatPlayerControls', 'permanentsYouControl'],
  returnFromGraveyard: ['creatureCardsInPlayerGraveyard', 'creatureCardsInAllGraveyards'],
  dealDamage: [
    'creaturesThatPlayerControls',
    'allPermanents',
    'permanentsOpponentsControl',
    'targetAndPermanentsItsPlayerControls',
  ],
  destroyPermanent: ['creaturesThatPlayerControls', 'allPermanents'],
  pumpUntilEndOfTurn: [
    'creaturesThatPlayerControls',
    'allPermanents',
    'permanentsYouControl',
    'permanentsOpponentsControl',
  ],
  tapPermanent: ['creaturesThatPlayerControls'],
  grantKeywordUntilEndOfTurn: ['permanentsYouControl'],
  regeneratePermanent: ['permanentsYouControl'],
  blocksThisTurnIfAble: ['permanentsOpponentsControl'],
} as const satisfies Readonly<Record<ScopedEffectKind, readonly EffectScope[]>>;

/**
 * Every scope this primitive may carry, and nothing when it carries no `scope`
 * field at all.
 *
 * `legalTargetsFor`'s sibling, and it exists for the reason that one does: a
 * table only this file can read is a table every instrument around it has to
 * restate from memory, and a restated table is right until the day the real one
 * moves. `@mtg/dsl-coverage`'s calibration corpus is the caller that found it —
 * it builds one card per (kind, target) pair straight off `legalTargetsFor`, and
 * it was finishing every board sweep with `allPermanents`, which is true of the
 * four sweepers and became false the moment `putCounters` gained a `noTarget`
 * slot (`mtg-hfex`). The corpus stopped parsing at import time, which is that
 * instrument's alarm working exactly as designed and pointing at the one fix
 * that is not "hardcode the new kind over there too".
 */
export function legalScopesFor(kind: AnyEffectKind): readonly EffectScope[] {
  return kind in SCOPES_LEGAL_ON ? SCOPES_LEGAL_ON[kind as ScopedEffectKind] : [];
}

/**
 * Which card types a damage sweep may name.
 *
 * CR 120.3: damage is dealt to a creature, a planeswalker, a battle or a
 * player, and to nothing else. "Deal 2 damage to each enchantment" parses,
 * prints and resolves into no game action at all, which is the same failure
 * `UNSCOPED_MAY_NAME_A_PLAYER` refuses one screen down and is why this is a
 * coded violation rather than a silent no-op. Battles are outside `CARD_KINDS`,
 * so the list is the two this vocabulary can name.
 */
const DAMAGEABLE_CARD_KINDS: readonly string[] = ['creature', 'planeswalker'];

/**
 * Which card types a keyword grant may name.
 *
 * `KEYWORDS`' nine are combat words — flying, vigilance, haste, trample,
 * deathtouch, lifelink, menace, reach, first strike — and every one of them is
 * a fact about attacking, blocking or dealing combat damage, which is something
 * only a creature does. So "all artifacts you control gain flying" is a layer-6
 * record the kernel would honor, print as a sentence, and change no game action
 * whatsoever. That is the same silent no-op `DAMAGEABLE_CARD_KINDS` refuses one
 * paragraph up, and it is refused here for the same reason: a coded violation
 * names the mistake and a narrower schema would only fail to parse.
 *
 * The targeted form of this primitive already says the same thing by leaving
 * `targetPermanent` off its `EFFECT_RULES` row — "target land gains flying" is
 * a sentence the layer would honor and no card in this world wants to print.
 * A sweep is where that rule would otherwise be reachable, because the scope
 * names a region of the board and the filter is the only thing narrowing it.
 */
const KEYWORD_BEARING_CARD_KINDS: readonly string[] = ['creature'];

/**
 * Whether a scoped primitive's **unscoped** form may name a player too.
 *
 * The missing-scope rule below reads "a player slot with no scope resolves into
 * nothing", and that sentence is true of every member here but one.
 * `dealDamage` acts on whatever it is aimed at, and a player is one of the
 * things it can be aimed at: "deals 3 damage to target player" is a whole card,
 * and was one long before a scope existed. The rest act on a player's
 * *permanents*, and the player slot is only ever the handle the scope reads the
 * group off — destroying, tapping or pumping a player is not a sentence,
 * granting one trample is not either, and exiling or counter-placing one is
 * not.
 *
 * A total record rather than a set, so a primitive that gains a scope has to
 * answer this question rather than inherit an answer. Getting it wrong in the
 * permissive direction is the expensive one: it admits a card that parses,
 * prints, and resolves into no game action at all.
 */
const UNSCOPED_MAY_NAME_A_PLAYER: Readonly<Record<ScopedEffectKind, boolean>> = {
  dealDamage: true,
  exileTarget: false,
  putCounters: false,
  returnFromGraveyard: false,
  destroyPermanent: false,
  pumpUntilEndOfTurn: false,
  tapPermanent: false,
  grantKeywordUntilEndOfTurn: false,
  regeneratePermanent: false,
  blocksThisTurnIfAble: false,
};

/** True when this primitive carries a `scope` field at all. */
function isScopedEffect(effect: Effect): effect is EffectOf<ScopedEffectKind> {
  return effect.kind in SCOPES_LEGAL_ON;
}

/**
 * The `scopeFilter` a primitive carries, or `undefined` when it carries no such
 * field.
 *
 * Seven of the eight scoped primitives have one and `returnFromGraveyard` does
 * not, so the field is read through a guard rather than off the narrowed
 * union. `exileTarget` joined the filtered group for Mass Polymorph: a scope
 * naming a region of the board names no objects and the filter is the only
 * thing that can.
 * Reading it here rather than per-arm is what lets `checkEffectScope` state that
 * rule once for every primitive that could break it.
 */
function scopeFilterOf(effect: EffectOf<ScopedEffectKind>): TargetFilter | undefined {
  return 'scopeFilter' in effect ? effect.scopeFilter : undefined;
}

/**
 * Whether this effect's `scope` and its target slot agree.
 *
 * Exported because an ability's effect list gets the identical check
 * (`validate/abilities.ts`) rather than a second, drifted copy: a
 * `destroyPermanent` aimed at a player with no group beside it resolves into no
 * game action whether it is printed on a sorcery or inside a trigger, and the
 * sentence that says so should be one function. The ability path is not covered
 * by `checkAbilityEffectTarget`, which reads `legalTargetsFor` and so sees only
 * that the player slot is legal on the row.
 */
export function checkEffectScope(
  effect: Effect,
  path: string,
  allowSourceReferentExclusion = false,
): Violation[] {
  if (
    effect.kind === 'pumpUntilEndOfTurn' &&
    effect.excludeReferent === true &&
    !allowSourceReferentExclusion &&
    (effect.scope !== 'creaturesThatPlayerControls' || effect.target.kind !== 'thatCreaturesController')
  ) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.excludeReferent`,
        'excludeReferent spells “other creatures” only on a controller cohort read from an earlier creature target',
      ),
    ];
  }
  if (effect.kind === 'putCounters' && effect.keyword !== undefined && effect.scope === undefined) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.keyword`,
        'a counter-placement keyword rider refers to “those creatures”; add a scope that binds the affected group',
      ),
    ];
  }
  if (
    effect.kind === 'exileTarget' &&
    effect.returnAtNextEndStep !== undefined &&
    effect.scope !== undefined
  ) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.returnAtNextEndStep`,
        'a delayed return retains one exiled card incarnation; a scoped exile may move a group and cannot supply that one referent',
      ),
    ];
  }
  if (
    effect.kind === 'exileTarget' &&
    effect.returnAtNextEndStep !== undefined &&
    isGraveyardCardTargetKind(effect.target.kind)
  ) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.returnAtNextEndStep`,
        'a delayed return retains one battlefield permanent exiled by this effect; a graveyard card target was never on the battlefield',
      ),
    ];
  }
  if (effect.kind === 'returnFromGraveyard' && effect.fromBattlefieldThisTurn === true) return [];
  if (!isScopedEffect(effect)) return [];
  const resolvesToPlayer =
    targetKindNamesAPlayer(effect.target.kind) ||
    effect.target.kind === 'thatPlayer' ||
    effect.target.kind === 'thatCreaturesController';
  const legalScopes: readonly EffectScope[] = SCOPES_LEGAL_ON[effect.kind];
  const filter = scopeFilterOf(effect);
  if (effect.scope === undefined) {
    if (filter !== undefined) {
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scopeFilter`,
          `a scopeFilter narrows a group and this ${effect.kind} has no scope, so it names one permanent and there is no group to narrow; add a scope, or drop the filter`,
        ),
      ];
    }
    if (effect.target.kind === 'noTarget') {
      // A source may deal damage to its own controller without targeting them.
      // The kernel reads the controller fixed on the resolving stack entry,
      // and Forge spells the same relation as `Defined$ You`.
      if (effect.kind === 'dealDamage') return [];
      // A player sweep supplies the recipients that an ordinary unscoped
      // effect reads from its target. Damage is the first scoped primitive to
      // carry both fields: it may hit players alone, or combine those players
      // with a battlefield scope in one simultaneous batch. `checkPlayerSweep`
      // still refuses a live target beside the player sweep.
      if ('players' in effect && effect.players !== undefined) return [];
      // The other half of the missing-scope rule, and it exists because the
      // untargeted scopes put `noTarget` on three of these rows. A scoped
      // primitive acts on objects; with no scope it acts on the one object it
      // targets, and with no target either there is no object at all. That card
      // parses, prints a sentence and resolves into nothing, which is the
      // failure this whole check exists to refuse.
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.target.kind`,
          `an unscoped ${effect.kind} reaches the permanent it targets and this effect chooses nothing; give it a target, or add a scope naming the group it reaches`,
        ),
      ];
    }
    if (!resolvesToPlayer || UNSCOPED_MAY_NAME_A_PLAYER[effect.kind]) return [];
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.target.kind`,
        `an unscoped ${effect.kind} reaches the permanent it targets, and "${effect.target.kind}" names a player; give it a permanent slot, or add a scope saying which of that player's permanents this reaches`,
      ),
    ];
  }
  if (!legalScopes.includes(effect.scope)) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `${effect.kind} cannot use scope "${effect.scope}"; legal scopes are ${legalScopes.join(', ')}`,
      ),
    ];
  }
  if (EFFECT_SCOPE_SUBJECT[effect.scope] === 'targetedPlayer') {
    if (filter !== undefined) {
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scopeFilter`,
          `scope "${effect.scope}" already names the objects it reaches, so a scopeFilter beside it would be a second, competing answer; drop the filter, or use a scope that names a region of the board`,
        ),
      ];
    }
    if (resolvesToPlayer) return [];
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `scope "${effect.scope}" reads its group off a player and this effect targets "${effect.target.kind}"; aim it at a player slot, or drop the scope`,
      ),
    ];
  }
  if (EFFECT_SCOPE_SUBJECT[effect.scope] === 'targetedPlayerOrPermanentController') {
    return checkTargetOrControllerScope(effect, effect.scope, filter, path);
  }
  if (EFFECT_SCOPE_SUBJECT[effect.scope] === 'allPlayers') {
    if (effect.target.kind !== 'noTarget') {
      return [
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scope`,
          `scope "${effect.scope}" reads every player's zone and this effect targets "${effect.target.kind}"; give it a "noTarget" slot`,
        ),
      ];
    }
    return filter === undefined
      ? []
      : [
          violation(
            'ILLEGAL_EFFECT_SCOPE',
            `${path}.scopeFilter`,
            `scope "${effect.scope}" already names the cards it reaches, so a scopeFilter beside it would be a second, competing answer`,
          ),
        ];
  }
  return checkSpaceScope(effect, effect.scope, filter, path);
}

/** A targeted player/planeswalker plus a group read from that target's seat. */
function checkTargetOrControllerScope(
  effect: EffectOf<ScopedEffectKind>,
  scope: EffectScope,
  filter: TargetFilter | undefined,
  path: string,
): Violation[] {
  if (effect.target.kind !== 'targetPlayerOrPlaneswalker') {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `scope "${scope}" needs a target player or planeswalker whose controller names the group`,
      ),
    ];
  }
  if (filter === undefined || Object.keys(filter).length === 0) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scopeFilter`,
        `scope "${scope}" needs a scopeFilter saying which permanents that player controls`,
      ),
    ];
  }
  const lists = checkFilterLists(filter, `${path}.scopeFilter`, PERMANENT_CARD_KINDS, 'a permanent');
  if (effect.kind !== 'dealDamage') return lists;
  const missed = unreachableSweepBodies(filter, DAMAGEABLE_CARD_KINDS);
  return missed === null
    ? lists
    : [
        ...lists,
        violation(
          'ILLEGAL_EFFECT_SCOPE',
          `${path}.scopeFilter.${missed.field}`,
          `damage is dealt only to ${DAMAGEABLE_CARD_KINDS.join(' and ')} permanents, and this scope names ${describeSweepBodies(missed)}`,
        ),
      ];
}

/**
 * The four rules an **untargeted** scope adds, three of them about the sentence
 * being complete rather than about the board.
 *
 * A space scope chooses nothing (CR 115.1), so a target slot beside it would be
 * a choice the card makes and never reads — the mirror of the missing-scope
 * rule above, and the reason the two arms are separate rather than one
 * `namesAPlayer` check with a flipped sign.
 *
 * A space says *where* and the filter says *what*, so neither is meaningful
 * alone: "destroy all" is not a sentence, and this is where it is refused
 * rather than in the schema, for the reason `putCounters`' scope rule gives —
 * a coded violation names the mistake and a narrower schema would only fail to
 * parse.
 *
 * The last two rules are about the bodies rather than the sentence, and each is
 * spelled out at the list it reads: CR 120.3's at `DAMAGEABLE_CARD_KINDS`, and
 * the keyword grant's at `KEYWORD_BEARING_CARD_KINDS`. They are per-kind arms
 * rather than a table because only two of the eight scoped primitives care
 * which card type they land on; the other six act on whatever the filter names.
 *
 * The fourth rule is `checkFilterLists`, which every filter read against the
 * battlefield obeys and this one was not being handed to. It is stated at its
 * call below rather than here, because what it closes is a gap and not a
 * decision.
 */
function checkSpaceScope(
  effect: EffectOf<ScopedEffectKind>,
  scope: EffectScope,
  filter: TargetFilter | undefined,
  path: string,
): Violation[] {
  if (effect.kind === 'grantKeywordUntilEndOfTurn' && effect.removeKeywordAbility !== undefined) {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.removeKeywordAbility`,
        'a temporary keyword removal is measured only on one source creature; no reviewed card or executor proves a mass removal spelling',
      ),
    ];
  }
  if (effect.target.kind !== 'noTarget') {
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scope`,
        `scope "${scope}" reads its group off the board rather than off a target, and this effect targets "${effect.target.kind}"; give it a "noTarget" slot, or use a scope that reads a targeted player`,
      ),
    ];
  }
  if (filter === undefined || Object.keys(filter).length === 0) {
    if (effect.kind === 'exileTarget' && scope === 'allPermanents') return [];
    return [
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scopeFilter`,
        `scope "${scope}" names a region of the board and not which permanents in it; add a scopeFilter saying which`,
      ),
    ];
  }
  // The same list rules a target slot's filter gets, at the only other site
  // that reads one against the battlefield. They were missing here until
  // `mtg-nhyv.62`, which is a gap rather than a decision: `checkFilterLists`
  // was reached from `checkTargetFilter` and `checkSpellFilter` and from
  // nowhere else, so a sweep could name the same card type twice, or want and
  // exclude one, and no violation said so. It became load-bearing the moment
  // this filter gained a field whose *only* legal site is this one — a field
  // validated nowhere is a field that means whatever the first author types.
  const lists = checkFilterLists(filter, `${path}.scopeFilter`, PERMANENT_CARD_KINDS, 'a permanent');
  if (
    effect.kind === 'grantKeywordUntilEndOfTurn' ||
    effect.kind === 'blocksThisTurnIfAble' ||
    (effect.kind === 'putCounters' && effect.keyword !== undefined)
  ) {
    const missed = unreachableSweepBodies(filter, KEYWORD_BEARING_CARD_KINDS);
    if (missed === null) return lists;
    return [
      ...lists,
      violation(
        'ILLEGAL_EFFECT_SCOPE',
        `${path}.scopeFilter.${missed.field}`,
        `${effect.kind === 'blocksThisTurnIfAble' ? 'a block requirement' : 'a granted keyword'} is a fact about combat and only a ${KEYWORD_BEARING_CARD_KINDS.join(' or a ')} takes part in one, and this sweep names ${describeSweepBodies(missed)}; narrow the filter to the permanents the combat rule can reach`,
      ),
    ];
  }
  if (effect.kind !== 'dealDamage') return lists;
  const missed = unreachableSweepBodies(filter, DAMAGEABLE_CARD_KINDS);
  if (missed === null) return lists;
  return [
    ...lists,
    violation(
      'ILLEGAL_EFFECT_SCOPE',
      `${path}.scopeFilter.${missed.field}`,
      `damage is dealt only to ${DAMAGEABLE_CARD_KINDS.join(' and ')} permanents (CR 120.3), and this sweep names ${describeSweepBodies(missed)}; narrow the filter to the permanents damage can reach`,
    ),
  ];
}

/**
 * The card types a sweep's filter names that the effect cannot reach, or `null`
 * when every body it names is one the effect can act on.
 *
 * One function for the two rows that ask it, and the reason is that the
 * question is subtle in the same way twice. The two card-type fields need
 * opposite readings, because they promise opposite things about the body the
 * sweep reaches: every member of a union may turn up alone, so every member has
 * to be reachable, while a conjunction reaches one object that is all of them at
 * once, so one reachable member carries the whole filter — an artifact creature
 * is a creature, and both CR 120.3's damage and a layer-6 keyword find it.
 * Writing that twice with two lists in it is two chances to get the direction
 * backwards on one of them.
 *
 * An empty filter is a miss rather than a pass: `checkSpaceScope` has already
 * refused the filterless sweep, so a filter that reaches here and names no card
 * type at all names every permanent, and neither caller can act on every
 * permanent.
 */
function unreachableSweepBodies(
  filter: TargetFilter,
  reachable: readonly string[],
): { readonly field: 'allCardTypes' | 'cardTypes'; readonly unreachable: readonly string[] } | null {
  const conjunction = filter.allCardTypes ?? [];
  if (conjunction.some((kind) => reachable.includes(kind))) return null;
  const field = conjunction.length > 0 ? 'allCardTypes' : 'cardTypes';
  const named = conjunction.length > 0 ? conjunction : (filter.cardTypes ?? []);
  const unreachable = named.filter((kind) => !reachable.includes(kind));
  if (named.length > 0 && unreachable.length === 0) return null;
  return { field, unreachable };
}

/** The card types a refused sweep names, in the words the violation prints. */
function describeSweepBodies(missed: { readonly unreachable: readonly string[] }): string {
  return missed.unreachable.length === 0 ? 'no card type at all' : `"${missed.unreachable.join('", "')}"`;
}

/**
 * Whether this effect's player sweep and its target slot agree.
 *
 * The same rule `checkSpaceScope` states for a region of the board, one field
 * over and for the same reason: `players` names everybody at the table (CR
 * 101.2), so it chooses nothing, and a target slot beside it would be a choice
 * the card makes and never reads. Temple Bell draws for the table and aims at
 * nobody; a card that aimed at an opponent and then drew for everybody would
 * print one sentence and resolve another.
 *
 * Read off the field rather than off a list of kinds that may carry it. The
 * check was written when `drawCards` was the only carrier and named it in the
 * guard, so the day `loseLife` grew the same field (Howling Banshee's "each
 * player loses 3 life") a sweep beside a live target slot passed validation
 * silently — the schema widened, nothing stopped compiling, and the rule this
 * function exists to state simply stopped applying to the new member.
 * `'players' in effect` is the honest question: whichever primitives carry the
 * field are held to the rule, and one added tomorrow is held to it without an
 * edit here.
 *
 * Exported for the reason `checkEffectScope` is: an ability's effect list runs
 * the identical check rather than a drifted copy of it.
 */
export function checkPlayerSweep(effect: Effect, path: string): Violation[] {
  if (!('players' in effect) || effect.players === undefined) return [];
  if (!hasTarget(effect) || effect.target.kind === 'noTarget') return [];
  return [
    violation(
      'ILLEGAL_EFFECT_SCOPE',
      `${path}.players`,
      `"${effect.players}" reaches everyone at the table and reads no target, and this "${effect.kind}" targets "${effect.target.kind}"; give it a "noTarget" slot, or drop the sweep and let the target take it alone`,
    ),
  ];
}

/**
 * `distinct` is only meaningful against something it can exclude.
 *
 * It reads "differs from every target this spell already chose", and the
 * renderer turns it into "another target creature". Both statements need an
 * earlier slot that could have named the same object: on `effects[0]`, on a
 * `noTarget` spec, or after a slot drawn from a space this one cannot reach,
 * the constraint can never bite and the printed "another" is a promise the card
 * does not keep. Rejecting is cheaper than printing text the kernel disagrees
 * with, which is the failure this whole vocabulary exists to prevent.
 */
function checkDistinctTargets(effects: readonly Effect[]): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (!hasTarget(effect) || effect.target.distinct !== true) continue;
    const path = `effects[${index}].target.distinct`;
    if (effect.target.kind === 'noTarget') {
      found.push(
        violation(
          'ILLEGAL_DISTINCT_TARGET',
          path,
          'a noTarget spec chooses nothing, so there is nothing for "distinct" to exclude; drop the flag or give this effect a real target kind',
        ),
      );
      continue;
    }
    const kind = effect.target.kind;
    const collidable = effects
      .slice(0, index)
      .some((earlier) => hasTarget(earlier) && targetKindsCanCollide(earlier.target.kind, kind));
    if (collidable) continue;
    found.push(
      violation(
        'ILLEGAL_DISTINCT_TARGET',
        path,
        `no earlier effect chooses a target a "${kind}" slot could repeat, so "distinct" excludes nothing and the card would print "another" with no first; drop the flag`,
      ),
    );
  }
  return found;
}

/**
 * Every back-reference in this list has exactly one thing to refer back to.
 *
 * The list-level half of the referent kinds (`mtg-nhyv.75`). `checkEffectTarget`
 * has already decided whether this effect may print "that creature" at all;
 * what it cannot decide is whether the phrase means anything, because that is a
 * fact about the effects *around* it. `referentSourceIndex` (`@mtg/dsl`'s
 * `effects.ts`) is the derivation, and the kernel resolves the referent through
 * the identical call — so a card that validates here is a card `planResolution`
 * can fill, and the two cannot come to different conclusions about which slot
 * the phrase names.
 *
 * Two failures, and they are told apart in the message because the author fixes
 * them differently. No earlier chooser at all means the phrase has no referent
 * — Magic prints no card whose first sentence says "that creature" — and the
 * fix is to add or reorder an effect. More than one earlier chooser of the same
 * space means the phrase has two readings, and the fix is to say which by
 * splitting the card. Neither is a case to guess at: a card that prints one
 * sentence and resolves against another object is the failure this vocabulary
 * exists to refuse, and a nearest-wins rule would make that failure silent.
 *
 * Written over the whole list rather than per effect for `checkDistinctTargets`'
 * reason one function down, and called from the same three places an effect
 * list is checked: a spell's flat list, each of a modal spell's modes, and an
 * ability's own list. A mode is its own list because `effectsFor` hands the
 * kernel one mode's effects and nothing else, so a referent in mode 1 can no
 * more read mode 0's slot than it could read another card's.
 */
export function checkReferentTargets(effects: readonly Effect[], pathPrefix: string): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (!hasTarget(effect)) continue;
    const kind = effect.target.kind;
    const space = referentSourceSpace(kind);
    if (space === null) continue;
    const sourceIndex = referentSourceIndex(effects, index);
    if (sourceIndex !== null) {
      if (
        effect.kind === 'pumpUntilEndOfTurn' &&
        effect.excludeReferent === true &&
        effects[sourceIndex]?.kind !== 'destroyPermanent'
      ) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_TARGET',
            `${pathPrefix}[${index}].excludeReferent`,
            'the proven retained-controller exclusion protocol requires the earlier creature target to be destroyed',
          ),
        );
      }
      continue;
    }
    const earlierChoosers = effects
      .slice(0, index)
      .filter(
        (earlier) =>
          hasTarget(earlier) &&
          effectChoosesTarget(earlier) &&
          !isMultipleTargetSpec(earlier.target) &&
          (space === 'creature'
            ? targetKindNamesACreature(earlier.target.kind)
            : space === 'player'
              ? targetKindNamesAPlayer(earlier.target.kind)
              : targetKindNamesAPlayerOrPlaneswalker(earlier.target.kind)),
      ).length;
    found.push(
      violation(
        'ILLEGAL_REFERENT_TARGET',
        `${pathPrefix}[${index}].target.kind`,
        earlierChoosers === 0
          ? `"${kind}" names what an earlier effect chose, and no effect before this one chooses a ${space}; give an earlier effect a ${space} slot or drop the back-reference`
          : `"${kind}" names what an earlier effect chose, and ${String(earlierChoosers)} earlier effects each choose a ${space}, so the phrase has more than one reading; split the card`,
      ),
    );
  }
  return found;
}

function fieldsUsingAmountKind(effect: Effect, kind: ComputedAmount['kind']): string[] {
  return Object.entries(effect)
    .filter(
      ([, value]) => typeof value === 'object' && value !== null && 'kind' in value && value.kind === kind,
    )
    .map(([field]) => field);
}

/** Every resolution-local amount has exactly one earlier writer it can read. */
export function checkReferentAmounts(
  effects: readonly Effect[],
  pathPrefix: string,
  allowTriggeringCreatureAmounts = false,
  triggeringDamageUse: 'none' | 'dealtDamage' | 'combatDamageMill' | 'combatDamageCounters' = 'none',
  allowTriggeringSpellChosenColorCount = false,
): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    const triggeringPowerFields = fieldsUsingAmountKind(effect, 'triggeringCreaturePower');
    if (!allowTriggeringCreatureAmounts) {
      for (const field of triggeringPowerFields) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].${field}.kind`,
            'triggeringCreaturePower is legal only on a triggered ability whose event retains a creature',
          ),
        );
      }
    }
    const triggeringToughnessFields = fieldsUsingAmountKind(effect, 'triggeringCreatureToughness');
    if (!allowTriggeringCreatureAmounts) {
      for (const field of triggeringToughnessFields) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].${field}.kind`,
            'triggeringCreatureToughness is legal only on a triggered ability whose event retains a creature',
          ),
        );
      }
    }
    const damageFields = fieldsUsingAmountKind(effect, 'triggeringDamageAmount');
    for (const field of damageFields) {
      const legalDealtDamage =
        triggeringDamageUse === 'dealtDamage' && effect.kind === 'dealDamage' && field === 'amount';
      const legalCombatMill =
        triggeringDamageUse === 'combatDamageMill' && effect.kind === 'millCards' && field === 'count';
      const legalCombatCounters =
        triggeringDamageUse === 'combatDamageCounters' && effect.kind === 'putCounters' && field === 'count';
      if (legalDealtDamage || legalCombatMill || legalCombatCounters) continue;
      found.push(
        violation(
          'ILLEGAL_REFERENT_AMOUNT',
          `${pathPrefix}[${index}].${field}.kind`,
          triggeringDamageUse === 'dealtDamage'
            ? 'triggeringDamageAmount is legal only in dealDamage.amount'
            : triggeringDamageUse === 'combatDamageMill'
              ? 'triggeringDamageAmount is legal only in millCards.count'
              : triggeringDamageUse === 'combatDamageCounters'
                ? 'triggeringDamageAmount is legal only in putCounters.count'
                : 'triggeringDamageAmount is legal only in dealDamage.amount on a selfIsDealtDamage trigger, millCards.count on a selfDealsCombatDamageToPlayer trigger, or putCounters.count on a controlledCreatureDealsCombatDamageToPlayer trigger',
        ),
      );
    }
    const chosenColorFields = fieldsUsingAmountKind(effect, 'triggeringSpellChosenColorCount');
    if (!allowTriggeringSpellChosenColorCount) {
      for (const field of chosenColorFields) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].${field}.kind`,
            'triggeringSpellChosenColorCount is legal only in the gainLife amount of the closed chosen-color cast trigger',
          ),
        );
      }
    }
    const fields = fieldsUsingAmountKind(effect, 'thatCreatureToughness');
    if (fields.length > 0 && referentAmountSourceIndex(effects, index) === null) {
      const earlierChoosers = effects
        .slice(0, index)
        .filter(
          (earlier) =>
            hasTarget(earlier) &&
            effectChoosesTarget(earlier) &&
            !isMultipleTargetSpec(earlier.target) &&
            targetKindNamesACreature(earlier.target.kind),
        ).length;
      for (const field of fields) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].${field}.kind`,
            earlierChoosers === 0
              ? '"thatCreatureToughness" reads what an earlier effect chose, and no effect before this one chooses a creature; give an earlier effect a creature slot or use another amount'
              : `"thatCreatureToughness" reads what an earlier effect chose, and ${String(earlierChoosers)} earlier effects each choose a creature, so the amount has more than one reading; split the card`,
          ),
        );
      }
    }

    if (effect.kind === 'gainLife' && effect.amountFrom === 'thatPlayersHandSize') {
      const earlierChoosers = effects
        .slice(0, index)
        .filter(
          (earlier) =>
            hasTarget(earlier) &&
            effectChoosesTarget(earlier) &&
            !isMultipleTargetSpec(earlier.target) &&
            targetKindNamesAPlayer(earlier.target.kind),
        ).length;
      if (effect.amount !== 0) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].amount`,
            'thatPlayersHandSize supplies the whole live amount, so the literal amount field must be 0',
          ),
        );
      }
      if (playerReferentAmountSourceIndex(effects, index) === null) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].amountFrom`,
            earlierChoosers === 0
              ? 'thatPlayersHandSize reads an earlier player target, but no instruction before this one chooses a player'
              : `thatPlayersHandSize has ${String(earlierChoosers)} earlier player targets, so "that player" has more than one reading; split the card`,
          ),
        );
      }
    }

    const revealedFields = fieldsUsingAmountKind(effect, 'revealedCardManaValueThisResolution');
    if (revealedFields.length > 0 && revealedCardAmountSourceIndex(effects, index) === null) {
      const earlierWriters = effects
        .slice(0, index)
        .filter((earlier) => earlier.kind === 'revealTopCardToHand').length;
      for (const field of revealedFields) {
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${pathPrefix}[${index}].${field}.kind`,
            earlierWriters === 0
              ? '"revealedCardManaValueThisResolution" reads a card an earlier effect revealed and moved, but no revealTopCardToHand effect precedes it'
              : `"revealedCardManaValueThisResolution" has ${String(earlierWriters)} earlier revealTopCardToHand writers, so "its" has more than one reading; split the card`,
          ),
        );
      }
    }

    const shuffledFields = fieldsUsingAmountKind(effect, 'cardsShuffledFromGraveyardThisResolution');
    if (shuffledFields.length > 0) {
      const earlierWriters = effects
        .slice(0, index)
        .filter((earlier) => earlier.kind === 'shuffleGraveyardIntoLibrary').length;
      if (earlierWriters !== 1 || effect.kind !== 'millCards' || effect.target.kind !== 'targetPlayer') {
        for (const field of shuffledFields) {
          found.push(
            violation(
              'ILLEGAL_REFERENT_AMOUNT',
              `${pathPrefix}[${index}].${field}.kind`,
              'cardsShuffledFromGraveyardThisResolution is legal only as the count of a target-player mill after exactly one graveyard shuffle-back',
            ),
          );
        }
      }
    }

    const sacrificedPowerFields = fieldsUsingAmountKind(effect, 'sacrificedPermanentPowerThisResolution');
    if (sacrificedPowerFields.length > 0 && sacrificedPermanentAmountSourceIndex(effects, index) === null) {
      const earlierSacrifices = effects
        .slice(0, index)
        .filter((earlier) => earlier.kind === 'sacrificePermanent');
      const onePermanentSacrifices = earlierSacrifices.filter((earlier) => (earlier.count ?? 1) === 1);
      for (const field of sacrificedPowerFields) {
        let message =
          'sacrificedPermanentPowerThisResolution needs an earlier sacrifice instruction affecting one player';
        if (earlierSacrifices.length === 0) {
          message = 'sacrificedPermanentPowerThisResolution has no earlier sacrifice to read';
        } else if (earlierSacrifices.length > 1) {
          message = `sacrificedPermanentPowerThisResolution has ${String(earlierSacrifices.length)} earlier sacrifices, so the power has more than one possible writer; split the card`;
        } else if (onePermanentSacrifices.length === 0) {
          message =
            'sacrificedPermanentPowerThisResolution needs an earlier sacrifice of exactly one permanent';
        }
        found.push(violation('ILLEGAL_REFERENT_AMOUNT', `${pathPrefix}[${index}].${field}.kind`, message));
      }
    }
  }
  return found;
}

/**
 * The same effect object twice is usually not two effects.
 *
 * The kernel resolves an effects list index by index, so a byte-identical pair
 * creates two independently chosen slots even when the author meant one
 * counted effect. A repeat is ordinarily a slip, a design that wants a real
 * primitive (`drawCards` with a count, a token count), or a design that wants
 * a second *body* — and that last one has an answer, so it is still not a
 * second identical entry: it is `target.distinct` on the second, which prints
 * "another target creature" and which the kernel refuses to resolve against
 * the first slot's choice.
 *
 * Common Bond is the narrow exception. Its two independently targeted
 * `putCounters` instructions are byte-identical, and Magic permits both target
 * slots to name either the same creature or different creatures. Collapsing
 * them to `count: 2` would force one target; adding `distinct` would forbid the
 * same target. `putCounters` is hand-authored-only, so admitting this exact
 * targeted primitive does not widen the generator output space or weaken the
 * guard for generated effects.
 *
 * Compared by `canonicalJson` so key order cannot hide a duplicate.
 */
function checkDuplicateEffects(effects: readonly Effect[]): Violation[] {
  const firstSeen = new Map<string, number>();
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    const key = canonicalJson(effect);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    if (effects.length === 2 && effect.kind === 'putCounters' && effectChoosesTarget(effect)) continue;
    found.push(
      violation(
        'DUPLICATE_EFFECT',
        `effects[${index}]`,
        `this ${effect.kind} repeats effects[${earlier}] exactly; delete it, express the intent as one effect, or — when the design wants a second body — set target.distinct on this entry`,
      ),
    );
  }
  return found;
}

/**
 * A spell has no body, so an effect that reads the source's own body is refused
 * wherever a spell's effect list is checked.
 *
 * The engine reason, not a style rule: `applyResolutionEffects` is called with
 * the *stack* object's oid for a spell, and a stack object is not a creature on
 * the battlefield. A `fight` printed on an instant would find no first fighter
 * and resolve as a silent no-op, which is a card that prints a sentence and
 * does not do it. `checkEffectList` is called once for `card.effects` and once
 * per mode, and `checkEffects` has already refused a permanent's flat effect
 * list outright, so both paths through here are spell paths.
 *
 * `EFFECT_ILLEGAL_ON_CARD_TYPE` rather than a new code: the code already carries
 * exactly this meaning, and `checkActivatedAbility` uses its sibling for the
 * self-regeneration creature-only rule, which is the same shape.
 */
function checkSourceBodyEffect(effect: Effect, path: string): Violation[] {
  if (effect.kind === 'copyNextInstantOrSorceryThisTurn') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'copyNextInstantOrSorceryThisTurn retains its permanent source through a delayed trigger and is legal only inside a permanent ability',
      ),
    ];
  }
  if (effect.kind === 'doubleSourceCounters') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'doubleSourceCounters reads counters from its battlefield source and is legal only inside a permanent ability',
      ),
    ];
  }
  if (effect.kind === 'chooseBlockersThisCombat') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'chooseBlockersThisCombat is legal only inside a creature selfAndThreeOthersAttack trigger',
      ),
    ];
  }
  if (effect.kind === 'preventNextDamageToYouAndRetaliate' && effect.target.kind !== 'noTarget') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'preventNextDamageToYouAndRetaliate reads X from its own activation cost and is legal only inside an activated ability',
      ),
    ];
  }
  if (effect.kind === 'flipCoin') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'flipCoin currently carries deterministic outcome branches only on an activated ability',
      ),
    ];
  }
  if (effect.kind === 'createTokenCopyOfSelf') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'createTokenCopyOfSelf is legal only in the closed Pack Rat activated-ability bundle',
      ),
    ];
  }
  if (isSourceLinkedExileWriter(effect) || effect.kind === 'moveSourceLinkedExile') {
    return [
      violation(
        'SOURCE_LINKED_EXILE_INVALID',
        path,
        'source-linked exile belongs to a permanent whose enters trigger writes the relation and whose matching departure trigger reads it; a resolving spell has no battlefield source',
      ),
    ];
  }
  if (effect.kind === 'returnSourceFromGraveyard') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'returnSourceFromGraveyard reads the exact card whose ability is on the stack; print it inside an activated ability whose activationZone is "graveyard"',
      ),
    ];
  }
  if (effect.kind === 'returnDepartedSourceToOwnerHand') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'returnDepartedSourceToOwnerHand reads departure provenance retained by a permanent trigger; a spell has no departed permanent source',
      ),
    ];
  }
  if (effect.kind === 'putDepartedSourceOnTopOfOwnerLibrary') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'putDepartedSourceOnTopOfOwnerLibrary reads departure provenance retained by a dies trigger; a spell has no departed permanent source',
      ),
    ];
  }
  if (effect.kind === 'shuffleSourceIntoOwnerLibrary') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'shuffleSourceIntoOwnerLibrary reads graveyard provenance retained by a source trigger; a spell has no departed source',
      ),
    ];
  }
  if (effect.kind === 'targetPlayerGainsControlOfSelfPermanent') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'targetPlayerGainsControlOfSelfPermanent reads the battlefield permanent whose ability is resolving, and a spell on the stack has no such source incarnation; print it inside a permanent ability',
      ),
    ];
  }
  if (effect.kind === 'putSourceAndTargetOnOwnersLibrariesThenShuffle') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'putSourceAndTargetOnOwnersLibrariesThenShuffle reads a battlefield permanent source incarnation and is legal only inside a permanent ability',
      ),
    ];
  }
  if (effect.kind === 'animateLandWhileSourceOnBattlefield') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'animateLandWhileSourceOnBattlefield reads the exact battlefield source retained by a selfEnters trigger; a resolving spell has no battlefield source incarnation',
      ),
    ];
  }
  if (effect.kind === 'animateSourceUntilEndOfTurn') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        "animateSourceUntilEndOfTurn reads a battlefield artifact source incarnation and is legal only inside that permanent's activated ability",
      ),
    ];
  }
  if (!isSourceBodyEffect(effect.kind) || isTargetedFight(effect)) return [];
  return [
    violation(
      'EFFECT_ILLEGAL_ON_CARD_TYPE',
      path,
      `${effect.kind} reads the source's own body on the battlefield, and a spell on the stack is not one; print it on a creature's triggered ability`,
    ),
  ];
}

/**
 * Every structural check one effect list gets: per-effect param/target/scope
 * legality, plus the list-level distinct-target and duplicate-effect checks.
 *
 * Extracted so a modal spell's own mode gets the identical rigor rather than
 * a second, drifted copy of this loop — `checkEffects` below calls it once
 * for the card's flat `effects` and once per entry in `card.modes`.
 */
function checkEffectList(
  effects: readonly Effect[],
  pathPrefix: string,
  cardColors: readonly Color[],
): Violation[] {
  const found: Violation[] = [];
  const tolledCounter = effects.find(
    (effect) => effect.kind === 'counterSpell' && effect.unlessCost !== undefined,
  );
  if (tolledCounter !== undefined && effects.length !== 1) {
    found.push(
      violation(
        'UNLESS_NEEDS_ONE_EFFECT',
        pathPrefix,
        'a mode-local counter toll modifies exactly one counter instruction; put it in a single-effect spell or mode',
      ),
    );
  }
  for (const [index, effect] of effects.entries()) {
    const path = `${pathPrefix}[${index}]`;
    if (effect.kind === 'loseLife' && effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp') {
      found.push(
        violation(
          'EFFECT_ILLEGAL_ON_CARD_TYPE',
          `${path}.amountFrom`,
          'triggeringPlayerLifeHalfRoundedUp requires an each-player upkeep trigger that retains the affected player',
        ),
      );
    }
    found.push(...checkEffectParams(effect, path, cardColors));
    found.push(...checkEffectTarget(effect, path));
    found.push(...checkEffectScope(effect, path));
    found.push(...checkPlayerSweep(effect, path));
    found.push(...checkSourceBodyEffect(effect, path));
  }
  found.push(...checkDistinctTargets(effects));
  found.push(...checkReferentTargets(effects, pathPrefix));
  found.push(...checkReferentAmounts(effects, pathPrefix));
  found.push(...checkDuplicateEffects(effects));
  return found;
}

export function checkEffects(card: Card): Violation[] {
  const found: Violation[] = [];
  const isSpell = card.kind === 'instant' || card.kind === 'sorcery';
  const modes = card.modes ?? [];
  const topXOriginalProfiles = [...card.effects, ...modes.flatMap((mode) => mode.effects)].filter(
    (effect) =>
      effect.kind === 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts' &&
      effect.topXOriginalsProfile === true,
  );
  if (topXOriginalProfiles.length > 0) {
    if (!isSpell || !card.manaCost.hasX) {
      found.push(
        violation(
          'CHOSEN_X_WITHOUT_X_COST',
          'effects',
          'the top-X original-card cast profile is legal only on a spell whose own mana cost contains X',
        ),
      );
    }
    if (
      topXOriginalProfiles.length !== 1 ||
      card.effects.length !== 1 ||
      card.effects[0] !== topXOriginalProfiles[0] ||
      modes.length !== 0
    ) {
      found.push(
        violation(
          'EFFECT_ILLEGAL_ON_CARD_TYPE',
          'effects',
          'the top-X exile, optional cast window, and remainder cleanup are one closed single-effect spell profile',
        ),
      );
    }
  }
  if (card.kind === 'land' && card.cannotBeCountered === true) {
    found.push(
      violation(
        'CASTING_RULE_ILLEGAL_ON_CARD_TYPE',
        'cannotBeCountered',
        'a land is played rather than cast as a spell, so it cannot carry a rule about being countered',
      ),
    );
  }
  if (!isSpell && card.effects.length > 0) {
    found.push(
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        'effects',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a spell's effect list; move them into a triggered ability`,
      ),
    );
  }
  if (!isSpell && modes.length > 0) {
    found.push(
      violation(
        'MODES_ILLEGAL_ON_CARD_TYPE',
        'modes',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a modal spell's mode list; move them into a triggered ability`,
      ),
    );
  }
  if (isSpell && card.effects.length > 0 && modes.length > 0) {
    found.push(
      violation(
        'EFFECTS_AND_MODES_BOTH_PRESENT',
        'modes',
        `a spell prints a fixed effect list or a modal one, not both; move the effects into a mode of their own or remove modes`,
      ),
    );
  }
  if (isSpell && card.effects.length === 0 && modes.length === 0) {
    found.push(
      violation(
        'SPELL_WITHOUT_EFFECT',
        'effects',
        `${withArticle(card.kind)} must have at least one effect or at least two modes`,
      ),
    );
  }
  if (isSpell) {
    for (const [index, effectIndex] of (card.printedEffectParagraphBreaks ?? []).entries()) {
      if (effectIndex >= card.effects.length) {
        found.push(
          violation(
            'EFFECT_PARAM_OUT_OF_RANGE',
            `printedEffectParagraphBreaks[${String(index)}]`,
            `paragraph break ${String(effectIndex)} must name an effect after the first and before ${String(card.effects.length)}`,
          ),
        );
      }
    }
  }
  if (!isSpell && card.may !== undefined) {
    found.push(
      violation(
        'MAY_ILLEGAL_ON_CARD_TYPE',
        'may',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a spell's "you may" clause; move it into an optional triggered ability`,
      ),
    );
  }
  if (isSpell && card.may !== undefined && modes.length > 0) {
    found.push(
      violation(
        'MAY_AND_MODES_BOTH_PRESENT',
        'may',
        `a spell asks its "you may" question about a fixed effect list, not a choice among modes; move the modal effects into a mode of their own or remove "may"`,
      ),
    );
  }
  const hasEffectLocalCounterToll = [...card.effects, ...modes.flatMap((mode) => mode.effects)].some(
    (effect) => effect.kind === 'counterSpell' && effect.unlessCost !== undefined,
  );
  const hasChosenXCounterToll = [...card.effects, ...modes.flatMap((mode) => mode.effects)].some(
    (effect) =>
      effect.kind === 'counterSpell' &&
      effect.unlessCost !== undefined &&
      'kind' in effect.unlessCost &&
      effect.unlessCost.kind === 'chosenX',
  );
  if (hasChosenXCounterToll && (card.kind === 'land' || !card.manaCost.hasX)) {
    found.push(
      violation(
        'UNLESS_CHOSEN_X_WITHOUT_X_COST',
        'effects',
        'a chosen-X counter toll needs an {X} in this spell cost for its caster to announce',
      ),
    );
  }
  if (card.unless !== undefined && hasEffectLocalCounterToll) {
    found.push(
      violation(
        'UNLESS_DUPLICATED',
        'unless',
        'a spell cannot carry both a card-level "unless" clause and an effect-local counter toll; keep the clause that belongs to the counter instruction',
      ),
    );
  }
  found.push(...checkUnless(card, isSpell, modes.length > 0));
  found.push(...checkEffectList(card.effects, 'effects', card.colors));
  found.push(...checkChosenXOnSpell(card, card.effects, 'effects'));
  found.push(...checkPaidSacrificePowerOnSpell(card, card.effects, 'effects'));
  for (const [modeIndex, mode] of modes.entries()) {
    found.push(...checkEffectList(mode.effects, `modes[${modeIndex}].effects`, card.colors));
    found.push(...checkChosenXOnSpell(card, mode.effects, `modes[${modeIndex}].effects`));
    found.push(...checkPaidSacrificePowerOnSpell(card, mode.effects, `modes[${modeIndex}].effects`));
  }
  return found;
}

/**
 * The four bounds on an "unless" clause, all of them the printed line's rather
 * than the engine's.
 *
 * Split into its own function instead of five more blocks inside `checkEffects`
 * because every one of them reads the same three facts — is this a spell, does
 * it print modes, what is its one effect aimed at — and a reader following the
 * modal and "you may" guards above should not have to hold a fourth clause's
 * state to get past them. `unless.ts` argues each bound at length; this states
 * it to the author who tripped it.
 */
function checkUnless(card: Card, isSpell: boolean, hasModes: boolean): Violation[] {
  const clause = card.unless;
  if (clause === undefined) return [];
  const found: Violation[] = [];
  if (!isSpell) {
    found.push(
      violation(
        'UNLESS_ILLEGAL_ON_CARD_TYPE',
        'unless',
        `a permanent's effects are printed inside its abilities, so ${withArticle(card.kind)} cannot carry a spell's "unless" clause`,
      ),
    );
    return found;
  }
  if (hasModes) {
    found.push(
      violation(
        'UNLESS_AND_MODES_BOTH_PRESENT',
        'unless',
        'an "unless" clause names the player its own effect is aimed at, and which effect that is depends on the mode chosen; print the clause on a spell with a fixed effect',
      ),
    );
  }
  if (card.may !== undefined) {
    found.push(
      violation(
        'UNLESS_AND_MAY_BOTH_PRESENT',
        'unless',
        'a spell that pauses twice while it resolves is not a card the kernel can run; keep the "you may" or the "unless" and drop the other',
      ),
    );
  }
  if (clause.cost.hasX) {
    found.push(
      violation(
        'UNLESS_COST_IS_VARIABLE',
        'unless.cost',
        'an {X} toll needs an X, and the payer is not the caster: nothing on this card says what the player being charged would be choosing; state a fixed price',
      ),
    );
  } else if (manaValue(clause.cost) === 0) {
    found.push(
      violation(
        'UNLESS_COST_IS_FREE',
        'unless.cost',
        'a price of {0} is a clause the card prints and never charges; state what stopping this spell costs, or remove the clause',
      ),
    );
  }
  if (card.effects.length !== 1) {
    if (!hasModes) {
      found.push(
        violation(
          'UNLESS_NEEDS_ONE_EFFECT',
          'unless',
          `the clause modifies the sentence it is printed on, and this spell prints ${String(card.effects.length)} of them; a spell carrying "unless" prints exactly one effect`,
        ),
      );
    }
    return found;
  }
  const legal = UNLESS_PAYER_TARGETS[clause.payer];
  const only = card.effects[0];
  const aimed = only !== undefined && hasTarget(only) ? only.target.kind : undefined;
  const payerIsCounteredSpellController =
    clause.payer === 'targetController' && only?.kind === 'counterSpell';
  if (!payerIsCounteredSpellController && (aimed === undefined || !legal.includes(aimed))) {
    found.push(
      violation(
        'UNLESS_PAYER_HAS_NO_TARGET',
        'unless.payer',
        `"${unlessPayerPhrase(clause.payer)}" is read off what this spell targets, and ${aimed === undefined ? 'it targets nothing' : `"${aimed}" is not one of ${legal.join(', ')}`}`,
      ),
    );
  }
  return found;
}

/**
 * A chosen-X amount reads the X paid to cast this exact spell, so it is legal
 * only on a spell whose own mana cost carries `X` (a land has no cast, hence
 * `card.kind !== 'land'` guards this the same way `checkEffects` above does).
 */
function checkChosenXOnSpell(card: Card, effects: readonly Effect[], pathPrefix: string): Violation[] {
  if (card.kind === 'land' || card.manaCost.hasX) return [];
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (!effectUsesChosenX(effect)) continue;
    found.push(
      violation(
        'CHOSEN_X_WITHOUT_X_COST',
        `${pathPrefix}[${index}]`,
        'a chosen-X amount is legal only on a spell whose own mana cost contains X',
      ),
    );
  }
  return found;
}

/** A paid-sacrifice amount needs exactly one additional-cost permanent. */
function checkPaidSacrificePowerOnSpell(
  card: Card,
  effects: readonly Effect[],
  pathPrefix: string,
): Violation[] {
  const count =
    card.kind === 'instant' || card.kind === 'sorcery'
      ? card.additionalCost !== undefined && 'sacrificeMatching' in card.additionalCost
        ? card.additionalCost.sacrificeMatching.count
        : undefined
      : undefined;
  if (count === 1) return [];
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    if (effectUsesPaidDiscardManaValue(effect)) {
      found.push(
        violation(
          'ILLEGAL_REFERENT_AMOUNT',
          `${pathPrefix}[${index}]`,
          'a paid-discard-mana-value amount is legal only on an activated ability whose cost discards exactly one card',
        ),
      );
    }
    if (!effectUsesPaidSacrificePower(effect) && !effectUsesPaidSacrificeToughness(effect)) continue;
    found.push(
      violation(
        'ILLEGAL_REFERENT_AMOUNT',
        `${pathPrefix}[${index}]`,
        'a paid-sacrifice-power or paid-sacrifice-toughness amount needs an additional cost that sacrifices exactly one permanent',
      ),
    );
  }
  return found;
}
