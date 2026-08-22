/**
 * Combat arithmetic shared by the attack and block policies.
 *
 * Both sides of combat need the same two answers, and until now only the block
 * policy had them: how much damage one attacker still delivers to a player past
 * the creatures blocking it, and how much a whole attack delivers once the
 * defender has blocked as well as they can. The attack policy needs the second
 * one to recognize lethal through blockers, and the race guard needs it to work
 * out how many bodies actually have to stay home. Two copies of that arithmetic
 * would be two chances to disagree about trample.
 *
 * The blocking model here is deliberately the defender's *best* one — every
 * blocker is spent wherever it prevents the most damage, chump blocks included.
 * That is the right pessimism for an attacker deciding whether a swing is
 * lethal, and the right realism for a defender deciding whether they survive.
 */
import type { GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { canBlock, creaturesControlledBy, hasKeyword, lethalDamageFor, powerOf } from '@mtg/kernel';

/** Damage this attacker still deals to the defending player past its blockers. */
export function damageThrough(state: GameState, attacker: ObjectId, blockers: readonly ObjectId[]): number {
  const power = Math.max(0, powerOf(state, attacker));
  if (blockers.length === 0) return power;
  if (!hasKeyword(state, attacker, 'trample')) return 0;
  const deathtouch = hasKeyword(state, attacker, 'deathtouch');
  let assigned = 0;
  for (const blocker of blockers) assigned += lethalDamageFor(state, blocker, deathtouch);
  return Math.max(0, power - assigned);
}

/** Blockers that could legally be assigned to this attacker (evasion applied). */
export function legalBlockersFor(
  state: GameState,
  attacker: ObjectId,
  blockers: readonly ObjectId[],
): readonly ObjectId[] {
  return blockers.filter((blocker) => canBlock(state, blocker, attacker));
}

/** Blockers this attacker needs before a block is legal at all (menace is two). */
export function blockersNeeded(state: GameState, attacker: ObjectId, alreadyBlocking: number): number {
  if (alreadyBlocking > 0) return 1;
  return hasKeyword(state, attacker, 'menace') ? 2 : 1;
}

interface Assignment {
  readonly attacker: ObjectId;
  readonly blockers: readonly ObjectId[];
  readonly reduction: number;
}

/**
 * Total damage `attackers` deliver to the defending player once `blockers` have
 * been spent as well as they can be.
 *
 * Greedy over "damage prevented per assignment", repeated until no assignment
 * prevents anything: at every step it takes the block that saves the most life.
 * Ties resolve by declaration order, so the result is a pure function of the
 * state and the two lists — which is what keeps a seeded sweep reproducible.
 *
 * Against a trampler the blockers with the most toughness absorb the most, so
 * they are offered first; against everything else any legal body stops the whole
 * attacker and the choice does not matter to the damage total.
 */
export function damageThroughBestBlocks(
  state: GameState,
  attackers: readonly ObjectId[],
  blockers: readonly ObjectId[],
): number {
  const assigned = new Map<ObjectId, ObjectId[]>();
  const spare = [...blockers];

  for (;;) {
    let best: Assignment | null = null;
    for (const attacker of attackers) {
      const current = assigned.get(attacker) ?? [];
      const before = damageThrough(state, attacker, current);
      if (before <= 0) continue;
      const usable = [...legalBlockersFor(state, attacker, spare)].sort(
        (a, b) => absorbency(state, attacker, b) - absorbency(state, attacker, a),
      );
      const needed = blockersNeeded(state, attacker, current.length);
      if (usable.length < needed) continue;
      const picked = usable.slice(0, needed);
      const reduction = before - damageThrough(state, attacker, [...current, ...picked]);
      if (reduction <= 0) continue;
      if (best === null || reduction > best.reduction) {
        best = { attacker, blockers: picked, reduction };
      }
    }
    if (best === null) break;
    assigned.set(best.attacker, [...(assigned.get(best.attacker) ?? []), ...best.blockers]);
    for (const blocker of best.blockers) {
      const index = spare.indexOf(blocker);
      if (index >= 0) spare.splice(index, 1);
    }
  }

  let total = 0;
  for (const attacker of attackers) total += damageThrough(state, attacker, assigned.get(attacker) ?? []);
  return total;
}

/** How much of this attacker's damage the blocker soaks up before trample spills. */
function absorbency(state: GameState, attacker: ObjectId, blocker: ObjectId): number {
  return lethalDamageFor(state, blocker, hasKeyword(state, attacker, 'deathtouch'));
}

/** Is this creature currently declared as an attacker? */
export function isAttacking(state: GameState, oid: ObjectId): boolean {
  return state.combat.attacks.some((attack) => attack.oid === oid);
}

/**
 * Creatures that can put damage on a player next combat: everything untapped,
 * plus anything already attacking (tapped now, but it untaps before it swings
 * again). Ignoring the attackers is what makes a naive threat count read a
 * player who is being attacked right now as facing no threat at all, which is
 * exactly the position the block policy has to judge.
 */
export function attackCapableCreatures(state: GameState, player: PlayerId): readonly ObjectId[] {
  return creaturesControlledBy(state, player)
    .filter((object) => !object.tapped || isAttacking(state, object.oid))
    .map((object) => object.oid);
}
