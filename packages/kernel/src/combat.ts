/**
 * Combat: legality of attacks and blocks, and the damage steps.
 *
 * Every evergreen keyword in the pinned vocabulary lands here:
 *
 *  - vigilance  — attacking does not tap (CR 702.20b)
 *  - haste      — ignores summoning sickness when attacking (CR 702.10b)
 *  - flying     — blockable only by flying or reach (CR 702.9b)
 *  - reach      — may block flyers (CR 702.17b)
 *  - menace     — must be blocked by two or more creatures (CR 702.110b)
 *  - firstStrike— damage in its own earlier step (CR 510.4)
 *  - deathtouch — any nonzero damage counts as lethal, both for the
 *                 state-based kill and for lethal-damage assignment (CR 702.2b/c)
 *  - trample    — excess over lethal assignment goes to the player (CR 702.19b)
 *  - lifelink   — damage also gains that much life (CR 702.15b)
 *
 * And one `KeywordAbility` kind, which lands here for the same reason the
 * evergreen nine do rather than because it is spelled differently:
 *
 *  - doubleStrike — damage in the first-strike step *and* the regular one
 *                   (CR 702.4b). `vocabulary.ts` says why it is a keyword
 *                   ability rather than a tenth entry in `KEYWORDS`.
 */
import type { CombatModification, Condition, Keyword, StaticAbility } from '@mtg/dsl';
import { assertNever, isCombatStaticModification } from '@mtg/dsl';
import { counterCount } from './continuous';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import {
  controllerOf,
  hasCardType,
  hasKeyword,
  hasKeywordAbility,
  hasSubtype,
  isCreatureObject,
  keywordAbilitiesOf,
  powerOf,
  toughnessOf,
} from './layers';
import type { Attack, Block, CombatDefender, GameState, TurnCombatRule } from './state';
import type { Trace } from './trace';
import { emit, withState } from './trace';
import type { DamageInstance } from './damage';
import { applyDamage } from './damage';
import { creaturesControlledBy, getObject, isOnBattlefield, landsControlledBy, tapObject } from './zones';
import { hasAuraModification } from './attach';
import { isProtectedFrom } from './keyword-abilities';

/**
 * Whether one static ability's `enabledWhile` (CR 611.2c) currently holds.
 *
 * Reimplements `characteristics.ts`'s `conditionHolds` over `layers.ts`'s live
 * accessors instead of a `LayerContext`: that context is a full computed
 * characteristic map built once per layer walk, and a combat-legality query
 * runs far more often than a layer-walk recompute — once per candidate
 * attacker or blocker the declaration enumerator considers — and needs
 * nothing from the map beyond `controllerOf`, `hasSubtype`, `isCreatureObject`
 * and a raw counter read, all of which are already live lookups over `state`.
 *
 * Real `switch`/`assertNever` dispatch, mirroring `conditionHolds`
 * (`characteristics.ts`) for the identical reason argued there and in
 * `condition.ts`: `Condition` is a genuine two-member union as of `mtg-jp23`,
 * so a `switch` that omits a case fails to compile rather than silently
 * misreading the new member's fields.
 */
function combatConditionHolds(state: GameState, condition: Condition, source: ObjectId): boolean {
  switch (condition.kind) {
    case 'controlsSubtype': {
      const controller = controllerOf(state, source);
      let count = 0;
      for (const oid of state.battlefield) {
        if (controllerOf(state, oid) !== controller) continue;
        if (!hasSubtype(state, oid, condition.subtype)) continue;
        count += 1;
      }
      return count >= condition.atLeast;
    }
    case 'anyCreatureHasCounter':
      return state.battlefield.some(
        (oid) =>
          isCreatureObject(state, oid) && counterCount(getObject(state, oid).counters, condition.counter) > 0,
      );
    case 'opponentGraveyardAtLeast':
      return state.players[opponentOf(controllerOf(state, source))].graveyard.length >= condition.atLeast;
    case 'lifeAtLeast':
      return state.players[controllerOf(state, source)].life >= condition.atLeast;
    // Bloodcrazed Goblin's clause, and the one arm in this switch that is
    // load-bearing here rather than in `conditionHolds`: a `cantAttack`
    // restriction is answered by this file and never reaches the layer walk.
    case 'noOpponentDealtDamageThisTurn':
      return !state.turn.damagedPlayers.includes(opponentOf(controllerOf(state, source)));
    default:
      return assertNever(condition, 'combatConditionHolds');
  }
}

/**
 * Whether a static ability's `enabledWhile`, if it has one, currently holds.
 * `true` for an unconditional static, matching `affectedByEffect`'s
 * (`characteristics.ts`) treatment of an absent condition.
 */
function staticIsEnabled(state: GameState, ability: StaticAbility, source: ObjectId): boolean {
  const condition = ability.enabledWhile ?? null;
  return condition === null || combatConditionHolds(state, condition, source);
}

/**
 * Whether `target` falls within a static ability's scope, mirroring
 * `abilities.ts`'s `staticFilterFor` as a direct predicate rather than an
 * `ObjectFilter` the layer walk evaluates.
 *
 * A second spelling rather than a call into `staticFilterFor` (unexported,
 * and returns data for the layer walk to evaluate rather than an answer) or
 * the `ObjectFilter`/layer-walk machinery generally: this query runs once per
 * candidate creature per combat-legality question, a hot path `staticFilterFor`
 * was never asked to serve, and it only ever needs `cardTypes`,
 * `controllerIsSource`, `subtypes` and `excludeOids` for these three scopes —
 * little enough to restate as a switch without pulling `continuous.ts`'s
 * evaluator in for it.
 */
function matchesStaticScope(
  state: GameState,
  ability: StaticAbility,
  source: ObjectId,
  target: ObjectId,
): boolean {
  if (ability.subtype !== null && !hasSubtype(state, target, ability.subtype)) return false;
  switch (ability.scope) {
    case 'self':
      return target === source;
    case 'creaturesYouControl':
      return (
        hasCardType(state, target, 'creature') && controllerOf(state, target) === controllerOf(state, source)
      );
    case 'otherCreaturesYouControl':
      return (
        target !== source &&
        hasCardType(state, target, 'creature') &&
        controllerOf(state, target) === controllerOf(state, source)
      );
    default:
      return assertNever(ability.scope, 'matchesStaticScope');
  }
}

/**
 * Whether some static ability printed on any battlefield permanent currently
 * imposes `kind` on `target` — the general form of `attach.ts`'s
 * `hasAuraModification`, over printed statics rather than the attachment
 * relation.
 *
 * `mtg-t3ik` added this alongside the existing query rather than folding the
 * two together: an Aura's restriction is relative to what it is attached to
 * (`source.attachedTo === host`), a plain static's is relative to its own
 * printed scope (`matchesStaticScope`), and the two live queries read
 * different fields off a different kind of source. Both stay live rather than
 * registered, for `hasAuraModification`'s reason: `attachAuraTo` (`attach.ts`)
 * and `registerStatics` (`abilities.ts`) already fall through with no
 * `ContinuousEffect` for these six kinds, because none of them changes a
 * printed characteristic — there is nothing for a layer to hold.
 */
export function hasCombatModification(
  state: GameState,
  target: ObjectId,
  kind: CombatModification['kind'],
): boolean {
  return state.battlefield.some((source) => {
    const object = state.objects[source];
    if (object === undefined) return false;
    return object.card.abilities.some((ability) => {
      if (ability.kind !== 'static') return false;
      if (!isCombatStaticModification(ability.modification)) return false;
      if (ability.modification.kind !== kind) return false;
      if (!staticIsEnabled(state, ability, source)) return false;
      return matchesStaticScope(state, ability, source, target);
    });
  });
}

/**
 * Whether a turn-scoped CR 508/509 rule of `rule` is currently imposed on
 * `subject` (`state.turnCombatRules`, `state.ts`).
 *
 * The read side of the third parallel array, and deliberately the same shape
 * as `hasCombatModification` so a caller in `legal.ts` or `canBlock` asks one
 * question of both. The difference is where the answer comes from: the static
 * query re-reads printed abilities off the battlefield, this one reads a
 * record written when an effect resolved. A permanent's printed static outlives
 * the turn; this does not.
 */
export function hasTurnCombatRule(
  state: GameState,
  subject: ObjectId,
  rule: TurnCombatRule['rule'],
): boolean {
  return state.turnCombatRules.some((imposed) => imposed.subject === subject && imposed.rule === rule);
}

/**
 * The players a turn-scoped `attacksYouThisTurnIfAble` on `subject` names as
 * acceptable defenders.
 *
 * A list rather than one player because two Sirens under different controllers
 * can lure the same creature in one turn. CR 508.1d then asks only that the
 * declaration satisfy the maximum number of requirements it can, and a single
 * attack satisfies whichever requirement names the player it attacked; the
 * creature cannot attack two players at once, so the list is what a legality
 * check intersects against rather than a set it must cover.
 *
 * Empty means no such rule is on `subject`. It does not mean the requirement is
 * satisfiable: a named player who is not a legal defender of the attack being
 * declared is CR 508.1a's unobeyable requirement, and `legal.ts` is where that
 * collapses back to no requirement at all.
 */
export function luredDefenders(state: GameState, subject: ObjectId): readonly PlayerId[] {
  const players: PlayerId[] = [];
  for (const imposed of state.turnCombatRules) {
    if (imposed.subject !== subject) continue;
    if (imposed.rule !== 'attacksYouThisTurnIfAble') continue;
    if (!players.includes(imposed.defender)) players.push(imposed.defender);
  }
  return players;
}

/**
 * Every keyword a `blockOnlyCreaturesWithKeyword` static (CR 509.1b) requires
 * `blocker` to see in an attacker, from every source whose scope covers it.
 *
 * Plural rather than one winning restriction, because CR 509.1b's combined
 * restrictions AND: a blocker under two such statics at once must satisfy
 * both named keywords, not either — `card.ts`'s `AuraCombatModificationSchema`
 * docblock (and this ability's own on `ability-shape.ts`) state the same rule
 * for the reason it generalizes here.
 */
function requiredBlockKeywords(state: GameState, blocker: ObjectId): readonly Keyword[] {
  const keywords: Keyword[] = [];
  for (const source of state.battlefield) {
    const object = state.objects[source];
    if (object === undefined) continue;
    for (const ability of object.card.abilities) {
      if (ability.kind !== 'static') continue;
      if (ability.modification.kind !== 'blockOnlyCreaturesWithKeyword') continue;
      if (!staticIsEnabled(state, ability, source)) continue;
      if (!matchesStaticScope(state, ability, source, blocker)) continue;
      keywords.push(ability.modification.keyword);
    }
  }
  return keywords;
}

/**
 * Every creature subtype a `cantBeBlockedBySubtype` static (CR 509.1b) forbids
 * from blocking `attacker`, from every source whose scope covers it.
 *
 * `requiredBlockKeywords`'s mirror, and the mirroring is exact except for which
 * end of the block the scope names: that one walks the statics that reach the
 * *blocker* and collects what the attacker must have, this one walks the statics
 * that reach the *attacker* and collects what the blocker must not be.
 *
 * Plural for the same reason and under the same rule. CR 509.1b asks that no
 * restriction be disobeyed, so a Juggernaut printing two of these forbids the
 * union of the subtypes they name rather than whichever the reader hit first.
 * The union here against the intersection there is not two rules: one member
 * states a permission and this one states a prohibition, and complementing a
 * permission is what turns an AND over restrictions into a union of what they
 * exclude.
 */
function blockedBySubtypes(state: GameState, attacker: ObjectId): readonly string[] {
  const subtypes: string[] = [];
  for (const source of state.battlefield) {
    const object = state.objects[source];
    if (object === undefined) continue;
    for (const ability of object.card.abilities) {
      if (ability.kind !== 'static') continue;
      if (ability.modification.kind !== 'cantBeBlockedBySubtype') continue;
      if (!staticIsEnabled(state, ability, source)) continue;
      if (!matchesStaticScope(state, ability, source, attacker)) continue;
      subtypes.push(ability.modification.subtype);
    }
  }
  return subtypes;
}

/** The opposing player and each planeswalker they currently control. */
export function combatDefenders(state: GameState, attacker: PlayerId): readonly CombatDefender[] {
  const opponent = opponentOf(attacker);
  const walkers = state.battlefield
    .filter((oid) => controllerOf(state, oid) === opponent)
    .filter((oid) => hasCardType(state, oid, 'planeswalker'))
    .map((oid): CombatDefender => ({ kind: 'planeswalker', oid }));
  return [opponent, ...walkers];
}

export function isLegalCombatDefender(
  state: GameState,
  attacker: PlayerId,
  defender: CombatDefender,
): boolean {
  if (typeof defender === 'number') return defender === opponentOf(attacker);
  return (
    isOnBattlefield(state, defender.oid) &&
    controllerOf(state, defender.oid) === opponentOf(attacker) &&
    hasCardType(state, defender.oid, 'planeswalker')
  );
}

/** Creatures the active player could legally declare as attackers. */
export function eligibleAttackers(state: GameState): readonly ObjectId[] {
  const active = state.turn.active;
  return creaturesControlledBy(state, active)
    .filter((object) => !object.tapped)
    .filter((object) => !object.summoningSick || hasKeyword(state, object.oid, 'haste'))
    .filter((object) => !hasKeywordAbility(state, object.oid, 'defender'))
    .filter((object) => !hasAuraModification(state, object.oid, 'cantAttack'))
    .filter((object) => !hasCombatModification(state, object.oid, 'cantAttack'))
    .map((object) => object.oid);
}

/** Creatures the defending player could legally declare as blockers. */
export function eligibleBlockers(state: GameState): readonly ObjectId[] {
  const defender = opponentOf(state.turn.active);
  return creaturesControlledBy(state, defender)
    .filter((object) => !object.tapped)
    .filter((object) => !hasAuraModification(state, object.oid, 'cantBlock'))
    .filter((object) => !hasCombatModification(state, object.oid, 'cantBlock'))
    .map((object) => object.oid);
}

/** Can `blocker` legally be assigned to `attacker`, ignoring count rules? */
export function canBlock(state: GameState, blocker: ObjectId, attacker: ObjectId): boolean {
  if (!isOnBattlefield(state, blocker) || !isOnBattlefield(state, attacker)) return false;
  if (getObject(state, blocker).tapped) return false;
  if (hasAuraModification(state, blocker, 'cantBlock')) return false;
  if (hasAuraModification(state, attacker, 'cantBeBlocked')) return false;
  if (hasCombatModification(state, blocker, 'cantBlock')) return false;
  if (hasCombatModification(state, attacker, 'cantBeBlocked')) return false;
  if (hasTurnCombatRule(state, attacker, 'cantBeBlockedThisTurn')) return false;
  if (isProtectedFrom(state, attacker, blocker)) return false;
  const defender = controllerOf(state, blocker);
  const landwalk = keywordAbilitiesOf(state, attacker).filter((ability) => ability.kind === 'landwalk');
  if (
    landwalk.some((ability) =>
      landsControlledBy(state, defender).some((land) => hasSubtype(state, land.oid, ability.landType)),
    )
  ) {
    return false;
  }
  if (hasKeyword(state, attacker, 'flying')) {
    if (!hasKeyword(state, blocker, 'flying') && !hasKeyword(state, blocker, 'reach')) return false;
  }
  const required = requiredBlockKeywords(state, blocker);
  if (required.length > 0 && !required.every((keyword) => hasKeyword(state, attacker, keyword))) return false;
  // CR 509.1b from the attacker's side. `hasSubtype` rather than a read of
  // `card.subtypes`, because it is the layer-aware query the scope filter above
  // already goes through: a permanent that gained or lost Wall to a CR 613
  // layer-4 effect is or is not a Wall for this restriction too, and CR 205.3i's
  // basic-land-type fold comes along with it.
  const forbidden = blockedBySubtypes(state, attacker);
  if (forbidden.some((subtype) => hasSubtype(state, blocker, subtype))) return false;
  return true;
}

export interface BlockAssignment {
  readonly blocker: ObjectId;
  readonly attacker: ObjectId;
}

/**
 * Validates a whole block declaration. Returns a reason string when it is
 * illegal, `null` when it is legal. Evasion is checked per pair; menace is a
 * property of the finished declaration, so it is checked over the grouping.
 *
 * `whole` is what a prefix of a declaration passes false (`mtg-tb7v` stage 2).
 * Menace is the one rule here that a prefix can fail while every completion of
 * it is legal, so a declaration being announced one creature at a time is held
 * to the per-pair rules now and to the menace rule when the last creature has
 * been asked. What keeps that from being a hole is `legal.ts`, which offers a
 * prefix only when some completion exists; skipping the check here is not
 * skipping the rule.
 */
export function validateBlocks(
  state: GameState,
  defender: PlayerId,
  assignments: readonly BlockAssignment[],
  whole = true,
): string | null {
  const attacking = new Set(state.combat.attacks.map((attack) => attack.oid));
  const seen = new Set<ObjectId>();
  const perAttacker = new Map<ObjectId, number>();

  for (const assignment of assignments) {
    if (!attacking.has(assignment.attacker)) return `${assignment.attacker} is not attacking`;
    if (seen.has(assignment.blocker)) return `${assignment.blocker} cannot block twice`;
    seen.add(assignment.blocker);
    const blocker = state.objects[assignment.blocker];
    if (blocker === undefined || blocker.zone !== 'battlefield') {
      return `${assignment.blocker} is not on the battlefield`;
    }
    if (controllerOf(state, assignment.blocker) !== defender) {
      return `${assignment.blocker} is not controlled by the defender`;
    }
    if (blocker.card.kind !== 'creature') return `${assignment.blocker} is not a creature`;
    if (blocker.tapped) return `${assignment.blocker} is tapped`;
    if (!canBlock(state, assignment.blocker, assignment.attacker)) {
      return `${assignment.blocker} cannot block ${assignment.attacker} (evasion)`;
    }
    perAttacker.set(assignment.attacker, (perAttacker.get(assignment.attacker) ?? 0) + 1);
  }

  if (!whole) return null;
  for (const [attacker, count] of perAttacker) {
    if (hasKeyword(state, attacker, 'menace') && count === 1) {
      return `${attacker} has menace and must be blocked by two or more creatures`;
    }
  }
  return null;
}

/** Groups a flat declaration into per-attacker ordered blocker lists. */
export function groupBlocks(assignments: readonly BlockAssignment[]): readonly Block[] {
  const order: ObjectId[] = [];
  const grouped = new Map<ObjectId, ObjectId[]>();
  for (const assignment of assignments) {
    const existing = grouped.get(assignment.attacker);
    if (existing === undefined) {
      order.push(assignment.attacker);
      grouped.set(assignment.attacker, [assignment.blocker]);
    } else {
      existing.push(assignment.blocker);
    }
  }
  return order.map((attacker) => ({ attacker, blockers: grouped.get(attacker) ?? [] }));
}

export function attackersNeedingOrder(state: GameState): readonly Block[] {
  return state.combat.blocks.filter((block) => block.blockers.length > 1);
}

/** Taps the declared attackers that lack vigilance. */
export function tapAttackers(trace: Trace, attacks: readonly Attack[]): Trace {
  let current = trace;
  for (const attack of attacks) {
    if (hasKeyword(current.state, attack.oid, 'vigilance')) continue;
    current = tapObject(current, attack.oid);
  }
  return current;
}

export function isBlocked(state: GameState, attacker: ObjectId): boolean {
  return state.combat.blocks.some((block) => block.attacker === attacker);
}

function livingBlockers(state: GameState, attacker: ObjectId): readonly ObjectId[] {
  const block = state.combat.blocks.find((entry) => entry.attacker === attacker);
  if (block === undefined) return [];
  return block.blockers.filter((oid) => isOnBattlefield(state, oid));
}

/** Damage needed to finish a creature off, respecting deathtouch (CR 702.2b). */
export function lethalDamageFor(state: GameState, oid: ObjectId, deathtouch: boolean): number {
  const remaining = toughnessOf(state, oid) - getObject(state, oid).damage;
  if (remaining <= 0) return 0;
  return deathtouch ? Math.min(1, remaining) : remaining;
}

interface Assignment {
  readonly recipient: ObjectId | 'defender';
  readonly amount: number;
}

/**
 * Splits an attacker's combat damage across its blockers and, with trample,
 * the defending player. Lethal is assigned in blocker order (CR 510.1c-d);
 * deathtouch makes 1 lethal, which is what lets a 1/1 deathtouch trampler push
 * almost all of its damage through.
 *
 * Deliberate v0 simplification with a seam: the *order* is a genuine agent
 * decision (`orderBlockers`), but the per-blocker *amounts* are computed here
 * as minimum-lethal-then-spill rather than being asked for. That is the
 * optimal assignment for every card the slice can express, so making it a
 * decision would only add branching. When a card arrives that rewards
 * over-assigning (damage-triggered abilities), this function becomes the
 * enumerator behind a new `assignCombatDamage` decision instead of a rule.
 */
export function assignAttackerDamage(
  state: GameState,
  attacker: ObjectId,
  power: number,
): readonly Assignment[] {
  if (power <= 0) return [];
  const trample = hasKeyword(state, attacker, 'trample');
  const deathtouch = hasKeyword(state, attacker, 'deathtouch');
  const blockers = livingBlockers(state, attacker);

  if (!isBlocked(state, attacker)) {
    return [{ recipient: 'defender', amount: power }];
  }
  if (blockers.length === 0) {
    // Blocked but every blocker has left combat: only trample gets through.
    return trample ? [{ recipient: 'defender', amount: power }] : [];
  }

  const assignments: Assignment[] = [];
  let remaining = power;
  for (const blocker of blockers) {
    if (remaining <= 0) break;
    const lethal = lethalDamageFor(state, blocker, deathtouch);
    const amount = Math.min(remaining, lethal);
    if (amount > 0) assignments.push({ recipient: blocker, amount });
    remaining -= amount;
  }
  if (remaining <= 0) return assignments;

  if (trample) {
    assignments.push({ recipient: 'defender', amount: remaining });
    return assignments;
  }
  // Without trample the excess has to stay on a blocker: the last one in order.
  const last = assignments[assignments.length - 1];
  const fallback = blockers[blockers.length - 1];
  if (last !== undefined) {
    return [...assignments.slice(0, -1), { recipient: last.recipient, amount: last.amount + remaining }];
  }
  if (fallback === undefined) return assignments;
  return [{ recipient: fallback, amount: remaining }];
}

/**
 * Whether this creature deals its combat damage in the step being run.
 *
 * CR 510.4: the first-strike step exists at all only because some creature in
 * combat has first or double strike, and each creature deals damage in exactly
 * one of the two steps — except the one that deals in both. CR 702.4b is that
 * exception, so `doubleStrike` answers yes whichever step is asking, and the
 * pair on one creature (CR 702.4c) needs no case of its own: double strike
 * already covers both steps, so the `firstStrike` comparison below is never
 * reached for it.
 *
 * The damage a double striker deals in the second step is not a copy of the
 * first: `dealCombatDamage` recomputes power and re-runs `assignAttackerDamage`
 * against the state the second step starts in, which is where a blocker that
 * died to the first hit stops absorbing anything (`livingBlockers`) and a
 * pumped or shrunk striker hits for its new number.
 */
function participatesInStep(state: GameState, oid: ObjectId, firstStrike: boolean): boolean {
  if (!isOnBattlefield(state, oid)) return false;
  if (hasKeywordAbility(state, oid, 'doubleStrike')) return true;
  return hasKeyword(state, oid, 'firstStrike') === firstStrike;
}

/**
 * True when any creature in combat has first or double strike, so an extra step
 * is needed (CR 510.4).
 *
 * Double strike has to be asked here as well as in `participatesInStep`, and it
 * is the half that is easy to leave out: a lone double striker with no first
 * striker anywhere would otherwise skip straight to the regular step, deal its
 * damage once, and look exactly like a creature without the keyword.
 */
export function combatNeedsFirstStrikeStep(state: GameState): boolean {
  const inCombat: ObjectId[] = [
    ...state.combat.attacks.map((attack) => attack.oid),
    ...state.combat.blocks.flatMap((block) => block.blockers),
  ];
  return inCombat.some(
    (oid) =>
      isOnBattlefield(state, oid) &&
      (hasKeyword(state, oid, 'firstStrike') || hasKeywordAbility(state, oid, 'doubleStrike')),
  );
}

/**
 * One combat damage step. Every instance is computed against the state at the
 * start of the step and then applied at once, so trades resolve simultaneously.
 */
export function dealCombatDamage(trace: Trace, firstStrike: boolean): Trace {
  const state = trace.state;
  const instances: DamageInstance[] = [];

  for (const attack of state.combat.attacks) {
    if (!participatesInStep(state, attack.oid, firstStrike)) continue;
    const power = powerOf(state, attack.oid);
    const deathtouch = hasKeyword(state, attack.oid, 'deathtouch');
    const lifelink = hasKeyword(state, attack.oid, 'lifelink');
    for (const assignment of assignAttackerDamage(state, attack.oid, power)) {
      instances.push({
        sourceOid: attack.oid,
        controller: controllerOf(state, attack.oid),
        recipient:
          assignment.recipient === 'defender'
            ? typeof attack.defender === 'number'
              ? { kind: 'player', player: attack.defender }
              : { kind: 'permanent', oid: attack.defender.oid }
            : { kind: 'permanent', oid: assignment.recipient },
        amount: assignment.amount,
        deathtouch,
        lifelink,
        combat: true,
      });
    }
  }

  for (const block of state.combat.blocks) {
    for (const blockerOid of block.blockers) {
      if (!participatesInStep(state, blockerOid, firstStrike)) continue;
      if (!isOnBattlefield(state, block.attacker)) continue;
      const power = powerOf(state, blockerOid);
      if (power <= 0) continue;
      instances.push({
        sourceOid: blockerOid,
        controller: controllerOf(state, blockerOid),
        recipient: { kind: 'permanent', oid: block.attacker },
        amount: power,
        deathtouch: hasKeyword(state, blockerOid, 'deathtouch'),
        lifelink: hasKeyword(state, blockerOid, 'lifelink'),
        combat: true,
      });
    }
  }

  const stepped = emit(trace, { type: 'combatDamageStep', firstStrike });
  const damaged = applyDamage(stepped, instances);
  const marked = firstStrike
    ? { ...damaged.state.combat, firstStrikeDamageDone: true }
    : { ...damaged.state.combat, regularDamageDone: true };
  return withState(damaged, { ...damaged.state, combat: marked });
}
