/**
 * Activation policy: which printed ability to pay for, at what, and whether to
 * pay for it at all.
 *
 * The kernel has already enumerated every activation this seat could pay for,
 * with every legal target tuple, exactly as it enumerates casts — so this
 * policy never has to know what is legal, only what is good. That is the same
 * division `chooseCast` works under, and it is why an ability's targets are
 * scored by the same `effectScore` switch a spell's are: a bot that valued the
 * damage from an ability differently from the damage from a bolt would be two
 * heuristics wearing one name.
 *
 * An equip ability is the one activation whose value is not in its effect list,
 * because CR 702.6b prints none: `attachmentValue` below is what it is scored
 * on instead, and it is the same scale a printed static's modification is
 * scored on rather than a second one.
 *
 * Risk 3 of `docs/design/dsl-v1-ability-model.md` is what this file answers. A
 * balance run over a set whose mechanic the bots never use reports healthy
 * numbers for a format nobody has played, and the way that happens is not a bug
 * in the kernel — it is an enumerated action nothing scores.
 */
import type { AttachingAbility } from '@mtg/dsl';
import { isAttachingAbility, manaValue } from '@mtg/dsl';
import type { Action, AgentView, GameState, ObjectId } from '@mtg/kernel';
import {
  activatedAbilityAt,
  attachmentOf,
  creaturesControlledBy,
  opponentOf,
  powerOf,
  toughnessOf,
  tryObject,
} from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { modificationValue, modificationValueOn } from '../evaluate';
import { blockersNeeded, legalBlockersFor } from './combat';
import { scoreEffectTargets } from './target';

type ActivateAction = Extract<Action, { type: 'activateAbility' }>;

/**
 * The toughness this clause is worth to whatever it is attached to.
 *
 * Only `statBonus` moves toughness in a clause this can be handed:
 * `grantKeyword` is layer 6, and `checkEquipAbility` refuses `definePt`
 * outright (a CDA sets its *source's* power and toughness, and an equipped
 * creature is not the source). So the delta is a sum over the clause and needs
 * no layer walk of its own.
 */
function clauseToughness(ability: AttachingAbility): number {
  return ability.attach.modifications.reduce(
    (sum, modification) => sum + (modification.kind === 'statBonus' ? modification.toughness : 0),
    0,
  );
}

/**
 * Would this creature's toughness moving by `delta` put it in the graveyard?
 *
 * Two conditions take a creature off the battlefield and the layer system
 * answers neither on its own: a toughness of 0 or less (CR 704.5e) and damage
 * marked at or above the toughness (CR 704.5f). The one expression covers both,
 * because damage is never negative — it is `pumpScore`'s in
 * `policies/target.ts`, which asks the same question of a negative-toughness
 * pump, and asking it a second way here would let the bot decline the spell and
 * pay for the equip that does the same thing.
 *
 * One function for both directions of an equip. `toughnessOf` reads through the
 * layer system, so a prospective host does not have the clause yet and a
 * current one already does: attaching is `+clauseToughness`, moving away is
 * `-clauseToughness`, and the arithmetic in between is the same rule.
 */
function diesAtToughnessDelta(state: GameState, oid: ObjectId, delta: number): boolean {
  const object = tryObject(state, oid);
  if (object === undefined) return false;
  return toughnessOf(state, oid) + delta - object.damage <= 0;
}

/**
 * What a creature is worth *carrying* this clause, as a multiple of what the
 * clause says.
 *
 * The printed modification is the same two points of power on every body on the
 * board, so with nothing else to say the bot armed whichever creature the kernel
 * enumerated first, and enumeration is battlefield order, which is arrival
 * order. This is the term that breaks that tie on something: whether the
 * defending board can block the host at all, and if it can, whether the host
 * lives through its best blocker (`mtg-oc5a`).
 *
 * A multiplier and not an added constant, and applied to both sides of a move.
 * An added `bodyWeight x boardCreatureValue(host)` would clear
 * `activate.minimumValue` on the constant alone, so the bot would pay mana to
 * equip a clause worth nothing to the creature it landed on — a keyword it
 * already has, at a cost. Multiplying keeps a worthless clause worthless on
 * every body. Applying it to the loss term as well is what keeps a move between
 * two equal hosts at exactly zero, which is the free-move guard `attachmentValue`
 * is built around.
 *
 * `attachedNow` says which side is being priced, because `toughnessOf` reads
 * through the layer system: the current host's toughness already contains the
 * clause and a prospective host's does not.
 *
 * Two stated limits. It reads the host as an attacker, so a weapon bought to
 * hold a ground stall is priced on a combat the bot is not planning; and it
 * prices the block the defending board can make *now*, not after the defender
 * untaps. Both are the same trade `attackCapableCreatures` makes one file over:
 * a bot that solved the real question would be a search, not a policy.
 */
function hostQuality(
  state: GameState,
  config: GreedyBotConfig,
  ability: AttachingAbility,
  host: ObjectId,
  attachedNow: boolean,
): number {
  const { hostUnblockedMultiplier, hostSurvivesMultiplier, hostTradesMultiplier } = config.activate;
  const object = tryObject(state, host);
  if (object === undefined) return hostTradesMultiplier;
  const defenders = creaturesControlledBy(state, opponentOf(object.controller)).map(({ oid }) => oid);
  const blockers = legalBlockersFor(state, host, defenders);
  if (blockers.length < blockersNeeded(state, host, 0)) return hostUnblockedMultiplier;
  const toughness = toughnessOf(state, host) + (attachedNow ? 0 : clauseToughness(ability)) - object.damage;
  const biggest = blockers.reduce((most, blocker) => Math.max(most, powerOf(state, blocker)), 0);
  return toughness > biggest ? hostSurvivesMultiplier : hostTradesMultiplier;
}

/**
 * What paying for this equip would change on the board (CR 702.6b).
 *
 * The effect list an equip ability prints is empty — the attach clause replaces
 * it — so the score every other activation gets from its targets is zero here,
 * and a weapon is declined at every board for as long as the game lasts. What
 * it is worth instead is what being attached does to the creature chosen,
 * measured on the same scale a printed static's modification is measured on
 * (`modificationValue`).
 *
 * Two terms, because an equip is a *move* as often as it is a pickup:
 *
 *  - the host gains what the clause grants it, read off the board, so a keyword
 *    it already has is worth nothing and the bot arms the creature that gains
 *    something;
 *  - the creature it is currently attached to loses that same clause, read off
 *    the printed modification rather than off the board. Asking the board there
 *    would read this weapon's own grant back as a keyword the old host already
 *    has, price the loss at zero, and buy a free move that changes nothing —
 *    which the bot would then pay for again next turn, and every turn after.
 *
 * Both terms are scaled by `hostQuality`, which is the only thing on this page
 * that distinguishes one legal host from another. The net is therefore zero for
 * a move between two creatures the clause is worth the same on, so a weapon is
 * picked up once and stays where it is, and positive only when the new body is
 * a better place for it than the old one — which is the whole of the move
 * behavior, and the reason the two lethality checks above have to be checks
 * rather than terms. Re-equipping the
 * creature it is already on is answered before either term, because the two
 * would disagree about it: nothing changes on that board, and the loss term
 * would price a bonus the creature keeps.
 *
 * Both terms are refused outright when the move would kill a creature we
 * control, in either direction, because neither of them can see that:
 *
 *  - the clause kills the creature it lands on. A `+6/-3` is six power less
 *    three toughness on every scale this file has, positive whatever the host
 *    is, so the bot armed a 2/2 with it and a state-based action took the
 *    creature before priority came back — every turn it had the mana, and at
 *    healthy numbers in the balance gate;
 *  - the clause leaving kills the creature it is on now. A weapon granting
 *    toughness is the only thing keeping some hosts alive, and the loss term
 *    prices it from the printed modification, which cannot tell a creature that
 *    shrugs the move off from one that dies to it (`mtg-nvte`).
 *
 * That second check is the one board read on the loss side, and it is
 * deliberately about lethality alone. Reading the board for the clause's
 * *value* there is the free-move bug the term above exists to avoid; asking
 * whether the creature survives is a different question, and it has no answer
 * in the print.
 *
 * Both are priced at `target.ownGoalPenalty`, which is what `pumpScore` charges
 * for the same clause arriving as a spell.
 */
function attachmentValue(
  state: GameState,
  config: GreedyBotConfig,
  ability: AttachingAbility,
  option: ActivateAction,
): number {
  const target = option.targets[0];
  if (target === undefined || target === null || target.kind !== 'permanent') return 0;
  const current = attachmentOf(state, option.oid);
  if (current === target.oid) return 0;
  const toughness = clauseToughness(ability);
  if (diesAtToughnessDelta(state, target.oid, toughness)) return -config.target.ownGoalPenalty;
  if (current !== undefined && diesAtToughnessDelta(state, current, -toughness)) {
    return -config.target.ownGoalPenalty;
  }
  // Both terms sum over the clause, because a move carries every modification
  // on it at once: the new host gains all of them and the old host loses all of
  // them, so pricing one would buy a move on the strength of half the weapon.
  const modifications = ability.attach.modifications;
  const gained =
    modifications.reduce(
      (sum, modification) => sum + modificationValueOn(config.cast, state, target.oid, modification),
      0,
    ) * hostQuality(state, config, ability, target.oid, false);
  const lost =
    current === undefined
      ? 0
      : modifications.reduce((sum, modification) => sum + modificationValue(config.cast, modification), 0) *
        hostQuality(state, config, ability, current, true);
  return gained - lost;
}

function activationValue(view: AgentView, config: GreedyBotConfig, option: ActivateAction): number | null {
  const state = view.state;
  const ability = activatedAbilityAt(state, option.oid, option.abilityIndex);
  if (ability === undefined) return null;
  const payload = isAttachingAbility(ability)
    ? attachmentValue(state, config, ability, option)
    : scoreEffectTargets(
        state,
        view.player,
        ability.effects,
        option.targets,
        config.cast,
        config.target,
        config.race,
      );
  return payload - manaValue(ability.cost.mana) * config.activate.manaValueWeight;
}

/**
 * The activation to make right now, or `null` when nothing on the board is
 * worth its cost.
 *
 * Ties go to enumeration order, which is battlefield order then ability index
 * then target order, so the bot is deterministic at a seed the way every other
 * policy here is.
 */
export function chooseActivation(view: AgentView, config: GreedyBotConfig): ActivateAction | null {
  let best: ActivateAction | null = null;
  let bestValue = 0;
  for (const option of view.decision.options) {
    if (option.type !== 'activateAbility') continue;
    const value = activationValue(view, config, option);
    if (value === null || value < config.activate.minimumValue) continue;
    if (best === null || value > bestValue) {
      best = option;
      bestValue = value;
    }
  }
  return best;
}
