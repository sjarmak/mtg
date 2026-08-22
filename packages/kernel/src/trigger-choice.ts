/**
 * The two decisions a triggered ability can owe: its targets, and its "you may".
 *
 * CR 603.3d chooses a triggered ability's targets at the moment it is *put on
 * the stack*, and CR 603.3b's "you may" is answered as it *resolves*. They are
 * two questions at two different moments in one ability's life, so they are two
 * `AwaitKind`s and two `Decision` variants rather than one of each with a phase
 * field — an ability can owe the first, be responded to, lose its target, and
 * never reach the second.
 *
 * ## Why the state carries no new field
 *
 * Both questions are derived from the stack rather than recorded on it. An
 * ability entry that still owes targets is one whose printed trigger chooses
 * some and whose `targets` list is empty, because a trigger is pushed with an
 * empty list (`triggers.ts`) and answering fills it to one slot per effect. An
 * ability that owes its "you may" is simply an optional trigger on top of the
 * stack, because the answer *is* the resolution — accepting resolves it and
 * declining removes it, so "answered" is never a state anything has to store.
 *
 * That is worth the indirection. A field on `StackEntry` would land in
 * `stateFingerprint`, in every replay snapshot, and in `@mtg/ui`'s strict
 * `StackEntrySchema`, which means every recorded game would have to be
 * re-recorded to say "this trigger was never optional". Deriving it costs a
 * lookup and changes no bytes anywhere.
 *
 * ## Order
 *
 * Targets are answered bottom-up, which is the order the abilities were put on
 * the stack, which is APNAP (`apnapOrder` in `triggers.ts`). CR 603.3b puts the
 * active player's triggers on the stack first and chooses each one's targets as
 * it goes, so answering the bottom-most unanswered entry first is that sequence
 * read back off the stack.
 */
import type { TriggeredAbility } from '@mtg/dsl';
import { isOptionalTrigger, triggerChoosesTargets } from '@mtg/dsl';
import { abilityAt } from './abilities';
import type { ObjectId } from './ids';
import type { GameState, StackEntry, Target } from './state';
import { everySlotHasAChoice, targetChoicesForEffects } from './target-choices';
import type { Trace } from './trace';
import { emit, withState } from './trace';

/**
 * One stack entry, the printed trigger it came from, and the permanent that
 * printed it.
 *
 * The source rides along rather than being read back out of `entry.ability`,
 * which is nullable for the spells this record can never be built from. Every
 * consumer wants all three.
 */
export interface TriggerOnStack {
  readonly entry: StackEntry;
  readonly ability: TriggeredAbility;
  readonly source: ObjectId;
  /** Index into the source's printed `card.abilities`. */
  readonly index: number;
}

/**
 * The printed triggered ability behind a stack entry, or `null` when the entry
 * is not one.
 *
 * Total rather than a cast: the entry may be a spell, an activated ability, or
 * a trigger whose source has left the battlefield. CR 608.2 still resolves that
 * last one — the object record outlives the zone change, which is what
 * `abilityAt` reads — so the `null` here is "this is not a trigger", never "the
 * source is gone".
 */
export function triggerOf(state: GameState, entry: StackEntry): TriggerOnStack | null {
  const ability = entry.ability;
  if (ability === null) return null;
  const printed = abilityAt(state, ability.sourceOid, ability.index);
  if (printed === undefined || printed.kind !== 'triggered') return null;
  return { entry, ability: printed, source: ability.sourceOid, index: ability.index };
}

/** The same lookup by the ability object's own id, for a caller holding one. */
export function triggerOnStack(state: GameState, oid: ObjectId): TriggerOnStack | null {
  const entry = state.stack.find((item) => item.oid === oid);
  return entry === undefined ? null : triggerOf(state, entry);
}

/**
 * Every trigger on the stack that still owes its targets, bottom first.
 *
 * Two callers want different elements of this list, and they shared one
 * function that returned the first. `triggerAwaitingTargets` wants the trigger
 * to ask about, which is the first; CR 603.3d's removal pass wants the first
 * that cannot be aimed at all, which is not. Collapsing the two made the
 * removal pass stop at any trigger it found aimable and leave a later
 * unaimable one on the stack, where it became a question with no legal answer.
 *
 * "Still owes" is a length comparison rather than "has nothing written", because
 * a trigger may be aimed one slot at a time. `triggerTargetsDecision` lists the
 * whole target product when it fits under the enumeration cap and asks for one
 * slot at a time when it does not, so a stack entry can legitimately carry a
 * prefix. A fully aimed trigger carries one entry per effect — `validateTriggerTargets`
 * refuses anything longer and `chooseTriggerTargets` writes nothing shorter than
 * what it was handed — so the settled length is the whole of the marker.
 */
function triggersAwaitingTargets(state: GameState): readonly TriggerOnStack[] {
  const awaiting: TriggerOnStack[] = [];
  for (const entry of state.stack) {
    const pending = triggerOf(state, entry);
    if (pending === null) continue;
    if (!triggerChoosesTargets(pending.ability)) continue;
    if (entry.targets.length >= pending.ability.effects.length) continue;
    awaiting.push(pending);
  }
  return awaiting;
}

/**
 * The trigger that owes its targets, closest to the bottom of the stack, or
 * `null` when none does.
 */
export function triggerAwaitingTargets(state: GameState): TriggerOnStack | null {
  return triggersAwaitingTargets(state)[0] ?? null;
}

/**
 * The optional trigger on top of the stack, or `null` when the top is anything
 * else.
 *
 * Only the top, because this question is asked *by* resolution: CR 608.2 begins
 * with the topmost object and nothing below it is resolving yet.
 */
export function optionalTriggerOnTop(state: GameState): TriggerOnStack | null {
  const entry = state.stack[state.stack.length - 1];
  if (entry === undefined) return null;
  const pending = triggerOf(state, entry);
  return pending !== null && isOptionalTrigger(pending.ability) ? pending : null;
}

/**
 * Every target space a trigger that owes one chooses from, parallel to its
 * printed effects.
 *
 * `targetChoicesForEffects` is the same enumeration a cast and an activation
 * run through, so a trigger cannot aim `destroyPermanent` somewhere a spell
 * could not.
 */
export function triggerTargetChoices(
  state: GameState,
  pending: TriggerOnStack,
): readonly (readonly (Target | null)[])[] {
  return targetChoicesForEffects(
    state,
    pending.ability.effects,
    pending.entry.controller,
    state.objects[pending.source]?.zone === 'battlefield'
      ? pending.source
      : (pending.entry.sourceCharacteristics ?? pending.source),
  );
}

/**
 * True when every target slot this trigger needs still has something to aim at.
 *
 * CR 603.3d: a triggered ability that cannot choose legal targets is removed
 * from the stack. That is not CR 608.2b's fizzle, which is about targets that
 * were legal when they were chosen and are not any more, and the two are
 * reported by two different events for exactly that reason.
 */
export function triggerHasLegalTargets(state: GameState, pending: TriggerOnStack): boolean {
  return everySlotHasAChoice(triggerTargetChoices(state, pending));
}

/**
 * Removes every just-triggered ability that has no legal target (CR 603.3d).
 *
 * Runs immediately after the triggers are put on the stack and before anybody is
 * asked anything, so an ability with nowhere to point never becomes a question.
 * A `triggerRemoved` event says so, because the alternative is a log in which a
 * printed trigger simply never happened.
 *
 * Scanning the whole stack rather than the entries just pushed is deliberate and
 * costs nothing: an entry that has already answered carries its targets, so the
 * pass cannot reach an older one and is idempotent.
 *
 * Every trigger that owes targets is checked, not the bottom one alone. One
 * aimable trigger used to end the pass, which is right only when a stack holds
 * at most one trigger owing targets. Two attackers with `selfAttacks` triggers
 * broke it in the flagship: the one aimed at `targetCreature` could point at an
 * attacker and ended the walk, and the one aimed at
 * `targetCreatureDefendingPlayerControls` stayed on a stack whose defending
 * player controlled nothing, so the greedy bot was handed an empty option list
 * and threw inside a sim worker.
 */
export function removeTriggersWithoutTargets(trace: Trace): Trace {
  let current = trace;
  for (;;) {
    const state = current.state;
    const doomed = triggersAwaitingTargets(state).find((pending) => !triggerHasLegalTargets(state, pending));
    if (doomed === undefined) return current;
    const removed = emit(current, {
      type: 'triggerRemoved',
      oid: doomed.entry.oid,
      source: doomed.source,
      why: 'no legal targets',
    });
    current = withState(removed, removeEntry(removed.state, doomed.entry.oid));
  }
}

/** Drops one entry from the stack; an ability on the stack is in no zone. */
export function removeEntry(state: GameState, oid: ObjectId): GameState {
  return { ...state, stack: state.stack.filter((entry) => entry.oid !== oid) };
}

/** Writes the chosen targets onto a trigger's stack entry (CR 603.3d). */
export function withChosenTargets(
  state: GameState,
  oid: ObjectId,
  targets: readonly (Target | null)[],
): GameState {
  return {
    ...state,
    stack: state.stack.map((entry) => (entry.oid === oid ? { ...entry, targets } : entry)),
  };
}
