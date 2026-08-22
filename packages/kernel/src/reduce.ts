/**
 * The reducer: `reduce(state, action) -> { state, events }`.
 *
 * Pure. No I/O, no globals, no mutation of the input — the returned state is a
 * new object graph that structurally shares everything the action did not
 * touch, so the caller's `state` is still perfectly valid afterwards (that is
 * the whole basis of O(1) forking).
 *
 * An action is applied and then the game *settles*: state-based actions run,
 * and any step that requires no decision from anybody advances on its own. The
 * reducer returns only when a player owes a decision or the game is over, so
 * an agent never has to submit a "do nothing" action to make the turn move.
 *
 * ## The contract and the two trigger stops
 *
 * That sentence was written when every decision the kernel could ask for was a
 * priority window or a combat declaration, and the design document
 * (`docs/design/dsl-v1-ability-model.md` §9, risk 2) priced targeted triggers as
 * a change to it. Read against what landed, the contract holds and needed no
 * restating: a trigger being put on the stack owes CR 603.3d's targets and an
 * optional trigger owes CR 603.3b's "you may", and both of those *are* decisions
 * a player owes. What changed is not when the reducer returns — it still returns
 * exactly when somebody owes something — but *where inside settling* that can
 * first become true. `settle` could already return with `awaiting` set, because
 * `cleanupStep` sets a discard from inside it; the trigger stops are two more
 * kinds of the same thing, one raised while abilities go on the stack and one
 * raised by a resolution (`stack.ts`).
 *
 * The sentence that did need restating is the narrower claim `settle`'s own
 * docblock made about its ordering, and it is restated below.
 */
import type { Action } from './actions';
import { isLoyaltyAbility, resolveX } from '@mtg/dsl';
import { IllegalActionError } from './actions';
import {
  eligibleAttackers,
  eligibleBlockers,
  groupBlocks,
  tapAttackers,
  attackersNeedingOrder,
} from './combat';
import { effectiveManaCost } from './cost';
import { sacrificePermanent } from './destruction';
import { settledAction } from './damage-order';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import { validateAction, validateBlockDeclaration } from './legal';
import { executePayment, planPayment } from './mana';
import { activateManaSource } from './mana-ability';
import { askMulligan, cardsToBottom, keepHand, takeMulligan } from './mulligan';
import { checkStateBasedActions, endGameWith, keepLegend } from './sba';
import { collectTriggers, orderTriggers, putTriggersOnStack } from './triggers';
import {
  removeTriggersWithoutTargets,
  triggerAwaitingTargets,
  triggerOnStack,
  withChosenTargets,
} from './trigger-choice';
import type { Attack, Block, GameState } from './state';
import {
  pushAbility,
  pushSpell,
  resolveAnswered,
  resolveMayAnswered,
  resolveTop,
  resolveUnlessAnswered,
} from './stack';
import type { Trace } from './trace';
import { beginTrace, emit, playerOf, withState } from './trace';
import { advanceStep, finishCleanup, givePriority, withTurn } from './turn';
import { getObject, moveObject, tapObject } from './zones';
import { activatedAbilityAt } from './abilities';
import { addCounters, counterCount } from './continuous';
import { characteristicsOf } from './layers';
import {
  answerGraveyardChoice,
  answerHandDiscard,
  answerPermanentSacrifice,
  answerScry,
  answerSearch,
  discardFromHand,
} from './scry';

export interface ReduceResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

const MAX_SETTLE_STEPS = 10_000;

/**
 * Runs state-based actions, puts waiting triggered abilities on the stack, and
 * auto-advances every step that needs no decision, stopping as soon as somebody
 * owes one (or the game ends).
 *
 * The order is CR 704.3 and CR 603.3b's: state-based actions, then the
 * triggers that have been waiting, then priority — and then the whole check
 * again, because resolving one of those things can produce another.
 *
 * Putting a trigger on the stack is three steps rather than one, and the order
 * of those three is CR 603.3d's. The abilities go on in APNAP order; any of them
 * with no legal target to choose is removed on the spot, before anybody is asked
 * anything; and only then is the controller of the bottom-most ability that owes
 * targets asked to aim it. Asking is a stop, so `settle` returns there and
 * `reduce` is called again with the answer — which is why the targets are read
 * back off the stack rather than kept in a local: this function's watermark is a
 * local and does not survive the return.
 *
 * The priority grant stays ahead of the question for the same reason it is
 * there at all: `givePriority` clears `awaiting`, so a question raised before it
 * would be erased by it. Which player is asked first is unaffected — a stop
 * outranks a priority window in `pendingDecision` — and the priority is waiting
 * where CR 117.3b wants it once the aiming is done.
 *
 * The scan watermark is a local rather than a state field, and that is sound
 * because of a property worth stating: `settle` is the only exit from `reduce`,
 * and it never returns while an event is unscanned. Every trace begins at zero
 * events (`beginTrace`) and `reduce` applies the action before settling, so the
 * events already here when it is called are this reduction's own and no trigger
 * has looked at them.
 */
/**
 * Whether the kernel is stopped *inside* a resolution rather than between two.
 *
 * The members are the pauses `scry.ts` raises, and they are the stops that
 * outrank a settling pass: CR 704.4 and CR 603.3 both wait for the spell or
 * ability to finish resolving, and a resolution asking its controller (or, for
 * `'permanentSacrifice'`, the effect's target) a question has not finished.
 * Every other `awaiting` value is raised between resolutions, where
 * state-based actions and triggers are exactly what should run.
 *
 * A predicate rather than one comparison per member in two places, because the
 * two places must agree: `settle` refusing to run while `finishResolution`
 * runs would put a trigger on the stack underneath a half-resolved spell, and
 * that is a disagreement no type catches.
 */
function pausedMidResolution(state: GameState): boolean {
  return (
    state.turn.awaiting === 'scry' ||
    state.turn.awaiting === 'searchLibrary' ||
    state.turn.awaiting === 'handDiscard' ||
    state.turn.awaiting === 'graveyardChoice' ||
    state.turn.awaiting === 'permanentSacrifice'
  );
}

export function settle(trace: Trace): Trace {
  let current = trace;
  let scanned = 0;
  for (let iteration = 0; iteration < MAX_SETTLE_STEPS; iteration += 1) {
    // A scry or search choice is part of an effect that is still resolving.
    // State-based actions and triggered abilities wait until the whole spell or
    // ability is finished (CR 704.4, 603.3), so this stop outranks every
    // settling pass.
    if (pausedMidResolution(current.state)) return current;
    current = checkStateBasedActions(current);
    if (current.state.result !== null) return current;
    // CR 704.5j asked its controller a question, and CR 704.3 finishes the
    // state-based actions before CR 603.3b puts anything on the stack. Returning
    // here rather than falling through is what keeps that order: a trigger
    // pushed now would sit on the stack behind a board still in violation.
    if (current.state.turn.awaiting === 'legendRule') return current;

    const carried = current.state.deferredTriggers ?? [];
    if (current.state.deferredTriggers !== undefined) {
      const { deferredTriggers: _consumed, ...withoutDeferredTriggers } = current.state;
      current = withState(current, withoutDeferredTriggers);
    }
    const fired = orderTriggers(current.state, [...carried, ...collectTriggers(current, scanned)]);
    scanned = current.events.length;
    if (fired.length > 0) {
      current = putTriggersOnStack(current, fired);
      current = removeTriggersWithoutTargets(current);
      // CR 117.3b: once abilities are on the stack somebody gets priority.
      // No DSL v1 card reaches this branch — every step a trigger can fire in
      // has already assigned priority by the time the scan runs, and the one
      // window that looked open is closed by `cleanupTurnEffects` clearing
      // damage and expiring effects in a single state, so nothing dies to a
      // pump wearing off. It is written anyway because the alternative is an
      // ability sitting on the stack in a step nobody can act in, which is a
      // silent stall rather than a visible failure.
      if (current.state.turn.priority === null && current.state.turn.awaiting === null) {
        current = givePriority(current, current.state.turn.active);
      }
      continue;
    }

    current = askForTriggerTargets(current);
    if (current.state.turn.awaiting !== null) return current;
    if (current.state.turn.priority !== null) return current;
    current = advanceStep(current);
  }
  throw new Error('settle did not converge; the turn machine is looping');
}

/**
 * Raises CR 603.3d's question for the bottom-most trigger that still owes its
 * targets, or leaves the trace alone when none does.
 *
 * Written as a pass over the whole stack rather than as a hand-off from the push
 * because the answer arrives in a later `reduce` call: two triggers that fired
 * together are aimed one at a time, and the second one's question has to be
 * raised by a settle that never saw them fire.
 */
function askForTriggerTargets(trace: Trace): Trace {
  if (trace.state.turn.awaiting !== null) return trace;
  const pending = triggerAwaitingTargets(trace.state);
  if (pending === null) return trace;
  return withState(
    trace,
    withTurn(trace.state, {
      awaiting: 'triggerTargets',
      awaitingPlayer: pending.entry.controller,
    }),
  );
}

function retainPriority(trace: Trace, player: PlayerId): Trace {
  return withState(trace, withTurn(trace.state, { priority: player, passes: 0 }));
}

function onPass(trace: Trace, player: PlayerId): Trace {
  const passed = emit(trace, { type: 'priorityPassed', player });
  const passes = passed.state.turn.passes + 1;
  if (passes < 2) {
    const next = opponentOf(player);
    const state = withTurn(passed.state, { passes, priority: next });
    return emit(withState(passed, state), { type: 'priorityGained', player: next });
  }

  const quiet = withState(passed, withTurn(passed.state, { passes: 0, priority: null }));
  if (quiet.state.stack.length === 0) return advanceStep(quiet);

  const resolved = resolveTop(quiet);
  return finishResolution(resolved);
}

/**
 * What happens after the top of the stack has resolved: state-based actions,
 * then priority to the active player (CR 117.3b).
 *
 * The early return is the optional trigger's stop. `resolveTop` can hand back a
 * resolution that has not happened yet because its controller has been asked
 * whether to take it, and `givePriority` clears `awaiting` — so granting
 * priority here would erase the question and leave the ability on the stack with
 * nobody owing anything. The player who answers runs this same tail
 * (`onAnswerOptionalTrigger`), which is what puts priority back where CR 117.3b
 * wants it.
 */
function finishResolution(trace: Trace): Trace {
  if (pausedMidResolution(trace.state)) return trace;
  const checked = checkStateBasedActions(trace);
  if (checked.state.result !== null) return checked;
  if (checked.state.turn.awaiting !== null) return checked;
  return givePriority(checked, checked.state.turn.active);
}

function onScry(trace: Trace, action: Extract<Action, { type: 'scry' }>): Trace {
  return finishResolution(answerScry(trace, action.top, action.bottom));
}

function onSearchLibrary(trace: Trace, action: Extract<Action, { type: 'searchLibrary' }>): Trace {
  return finishResolution(answerSearch(trace, action.found));
}

function onChooseFromGraveyard(
  trace: Trace,
  action: Extract<Action, { type: 'chooseFromGraveyard' }>,
): Trace {
  return finishResolution(answerGraveyardChoice(trace, action.chosen));
}

function onSacrificePermanent(trace: Trace, action: Extract<Action, { type: 'sacrificePermanent' }>): Trace {
  return finishResolution(answerPermanentSacrifice(trace, action.oid));
}

/**
 * CR 701.8: a resolution's discard, performed when the last card is named.
 *
 * `onDiscard`'s two-arm shape at a different rule, and the shared arm is the
 * one that matters: a wide discard answered one card at a time holds its names
 * on `pendingSelection` and moves nothing until the selection is whole, so the
 * five-click discard and the one-click discard are the same log.
 *
 * The count comes off the pending record rather than off the hand, which is the
 * one line that differs from the cleanup discard and the reason these are two
 * functions. A cleanup discard's count is `hand.length - maximumHandSize` and
 * shrinks as cards leave; this one is printed on the card, was clamped to the
 * hand when the resolution stopped, and must not be re-derived from a hand a
 * `chooseDiscard`'s chooser does not even own.
 */
function onHandDiscard(trace: Trace, action: Extract<Action, { type: 'chooseDiscards' }>): Trace {
  const pending = trace.state.pendingHandDiscard;
  if (pending === undefined) throw new IllegalActionError(action, 'no discard is resolving');
  if (action.oids.length < pending.count) return holdSelection(trace, action.oids);
  return finishResolution(answerHandDiscard(trace, action.oids));
}

/**
 * CR 603.3d: the targets a triggered ability was aimed at, written onto its
 * entry.
 *
 * The ability is already on the stack — it went there before the question was
 * asked, which is the whole of CR 603.3d — so this changes one field and clears
 * the stop. Priority is not touched: it was granted before the question was
 * raised and is still owed to whoever had it.
 */
function onChooseTriggerTargets(
  trace: Trace,
  action: Extract<Action, { type: 'chooseTriggerTargets' }>,
): Trace {
  const pending = triggerOnStack(trace.state, action.oid);
  if (pending === null) throw new IllegalActionError(action, 'that trigger is not on the stack');
  const aimed = withState(trace, withChosenTargets(trace.state, action.oid, action.targets));
  const emitted = emit(aimed, {
    type: 'triggerTargetsChosen',
    oid: action.oid,
    source: pending.source,
    targets: action.targets,
  });
  return withState(emitted, withTurn(emitted.state, { awaiting: null, awaitingPlayer: null }));
}

/**
 * CR 603.3b: the answer to a "you may", which finishes the resolution the
 * question interrupted.
 *
 * `resolveAnswered` does what `resolveTop` would have done — accepting runs the
 * same tail a mandatory trigger runs, declining removes the ability and records
 * that it was declined — and then this runs `onPass`'s own tail, because the
 * resolution this completes is the one `onPass` started.
 */
function onAnswerOptionalTrigger(
  trace: Trace,
  action: Extract<Action, { type: 'answerOptionalTrigger' }>,
): Trace {
  const cleared = withState(trace, withTurn(trace.state, { awaiting: null, awaitingPlayer: null }));
  return finishResolution(resolveAnswered(cleared, action.accept));
}

/**
 * CR 601.2c: the answer to a spell's "you may", which finishes the resolution
 * the question interrupted. `onAnswerOptionalTrigger`'s tail exactly, for a
 * spell rather than a triggered ability — `resolveMayAnswered` is the half
 * that differs, and `action.player` is the chooser CR 601.2c asked, already
 * checked against the pending decision by `validateAction` before this runs.
 */
function onAnswerMay(trace: Trace, action: Extract<Action, { type: 'answerMay' }>): Trace {
  const cleared = withState(trace, withTurn(trace.state, { awaiting: null, awaitingPlayer: null }));
  return finishResolution(resolveMayAnswered(cleared, action.player, action.accept));
}

/**
 * CR 118.8: the answer to a spell's toll, which finishes the resolution the
 * question interrupted. `onAnswerMay` exactly, and the payment happens inside
 * `resolveUnlessAnswered` rather than here for the reason every other cost in
 * this kernel is charged where it is spent: a payment made in the reducer and
 * a resolution finished in `stack.ts` could disagree about whether the toll
 * bought anything.
 */
function onAnswerUnless(trace: Trace, action: Extract<Action, { type: 'answerUnless' }>): Trace {
  const cleared = withState(trace, withTurn(trace.state, { awaiting: null, awaitingPlayer: null }));
  return finishResolution(resolveUnlessAnswered(cleared, action.player, action.pay));
}

/**
 * CR 704.5j answered: the permanents the controller did not keep leave, and the
 * stop clears so the state-based actions can finish.
 *
 * Priority is not touched, for `onChooseTriggerTargets`' reason: it was never
 * taken away, so whoever held it when the sweep stopped still holds it. `settle`
 * runs `checkStateBasedActions` again immediately, which is where a second
 * collision is asked about and where the rest of this pass's actions happen.
 */
function onKeepLegend(trace: Trace, action: Extract<Action, { type: 'keepLegend' }>): Trace {
  const kept = keepLegend(trace, action.oid);
  return withState(kept, withTurn(kept.state, { awaiting: null, awaitingPlayer: null }));
}

function onPlayLand(trace: Trace, player: PlayerId, oid: ObjectId): Trace {
  const played = emit(trace, { type: 'landPlayed', player, oid });
  const moved = moveObject(played, oid, 'battlefield');
  const state = withTurn(moved.state, { landsPlayed: moved.state.turn.landsPlayed + 1 });
  return retainPriority(withState(moved, state), player);
}

function onCastSpell(trace: Trace, action: Extract<Action, { type: 'castSpell' }>): Trace {
  const card = getObject(trace.state, action.oid).card;
  if (card.kind === 'land') throw new IllegalActionError(action, 'lands are played, not cast');
  // CR 601.2b then CR 601.2f: X is fixed into the cost before any reduction is
  // applied to the total, so `effectiveManaCost` does both in that order —
  // `cost.ts`'s docblock works the counterexample for why the reverse is wrong.
  const cost = effectiveManaCost(trace.state, action.player, card, action.x);
  const plan = planPayment(trace.state, action.player, cost, action.oid);
  if (plan === null) throw new IllegalActionError(action, 'cannot pay the mana cost');
  const paid = executePayment(trace, action.player, cost, plan);
  const cast = pushSpell(
    paid,
    action.player,
    action.oid,
    action.targets,
    action.mode ?? null,
    action.x ?? null,
    action.multiTargets,
  );
  return retainPriority(cast, action.player);
}

/**
 * Pays for an activation and puts it on the stack (CR 602.2a).
 *
 * `onCastSpell` with the ability's cost in place of the card's, plus the two
 * halves of it a card's mana cost has no room for. The mana is paid before the
 * source is tapped. A land may be both a mana source and the source of this
 * ability, so a tap-self cost excludes it from the auto-payment plan.
 *
 * ## Why the sacrifice is paid last
 *
 * CR 601.2h pays the whole cost as one act, so the rules put no order on the
 * four. The reducer must, and only one order is sound: `moveObject` resets a
 * permanent's battlefield status on the way out (CR 400.7), so sacrificing
 * first and tapping second would turn a card in the graveyard sideways and
 * report a `permanentTapped` for it. The source therefore leaves last, after
 * every part of the cost that needs it to still be a permanent.
 *
 * The sacrifice emits `permanentSacrificed` and then its zone change, inside
 * this reduction and ahead of `abilityActivated`, so a replay can see the whole
 * cost paid before the ability existed. CR 701.17b says a sacrificed permanent
 * is not destroyed, and emitting `permanentDestroyed` for it would tell every
 * death-watching trigger the opposite of what happened — which is why the
 * announcement is its own event rather than a reuse of that one. It used to
 * emit nothing at all, on the argument that a sacrifice is a zone change and
 * nothing more; that argument was true of the rules and false of the log, and
 * `selfDiesNotSacrificed` is the trigger it left unwriteable (`triggers.ts`).
 *
 * A token pays it into the same graveyard a card does. It stops existing there
 * a moment later, when state-based actions next run (CR 111.7 and CR 704.5d,
 * `sba.ts`), which is late enough that a `selfDies` trigger printed on the
 * token has already been derived from the zone change. the flagship set's
 * parts are tokens, so that is the common case, not the exotic one.
 *
 * Either way the ability resolves: `pushAbility` records the same `sourceOid`
 * it would have recorded anyway and `resolveAbility` reads the printed text off
 * the object record rather than off a zone, so the ability resolves with its
 * source already gone exactly as CR 608.2 requires.
 *
 * The throws are unreachable through `reduce`, which validates first; they are
 * the guard for a caller that applies an action directly, and each fires before
 * anything has been emitted rather than leaving a half-paid state.
 *
 * ## The announced X is resolved into the cost before anything is paid
 *
 * CR 602.2b runs an activation through CR 601.2, so the `{X}` is announced (CR
 * 601.2b) at the top of the process and the mana is paid last (CR 601.2h) —
 * which means by the time this function charges anything, X is a known number
 * and `{X}{G}{G}` is `{6}{G}{G}`. `resolveX` is the function that does that
 * conversion for a cast spell, and it is the same one here rather than a second
 * spelling, so a payment planner that never learned about X keeps not needing
 * to. It is a no-op for a cost with no `{X}`, which is nearly every ability, so
 * there is no branch: an unannounced activation resolves against zero and comes
 * out with the cost it went in with.
 *
 * `effectiveManaCost` is deliberately *not* used, unlike `onCastSpell` one
 * function up. Cost modifiers in this kernel reduce what a *spell* costs to
 * cast, and an activated ability is not a spell (CR 602.2a puts it on the stack
 * as an ability); applying them here would make an ability cheaper than what
 * `validateActivation` and `activationOptions` priced it at, and the enumerated
 * X values would stop matching what the reducer charges.
 */
function onActivateAbility(trace: Trace, action: Extract<Action, { type: 'activateAbility' }>): Trace {
  const ability = activatedAbilityAt(trace.state, action.oid, action.abilityIndex);
  if (ability === undefined) throw new IllegalActionError(action, 'that ability is not an activated one');
  const source = characteristicsOf(trace.state, action.oid);
  const sourceCharacteristics = { colors: [...source.colors], subtypes: [...source.subtypes] };
  const chosenX = action.x ?? null;
  const cost = resolveX(ability.cost.mana, chosenX ?? 0);
  const plan = planPayment(
    trace.state,
    action.player,
    cost,
    undefined,
    ability.cost.tapSelf ? [action.oid] : [],
  );
  if (plan === null) throw new IllegalActionError(action, 'cannot pay the mana cost');
  const paid = executePayment(trace, action.player, cost, plan);
  let tapped = ability.cost.tapSelf ? tapObject(paid, action.oid) : paid;
  if (isLoyaltyAbility(ability)) {
    const object = getObject(tapped.state, action.oid);
    const counters = addCounters(object.counters, 'loyalty', ability.loyaltyCost);
    const state: GameState = {
      ...tapped.state,
      objects: {
        ...tapped.state.objects,
        [action.oid]: {
          ...object,
          counters,
          loyaltyActivatedTurn: tapped.state.turn.number,
        },
      },
    };
    tapped = emit(withState(tapped, state), {
      type: 'countersChanged',
      oid: action.oid,
      plusOnePlusOne: counters.plusOnePlusOne,
      minusOneMinusOne: counters.minusOneMinusOne,
      loyalty: counterCount(counters, 'loyalty'),
    });
  }
  // CR 601.2h pays the discard with the rest of the costs, before anything is
  // put on the stack. It goes after the mana and the tap and before the
  // sacrifices for one reason: a discard is the only cost here that can change
  // what the *targets* would have been legal against if it were interleaved
  // differently, and paying every cost before `pushAbility` is what makes the
  // order unobservable. `discardFromHand` is the same move CR 701.8 makes when
  // an effect discards, because a discard is a discard however it was reached.
  const spent =
    action.discards === undefined || action.discards.length === 0
      ? tapped
      : discardFromHand(tapped, action.player, action.discards);
  // The named permanents leave before the source does, which keeps the rule
  // above whole: everything that needed the source to still be a permanent has
  // happened by the time it goes. Each is a zone change and nothing more, for
  // the same CR 701.17b reason the source's is.
  let eaten = spent;
  for (const sacrificed of action.sacrifices) {
    eaten = sacrificePermanent(eaten, sacrificed, action.player);
  }
  const given = ability.cost.sacrificeSelf ? sacrificePermanent(eaten, action.oid, action.player) : eaten;
  const pushed = pushAbility(
    given,
    action.player,
    action.oid,
    action.abilityIndex,
    action.targets,
    sourceCharacteristics,
    chosenX,
  );
  return retainPriority(pushed, action.player);
}

/**
 * Records an answer to CR 508.1, and announces the attack when the last creature
 * has been asked.
 *
 * **The whole declaration is one event, whatever it took to say** — the same
 * rule `onOrderBlockers` follows and for the same reason. A prefix writes the
 * attacks it settled and the count of creatures answered for, taps nothing and
 * emits nothing; CR 508.1f taps the attacking creatures as part of the
 * declaration, and a creature tapped a question early would stop being eligible
 * for its own declaration. So the log of a sequenced attack is the log of the
 * same attack declared in one go, event for event.
 */
function onDeclareAttackers(
  trace: Trace,
  player: PlayerId,
  attacks: readonly Attack[],
  settled: number,
): Trace {
  const combat = { ...trace.state.combat, attacks };
  if (settled < eligibleAttackers(trace.state).length) {
    return withState(trace, { ...trace.state, combat: { ...combat, attacksSettled: settled } });
  }
  const { attacksSettled: _answered, ...finished } = combat;
  const state: GameState = { ...trace.state, combat: finished };
  const declared = emit(withState(trace, state), { type: 'attackersDeclared', player, attacks });
  const tapped = tapAttackers(declared, attacks);
  return givePriority(tapped, player);
}

/** `onDeclareAttackers` for CR 509.1; `blocksSettled` carries the same count. */
function onDeclareBlockers(trace: Trace, player: PlayerId, blocks: readonly Block[], settled: number): Trace {
  const inProgress = { ...trace.state.combat, blocks };
  if (settled < eligibleBlockers(trace.state).length) {
    return withState(trace, { ...trace.state, combat: { ...inProgress, blocksSettled: settled } });
  }
  const { blocksSettled: _answered, ...combat } = inProgress;
  const state: GameState = { ...trace.state, combat };
  const declared = emit(withState(trace, state), { type: 'blockersDeclared', player, blocks });
  const active = declared.state.turn.active;
  if (attackersNeedingOrder(declared.state).length > 0) {
    return withState(
      declared,
      withTurn(declared.state, {
        priority: null,
        awaiting: 'blockerOrder',
        awaitingPlayer: active,
      }),
    );
  }
  return givePriority(declared, active);
}

/**
 * Settles a run of positions in the damage assignment order, and ends the
 * announcement when the last one is in.
 *
 * The order lives in `combat.blocks`, in the order the blockers are listed in,
 * and this writes each answered position there as it is answered.
 * `combat.ordered` carries the one thing the list cannot say about itself — how
 * much of it has been chosen — because a settled order and an undeclared one are
 * the same list of creatures (`legal.ts`'s `orderDecision` asks the rest).
 *
 * **The whole announcement is one event, whatever it took to say.** A
 * mid-sequence answer emits nothing: `blockerOrderChosen` is the announcement
 * CR 509.2 asks for, an ordering is not announced until it is finished, and a
 * log that carried a partial one would make a player who clicked six times look
 * like a player who announced six orders. So the log of a sequenced ordering is
 * the log of the same ordering answered in one go, event for event.
 *
 * The caller's spelling is settled against the board first, so a twin named at a
 * position lands on the creature the board is already holding there rather than
 * swapping two objects the position cannot tell apart (`damage-order.ts`).
 */
function onOrderBlockers(trace: Trace, action: Extract<Action, { type: 'orderBlockers' }>): Trace {
  const spelled = settledAction(trace.state, action);
  const orders = spelled.type === 'orderBlockers' ? spelled.orders : action.orders;
  const settled: Record<ObjectId, number> = { ...(trace.state.combat.ordered ?? {}) };
  const placed = trace.state.combat.blocks.map((block): Block => {
    const order = orders.find((entry) => entry.attacker === block.attacker);
    if (order === undefined) return block;
    settled[block.attacker] = order.blockers.length;
    const behind = block.blockers.filter((oid) => !order.blockers.includes(oid));
    return { attacker: block.attacker, blockers: [...order.blockers, ...behind] };
  });
  const combat = { ...trace.state.combat, blocks: placed };
  const outstanding = placed.some(
    (block) => block.blockers.length > 1 && (settled[block.attacker] ?? 0) < block.blockers.length,
  );
  if (outstanding) {
    return withState(trace, { ...trace.state, combat: { ...combat, ordered: settled } });
  }
  const { ordered: _announced, ...finished } = combat;
  let current = withState(trace, { ...trace.state, combat: finished });
  for (const block of attackersNeedingOrder(current.state)) {
    current = emit(current, {
      type: 'blockerOrderChosen',
      attacker: block.attacker,
      blockers: block.blockers,
    });
  }
  return givePriority(current, current.state.turn.active);
}

/**
 * Records part of a set selection, without moving a card.
 *
 * `state.pendingSelection` holds the cards named so far while a wide discard or
 * bottoming is answered one card at a time (`legal.ts`'s `selectionAnswers`).
 * Nothing moves and nothing is emitted until the last card is named, for the
 * reason CR 508.1f gives at the attack declaration: a card put in the graveyard
 * a question early would stop being in the hand its own selection is chosen
 * from, and the log of a selection made in five clicks would stop being the log
 * of the same selection made in one.
 */
function holdSelection(trace: Trace, oids: readonly ObjectId[]): Trace {
  return withState(trace, { ...trace.state, pendingSelection: oids });
}

/** The same state with no selection in progress, whatever there was before. */
function clearSelection(state: GameState): GameState {
  const { pendingSelection: _named, ...cleared } = state;
  return cleared;
}

/**
 * CR 514.1: the discard, announced when the last card has been named.
 *
 * `onDeclareAttackers`' rule at the other kind of sequence — the whole discard
 * is one `cardsDiscarded` event whatever it took to say, so a sequenced discard
 * and a discard made in one answer are the same log and raise the same
 * commitment floor at the same moment (`undo.ts`).
 */
function onDiscard(trace: Trace, player: PlayerId, oids: readonly ObjectId[]): Trace {
  const count = playerOf(trace.state, player).hand.length - trace.state.config.maximumHandSize;
  if (oids.length < count) return holdSelection(trace, oids);
  let current = withState(trace, clearSelection(trace.state));
  for (const oid of oids) {
    current = moveObject(current, oid, 'graveyard');
  }
  current = emit(current, { type: 'cardsDiscarded', player, oids });
  return finishCleanup(current);
}

/**
 * CR 103.4: an answer to the opening hand, and the question that follows it.
 *
 * Both answers end the same way, in `askMulligan`, which either asks the next
 * seat or begins turn 1 — so "who is asked next" is decided in one place rather
 * than at each answer. Nothing here touches priority: no player holds it during
 * the mulligan phase, and `beginTurn` is what grants the first one.
 *
 * A keep that names fewer cards than the position asks for is a step of a wide
 * bottoming and settles nothing else, exactly as a partial discard does. A
 * mulligan taken part-way through one throws the named cards away with the hand
 * they were named out of, which is why it clears the field rather than carrying
 * it into the redraw.
 */
function onOpeningHand(trace: Trace, action: Extract<Action, { type: 'mulligan' | 'keepHand' }>): Trace {
  if (action.type === 'keepHand' && action.bottom.length < cardsToBottom(trace.state, action.player)) {
    return holdSelection(trace, action.bottom);
  }
  const opened = withState(trace, clearSelection(trace.state));
  const answered =
    action.type === 'mulligan'
      ? takeMulligan(opened, action.player)
      : keepHand(opened, action.player, action.bottom);
  return askMulligan(answered);
}

function applyAction(trace: Trace, action: Action): Trace {
  switch (action.type) {
    case 'mulligan':
    case 'keepHand':
      return onOpeningHand(trace, action);
    case 'passPriority':
      return onPass(trace, action.player);
    case 'playLand':
      return onPlayLand(trace, action.player, action.oid);
    case 'castSpell':
      return onCastSpell(trace, action);
    case 'activateManaAbility': {
      const produced = activateManaSource(trace, action.player, action.oid, action.color);
      return retainPriority(produced, action.player);
    }
    case 'activateAbility':
      return onActivateAbility(trace, action);
    case 'chooseTriggerTargets':
      return onChooseTriggerTargets(trace, action);
    case 'answerOptionalTrigger':
      return onAnswerOptionalTrigger(trace, action);
    case 'answerMay':
      return onAnswerMay(trace, action);
    case 'answerUnless':
      return onAnswerUnless(trace, action);
    case 'keepLegend':
      return onKeepLegend(trace, action);
    case 'scry':
      return onScry(trace, action);
    case 'searchLibrary':
      return onSearchLibrary(trace, action);
    case 'chooseFromGraveyard':
      return onChooseFromGraveyard(trace, action);
    case 'sacrificePermanent':
      return onSacrificePermanent(trace, action);
    case 'chooseDiscards':
      return onHandDiscard(trace, action);
    case 'declareAttackers':
      return onDeclareAttackers(
        trace,
        action.player,
        action.attackers.map((declaration): Attack => ({
          oid: declaration.oid,
          defender: declaration.defender,
        })),
        action.settled ?? eligibleAttackers(trace.state).length,
      );
    case 'declareBlockers': {
      const reason = validateBlockDeclaration(trace.state, action.player, action);
      if (reason !== null) throw new IllegalActionError(action, reason);
      return onDeclareBlockers(
        trace,
        action.player,
        groupBlocks(action.blocks),
        action.settled ?? eligibleBlockers(trace.state).length,
      );
    }
    case 'orderBlockers':
      return onOrderBlockers(trace, action);
    case 'discard':
      return onDiscard(trace, action.player, action.oids);
    case 'concede':
      return endGameWith(trace, opponentOf(action.player), action.player, 'concede');
  }
}

/**
 * The public reducer. Throws `IllegalActionError` rather than silently
 * ignoring an illegal action: a bot that submits one has a bug, and swallowing
 * it would desynchronize replays.
 */
export function reduce(state: GameState, action: Action): ReduceResult {
  const reason = validateAction(state, action);
  if (reason !== null) throw new IllegalActionError(action, reason);
  const applied = applyAction(beginTrace(state), action);
  const settled = settle(applied);
  return { state: settled.state, events: settled.events };
}

/** Applies a whole sequence, threading state and concatenating event logs. */
export function reduceAll(state: GameState, actions: readonly Action[]): ReduceResult {
  let current = state;
  const events: GameEvent[] = [];
  for (const action of actions) {
    const step = reduce(current, action);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}
