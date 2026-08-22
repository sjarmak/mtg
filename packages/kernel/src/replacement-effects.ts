/**
 * Replacement and prevention effects: the data model for CR 614, 615 and 616.
 *
 * ## Attribution
 *
 * The pipeline shape — events are values that get rewritten rather than actions
 * that get intercepted, each effect declares what it watches for as data, and
 * an effect that has applied to an event is struck off for the rest of that
 * event — is a *design* ported from XMage (MIT,
 * <https://github.com/magefree/mage>), specifically the replacement-effect
 * bookkeeping in `Mage/src/main/java/mage/abilities/effects/ContinuousEffects.java`
 * (`replaceEvent`, and the applied-effects set it threads through). No code was
 * copied.
 *
 * ## The three rules that make this subsystem hard
 *
 *  - **CR 614.5 (applies once).** An effect that has already modified an event
 *    cannot modify it again, even though the modified event still matches. This
 *    is what stops "if a creature would die, exile it instead" from looping and
 *    what makes a doubling effect double rather than diverge.
 *  - **CR 614.15 / 616.1 (self-replacement first).** An effect from the same
 *    object the event is about is applied before anything else gets a say.
 *  - **CR 616.1 (the affected player chooses).** When several still apply, the
 *    affected player — not the effects' controllers, not timestamp order —
 *    picks which applies next, and then the whole check runs again.
 *
 * Everything here is plain data for the same reason `continuous.ts` is: the
 * state has to clone, canonicalize and cross a worker boundary.
 */
import type { ObjectId, PlayerId } from './ids';
import type { CounterKind } from './continuous';
import type { EffectDuration } from './continuous';

export type DamageRecipient =
  | { readonly kind: 'player'; readonly player: PlayerId }
  | { readonly kind: 'permanent'; readonly oid: ObjectId };

/**
 * An event on its way to happening, in the form replacement effects rewrite.
 *
 * These are *not* `GameEvent`s. A `GameEvent` is a record of something that
 * already happened and is append-only history; a `ReplaceableEvent` is a
 * proposal that the pipeline may rewrite or delete before the kernel carries it
 * out. Keeping them separate is what stops a replaced event from ever reaching
 * the log as though it had happened.
 */
export type ReplaceableEvent =
  | {
      readonly kind: 'damage';
      readonly sourceOid: ObjectId;
      readonly controller: PlayerId;
      readonly recipient: DamageRecipient;
      readonly amount: number;
      readonly deathtouch: boolean;
      readonly lifelink: boolean;
      readonly combat: boolean;
    }
  | { readonly kind: 'draw'; readonly player: PlayerId; readonly count: number }
  | { readonly kind: 'lifeGain'; readonly player: PlayerId; readonly amount: number }
  | { readonly kind: 'destroy'; readonly oid: ObjectId }
  | {
      readonly kind: 'enters';
      readonly oid: ObjectId;
      readonly controller: PlayerId;
      readonly tapped: boolean;
      readonly plusOnePlusOne: number;
      readonly minusOneMinusOne: number;
    };

export type ReplaceableEventKind = ReplaceableEvent['kind'];

/** What an effect watches for. `null` on a field means "any". */
export type ReplacementTrigger =
  | {
      readonly kind: 'damage';
      readonly toPlayer: PlayerId | null;
      readonly toPermanent: ObjectId | null;
      readonly fromSource: ObjectId | null;
      readonly combatOnly: boolean;
    }
  | { readonly kind: 'draw'; readonly player: PlayerId | null }
  | { readonly kind: 'lifeGain'; readonly player: PlayerId | null }
  | { readonly kind: 'destroy'; readonly oid: ObjectId }
  | { readonly kind: 'enters'; readonly oid: ObjectId | null; readonly controller: PlayerId | null };

/** How a matching event is rewritten. */
export type ReplacementModification =
  /** CR 615: prevention. `'all'` is a blanket shield; a number is a pool. */
  | { readonly kind: 'preventDamage'; readonly amount: number | 'all' }
  | { readonly kind: 'addDamage'; readonly amount: number }
  | { readonly kind: 'multiplyDamage'; readonly factor: number }
  | { readonly kind: 'redirectDamage'; readonly to: DamageRecipient }
  | { readonly kind: 'skipDraw' }
  | { readonly kind: 'drawAdditional'; readonly extra: number }
  | { readonly kind: 'multiplyLifeGain'; readonly factor: number }
  | { readonly kind: 'entersTapped' }
  | { readonly kind: 'regenerate' }
  | {
      readonly kind: 'entersWithCounters';
      readonly counter: CounterKind;
      readonly count: number;
    };

export interface ReplacementEffect {
  readonly id: string;
  readonly sourceOid: ObjectId;
  /**
   * The player the effect belongs to. Not who chooses — CR 616.1 gives the
   * choice to the *affected* player — but it is what a future "you may" clause
   * and every log line will need.
   */
  readonly controller: PlayerId;
  readonly timestamp: number;
  readonly duration: EffectDuration;
  /**
   * CR 614.15: a self-replacement effect modifies an event that its own source
   * is part of, and CR 616.1 applies those before any other. This flag is the
   * effect's own claim; `replacement.ts` also checks that the event really is
   * about `sourceOid`, so a mislabeled effect degrades to an ordinary one
   * rather than jumping the queue.
   */
  readonly selfReplacement: boolean;
  readonly trigger: ReplacementTrigger;
  readonly modification: ReplacementModification;
}

/** Does this event's shape match what the effect watches for? */
export function triggerMatches(trigger: ReplacementTrigger, event: ReplaceableEvent): boolean {
  switch (trigger.kind) {
    case 'damage': {
      if (event.kind !== 'damage' || event.amount <= 0) return false;
      if (trigger.combatOnly && !event.combat) return false;
      if (trigger.fromSource !== null && trigger.fromSource !== event.sourceOid) return false;
      if (trigger.toPlayer !== null) {
        return event.recipient.kind === 'player' && event.recipient.player === trigger.toPlayer;
      }
      if (trigger.toPermanent !== null) {
        return event.recipient.kind === 'permanent' && event.recipient.oid === trigger.toPermanent;
      }
      return true;
    }
    case 'draw':
      return (
        event.kind === 'draw' &&
        event.count > 0 &&
        (trigger.player === null || trigger.player === event.player)
      );
    case 'lifeGain':
      return (
        event.kind === 'lifeGain' &&
        event.amount > 0 &&
        (trigger.player === null || trigger.player === event.player)
      );
    case 'destroy':
      return event.kind === 'destroy' && trigger.oid === event.oid;
    case 'enters':
      return (
        event.kind === 'enters' &&
        (trigger.oid === null || trigger.oid === event.oid) &&
        (trigger.controller === null || trigger.controller === event.controller)
      );
  }
}

/** The object the event is about, when there is one (used for CR 614.15). */
export function subjectOf(event: ReplaceableEvent): ObjectId | null {
  switch (event.kind) {
    case 'damage':
      return event.recipient.kind === 'permanent' ? event.recipient.oid : null;
    case 'enters':
      return event.oid;
    case 'destroy':
      return event.oid;
    case 'draw':
    case 'lifeGain':
      return null;
  }
}
