/**
 * Turn structure: steps, turn-based actions, and who gets priority when.
 *
 * The step list is the full CR 500 sequence for the slice. Entering a step
 * performs its turn-based actions (CR 703) and then either hands priority to
 * the active player or leaves priority `null`, which tells the settle loop in
 * `reduce.ts` that the step can advance on its own (untap and cleanup).
 */
import { assertNever } from '@mtg/dsl';
import type { PlayerId } from './ids';
import { opponentOf } from './ids';
import { hasAuraModification } from './attach';
import { combatNeedsFirstStrikeStep, dealCombatDamage, eligibleAttackers, eligibleBlockers } from './combat';
import { controllerOf } from './layers';
import { emptyManaPools } from './mana';
import type { AwaitKind, GameState, Step, TurnState } from './state';
import { EMPTY_COMBAT } from './state';
import type { Trace } from './trace';
import { emit, playerOf, withState } from './trace';
import { drawCard, getObject } from './zones';

export function withTurn(state: GameState, patch: Partial<TurnState>): GameState {
  return { ...state, turn: { ...state.turn, ...patch } };
}

/** Hands priority to a player and resets the pass counter (CR 117.3). */
export function givePriority(trace: Trace, player: PlayerId): Trace {
  const state = withTurn(trace.state, { priority: player, passes: 0, awaiting: null, awaitingPlayer: null });
  return emit(withState(trace, state), { type: 'priorityGained', player });
}

function awaitDecision(trace: Trace, kind: AwaitKind, player: PlayerId): Trace {
  const state = withTurn(trace.state, { priority: null, awaiting: kind, awaitingPlayer: player });
  return withState(trace, state);
}

/** The step that follows `step`, or `'endTurn'` when the turn is over. */
export function nextStepAfter(state: GameState, step: Step): Step | 'endTurn' {
  switch (step) {
    case 'untap':
      return 'upkeep';
    case 'upkeep':
      return 'draw';
    case 'draw':
      return 'precombatMain';
    case 'precombatMain':
      return 'beginCombat';
    case 'beginCombat':
      return 'declareAttackers';
    case 'declareAttackers':
      // CR 508.5: with no attackers, the rest of combat is skipped.
      return state.combat.attacks.length === 0 ? 'endCombat' : 'declareBlockers';
    case 'declareBlockers':
      return combatNeedsFirstStrikeStep(state) ? 'firstStrikeDamage' : 'combatDamage';
    case 'firstStrikeDamage':
      return 'combatDamage';
    case 'combatDamage':
      return 'endCombat';
    case 'endCombat':
      return 'postcombatMain';
    case 'postcombatMain':
      return 'end';
    case 'end':
      return 'cleanup';
    case 'cleanup':
      return 'endTurn';
    default:
      return assertNever(step, 'nextStepAfter');
  }
}

function untapStep(trace: Trace): Trace {
  const active = trace.state.turn.active;
  let current = trace;
  for (const oid of [...current.state.battlefield]) {
    const object = getObject(current.state, oid);
    if (controllerOf(current.state, oid) !== active) continue;
    // CR 302.6 read off the attachment relation rather than off the permanent:
    // an Aura printing `doesNotUntap` holds its host down for as long as it
    // stays attached, and it is spent by nothing. Checked before the one-shot
    // debt below so that a permanent carrying both is held once and reported
    // once — the two are different rules and only one of them ends.
    const enchantedStill = hasAuraModification(current.state, oid, 'doesNotUntap');
    // The debt is paid here whether or not it stopped anything, so a permanent
    // that was untapped by something else in between does not carry it into a
    // later turn: "its controller's *next* untap step" is this one either way.
    // The event fires only when the hold actually cost the permanent its untap,
    // because that is the turn-based action a viewer did not see happen.
    if (object.skipsNextUntap === true) {
      const { skipsNextUntap: _held, ...released } = object;
      current = withState(current, {
        ...current.state,
        objects: { ...current.state.objects, [oid]: released },
      });
      if (object.tapped) current = emit(current, { type: 'untapSkipped', oid });
    } else if (enchantedStill) {
      if (object.tapped) current = emit(current, { type: 'untapSkipped', oid });
    } else if (object.tapped) {
      current = withState(current, {
        ...current.state,
        objects: { ...current.state.objects, [oid]: { ...object, tapped: false } },
      });
      current = emit(current, { type: 'permanentUntapped', oid });
    }
    const refreshed = getObject(current.state, oid);
    if (refreshed.summoningSick) {
      current = withState(current, {
        ...current.state,
        objects: { ...current.state.objects, [oid]: { ...refreshed, summoningSick: false } },
      });
      current = emit(current, { type: 'summoningSicknessCleared', oid });
    }
  }
  return current;
}

function drawStep(trace: Trace): Trace {
  const { turn, config } = trace.state;
  const skip =
    config.startingPlayerSkipsFirstDraw && turn.number === 1 && turn.active === config.startingPlayer;
  return skip ? trace : drawCard(trace, turn.active);
}

/** Removes damage and end-of-turn continuous effects; CR 514.2. */
export function cleanupTurnEffects(trace: Trace): Trace {
  const state = trace.state;
  const expiring = state.continuous.filter((effect) => effect.duration === 'endOfTurn');
  const objects = Object.fromEntries(
    Object.entries(state.objects).map(([oid, object]) => [
      oid,
      object.damage === 0 && !object.deathtouched ? object : { ...object, damage: 0, deathtouched: false },
    ]),
  );
  const cleaned: GameState = {
    ...state,
    objects,
    continuous: state.continuous.filter((effect) => effect.duration !== 'endOfTurn'),
    replacements: state.replacements.filter((effect) => effect.duration !== 'endOfTurn'),
    // Every entry in this array is turn-scoped by construction — the array
    // exists precisely because CR 508/509 rules with a duration have nowhere
    // else to live — so cleanup empties it rather than filtering it.
    turnCombatRules: [],
  };
  let current = emit(withState(trace, cleaned), { type: 'damageCleared', turn: state.turn.number });
  if (expiring.length > 0) {
    current = emit(current, {
      type: 'continuousEffectsExpired',
      ids: expiring.map((effect) => effect.id),
    });
  }
  return current;
}

/** Cleanup after any discard has been made: sweep damage, then end the turn. */
export function finishCleanup(trace: Trace): Trace {
  const cleaned = cleanupTurnEffects(trace);
  const ended = emit(cleaned, { type: 'stepEnded', turn: cleaned.state.turn.number, step: 'cleanup' });
  return beginTurn(ended, opponentOf(cleaned.state.turn.active));
}

function cleanupStep(trace: Trace): Trace {
  const active = trace.state.turn.active;
  const hand = playerOf(trace.state, active).hand;
  if (hand.length > trace.state.config.maximumHandSize) {
    return awaitDecision(trace, 'discard', active);
  }
  return finishCleanup(trace);
}

/**
 * Enters a step: empties pools from the previous step, runs turn-based
 * actions, then sets priority or a pending decision.
 */
export function enterStep(trace: Trace, step: Step): Trace {
  const emptied = emptyManaPools(trace);
  const state = withTurn(emptied.state, {
    step,
    priority: null,
    passes: 0,
    awaiting: null,
    awaitingPlayer: null,
  });
  const active = state.turn.active;
  let current = emit(withState(emptied, state), {
    type: 'stepBegan',
    turn: state.turn.number,
    step,
    active,
  });

  switch (step) {
    case 'untap':
      // No priority in the untap step; the settle loop moves straight on.
      return untapStep(current);
    case 'draw':
      current = drawStep(current);
      return givePriority(current, active);
    case 'declareAttackers':
      if (eligibleAttackers(current.state).length === 0) return givePriority(current, active);
      return awaitDecision(current, 'attackers', active);
    case 'declareBlockers': {
      const defender = opponentOf(active);
      if (eligibleBlockers(current.state).length === 0) return givePriority(current, active);
      return awaitDecision(current, 'blockers', defender);
    }
    case 'firstStrikeDamage':
      current = dealCombatDamage(current, true);
      return givePriority(current, active);
    case 'combatDamage':
      current = dealCombatDamage(current, false);
      return givePriority(current, active);
    case 'cleanup':
      return cleanupStep(current);
    case 'upkeep':
    case 'precombatMain':
    case 'beginCombat':
    case 'endCombat':
    case 'postcombatMain':
    case 'end':
      return givePriority(current, active);
    default:
      return assertNever(step, 'enterStep');
  }
}

/** Leaves the current step and enters the next one, or starts the next turn. */
export function advanceStep(trace: Trace): Trace {
  const step = trace.state.turn.step;
  const ended = emit(trace, { type: 'stepEnded', turn: trace.state.turn.number, step });
  const next = nextStepAfter(ended.state, step);
  if (next === 'endTurn') {
    // Only reachable if cleanup granted priority, which it never does; kept so
    // the transition table stays total.
    return beginTurn(ended, opponentOf(ended.state.turn.active));
  }
  const leavingCombat = step === 'endCombat';
  const cleared = leavingCombat ? withState(ended, { ...ended.state, combat: EMPTY_COMBAT }) : ended;
  return enterStep(cleared, next);
}

export function beginTurn(trace: Trace, active: PlayerId): Trace {
  const number = trace.state.turn.number + 1;
  if (number > trace.state.config.maximumTurns) {
    const state: GameState = {
      ...trace.state,
      result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: trace.state.turn.number },
    };
    return emit(withState(trace, state), {
      type: 'gameEnded',
      winner: null,
      reason: 'turnLimit',
      turn: state.turn.number,
    });
  }
  const state: GameState = {
    ...trace.state,
    combat: EMPTY_COMBAT,
    turn: {
      number,
      active,
      step: 'untap',
      priority: null,
      passes: 0,
      landsPlayed: 0,
      damagedPlayers: [],
      awaiting: null,
      awaitingPlayer: null,
    },
  };
  const began = emit(withState(trace, state), { type: 'turnBegan', turn: number, active });
  return enterStep(began, 'untap');
}
