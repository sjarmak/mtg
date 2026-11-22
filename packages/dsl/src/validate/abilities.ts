/**
 * Ability legality: where an ability may be printed, and whether the numbers it
 * names are inside the ranges the rest of the vocabulary uses.
 *
 * The argument is `checkEffects`': a card whose printed text the kernel cannot
 * run is the failure the whole vocabulary exists to prevent, so every rule here
 * is a coded violation carrying a path a repair loop can act on, never a parse
 * error and never a silent correction.
 */
import type {
  Ability,
  ActivatedAbility,
  AttachingAbility,
  StaticAbility,
  StaticModification,
  StaticPlayerRuleAbility,
  StaticBundleAbility,
  StateTriggeredAbility,
  TriggeredAbility,
} from '../abilities';
import {
  EQUIPMENT_SUBTYPE,
  hasAbilityEffects,
  isAttachingAbility,
  isCounterTriggeringSpellOrAbilityAbility,
  isConjuredCurrencyAbility,
  isControlledCreatureCombatDamageCountersAbility,
  isCombatDamageRetaliationAbility,
  isJaceArchitectAbility,
  isControlledSubtypeAttacksTokenAbility,
  isDamageTargetAndCreaturesWithSameNameAbility,
  isExaltedAbility,
  isEnchantedLandBecomesTappedMillAbility,
  isOptionalDrawThenDiscardAbility,
  isOptionalDiscardThenDrawAbility,
  isControllerDamageRemovesSourceCounterAbility,
  isPutCounterThenWinAtThresholdAbility,
  isRegenerationAbility,
  isReturnAnotherCreatureOrSacrificeSelfAbility,
  isSacrificeSelfUnlessControllerPaysAbility,
  isScavengeAbility,
  isVariableLoyaltyCost,
} from '../abilities';
import { canonicalJson } from '../canonical-json';
import { isLiteralAmount } from '../amount';
import { MAX_CARD_ABILITIES, printedEntryReplacement, type Card } from '../card';
import type { Condition } from '../condition';
import type { Effect } from '../effects';
import {
  effectUsesPaidDiscardManaValue,
  effectUsesPaidSacrificePower,
  effectUsesPaidSacrificeToughness,
  hasTarget,
  isSourceBodyEffect,
  isSourceLinkedExileWriter,
  isTargetedFight,
} from '../effects';
import { hybridPips, manaValue } from '../mana';
import {
  isMultipleTargetSpec,
  isSourceAttachmentTarget,
  isSourceAttackTarget,
  targetFilterIsEmpty,
} from '../targets';
import { classifyStaticModification } from '../static-modification-class';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { withArticle } from '../text-util';
import {
  assertNever,
  COLORS,
  SUBTYPE_PATTERN,
  TRIGGER_PRINT_TEMPLATES,
  TRIGGERING_CREATURE_CONDITIONS,
  TRIGGERING_PLAYER_CONDITIONS,
} from '../vocabulary';
import { MAX_MANA_VALUE } from './cost';
import {
  checkEffectParams,
  checkTargetCardinality,
  checkCardFilterLists,
  checkPermanentFilterLists,
  checkEffectScope,
  checkPlayerSweep,
  checkReferentAmounts,
  checkReferentTargets,
  checkRange,
  effectUsesChosenX,
  legalTargetsFor,
  LIMITS,
} from './effects';

interface AbilitySourceContext {
  readonly kind: Card['kind'];
  readonly colors: Card['colors'];
  readonly creatureAura: boolean;
  readonly nonlandPermanentAura: boolean;
  readonly landAura: boolean;
  readonly equipment: boolean;
  readonly choosesPlayerOnEntry: boolean;
  readonly choosesTwoColorsOnEntry: boolean;
}

function sourceContext(card: Card): AbilitySourceContext {
  return {
    kind: card.kind,
    colors: card.colors,
    creatureAura: card.kind === 'enchantment' && card.aura !== undefined,
    nonlandPermanentAura: card.kind === 'enchantment' && card.aura?.enchant === 'nonlandPermanent',
    landAura: card.kind === 'enchantment' && card.aura?.enchant === 'land',
    equipment: card.kind === 'artifact' && card.subtypes.includes(EQUIPMENT_SUBTYPE),
    choosesPlayerOnEntry: printedEntryReplacement(card)?.kind === 'choosePlayer',
    choosesTwoColorsOnEntry: printedEntryReplacement(card)?.kind === 'chooseTwoColors',
  };
}

/**
 * A `chosenX` amount reads a number somebody announced, so the object printing
 * it has to be the kind of object that announces one.
 *
 * An activated ability is. CR 602.2b routes an activation through the same CR
 * 601.2 steps a cast uses, so its `{X}` is announced (CR 601.2b, CR 107.3f) and
 * paid (CR 601.2h) before the ability is ever on the stack, and `mtg-nhyv.17`
 * banks that value on the `StackEntry` the resolution reads — the same field a
 * cast spell has always banked it on. A triggered ability is not, and no lane
 * makes it one: it has no cost, nobody announces anything as it goes on the
 * stack (CR 603.3), and there is no number for this amount to name.
 *
 * So the permission is a fact about the ability *around* the effect rather than
 * about the effect, which is why it arrives as an argument: the activated call
 * site passes `ability.cost.mana.hasX` and the triggered one passes `false`
 * outright. `checkActivationCost` holds the other half of the pair — an `{X}`
 * that no effect reads — and argues why that direction is refused on an
 * activation while a spell is allowed it.
 */
function checkChosenXInAbility(effect: Effect, path: string, announcesX: boolean): Violation[] {
  if (announcesX) return [];
  if (!effectUsesChosenX(effect)) return [];
  return [
    violation(
      'CHOSEN_X_WITHOUT_X_COST',
      path,
      'a chosen-X amount reads a value somebody announced: print {X} in the mana cost of this activated ability, or state a fixed amount. A triggered ability has no cost and can announce nothing',
    ),
  ];
}

/** Bazaar Krovod's exact "another target attacking creature" context. */
function isSourceExcludedAttackTarget(ability: TriggeredAbility, effect: Effect): boolean {
  return (
    ability.condition === 'selfAttacks' &&
    effect.kind === 'pumpUntilEndOfTurn' &&
    canonicalJson(effect.target) ===
      '{"excludeSource":true,"filter":{"combat":"attacking"},"kind":"targetCreature"}'
  );
}

/**
 * Abilities live on permanents that stay on the battlefield. A land is a
 * permanent and may carry triggered or activated text; the payment planner
 * excludes a tap-self source from the mana sources available to its own cost.
 */
function checkPlacement(card: Card): Violation[] {
  if (card.abilities.length === 0) return [];
  if (
    card.kind === 'creature' ||
    card.kind === 'artifact' ||
    card.kind === 'land' ||
    card.kind === 'planeswalker' ||
    card.kind === 'battle' ||
    card.kind === 'enchantment'
  ) {
    return [];
  }
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities',
      `abilities are printed on permanents that stay on the battlefield; ${withArticle(card.kind)} cannot carry one`,
    ),
  ];
}

/**
 * A `self` scope is the source permanent, and what a static modifies about it —
 * power, toughness, an evergreen keyword — is a creature's characteristic. The
 * same rule `checkKeywords` states for printed keywords.
 */
function checkStaticScope(card: Card, ability: StaticAbility, path: string): Violation[] {
  // A replacement modification is not what the sentence above is about: it
  // rewrites an event (CR 614) and reads no characteristic of the source, so
  // "those belong to creatures that attack and block" is not an argument
  // against printing one on an enchantment. Furnace of Rath is the printing
  // this line would otherwise refuse, and `checkReplacementModificationScope`
  // below is the rule that does apply to it.
  if (classifyStaticModification(ability.modification) === 'replacement') return [];
  if (ability.modification.kind === 'grantTriggeredAbility') return [];
  if (ability.scope !== 'self' || card.kind === 'creature') return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      `${path}.scope`,
      `a "self" static modifies the source's own power, toughness or keywords, and those belong to creatures that attack and block; ${withArticle(card.kind)} cannot carry one`,
    ),
  ];
}

function checkStaticSubtype(ability: StaticAbility, path: string): Violation[] {
  const subtype = ability.subtype;
  if (subtype === null) return [];
  if (ability.scope === 'self' || ability.scope === 'allLands' || ability.scope === 'allCreatures') {
    return [
      violation(
        'STATIC_SUBTYPE_ILLEGAL_ON_SCOPE',
        `${path}.subtype`,
        `a "${ability.scope}" scope already names its complete set of permanents, so narrowing it to "${subtype}" states a condition this scope cannot express; drop the subtype or use a creature-group scope`,
      ),
    ];
  }
  if (SUBTYPE_PATTERN.test(subtype)) return [];
  return [
    violation(
      'INVALID_SUBTYPE',
      `${path}.subtype`,
      `subtype "${subtype}" must be a capitalized word such as "Goblin"`,
    ),
  ];
}

/** A static filter narrows a creature group; one fixed source has no group to narrow. */
function checkStaticFilter(ability: StaticAbility, path: string): Violation[] {
  const filter = ability.filter;
  if (filter === undefined) return [];
  if (ability.scope === 'self' || ability.scope === 'allLands' || ability.scope === 'allCreatures') {
    return [
      violation(
        'STATIC_FILTER_ILLEGAL_ON_SCOPE',
        `${path}.filter`,
        `a "${ability.scope}" scope already names its complete set of permanents, so a filter would change that global meaning; drop the filter or use a creature-group scope`,
      ),
    ];
  }
  if ((filter.token === true || filter.tapped === true) && targetFilterIsEmpty(filter)) return [];
  return checkPermanentFilterLists(filter, `${path}.filter`);
}

/** Modern "this creature" presentation still has to name the actual static source. */
function checkPrintedStaticSubject(card: Card, ability: StaticAbility, path: string): Violation[] {
  if (ability.printedSubjectReference === undefined) return [];
  if (card.kind === 'creature' && ability.scope === 'self') return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      `${path}.printedSubjectReference`,
      'printedSubjectReference is legal only on a self static printed by a creature',
    ),
  ];
}

/** "This card" is meaningful only for the discard replacement that acts from hand. */
function checkPrintedStaticSource(ability: StaticAbility, path: string): Violation[] {
  if (ability.printedSourceReference === undefined) return [];
  if (ability.scope === 'self' && ability.modification.kind === 'discardedByOpponentEntersBattlefield') {
    return [];
  }
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      `${path}.printedSourceReference`,
      'the printed "this card" source reference is legal only on a self-scoped discard replacement',
    ),
  ];
}

/** Authoring checks shared by static predicates and CR 603.4 intervening-if clauses. */
function checkCondition(condition: Condition, at: string): Violation[] {
  switch (condition.kind) {
    case 'controlsSubtype': {
      const found: Violation[] = [
        ...checkRange(
          condition.atLeast,
          LIMITS.conditionThreshold,
          `${at}.atLeast`,
          'condition threshold',
          'CONDITION_THRESHOLD_OUT_OF_RANGE',
        ),
      ];
      if (!SUBTYPE_PATTERN.test(condition.subtype)) {
        found.push(
          violation(
            'INVALID_SUBTYPE',
            `${at}.subtype`,
            `subtype "${condition.subtype}" must be a capitalized word such as "Merfolk"`,
          ),
        );
      }
      return found;
    }
    // `counter` is a `CounterKindSchema` enum member, checked at the schema
    // boundary the same way `withCounter`'s `TargetRestriction` counterpart
    // is (`targets.ts`); there is no further range or pattern to check here.
    case 'anyCreatureHasCounter':
      return [];
    // The same range `controlsSubtype` checks, and the same one: both are the
    // threshold family's floor, so a count outside the shared limit is the
    // same authoring mistake whichever zone it counts.
    case 'opponentGraveyardAtLeast':
      return checkRange(
        condition.atLeast,
        LIMITS.conditionThreshold,
        `${at}.atLeast`,
        'condition threshold',
        'CONDITION_THRESHOLD_OUT_OF_RANGE',
      );
    case 'opponentUndamagedThisTurn':
      return [];
    // The schema supplies the only universal bounds Magic gives a life total:
    // a positive integer. Unlike a subtype count, life itself has no rules
    // maximum, so inventing one here would refuse legal authored cards.
    case 'controllerLifeAtLeast':
    case 'controllerLifeBelow':
    case 'controllerLibraryAtLeast':
    case 'controllerTopLibraryHasColor':
      return [];
    case 'battlefieldCountBelow':
      return checkRange(
        condition.fewerThan,
        LIMITS.conditionThreshold,
        `${at}.fewerThan`,
        'condition threshold',
        'CONDITION_THRESHOLD_OUT_OF_RANGE',
      );
    case 'controlsNoneOfSubtypes': {
      const found: Violation[] = [];
      const firstSeen = new Map<string, number>();
      for (const [index, subtype] of condition.subtypes.entries()) {
        if (!SUBTYPE_PATTERN.test(subtype)) {
          found.push(
            violation(
              'INVALID_SUBTYPE',
              `${at}.subtypes[${index}]`,
              `subtype "${subtype}" must be a capitalized word such as "Knight"`,
            ),
          );
        }
        const earlier = firstSeen.get(subtype);
        if (earlier === undefined) firstSeen.set(subtype, index);
        else {
          found.push(
            violation(
              'DUPLICATE_SUBTYPE',
              `${at}.subtypes[${index}]`,
              `subtype "${subtype}" is already listed at ${at}.subtypes[${earlier}]`,
            ),
          );
        }
      }
      return found;
    }
    case 'selfCounterCountBelow':
      return checkRange(
        condition.fewerThan,
        LIMITS.conditionThreshold,
        `${at}.fewerThan`,
        'condition threshold',
        'CONDITION_THRESHOLD_OUT_OF_RANGE',
      );
    case 'selfCounterCountAtLeast':
      return checkRange(
        condition.atLeast,
        LIMITS.conditionThreshold,
        `${at}.atLeast`,
        'condition threshold',
        'CONDITION_THRESHOLD_OUT_OF_RANGE',
      );
    default:
      return assertNever(condition, 'checkCondition');
  }
}

function checkStaticCondition(ability: StaticAbility, path: string): Violation[] {
  if (
    ability.activeDuring === 'turnsOtherThanYours' &&
    classifyStaticModification(ability.modification) === 'replacement'
  ) {
    return [
      violation(
        'REPLACEMENT_CONDITION_UNSUPPORTED',
        `${path}.activeDuring`,
        `a "${ability.modification.kind}" is evaluated by the replacement pipeline rather than the CR 613 battlefield timing walk; remove activeDuring`,
      ),
    ];
  }
  // `enabledWhile` is optional (`abilities.ts` explains why): an absent key
  // and an explicit `null` both mean unconditional, so both take the same exit.
  const condition = ability.enabledWhile ?? null;
  if (condition === null) return [];
  const at = `${path}.enabledWhile`;
  if (classifyStaticModification(ability.modification) === 'replacement') {
    return [
      violation(
        'REPLACEMENT_CONDITION_UNSUPPORTED',
        at,
        `a "${ability.modification.kind}" is evaluated by the replacement pipeline rather than the CR 613 battlefield condition walk; remove enabledWhile`,
      ),
    ];
  }
  return checkCondition(condition, at);
}

/**
 * What a modification may say, wherever it is printed.
 *
 * Written over the modification and its path rather than over a static ability,
 * because an equip clause carries the same records (`AttachSchema`) and a second
 * copy of these ranges is a second chance for a weapon to ship a bonus a lord
 * could not.
 */
export function checkStaticModificationRecord(modification: StaticModification, at: string): Violation[] {
  switch (modification.kind) {
    case 'statBonus': {
      const found = [
        ...checkRange(
          modification.power,
          LIMITS.statBonusDelta,
          `${at}.power`,
          'power delta',
          'STATIC_MODIFICATION_OUT_OF_RANGE',
        ),
        ...checkRange(
          modification.toughness,
          LIMITS.statBonusDelta,
          `${at}.toughness`,
          'toughness delta',
          'STATIC_MODIFICATION_OUT_OF_RANGE',
        ),
      ];
      if (modification.power === 0 && modification.toughness === 0) {
        found.push(
          violation(
            'STATIC_MODIFICATION_OUT_OF_RANGE',
            at,
            'a +0/+0 static bonus is a no-op; give it a nonzero delta',
          ),
        );
      }
      return found;
    }
    case 'grantKeyword':
    case 'grantTriggeredAbility':
    case 'addSubtype':
    case 'doubleDamage':
    case 'doubleLifeGain':
    case 'doublePlusOnePlusOneCountersOnCreaturesYouControl':
    case 'discardedByOpponentEntersBattlefield':
    case 'preventDamageToSelfAndRemoveCounters':
    case 'preventCombatDamage':
      // None carries a numeric parameter, so there is no range to hold it to.
      // Each member fixes its magnitude or action in its own schema.
      return [];
    case 'damageCannotReduceControllerLifeBelow':
      // The schema already requires a positive integer minimum; no cross-field
      // range or no-op check remains for this validator.
      return [];
    case 'grantKeywordAbilities': {
      const found: Violation[] = [];
      const only = modification.grants.length === 1 ? modification.grants[0] : undefined;
      if (only?.kind === 'keyword') {
        found.push(
          violation(
            'DUPLICATE_MODIFICATION',
            `${at}.grants`,
            'one parameterless keyword uses grantKeyword; reserve this bundle for multiple grants or one payload-bearing keyword ability',
          ),
        );
      }
      const firstSeen = new Map<string, number>();
      for (const [index, grant] of modification.grants.entries()) {
        const quality = grant.kind === 'protection' ? grant.quality : null;
        if (quality?.kind === 'subtype' && !SUBTYPE_PATTERN.test(quality.subtype)) {
          found.push(
            violation(
              'INVALID_SUBTYPE',
              `${at}.grants[${index}].quality.subtype`,
              `subtype "${quality.subtype}" must be a capitalized word such as "Dragon"`,
            ),
          );
        }
        const identity = canonicalJson(grant);
        const earlier = firstSeen.get(identity);
        if (earlier === undefined) {
          firstSeen.set(identity, index);
          continue;
        }
        found.push(
          violation(
            'DUPLICATE_MODIFICATION',
            `${at}.grants[${index}]`,
            `this grant says what ${at}.grants[${earlier}] already says; express it once`,
          ),
        );
      }
      return found;
    }
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'attacksEachCombatIfAble':
    case 'mustBeBlockedIfAble':
    case 'canBlockAnyNumber':
    case 'canAttackAsThoughNoDefender':
    case 'blockOnlyCreaturesWithKeyword':
    case 'cantAttackWithoutAnyOf':
    case 'cantAttackOrBlock':
    case 'cantAttackOrBlockAlone':
      // None of these carries a number — the CR 508/509 restriction or
      // requirement is the whole of what the modification says, and
      // `blockOnlyCreaturesWithKeyword`'s one field is a `Keyword`, which
      // `KeywordSchema` already holds to the pinned enum at parse time; there
      // is no numeric range left for this function to check.
      return [];
    case 'cantBeBlockedBySubtype':
      // The seventh combat member is the one that does need checking here, and
      // for a shape rather than a range. Its field is a free capitalized word
      // (`ability-shape.ts` argues why it is not an enum), so `SUBTYPE_PATTERN`
      // is what stands between "can't be blocked by Walls" and a sentence built
      // from rules text somebody put in the field. Same check, same violation
      // code and same reason as `checkSacrificeOther`'s, which is the other
      // place a card names a subtype outside its own type line.
      return SUBTYPE_PATTERN.test(modification.subtype)
        ? []
        : [
            violation(
              'INVALID_SUBTYPE',
              `${at}.subtype`,
              `subtype "${modification.subtype}" must be a capitalized word such as "Wall"`,
            ),
          ];
    case 'definePt':
      return [
        ...checkRange(
          modification.powerOffset,
          LIMITS.statBonusDelta,
          `${at}.powerOffset`,
          'power offset',
          'STATIC_MODIFICATION_OUT_OF_RANGE',
        ),
        ...checkRange(
          modification.toughnessOffset,
          LIMITS.statBonusDelta,
          `${at}.toughnessOffset`,
          'toughness offset',
          'STATIC_MODIFICATION_OUT_OF_RANGE',
        ),
      ];
    case 'grantAnyColorManaAbility':
      return [];
    case 'statBonusPer':
    case 'statBonusPerColor':
      // The rate, not the total. `statBonusDelta` is the same ceiling
      // `statBonus` is held to, and holding a per-unit bonus to it is
      // deliberately not the same as holding the product to it: the product is
      // a fact about the board a card cannot know when it is written, and the
      // limit that would bound it is a deck-construction limit rather than a
      // card one.
      return [
        ...checkRange(
          modification.power,
          LIMITS.statBonusDelta,
          `${at}.power`,
          'power bonus per unit',
          'STATIC_MODIFICATION_OUT_OF_RANGE',
        ),
        ...checkRange(
          modification.toughness,
          LIMITS.statBonusDelta,
          `${at}.toughness`,
          'toughness bonus per unit',
          'STATIC_MODIFICATION_OUT_OF_RANGE',
        ),
      ];
    default:
      return assertNever(modification, 'checkStaticModificationRecord');
  }
}

/**
 * `checkModification` plus the one rule that needs the ability around it: a
 * characteristic-defining P/T (CR 613.4a) sets the *source's own* power and
 * toughness, so it is legal only where the scope names exactly the source.
 * `checkModification` cannot hold this rule itself — it is written over the
 * modification and its path so an equip clause can share it
 * (`checkEquipAbility` below), and an equip clause has no `scope` at all.
 */
function checkStaticModification(card: Card, ability: StaticAbility, path: string): Violation[] {
  const found = checkStaticModificationRecord(ability.modification, `${path}.modification`);
  if (ability.modification.kind === 'grantTriggeredAbility') {
    found.push(
      ...checkTriggeredAbility(
        sourceContext(card),
        ability.modification.ability,
        `${path}.modification.ability`,
      ),
    );
  }
  if (classifyStaticModification(ability.modification) === 'replacement' && ability.scope !== 'self') {
    found.push(
      violation(
        'REPLACEMENT_MODIFICATION_ILLEGAL_ON_SCOPE',
        `${path}.scope`,
        `a "${ability.modification.kind}" is a replacement effect (CR 614): it rewrites an event, so it reaches no permanent and "${ability.scope}" names a set of them — use "self", the one scope that claims nothing beyond the source`,
      ),
    );
  }
  if (ability.modification.kind === 'definePt' && ability.scope !== 'self') {
    found.push(
      violation(
        'DEFINE_PT_ILLEGAL_ON_SCOPE',
        `${path}.scope`,
        `a characteristic-defining power/toughness (CR 613.4a) sets the source's own stats; "${ability.scope}" names other permanents, which a CDA does not modify — use "self"`,
      ),
    );
  }
  if (ability.modification.kind === 'canBlockAnyNumber' && ability.scope !== 'self') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.scope`,
        'canBlockAnyNumber is currently proven only for the source creature; use the "self" scope',
      ),
    );
  }
  if (ability.modification.kind === 'canAttackAsThoughNoDefender' && ability.scope !== 'self') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.scope`,
        'canAttackAsThoughNoDefender is currently proven only for the source creature; use the "self" scope',
      ),
    );
  }
  if (ability.modification.kind === 'addSubtype' && ability.scope !== 'allLands') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.scope`,
        `addSubtype is the global land-type layer and requires "allLands"; "${ability.scope}" would apply it to the wrong kind of permanent`,
      ),
    );
  }
  if (ability.modification.kind === 'grantAnyColorManaAbility' && ability.scope !== 'landsYouControl') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.scope`,
        `grantAnyColorManaAbility requires "landsYouControl"; "${ability.scope}" would grant the ability to the wrong permanents`,
      ),
    );
  }
  if (ability.modification.kind === 'cantAttackWithoutAnyOf' && ability.scope !== 'allCreatures') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.scope`,
        `cantAttackWithoutAnyOf is the global attack restriction and requires "allCreatures"; "${ability.scope}" would omit creatures the rule reaches`,
      ),
    );
  }
  if (
    (ability.scope === 'landsYouControl' && ability.modification.kind !== 'grantAnyColorManaAbility') ||
    (ability.scope === 'allLands' && ability.modification.kind !== 'addSubtype') ||
    (ability.scope === 'allCreatures' && ability.modification.kind !== 'cantAttackWithoutAnyOf')
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.modification`,
        `the "${ability.scope}" scope has one proven modification; ${ability.modification.kind} belongs to a different scope`,
      ),
    );
  }
  return found;
}

/**
 * What one modification *is*, for the purpose of asking whether a clause says it
 * twice.
 *
 * Not `canonicalJson`, which `checkDuplicateEffects` and `checkDuplicateAbilities`
 * both use, because identity here is coarser than the record. Two `statBonus`
 * entries are one layer-7c record whatever numbers they carry — `+2/+0` beside
 * `+1/+1` is `+3/+1` printed as two clauses — so the kind alone is the identity.
 * Two `grantKeyword` entries are two different grants unless they name the same
 * keyword, which is the whole reason the list exists, so the keyword is part of
 * it.
 */
export function staticModificationIdentity(modification: StaticModification): string {
  switch (modification.kind) {
    case 'statBonus':
      return 'statBonus';
    case 'grantKeyword':
      return `grantKeyword:${modification.keyword}`;
    case 'grantKeywordAbilities':
      return `grantKeywordAbilities:${canonicalJson(modification.grants)}`;
    case 'grantTriggeredAbility':
      return `grantTriggeredAbility:${canonicalJson(modification.ability)}`;
    case 'grantAnyColorManaAbility':
      return 'grantAnyColorManaAbility';
    case 'addSubtype':
      return `addSubtype:${modification.subtype}`;
    case 'definePt':
      // Unreachable through `checkModifications` today — `checkEquipAbility`
      // refuses `definePt` in an equip clause before duplicate detection
      // would ever compare two — but a constant identity is still the right
      // answer for the same reason `statBonus`'s is: two CDAs on one source
      // are one layer-7a record however many clauses printed them.
      return 'definePt';
    // Also unreachable through `checkModifications`, and for a stronger
    // reason: `AttachSchema.modifications` is typed `LayeredStaticModification`,
    // so an equip clause cannot hold a doubler at all. The constant is still
    // the right identity — two "deals double that damage instead" clauses on
    // one source are two applications by CR 614.5 and a doubling of four is
    // what the card would play as, which is exactly the text/behavior
    // disagreement `checkModifications` refuses.
    case 'doubleDamage':
      return 'doubleDamage';
    case 'doubleLifeGain':
      return 'doubleLifeGain';
    case 'doublePlusOnePlusOneCountersOnCreaturesYouControl':
      return 'doublePlusOnePlusOneCountersOnCreaturesYouControl';
    case 'damageCannotReduceControllerLifeBelow':
      return `damageCannotReduceControllerLifeBelow:${String(modification.minimum)}`;
    case 'discardedByOpponentEntersBattlefield':
      return 'discardedByOpponentEntersBattlefield';
    case 'preventDamageToSelfAndRemoveCounters':
      return `preventDamageToSelfAndRemoveCounters:${modification.counter}`;
    case 'cantAttack':
      return 'cantAttack';
    case 'cantBlock':
      return 'cantBlock';
    case 'cantBeBlocked':
      return 'cantBeBlocked';
    case 'attacksEachCombatIfAble':
      return 'attacksEachCombatIfAble';
    case 'mustBeBlockedIfAble':
      return 'mustBeBlockedIfAble';
    case 'canBlockAnyNumber':
      return 'canBlockAnyNumber';
    case 'canAttackAsThoughNoDefender':
      return 'canAttackAsThoughNoDefender';
    case 'blockOnlyCreaturesWithKeyword':
      // Keyed by keyword for `grantKeyword`'s reason: two of these on one
      // clause are two different restrictions unless they name the same
      // keyword, which combine under CR 509.1b's AND rather than collapse.
      return `blockOnlyCreaturesWithKeyword:${modification.keyword}`;
    case 'cantBeBlockedBySubtype':
      // Keyed by subtype for the identical reason, on the identical rule: "can't
      // be blocked by Walls" and "can't be blocked by Zombies" are two
      // restrictions that combine under CR 509.1b, and the same subtype printed
      // twice is one restriction written twice.
      return `cantBeBlockedBySubtype:${modification.subtype}`;
    case 'cantAttackWithoutAnyOf':
      return `cantAttackWithoutAnyOf:${canonicalJson(modification.anyOf)}`;
    case 'cantAttackOrBlock':
      return 'cantAttackOrBlock';
    case 'cantAttackOrBlockAlone':
      return 'cantAttackOrBlockAlone';
    case 'preventCombatDamage':
      return 'preventCombatDamage';
    case 'statBonusPer':
      // Keyed by what it counts, for `blockOnlyCreaturesWithKeyword`'s reason:
      // two rates over two different tallies are two modifications that stack,
      // and two over the same tally are one written twice.
      return `statBonusPer:${JSON.stringify(modification.each)}`;
    case 'statBonusPerColor':
      return 'statBonusPerColor';
    default:
      return assertNever(modification, 'staticModificationIdentity');
  }
}

/**
 * Every modification one clause prints, and the rule that it prints each once.
 *
 * The repeat is refused for the reason `checkDuplicateEffects` refuses a
 * repeated effect: the kernel applies both, so the card plays as one
 * modification of double the size while printing the line twice, and the text
 * and the behavior disagree. `renderEquipAbility` would say "Equipped creature
 * gets +2/+0 and gets +1/+1", which is a sentence no card prints.
 */
function checkModifications(modifications: readonly StaticModification[], at: string): Violation[] {
  const found: Violation[] = [];
  const firstSeen = new Map<string, number>();
  for (const [index, modification] of modifications.entries()) {
    found.push(...checkStaticModificationRecord(modification, `${at}[${index}]`));
    const key = staticModificationIdentity(modification);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    found.push(
      violation(
        'DUPLICATE_MODIFICATION',
        `${at}[${index}]`,
        `this ${modification.kind} says what ${at}[${earlier}] already says; express the intent as one modification`,
      ),
    );
  }
  return found;
}

/**
 * CR 603.3b's "you may" governs the whole ability, so the whole ability is one
 * effect.
 *
 * The kernel asks once, as the trigger resolves, and either every printed effect
 * happens or none does. A two-effect optional trigger would print "When
 * CARDNAME dies, you may draw a card. You gain 2 life." — English in which the
 * "may" reaches the first sentence and not the second, describing a card that
 * behaves the other way. Magic ordinarily joins the two halves with "If you
 * do", which requires a retained choice/result relationship. The one admitted
 * shapes are the exact draw-one-then-discard-one sequence used by Izzet Keyrune
 * and the discard-one-then-draw-one sequence used by Viashino Racketeer; their
 * recognizers, renderers, kernel paths, and Forge exporters share closed
 * envelopes. Every other multi-effect optional trigger remains
 * outside this vocabulary (`docs/design/dsl-v1-ability-model.md` §6.2).
 *
 * So the rule is a card rule, not a schema rule: it has a path and a coded
 * violation a repair loop can act on, and the fix it names is the one a designer
 * would make anyway.
 */
function checkOptionalTrigger(ability: TriggeredAbility, path: string): Violation[] {
  if (
    ability.optional !== true ||
    ability.effects.length === 1 ||
    isOptionalDrawThenDiscardAbility(ability) ||
    isOptionalDiscardThenDrawAbility(ability) ||
    ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true ||
    ability.searchTheCityProfile === 'matchingNameCompletion'
  ) {
    return [];
  }
  return [
    violation(
      'OPTIONAL_TRIGGER_INVALID',
      `${path}.effects`,
      `"you may" is answered once for the whole ability, so an optional trigger prints one effect unless it is an exact supported linked draw-and-discard sequence; this one prints ${ability.effects.length}. Drop one, or drop the "optional"`,
    ),
  ];
}

/** Keep payment, optionality, death event, target and discard payload atomic. */
function checkPaidOptionalTrigger(ability: TriggeredAbility, path: string): Violation[] {
  const payment = ability.optionalControllerPayment;
  if (payment === undefined) return [];
  const effect = ability.effects[0];
  const competingRefinement =
    ability.interveningIf !== undefined ||
    ability.targetChooser !== undefined ||
    ability.spellColors !== undefined ||
    ability.spellIsMulticolored === true ||
    ability.castFromGraveyardByAnyPlayer === true ||
    ability.attackingCreatureSubtype !== undefined ||
    ability.landSubtype !== undefined ||
    ability.triggeringPlayerIsEnchantedCreatureController === true ||
    ability.triggeringPlayerIsOpponent === true ||
    ability.triggeringPlayerHandAtMost !== undefined ||
    ability.triggerZone !== undefined ||
    ability.counterTriggeringSpellOrAbilityUnless !== undefined ||
    ability.sacrificeSelfUnlessControllerPays !== undefined;
  if (
    ability.optional !== true ||
    ability.condition !== 'selfDies' ||
    ability.effects.length !== 1 ||
    effect?.kind !== 'discardCards' ||
    effect.count !== 1 ||
    effect.target.kind !== 'targetPlayer' ||
    payment.cost.hasX ||
    manaValue(payment.cost) === 0 ||
    competingRefinement
  ) {
    return [
      violation(
        'PAID_OPTIONAL_TRIGGER_INVALID',
        `${path}.optionalControllerPayment`,
        'optionalControllerPayment is a fixed nonzero cost on the exact optional selfDies target-player one-card discard bundle with no independent trigger refinement',
      ),
    ];
  }
  return [];
}

/** The exact envelope that gives a target trigger a retained stack-object toll. */
function checkCounterTrigger(ability: TriggeredAbility, path: string): Violation[] {
  const clause = ability.counterTriggeringSpellOrAbilityUnless;
  if (clause === undefined) {
    return ability.effects.length > 0 ||
      ability.sacrificeEnchantedPermanentUnlessControllerPaysManaValue === true ||
      ability.controllerDamageRemovesSourceCounter !== undefined ||
      ability.opponentCreatureDiesReturnAtNextEndStep !== undefined ||
      ability.searchTheCityProfile !== undefined ||
      ability.guildFeudContest === true
      ? []
      : [
          violation(
            'COUNTER_TRIGGER_INVALID',
            `${path}.effects`,
            'a triggered ability with no effects must state the retained spell-or-ability counter clause it resolves',
          ),
        ];
  }
  const found: Violation[] = [];
  if (!isCounterTriggeringSpellOrAbilityAbility(ability)) {
    found.push(
      violation(
        'COUNTER_TRIGGER_INVALID',
        path,
        'counterTriggeringSpellOrAbilityUnless is legal only on selfBecomesTargetByOpponent',
      ),
    );
  }
  if (ability.effects.length > 0 || ability.optional === true) {
    found.push(
      violation(
        'COUNTER_TRIGGER_INVALID',
        path,
        'the retained spell-or-ability counter clause is the whole mandatory trigger; remove ordinary effects and optional',
      ),
    );
  }
  if (clause.cost.hasX || manaValue(clause.cost) === 0) {
    found.push(
      violation(
        'COUNTER_TRIGGER_INVALID',
        `${path}.counterTriggeringSpellOrAbilityUnless.cost`,
        'the opposing controller must be charged a fixed, nonzero mana cost',
      ),
    );
  }
  return found;
}

/** Soul Tithe's entire Aura-host trigger stays one inseparable capability. */
function checkSacrificeEnchantedPermanentUnlessControllerPaysManaValue(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  if (ability.sacrificeEnchantedPermanentUnlessControllerPaysManaValue !== true) return [];
  const exact =
    source.nonlandPermanentAura &&
    ability.condition === 'beginningOfEachPlayersUpkeep' &&
    ability.triggeringPlayerIsEnchantedCreatureController === true &&
    ability.effects.length === 0 &&
    ability.optional !== true &&
    ability.interveningIf === undefined &&
    ability.targetChooser === undefined &&
    ability.counterTriggeringSpellOrAbilityUnless === undefined &&
    ability.sacrificeSelfUnlessControllerPays === undefined;
  return exact
    ? []
    : [
        violation(
          'TRIGGER_UNLESS_INVALID',
          `${path}.sacrificeEnchantedPermanentUnlessControllerPaysManaValue`,
          'the mana-value toll is the whole mandatory attachment-relative upkeep trigger on an enchant-nonland-permanent Aura',
        ),
      ];
}

/** The exact envelope for “sacrifice it unless you pay” on source entry. */
function checkSacrificeSelfUnlessControllerPays(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  const clause = ability.sacrificeSelfUnlessControllerPays;
  if (clause === undefined) return [];
  const found: Violation[] = [];
  if (source.kind !== 'land' || !isSacrificeSelfUnlessControllerPaysAbility(ability)) {
    found.push(
      violation(
        'TRIGGER_UNLESS_INVALID',
        path,
        'sacrificeSelfUnlessControllerPays is legal only on a land selfEnters trigger with one selfPermanent sacrificeSelf effect',
      ),
    );
  }
  if (
    ability.optional === true ||
    ability.counterTriggeringSpellOrAbilityUnless !== undefined ||
    ability.effects.length !== 1
  ) {
    found.push(
      violation(
        'TRIGGER_UNLESS_INVALID',
        path,
        'the controller-paid self-sacrifice toll is the whole mandatory trigger and cannot compose with another pause or payload',
      ),
    );
  }
  if (clause.cost.hasX || manaValue(clause.cost) === 0) {
    found.push(
      violation(
        'TRIGGER_UNLESS_INVALID',
        `${path}.sacrificeSelfUnlessControllerPays.cost`,
        'the source controller must be charged a fixed, nonzero mana cost',
      ),
    );
  }
  return found;
}

/** Bind the return cost and self-sacrifice consequence into one creature trigger. */
function checkReturnAnotherCreatureOrSacrificeSelf(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  if (ability.returnAnotherCreatureOrSacrificeSelf !== true) return [];
  const competingRefinement =
    ability.optional === true ||
    ability.interveningIf !== undefined ||
    ability.targetChooser !== undefined ||
    ability.spellColors !== undefined ||
    ability.spellIsMulticolored === true ||
    ability.castFromGraveyardByAnyPlayer === true ||
    ability.attackingCreatureSubtype !== undefined ||
    ability.landSubtype !== undefined ||
    ability.triggeringPlayerIsEnchantedCreatureController === true ||
    ability.triggeringPlayerIsOpponent === true ||
    ability.triggeringPlayerHandAtMost !== undefined ||
    ability.triggerZone !== undefined ||
    ability.counterTriggeringSpellOrAbilityUnless !== undefined ||
    ability.sacrificeSelfUnlessControllerPays !== undefined ||
    ability.optionalControllerPayment !== undefined;
  if (
    source.kind !== 'creature' ||
    !isReturnAnotherCreatureOrSacrificeSelfAbility(ability) ||
    competingRefinement
  ) {
    return [
      violation(
        'RETURN_ANOTHER_CREATURE_OR_SACRIFICE_INVALID',
        path,
        'returnAnotherCreatureOrSacrificeSelf is the whole mandatory selfEnters trigger on a creature with one selfCreature sacrificeSelf consequence',
      ),
    ];
  }
  return [];
}

/** Cast-event refinements belong only to their one typed trigger envelope. */
function checkSpellColors(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  const found: Violation[] = [];
  if (ability.spellColors !== undefined && ability.condition !== 'youCastSpell') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.spellColors`,
        'spellColors is legal only on youCastSpell, whose event supplies the cast spell colors',
      ),
    );
  }
  if (ability.spellIsMulticolored === true && ability.condition !== 'youCastSpell') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.spellIsMulticolored`,
        'spellIsMulticolored is legal only on youCastSpell, whose event supplies the cast spell colors',
      ),
    );
  }
  if (ability.spellColors !== undefined && ability.spellIsMulticolored === true) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.spellIsMulticolored`,
        'spellIsMulticolored and spellColors are competing cast-event refinements',
      ),
    );
  }
  const chosenColorEffect = ability.effects[0];
  const exactChosenColorBundle =
    source.kind === 'artifact' &&
    source.choosesTwoColorsOnEntry &&
    ability.condition === 'youCastSpell' &&
    ability.spellSharesChosenColors === true &&
    ability.effects.length === 1 &&
    chosenColorEffect?.kind === 'gainLife' &&
    typeof chosenColorEffect.amount !== 'number' &&
    chosenColorEffect.amount.kind === 'triggeringSpellChosenColorCount' &&
    chosenColorEffect.target.kind === 'noTarget';
  const usesChosenColorAmount = ability.effects.some((effect) =>
    Object.values(effect).some(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'triggeringSpellChosenColorCount',
    ),
  );
  if ((ability.spellSharesChosenColors === true || usesChosenColorAmount) && !exactChosenColorBundle) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.spellSharesChosenColors`,
        'spellSharesChosenColors requires an artifact that chooses two colors on entry and one no-target gainLife effect using triggeringSpellChosenColorCount',
      ),
    );
  }
  if (ability.castFromGraveyardByAnyPlayer === true && ability.condition !== 'youCastSpell') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.castFromGraveyardByAnyPlayer`,
        'castFromGraveyardByAnyPlayer is legal only on youCastSpell, whose event supplies cast origin and caster',
      ),
    );
  }
  if (
    ability.castFromGraveyardByAnyPlayer === true &&
    (ability.spellColors !== undefined || ability.spellIsMulticolored === true)
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.castFromGraveyardByAnyPlayer`,
        'castFromGraveyardByAnyPlayer is a complete cast-event refinement and cannot compose with spell color refinements',
      ),
    );
  }
  return found;
}

/** One controlled-attacker subtype filter and one token payload stay atomic. */
function checkControlledSubtypeAttackTrigger(ability: TriggeredAbility, path: string): Violation[] {
  const hasClause = ability.attackingCreatureSubtype !== undefined;
  if (!hasClause) return [];
  if (
    !isControlledSubtypeAttacksTokenAbility(ability) ||
    ability.optional === true ||
    ability.interveningIf !== undefined ||
    ability.counterTriggeringSpellOrAbilityUnless !== undefined ||
    ability.sacrificeSelfUnlessControllerPays !== undefined
  ) {
    return [
      violation(
        'FILTERED_ATTACK_TRIGGER_INVALID',
        path,
        'a controlled-subtype attack trigger is one mandatory createToken effect with a count of 1 and no independent trigger refinement',
      ),
    ];
  }
  return [];
}

/**
 * The same effect twice inside one ability is one effect printed twice: the
 * kernel applies both, and the card reads "You gain 2 life. You gain 2 life."
 * where the design meant 4. `checkDuplicateEffects` makes the same argument for
 * a spell's list.
 */
function checkDuplicateAbilityEffects(effects: readonly Effect[], pathPrefix: string): Violation[] {
  const firstSeen = new Map<string, number>();
  const found: Violation[] = [];
  for (const [index, effect] of effects.entries()) {
    const key = canonicalJson(effect);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    found.push(
      violation(
        'DUPLICATE_EFFECT',
        `${pathPrefix}[${index}]`,
        `this ${effect.kind} repeats ${pathPrefix}[${earlier}] exactly; express the intent as one effect with the larger number`,
      ),
    );
  }
  return found;
}

/** List-level invariants shared by an ability and each random outcome branch. */
function checkAbilityEffectList(
  effects: readonly Effect[],
  pathPrefix: string,
  allowTriggeringCreatureAmounts = false,
  triggeringDamageUse: 'none' | 'dealtDamage' | 'combatDamageMill' | 'combatDamageCounters' = 'none',
  allowTriggeringSpellChosenColorCount = false,
): Violation[] {
  return [
    ...checkReferentTargets(effects, pathPrefix),
    ...checkReferentAmounts(
      effects,
      pathPrefix,
      allowTriggeringCreatureAmounts,
      triggeringDamageUse,
      allowTriggeringSpellChosenColorCount,
    ),
    ...checkDuplicateAbilityEffects(effects, pathPrefix),
  ];
}

/** A permanent ability has no resolving spell object for `exileThisSpell`. */
function checkSpellOnlyEffectInAbility(effect: Effect, path: string): Violation[] {
  if (effect.kind === 'exileThisSpell') {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'exileThisSpell names the resolving instant or sorcery on the stack; a permanent ability has no spell card to exile',
      ),
    ];
  }
  if (effect.kind === 'counterSpell' && effect.unlessCost !== undefined) {
    return [
      violation(
        'UNLESS_ILLEGAL_ON_CARD_TYPE',
        `${path}.unlessCost`,
        'a mode-local counter toll belongs to an instant or sorcery effect; an ability must use its dedicated counter-unless vocabulary',
      ),
    ];
  }
  if (
    effect.kind === 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts' &&
    effect.topXOriginalsProfile === true
  ) {
    return [
      violation(
        'EFFECT_ILLEGAL_ON_CARD_TYPE',
        path,
        'the top-X original-card cast profile reads the X announced for its resolving spell and cannot appear in a permanent ability',
      ),
    ];
  }
  return [];
}

/** The supported linked pairs write on entry and read on departure. */
function checkSourceLinkedExileInTrigger(
  ability: TriggeredAbility,
  effect: Effect,
  path: string,
): Violation[] {
  if (effect.kind === 'searchLibrary' && effect.destination === 'sourceLinkedExile') {
    return ability.condition === 'selfEnters'
      ? []
      : [
          violation(
            'SOURCE_LINKED_EXILE_INVALID',
            path,
            'the current source-linked writer retains an enters-search result on the battlefield source; place it on a selfEnters trigger',
          ),
        ];
  }
  if (effect.kind === 'exileTarget' && effect.linkToSource === true) {
    return ability.condition === 'selfEnters'
      ? []
      : [
          violation(
            'SOURCE_LINKED_EXILE_INVALID',
            path,
            'a source-linked targeted exile retains an enters-trigger result on the battlefield source; place it on a selfEnters trigger',
          ),
        ];
  }
  if (effect.kind !== 'moveSourceLinkedExile') return [];
  const requiredCondition =
    effect.destination === 'hand' && effect.plural !== true ? 'selfDies' : 'selfLeavesBattlefield';
  return ability.condition === requiredCondition
    ? []
    : [
        violation(
          'SOURCE_LINKED_EXILE_INVALID',
          path,
          `moveSourceLinkedExile to ${effect.destination} reads the source relation retained on ${requiredCondition}; place it on that trigger`,
        ),
      ];
}

/** Activated entries do not retain the source-linked relation on their stack object. */
function checkSourceLinkedExileInActivation(effect: Effect, path: string): Violation[] {
  const linkedWriter = isSourceLinkedExileWriter(effect);
  if (!linkedWriter && effect.kind !== 'moveSourceLinkedExile') return [];
  return [
    violation(
      'SOURCE_LINKED_EXILE_INVALID',
      path,
      'the current source-linked pair is retained only from a selfEnters trigger to a matching source-departure trigger; activated abilities do not carry that relation',
    ),
  ];
}

/** The current source-bound animation is proven only for an entry trigger. */
function checkLandAnimationInTrigger(ability: TriggeredAbility, effect: Effect, path: string): Violation[] {
  if (effect.kind !== 'animateLandWhileSourceOnBattlefield' || ability.condition === 'selfEnters') return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      `animateLandWhileSourceOnBattlefield retains the source incarnation from a selfEnters trigger; "${ability.condition}" does not establish that lifetime`,
    ),
  ];
}

/** Keyrune source animation reads an activated ability's exact source incarnation. */
function checkSourceAnimationInTrigger(effect: Effect, path: string): Violation[] {
  if (effect.kind !== 'animateSourceUntilEndOfTurn') return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      'animateSourceUntilEndOfTurn is legal only inside a subtype-free artifact battlefield activation',
    ),
  ];
}

/** An activation is outside the one source-bound animation envelope banked now. */
function checkLandAnimationInActivation(effect: Effect, path: string): Violation[] {
  if (effect.kind !== 'animateLandWhileSourceOnBattlefield') return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      'animateLandWhileSourceOnBattlefield is currently legal only inside a selfEnters triggered ability',
    ),
  ];
}

/** The Keyrune animation is narrowly source-attested on subtype-free artifacts. */
function checkSourceAnimationInActivation(
  card: Card,
  ability: ActivatedAbility,
  effect: Effect,
  source: AbilitySourceContext,
  path: string,
): Violation[] {
  if (effect.kind !== 'animateSourceUntilEndOfTurn') return [];
  if (
    source.kind === 'artifact' &&
    card.kind === 'artifact' &&
    card.subtypes.length === 0 &&
    ability.activationZone === undefined
  ) {
    return [];
  }
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      'animateSourceUntilEndOfTurn is legal only on a subtype-free artifact activated from the battlefield',
    ),
  ];
}

function checkTriggeredAbility(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  const found: Violation[] = [
    ...checkOptionalTrigger(ability, path),
    ...checkPaidOptionalTrigger(ability, path),
    ...checkCounterTrigger(ability, path),
    ...checkSacrificeSelfUnlessControllerPays(source, ability, path),
    ...checkSacrificeEnchantedPermanentUnlessControllerPaysManaValue(source, ability, path),
    ...checkReturnAnotherCreatureOrSacrificeSelf(source, ability, path),
    ...checkControlledSubtypeAttackTrigger(ability, path),
    ...checkSpellColors(source, ability, path),
    ...checkEnchantedCreatureTrigger(source, ability, path),
    ...checkEnchantedLandTapTrigger(source, ability, path),
    ...checkConjuredCurrencyAbility(ability, path),
    ...checkControlledCreatureCombatDamageCounters(ability, path),
    ...checkUpkeepPlayerRefinement(ability, path),
    ...checkTriggerTargetChooser(source, ability, path),
    ...checkOpponentCreatureDiesReturn(ability, path),
    ...(ability.interveningIf === undefined
      ? []
      : checkCondition(ability.interveningIf, `${path}.interveningIf`)),
  ];
  const demonBundle = ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true;
  const demonEffects =
    canonicalJson(ability.effects) ===
    canonicalJson([
      {
        kind: 'sacrificePermanent',
        filter: { cardTypes: ['creature'] },
        target: { kind: 'triggeringPlayer' },
      },
      { kind: 'tapPermanent', target: { kind: 'selfPermanent' } },
      {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: 1,
        target: { kind: 'selfCreature' },
      },
    ]);
  if (
    demonBundle
      ? source.kind !== 'creature' ||
        ability.condition !== 'beginningOfEndStep' ||
        ability.optional !== true ||
        ability.printedSourceReference !== 'thisCreature' ||
        !demonEffects
      : demonEffects
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'the each-combat opponent sacrifice, conditional tap, and +1/+1 counter are one closed creature-only capability bundle',
      ),
    );
  }
  if (ability.includesNoncombatDamage === true && ability.condition !== 'selfDealsCombatDamageToPlayer') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.includesNoncombatDamage`,
        'includesNoncombatDamage refines only a selfDealsCombatDamageToPlayer trigger',
      ),
    );
  }
  if (
    ability.printedSourceReference !== undefined &&
    ability.printedSourceReference !== 'cardNameBeforeComma'
  ) {
    const printedKind =
      ability.printedSourceReference === 'thisCreature'
        ? 'creature'
        : ability.printedSourceReference === 'thisArtifact'
          ? 'artifact'
          : ability.printedSourceReference === 'thisAura'
            ? 'Aura'
            : 'enchantment';
    const sourceMatches =
      ability.printedSourceReference === 'thisAura' ? source.creatureAura : source.kind === printedKind;
    if (!sourceMatches) {
      const requiredSource =
        ability.printedSourceReference === 'thisAura' ? 'an Aura card' : `a ${printedKind} card`;
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.printedSourceReference`,
          `the printed "this ${printedKind}" source reference is legal only on ${requiredSource}`,
        ),
      );
    } else if (
      ability.spellSharesChosenColors !== true &&
      !TRIGGER_PRINT_TEMPLATES[ability.condition].includes('{name}') &&
      !ability.effects.some(
        (effect) =>
          effect.kind === 'dealDamage' || ('target' in effect && effect.target?.kind === 'selfPermanent'),
      )
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.printedSourceReference`,
          `the ${ability.condition} trigger has no condition or damage-source slot for its printed source reference`,
        ),
      );
    }
  }
  const usesChosenPlayer = (effect: Effect): boolean =>
    (hasTarget(effect) && effect.target.kind === 'chosenPlayer') ||
    (effect.kind === 'flipCoin' &&
      [...(effect.winEffects ?? []), ...(effect.loseEffects ?? [])].some(usesChosenPlayer));
  if (
    ability.condition === 'selfIsDealtDamage' &&
    ability.effects.some(usesChosenPlayer) &&
    !source.choosesPlayerOnEntry
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.condition`,
        'selfIsDealtDamage with chosenPlayer requires the source to choose a player as it enters',
      ),
    );
  }
  if (ability.condition === 'controlledLandSubtypeEnters') {
    if (ability.landSubtype === undefined) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.landSubtype`,
          'controlledLandSubtypeEnters requires the basic land subtype its event must match',
        ),
      );
    }
  } else if (ability.landSubtype !== undefined) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.landSubtype`,
        'landSubtype is legal only on controlledLandSubtypeEnters',
      ),
    );
  }
  if (ability.triggerZone !== undefined && ability.condition !== 'controlledLandSubtypeEnters') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.triggerZone`,
        'the authored graveyard trigger zone is currently implemented for controlledLandSubtypeEnters',
      ),
    );
  }
  const exactExalted = isExaltedAbility(ability);
  const sourcePowerOtherCreaturesPump =
    source.kind === 'creature' &&
    ability.condition === 'selfAttacks' &&
    ability.effects.length === 1 &&
    ability.effects[0]?.kind === 'pumpUntilEndOfTurn' &&
    !isLiteralAmount(ability.effects[0].power) &&
    ability.effects[0].power.kind === 'triggeringCreaturePower' &&
    !isLiteralAmount(ability.effects[0].toughness) &&
    ability.effects[0].toughness.kind === 'triggeringCreaturePower' &&
    ability.effects[0].scope === 'permanentsYouControl' &&
    canonicalJson(ability.effects[0].scopeFilter) === '{"cardTypes":["creature"]}' &&
    ability.effects[0].excludeReferent === true &&
    ability.effects[0].target.kind === 'noTarget';
  // Several trigger conditions can retain a creature from their own event, and
  // they retain it for the same reason: the ability names a body nobody chose.
  // Which ones is `TRIGGERING_CREATURE_CONDITIONS`, in the vocabulary, because the kernel's
  // `TriggerContext` and the replay log schema have to agree with this function
  // about it and two of the three copies drifted apart the last time it was
  // written out three times. What is decided here is the narrower referent
  // clause: an attacks-alone event is reusable by abilities such as Angelic
  // Benediction's optional tap trigger, but only canonical exalted may refer
  // to the lone attacker as `triggeringCreature`. The other conditions
  // retain their creature for every ability that prints them.
  const retainsTriggeringCreature = TRIGGERING_CREATURE_CONDITIONS.some(
    (condition) =>
      condition === ability.condition &&
      (condition !== 'controlledCreatureAttacksAlone' || exactExalted) &&
      (condition !== 'selfAttacks' || sourcePowerOtherCreaturesPump),
  );
  const retainsTriggeringPlayer =
    ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true ||
    (TRIGGERING_PLAYER_CONDITIONS.includes(
      ability.condition as (typeof TRIGGERING_PLAYER_CONDITIONS)[number],
    ) &&
      (ability.condition !== 'youCastSpell' || ability.castFromGraveyardByAnyPlayer === true));
  const checkTriggeredEffect = (effect: Effect, at: string): void => {
    if (effect.kind === 'createTokenCopyOfSelf') {
      found.push(
        violation(
          'EFFECT_ILLEGAL_ON_CARD_TYPE',
          at,
          'createTokenCopyOfSelf is legal only in the closed Pack Rat activated-ability bundle',
        ),
      );
    }
    if (
      effect.kind === 'drawCards' &&
      effect.target.kind === 'triggeringPlayer' &&
      ability.enchantedControllerDrawStepAdditionalDraw !== true
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${at}.target.kind`,
          'drawCards may retain the triggering player only through the enchanted-controller draw-step bundle',
        ),
      );
    }
    if (
      effect.kind === 'loseLife' &&
      effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp' &&
      (ability.condition !== 'beginningOfEachPlayersUpkeep' ||
        effect.target.kind !== 'triggeringPlayer' ||
        effect.players !== undefined)
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${at}.amountFrom`,
          'triggeringPlayerLifeHalfRoundedUp is legal only on the retained player in an unscoped beginningOfEachPlayersUpkeep trigger',
        ),
      );
    }
    if (
      effect.kind === 'chooseBlockersThisCombat' &&
      (source.kind !== 'creature' || ability.condition !== 'selfAndThreeOthersAttack')
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          'chooseBlockersThisCombat is legal only inside a creature selfAndThreeOthersAttack trigger',
        ),
      );
    }
    if (effect.kind === 'returnSourceFromGraveyard' && ability.triggerZone !== 'graveyard') {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          'returnSourceFromGraveyard on a trigger requires triggerZone "graveyard" to supply the exact source card',
        ),
      );
    }
    if (
      effect.kind === 'returnDepartedSourceToOwnerHand' &&
      ability.condition !== 'selfPutIntoGraveyardFromBattlefield'
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          'returnDepartedSourceToOwnerHand requires selfPutIntoGraveyardFromBattlefield to retain the exact graveyard incarnation',
        ),
      );
    }
    if (effect.kind === 'putDepartedSourceOnTopOfOwnerLibrary' && ability.condition !== 'selfDies') {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          'putDepartedSourceOnTopOfOwnerLibrary requires selfDies to retain the exact graveyard incarnation',
        ),
      );
    }
    if (
      effect.kind === 'shuffleSourceIntoOwnerLibrary' &&
      ability.condition !== 'selfPutIntoGraveyardFromAnywhere'
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          'shuffleSourceIntoOwnerLibrary requires selfPutIntoGraveyardFromAnywhere to retain the exact graveyard incarnation',
        ),
      );
    }
    if (effect.kind === 'preventNextDamageToYouAndRetaliate' && effect.target.kind !== 'noTarget') {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          'preventNextDamageToYouAndRetaliate reads X from its own activation cost and is legal only inside an activated ability',
        ),
      );
    }
    found.push(
      ...checkEffectParams(effect, at, source.colors, isSourceExcludedAttackTarget(ability, effect)),
    );
    found.push(
      ...checkAbilityEffectTarget(effect, at, {
        triggeringCreature: retainsTriggeringCreature,
        triggeringPlayer: retainsTriggeringPlayer,
        chosenPlayer: ability.condition === 'selfIsDealtDamage',
        sourceAttacking: ability.condition === 'selfAttacks',
        multipleTargets: true,
        selfPermanentTap: demonBundle,
      }),
    );
    found.push(
      ...checkEffectScope(effect, at, sourcePowerOtherCreaturesPump && effect === ability.effects[0]),
    );
    found.push(...checkPlayerSweep(effect, at));
    found.push(...checkChosenXInAbility(effect, at, false));
    found.push(...checkSpellOnlyEffectInAbility(effect, at));
    found.push(...checkSourceLinkedExileInTrigger(ability, effect, at));
    found.push(...checkLandAnimationInTrigger(ability, effect, at));
    found.push(...checkSourceAnimationInTrigger(effect, at));
    found.push(...checkSourceBodyEffectInTrigger(source, ability, effect, at));
    found.push(...checkSourceReferentTarget(source, effect, at));
    found.push(...checkAttachmentCreatureTarget(source, effect, at));
    if (effect.kind === 'flipCoin') {
      for (const branch of ['winEffects', 'loseEffects'] as const) {
        const nestedEffects = effect[branch] ?? [];
        const branchPath = `${at}.${branch}`;
        for (const [index, nested] of nestedEffects.entries()) {
          checkTriggeredEffect(nested, `${branchPath}[${String(index)}]`);
        }
        found.push(
          ...checkAbilityEffectList(
            nestedEffects,
            branchPath,
            retainsTriggeringCreature,
            ability.condition === 'selfIsDealtDamage'
              ? 'dealtDamage'
              : ability.condition === 'selfDealsCombatDamageToPlayer'
                ? 'combatDamageMill'
                : ability.condition === 'controlledCreatureDealsCombatDamageToPlayer'
                  ? 'combatDamageCounters'
                  : 'none',
          ),
        );
      }
    }
  };
  for (const [index, effect] of ability.effects.entries()) {
    checkTriggeredEffect(effect, `${path}.effects[${String(index)}]`);
  }
  // The list-level half of the referent kinds, called here for the reason
  // `checkEffectList` calls it over a spell's list: whether "that creature" has
  // a referent is a fact about the effects around it, and an ability's list is
  // as much a list as a spell's. `mtg-nhyv.75`.
  found.push(
    ...checkAbilityEffectList(
      ability.effects,
      `${path}.effects`,
      retainsTriggeringCreature,
      ability.condition === 'selfIsDealtDamage'
        ? 'dealtDamage'
        : ability.condition === 'selfDealsCombatDamageToPlayer'
          ? 'combatDamageMill'
          : ability.condition === 'controlledCreatureDealsCombatDamageToPlayer'
            ? 'combatDamageCounters'
            : 'none',
      ability.spellSharesChosenColors === true,
    ),
  );
  const usesTriggeringCreature = ability.effects.some(
    (effect) => hasTarget(effect) && effect.target.kind === 'triggeringCreature',
  );
  if (usesTriggeringCreature && !retainsTriggeringCreature) {
    found.push(
      violation(
        'ILLEGAL_TARGET_IN_ABILITY',
        path,
        'triggeringCreature is retained only by exact exalted or by a selfDealsCombatDamageToCreature, selfBlocksCreature, or selfBlocksOrIsBlockedByGreaterPower trigger',
      ),
    );
  }
  return found;
}

/** Keeps the opposing death filter and all linked future work inseparable. */
function checkOpponentCreatureDiesReturn(ability: TriggeredAbility, path: string): Violation[] {
  if (ability.opponentCreatureDiesReturnAtNextEndStep === undefined) return [];
  const exactKeys = ['condition', 'effects', 'kind', 'opponentCreatureDiesReturnAtNextEndStep'];
  if (
    ability.condition === 'controlledCreatureDies' &&
    ability.effects.length === 0 &&
    canonicalJson(Object.keys(ability).sort()) === canonicalJson(exactKeys)
  ) {
    return [];
  }
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      'the opponent-creature death filter, exact delayed return, controller, counter, color, and subtype additions are one closed trigger bundle',
    ),
  ];
}

/** Keeps the land-tap condition as Chronic Flooding's one atomic engine bundle. */
function checkEnchantedLandTapTrigger(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  if (ability.condition !== 'enchantedLandBecomesTapped') return [];
  if (source.landAura && isEnchantedLandBecomesTappedMillAbility(ability)) return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      `${path}.condition`,
      'enchantedLandBecomesTapped is legal only as the exact three-card mill bundle on a land Aura',
    ),
  ];
}

/** Keeps the retained creature and damage amount as Necropolis Regent's one atomic bundle. */
function checkControlledCreatureCombatDamageCounters(ability: TriggeredAbility, path: string): Violation[] {
  if (ability.condition !== 'controlledCreatureDealsCombatDamageToPlayer') return [];
  if (isControlledCreatureCombatDamageCountersAbility(ability)) return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      `${path}.condition`,
      'controlledCreatureDealsCombatDamageToPlayer is legal only as the exact retained +1/+1 counter bundle',
    ),
  ];
}

/** Keeps a source-bound exchange out of every trigger envelope but Conjured Currency's. */
function checkConjuredCurrencyAbility(ability: TriggeredAbility, path: string): Violation[] {
  const usesSourceExchange = ability.effects.some(
    (effect) => effect.kind === 'exchangeControl' && effect.exchangeSource === true,
  );
  if (!usesSourceExchange || isConjuredCurrencyAbility(ability)) return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      'a source-bound exchange is legal only as the exact optional upkeep trigger',
    ),
  ];
}

/** Validates an eventless CR 603.8 trigger through the ordinary effect contract. */
function checkStateTriggeredAbility(
  source: AbilitySourceContext,
  ability: StateTriggeredAbility,
  path: string,
): Violation[] {
  const found: Violation[] = [];
  for (const [index, effect] of ability.effects.entries()) {
    const at = `${path}.effects[${index}]`;
    if (effect.kind === 'loseLife' && effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp') {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${at}.amountFrom`,
          'triggeringPlayerLifeHalfRoundedUp requires an event trigger that retains the upkeep player',
        ),
      );
    }
    if (
      effect.kind === 'flipCoin' ||
      effect.kind === 'returnSourceFromGraveyard' ||
      effect.kind === 'returnDepartedSourceToOwnerHand' ||
      effect.kind === 'putDepartedSourceOnTopOfOwnerLibrary' ||
      effect.kind === 'shuffleSourceIntoOwnerLibrary' ||
      (effect.kind === 'preventNextDamageToYouAndRetaliate' && effect.target.kind !== 'noTarget') ||
      effect.kind === 'animateLandWhileSourceOnBattlefield' ||
      effect.kind === 'animateSourceUntilEndOfTurn' ||
      effect.kind === 'moveSourceLinkedExile' ||
      effect.kind === 'chooseBlockersThisCombat' ||
      isTargetedFight(effect) ||
      isSourceBodyEffect(effect.kind)
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          at,
          `${effect.kind} needs activation, event, or retained-source context that a state trigger does not carry`,
        ),
      );
    }
    found.push(...checkEffectParams(effect, at, source.colors));
    found.push(
      ...checkAbilityEffectTarget(effect, at, {
        triggeringCreature: false,
        triggeringPlayer: false,
        sourceAttacking: false,
      }),
    );
    found.push(...checkEffectScope(effect, at));
    found.push(...checkPlayerSweep(effect, at));
    found.push(...checkChosenXInAbility(effect, at, false));
    found.push(...checkSpellOnlyEffectInAbility(effect, at));
    found.push(...checkSourceReferentTarget(source, effect, at));
    found.push(...checkAttachmentCreatureTarget(source, effect, at));
  }
  found.push(...checkAbilityEffectList(ability.effects, `${path}.effects`));
  return found;
}

/** Each-opponent upkeep and its hand check are one retained-player refinement. */
function checkUpkeepPlayerRefinement(ability: TriggeredAbility, path: string): Violation[] {
  const found: Violation[] = [];
  if (ability.triggeringPlayerIsOpponent === true && ability.condition !== 'beginningOfEachPlayersUpkeep') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.triggeringPlayerIsOpponent`,
        'triggeringPlayerIsOpponent refines only beginningOfEachPlayersUpkeep',
      ),
    );
  }
  if (
    ability.triggeringPlayerHandAtMost !== undefined &&
    (ability.condition !== 'beginningOfEachPlayersUpkeep' || ability.triggeringPlayerIsOpponent !== true)
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.triggeringPlayerHandAtMost`,
        'triggeringPlayerHandAtMost requires an opponent-only beginningOfEachPlayersUpkeep trigger',
      ),
    );
  }
  if (ability.triggeringPlayerHandAtMost !== undefined && ability.interveningIf !== undefined) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.triggeringPlayerHandAtMost`,
        'triggeringPlayerHandAtMost is the intervening-if clause and cannot be combined with interveningIf',
      ),
    );
  }
  if (
    ability.triggeringPlayerIsOpponent === true &&
    ability.triggeringPlayerIsEnchantedCreatureController === true
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.triggeringPlayerIsOpponent`,
        'an upkeep trigger cannot select both each opponent and the enchanted creature controller',
      ),
    );
  }
  return found;
}

/** An attachment-relative watch has a referent only on a creature Aura. */
function checkEnchantedCreatureTrigger(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  if (ability.enchantedControllerDrawStepAdditionalDraw === true) {
    const effect = ability.effects[0];
    if (
      ability.condition !== 'beginningOfEachPlayersUpkeep' ||
      ability.triggeringPlayerIsEnchantedCreatureController !== true ||
      ability.effects.length !== 1 ||
      effect?.kind !== 'drawCards' ||
      effect.count !== 1 ||
      effect.target.kind !== 'triggeringPlayer'
    ) {
      return [
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.enchantedControllerDrawStepAdditionalDraw`,
          'the enchanted-controller draw-step bundle requires the attachment-relative each-player trigger and exactly one additional draw for that player',
        ),
      ];
    }
  }
  if (
    ability.triggeringPlayerIsEnchantedCreatureController === true &&
    ability.condition !== 'beginningOfEachPlayersUpkeep'
  ) {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.triggeringPlayerIsEnchantedCreatureController`,
        'triggeringPlayerIsEnchantedCreatureController refines only beginningOfEachPlayersUpkeep',
      ),
    ];
  }
  if (
    ability.condition !== 'enchantedCreatureAttacksOrBlocks' &&
    ability.condition !== 'enchantedCreatureBecomesTarget' &&
    ability.condition !== 'enchantedCreatureDies' &&
    ability.triggeringPlayerIsEnchantedCreatureController !== true
  ) {
    return [];
  }
  if (source.creatureAura) return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      `${path}.condition`,
      `${ability.condition} is legal only on a creature Aura`,
    ),
  ];
}

/** The retained-player chooser is currently the exact Aura-death handoff. */
function checkTriggerTargetChooser(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  const returnEffect = ability.effects[0];
  const exactReturn =
    ability.effects.length === 1 &&
    returnEffect?.kind === 'returnSourceAuraAttached' &&
    returnEffect.target.kind === 'targetCreatureYouDontControl';
  if (
    ability.targetChooser === 'triggeringPlayer' &&
    ability.condition === 'enchantedCreatureDies' &&
    source.creatureAura &&
    exactReturn
  ) {
    return [];
  }
  if (ability.targetChooser === undefined && returnEffect?.kind !== 'returnSourceAuraAttached') return [];
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      path,
      'triggeringPlayer and returnSourceAuraAttached are legal only as one targeted enchantedCreatureDies effect on a creature Aura',
    ),
  ];
}

/** Validates an ability as printed by the enchanted creature rather than by the Aura. */
export function checkGrantedCreatureTriggeredAbility(
  colors: Card['colors'],
  ability: TriggeredAbility,
  path: string,
): Violation[] {
  return checkTriggeredAbility(
    {
      kind: 'creature',
      colors,
      creatureAura: false,
      nonlandPermanentAura: false,
      landAura: false,
      equipment: false,
      choosesPlayerOnEntry: false,
      choosesTwoColorsOnEntry: false,
    },
    ability,
    path,
  );
}

/**
 * Whether Forge would add this effect's result to the same source-level exile
 * relation that backs `moveSourceLinkedExile`.
 *
 * The kernel can retain a narrower relation, but the portable DSL contract is
 * the intersection of its exact backends. Forge's `ExiledWith` collection is
 * per source incarnation rather than per ability, so any second exile made by
 * this permanent would be indistinguishable from the searched card there.
 */
function competesWithSourceLinkedExile(effect: Effect): boolean {
  if (effect.kind === 'exileTarget') return effect.linkToSource !== true;
  if (effect.kind === 'exileGraveyard') return true;
  return effect.kind === 'chooseFromGraveyard' && effect.destination === 'exile';
}

/** The singular source-linked vocabulary names exactly one writer and one departure reader. */
function checkSourceLinkedExilePair(card: Card): Violation[] {
  const writers: string[] = [];
  const readers: string[] = [];
  const competingExiles: string[] = [];
  for (const [abilityIndex, ability] of card.abilities.entries()) {
    if (!hasAbilityEffects(ability)) continue;
    for (const [effectIndex, effect] of ability.effects.entries()) {
      const path = `abilities[${String(abilityIndex)}].effects[${String(effectIndex)}]`;
      if (isSourceLinkedExileWriter(effect)) writers.push(path);
      if (effect.kind === 'moveSourceLinkedExile') readers.push(path);
      if (competesWithSourceLinkedExile(effect)) competingExiles.push(path);
    }
  }
  return [
    ...(writers.length === 0
      ? readers.map((path) =>
          violation(
            'SOURCE_LINKED_EXILE_INVALID',
            path,
            'moveSourceLinkedExile has no source-linked writer on this permanent to supply the exiled card',
          ),
        )
      : []),
    ...(readers.length === 0
      ? writers.map((path) =>
          violation(
            'SOURCE_LINKED_EXILE_INVALID',
            path,
            'a source-linked writer has no later reader on this permanent; use an ordinary exile or add the matching source-departure return',
          ),
        )
      : []),
    ...writers
      .slice(1)
      .map((path) =>
        violation(
          'SOURCE_LINKED_EXILE_INVALID',
          path,
          'the current linked return says "the exiled card" and cannot distinguish multiple source-linked writers; print exactly one writer until named or plural links exist',
        ),
      ),
    ...readers
      .slice(1)
      .map((path) =>
        violation(
          'SOURCE_LINKED_EXILE_INVALID',
          path,
          'the current source-linked relation has one source-departure return; print exactly one reader until named or plural links exist',
        ),
      ),
    ...(writers.length === 0
      ? []
      : competingExiles.map((path) =>
          violation(
            'SOURCE_LINKED_EXILE_INVALID',
            path,
            'the current source-linked relation is source-wide in Forge and cannot distinguish another card this permanent exiles; remove the competing exile operation or add a named relation before combining them',
          ),
        )),
  ];
}

/** Keep the target cohort and plural reader one source-attested card bundle. */
function checkSameNameCohortBundle(card: Card): Violation[] {
  const carriesBundle = card.abilities.some(
    (ability) =>
      hasAbilityEffects(ability) &&
      ability.effects.some(
        (effect) =>
          (effect.kind === 'exileTarget' && effect.sameNameCohort !== undefined) ||
          (effect.kind === 'moveSourceLinkedExile' &&
            effect.destination === 'battlefieldUnderOwner' &&
            effect.plural === true),
      ),
  );
  if (!carriesBundle) return [];
  const expected = [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisEnchantment',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
          linkToSource: true,
          sameNameCohort: { excludedName: card.name },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner', plural: true }],
    },
  ];
  return canonicalJson(card.abilities) === canonicalJson(expected)
    ? []
    : [
        violation(
          'SOURCE_LINKED_EXILE_INVALID',
          'abilities',
          'the same-name cohort is one optional self-enters linked exile paired with one plural self-leaves owner-controlled return, and the forbidden name is the source card name',
        ),
      ];
}

/** Keep Angel of Serenity's mixed-zone writer and departure reader atomic. */
function checkAngelOfSerenityBundle(card: Card): Violation[] {
  const carriesBundle = card.abilities.some(
    (ability) =>
      hasAbilityEffects(ability) &&
      ability.effects.some(
        (effect) =>
          (effect.kind === 'exileTarget' && effect.creatureBattlefieldOrGraveyard === true) ||
          (effect.kind === 'moveSourceLinkedExile' &&
            effect.destination === 'hand' &&
            effect.plural === true),
      ),
  );
  if (!carriesBundle) return [];
  const expected = [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisCreature',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetPermanent',
            filter: { cardTypes: ['creature'] },
            excludeSource: true,
            count: 3,
          },
          linkToSource: true,
          creatureBattlefieldOrGraveyard: true,
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'hand', plural: true }],
    },
  ];
  return canonicalJson(card.abilities) === canonicalJson(expected)
    ? []
    : [
        violation(
          'SOURCE_LINKED_EXILE_INVALID',
          'abilities',
          'the mixed-zone creature exile is one optional up-to-three self-enters writer paired with one plural self-leaves owner-hand return',
        ),
      ];
}

/** Keep Search the City's writer, play filter, return, sacrifice, and turn grant atomic. */
function checkSearchTheCityBundle(card: Card): Violation[] {
  const carriesBundle = card.abilities.some(
    (ability) => ability.kind === 'triggered' && ability.searchTheCityProfile !== undefined,
  );
  if (!carriesBundle) return [];
  const expected = [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [],
      searchTheCityProfile: 'exileTopFive',
    },
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      optional: true,
      effects: [],
      searchTheCityProfile: 'matchingNameCompletion',
    },
  ];
  const exact = card.kind === 'enchantment' && canonicalJson(card.abilities) === canonicalJson(expected);
  return exact
    ? []
    : [
        violation(
          'SOURCE_LINKED_EXILE_INVALID',
          'abilities',
          'the linked top-five exile, matching card play, optional same-name return, empty-link sacrifice, and extra turn are one closed enchantment bundle in printed order',
        ),
      ];
}

/** Keep Guild Feud's target, two ordered picks, destinations, and fight atomic. */
function checkGuildFeudBundle(card: Card): Violation[] {
  const carriesBundle = card.abilities.some(
    (ability) => ability.kind === 'triggered' && ability.guildFeudContest === true,
  );
  if (!carriesBundle) return [];
  const expected = [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [],
      guildFeudContest: true,
    },
  ];
  return card.kind === 'enchantment' && canonicalJson(card.abilities) === canonicalJson(expected)
    ? []
    : [
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          'abilities',
          'the targeted opponent reveal, optional creature entry, controller repeat, graveyard remainders, and conditional fight are one closed enchantment upkeep bundle',
        ),
      ];
}

/** Keep the two halves of a source counter race coupled and parameter-consistent. */
function checkSourceCounterRaceBundle(card: Card): Violation[] {
  const placements = card.abilities.filter(isPutCounterThenWinAtThresholdAbility);
  const removals = card.abilities.filter(isControllerDamageRemovesSourceCounterAbility);
  if (placements.length === 0 && removals.length === 0) return [];
  const placement = placements[0];
  const removal = removals[0];
  if (
    placements.length === 1 &&
    removals.length === 1 &&
    placement?.putCounterThenWinAtThreshold.counter === removal?.controllerDamageRemovesSourceCounter.counter
  ) {
    return [];
  }
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      'abilities',
      'a source counter race requires exactly one upkeep placement-and-win trigger paired with exactly one controller-damage removal trigger over the same counter kind',
    ),
  ];
}

/**
 * What an activation may cost, and what it may never cost.
 *
 * Two rules, and the first is the one that matters. An ability that costs
 * nothing is free and *repeatable*: the kernel would enumerate it again the
 * instant it resolved, for as long as the permanent is on the battlefield, so a
 * two-damage ping ends the game on the turn it lands and the decision budget
 * runs out before it does.
 *
 * Repeatability, not price, is what the rule refuses — which is why a sacrifice
 * satisfies it with no mana and no tap symbol at all. Paying it puts the source
 * in its owner's graveyard, and `activationBlocker` (`packages/kernel/src/legal.ts`)
 * will not offer or accept an activation whose source is not on the
 * battlefield, so `Sacrifice CARDNAME: You gain 2 life.` can be activated
 * exactly once. Reading the rule as "mana or a tap symbol" refuses that card,
 * and it refuses the flagship set's Fuse with it.
 *
 * A remove-counter cost now counts as bounded for the same reason discard does:
 * its source eventually runs out. Pay-life remains outside DSL v1, so there is
 * no absent cost field for this guard to mistake for a bound.
 *
 * `cost.discard` is not one of those any more and counts as something, for the
 * reason `sacrificeOther` does one paragraph down: a hand runs out. An ability
 * priced only in cards stops being activatable after seven repetitions at the
 * very most, which is a bound the position enforces rather than a bound the
 * card states, and that is exactly what this rule asks for.
 *
 * The second rule is arithmetic the schema cannot state: `ManaCostSchema` is
 * six integers, and integers go negative.
 *
 * A `sacrificeOther` clause satisfies the first rule the way a `sacrificeSelf`
 * does, and for a stronger reason: it consumes permanents that are not the
 * source, so an ability priced only in Keys runs out when the Keys do. What it
 * has that no other cost field has is a *name*, so it gets a rule of its own.
 */
function checkSacrificeOther(sacrifice: ActivatedAbility['cost']['sacrificeOther'], at: string): Violation[] {
  if (sacrifice === undefined) return [];
  const found: Violation[] = [
    ...checkRange(sacrifice.count, SACRIFICE_COUNT, `${at}.count`, 'sacrifice count', 'ABILITY_COST_INVALID'),
  ];
  if (!SUBTYPE_PATTERN.test(sacrifice.subtype)) {
    found.push(
      violation(
        'INVALID_SUBTYPE',
        `${at}.subtype`,
        `subtype "${sacrifice.subtype}" must be a capitalized word such as "Key"`,
      ),
    );
  }
  return found;
}

/** A bounded, nonempty battlefield-filtered sacrifice payment. */
function checkSacrificeMatching(
  sacrifice: ActivatedAbility['cost']['sacrificeMatching'],
  at: string,
): Violation[] {
  if (sacrifice === undefined) return [];
  return [
    ...checkRange(sacrifice.count, SACRIFICE_COUNT, `${at}.count`, 'sacrifice count', 'ABILITY_COST_INVALID'),
    ...checkPermanentFilterLists(sacrifice.filter, `${at}.filter`),
  ];
}

/** A bounded, nonempty battlefield-filtered tap payment. */
function checkTapMatching(tap: ActivatedAbility['cost']['tapMatching'], at: string): Violation[] {
  if (tap === undefined) return [];
  return [
    ...checkRange(tap.count, TAP_MATCHING_COUNT, `${at}.count`, 'tap count', 'ABILITY_COST_INVALID'),
    ...checkPermanentFilterLists(tap.filter, `${at}.filter`),
  ];
}

/**
 * How many permanents one cost may eat.
 *
 * Not an entry in `LIMITS`, which is the table of *effect* parameters shared
 * between a spell and a static ability; nothing in it is a cost. The ceiling is
 * the boss chest of decision 14's three tiers, and a cost that wants more than
 * four is a design conversation rather than a wider constant.
 */
const SACRIFICE_COUNT = { min: 1, max: 4 } as const;
/** A board-sized cohort, bounded by the kernel's ordinary permanent ceiling. */
const TAP_MATCHING_COUNT = { min: 1, max: 20 } as const;

/**
 * How many cards one cost may pitch.
 *
 * Not `MAX_DISCARD_COUNT` (`effects.ts`), which bounds the *effect*. The two
 * numbers answer different questions and happen to be near each other: an
 * effect's ceiling is what a card may print at an opponent, and this is what a
 * player may be asked to pay out of their own hand at instant speed, over and
 * over, in a format where a hand is seven cards. Two is where every printed
 * discard cost in the M11/M13 identities sits, and a third card is a design
 * conversation rather than a wider constant — the same sentence `SACRIFICE_COUNT`
 * makes about its own ceiling.
 */
const DISCARD_COST_COUNT = { min: 1, max: 2 } as const;
const REMOVE_COUNTER_COST_COUNT = { min: 1, max: 20 } as const;

/**
 * What an activation cost may be — and, since `mtg-nhyv.17`, the one thing an
 * `{X}` in it may not be printed without.
 *
 * ## `{X}` in an activation cost is charged, and something has to read it
 *
 * `ActivationCostSchema` embeds `ManaCostSchema` whole, and `hasX` is a
 * `.default(false)`-backed field on it, so `{X}, {T}: …` has always parsed.
 * Until `mtg-nhyv.17` it was also always free: `activationBlocker` asked
 * `canPay`, `canPay` and `payFromPool` read `generic` and the five colored pips
 * and nothing else, and the reducer paid through the identical record, so the
 * `{X}` `activationCostText` printed on the face was a symbol nobody was
 * charged for. Nothing could read it back either. `mtg-u6pm` refused the whole
 * cost on that evidence, and said in this docblock that the day the engine
 * learned to charge it, the refusal was the thing to delete.
 *
 * Silklash Spider — `{X}{G}{G}: This creature deals X damage to each creature
 * with flying` — is the card that asked, and the three halves moved in one
 * commit, because any two of them alone is still a face that lies. The kernel
 * enumerates an activation's X and charges the resolved cost; `pushAbility`
 * banks the announced value on the `StackEntry` field a cast spell has always
 * used; and `chosenX` became readable inside an activated ability. CR 602.2b is
 * the reason it is that field and not a second one: an activation runs the same
 * CR 601.2 steps a cast does, announcement (CR 601.2b) included.
 *
 * What is left here is the *pairing*, and it runs in both directions:
 *
 * - an effect reading `chosenX` under a cost with no `{X}` names a number
 *   nobody announced. `checkChosenXInAbility` refuses that, on the argument
 *   `checkChosenXOnSpell` makes one card type out.
 * - an `{X}` no effect reads is refused below. That direction is *allowed* on a
 *   spell, and the difference is enumeration rather than taste. A spell is
 *   announced once, from the hand, on the turn it is cast. An activation is
 *   offered at every priority window of both seats for as long as the permanent
 *   is on the battlefield, so an X nobody reads multiplies each of those windows
 *   by the whole payable range and changes nothing about the game. A player
 *   asked to choose a number that cannot matter is answering a question the card
 *   invented, and both bots would answer it too.
 *
 * `ABILITY_COST_INVALID` for that second half rather than a new code, because it
 * is the same claim as every other row here: this cost is not a cost this engine
 * charges.
 *
 * The model tier did not move and that is deliberate.
 * `ModelActivationCostSchema` and `MechanicModelActivationCostSchema` both still
 * omit `hasX` (`ability-shape.ts`) and `abilityFromModel` fills `false` at the
 * crossing, so this stays a cost a designer reaches by hand and the generator
 * cannot print — the containment invariant strict rather than equal, exactly
 * where `sacrificeOther` and `putCounters` already hold it.
 */
function checkActivationCost(ability: ActivatedAbility, path: string): Violation[] {
  const cost = ability.cost;
  const at = `${path}.cost`;
  const named = [
    ...checkSacrificeOther(cost.sacrificeOther, `${at}.sacrificeOther`),
    ...checkSacrificeMatching(cost.sacrificeMatching, `${at}.sacrificeMatching`),
    ...checkTapMatching(cost.tapMatching, `${at}.tapMatching`),
    ...(cost.discard === undefined
      ? []
      : checkRange(
          cost.discard,
          DISCARD_COST_COUNT,
          `${at}.discard`,
          'discard count',
          'ABILITY_COST_INVALID',
        )),
    ...(cost.discardFilter === undefined
      ? []
      : cost.discard === undefined
        ? [
            violation(
              'ABILITY_COST_INVALID',
              `${at}.discardFilter`,
              'a discard filter has no payment to constrain; add a discard count or remove the filter',
            ),
          ]
        : checkCardFilterLists(cost.discardFilter, `${at}.discardFilter`)),
    ...(cost.removeCounter === undefined
      ? []
      : checkRange(
          cost.removeCounter.count,
          REMOVE_COUNTER_COST_COUNT,
          `${at}.removeCounter.count`,
          'removed counter count',
          'ABILITY_COST_INVALID',
        )),
  ];
  if (
    cost.discardMatching !== undefined &&
    (cost.discard !== undefined || cost.discardFilter !== undefined)
  ) {
    named.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.discardMatching`,
        'a relational discard bundle cannot be combined with the independent discard count or filter',
      ),
    );
  }
  if (cost.sacrificeMatching !== undefined && (cost.sacrificeSelf || cost.sacrificeOther !== undefined)) {
    named.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.sacrificeMatching`,
        'a filtered sacrifice includes the source when it matches and cannot be combined with either older sacrifice spelling; use one unambiguous payment predicate',
      ),
    );
  }
  if (
    cost.sacrificeLandSubtypePair !== undefined &&
    (cost.sacrificeSelf || cost.sacrificeOther !== undefined || cost.sacrificeMatching !== undefined)
  ) {
    named.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.sacrificeLandSubtypePair`,
        'the land-subtype pair is one complete sacrifice predicate and cannot be combined with another sacrifice cost',
      ),
    );
  }
  if (cost.sacrificeSelf && cost.exileSelf) {
    named.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.exileSelf`,
        'one source permanent cannot be both sacrificed and exiled to pay the same activation; choose the printed source-leaving cost',
      ),
    );
  }
  const found: Violation[] = [];
  const negative = COLORS.filter((color) => cost.mana[color] < 0);
  if (cost.mana.generic < 0) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.mana.generic`,
        `generic mana must be >= 0, got ${cost.mana.generic}`,
      ),
    );
  }
  for (const color of negative) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.mana.${color}`,
        `${color} pips must be >= 0, got ${cost.mana[color]}`,
      ),
    );
  }
  if (cost.printedManaPips !== undefined) {
    const canonicalGroups: readonly (readonly [string, number])[] = [
      ...COLORS.map((color) => [color, cost.mana[color]] as const),
      ...hybridPips(cost.mana),
    ];
    const actual = [...cost.printedManaPips];
    const expectedCount = canonicalGroups.reduce((sum, [, count]) => sum + count, 0);
    const actualCounts = new Map<string, number>();
    for (const pip of actual) actualCounts.set(pip, (actualCounts.get(pip) ?? 0) + 1);
    const sameMultiset =
      negative.length === 0 &&
      expectedCount === actual.length &&
      canonicalGroups.every(([pip, count]) => (actualCounts.get(pip) ?? 0) === count);
    if (!sameMultiset) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          `${at}.printedManaPips`,
          'printed mana pips must be an exact permutation of the activation mana cost fixed pips',
        ),
      );
    } else {
      let index = 0;
      const canonicalOrder = canonicalGroups.every(([pip, count]) => {
        for (let seen = 0; seen < count; seen += 1) {
          if (actual[index] !== pip) return false;
          index += 1;
        }
        return true;
      });
      if (canonicalOrder) {
        found.push(
          violation(
            'ABILITY_COST_INVALID',
            `${at}.printedManaPips`,
            'canonical WUBRG pip order is already the default; omit the redundant presentation override',
          ),
        );
      }
    }
  }
  if (found.length > 0) return [...named, ...found];

  const value = manaValue(cost.mana);
  if (
    value === 0 &&
    !cost.mana.hasX &&
    !cost.tapSelf &&
    cost.payLife === undefined &&
    !cost.sacrificeSelf &&
    !cost.exileSelf &&
    cost.exileControlledInstantOrSorcerySpell !== true &&
    cost.sacrificeOther === undefined &&
    cost.sacrificeMatching === undefined &&
    cost.sacrificeLandSubtypePair === undefined &&
    cost.tapMatching === undefined &&
    cost.discard === undefined &&
    cost.discardMatching === undefined &&
    cost.removeCounter === undefined &&
    ability.loyaltyCost === undefined
  ) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        at,
        'an ability that costs no mana, does not tap, and does not move its source can be activated again the moment it resolves; give it a mana cost, a tap symbol, a source-leaving cost, a sacrifice, a discard, or a combination',
      ),
    );
  }
  if (value > MAX_MANA_VALUE) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.mana`,
        `mana value ${value} exceeds the slice ceiling of ${MAX_MANA_VALUE}`,
      ),
    );
  }
  if (cost.mana.hasX && !ability.effects.some((effect) => effectUsesChosenX(effect))) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        `${at}.mana`,
        'an {X} in an activation cost that no effect reads asks for a number at every priority window and spends it on nothing; read it with a chosen-X amount, or state a fixed cost',
      ),
    );
  }
  if (
    ability.loyaltyCost !== undefined &&
    isVariableLoyaltyCost(ability.loyaltyCost) &&
    !ability.effects.some((effect) => effectUsesChosenX(effect))
  ) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        `${path}.loyaltyCost`,
        'a variable loyalty cost must be read by a chosen-X effect on that ability',
      ),
    );
  }
  return [...named, ...found];
}

/**
 * Where one effect printed inside an ability may point.
 *
 * `legalTargetsFor` is the one function that says where each primitive may
 * point, and it is read here rather than re-stated so an ability and a spell
 * cannot disagree about `destroyPermanent`. `counterSpell` is the one primitive with
 * no `TargetSpec` at all: it names a spell on the stack, and the kernel
 * enumerates that from `state.stack`, which is a list every kind of ability can
 * read exactly as a spell being cast can.
 *
 * One function for both kinds of ability, which is the shape the rules have.
 * An activated ability chooses its targets when it is activated (CR 601.2c) and
 * a triggered one chooses them as it is put on the stack (CR 603.3d): the two
 * differ in *when* the choice happens, never in where an effect may point. A
 * trigger used to be refused any target at all, and that was a statement about
 * the reducer rather than about the card — `settle` could not stop for a
 * decision, so no ability put on the stack by the kernel could ask for one. It
 * can now (`packages/kernel/src/trigger-choice.ts`), so the restriction is gone
 * and this table is all that is left.
 */
/**
 * The two target kinds whose legality is a fact about the *ability around the
 * effect* rather than about the effect, and what this ability is allowed to say.
 *
 * Both name something the board alone cannot resolve — a retained referent and
 * a combat role — so `legalTargetsFor` is the wrong table for either: it is
 * keyed by effect kind and knows nothing about the printed trigger. Passing the
 * permissions in keeps that split honest, and defaulting both to `false` means
 * a caller that has not thought about it refuses rather than admits.
 */
interface AbilityTargetPermissions {
  /**
   * Whether this ability retains a creature from its own triggering event: the
   * exact exalted trigger's lone attacker, the creature a
   * `selfDealsCombatDamageToCreature` trigger just damaged, the attacker a
   * `selfBlocksCreature` trigger just blocked, or the larger creature a
   * `selfBlocksOrIsBlockedByGreaterPower` trigger just met in a block.
   */
  readonly triggeringCreature?: boolean;
  /** The triggering event retains the player it names. */
  readonly triggeringPlayer?: boolean;
  /** The source retained its entry-chosen player for this damage trigger. */
  readonly chosenPlayer?: boolean;
  /** The source is attacking, so CR 506.2 supplies a defending player. */
  readonly sourceAttacking?: boolean;
  /** Trigger actions carry the plural-target and damage-allocation side channels. */
  readonly multipleTargets?: boolean;
  /** The atomic each-combat opponent-sacrifice bundle taps its own source. */
  readonly selfPermanentTap?: boolean;
}

function checkAbilityEffectTarget(
  effect: Effect,
  path: string,
  permissions: AbilityTargetPermissions = {},
): Violation[] {
  if (!hasTarget(effect)) return [];
  if (
    effect.kind === 'tapPermanent' &&
    effect.target.kind === 'selfPermanent' &&
    permissions.selfPermanentTap === true
  ) {
    return [];
  }
  if (isMultipleTargetSpec(effect.target) && permissions.multipleTargets !== true) {
    return [
      violation(
        'ILLEGAL_TARGET_IN_ABILITY',
        `${path}.target`,
        'plural target slots require a spell cast or a triggered-ability target choice',
      ),
    ];
  }
  if (effect.target.kind === 'triggeringCreature') {
    if (permissions.triggeringCreature !== true) {
      return [
        violation(
          'ILLEGAL_TARGET_IN_ABILITY',
          `${path}.target.kind`,
          'triggeringCreature is retained only by the exact exalted trigger or by a selfDealsCombatDamageToCreature, selfBlocksCreature, or selfBlocksOrIsBlockedByGreaterPower trigger',
        ),
      ];
    }
    const allowed = legalTargetsFor(effect.kind);
    if (
      allowed.includes('anyTarget') ||
      allowed.includes('targetCreature') ||
      allowed.includes('targetPermanent')
    ) {
      return [];
    }
    return [
      violation(
        'ILLEGAL_TARGET_IN_ABILITY',
        `${path}.target.kind`,
        `${effect.kind} cannot use "triggeringCreature"; legal targeting for it is ${allowed.join(', ') || 'none'}`,
      ),
    ];
  }
  if (effect.target.kind === 'triggeringPlayer') {
    if (permissions.triggeringPlayer !== true) {
      return [
        violation(
          'ILLEGAL_TARGET_IN_ABILITY',
          `${path}.target.kind`,
          `triggeringPlayer is retained only by ${TRIGGERING_PLAYER_CONDITIONS.join(' or ')} triggers`,
        ),
      ];
    }
  }
  if (effect.target.kind === 'chosenPlayer' && permissions.chosenPlayer !== true) {
    return [
      violation(
        'ILLEGAL_TARGET_IN_ABILITY',
        `${path}.target.kind`,
        'chosenPlayer is legal only on a selfIsDealtDamage trigger',
      ),
    ];
  }
  if (isSourceAttackTarget(effect.target.kind)) {
    // CR 506.2 names a defending player only for the duration of a combat, and
    // only relative to an attack. An ability that does not fire on its source
    // attacking has no attack to read the role off, so the printed phrase would
    // have no referent and the kernel would have nothing to enumerate.
    if (permissions.sourceAttacking !== true) {
      return [
        violation(
          'ILLEGAL_TARGET_IN_ABILITY',
          `${path}.target.kind`,
          'targetCreatureDefendingPlayerControls needs either a selfAttacks trigger or an activation restricted to its source attacking; outside that combat there is no defending player',
        ),
      ];
    }
  }
  const allowed = legalTargetsFor(effect.kind);
  if (allowed.includes(effect.target.kind)) return checkTargetCardinality(effect, path);
  return [
    violation(
      'ILLEGAL_TARGET_IN_ABILITY',
      `${path}.target.kind`,
      `${effect.kind} cannot use "${effect.target.kind}"; legal targeting for it is ${allowed.join(', ') || 'none'}`,
    ),
  ];
}

/**
 * Everything CR 702.6b's equip clause requires of the card printing it.
 *
 * Four rules, and each one is a way the printed card and the engine would
 * otherwise say different things.
 *
 * The clause replaces the effect list rather than joining it. An equip ability
 * attaches its source and does nothing else, so an ability carrying both would
 * print an effect sentence the renderer has nowhere to put and the kernel would
 * resolve alongside an attachment CR 702.6b never pairs with one.
 *
 * The card must be an artifact carrying the `Equipment` subtype (CR 301.5).
 * A creature card is refused by the same rule and gets its own sentence,
 * because CR 301.5e is a different rule with the same answer: an Equipment that
 * is also a creature cannot equip a creature, and a creature card printing the
 * clause is that state permanently. The kernel holds the other half, where a
 * layer-4 effect animates a printed artifact.
 *
 * The cost is mana and nothing else. Source-leaving costs are the rule that matters:
 * CR 601.2h pays an activation cost before the ability is put on the stack, so
 * a weapon priced that way is in its owner's graveyard by the time the ability
 * resolves and attaches a permanent that is no longer on the battlefield. The
 * tap symbol and every other payment field go with it for a smaller reason —
 * `Equip {1}, {T}` is not a line Magic prints, and Decision 12's eight weapons
 * want none of it — so the printed line is always `Equip {2}`.
 */
function checkEquipAbility(card: Card, ability: AttachingAbility, path: string): Violation[] {
  const at = `${path}.attach`;
  const found: Violation[] = [...checkModifications(ability.attach.modifications, `${at}.modifications`)];
  // CR 613.4a sets the *source's* own power and toughness; an equip clause
  // modifies the equipped creature, a different permanent than the source
  // (the weapon) that carries the ability. `checkModification` cannot hold
  // this rule — it has no `scope` to check against, the way
  // `checkStaticModification` does for a plain static ability — so it is
  // checked here, once, over the one clause that can never carry a `scope`.
  for (const [index, modification] of ability.attach.modifications.entries()) {
    if (modification.kind !== 'definePt') continue;
    found.push(
      violation(
        'DEFINE_PT_ILLEGAL_ON_SCOPE',
        `${at}.modifications[${index}]`,
        "a characteristic-defining power/toughness (CR 613.4a) sets the source's own stats; an equip clause modifies the equipped creature, a different permanent than the source",
      ),
    );
  }
  if (ability.effects.length > 0) {
    found.push(
      violation(
        'EQUIP_ABILITY_INVALID',
        `${path}.effects`,
        'an equip ability attaches its source and does nothing else; print the other effect as an ability of its own',
      ),
    );
  }
  if (card.kind !== 'artifact') {
    found.push(
      violation(
        'EQUIP_ABILITY_INVALID',
        at,
        `Equipment is an artifact subtype (CR 301.5), and an Equipment that is also a creature cannot equip one (CR 301.5e); ${withArticle(card.kind)} cannot carry an equip ability`,
      ),
    );
  } else if (!card.subtypes.includes(EQUIPMENT_SUBTYPE)) {
    found.push(
      violation(
        'EQUIP_ABILITY_INVALID',
        'subtypes',
        `a card that prints Equip is an ${EQUIPMENT_SUBTYPE} (CR 301.5); add the subtype or drop the clause`,
      ),
    );
  }
  const cost = ability.cost;
  if (
    cost.sacrificeSelf ||
    cost.exileSelf ||
    cost.tapSelf ||
    cost.payLife !== undefined ||
    cost.sacrificeOther !== undefined ||
    cost.sacrificeMatching !== undefined ||
    cost.sacrificeLandSubtypePair !== undefined ||
    cost.discard !== undefined ||
    cost.discardMatching !== undefined ||
    cost.removeCounter !== undefined
  ) {
    found.push(
      violation(
        'EQUIP_ABILITY_INVALID',
        `${path}.cost`,
        'an equip cost is mana in DSL v1; source-leaving and other additional payments happen before the ability reaches the stack, while Equip is represented by one mana-only attachment action',
      ),
    );
  }
  return found;
}

function checkActivatedAbility(
  card: Card,
  ability: ActivatedAbility,
  path: string,
  sourceKind: Card['kind'] = card.kind,
): Violation[] {
  const found: Violation[] = [...checkActivationCost(ability, path)];
  if (
    ability.activateOnlyAsInstantReminder === true &&
    (ability.activateOnlyAsSorcery === true ||
      !ability.effects.some((effect) => effect.kind === 'addMana') ||
      !ability.effects.some((effect) => hasTarget(effect)))
  ) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.activateOnlyAsInstantReminder`,
        'the instant-speed reminder is legal only on a targeted, mana-producing activation that uses the stack',
      ),
    );
  }
  const printedSource = sourceContext(card);
  const source: AbilitySourceContext =
    sourceKind === card.kind
      ? printedSource
      : {
          ...printedSource,
          kind: sourceKind,
          creatureAura: false,
          nonlandPermanentAura: false,
          equipment: false,
        };
  const createsTokenCopyOfSelf = ability.effects.some((effect) => effect.kind === 'createTokenCopyOfSelf');
  if (createsTokenCopyOfSelf) {
    const characteristic = card.characteristicPowerToughness;
    const exactPayload =
      sourceKind === 'creature' &&
      characteristic?.kind === 'controlledSubtype' &&
      'subtypes' in card &&
      card.subtypes.includes(characteristic.subtype) &&
      ability.effects.length === 1 &&
      ability.effects[0]?.kind === 'createTokenCopyOfSelf' &&
      ability.cost.mana.generic === 2 &&
      ability.cost.mana.B === 1 &&
      ability.cost.mana.W === 0 &&
      ability.cost.mana.U === 0 &&
      ability.cost.mana.R === 0 &&
      ability.cost.mana.G === 0 &&
      !ability.cost.mana.hasX &&
      ability.cost.discard === 1 &&
      !ability.cost.tapSelf &&
      ability.cost.payLife === undefined &&
      !ability.cost.sacrificeSelf &&
      !ability.cost.exileSelf &&
      ability.cost.exileControlledInstantOrSorcerySpell !== true &&
      ability.cost.sacrificeOther === undefined &&
      ability.cost.sacrificeMatching === undefined &&
      ability.cost.sacrificeLandSubtypePair === undefined &&
      ability.cost.tapMatching === undefined &&
      ability.cost.discardMatching === undefined &&
      ability.cost.removeCounter === undefined &&
      ability.modes === undefined &&
      ability.attach === undefined &&
      ability.loyaltyCost === undefined &&
      ability.activationZone === undefined &&
      ability.counterTargetSpellUnless === undefined &&
      ability.damageTargetAndCreaturesWithSameName !== true &&
      ability.regenerateSelf !== true &&
      ability.activateOnlyWhileAttacking !== true &&
      ability.activateOnlyAsSorcery !== true &&
      ability.activateOnlyOnceEachTurn !== true;
    if (!exactPayload) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          path,
          'createTokenCopyOfSelf is the closed Pack Rat bundle: a subtype-counted creature pays {2}{B} and discards exactly one card to create one token copy of itself',
        ),
      );
    }
  }
  if (ability.cost.exileControlledInstantOrSorcerySpell === true) {
    const effect = ability.effects[0];
    const exactPayload =
      sourceKind === 'creature' &&
      ability.effects.length === 1 &&
      effect?.kind === 'putCounters' &&
      effect.counter === 'plusOnePlusOne' &&
      effect.count === 2 &&
      effect.target.kind === 'selfCreature' &&
      manaValue(ability.cost.mana) === 0 &&
      !ability.cost.mana.hasX &&
      !ability.cost.tapSelf &&
      ability.cost.payLife === undefined &&
      !ability.cost.sacrificeSelf &&
      !ability.cost.exileSelf &&
      ability.cost.sacrificeOther === undefined &&
      ability.cost.sacrificeMatching === undefined &&
      ability.cost.sacrificeLandSubtypePair === undefined &&
      ability.cost.tapMatching === undefined &&
      ability.cost.discard === undefined &&
      ability.cost.discardMatching === undefined &&
      ability.cost.removeCounter === undefined &&
      ability.modes === undefined &&
      ability.attach === undefined &&
      ability.loyaltyCost === undefined &&
      ability.activationZone === undefined &&
      ability.counterTargetSpellUnless === undefined &&
      ability.damageTargetAndCreaturesWithSameName !== true &&
      ability.regenerateSelf !== true &&
      ability.activateOnlyWhileAttacking !== true &&
      ability.activateOnlyAsSorcery !== true &&
      ability.activateOnlyOnceEachTurn !== true;
    if (!exactPayload) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          `${path}.cost.exileControlledInstantOrSorcerySpell`,
          'this stack-exile payment is the closed Nivmagus bundle: a free creature activation that exiles one controlled instant or sorcery spell and puts exactly two +1/+1 counters on this creature',
        ),
      );
    }
  }
  if (ability.damageTargetAndCreaturesWithSameName === true) {
    if (
      sourceKind !== 'creature' ||
      !isDamageTargetAndCreaturesWithSameNameAbility(ability) ||
      canonicalJson(ability.cost) !==
        '{"mana":{"B":0,"G":0,"R":0,"U":0,"W":0,"generic":0,"hasX":false},"sacrificeSelf":false,"tapSelf":true}' ||
      ability.counterTargetSpellUnless !== undefined ||
      ability.attach !== undefined ||
      ability.loyaltyCost !== undefined ||
      ability.regenerateSelf === true ||
      ability.activationZone !== undefined
    ) {
      found.push(
        violation(
          'DAMAGE_TARGET_AND_SAME_NAME_INVALID',
          path,
          'damageTargetAndCreaturesWithSameName is the whole tap-only creature activation with one 1-damage targetCreature effect',
        ),
      );
    }
  }
  if (ability.retaliateForCombatDamageUntilYourNextTurn === true) {
    const exactPayload =
      sourceKind === 'planeswalker' &&
      isCombatDamageRetaliationAbility(ability) &&
      canonicalJson(ability.cost) ===
        '{"mana":{"B":0,"G":0,"R":0,"U":0,"W":0,"generic":0,"hasX":false},"sacrificeSelf":false,"tapSelf":false}' &&
      ability.attach === undefined &&
      ability.regenerateSelf !== true &&
      ability.activationZone === undefined &&
      ability.counterTargetSpellUnless === undefined &&
      ability.damageTargetAndCreaturesWithSameName !== true &&
      ability.activateOnlyWhileAttacking !== true &&
      ability.activateOnlyAsSorcery !== true &&
      ability.activateOnlyOnceEachTurn !== true;
    if (!exactPayload) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          path,
          'retaliateForCombatDamageUntilYourNextTurn is the closed +1 planeswalker ability with no other cost, effect, or activated-ability bundle',
        ),
      );
    }
  }
  if (ability.jaceArchitectProfile !== undefined) {
    const exactPayload =
      sourceKind === 'planeswalker' &&
      isJaceArchitectAbility(ability) &&
      canonicalJson(ability.cost) ===
        '{"mana":{"B":0,"G":0,"R":0,"U":0,"W":0,"generic":0,"hasX":false},"sacrificeSelf":false,"tapSelf":false}' &&
      ability.attach === undefined &&
      ability.regenerateSelf !== true &&
      ability.activationZone === undefined &&
      ability.counterTargetSpellUnless === undefined &&
      ability.damageTargetAndCreaturesWithSameName !== true &&
      ability.retaliateForCombatDamageUntilYourNextTurn !== true &&
      ability.activateOnlyWhileAttacking !== true &&
      ability.activateOnlyAsSorcery !== true &&
      ability.activateOnlyOnceEachTurn !== true;
    if (!exactPayload) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          path,
          'jaceArchitectProfile is one closed planeswalker loyalty ability with its exact signed cost and no other effect or activation bundle',
        ),
      );
    }
  }
  if (
    ability.printedSourceReference !== undefined &&
    ability.printedSourceReference !== 'thisCard' &&
    ability.printedSourceReference !== 'cardNameBeforeComma' &&
    sourceKind !==
      (ability.printedSourceReference === 'thisCreature'
        ? 'creature'
        : ability.printedSourceReference === 'thisArtifact'
          ? 'artifact'
          : ability.printedSourceReference === 'thisEnchantment'
            ? 'enchantment'
            : 'land')
  ) {
    const printedKind =
      ability.printedSourceReference === 'thisCreature'
        ? 'creature'
        : ability.printedSourceReference === 'thisArtifact'
          ? 'artifact'
          : ability.printedSourceReference === 'thisEnchantment'
            ? 'enchantment'
            : 'land';
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.printedSourceReference`,
        `the printed "this ${printedKind}" source reference is legal only on a ${printedKind} card`,
      ),
    );
  }
  if (isScavengeAbility(ability)) {
    const count = ability.effects[0].count;
    if (
      sourceKind !== 'creature' ||
      card.characteristicPowerToughness !== undefined ||
      count !== card.power
    ) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.effects[0].count`,
          'scavenge requires a fixed-power creature and must put counters equal to that printed power',
        ),
      );
    }
  }
  const effectLists =
    ability.modes === undefined
      ? [{ effects: ability.effects, path: `${path}.effects` }]
      : ability.modes.map((mode, index) => ({
          effects: mode.effects,
          path: `${path}.modes[${String(index)}].effects`,
        }));
  if (ability.modes !== undefined && ability.effects.length > 0) {
    found.push(
      violation(
        'ABILITY_COUNT_INVALID',
        `${path}.modes`,
        'an activated ability prints a fixed effect list or a modal one, not both',
      ),
    );
  }
  if (ability.modes !== undefined && ability.attach !== undefined) {
    found.push(
      violation(
        'EQUIP_ABILITY_INVALID',
        `${path}.modes`,
        'an attaching ability resolves through the equip procedure and cannot also carry modes',
      ),
    );
  }
  if (ability.modes !== undefined && ability.regenerateSelf === true) {
    found.push(
      violation(
        'REGENERATION_ABILITY_INVALID',
        `${path}.modes`,
        'a self-regeneration ability creates only its regeneration shield and cannot also carry modes',
      ),
    );
  }
  if (ability.effects.length > 2 && ability.loyaltyCost === undefined) {
    found.push(
      violation(
        'ABILITY_COUNT_INVALID',
        `${path}.effects`,
        'only a loyalty ability may carry three effects; ordinary activated abilities remain bounded at two',
      ),
    );
  }
  const returnsSource = ability.effects.some((effect) => effect.kind === 'returnSourceFromGraveyard');
  if (ability.activationZone === 'graveyard') {
    const cost = ability.cost;
    if (
      cost.tapSelf ||
      cost.payLife !== undefined ||
      cost.sacrificeSelf ||
      cost.sacrificeOther !== undefined ||
      cost.sacrificeMatching !== undefined ||
      cost.discard !== undefined ||
      cost.discardFilter !== undefined ||
      cost.discardMatching !== undefined ||
      cost.removeCounter !== undefined ||
      ability.loyaltyCost !== undefined ||
      ability.attach !== undefined ||
      ability.regenerateSelf === true ||
      ability.activateOnlyWhileAttacking === true
    ) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          `${path}.cost`,
          'an ability activated from a graveyard has no battlefield source to tap, sacrifice, attach, regenerate, attack with, or remove counters from; supported costs are mana, exiling that source, and the explicit external land-subtype pair',
        ),
      );
    }
    if (!returnsSource && cost.exileSelf !== true) {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.activationZone`,
          'a graveyard activation must return its source or exile that source as a cost',
        ),
      );
    }
  }
  if (ability.loyaltyCost !== undefined) {
    if (sourceKind !== 'planeswalker') {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          `${path}.loyaltyCost`,
          'a loyalty cost is legal only on a planeswalker ability',
        ),
      );
    }
    if (
      manaValue(ability.cost.mana) !== 0 ||
      ability.cost.tapSelf ||
      ability.cost.payLife !== undefined ||
      ability.cost.sacrificeSelf ||
      ability.cost.exileSelf ||
      ability.cost.sacrificeOther !== undefined ||
      ability.cost.sacrificeMatching !== undefined ||
      ability.cost.sacrificeLandSubtypePair !== undefined ||
      ability.cost.discard !== undefined ||
      ability.cost.discardMatching !== undefined ||
      ability.cost.removeCounter !== undefined
    ) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          `${path}.cost`,
          'a loyalty ability pays exactly its signed loyalty cost and no mana, tap, source-leaving, discard, or counter-removal cost',
        ),
      );
    }
    if (
      !isVariableLoyaltyCost(ability.loyaltyCost) &&
      (ability.loyaltyCost < -20 || ability.loyaltyCost > 20)
    ) {
      found.push(
        violation(
          'PLANESWALKER_INVALID',
          `${path}.loyaltyCost`,
          `a loyalty cost must be between -20 and 20, got ${String(ability.loyaltyCost)}`,
        ),
      );
    }
  } else if (sourceKind === 'planeswalker') {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        path,
        'every activated ability on a planeswalker must state a signed loyaltyCost',
      ),
    );
  }
  if (isAttachingAbility(ability)) {
    found.push(...checkEquipAbility(card, ability, path));
  }
  if (isRegenerationAbility(ability)) {
    if (sourceKind !== 'creature') {
      found.push(
        violation(
          'ABILITY_ILLEGAL_ON_CARD_TYPE',
          `${path}.regenerateSelf`,
          'self-regeneration is legal only on a creature permanent',
        ),
      );
    }
    if (
      ability.effects.length > 0 ||
      ability.loyaltyCost !== undefined ||
      ability.attach !== undefined ||
      ability.cost.sacrificeSelf ||
      ability.cost.exileSelf
    ) {
      found.push(
        violation(
          'REGENERATION_ABILITY_INVALID',
          path,
          'a regeneration ability creates only its self-regeneration shield; it cannot also attach, move its source as a cost, carry effects, or be a loyalty ability',
        ),
      );
    }
  } else if (
    !isAttachingAbility(ability) &&
    !isCombatDamageRetaliationAbility(ability) &&
    !isJaceArchitectAbility(ability) &&
    ability.effects.length === 0 &&
    ability.modes === undefined
  ) {
    // The schema stopped counting so an equip ability could print no effect
    // (`ability-shape.ts`), which leaves this the rule that keeps an ability
    // with neither off a card face. `SPELL_WITHOUT_EFFECT` is the same rule one
    // card type out.
    found.push(
      violation(
        'ABILITY_WITHOUT_EFFECT',
        `${path}.effects`,
        'an activated ability that neither attaches its source nor prints an effect costs mana and does nothing; give it an effect',
      ),
    );
  }
  const paidPermanentCount =
    (ability.cost.sacrificeSelf ? 1 : 0) +
    (ability.cost.sacrificeOther?.count ?? 0) +
    (ability.cost.sacrificeMatching?.count ?? 0) +
    (ability.cost.sacrificeLandSubtypePair === undefined ? 0 : 2);
  for (const list of effectLists) {
    for (const [index, effect] of list.effects.entries()) {
      if (!effectUsesPaidDiscardManaValue(effect) || ability.cost.discard === 1) continue;
      found.push(
        violation(
          'ILLEGAL_REFERENT_AMOUNT',
          `${list.path}[${String(index)}]`,
          'a paid-discard-mana-value amount on an activated ability requires a cost that discards exactly one card',
        ),
      );
    }
    if (paidPermanentCount !== 1) {
      for (const [index, effect] of list.effects.entries()) {
        if (!effectUsesPaidSacrificePower(effect) && !effectUsesPaidSacrificeToughness(effect)) continue;
        found.push(
          violation(
            'ILLEGAL_REFERENT_AMOUNT',
            `${list.path}[${String(index)}]`,
            'a paid-sacrifice-power or paid-sacrifice-toughness amount on an activated ability requires a cost that sacrifices exactly one permanent',
          ),
        );
      }
    }
    for (const [index, effect] of list.effects.entries()) {
      found.push(...checkActivatedEffect(card, ability, effect, `${list.path}[${String(index)}]`, source));
    }
    found.push(...checkAbilityEffectList(list.effects, list.path));
  }
  return found;
}

/** Validates an activation whose rules source is an Aura's live host. */
export function checkGrantedActivatedAbility(
  card: Card,
  ability: ActivatedAbility,
  path: string,
): Violation[] {
  if (card.kind !== 'enchantment' || card.aura === undefined) return [];
  const sourceKind = card.aura.enchant === 'land' ? 'land' : 'creature';
  return checkActivatedAbility(card, ability, path, sourceKind);
}

function checkActivatedEffect(
  card: Card,
  ability: ActivatedAbility,
  effect: Effect,
  path: string,
  source: AbilitySourceContext,
): Violation[] {
  const found: Violation[] = [];
  if (effect.kind === 'loseLife' && effect.amountFrom === 'triggeringPlayerLifeHalfRoundedUp') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        `${path}.amountFrom`,
        'triggeringPlayerLifeHalfRoundedUp requires an each-player upkeep trigger that retains the affected player',
      ),
    );
  }
  if (effect.kind === 'chooseBlockersThisCombat') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'chooseBlockersThisCombat is legal only inside a creature selfAndThreeOthersAttack trigger',
      ),
    );
  }
  if (effect.kind === 'returnSourceFromGraveyard' && ability.activationZone !== 'graveyard') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'returnSourceFromGraveyard is legal only inside an activated ability whose activationZone is "graveyard"',
      ),
    );
  }
  if (effect.kind === 'returnDepartedSourceToOwnerHand') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'returnDepartedSourceToOwnerHand is legal only inside a selfPutIntoGraveyardFromBattlefield trigger',
      ),
    );
  }
  if (effect.kind === 'putDepartedSourceOnTopOfOwnerLibrary') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'putDepartedSourceOnTopOfOwnerLibrary is legal only inside a selfDies trigger',
      ),
    );
  }
  if (effect.kind === 'shuffleSourceIntoOwnerLibrary') {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'shuffleSourceIntoOwnerLibrary is legal only inside a selfPutIntoGraveyardFromAnywhere trigger',
      ),
    );
  }
  // A land is colorless while its color identity still includes mana symbols
  // in its rules text. Activated costs are the structured form of those
  // symbols, so Hellion Crucible's {R} permits its red token without falsely
  // making the land itself red in `card.colors`.
  const colorIdentity = COLORS.filter((color) => card.colors.includes(color) || ability.cost.mana[color] > 0);
  found.push(...checkEffectParams(effect, path, colorIdentity));
  found.push(
    ...checkAbilityEffectTarget(effect, path, {
      sourceAttacking: ability.activateOnlyWhileAttacking === true,
      multipleTargets: true,
    }),
  );
  found.push(...checkEffectScope(effect, path));
  found.push(...checkPlayerSweep(effect, path));
  found.push(
    ...checkChosenXInAbility(
      effect,
      path,
      ability.cost.mana.hasX ||
        (ability.loyaltyCost !== undefined && isVariableLoyaltyCost(ability.loyaltyCost)),
    ),
  );
  found.push(...checkSpellOnlyEffectInAbility(effect, path));
  found.push(...checkSourceLinkedExileInActivation(effect, path));
  found.push(...checkLandAnimationInActivation(effect, path));
  found.push(...checkSourceAnimationInActivation(card, ability, effect, source, path));
  found.push(...checkSourceReferentTarget(source, effect, path));
  found.push(...checkAttachmentCreatureTarget(source, effect, path));
  if (isTargetedFight(effect)) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        'a targeted fight is a spell effect; activated abilities do not use the Prey Upon target pair',
      ),
    );
  } else if (isSourceBodyEffect(effect.kind)) {
    // The body is there on an activation, so this is not the spell rule
    // repeated. It is the printed sentence that has no subject: an activated
    // ability prints after a colon with no clause in front of it, so "It
    // fights target creature you don't control" has no antecedent for "it"
    // and Magic's own wording there is the card's name (Brash Taunter). That
    // is a second construction `renderEffect` would have to tell apart from
    // the trigger's, and the vocabulary does not carry the field that would
    // let it. Forge's corpus agrees about which form is the card anybody
    // prints: 137 `DB$ Fight` against 8 `AB$ Fight`.
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path,
        `${effect.kind} is legal only on a triggered ability, which is the clause that gives "it" an antecedent; an activated ability prints after a colon with nothing in front of it`,
      ),
    );
  }
  if (effect.kind === 'flipCoin') {
    for (const branch of ['winEffects', 'loseEffects'] as const) {
      const nestedEffects = effect[branch] ?? [];
      const branchPath = `${path}.${branch}`;
      for (const [index, nested] of nestedEffects.entries()) {
        found.push(...checkActivatedEffect(card, ability, nested, `${branchPath}[${index}]`, source));
      }
      found.push(...checkAbilityEffectList(nestedEffects, branchPath));
    }
  }
  return found;
}

/**
 * Where a source-body effect may be printed: a creature's triggered ability,
 * under a condition that leaves the source on the battlefield.
 *
 * Three refusals, and each names a different way the card would print a
 * sentence it cannot do.
 *
 * A non-creature source has power 0 through the layers (`powerOf` returns 0 for
 * anything that is not a creature card), so a fight on an enchantment deals
 * nothing and takes nothing. The DSL has no animation effect, so there is no
 * board on which that source is a creature by the time the ability resolves.
 *
 * A death trigger resolves with the source in the graveyard, so CR 701.12 finds
 * one fighter missing and deals no damage at all. That is a blank card rather
 * than a weak one.
 *
 * Other conditions are refused because they do not describe a supported source
 * body event. `controlledCreatureAttacksAlone` observes the controller's lone
 * attacker, which need not be this source, while
 * `selfDealsCombatDamageToCreature` retains a creature from a damage step that
 * has already happened, so a fight there is a second damage exchange nobody
 * prints.
 *
 * That leaves `selfEnters` and `selfAttacks`, which are the two conditions the
 * printed cards use. The former fights a creature the controller does not
 * control; the latter may name the narrower creature the defending player
 * controls, whose attack-only placement `checkAbilityEffectTarget` enforces.
 */
function checkSourceBodyEffectInTrigger(
  source: AbilitySourceContext,
  ability: TriggeredAbility,
  effect: Effect,
  at: string,
): Violation[] {
  if (isTargetedFight(effect)) {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        'a targeted fight is a spell effect; triggered abilities use their source as one fighter',
      ),
    ];
  }
  if (!isSourceBodyEffect(effect.kind)) return [];
  if (source.kind !== 'creature') {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        `${effect.kind} needs the source's own body, and ${withArticle(source.kind)} has no power to fight with`,
      ),
    ];
  }
  if (ability.condition !== 'selfEnters' && ability.condition !== 'selfAttacks') {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        `${effect.kind} is legal on a selfEnters or selfAttacks trigger; "${ability.condition}" either leaves the source off the battlefield when the ability resolves or has already spent the event it would read`,
      ),
    ];
  }
  return [];
}

/**
 * `selfCreature` names the ability's own source as a creature, so it is legal
 * only where the card printing the ability is one.
 *
 * One gate rather than the two `checkSourceBodyEffectInTrigger` needs, because
 * the two checks answer different questions. That function also asks *which
 * trigger condition* the ability fires on, because a `fight`-shaped effect
 * needs the source's body to still be forming (CR 216, `selfEnters` only) —
 * "just entered" is a fact about *when*. This kind needs no such fact: the
 * kernel resolves it off `StackEntry.ability.sourceOid`
 * (`packages/kernel/src/stack.ts`'s `planResolution`), a field every ability on
 * the stack carries whether a trigger put it there or a player activated it,
 * and a source that has since left the battlefield already makes the effect a
 * no-op there (the same CR 608.2b-shaped fallback `triggeringCreature` gets).
 * So the only printed-card fact worth checking here is the one a trigger
 * condition cannot change: whether "this creature" names anything at all.
 *
 * Called from both `checkTriggeredAbility` and `checkActivatedAbility`, unlike
 * `checkSourceBodyEffectInTrigger`, which is triggered-only because its
 * `selfEnters` condition has no activated-ability analog — Nantuko Shade's
 * activated self-pump and Griffin Protector's triggered one both need this
 * gate and neither needs that one.
 *
 * `selfPermanent` (`mtg-rji`), the other member of `SOURCE_BODY_ONLY_TARGETS`,
 * ordinarily needs no card-kind gate: every card allowed to print an ability is
 * a permanent. `sacrificeSelf` is the one canonical-language exception. A
 * creature source already has the narrower `selfCreature` spelling, so it may
 * not also say the same behavior through `selfPermanent`; noncreature sources
 * use the wider noun Sorcerer's Strongbox needs.
 */
function checkSourceReferentTarget(source: AbilitySourceContext, effect: Effect, at: string): Violation[] {
  if (!hasTarget(effect)) return [];
  if (effect.target.kind === 'selfCreature' && source.kind !== 'creature') {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        `selfCreature names the ability's own source as a creature, and ${withArticle(source.kind)} is not one`,
      ),
    ];
  }
  if (
    effect.kind === 'sacrificeSelf' &&
    effect.target.kind === 'selfPermanent' &&
    source.kind === 'creature'
  ) {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        'a creature sacrificing its own source uses selfCreature as the one canonical spelling; selfPermanent is for noncreature sources',
      ),
    ];
  }
  return [];
}

/** An attachment referent has a value only on the matching source card type. */
function checkAttachmentCreatureTarget(
  source: AbilitySourceContext,
  effect: Effect,
  at: string,
): Violation[] {
  if (!hasTarget(effect) || !isSourceAttachmentTarget(effect.target.kind)) return [];
  if (
    (effect.target.kind === 'enchantedCreature' && source.creatureAura) ||
    (effect.target.kind === 'equippedCreature' && source.equipment)
  ) {
    return [];
  }
  return [
    violation(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
      at,
      `${effect.target.kind} is legal only on an ability printed by ${effect.target.kind === 'enchantedCreature' ? 'a creature Aura' : 'an Equipment'}`,
    ),
  ];
}

/** Keeps each live player rule paired with the subject its printed text names. */
function checkStaticPlayerRule(ability: StaticPlayerRuleAbility, path: string): Violation[] {
  const found =
    ability.spellFilter === undefined
      ? []
      : ability.rule === 'castSpellsAsThoughFlash'
        ? checkCardFilterLists(ability.spellFilter, `${path}.spellFilter`)
        : [
            violation(
              'STATIC_FILTER_ILLEGAL_ON_SCOPE',
              `${path}.spellFilter`,
              'spellFilter is legal only on castSpellsAsThoughFlash',
            ),
          ];
  let expected: StaticPlayerRuleAbility['players'];
  switch (ability.rule) {
    case 'hasHexproof':
    case 'castSpellsAsThoughFlash':
    case 'castSpellsFromHandWithoutPayingManaCost':
    case 'noMaximumHandSize':
    case 'playWithTopLibraryRevealed':
      expected = 'controller';
      break;
    case 'cantAttackWithCreaturesIfCastSpellThisTurn':
    case 'cantCastSpellsIfAttackedWithCreatureThisTurn':
    case 'cardsToGraveyardAreExiled':
    case 'attackControllerOrPlaneswalkersTaxedByControlledEnchantments':
      expected = 'eachOpponent';
      break;
    case 'cardsOrTokensToGraveyardAreExiled':
    case 'instantOrSorceryCardsToGraveyardAreExiled':
      expected = 'eachPlayer';
      break;
    default:
      return assertNever(ability.rule, 'checkStaticPlayerRule');
  }
  if (ability.players === expected) return found;
  return [
    ...found,
    violation(
      'STATIC_PLAYER_RULE_SCOPE_INVALID',
      `${path}.players`,
      `${ability.rule} requires the ${expected} player scope`,
    ),
  ];
}

function checkStaticBundle(ability: StaticBundleAbility, path: string): Violation[] {
  const found = [
    ...checkCondition(ability.enabledWhile, `${path}.enabledWhile`),
    ...checkModifications(ability.modifications, `${path}.modifications`),
  ];
  if (ability.subtype !== undefined && !SUBTYPE_PATTERN.test(ability.subtype)) {
    found.push(
      violation(
        'INVALID_SUBTYPE',
        `${path}.subtype`,
        `subtype "${ability.subtype}" must be a capitalized word such as "Vampire"`,
      ),
    );
  }
  return found;
}

function checkAbility(card: Card, ability: Ability, path: string): Violation[] {
  switch (ability.kind) {
    case 'static':
      return [
        ...checkStaticScope(card, ability, path),
        ...checkStaticSubtype(ability, path),
        ...checkStaticFilter(ability, path),
        ...checkPrintedStaticSubject(card, ability, path),
        ...checkPrintedStaticSource(ability, path),
        ...checkStaticModification(card, ability, path),
        ...checkStaticCondition(ability, path),
      ];
    case 'triggered':
      return checkTriggeredAbility(sourceContext(card), ability, path);
    case 'activated':
      return checkActivatedAbility(card, ability, path);
    case 'staticPlayerRule':
      return checkStaticPlayerRule(ability, path);
    case 'staticGameRule':
      // The strict schema fixes every supported global rule's complete shape.
      // Placement is enforced once for the whole card.
      return [];
    case 'stateTriggered':
      return checkStateTriggeredAbility(sourceContext(card), ability, path);
    case 'staticBundle':
      return checkStaticBundle(ability, path);
    case 'staticActivationRule':
      return card.kind === 'artifact' && printedEntryReplacement(card)?.kind === 'chooseCardName'
        ? []
        : [
            violation(
              'ABILITY_ILLEGAL_ON_CARD_TYPE',
              path,
              'staticActivationRule requires an artifact that chooses a card name as it enters',
            ),
          ];
    default:
      return assertNever(ability, 'checkAbility');
  }
}

/**
 * The same ability twice is one ability printed twice.
 *
 * Two identical statics register two continuous effects that apply to the same
 * permanents in the same layer, so the card plays as one ability of double the
 * size while printing the line twice — text and behavior disagreeing, which is
 * the failure `checkDuplicateEffects` refuses for effects. Compared by
 * `canonicalJson` so key order cannot hide a repeat.
 */
function checkDuplicateAbilities(abilities: readonly Ability[]): Violation[] {
  const firstSeen = new Map<string, number>();
  const found: Violation[] = [];
  for (const [index, ability] of abilities.entries()) {
    const key = canonicalJson(ability);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    found.push(
      violation(
        'DUPLICATE_ABILITY',
        `abilities[${index}]`,
        `this ${ability.kind} ability repeats abilities[${earlier}] exactly; delete it, or express the intent as one ability with the larger effect`,
      ),
    );
  }
  return found;
}

/**
 * One attachment relation has no field naming which of two Equip clauses made
 * it. Keeping one clause per Equipment lets live combat restrictions read the
 * attached source without storing redundant derived state on the game object.
 */
function checkSingleEquipAbility(abilities: readonly Ability[]): Violation[] {
  const attaching = abilities
    .map((ability, index) => ({ ability, index }))
    .filter((entry) => isAttachingAbility(entry.ability));
  const first = attaching[0];
  if (first === undefined) return [];
  return attaching
    .slice(1)
    .map((entry) =>
      violation(
        'EQUIP_ABILITY_INVALID',
        `abilities[${String(entry.index)}].attach`,
        `an Equipment may print one Equip ability; this attachment cannot distinguish it from abilities[${String(first.index)}]`,
      ),
    );
}

export function checkAbilities(card: Card): Violation[] {
  const found: Violation[] = [...checkPlacement(card)];
  const choosesCardName = printedEntryReplacement(card)?.kind === 'chooseCardName';
  const activationRules = card.abilities.filter((ability) => ability.kind === 'staticActivationRule');
  if (choosesCardName !== (activationRules.length === 1)) {
    found.push(
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        choosesCardName ? 'abilities' : 'entryReplacement',
        'chooseCardName and exactly one staticActivationRule must be printed as one artifact capability',
      ),
    );
  }
  if (card.abilities.length > MAX_CARD_ABILITIES) {
    found.push(
      violation(
        'ABILITY_COUNT_INVALID',
        'abilities',
        `${withArticle(card.kind)} may print at most ${String(MAX_CARD_ABILITIES)} abilities`,
      ),
    );
  }
  if (card.kind === 'planeswalker') {
    if (card.startingLoyalty <= 0 || card.startingLoyalty > 20) {
      found.push(
        violation(
          'PLANESWALKER_INVALID',
          'startingLoyalty',
          `starting loyalty must be between 1 and 20, got ${String(card.startingLoyalty)}`,
        ),
      );
    }
    for (const [index, ability] of card.abilities.entries()) {
      if (ability.kind !== 'activated') {
        found.push(
          violation(
            'ABILITY_ILLEGAL_ON_CARD_TYPE',
            `abilities[${String(index)}]`,
            'this bounded planeswalker envelope accepts loyalty abilities only',
          ),
        );
      }
    }
  }
  found.push(...checkSingleEquipAbility(card.abilities));
  found.push(...checkSourceLinkedExilePair(card));
  found.push(...checkSameNameCohortBundle(card));
  found.push(...checkAngelOfSerenityBundle(card));
  found.push(...checkSearchTheCityBundle(card));
  found.push(...checkGuildFeudBundle(card));
  found.push(...checkSourceCounterRaceBundle(card));
  for (const [index, ability] of card.abilities.entries()) {
    found.push(...checkAbility(card, ability, `abilities[${index}]`));
  }
  found.push(...checkDuplicateAbilities(card.abilities));
  return found;
}
