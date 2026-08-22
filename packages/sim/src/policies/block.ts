/**
 * Block policy: survive, trade up, chump when lethal — priced against the race.
 *
 * Two passes over the attackers, biggest threat first:
 *
 *  1. `profitableBlocks` — take every block whose exchange (creature killed,
 *     creature lost, damage absorbed) clears the threshold. Menace attackers
 *     cost two bodies, so they must clear an extra premium.
 *  2. `chumpBlocks` — if the damage still coming through would kill us, throw
 *     bodies in front of the biggest attackers, cheapest creature first, until
 *     we survive or run out. Trample is accounted for: chumping a trampler only
 *     prevents damage up to the blocker's lethal requirement.
 *
 * The threshold is where the race enters. Blocking is not free even when the
 * exchange is even, because a creature that dies blocking is a creature that
 * does not attack next turn — so while we are ahead on the clock the bar rises
 * by `racingBlockPremium`, and while we are behind it drops by
 * `losingBlockDiscount`, because behind on the clock a slightly bad trade buys
 * the turn we need. Taking damage we can afford is a decision, not an oversight.
 *
 * Like the attack policy, the declaration is constructed rather than picked out
 * of the capped enumeration, and `validateAction` re-checks it. One of those
 * re-checks is a requirement rather than a restriction and so cannot be
 * satisfied by declining to block: CR 509.1c makes a lure's controller, not the
 * defender, decide that it is blocked. Every pass here prices blocks the
 * defender would *choose*, which is exactly the wrong question for a lure, so
 * the finished declaration goes through the kernel's `satisfyMustBeBlocked`
 * before it is submitted. The set's first three must-be-blocked creatures
 * turned that gap from theoretical into a thrown `IllegalActionError` in the
 * middle of a balance run.
 */
import type { BlockDeclaration, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { canBlock, hasKeyword, powerOf, satisfyMustBeBlocked } from '@mtg/kernel';
import type { BlockPolicyConfig, CastPolicyConfig, GreedyBotConfig, RacePolicyConfig } from '../config';
import { boardCreatureValue, resolveExchange } from '../evaluate';
import { damageThrough } from './combat';
import { assessRace } from './race';

interface BlockCandidate {
  readonly blocker: ObjectId;
  readonly value: number;
}

/**
 * Exchange value of one blocker against one attacker, from the defender's side.
 *
 * Exported because the attack policy asks it, verbatim, whether the defender
 * would take a given block. One scoring function means the attacker's model of
 * the defender cannot drift away from what the defender actually does.
 */
export function blockValue(
  state: GameState,
  attacker: ObjectId,
  blocker: ObjectId,
  cast: CastPolicyConfig,
  config: BlockPolicyConfig,
): number {
  const exchange = resolveExchange(state, attacker, blocker);
  const gain = exchange.attackerDies ? boardCreatureValue(cast, state, attacker) : 0;
  const loss = exchange.blockerDies ? boardCreatureValue(cast, state, blocker) : 0;
  const absorbed = Math.max(0, powerOf(state, attacker)) - damageThrough(state, attacker, [blocker]);
  return gain - loss + absorbed * config.absorbDamageWeight;
}

function sortedByThreat(state: GameState, attackers: readonly ObjectId[]): readonly ObjectId[] {
  return [...attackers].sort((a, b) => powerOf(state, b) - powerOf(state, a));
}

function bestCandidate(
  state: GameState,
  attacker: ObjectId,
  available: readonly ObjectId[],
  cast: CastPolicyConfig,
  config: BlockPolicyConfig,
): BlockCandidate | null {
  let best: BlockCandidate | null = null;
  for (const blocker of available) {
    if (!canBlock(state, blocker, attacker)) continue;
    const value = blockValue(state, attacker, blocker, cast, config);
    if (best === null || value > best.value) best = { blocker, value };
  }
  return best;
}

/**
 * The bar a voluntary block has to clear, given where the race stands. Never
 * negative: a block that loses more than it gains and prevents nothing is still
 * not worth making, however far behind we are.
 */
export function blockThreshold(
  state: GameState,
  me: PlayerId,
  config: BlockPolicyConfig,
  race: RacePolicyConfig,
): number {
  const assessment = assessRace(state, me, race);
  let threshold = config.minimumBlockValue;
  if (assessment.winning) threshold += race.racingBlockPremium;
  if (assessment.losing) threshold -= race.losingBlockDiscount;
  return threshold;
}

/** The block declaration to submit. */
export function chooseBlocks(
  state: GameState,
  me: PlayerId,
  attackers: readonly ObjectId[],
  eligible: readonly ObjectId[],
  config: GreedyBotConfig,
): readonly BlockDeclaration[] {
  const cast = config.cast;
  const block = config.block;
  const minimum = blockThreshold(state, me, block, config.race);
  const available = [...eligible];
  const assignments = new Map<ObjectId, ObjectId[]>();
  const take = (attacker: ObjectId, blocker: ObjectId): void => {
    const existing = assignments.get(attacker);
    if (existing === undefined) assignments.set(attacker, [blocker]);
    else existing.push(blocker);
    const index = available.indexOf(blocker);
    if (index >= 0) available.splice(index, 1);
  };

  const ordered = sortedByThreat(state, attackers);

  for (const attacker of ordered) {
    if (available.length === 0) break;
    const menace = hasKeyword(state, attacker, 'menace');
    const first = bestCandidate(state, attacker, available, cast, block);
    if (first === null) continue;
    if (!menace) {
      if (first.value >= minimum) take(attacker, first.blocker);
      continue;
    }
    const rest = available.filter((oid) => oid !== first.blocker);
    const second = bestCandidate(state, attacker, rest, cast, block);
    if (second === null) continue;
    if (first.value + second.value >= minimum + block.menaceBlockPremium) {
      take(attacker, first.blocker);
      take(attacker, second.blocker);
    }
  }

  if (block.chumpWhenLethal) {
    for (const chump of chumpBlocks(state, me, ordered, available, assignments, cast)) {
      take(chump.attacker, chump.blocker);
    }
  }

  const declaration: BlockDeclaration[] = [];
  for (const [attacker, blockers] of assignments) {
    for (const blocker of blockers) declaration.push({ blocker, attacker });
  }
  return satisfyMustBeBlocked(state, declaration);
}

function incomingDamage(
  state: GameState,
  attackers: readonly ObjectId[],
  assignments: ReadonlyMap<ObjectId, readonly ObjectId[]>,
): number {
  let total = 0;
  for (const attacker of attackers) {
    total += damageThrough(state, attacker, assignments.get(attacker) ?? []);
  }
  return total;
}

interface ChumpAssignment {
  readonly attacker: ObjectId;
  readonly blocker: ObjectId;
}

/**
 * Last-ditch pass: while the unblocked damage is lethal, throw the cheapest
 * remaining creature in front of whichever attacker that prevents the most
 * damage. Menace attackers need two bodies, so they are only chumped when two
 * are spare, and trample is priced in — a 1/1 in front of a 6/6 trampler
 * prevents one point, not six.
 *
 * The whole pass is speculative and is thrown away unless it actually gets us
 * under lethal: spending creatures on a swing that kills us anyway is strictly
 * worse than taking the damage.
 */
function chumpBlocks(
  state: GameState,
  me: PlayerId,
  ordered: readonly ObjectId[],
  available: readonly ObjectId[],
  assignments: ReadonlyMap<ObjectId, readonly ObjectId[]>,
  cast: CastPolicyConfig,
): readonly ChumpAssignment[] {
  const life = state.players[me].life;
  const tentative = new Map<ObjectId, ObjectId[]>();
  for (const [attacker, blockers] of assignments) tentative.set(attacker, [...blockers]);
  const spare = [...available].sort(
    (a, b) => boardCreatureValue(cast, state, a) - boardCreatureValue(cast, state, b),
  );
  const chosen: ChumpAssignment[] = [];

  while (spare.length > 0 && incomingDamage(state, ordered, tentative) >= life) {
    let best: { attacker: ObjectId; blockers: readonly ObjectId[]; reduction: number } | null = null;
    for (const attacker of ordered) {
      const current = tentative.get(attacker) ?? [];
      const before = damageThrough(state, attacker, current);
      if (before <= 0) continue;
      const usable = spare.filter((oid) => canBlock(state, oid, attacker));
      const needed = hasKeyword(state, attacker, 'menace') && current.length === 0 ? 2 : 1;
      if (usable.length < needed) continue;
      const blockers = usable.slice(0, needed);
      const reduction = before - damageThrough(state, attacker, [...current, ...blockers]);
      if (reduction <= 0) continue;
      if (best === null || reduction > best.reduction) best = { attacker, blockers, reduction };
    }
    if (best === null) break;
    const updated = [...(tentative.get(best.attacker) ?? []), ...best.blockers];
    tentative.set(best.attacker, updated);
    for (const blocker of best.blockers) {
      chosen.push({ attacker: best.attacker, blocker });
      const index = spare.indexOf(blocker);
      if (index >= 0) spare.splice(index, 1);
    }
  }

  return incomingDamage(state, ordered, tentative) < life ? chosen : [];
}
