/**
 * Attack policy: profitable attacks, lethal recognition, and race awareness.
 *
 * Four named heuristics, applied in order:
 *
 *  - `lethalSwing` — if the defender cannot block enough of the swing to
 *    survive it, attack with everything and ignore every other consideration.
 *    This is checked *through* blockers, not only against an empty board: a
 *    defender with one creature and three life dies to three attackers, and the
 *    previous version of this policy did not know that.
 *  - `attackValue` — evaluate each attacker against the defender's best block,
 *    but only against blocks the defender would actually make. An attack whose
 *    every block is a loss for the defender is worth its damage, not its
 *    worst-case exchange; scoring it as the exchange is how a policy talks
 *    itself out of a winning attack.
 *  - the race tolerance — while ahead on the clock (`assessRace`), accept
 *    `racingTradeLoss` more exchange loss than `acceptableTradeLoss` allows,
 *    because a won race is closed with damage rather than with value.
 *  - `holdBackBlockers` — keep bodies home only while we are *behind* on the
 *    clock, and only as many as survival actually needs, measured with
 *    `damageThroughBestBlocks` rather than counted one-per-attacker.
 *
 * The declaration is constructed rather than picked from `decision.options`:
 * the option list is a capped subset enumeration, and `validateAction` accepts
 * any legal declaration an agent builds itself. Legal includes CR 508.1d, which
 * none of the four heuristics knows about: a creature that attacks each combat
 * if able is not the policy's to hold back, however badly the attack scores, so
 * `withForcedAttackers` puts it back after they have all had their say.
 */
import type { AttackDeclaration, CombatDefender, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  counterCount,
  hasCombatModification,
  hasKeyword,
  NO_COUNTERS,
  opponentOf,
  powerOf,
} from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { boardCreatureValue, resolveExchange, untappedCreatures } from '../evaluate';
import { blockValue } from './block';
import { damageThroughBestBlocks, legalBlockersFor } from './combat';
import type { RaceAssessment } from './race';
import { assessRace } from './race';

export interface AttackContext {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly defender: PlayerId;
  readonly eligible: readonly ObjectId[];
  readonly blockers: readonly ObjectId[];
}

export function attackContext(state: GameState, me: PlayerId, eligible: readonly ObjectId[]): AttackContext {
  const defender = opponentOf(me);
  return {
    state,
    me,
    defender,
    eligible,
    blockers: untappedCreatures(state, defender).map((object) => object.oid),
  };
}

/**
 * Value of attacking with one creature, assuming the defender picks the block
 * that is worst for us *among the blocks they would take*.
 *
 * The filter is the substance. `blockValue` is the defender's own scoring
 * function, so asking it whether a block clears their threshold answers "would
 * they actually do this?" with the same arithmetic they will use when they are
 * asked for real. Blocks they would decline are not evidence against the
 * attack, and treating them as evidence is what freezes two similar boards.
 */
export function attackValue(context: AttackContext, attacker: ObjectId, config: GreedyBotConfig): number {
  const { state } = context;
  const power = Math.max(0, powerOf(state, attacker));
  const free = power * config.attack.unblockedDamageValue;
  const candidates = legalBlockersFor(state, attacker, context.blockers);
  if (candidates.length === 0) return free;

  const menace = hasKeyword(state, attacker, 'menace');
  if (menace && candidates.length < 2) return free;
  // A menace attacker costs the defender two bodies, so their bar is higher.
  const bar = config.block.minimumBlockValue + (menace ? config.block.menaceBlockPremium : 0);

  let worst = free;
  for (const blocker of candidates) {
    if (blockValue(state, attacker, blocker, config.cast, config.block) < bar) continue;
    const exchange = resolveExchange(state, attacker, blocker);
    const gain = exchange.blockerDies ? boardCreatureValue(config.cast, state, blocker) : 0;
    const loss = exchange.attackerDies ? boardCreatureValue(config.cast, state, attacker) : 0;
    // The defender commits a second body to a menace block; only one of them is
    // in the exchange above, so the other is credited at half value.
    const menaceOffset = menace ? boardCreatureValue(config.cast, state, blocker) * 0.5 : 0;
    const value = gain - loss + menaceOffset;
    if (value < worst) worst = value;
  }
  return worst;
}

/**
 * True when swinging with everything kills the defender through their best
 * blocks. `damageThroughBestBlocks` spends every one of their creatures where it
 * saves the most life, chump blocks included, so a `true` here means no legal
 * blocking assignment saves them.
 */
export function lethalSwing(context: AttackContext): boolean {
  const damage = damageThroughBestBlocks(context.state, context.eligible, context.blockers);
  return damage >= context.state.players[context.defender].life;
}

/** Damage the opponent's next swing puts on us if only `home` stays back to block. */
function incomingDamage(context: AttackContext, home: readonly ObjectId[]): number {
  return damageThroughBestBlocks(context.state, context.blockers, home);
}

/**
 * Race guard.
 *
 * Two conditions gate it now. The opponent's power still has to be large
 * relative to our life (`defensiveThreatRatio`, unchanged), *and* we have to be
 * behind on the clock — holding blockers home while ahead is how a winning board
 * turns into a turn-cap draw. When it does fire it gives up attacks cheapest
 * first, and stops the moment the creatures left at home are enough to survive
 * the return swing, rather than keeping one body per opposing creature whatever
 * their sizes.
 */
export function holdBackBlockers(
  context: AttackContext,
  attackers: readonly ObjectId[],
  config: GreedyBotConfig,
  assessment: RaceAssessment = assessRace(context.state, context.me, config.race),
): readonly ObjectId[] {
  const { state, me } = context;
  const life = state.players[me].life;
  const threat = assessment.theirPower;
  if (threat < life * config.attack.defensiveThreatRatio) return attackers;
  if (assessment.winning && !config.race.holdBackWhileWinning) return attackers;

  const attacking = new Set(attackers);
  const mine = untappedCreatures(state, me).map((object) => object.oid);
  const home = mine.filter((oid) => !attacking.has(oid));
  if (incomingDamage(context, home) < life) return attackers;

  // Give up the least valuable attacks first; vigilance attackers never count
  // against us because they stay untapped and block anyway.
  const ranked = [...attackers]
    .filter((oid) => !(config.attack.vigilanceAlwaysAttacks && hasKeyword(state, oid, 'vigilance')))
    .sort((a, b) => boardCreatureValue(config.cast, state, a) - boardCreatureValue(config.cast, state, b));

  const dropped = new Set<ObjectId>();
  for (const oid of ranked) {
    dropped.add(oid);
    home.push(oid);
    if (incomingDamage(context, home) < life) break;
  }
  return attackers.filter((oid) => !dropped.has(oid));
}

/**
 * CR 508.1d: the attacks the policy chose, plus the ones it does not get to
 * choose.
 *
 * `eligible` is the kernel's own list of creatures that *can* attack — untapped,
 * unsick or hasty, not a defender, not under `cantAttack` — so "if able" is
 * already settled by the time a policy sees the board, and the requirement
 * reduces to refusing the leave-it-home outcome for the creatures carrying it.
 * The result is rebuilt in `eligible` order rather than appended to, so the
 * declaration stays a function of the board and not of which heuristic dropped
 * a creature first.
 */
function withForcedAttackers(
  state: GameState,
  eligible: readonly ObjectId[],
  chosen: readonly ObjectId[],
): readonly ObjectId[] {
  const attacking = new Set(chosen);
  const compelled = (oid: ObjectId): boolean =>
    !attacking.has(oid) && hasCombatModification(state, oid, 'attacksEachCombatIfAble');
  if (!eligible.some(compelled)) return chosen;
  return eligible.filter((oid) => attacking.has(oid) || compelled(oid));
}

/**
 * The attack declaration to submit.
 *
 * Face remains the default. A walker is chosen only when the selected attackers'
 * visible power can remove it outright, with lowest loyalty and object id as
 * deterministic ties. This is deliberately a policy heuristic, not legality:
 * `defenders` comes from the kernel decision and the reducer checks the result.
 */
export function chooseAttackers(
  state: GameState,
  me: PlayerId,
  eligible: readonly ObjectId[],
  config: GreedyBotConfig,
  defenders: readonly CombatDefender[] = [opponentOf(me)],
): readonly AttackDeclaration[] {
  const context = attackContext(state, me, eligible);
  const declare = (
    oids: readonly ObjectId[],
    forcedDefender?: CombatDefender,
  ): readonly AttackDeclaration[] => {
    const power = oids.reduce((total, oid) => total + Math.max(0, powerOf(state, oid)), 0);
    const loyalty = (oid: ObjectId): number =>
      counterCount(state.objects[oid]?.counters ?? NO_COUNTERS, 'loyalty');
    const killableWalker = defenders
      .filter(
        (defender): defender is Extract<CombatDefender, { kind: 'planeswalker' }> =>
          typeof defender !== 'number' && loyalty(defender.oid) <= power,
      )
      .sort((left, right) => loyalty(left.oid) - loyalty(right.oid) || left.oid.localeCompare(right.oid))[0];
    const defender: CombatDefender = forcedDefender ?? killableWalker ?? context.defender;
    return oids.map((oid) => ({ oid, defender }));
  };

  if (config.attack.alwaysSwingForLethal && lethalSwing(context)) {
    return declare(eligible, context.defender);
  }

  const assessment = assessRace(state, me, config.race);
  const tolerance =
    config.attack.acceptableTradeLoss + (assessment.winning ? config.race.racingTradeLoss : 0);
  const profitable = eligible.filter((oid) => attackValue(context, oid, config) >= -tolerance);
  const chosen = holdBackBlockers(context, profitable, config, assessment);
  return declare(withForcedAttackers(state, eligible, chosen));
}
