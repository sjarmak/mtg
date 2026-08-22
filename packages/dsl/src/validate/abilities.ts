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
  EffectBearingAbility,
  StaticAbility,
  StaticModification,
  TriggeredAbility,
} from '../abilities';
import { EQUIPMENT_SUBTYPE, isAttachingAbility, isExaltedAbility, isRegenerationAbility } from '../abilities';
import { canonicalJson } from '../canonical-json';
import type { Card } from '../card';
import type { Effect } from '../effects';
import { hasTarget, isSourceBodyEffect } from '../effects';
import { manaValue } from '../mana';
import { isAttackTriggerOnlyTarget } from '../targets';
import { classifyStaticModification } from '../static-modification-class';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { withArticle } from '../text-util';
import { assertNever, COLORS, SUBTYPE_PATTERN, TRIGGERING_CREATURE_CONDITIONS } from '../vocabulary';
import { MAX_MANA_VALUE } from './cost';
import {
  checkEffectParams,
  checkEffectScope,
  checkPlayerSweep,
  checkReferentTargets,
  checkRange,
  effectUsesChosenX,
  legalTargetsFor,
  LIMITS,
} from './effects';

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
  if (ability.scope === 'self') {
    return [
      violation(
        'STATIC_SUBTYPE_ILLEGAL_ON_SCOPE',
        `${path}.subtype`,
        `a "self" scope is exactly one permanent, the source, so narrowing it to "${subtype}" states a condition DSL v1 cannot express; drop the subtype or widen the scope`,
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

/**
 * CR 611.2c: what the static's `enabledWhile` predicate may say, when it prints
 * one at all.
 *
 * `null` is "unconditional", the only shape a card printed before this field
 * existed carries, so a card with no `enabledWhile` returns no violation and
 * this function is never the reason an old fixture starts failing.
 *
 * Real `switch`/`assertNever` dispatch as of `mtg-jp23`: `ConditionSchema`
 * gained a second member (`anyCreatureHasCounter`), which is what makes
 * `Condition['kind']` an actual literal union TypeScript can narrow a
 * `default` branch against — the direct field access this function used to do
 * (mirroring `checkModification`'s pre-two-member state) stopped compiling
 * the moment the second member's fields diverged from the first's, and this
 * is the fixed shape rather than the transitional one.
 */
function checkStaticCondition(ability: StaticAbility, path: string): Violation[] {
  // `enabledWhile` is optional (`abilities.ts` explains why): an absent key
  // and an explicit `null` both mean unconditional, so both take the same exit.
  const condition = ability.enabledWhile ?? null;
  if (condition === null) return [];
  const at = `${path}.enabledWhile`;
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
    // The threshold family's third floor and the one range in it that is not
    // `conditionThreshold`: a life total is not a count of permanents, and
    // `LIMITS.lifeThreshold` says why the ceiling differs. The violation code
    // is the same one, because the authoring mistake a reader has to fix is the
    // same one — a floor the game never reaches.
    case 'lifeAtLeast':
      return checkRange(
        condition.atLeast,
        LIMITS.lifeThreshold,
        `${at}.atLeast`,
        'life threshold',
        'CONDITION_THRESHOLD_OUT_OF_RANGE',
      );
    // No field, so nothing to range-check or pattern-match — the same exit
    // `anyCreatureHasCounter` takes, one member earlier, for one less reason.
    case 'noOpponentDealtDamageThisTurn':
      return [];
    default:
      return assertNever(condition, 'checkStaticCondition');
  }
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
    case 'doubleDamage':
    case 'doubleLifeGain':
      // Neither doubler carries a number, so there is no range to hold it to.
      // The factor is fixed at two in the schema itself, which is the whole
      // reason these are two members rather than one member with a `factor`:
      // a card that reads "triple" is a card the color pie has no rate for.
      return [];
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'attacksEachCombatIfAble':
    case 'mustBeBlockedIfAble':
    case 'blockOnlyCreaturesWithKeyword':
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
    case 'statBonusPer':
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
function checkStaticModification(ability: StaticAbility, path: string): Violation[] {
  const found = checkStaticModificationRecord(ability.modification, `${path}.modification`);
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
    case 'statBonusPer':
      // Keyed by what it counts, for `blockOnlyCreaturesWithKeyword`'s reason:
      // two rates over two different tallies are two modifications that stack,
      // and two over the same tally are one written twice.
      return `statBonusPer:${JSON.stringify(modification.each)}`;
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
 * behaves the other way. Magic joins the two halves with "If you do", which is a
 * reflexive trigger and outside this vocabulary
 * (`docs/design/dsl-v1-ability-model.md` §6.2).
 *
 * So the rule is a card rule, not a schema rule: it has a path and a coded
 * violation a repair loop can act on, and the fix it names is the one a designer
 * would make anyway.
 */
function checkOptionalTrigger(ability: TriggeredAbility, path: string): Violation[] {
  if (ability.optional !== true || ability.effects.length === 1) return [];
  return [
    violation(
      'OPTIONAL_TRIGGER_INVALID',
      `${path}.effects`,
      `"you may" is answered once for the whole ability, so an optional trigger prints one effect; this one prints ${ability.effects.length}. Drop one, or drop the "optional"`,
    ),
  ];
}

/**
 * The same effect twice inside one ability is one effect printed twice: the
 * kernel applies both, and the card reads "You gain 2 life. You gain 2 life."
 * where the design meant 4. `checkDuplicateEffects` makes the same argument for
 * a spell's list.
 */
function checkDuplicateAbilityEffects(ability: EffectBearingAbility, path: string): Violation[] {
  const firstSeen = new Map<string, number>();
  const found: Violation[] = [];
  for (const [index, effect] of ability.effects.entries()) {
    const key = canonicalJson(effect);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    found.push(
      violation(
        'DUPLICATE_EFFECT',
        `${path}.effects[${index}]`,
        `this ${effect.kind} repeats ${path}.effects[${earlier}] exactly; express the intent as one effect with the larger number`,
      ),
    );
  }
  return found;
}

function checkTriggeredAbility(card: Card, ability: TriggeredAbility, path: string): Violation[] {
  const found: Violation[] = [...checkOptionalTrigger(ability, path)];
  const exactExalted = isExaltedAbility(ability);
  // Three triggers retain a creature from their own event, and they retain it
  // for the same reason: the ability names a body nobody chose. Which three is
  // `TRIGGERING_CREATURE_CONDITIONS`, in the vocabulary, because the kernel's
  // `TriggerContext` and the replay log schema have to agree with this function
  // about it and two of the three copies drifted apart the last time it was
  // written out three times. What is decided here is the clause the list
  // deliberately leaves out: exalted retains its lone attacker only inside the
  // one canonical envelope, while the other two retain one on every ability
  // that prints them, so the condition alone is the permission for those.
  const retainsTriggeringCreature = TRIGGERING_CREATURE_CONDITIONS.some(
    (condition) =>
      condition === ability.condition && (condition !== 'controlledCreatureAttacksAlone' || exactExalted),
  );
  for (const [index, effect] of ability.effects.entries()) {
    const at = `${path}.effects[${index}]`;
    found.push(...checkEffectParams(effect, at, card.colors));
    found.push(
      ...checkAbilityEffectTarget(effect, at, {
        triggeringCreature: retainsTriggeringCreature,
        defendingPlayersCreature: ability.condition === 'selfAttacks',
      }),
    );
    found.push(...checkEffectScope(effect, at));
    found.push(...checkPlayerSweep(effect, at));
    found.push(...checkChosenXInAbility(effect, at, false));
    found.push(...checkSourceBodyEffectInTrigger(card, ability, effect, at));
    found.push(...checkSelfCreatureTarget(card, effect, at));
  }
  // The list-level half of the referent kinds, called here for the reason
  // `checkEffectList` calls it over a spell's list: whether "that creature" has
  // a referent is a fact about the effects around it, and an ability's list is
  // as much a list as a spell's. `mtg-nhyv.75`.
  found.push(...checkReferentTargets(ability.effects, `${path}.effects`));
  const usesTriggeringCreature = ability.effects.some(
    (effect) => hasTarget(effect) && effect.target.kind === 'triggeringCreature',
  );
  if (
    (ability.condition === 'controlledCreatureAttacksAlone' && !exactExalted) ||
    (usesTriggeringCreature && !retainsTriggeringCreature)
  ) {
    found.push(
      violation(
        'ILLEGAL_TARGET_IN_ABILITY',
        path,
        'controlledCreatureAttacksAlone is reserved for the exact mandatory +1/+1 exalted ability, and triggeringCreature is retained only by that ability or by a selfDealsCombatDamageToCreature or selfBlocksOrIsBlockedByGreaterPower trigger',
      ),
    );
  }
  found.push(...checkDuplicateAbilityEffects(ability, path));
  return found;
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
 * The remaining costs DSL v1 has no field for — a counter removed, life paid —
 * still count as nothing here, so an ability naming only those is unbounded
 * rather than cheap.
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

/**
 * How many permanents one cost may eat.
 *
 * Not an entry in `LIMITS`, which is the table of *effect* parameters shared
 * between a spell and a static ability; nothing in it is a cost. The ceiling is
 * the boss chest of decision 14's three tiers, and a cost that wants more than
 * four is a design conversation rather than a wider constant.
 */
const SACRIFICE_COUNT = { min: 1, max: 4 } as const;

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
    ...(cost.discard === undefined
      ? []
      : checkRange(
          cost.discard,
          DISCARD_COST_COUNT,
          `${at}.discard`,
          'discard count',
          'ABILITY_COST_INVALID',
        )),
  ];
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
  if (found.length > 0) return [...named, ...found];

  const value = manaValue(cost.mana);
  if (
    value === 0 &&
    !cost.tapSelf &&
    !cost.sacrificeSelf &&
    cost.sacrificeOther === undefined &&
    cost.discard === undefined &&
    ability.loyaltyCost === undefined
  ) {
    found.push(
      violation(
        'ABILITY_COST_INVALID',
        at,
        'an ability that costs no mana, does not tap and does not sacrifice its source can be activated again the moment it resolves; give it a mana cost, a tap symbol, a sacrifice, a discard, or a combination',
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
   * `selfDealsCombatDamageToCreature` trigger just damaged, or the larger
   * creature a `selfBlocksOrIsBlockedByGreaterPower` trigger just met in a
   * block.
   */
  readonly triggeringCreature?: boolean;
  /** Only a `selfAttacks` trigger has a defending player to name (CR 506.2). */
  readonly defendingPlayersCreature?: boolean;
}

function checkAbilityEffectTarget(
  effect: Effect,
  path: string,
  permissions: AbilityTargetPermissions = {},
): Violation[] {
  if (!hasTarget(effect)) return [];
  if (effect.target.kind === 'triggeringCreature') {
    return permissions.triggeringCreature === true
      ? []
      : [
          violation(
            'ILLEGAL_TARGET_IN_ABILITY',
            `${path}.target.kind`,
            'triggeringCreature is retained only by the exact exalted trigger or by a selfDealsCombatDamageToCreature or selfBlocksOrIsBlockedByGreaterPower trigger',
          ),
        ];
  }
  if (isAttackTriggerOnlyTarget(effect.target.kind)) {
    // CR 506.2 names a defending player only for the duration of a combat, and
    // only relative to an attack. An ability that does not fire on its source
    // attacking has no attack to read the role off, so the printed phrase would
    // have no referent and the kernel would have nothing to enumerate.
    if (permissions.defendingPlayersCreature !== true) {
      return [
        violation(
          'ILLEGAL_TARGET_IN_ABILITY',
          `${path}.target.kind`,
          'targetCreatureDefendingPlayerControls is legal only on a triggered ability whose condition is selfAttacks; there is no defending player outside the combat the source is attacking in',
        ),
      ];
    }
  }
  const allowed = legalTargetsFor(effect.kind);
  if (allowed.includes(effect.target.kind)) return [];
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
 * The cost is mana and nothing else. `sacrificeSelf` is the rule that matters:
 * CR 601.2h pays an activation cost before the ability is put on the stack, so
 * a weapon priced that way is in its owner's graveyard by the time the ability
 * resolves and attaches a permanent that is no longer on the battlefield. The
 * tap symbol, `sacrificeOther` and `discard` go with it for a smaller reason —
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
  if (cost.sacrificeSelf || cost.tapSelf || cost.sacrificeOther !== undefined || cost.discard !== undefined) {
    found.push(
      violation(
        'EQUIP_ABILITY_INVALID',
        `${path}.cost`,
        'an equip cost is mana in DSL v1; a sacrifice is paid before the ability reaches the stack (CR 601.2h), which would attach a permanent that has left the battlefield',
      ),
    );
  }
  return found;
}

function checkActivatedAbility(card: Card, ability: ActivatedAbility, path: string): Violation[] {
  const found: Violation[] = [...checkActivationCost(ability, path)];
  if (ability.loyaltyCost !== undefined) {
    if (card.kind !== 'planeswalker') {
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
      ability.cost.sacrificeSelf ||
      ability.cost.sacrificeOther !== undefined ||
      ability.cost.discard !== undefined
    ) {
      found.push(
        violation(
          'ABILITY_COST_INVALID',
          `${path}.cost`,
          'a loyalty ability pays exactly its signed loyalty cost and no mana, tap, sacrifice, or discard cost',
        ),
      );
    }
    if (ability.loyaltyCost < -20 || ability.loyaltyCost > 20) {
      found.push(
        violation(
          'PLANESWALKER_INVALID',
          `${path}.loyaltyCost`,
          `a loyalty cost must be between -20 and 20, got ${String(ability.loyaltyCost)}`,
        ),
      );
    }
  } else if (card.kind === 'planeswalker') {
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
    if (card.kind !== 'creature') {
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
      ability.cost.sacrificeSelf
    ) {
      found.push(
        violation(
          'REGENERATION_ABILITY_INVALID',
          path,
          'a regeneration ability creates only its self-regeneration shield; it cannot also attach, sacrifice its source, carry effects, or be a loyalty ability',
        ),
      );
    }
  } else if (!isAttachingAbility(ability) && ability.effects.length === 0) {
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
  for (const [index, effect] of ability.effects.entries()) {
    const at = `${path}.effects[${index}]`;
    found.push(...checkEffectParams(effect, at, card.colors));
    found.push(...checkAbilityEffectTarget(effect, at));
    found.push(...checkEffectScope(effect, at));
    found.push(...checkPlayerSweep(effect, at));
    found.push(...checkChosenXInAbility(effect, at, ability.cost.mana.hasX));
    found.push(...checkSelfCreatureTarget(card, effect, at));
    if (isSourceBodyEffect(effect.kind)) {
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
          at,
          `${effect.kind} is legal only on a triggered ability, which is the clause that gives "it" an antecedent; an activated ability prints after a colon with nothing in front of it`,
        ),
      );
    }
  }
  // The same list-level referent check the triggered arm runs, and the same
  // reason: an activated ability chooses its targets at CR 601.2c where a
  // trigger chooses at CR 603.3d, and a back-reference reads a sibling slot
  // either way.
  found.push(...checkReferentTargets(ability.effects, `${path}.effects`));
  found.push(...checkDuplicateAbilityEffects(ability, path));
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
 * The remaining two conditions are refused because each already spends the
 * event it would need: `controlledCreatureAttacksAlone` is reserved for the
 * canonical exalted envelope a few lines down, and
 * `selfDealsCombatDamageToCreature` retains a creature from a damage step that
 * has already happened, so a fight there is a second damage exchange nobody
 * prints.
 *
 * That leaves `selfEnters` and `selfAttacks`, which are the two conditions the
 * printed cards use (Foe-Razer Regent and The Tarrasque). This slice admits
 * `selfEnters` only; `selfAttacks` needs `targetCreatureDefendingPlayerControls`
 * added to the Forge row and the trigger condition threaded into
 * `EffectScriptContext`, and those move together or not at all.
 */
function checkSourceBodyEffectInTrigger(
  card: Card,
  ability: TriggeredAbility,
  effect: Effect,
  at: string,
): Violation[] {
  if (!isSourceBodyEffect(effect.kind)) return [];
  if (card.kind !== 'creature') {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        `${effect.kind} needs the source's own body, and ${withArticle(card.kind)} has no power to fight with`,
      ),
    ];
  }
  if (ability.condition !== 'selfEnters') {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        `${effect.kind} is legal on a selfEnters trigger; "${ability.condition}" either leaves the source off the battlefield when the ability resolves or has already spent the event it would read`,
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
 * has no gate here and needs none — which is the whole reason it exists as a
 * separate kind. The fact it would assert is already asserted by
 * `checkPlacement` at the top of this file: an ability may be printed only on a
 * creature, artifact, land, enchantment or planeswalker, so every card that can
 * reach this function is a permanent and "this permanent" always names
 * something. This gate survives because it asserts something strictly narrower
 * than that, and a narrower claim is the only kind of claim worth a check.
 */
function checkSelfCreatureTarget(card: Card, effect: Effect, at: string): Violation[] {
  if (!hasTarget(effect) || effect.target.kind !== 'selfCreature') return [];
  if (card.kind !== 'creature') {
    return [
      violation(
        'ABILITY_ILLEGAL_ON_CARD_TYPE',
        at,
        `selfCreature names the ability's own source as a creature, and ${withArticle(card.kind)} is not one`,
      ),
    ];
  }
  return [];
}

function checkAbility(card: Card, ability: Ability, path: string): Violation[] {
  switch (ability.kind) {
    case 'static':
      return [
        ...checkStaticScope(card, ability, path),
        ...checkStaticSubtype(ability, path),
        ...checkStaticModification(ability, path),
        ...checkStaticCondition(ability, path),
      ];
    case 'triggered':
      return checkTriggeredAbility(card, ability, path);
    case 'activated':
      return checkActivatedAbility(card, ability, path);
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

export function checkAbilities(card: Card): Violation[] {
  const found: Violation[] = [...checkPlacement(card)];
  const limit = card.kind === 'planeswalker' ? 3 : 2;
  if (card.abilities.length > limit) {
    found.push(
      violation(
        'ABILITY_COUNT_INVALID',
        'abilities',
        `${withArticle(card.kind)} may print at most ${String(limit)} abilities`,
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
  for (const [index, ability] of card.abilities.entries()) {
    found.push(...checkAbility(card, ability, `abilities[${index}]`));
  }
  found.push(...checkDuplicateAbilities(card.abilities));
  return found;
}
