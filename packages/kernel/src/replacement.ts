/**
 * The replacement / prevention pipeline (CR 614, 615, 616).
 *
 * ## Attribution
 *
 * The pipeline shape — the event is a value that gets rewritten, effects
 * declare what they watch as data, and an effect that has applied is struck off
 * for the remainder of that event — is a *design* ported from XMage (MIT,
 * <https://github.com/magefree/mage>), specifically the `replaceEvent` path in
 * `Mage/src/main/java/mage/abilities/effects/ContinuousEffects.java` and the
 * applied-effects set it threads through the recursion. No code was copied.
 *
 * ## The loop
 *
 * CR 616.1 is a loop, not a fold, and getting that wrong is the classic bug:
 *
 *   1. Collect every replacement effect that would apply to the event *as it
 *      now reads* and has not already applied to it (CR 614.5).
 *   2. If none, the event happens as it now reads. Stop.
 *   3. Apply every self-replacement effect first (CR 614.15, 616.1) — these are
 *      effects whose own source is the thing the event is about.
 *   4. Otherwise the *affected* player picks one of the candidates. Apply it.
 *   5. Go back to 1, because the rewritten event may now match effects that did
 *      not match before, and may no longer match ones that did.
 *
 * Step 5 is why prevention has to be modeled as rewriting rather than as a
 * veto: "prevent 2 damage" turns a 5-damage event into a 3-damage event that
 * other effects still get to see.
 *
 * ## Who chooses
 *
 * CR 616.1 gives the choice to the affected player, and `affectedPlayerFor`
 * computes exactly that. The kernel's own call sites pass no chooser and get
 * `earliestTimestamp`, which is deterministic and therefore replay-safe. The
 * generator cannot emit a replacement ability, so no generated game
 * reaches a real multi-candidate choice. Hand-authored reference cards can now
 * contribute one, including an event-local replacement from a card in hand and
 * Safe Passage's live recipient scope. Kernel call sites still use the replay-
 * safe default until a gameplay decision surface exposes that choice; this
 * chooser seam is where the agent decision plugs in. Tests drive the seam
 * directly with explicit choosers and with a redirect that makes a live scope
 * newly applicable, which is how the ordering loop is proved rather than
 * assumed.
 */
import type { PlayerId } from './ids';
import { controllerOf } from './layers';
import type { ReplaceableEvent, ReplacementEffect, ReplacementModification } from './replacement-effects';
import { subjectOf, triggerMatches } from './replacement-effects';
import type { GameState } from './state';

/**
 * Picks which of several applicable effects applies next. Receives the
 * candidates in timestamp order, the event as it currently reads, and the
 * player CR 616.1 puts in charge of the decision.
 */
export type ReplacementChooser = (
  candidates: readonly ReplacementEffect[],
  affected: PlayerId,
  event: ReplaceableEvent,
) => ReplacementEffect;

/** The kernel default: deterministic, and therefore replay-safe. */
export const earliestTimestamp: ReplacementChooser = (candidates) => {
  const first = candidates[0];
  if (first === undefined) throw new Error('replacement chooser: called with no candidates');
  return first;
};

/** A chooser that honors an explicit id order, falling back to the earliest. */
export function chooseInOrder(ids: readonly string[]): ReplacementChooser {
  return (candidates, affected, event) => {
    for (const id of ids) {
      const match = candidates.find((candidate) => candidate.id === id);
      if (match !== undefined) return match;
    }
    return earliestTimestamp(candidates, affected, event);
  };
}

/** CR 616.1: the player whose choice it is. */
export function affectedPlayerFor(state: GameState, event: ReplaceableEvent): PlayerId {
  switch (event.kind) {
    case 'damage':
      return event.recipient.kind === 'player'
        ? event.recipient.player
        : controllerOf(state, event.recipient.oid);
    case 'draw':
    case 'lifeGain':
    case 'discard':
      return event.player;
    case 'counterPlacement':
      return event.controller;
    case 'destroy':
      return controllerOf(state, event.oid);
    case 'zoneChange':
      return event.owner;
    case 'enters':
      return event.controller;
  }
}

export interface ReplacementOutcome {
  /** The event as it will actually happen, or `null` if nothing is left of it. */
  readonly event: ReplaceableEvent | null;
  /** The effect list after any prevention shields were spent. */
  readonly replacements: readonly ReplacementEffect[];
  /** Ids of the effects that applied, in the order they applied. */
  readonly appliedIds: readonly string[];
  /** Numeric prevention performed by each exact shield, in application order. */
  readonly preventions: readonly {
    readonly effect: ReplacementEffect;
    readonly recipient: Extract<ReplaceableEvent, { readonly kind: 'damage' }>['recipient'];
    readonly amount: number;
  }[];
  /** Non-prevention instructions attached to damage replacements that applied. */
  readonly damageFollowUps: readonly {
    readonly effect: ReplacementEffect;
    readonly amount: number;
  }[];
}

/**
 * Rewrites a damage event and reports how much of a prevention pool was spent,
 * so the shield can be reduced by exactly that much (CR 615.3).
 */
function applyDamageModification(
  state: GameState,
  event: Extract<ReplaceableEvent, { kind: 'damage' }>,
  modification: ReplacementModification,
): { readonly event: ReplaceableEvent | null; readonly spent: number } {
  switch (modification.kind) {
    case 'preventDamage': {
      if (!event.preventable) return { event, spent: 0 };
      if (modification.amount === 'all') return { event: null, spent: event.amount };
      const prevented = Math.min(modification.amount, event.amount);
      const remaining = event.amount - prevented;
      return { event: remaining <= 0 ? null : { ...event, amount: remaining }, spent: prevented };
    }
    case 'addDamage':
      return { event: { ...event, amount: event.amount + modification.amount }, spent: 0 };
    case 'multiplyDamage':
      return { event: { ...event, amount: event.amount * modification.factor }, spent: 0 };
    case 'damageToLifeFloor': {
      if (event.recipient.kind !== 'player') return { event, spent: 0 };
      const amount = Math.max(0, state.players[event.recipient.player].life - modification.minimum);
      return { event: { ...event, amount }, spent: 0 };
    }
    case 'redirectDamage':
      return { event: { ...event, recipient: modification.to }, spent: 0 };
    default:
      return { event, spent: 0 };
  }
}

function applyModification(
  state: GameState,
  event: ReplaceableEvent,
  modification: ReplacementModification,
): { readonly event: ReplaceableEvent | null; readonly spent: number } {
  if (event.kind === 'damage') return applyDamageModification(state, event, modification);
  if (event.kind === 'draw') {
    if (modification.kind === 'skipDraw') return { event: null, spent: 0 };
    if (modification.kind === 'drawAdditional') {
      return { event: { ...event, count: event.count + modification.extra }, spent: 0 };
    }
    return { event, spent: 0 };
  }
  if (event.kind === 'lifeGain') {
    if (modification.kind === 'multiplyLifeGain') {
      return { event: { ...event, amount: event.amount * modification.factor }, spent: 0 };
    }
    return { event, spent: 0 };
  }
  if (event.kind === 'counterPlacement') {
    if (modification.kind === 'multiplyCounterPlacement') {
      return { event: { ...event, count: event.count * modification.factor }, spent: 0 };
    }
    return { event, spent: 0 };
  }
  if (event.kind === 'destroy') {
    return modification.kind === 'regenerate' ? { event: null, spent: 0 } : { event, spent: 0 };
  }
  if (event.kind === 'discard') {
    return modification.kind === 'putDiscardedOntoBattlefield'
      ? { event: { ...event, destination: 'battlefield' }, spent: 0 }
      : { event, spent: 0 };
  }
  if (event.kind === 'zoneChange') {
    return modification.kind === 'moveToZone'
      ? { event: { ...event, destination: modification.destination }, spent: 0 }
      : { event, spent: 0 };
  }
  if (modification.kind === 'entersTapped') return { event: { ...event, tapped: true }, spent: 0 };
  if (modification.kind === 'entersWithCounters') {
    const counters =
      modification.counter === 'plusOnePlusOne'
        ? { plusOnePlusOne: event.plusOnePlusOne + modification.count }
        : modification.counter === 'minusOneMinusOne'
          ? { minusOneMinusOne: event.minusOneMinusOne + modification.count }
          : { charge: event.charge + modification.count };
    return { event: { ...event, ...counters }, spent: 0 };
  }
  return { event, spent: 0 };
}

/**
 * Spends `spent` points of a prevention pool, dropping the effect once the
 * shield is used up. `'all'` shields never deplete.
 */
export function consumeReplacementEffect(effect: ReplacementEffect, spent: number): ReplacementEffect | null {
  const modification = effect.modification;
  if (modification.kind === 'regenerate') return null;
  if (modification.kind !== 'preventDamage' || modification.amount === 'all' || spent <= 0) {
    return effect;
  }
  const remaining = modification.amount - spent;
  if (remaining <= 0) return null;
  return { ...effect, modification: { kind: 'preventDamage', amount: remaining } };
}

function byTimestamp(a: ReplacementEffect, b: ReplacementEffect): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * CR 614.15: a self-replacement effect is one whose source is the object the
 * event is about. The effect's own `selfReplacement` flag is a claim, and this
 * check is what makes it true — a mislabeled effect just queues normally.
 */
function isSelfReplacement(effect: ReplacementEffect, event: ReplaceableEvent): boolean {
  return effect.selfReplacement && subjectOf(event) === effect.sourceOid;
}

/**
 * Runs an event through every applicable replacement and prevention effect.
 *
 * Returns the event as it will actually happen (or `null` if nothing is left of
 * it), plus the effect list with any prevention shields debited. Callers must
 * write the returned list back into the state — a spent shield that is not
 * written back prevents damage forever.
 */
export function applyReplacements(
  state: GameState,
  event: ReplaceableEvent,
  choose: ReplacementChooser = earliestTimestamp,
  additionalEffects: readonly ReplacementEffect[] = [],
): ReplacementOutcome {
  if (state.replacements.length === 0 && additionalEffects.length === 0) {
    return { event, replacements: state.replacements, appliedIds: [], preventions: [], damageFollowUps: [] };
  }

  let current: ReplaceableEvent | null = event;
  const persistentIds = new Set(state.replacements.map((effect) => effect.id));
  let effects: readonly ReplacementEffect[] = [...state.replacements, ...additionalEffects];
  const applied: string[] = [];
  const preventions: {
    readonly effect: ReplacementEffect;
    readonly recipient: Extract<ReplaceableEvent, { readonly kind: 'damage' }>['recipient'];
    readonly amount: number;
  }[] = [];
  const damageFollowUps: { readonly effect: ReplacementEffect; readonly amount: number }[] = [];

  // CR 614.5 caps the loop: each pass strikes one more effect off, so the run
  // can never be longer than the effect list. One spare pass is the one that
  // finds nothing left and stops.
  const limit = effects.length + 1;
  for (let pass = 0; pass <= limit; pass += 1) {
    if (pass === limit) {
      throw new Error('applyReplacements: the pipeline did not settle; CR 614.5 bookkeeping is broken');
    }
    if (current === null) break;
    const live: ReplaceableEvent = current;
    const candidates = effects
      .filter((effect) => !applied.includes(effect.id))
      .filter((effect) => triggerMatches(state, effect, live))
      .filter(
        (effect) =>
          live.kind !== 'damage' ||
          live.preventable ||
          effect.modification.kind !== 'preventDamage' ||
          effect.damageReplacementFollowUp?.amountFrom === 'damageEvent',
      )
      .sort(byTimestamp);
    if (candidates.length === 0) break;

    // CR 616.1: self-replacement effects go first, and only then does the
    // affected player choose among what is left.
    const selfFirst = candidates.filter((effect) => isSelfReplacement(effect, live));
    const pool = selfFirst.length > 0 ? selfFirst : candidates;
    const chosen = pool.length === 1 ? pool[0] : choose(pool, affectedPlayerFor(state, live), live);
    if (chosen === undefined) throw new Error('applyReplacements: chooser returned nothing');
    if (!pool.some((candidate) => candidate.id === chosen.id)) {
      throw new Error(`applyReplacements: chooser returned ${chosen.id}, which is not applicable`);
    }

    const result = applyModification(state, live, chosen.modification);
    if (live.kind === 'damage' && result.spent > 0) {
      preventions.push({ effect: chosen, recipient: live.recipient, amount: result.spent });
    }
    if (live.kind === 'damage' && chosen.modification.kind === 'preventDamage') {
      const followUp = chosen.damageReplacementFollowUp;
      const amount = followUp?.amountFrom === 'damageEvent' ? live.amount : result.spent;
      if (followUp !== undefined && amount > 0) damageFollowUps.push({ effect: chosen, amount });
    }
    const consumed = consumeReplacementEffect(chosen, result.spent);
    effects =
      consumed === null
        ? effects.filter((effect) => effect.id !== chosen.id)
        : effects.map((effect) => (effect.id === chosen.id ? consumed : effect));
    applied.push(chosen.id);
    current = result.event;
  }

  return {
    event: current,
    replacements: effects.filter((effect) => persistentIds.has(effect.id)),
    appliedIds: applied,
    preventions,
    damageFollowUps,
  };
}

/** Convenience for callers that only need the rewritten event. */
export function replaceEvent(state: GameState, event: ReplaceableEvent): ReplaceableEvent | null {
  return applyReplacements(state, event).event;
}
