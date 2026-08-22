/**
 * Shared evaluators.
 *
 * Every policy scores the same things the same way (Forge's `ComputerUtil*` /
 * `CreatureEvaluator` split — `docs/research/prior-art-mtg-ai.md` §2.1), so a
 * creature is worth the same number whether we are deciding to cast it, attack
 * with it, block with it, or point removal at it.
 *
 * Two evaluators exist for creatures on purpose: `printedCreatureValue` reads
 * the DSL card (used for cards in hand, which have no game object yet) and
 * `boardCreatureValue` reads through the kernel's layer system (used for
 * permanents, so pump effects and damage are reflected).
 */
import type { Ability, Card, GrantableKeyword, Keyword, StaticModification, StaticScope } from '@mtg/dsl';
import { assertNever, cardManaValue, isGrantableKeywordAbilityKind, KEYWORDS, manaValue } from '@mtg/dsl';
import type { GameObject, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  creaturesControlledBy,
  getObject,
  hasGrantableKeyword,
  hasKeyword,
  opponentOf,
  powerOf,
  toughnessOf,
  tryObject,
} from '@mtg/kernel';
import type { CastPolicyConfig } from './config';

/** Sum of the configured value of each keyword in the list. */
export function keywordValue(config: CastPolicyConfig, keywords: readonly Keyword[]): number {
  let total = 0;
  for (const keyword of keywords) total += config.keywordValue[keyword];
  return total;
}

/**
 * What one static modification is worth on one permanent, in the units a body
 * is valued in.
 *
 * One owner, because two things ask it: a lord's printed static, valued for a
 * card still in hand, and an equip clause, valued for the creature the
 * activation policy is choosing to attach to (`policies/activate.ts`). CR 613
 * gives them the same two layers and the kernel registers the same record for
 * both, so a second scale here would price a +2/+0 on a weapon differently from
 * a +2/+0 on an anthem.
 */
/**
 * What granting one name is worth, from whichever of the two tables holds it.
 *
 * The modification names one thing and the config prices two lists, for the
 * reason `CastPolicyConfig.grantedKeywordAbilityValue` gives: an evergreen
 * keyword and a keyword ability land in different halves of a permanent's
 * characteristics, so they are priced in different tables and read through the
 * same split `effectForModification` makes.
 */
function grantValue(config: CastPolicyConfig, keyword: GrantableKeyword): number {
  return isGrantableKeywordAbilityKind(keyword)
    ? config.grantedKeywordAbilityValue[keyword]
    : config.keywordValue[keyword];
}

export function modificationValue(config: CastPolicyConfig, modification: StaticModification): number {
  switch (modification.kind) {
    case 'statBonus':
      return modification.power * config.powerWeight + modification.toughness * config.toughnessWeight;
    case 'grantKeyword':
      return grantValue(config, modification.keyword);
    case 'definePt': {
      const count = config.definePtAssumedCount;
      return (
        (count + modification.powerOffset) * config.powerWeight +
        (count + modification.toughnessOffset) * config.toughnessWeight
      );
    }
    case 'statBonusPer': {
      // The same assumed count `definePt` above spends, for the same reason:
      // both are a live tally this function has no board to read. It is on the
      // body scale rather than at zero because the modification *is* a body
      // change — the arms below are zero because a replacement and a combat
      // restriction are not, which is a different fact about them and not a
      // shared shrug.
      const count = config.definePtAssumedCount;
      return (
        modification.power * count * config.powerWeight +
        modification.toughness * count * config.toughnessWeight
      );
    }
    // Zero, and the scale is why. Every term above is power and toughness: this
    // function prices a modification as the body it changes, and a CR 614
    // replacement changes no body at all. There is no number here to multiply —
    // a doubler's value is a future damage or life-gain event, which is not a
    // characteristic and not on this scale. `@mtg/deckbuild`'s
    // `staticModificationValue` reaches the same zero from the deck-shaped
    // argument.
    case 'doubleDamage':
    case 'doubleLifeGain':
      return 0;
    // The combat class (`static-modification-class.ts`) is zero for the same
    // scale reason as the two replacements above: this function prices a
    // modification as the power/toughness it changes, and none of the seven
    // change power or toughness. `cantAttack`, `cantBlock`, `cantBeBlocked`,
    // `attacksEachCombatIfAble`, `mustBeBlockedIfAble`,
    // `blockOnlyCreaturesWithKeyword` and `cantBeBlockedBySubtype` are
    // combat-legality facts (CR 508/509), not characteristics, and this
    // evaluator has a body-shaped scale to spend them on and none to spend. A bot policy that needs to weigh a combat
    // restriction reads it where it decides whether to attack or block
    // (`legal.ts` already refuses an illegal choice before the policy sees
    // it), not here where a card in hand is scored as a body.
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'attacksEachCombatIfAble':
    case 'mustBeBlockedIfAble':
    case 'blockOnlyCreaturesWithKeyword':
    case 'cantBeBlockedBySubtype':
      return 0;
    default:
      return assertNever(modification, 'modificationValue');
  }
}

/**
 * What a static modification is worth *on this permanent, right now* — the
 * board-reading half of the pair above, in the sense `boardCreatureValue` is
 * the board-reading half of `printedCreatureValue`.
 *
 * One term separates it from the printed figure: a keyword the permanent
 * already has is worth nothing to grant it again, which is the layer 6 half of
 * `boardCreatureValue`'s arithmetic (it sums the keywords the creature has, and
 * a second copy of one adds nothing). Layer 7c has no equivalent term, because
 * both P/T modifications DSL v1 expresses are additive.
 */
export function modificationValueOn(
  config: CastPolicyConfig,
  state: GameState,
  oid: ObjectId,
  modification: StaticModification,
): number {
  if (modification.kind === 'grantKeyword' && hasGrantableKeyword(state, oid, modification.keyword)) return 0;
  return modificationValue(config, modification);
}

/**
 * Value of one printed ability, in the same units a body is valued in: for a
 * static, what it grants times the permanents it is assumed to reach; for a
 * trigger, what its condition is worth (`CastPolicyConfig.triggerValue`).
 *
 * The bot has to want to cast a lord, and a lord in hand is a vanilla body plus
 * a line of text. Without this the policy scores "Merfolk Tidecaller, 2/2" exactly
 * as it scores a 2/2 bear, and `mtg-bc2.132`'s risk 3 lands: a seeded balance
 * run over a set whose mechanic the bots never use reports healthy numbers for
 * a format nobody has actually played.
 */
export function printedAbilityValue(config: CastPolicyConfig, ability: Ability): number {
  switch (ability.kind) {
    case 'static': {
      const reach = ability.scope === 'self' ? 1 : config.staticAbilityReach;
      return reach * modificationValue(config, ability.modification);
    }
    case 'triggered':
      return config.triggerValue[ability.condition];
    case 'activated':
      // A flat figure per ability, discounted by what activating costs, for the
      // same reason `triggerValue` is flat: nothing in this policy reads an
      // effect payload when it is valuing a card in hand. Whether to activate
      // *this* one, at *that* target, is the activation policy's question and
      // it reads the payload there (`policies/activate.ts`).
      return Math.max(0, config.activationValue - config.activationCostWeight * manaValue(ability.cost.mana));
    default:
      return assertNever(ability, 'printedAbilityValue');
  }
}

function printedAbilitiesValue(config: CastPolicyConfig, card: Card): number {
  return card.abilities.reduce((sum, ability) => sum + printedAbilityValue(config, ability), 0);
}

/** Value of a creature card as printed, for cards that are not on the battlefield yet. */
export function printedCreatureValue(config: CastPolicyConfig, card: Card): number {
  if (card.kind !== 'creature') return 0;
  return (
    config.creatureBaseValue +
    card.power * config.powerWeight +
    card.toughness * config.toughnessWeight +
    keywordValue(config, card.keywords) +
    printedAbilitiesValue(config, card)
  );
}

/**
 * How much of a static's reach this permanent's own body does not already show.
 *
 * `boardCreatureValue` reads `powerOf`, `toughnessOf` and `hasKeyword`, so
 * whatever a static grants *to its own source* is already in the figure. The
 * kernel's `staticFilterFor` says exactly which scopes do that: `self` is the
 * source alone, `creaturesYouControl` matches the source too when the source is
 * a creature, and `otherCreaturesYouControl` excludes it. So the board-side term
 * is the printed reach less the one permanent the layers already spoke for.
 */
function boardStaticReach(config: CastPolicyConfig, scope: StaticScope): number {
  switch (scope) {
    case 'self':
      return 0;
    case 'creaturesYouControl':
      return Math.max(0, config.staticAbilityReach - 1);
    case 'otherCreaturesYouControl':
      return config.staticAbilityReach;
    default:
      return assertNever(scope, 'boardStaticReach');
  }
}

/**
 * What a permanent's printed abilities are worth on top of the body the layers
 * describe.
 *
 * `printedCreatureValue` has counted abilities since the ability model landed
 * and this evaluator has not, so a lord in hand was worth its line of text and
 * the same lord on the battlefield was a vanilla body — to the block policy
 * deciding whether to trade it, to the chump ordering deciding which creature is
 * cheapest to throw away, and to the targeting policy deciding which creature to
 * point removal at. Killing a permanent takes its text as well as its body.
 *
 * A trigger and an activation are worth what they are worth in hand: neither
 * leaves a trace in the layer system for `boardCreatureValue` to have read
 * already. A static does leave one, which is what `boardStaticReach` subtracts.
 */
function boardAbilityValue(config: CastPolicyConfig, ability: Ability): number {
  if (ability.kind !== 'static') return printedAbilityValue(config, ability);
  return boardStaticReach(config, ability.scope) * modificationValue(config, ability.modification);
}

/** Value of a permanent as it currently stands, layers and marked damage included. */
export function boardCreatureValue(config: CastPolicyConfig, state: GameState, oid: ObjectId): number {
  const object = tryObject(state, oid);
  if (object === undefined || object.card.kind !== 'creature') return 0;
  const remaining = Math.max(0, toughnessOf(state, oid) - object.damage);
  let keywords = 0;
  for (const keyword of KEYWORDS) {
    if (hasKeyword(state, oid, keyword)) keywords += config.keywordValue[keyword];
  }
  const abilities = object.card.abilities.reduce(
    (sum, ability) => sum + boardAbilityValue(config, ability),
    0,
  );
  return (
    config.creatureBaseValue +
    powerOf(state, oid) * config.powerWeight +
    remaining * config.toughnessWeight +
    keywords +
    abilities
  );
}

/**
 * Baseline value of casting a card, before its targets are scored. Creatures are
 * valued as bodies; noncreature spells get a flat base and earn the rest of
 * their score from the targeting policy.
 */
export function printedCardValue(config: CastPolicyConfig, card: Card): number {
  if (card.kind === 'creature') return printedCreatureValue(config, card);
  if (card.kind === 'land') return 0;
  if (card.kind === 'artifact') {
    return config.spellBaseValue + cardManaValue(card) * 0.5 + printedAbilitiesValue(config, card);
  }
  return config.spellBaseValue;
}

/** Would `damage` from a source with `deathtouch` finish this creature off? */
export function isLethalDamage(
  state: GameState,
  oid: ObjectId,
  damage: number,
  deathtouch: boolean,
): boolean {
  if (damage <= 0) return false;
  if (deathtouch) return true;
  const object = tryObject(state, oid);
  if (object === undefined) return false;
  return object.damage + damage >= toughnessOf(state, oid);
}

/** Untapped creatures a player controls — the pool that can block next turn. */
export function untappedCreatures(state: GameState, player: PlayerId): readonly GameObject[] {
  return creaturesControlledBy(state, player).filter((object) => !object.tapped);
}

export function totalPower(state: GameState, oids: readonly ObjectId[]): number {
  let total = 0;
  for (const oid of oids) total += Math.max(0, powerOf(state, oid));
  return total;
}

/**
 * How much damage the opponent could swing for on their next turn, ignoring
 * summoning sickness (a conservative race estimate: it treats every untapped
 * body as a potential attacker).
 */
export function opponentThreat(state: GameState, me: PlayerId): number {
  const them = opponentOf(me);
  return totalPower(
    state,
    untappedCreatures(state, them).map((object) => object.oid),
  );
}

/** Combat outcome of a single attacker meeting a single blocker. */
export interface CombatExchange {
  readonly attackerDies: boolean;
  readonly blockerDies: boolean;
}

/**
 * Resolves one attacker against one blocker, respecting first strike and
 * deathtouch. First strike is decisive here: a first striker that kills its
 * blocker never takes damage back.
 */
export function resolveExchange(state: GameState, attacker: ObjectId, blocker: ObjectId): CombatExchange {
  const attackerPower = Math.max(0, powerOf(state, attacker));
  const blockerPower = Math.max(0, powerOf(state, blocker));
  const attackerDeathtouch = hasKeyword(state, attacker, 'deathtouch');
  const blockerDeathtouch = hasKeyword(state, blocker, 'deathtouch');
  const attackerFirst = hasKeyword(state, attacker, 'firstStrike');
  const blockerFirst = hasKeyword(state, blocker, 'firstStrike');

  const blockerDies = isLethalDamage(state, blocker, attackerPower, attackerDeathtouch);
  const attackerDies = isLethalDamage(state, attacker, blockerPower, blockerDeathtouch);

  if (attackerFirst && !blockerFirst && blockerDies) return { attackerDies: false, blockerDies: true };
  if (blockerFirst && !attackerFirst && attackerDies) return { attackerDies: true, blockerDies: false };
  return { attackerDies, blockerDies };
}

/** Convenience: the DSL card behind an object id. */
export function cardOf(state: GameState, oid: ObjectId): Card {
  return getObject(state, oid).card;
}
