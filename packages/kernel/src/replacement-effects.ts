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
import type { Card, CardKind, Color, CounterKind } from '@mtg/dsl';
import { printedCardTypes } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { EffectDuration } from './continuous';
import { controllerOf, hasCardType } from './layers';
import type { GameState, ZoneId } from './state';
import { copiableCardOf } from './state';

export type ReplacementDuration = EffectDuration | 'whileInHand';

/** The spell or ability whose resolution is performing a discard. */
export interface DiscardCause {
  readonly sourceOid: ObjectId;
  readonly controller: PlayerId;
}

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
      /** Source incarnation retained through replacement and prevention. */
      readonly sourceIncarnation?: number;
      readonly controller: PlayerId;
      readonly recipient: DamageRecipient;
      readonly amount: number;
      readonly deathtouch: boolean;
      readonly lifelink: boolean;
      readonly combat: boolean;
      readonly preventable: boolean;
      readonly exileDamagedCreatureIfItWouldDieThisTurn?: true;
      /** Printed characteristics retained for a copied spell with no GameObject. */
      readonly sourceCard?: Card;
    }
  | { readonly kind: 'draw'; readonly player: PlayerId; readonly count: number }
  | { readonly kind: 'lifeGain'; readonly player: PlayerId; readonly amount: number }
  | {
      readonly kind: 'counterPlacement';
      readonly oid: ObjectId;
      readonly controller: PlayerId;
      readonly counter: CounterKind;
      readonly count: number;
      /** Proposed copiable values for an object that has not entered yet. */
      readonly recipientCard?: Card;
    }
  | { readonly kind: 'destroy'; readonly oid: ObjectId }
  | {
      readonly kind: 'discard';
      readonly oid: ObjectId;
      readonly player: PlayerId;
      readonly cause: DiscardCause | null;
      readonly destination: 'graveyard' | 'battlefield';
    }
  | {
      readonly kind: 'zoneChange';
      readonly oid: ObjectId;
      readonly owner: PlayerId;
      readonly from: ZoneId;
      readonly destination: ZoneId;
    }
  | {
      readonly kind: 'enters';
      readonly oid: ObjectId;
      readonly controller: PlayerId;
      readonly tapped: boolean;
      readonly plusOnePlusOne: number;
      readonly minusOneMinusOne: number;
      readonly charge: number;
    };

export type ReplaceableEventKind = ReplaceableEvent['kind'];

/** What an effect watches for. `null` on a field means "any". */
export type ReplacementTrigger =
  | {
      readonly kind: 'damage';
      readonly toPlayer: PlayerId | null;
      readonly toPermanent: ObjectId | null;
      /**
       * A player and permanents they control when the event happens. Unlike
       * `toPermanent`, this is a live scope rather than a frozen object id.
       */
      readonly toController: PlayerId | null;
      /** Excludes this replacement's own source from a controller-relative permanent scope. */
      readonly excludeSourcePermanent?: true;
      /** Narrows the live permanent half without narrowing the player half. */
      readonly toPermanentCardType: CardKind | null;
      readonly fromSource: ObjectId | null;
      /** A source-card filter that also proves the source is a spell. */
      readonly fromSpellSource: {
        readonly cardTypes: readonly CardKind[];
        readonly colors: readonly Color[];
      } | null;
      /** Applies only when this damage would cross the named recipient life floor. */
      readonly recipientLifeFloor?: number;
      readonly combatOnly: boolean;
    }
  | { readonly kind: 'draw'; readonly player: PlayerId | null }
  | { readonly kind: 'lifeGain'; readonly player: PlayerId | null }
  | {
      readonly kind: 'counterPlacement';
      readonly controller: PlayerId | null;
      readonly counter: CounterKind;
      readonly creatureOnly: boolean;
    }
  | { readonly kind: 'destroy'; readonly oid: ObjectId }
  | {
      readonly kind: 'discard';
      readonly oid: ObjectId;
      readonly player: PlayerId;
      readonly byOpponent: true;
    }
  | {
      readonly kind: 'zoneChange';
      readonly owner: PlayerId | null;
      readonly from: ZoneId | null;
      readonly destination: ZoneId;
      readonly cardOnly: boolean;
    }
  | { readonly kind: 'enters'; readonly oid: ObjectId | null; readonly controller: PlayerId | null };

/** How a matching event is rewritten. */
export type ReplacementModification =
  /** CR 615: prevention. `'all'` is a blanket shield; a number is a pool. */
  | { readonly kind: 'preventDamage'; readonly amount: number | 'all' }
  | { readonly kind: 'addDamage'; readonly amount: number }
  | { readonly kind: 'multiplyDamage'; readonly factor: number }
  | { readonly kind: 'damageToLifeFloor'; readonly minimum: number }
  | { readonly kind: 'redirectDamage'; readonly to: DamageRecipient }
  | { readonly kind: 'skipDraw' }
  | { readonly kind: 'drawAdditional'; readonly extra: number }
  | { readonly kind: 'multiplyLifeGain'; readonly factor: number }
  | { readonly kind: 'multiplyCounterPlacement'; readonly factor: number }
  | { readonly kind: 'putDiscardedOntoBattlefield' }
  | { readonly kind: 'moveToZone'; readonly destination: ZoneId }
  | { readonly kind: 'entersTapped' }
  | { readonly kind: 'regenerate' }
  | {
      readonly kind: 'entersWithCounters';
      readonly counter: 'plusOnePlusOne' | 'minusOneMinusOne' | 'charge';
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
  readonly duration: ReplacementDuration;
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
  /**
   * An additional instruction performed when this damage replacement applies.
   * `amountFrom` distinguishes a consequence of actual prevention from one
   * that still uses the damage event's amount when prevention is impossible.
   */
  readonly damageReplacementFollowUp?:
    | {
        readonly kind: 'removeCounters';
        readonly counter: CounterKind;
        readonly sourceBattlefieldIncarnation: number;
        readonly amountFrom: 'damageEvent';
      }
    | {
        readonly kind: 'dealDamage';
        readonly target: Extract<DamageRecipient, { readonly kind: 'player' }>;
        readonly sourceBattlefieldIncarnation: number;
        readonly amountFrom: 'preventedDamage';
      }
    | {
        readonly kind: 'dealDamage';
        readonly target: Extract<DamageRecipient, { readonly kind: 'permanent' }>;
        readonly sourceBattlefieldIncarnation: number;
        readonly amountFrom: 'preventedDamage';
        /** Retains the planeswalker object targeted when the shield resolved. */
        readonly targetBattlefieldIncarnation: number;
      };
}

/** Does this event's shape match what the effect watches for? */
export function triggerMatches(
  state: GameState,
  effect: ReplacementEffect,
  event: ReplaceableEvent,
): boolean {
  const trigger = effect.trigger;
  switch (trigger.kind) {
    case 'damage': {
      if (event.kind !== 'damage' || event.amount <= 0) return false;
      if (trigger.combatOnly && !event.combat) return false;
      if (trigger.fromSource !== null && trigger.fromSource !== event.sourceOid) return false;
      if (trigger.fromSpellSource !== null) {
        const filter = trigger.fromSpellSource;
        const sourceObject = state.objects[event.sourceOid];
        const sourceCard =
          event.sourceCard ?? (sourceObject?.zone === 'stack' ? copiableCardOf(sourceObject) : undefined);
        if (sourceCard === undefined) return false;
        if (event.controller !== controllerOf(state, effect.sourceOid)) return false;
        if (!printedCardTypes(sourceCard).some((kind) => filter.cardTypes.includes(kind))) {
          return false;
        }
        if (!sourceCard.colors.some((color) => filter.colors.includes(color))) return false;
      }
      if (trigger.recipientLifeFloor !== undefined) {
        if (event.recipient.kind !== 'player') return false;
        const life = state.players[event.recipient.player].life;
        if (life < trigger.recipientLifeFloor || life - event.amount >= trigger.recipientLifeFloor) {
          return false;
        }
      }
      if (trigger.toPlayer !== null) {
        return event.recipient.kind === 'player' && event.recipient.player === trigger.toPlayer;
      }
      if (trigger.toPermanent !== null) {
        return event.recipient.kind === 'permanent' && event.recipient.oid === trigger.toPermanent;
      }
      if (event.recipient.kind === 'player') {
        if (trigger.toController !== null) return event.recipient.player === trigger.toController;
        return trigger.toPermanentCardType === null;
      }
      if (trigger.excludeSourcePermanent === true && event.recipient.oid === effect.sourceOid) return false;
      if (
        trigger.toController !== null &&
        controllerOf(state, event.recipient.oid) !== trigger.toController
      ) {
        return false;
      }
      return (
        trigger.toPermanentCardType === null ||
        hasCardType(state, event.recipient.oid, trigger.toPermanentCardType)
      );
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
    case 'counterPlacement':
      if (event.kind !== 'counterPlacement' || event.count <= 0) return false;
      if (trigger.counter !== event.counter) return false;
      if (trigger.controller !== null && trigger.controller !== event.controller) return false;
      return (
        !trigger.creatureOnly ||
        (event.recipientCard === undefined
          ? hasCardType(state, event.oid, 'creature')
          : printedCardTypes(event.recipientCard).includes('creature'))
      );
    case 'destroy':
      return event.kind === 'destroy' && trigger.oid === event.oid;
    case 'discard':
      return (
        event.kind === 'discard' &&
        event.destination === 'graveyard' &&
        trigger.oid === event.oid &&
        trigger.player === event.player &&
        event.cause !== null &&
        event.cause.controller !== event.player
      );
    case 'zoneChange': {
      if (event.kind !== 'zoneChange') return false;
      const object = state.objects[event.oid];
      return (
        trigger.destination === event.destination &&
        (trigger.owner === null || trigger.owner === event.owner) &&
        (trigger.from === null || trigger.from === event.from) &&
        (!trigger.cardOnly || object?.token === false)
      );
    }
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
    case 'counterPlacement':
      return event.oid;
    case 'destroy':
      return event.oid;
    case 'discard':
      return event.oid;
    case 'zoneChange':
      return event.oid;
    case 'draw':
    case 'lifeGain':
      return null;
  }
}
