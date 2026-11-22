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
import {
  cardManaValue,
  effectsForActivatedAbility,
  hasTarget,
  isLoyaltyAbility,
  isMultipleTargetSpec,
  loyaltyCostChange,
  resolveX,
  targetCountOf,
  type Card,
  type Effect,
} from '@mtg/dsl';
import { stackEntryTargetingController } from './abilities';
import { IllegalActionError } from './actions';
import { canonicalCastAction } from './action-identity';
import {
  eligibleAttackers,
  eligibleBlockers,
  groupBlocks,
  groupAttackerOrders,
  tapAttackers,
  attackersNeedingOrder,
  blockersNeedingAttackerOrder,
} from './combat';
import { selectedCastingManaCost } from './cost';
import { countTargetInstances } from './target-count';
import { nextPluralStage, shouldStagePluralTargets } from './plural-targets';
import { pendingPluralContext } from './pending-plural-context';
import { sacrificePermanent } from './destruction';
import { settledAction } from './damage-order';
import { answerDamagePrevention } from './damage';
import { tallyThrough, tapRetainedDamageCohort } from './effects';
import type { GameEvent } from './events';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import { pendingFreeCastCandidate, validateAction, validateBlockDeclaration } from './legal';
import { executePayment, planPayment } from './mana';
import { attackTaxCost } from './attack-tax';
import { activateManaSource, continueManaCombination } from './mana-ability';
import { askMulligan, cardsToBottom, keepHand, takeMulligan } from './mulligan';
import { answerOpeningHandAction } from './opening-hand';
import { checkStateBasedActions, endGameWith, keepLegend } from './sba';
import { loseLife } from './life';
import { collectStateTriggers, collectTriggers, orderTriggers, putTriggersOnStack } from './triggers';
import {
  removeTriggersWithoutTargets,
  triggerAwaitingTargets,
  triggerOnStack,
  withChosenTargets,
} from './trigger-choice';
import type {
  Attack,
  AttackerOrder,
  Block,
  CombatState,
  GameState,
  PendingPluralTargets,
  Target,
} from './state';
import {
  pushAbility,
  pushCopiedCardSpell,
  pushSpell,
  resolveAnswered,
  resolveMayAnswered,
  resolveTop,
  resolveUnlessAnswered,
} from './stack';
import type { Trace } from './trace';
import { beginTrace, emit, withState } from './trace';
import { advanceStep, finishCleanup, givePriority, withTurn } from './turn';
import { cleanupDiscardCount } from './player-rules';
import {
  answerEntryAura,
  answerEntryCharacteristics,
  answerEntryOptionalCounter,
  answerEntryPayLife,
  answerEntryPlayer,
  answerEntryCardName,
  answerEntryColors,
  answerEntryCopy,
  answerEntryCounter,
  answerEntryTimestampNext,
  getObject,
  moveObject,
  tapObject,
} from './zones';
import { addCounters, counterCount } from './continuous';
import { removeCounters } from './counters';
import {
  characteristicsOf,
  copiableValuesOf,
  currentActivatedAbilityAt,
  powerOf,
  toughnessOf,
} from './layers';
import {
  answerCardName,
  answerNamedZoneExile,
  answerGraveyardChoice,
  answerBattlefieldChoice,
  answerPopulate,
  answerHandDiscard,
  answerManaColor,
  answerRevealedHandChoice,
  answerPermanentSacrifice,
  answerPermanentUntap,
  answerScry,
  answerTopLibraryOrder,
  answerTopLibrarySelect,
  continueGuildFeudContest,
  answerTopLibraryPartition,
  answerTopLibraryPile,
  answerSpellTargets,
  answerSearch,
  answerSearchDestination,
  applyResolutionEffects,
  discardFromHand,
  declineFreeCast,
  finishFreeCast,
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
    state.turn.awaiting === 'manaColor' ||
    state.turn.awaiting === 'topLibraryOrder' ||
    state.turn.awaiting === 'topLibrarySelect' ||
    state.turn.awaiting === 'topLibraryPartition' ||
    state.turn.awaiting === 'topLibraryPile' ||
    state.turn.awaiting === 'searchLibrary' ||
    state.turn.awaiting === 'searchDestination' ||
    state.turn.awaiting === 'handDiscard' ||
    state.turn.awaiting === 'revealedHandChoice' ||
    state.turn.awaiting === 'graveyardChoice' ||
    state.turn.awaiting === 'battlefieldChoice' ||
    state.turn.awaiting === 'populate' ||
    state.turn.awaiting === 'permanentSacrifice' ||
    state.turn.awaiting === 'permanentUntap' ||
    state.turn.awaiting === 'entryCopy' ||
    state.turn.awaiting === 'entryCounter' ||
    state.turn.awaiting === 'entryAura' ||
    state.turn.awaiting === 'entryTimestampOrder' ||
    state.turn.awaiting === 'entryCharacteristics' ||
    state.turn.awaiting === 'entryOptionalCounter' ||
    state.turn.awaiting === 'entryPayLife' ||
    state.turn.awaiting === 'entryPlayer' ||
    state.turn.awaiting === 'entryColors' ||
    state.turn.awaiting === 'spellTargets' ||
    state.turn.awaiting === 'freeCast' ||
    state.turn.awaiting === 'damagePrevention' ||
    state.turn.awaiting === 'cardName' ||
    state.turn.awaiting === 'namedZoneExile'
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
    // CR 103 pregame actions happen before any player would receive priority.
    // State-based actions therefore wait, and triggers caused by one action
    // must survive across reducer calls until the first priority window.
    if (current.state.turn.awaiting === 'openingHandAction') {
      const fired = collectTriggers(current, 0);
      if (fired.length === 0) return current;
      return withState(current, {
        ...current.state,
        deferredTriggers: [...(current.state.deferredTriggers ?? []), ...fired],
      });
    }
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
    const fired = orderTriggers(current.state, [
      ...carried,
      ...collectTriggers(current, scanned),
      ...collectStateTriggers(current.state),
    ]);
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
      awaitingPlayer: stackEntryTargetingController(trace.state, pending.entry),
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

/** Resumes the stack object after its controller names the mana it produces. */
function onChooseManaColor(trace: Trace, action: Extract<Action, { type: 'chooseManaColor' }>): Trace {
  return finishResolution(answerManaColor(trace, action.player, action.color));
}

function onTopLibrary(
  trace: Trace,
  action: Extract<
    Action,
    { type: 'orderTopLibrary' | 'selectFromTopLibrary' | 'separateTopLibraryPiles' | 'chooseTopLibraryPile' }
  >,
): Trace {
  const answered =
    action.type === 'orderTopLibrary'
      ? answerTopLibraryOrder(trace, action.cards)
      : action.type === 'selectFromTopLibrary'
        ? answerTopLibrarySelect(trace, action.chosen, action.rest)
        : action.type === 'separateTopLibraryPiles'
          ? answerTopLibraryPartition(trace, action.first, action.second)
          : answerTopLibraryPile(trace, action.pile);
  return action.type === 'separateTopLibraryPiles' ? answered : finishResolution(answered);
}

function onSearchLibrary(trace: Trace, action: Extract<Action, { type: 'searchLibrary' }>): Trace {
  return finishResolution(answerSearch(trace, action.found));
}

function onChooseSearchDestination(
  trace: Trace,
  action: Extract<Action, { type: 'chooseSearchDestination' }>,
): Trace {
  return finishResolution(answerSearchDestination(trace, action.one));
}

function onChooseFromGraveyard(
  trace: Trace,
  action: Extract<Action, { type: 'chooseFromGraveyard' }>,
): Trace {
  return finishResolution(answerGraveyardChoice(trace, action.chosen));
}

function onChooseFromBattlefield(
  trace: Trace,
  action: Extract<Action, { type: 'chooseFromBattlefield' }>,
): Trace {
  return finishResolution(answerBattlefieldChoice(trace, action.chosen));
}

function onChoosePopulateToken(
  trace: Trace,
  action: Extract<Action, { type: 'choosePopulateToken' }>,
): Trace {
  return finishResolution(answerPopulate(trace, action.token));
}

function onSacrificePermanent(trace: Trace, action: Extract<Action, { type: 'sacrificePermanent' }>): Trace {
  return finishResolution(answerPermanentSacrifice(trace, action.oid));
}

function onChoosePermanentToUntap(
  trace: Trace,
  action: Extract<Action, { type: 'choosePermanentToUntap' }>,
): Trace {
  return finishResolution(answerPermanentUntap(trace, action.oid));
}

function onChooseCardName(trace: Trace, action: Extract<Action, { type: 'chooseCardName' }>): Trace {
  if (trace.state.pendingEntryCardNameChoice !== undefined) {
    return finishEntryAnswer(trace, answerEntryCardName(trace, action.name));
  }
  return finishResolution(answerCardName(trace, action.name));
}

function onChooseNamedZoneExile(
  trace: Trace,
  action: Extract<Action, { type: 'chooseNamedZoneExile' }>,
): Trace {
  return finishResolution(answerNamedZoneExile(trace, action.oid));
}

function onChooseSpellTargets(trace: Trace, action: Extract<Action, { type: 'chooseSpellTargets' }>): Trace {
  return finishResolution(
    answerSpellTargets(trace, action.targets, action.multiTargets, action.damageAllocations),
  );
}

function onChooseEntryCopy(trace: Trace, action: Extract<Action, { type: 'chooseEntryCopy' }>): Trace {
  return finishEntryAnswer(trace, answerEntryCopy(trace, action.copyOf));
}

function onChooseEntryCounterPermanent(
  trace: Trace,
  action: Extract<Action, { type: 'chooseEntryCounterPermanent' }>,
): Trace {
  return finishEntryAnswer(trace, answerEntryCounter(trace, action.permanent));
}

function onChooseEntryCharacteristics(
  trace: Trace,
  action: Extract<Action, { type: 'chooseEntryCharacteristics' }>,
): Trace {
  return finishEntryAnswer(trace, answerEntryCharacteristics(trace, action.mode));
}

function onChooseEntryOptionalCounter(
  trace: Trace,
  action: Extract<Action, { type: 'chooseEntryOptionalCounter' }>,
): Trace {
  return finishEntryAnswer(trace, answerEntryOptionalCounter(trace, action.accept));
}

function onChooseEntryPayLife(trace: Trace, action: Extract<Action, { type: 'chooseEntryPayLife' }>): Trace {
  return finishEntryAnswer(trace, answerEntryPayLife(trace, action.pay));
}

function onChooseEntryPlayer(trace: Trace, action: Extract<Action, { type: 'chooseEntryPlayer' }>): Trace {
  return finishEntryAnswer(trace, answerEntryPlayer(trace, action.chosen));
}

function onChooseEntryColors(trace: Trace, action: Extract<Action, { type: 'chooseEntryColors' }>): Trace {
  return finishEntryAnswer(trace, answerEntryColors(trace, action.colors));
}

function onChooseEntryAuraHost(
  trace: Trace,
  action: Extract<Action, { type: 'chooseEntryAuraHost' }>,
): Trace {
  return finishEntryAnswer(trace, answerEntryAura(trace, action.host));
}

function onChooseEntryTimestampNext(
  trace: Trace,
  action: Extract<Action, { type: 'chooseEntryTimestampNext' }>,
): Trace {
  return finishEntryAnswer(trace, answerEntryTimestampNext(trace, action.oid));
}

/** Resumes a spell or ability after the last choice in a simultaneous entry batch. */
function finishEntryAnswer(before: Trace, answered: Trace): Trace {
  const continuation = before.state.pendingBattlefieldEntryBatch?.resolution;
  if (answered.state.pendingBattlefieldEntryBatch !== undefined) return answered;
  const guildFeudPhase = answered.state.pendingTopLibrary?.guildFeud?.phase;
  if (guildFeudPhase === 'opponentEntry' || guildFeudPhase === 'controllerEntry') {
    return finishResolution(continueGuildFeudContest(answered));
  }
  if (continuation === undefined) return finishResolution(answered);
  const resumed = applyResolutionEffects(
    answered,
    continuation.sourceOid,
    continuation.controller,
    continuation.remaining,
    continuation.x,
    continuation.objectToGraveyard,
    tallyThrough(answered, 0, continuation.tally),
    [...continuation.deferredTriggers, ...collectTriggers(answered, 0)],
    continuation.sourceCard,
  );
  return finishResolution(resumed);
}

/** Applies one CR 615.7 share and resumes the interrupted rules action when complete. */
function onAllocateDamagePrevention(
  trace: Trace,
  action: Extract<Action, { type: 'allocateDamagePrevention' }>,
): Trace {
  const pending = trace.state.pendingDamagePrevention;
  if (pending === undefined) throw new IllegalActionError(action, 'no damage allocation is pending');
  const since = trace.events.length;
  let answered = answerDamagePrevention(trace, action.sourceOid, action.amount);
  if (answered.state.pendingDamagePrevention !== undefined) return answered;
  if (pending.postDamageTaps !== undefined) {
    answered = tapRetainedDamageCohort(answered, pending.postDamageTaps);
  }
  const continuation = pending.resolution;
  if (continuation === undefined) {
    return pending.resumePriority === null ? answered : givePriority(answered, pending.resumePriority);
  }
  const resumed = applyResolutionEffects(
    answered,
    continuation.sourceOid,
    continuation.controller,
    continuation.remaining,
    continuation.x,
    continuation.objectToGraveyard,
    tallyThrough(answered, since, continuation.tally),
    [...continuation.deferredTriggers, ...collectTriggers(answered, since)],
    continuation.sourceCard,
  );
  return finishResolution(resumed);
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

function onRevealedHandChoice(
  trace: Trace,
  action: Extract<Action, { type: 'chooseFromRevealedHand' }>,
): Trace {
  return finishResolution(answerRevealedHandChoice(trace, action.chosen));
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
  if (shouldStagePluralTargets(pending.ability.effects, action.multiTargets, action.damageAllocations)) {
    return beginTriggerPluralChoice(trace, action);
  }
  const aimed = withState(
    trace,
    withChosenTargets(trace.state, action.oid, action.targets, action.multiTargets, action.damageAllocations),
  );
  const emitted = emit(aimed, {
    type: 'triggerTargetsChosen',
    oid: action.oid,
    source: pending.source,
    targets: action.targets,
    ...(action.multiTargets === undefined ? {} : { multiTargets: action.multiTargets }),
    ...(action.damageAllocations === undefined ? {} : { damageAllocations: action.damageAllocations }),
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

function awaitPendingPlural(trace: Trace, pending: PendingPluralTargets): Trace {
  const stage = nextPluralStage(pendingPluralContext(trace.state, pending).effects, pending);
  if (stage === null) return finishPendingPlural(trace, pending);
  const awaiting = stage.kind === 'targets' ? 'pluralTargets' : 'damageAllocation';
  return withState(trace, {
    ...trace.state,
    pendingPluralTargets: pending,
    turn: { ...trace.state.turn, awaiting, awaitingPlayer: pending.player },
  });
}

function clearPendingPlural(state: GameState): GameState {
  const { pendingPluralTargets: _finished, ...rest } = state;
  return withTurn(rest, { awaiting: null, awaitingPlayer: null });
}

function completedCastAction(pending: PendingPluralTargets): Extract<Action, { type: 'castSpell' }> {
  return {
    type: 'castSpell',
    player: pending.player,
    oid: pending.oid,
    targets: pending.targets,
    multiTargets: pending.multiTargets,
    ...(Object.keys(pending.damageAllocations).length === 0
      ? {}
      : { damageAllocations: pending.damageAllocations }),
    ...(pending.x === undefined ? {} : { x: pending.x }),
    ...(pending.mode === undefined ? {} : { mode: pending.mode }),
    ...(pending.castingCost === undefined ? {} : { castingCost: pending.castingCost }),
    ...(pending.sacrifices === undefined ? {} : { sacrifices: pending.sacrifices }),
    ...(pending.discards === undefined ? {} : { discards: pending.discards }),
  };
}

function completedActivationAction(
  pending: PendingPluralTargets,
): Extract<Action, { type: 'activateAbility' }> {
  if (pending.abilityIndex === undefined) throw new Error('pending plural activation has no ability index');
  return {
    type: 'activateAbility',
    player: pending.player,
    oid: pending.oid,
    abilityIndex: pending.abilityIndex,
    targets: pending.targets,
    multiTargets: pending.multiTargets,
    ...(Object.keys(pending.damageAllocations).length === 0
      ? {}
      : { damageAllocations: pending.damageAllocations }),
    sacrifices: pending.sacrifices ?? [],
    ...(pending.taps === undefined ? {} : { taps: pending.taps }),
    ...(pending.discards === undefined ? {} : { discards: pending.discards }),
    ...(pending.x === undefined ? {} : { x: pending.x }),
    ...(pending.mode === undefined ? {} : { mode: pending.mode }),
  };
}

function finishPendingPlural(trace: Trace, pending: PendingPluralTargets): Trace {
  const cleared = withState(trace, clearPendingPlural(trace.state));
  if (pending.origin === 'cast') return onCastSpell(cleared, completedCastAction(pending));
  if (pending.origin === 'activation') {
    return onActivateAbility(cleared, completedActivationAction(pending));
  }
  return onChooseTriggerTargets(cleared, {
    type: 'chooseTriggerTargets',
    player: pending.player,
    oid: pending.oid,
    targets: pending.targets,
    multiTargets: pending.multiTargets,
    ...(Object.keys(pending.damageAllocations).length === 0
      ? {}
      : { damageAllocations: pending.damageAllocations }),
  });
}

function onBeginActivateAbility(trace: Trace, action: Extract<Action, { type: 'activateAbility' }>): Trace {
  return awaitPendingPlural(trace, {
    origin: 'activation',
    player: action.player,
    oid: action.oid,
    abilityIndex: action.abilityIndex,
    targets: action.targets,
    multiTargets: {},
    damageAllocations: {},
    finishedTargetSlots: [],
    sacrifices: action.sacrifices,
    ...(action.taps === undefined ? {} : { taps: action.taps }),
    ...(action.discards === undefined ? {} : { discards: action.discards }),
    ...(action.x === undefined ? {} : { x: action.x }),
    ...(action.mode === undefined ? {} : { mode: action.mode }),
  });
}

function onBeginCastSpell(trace: Trace, action: Extract<Action, { type: 'beginCastSpell' }>): Trace {
  return awaitPendingPlural(trace, {
    origin: 'cast',
    player: action.player,
    oid: action.oid,
    targets: action.targets,
    multiTargets: {},
    damageAllocations: {},
    finishedTargetSlots: [],
    ...(action.x === undefined ? {} : { x: action.x }),
    ...(action.mode === undefined ? {} : { mode: action.mode }),
    ...(action.castingCost === undefined ? {} : { castingCost: action.castingCost }),
    ...(action.sacrifices === undefined ? {} : { sacrifices: action.sacrifices }),
    ...(action.discards === undefined ? {} : { discards: action.discards }),
  });
}

function beginTriggerPluralChoice(
  trace: Trace,
  action: Extract<Action, { type: 'chooseTriggerTargets' }>,
): Trace {
  return awaitPendingPlural(trace, {
    origin: 'trigger',
    player: action.player,
    oid: action.oid,
    targets: action.targets,
    multiTargets: {},
    damageAllocations: {},
    finishedTargetSlots: [],
  });
}

function targetSlotFinishes(effect: Effect, members: readonly Target[], target: Target | null): boolean {
  if (target === null) return true;
  if (!hasTarget(effect) || !isMultipleTargetSpec(effect.target)) return false;
  const fixed = targetCountOf(effect.target);
  return fixed !== null && members.length >= fixed;
}

function onChoosePluralTarget(trace: Trace, action: Extract<Action, { type: 'choosePluralTarget' }>): Trace {
  const pending = trace.state.pendingPluralTargets;
  if (pending === undefined) throw new IllegalActionError(action, 'no plural target choice is pending');
  const effects = pendingPluralContext(trace.state, pending).effects;
  const stage = nextPluralStage(effects, pending);
  if (stage === null || stage.kind !== 'targets') throw new IllegalActionError(action, 'wrong plural stage');
  const previous = pending.multiTargets[stage.index] ?? [];
  const members = action.target === null ? previous : [...previous, action.target];
  const finished = targetSlotFinishes(effects[stage.index]!, members, action.target);
  return awaitPendingPlural(trace, {
    ...pending,
    multiTargets: { ...pending.multiTargets, [stage.index]: members },
    finishedTargetSlots: finished
      ? [...pending.finishedTargetSlots, stage.index]
      : pending.finishedTargetSlots,
  });
}

function onAllocateDividedDamage(
  trace: Trace,
  action: Extract<Action, { type: 'allocateDividedDamage' }>,
): Trace {
  const pending = trace.state.pendingPluralTargets;
  if (pending === undefined) throw new IllegalActionError(action, 'no damage allocation is pending');
  const stage = nextPluralStage(pendingPluralContext(trace.state, pending).effects, pending);
  if (stage === null || stage.kind !== 'allocation')
    throw new IllegalActionError(action, 'wrong plural stage');
  const allocations = [...(pending.damageAllocations[stage.index] ?? []), action.amount];
  return awaitPendingPlural(trace, {
    ...pending,
    damageAllocations: { ...pending.damageAllocations, [stage.index]: allocations },
  });
}

function onCastSpell(trace: Trace, action: Extract<Action, { type: 'castSpell' }>): Trace {
  const physical = getObject(trace.state, action.oid);
  const candidatePending = action.castingCost === 'withoutMana' ? trace.state.pendingFreeCast : undefined;
  const freeCandidate =
    candidatePending?.player === action.player
      ? pendingFreeCastCandidate(trace.state, candidatePending, action.oid)
      : null;
  const pending = freeCandidate === null ? undefined : candidatePending;
  const card = freeCandidate?.card ?? physical.card;
  if (card.kind === 'land') throw new IllegalActionError(action, 'lands are played, not cast');
  const castingCost = action.castingCost ?? 'mana';
  if (castingCost === 'alternative' && card.alternativeCost === undefined) {
    throw new IllegalActionError(action, 'this spell has no alternative casting cost');
  }
  if (
    castingCost === 'overload' &&
    ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.overload === undefined)
  ) {
    throw new IllegalActionError(action, 'this spell has no overload casting cost');
  }
  // CR 601.2b then CR 601.2f: X is fixed into the cost before any reduction is
  // applied to the total, so the selected-price seam either does both in that
  // order or replaces the whole mana component with zero for CR 118.9.
  const targetCount = countTargetInstances(action.targets, action.multiTargets);
  const cost = selectedCastingManaCost(trace.state, action.player, card, action.x, castingCost, targetCount);
  const plan = planPayment(trace.state, action.player, cost, action.oid);
  if (plan === null) throw new IllegalActionError(action, 'cannot pay the mana cost');
  const manaPaid = executePayment(trace, action.player, cost, plan);
  const paid =
    castingCost === 'alternative' && card.alternativeCost !== undefined
      ? loseLife(manaPaid, action.player, card.alternativeCost.payLife)
      : manaPaid;
  const canonical = canonicalCastAction(action);
  const discards = canonical.discards ?? [];
  const discarded = discards.length === 0 ? paid : discardFromHand(paid, action.player, discards, null);
  const sacrifices = canonical.sacrifices ?? [];
  const onlySacrifice = sacrifices.length === 1 ? sacrifices[0] : undefined;
  const paidSacrificePower =
    onlySacrifice === undefined ? undefined : powerOf(discarded.state, onlySacrifice);
  const paidSacrificeToughness =
    onlySacrifice === undefined ? undefined : toughnessOf(discarded.state, onlySacrifice);
  let sacrificed = discarded;
  for (const oid of sacrifices) sacrificed = sacrificePermanent(sacrificed, oid, action.player);
  const faced =
    pending?.card === undefined
      ? sacrificed
      : withState(sacrificed, {
          ...sacrificed.state,
          objects: {
            ...sacrificed.state.objects,
            [action.oid]: { ...getObject(sacrificed.state, action.oid), faceCard: pending.card },
          },
        });
  const cast =
    freeCandidate?.copy === null || freeCandidate === null
      ? pushSpell(
          faced,
          action.player,
          action.oid,
          action.targets,
          action.mode ?? null,
          action.x ?? null,
          action.multiTargets,
          action.damageAllocations,
          paidSacrificePower,
          paidSacrificeToughness,
          action.castingCost,
        )
      : pushCopiedCardSpell(
          faced,
          action.player,
          action.oid,
          freeCandidate.copy.card,
          action.targets,
          action.mode ?? null,
          action.x ?? null,
          action.multiTargets,
          action.damageAllocations,
          paidSacrificePower,
          paidSacrificeToughness,
          action.castingCost,
        );
  return pending === undefined ? retainPriority(cast, action.player) : finishFreeCast(cast, action.oid);
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
  const ability = currentActivatedAbilityAt(trace.state, action.oid, action.abilityIndex);
  if (ability === undefined) throw new IllegalActionError(action, 'that ability is not an activated one');
  const effects = effectsForActivatedAbility(ability, action.mode ?? null);
  if (shouldStagePluralTargets(effects, action.multiTargets, action.damageAllocations)) {
    return onBeginActivateAbility(trace, action);
  }
  const sourceBattlefieldIncarnation = getObject(trace.state, action.oid).incarnation ?? 0;
  const source = characteristicsOf(trace.state, action.oid);
  // The announced stack object retains the ability incarnation the player
  // actually activated. Layer-6 grants are not printed on the source card, so
  // retaining only copiable values would make the numeric slot disappear at
  // resolution. Trigger collection banks its live ability list for the same
  // reason.
  const sourceCard: Card = {
    ...copiableValuesOf(trace.state, action.oid),
    abilities: [...source.abilities],
  };
  const sourceCharacteristics = {
    colors: [...source.colors],
    subtypes: [...source.subtypes],
    keywords: [...source.keywords],
  };
  const chosenX = action.x ?? null;
  const cost = resolveX(ability.cost.mana, chosenX ?? 0);
  const plan = planPayment(trace.state, action.player, cost, undefined, [
    ...(ability.cost.tapSelf ? [action.oid] : []),
    ...(action.taps ?? []),
  ]);
  if (plan === null) throw new IllegalActionError(action, 'cannot pay the mana cost');
  const manaPaid = executePayment(trace, action.player, cost, plan);
  const paid =
    ability.cost.payLife === undefined ? manaPaid : loseLife(manaPaid, action.player, ability.cost.payLife);
  let tapped = ability.cost.tapSelf ? tapObject(paid, action.oid) : paid;
  // CR 601.2h/602.2b: the whole chosen cohort is a cost, so it is tapped now,
  // before the ability reaches the stack or either player receives priority.
  // Canonical order makes two unordered spellings of the same payment emit the
  // same replay sequence as well as sharing one action identity.
  for (const oid of [...(action.taps ?? [])].sort()) tapped = tapObject(tapped, oid);
  if (isLoyaltyAbility(ability)) {
    const object = getObject(tapped.state, action.oid);
    const counters = addCounters(object.counters, 'loyalty', loyaltyCostChange(ability.loyaltyCost, chosenX));
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
  const removedCounter = ability.cost.removeCounter;
  if (removedCounter !== undefined) {
    tapped = removeCounters(tapped, action.oid, removedCounter.counter, removedCounter.count).trace;
  }
  if (ability.activateOnlyOnceEachTurn === true) {
    const object = getObject(tapped.state, action.oid);
    tapped = withState(tapped, {
      ...tapped.state,
      objects: {
        ...tapped.state.objects,
        [action.oid]: {
          ...object,
          activationLimitedTurns: {
            ...object.activationLimitedTurns,
            [action.abilityIndex]: tapped.state.turn.number,
          },
        },
      },
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
      : discardFromHand(tapped, action.player, action.discards, null);
  const onlyPaidDiscard = action.discards?.length === 1 ? action.discards[0] : undefined;
  const paidDiscardManaValue =
    onlyPaidDiscard === undefined ? undefined : cardManaValue(getObject(tapped.state, onlyPaidDiscard).card);
  const paidPermanents = [...action.sacrifices, ...(ability.cost.sacrificeSelf ? [action.oid] : [])];
  const onlyPaidPermanent = paidPermanents.length === 1 ? paidPermanents[0] : undefined;
  const paidSacrificePower =
    onlyPaidPermanent === undefined ? undefined : powerOf(spent.state, onlyPaidPermanent);
  const paidSacrificeToughness =
    onlyPaidPermanent === undefined ? undefined : toughnessOf(spent.state, onlyPaidPermanent);
  // The named permanents leave before the source does, which keeps the rule
  // above whole: everything that needed the source to still be a permanent has
  // happened by the time it goes. Each is a zone change and nothing more, for
  // the same CR 701.17b reason the source's is.
  let eaten = spent;
  for (const sacrificed of action.sacrifices) {
    eaten = sacrificePermanent(eaten, sacrificed, action.player);
  }
  const given = ability.cost.sacrificeSelf ? sacrificePermanent(eaten, action.oid, action.player) : eaten;
  const exiled = ability.cost.exileSelf ? moveObject(given, action.oid, 'exile') : given;
  const stackPayment =
    ability.cost.exileControlledInstantOrSorcerySpell === true ? action.targets[0] : undefined;
  const stackPaid =
    stackPayment?.kind !== 'spell'
      ? exiled
      : exiled.state.objects[stackPayment.oid]?.zone === 'stack'
        ? moveObject(exiled, stackPayment.oid, 'exile')
        : withState(exiled, {
            ...exiled.state,
            stack: exiled.state.stack.filter((entry) => entry.oid !== stackPayment.oid),
          });
  const resolutionTargets =
    ability.cost.exileControlledInstantOrSorcerySpell === true
      ? ability.effects.map(() => null)
      : action.targets;
  const pushed = pushAbility(
    stackPaid,
    action.player,
    action.oid,
    action.abilityIndex,
    action.mode ?? null,
    resolutionTargets,
    sourceCharacteristics,
    chosenX,
    sourceBattlefieldIncarnation,
    sourceCard,
    action.multiTargets,
    action.damageAllocations,
    paidSacrificePower,
    paidSacrificeToughness,
    paidDiscardManaValue,
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
  const declarationCost = attackTaxCost(trace.state, player, attacks);
  const combat = { ...trace.state.combat, attacks };
  if (settled < eligibleAttackers(trace.state).length) {
    return withState(trace, { ...trace.state, combat: { ...combat, attacksSettled: settled } });
  }
  const { attacksSettled: _answered, ...finished } = combat;
  const attackedPlayers = trace.state.turn.playersWhoAttackedWithCreatureThisTurn;
  const state: GameState = {
    ...trace.state,
    combat: finished,
    turn:
      attacks.length === 0 || attackedPlayers.includes(player)
        ? trace.state.turn
        : {
            ...trace.state.turn,
            playersWhoAttackedWithCreatureThisTurn: [...attackedPlayers, player],
          },
  };
  let paid = withState(trace, state);
  if (declarationCost !== null) {
    const payment = planPayment(trace.state, player, declarationCost);
    if (payment === null) throw new Error('onDeclareAttackers: validated attack tax became unpayable');
    paid = executePayment(paid, player, declarationCost, payment);
  }
  const declared = emit(paid, { type: 'attackersDeclared', player, attacks });
  const tapped = tapAttackers(declared, attacks);
  return givePriority(tapped, player);
}

/** `onDeclareAttackers` for CR 509.1; `blocksSettled` carries the same count. */
function withAttackerOrders(combat: CombatState, blocks: readonly Block[]): CombatState {
  const { attackerOrders: _oldOrders, attackersOrdered: _oldProgress, ...base } = combat;
  const attackerOrders = groupAttackerOrders(blocks);
  return attackerOrders.length === 0 ? { ...base, blocks } : { ...base, blocks, attackerOrders };
}

function beginAttackerOrder(trace: Trace): Trace {
  if (blockersNeedingAttackerOrder(trace.state).length === 0) {
    return givePriority(trace, trace.state.turn.active);
  }
  return withState(
    trace,
    withTurn(trace.state, {
      priority: null,
      awaiting: 'attackerOrder',
      awaitingPlayer: opponentOf(trace.state.turn.active),
    }),
  );
}

function onDeclareBlockers(
  trace: Trace,
  player: PlayerId,
  blocks: readonly Block[],
  settled: number,
  attackerChoicesSettled: number | undefined,
): Trace {
  const inProgress = withAttackerOrders(trace.state.combat, blocks);
  if (settled < eligibleBlockers(trace.state).length) {
    const { blockerAttacksSettled: _oldAttackerProgress, ...base } = inProgress;
    const combat =
      attackerChoicesSettled === undefined
        ? { ...base, blocksSettled: settled }
        : { ...base, blocksSettled: settled, blockerAttacksSettled: attackerChoicesSettled };
    return withState(trace, { ...trace.state, combat });
  }
  const { blocksSettled: _answered, blockerAttacksSettled: _answeredAttacks, ...combat } = inProgress;
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
  return beginAttackerOrder(declared);
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
  return beginAttackerOrder(current);
}

/** CR 509.3's reverse damage order, announced by the defending player. */
function onOrderAttackers(trace: Trace, action: Extract<Action, { type: 'orderAttackers' }>): Trace {
  const settled: Record<ObjectId, number> = { ...(trace.state.combat.attackersOrdered ?? {}) };
  const placed = (trace.state.combat.attackerOrders ?? []).map((block): AttackerOrder => {
    const order = action.orders.find((entry) => entry.blocker === block.blocker);
    if (order === undefined) return block;
    settled[block.blocker] = order.attackers.length;
    const behind = block.attackers.filter((oid) => !order.attackers.includes(oid));
    return { blocker: block.blocker, attackers: [...order.attackers, ...behind] };
  });
  const combat = { ...trace.state.combat, attackerOrders: placed };
  const outstanding = placed.some(
    (block) => block.attackers.length > 1 && (settled[block.blocker] ?? 0) < block.attackers.length,
  );
  if (outstanding) {
    return withState(trace, { ...trace.state, combat: { ...combat, attackersOrdered: settled } });
  }
  const { attackersOrdered: _announced, ...finished } = combat;
  let current = withState(trace, { ...trace.state, combat: finished });
  for (const block of blockersNeedingAttackerOrder(current.state)) {
    current = emit(current, {
      type: 'attackerOrderChosen',
      blocker: block.blocker,
      attackers: block.attackers,
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
  const count = cleanupDiscardCount(trace.state, player);
  if (oids.length < count) return holdSelection(trace, oids);
  let current = withState(trace, clearSelection(trace.state));
  current = discardFromHand(current, player, oids, null);
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
    case 'chooseOpeningHandAction':
      return answerOpeningHandAction(trace, action.player, action.oid);
    case 'passPriority':
      return onPass(trace, action.player);
    case 'playLand':
      return onPlayLand(trace, action.player, action.oid);
    case 'castSpell':
      return onCastSpell(trace, action);
    case 'beginCastSpell':
      return onBeginCastSpell(trace, action);
    case 'choosePluralTarget':
      return onChoosePluralTarget(trace, action);
    case 'allocateDividedDamage':
      return onAllocateDividedDamage(trace, action);
    case 'activateManaAbility': {
      const produced =
        trace.state.pendingManaCombination === undefined
          ? activateManaSource(trace, action.player, action.oid, action.color, action.abilityIndex)
          : continueManaCombination(
              trace,
              action.player,
              action.oid,
              action.color as Exclude<typeof action.color, 'C'>,
            );
      return retainPriority(produced, action.player);
    }
    case 'chooseManaColor':
      return onChooseManaColor(trace, action);
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
    case 'declineFreeCast':
      return declineFreeCast(trace);
    case 'keepLegend':
      return onKeepLegend(trace, action);
    case 'scry':
      return onScry(trace, action);
    case 'orderTopLibrary':
    case 'selectFromTopLibrary':
    case 'separateTopLibraryPiles':
    case 'chooseTopLibraryPile':
      return onTopLibrary(trace, action);
    case 'searchLibrary':
      return onSearchLibrary(trace, action);
    case 'chooseSearchDestination':
      return onChooseSearchDestination(trace, action);
    case 'chooseFromGraveyard':
      return onChooseFromGraveyard(trace, action);
    case 'chooseFromBattlefield':
      return onChooseFromBattlefield(trace, action);
    case 'choosePopulateToken':
      return onChoosePopulateToken(trace, action);
    case 'sacrificePermanent':
      return onSacrificePermanent(trace, action);
    case 'choosePermanentToUntap':
      return onChoosePermanentToUntap(trace, action);
    case 'chooseCardName':
      return onChooseCardName(trace, action);
    case 'chooseNamedZoneExile':
      return onChooseNamedZoneExile(trace, action);
    case 'chooseSpellTargets':
      return onChooseSpellTargets(trace, action);
    case 'chooseEntryCopy':
      return onChooseEntryCopy(trace, action);
    case 'chooseEntryCounterPermanent':
      return onChooseEntryCounterPermanent(trace, action);
    case 'chooseEntryCharacteristics':
      return onChooseEntryCharacteristics(trace, action);
    case 'chooseEntryOptionalCounter':
      return onChooseEntryOptionalCounter(trace, action);
    case 'chooseEntryPayLife':
      return onChooseEntryPayLife(trace, action);
    case 'chooseEntryPlayer':
      return onChooseEntryPlayer(trace, action);
    case 'chooseEntryColors':
      return onChooseEntryColors(trace, action);
    case 'chooseEntryAuraHost':
      return onChooseEntryAuraHost(trace, action);
    case 'chooseEntryTimestampNext':
      return onChooseEntryTimestampNext(trace, action);
    case 'allocateDamagePrevention':
      return onAllocateDamagePrevention(trace, action);
    case 'chooseDiscards':
      return onHandDiscard(trace, action);
    case 'chooseFromRevealedHand':
      return onRevealedHandChoice(trace, action);
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
        action.attackerChoicesSettled,
      );
    }
    case 'orderBlockers':
      return onOrderBlockers(trace, action);
    case 'orderAttackers':
      return onOrderAttackers(trace, action);
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
