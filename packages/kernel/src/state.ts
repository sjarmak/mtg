/**
 * Immutable game state.
 *
 * Every field is `readonly` all the way down and every update returns a new
 * object that structurally shares the untouched branches. That is what makes
 * `fork` O(1): a fork is just another reference to the same frozen graph, so
 * rollouts, MCTS and what-if analysis cost nothing but the pointer (the shape
 * Argentum's `gym` module proves out; see `docs/research/prior-art-engines.md`
 * §4).
 */
import type {
  Ability,
  Card,
  CardFilter,
  CardKind,
  CastableCard,
  Color,
  CounterKind,
  Effect,
  EmblemSpec,
  EntryCharacteristicMode,
  GraveyardArrivalGrant,
  GraveyardChoiceControl,
  GraveyardChoiceDestination,
  InstantCard,
  Keyword,
  ManaColor,
  SearchDestinationPlan,
  SearchFilterQuota,
  SorceryCard,
  TargetFilter,
  TriggeringCreatureCondition,
  TriggeringPlayerCondition,
  TriggeringStackObjectCondition,
} from '@mtg/dsl';
import { MANA_COLORS } from '@mtg/dsl';
import type { ContinuousEffect, Counters } from './continuous';
import type { DamageInstance, DamagePreventionAllocation, DamagePreventionPlan } from './damage-types';
import type { ObjectId, PlayerId } from './ids';
import { PLAYER_IDS } from './ids';
import type { PendingTrigger } from './triggers';
import type { ReplacementEffect } from './replacement-effects';
import type { DetentionRule } from './detention';
import type { DamageRetaliationRule } from './damage-retaliation';
import type { AttackDebuffRule } from './attack-debuff';
import type { RngState } from './rng';

export type ZoneId = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack';

/** Counter kinds accepted by an intrinsic as-entry counter replacement. */
export type EntryCounterKind = Extract<CounterKind, 'plusOnePlusOne' | 'minusOneMinusOne' | 'charge'>;

/** Mana colors plus colorless; the pool is a counter per kind. */
export type { ManaColor } from '@mtg/dsl';
export { MANA_COLORS };

export interface ManaPool {
  readonly W: number;
  readonly U: number;
  readonly B: number;
  readonly R: number;
  readonly G: number;
  readonly C: number;
}

/** Remaining private choices while one mana ability distributes a live amount across colors. */
export interface PendingManaCombination {
  readonly player: PlayerId;
  readonly sourceOid: ObjectId;
  readonly remaining: number;
}

export const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** One persistent emblem controlled by the player who created it. */
export interface Emblem {
  readonly id: string;
  readonly controller: PlayerId;
  readonly spec: EmblemSpec;
}

/**
 * One particular exile incarnation of a card linked to a source.
 *
 * The object id alone is insufficient: this kernel keeps a physical card's id
 * stable across zone changes, while CR 400.7 makes the object that returns to
 * exile a new object. `linkId` is the capability minted for the move this
 * search made; the card carries it only until its next zone change.
 */
export interface LinkedExileReference {
  readonly oid: ObjectId;
  readonly linkId: number;
}

/**
 * One zone change scheduled by a resolved effect for a future step.
 *
 * The physical oid is paired with its exile incarnation because CR 400.7
 * makes a card that leaves exile and later returns a different object. The
 * source values and controller are captured when the effect resolves; neither
 * source survival nor a later control change can rewrite the delayed trigger.
 */
interface DelayedZoneChangeBase {
  readonly id: number;
  readonly sourceOid: ObjectId;
  readonly sourceCard: Card;
  readonly sourceAbilityIndex: number;
  readonly controller: PlayerId;
  readonly targetOid: ObjectId;
  readonly targetIncarnation: number;
  readonly dueTurn: number;
}

export type DelayedZoneChange = DelayedZoneChangeBase &
  (
    | {
        readonly from: 'exile';
        readonly destination: 'battlefield';
        readonly tapped: true;
        readonly under: 'owner';
      }
    | {
        readonly from: 'graveyard';
        readonly destination: 'battlefield';
        readonly tapped: false;
        readonly under: 'controller';
        readonly counter: CounterKind;
        readonly count: number;
        readonly alsoBecomes: GraveyardArrivalGrant;
      }
  );

/** One source-incarnation-bound counter placement due at the next end step. */
export interface DelayedCounterPlacement {
  readonly id: number;
  readonly sourceOid: ObjectId;
  readonly sourceCard: Card;
  readonly sourceAbilityIndex: number;
  readonly controller: PlayerId;
  readonly targetOid: ObjectId;
  readonly targetIncarnation: number;
  readonly dueTurn: number;
  readonly counter: CounterKind;
  readonly count: number;
}

/** One controller-bound copy trigger waiting for the next qualifying cast this turn. */
export interface DelayedSpellCopy {
  readonly id: number;
  readonly sourceOid: ObjectId;
  readonly sourceCard: Card;
  readonly sourceAbilityIndex: number;
  readonly controller: PlayerId;
}

/** The one-shot record plus the exact spell incarnation that caused it to fire. */
export interface DelayedSpellCopyTrigger extends DelayedSpellCopy {
  readonly spellOid: ObjectId;
}

/**
 * A card (or token) in play. `card` is the DSL record and never changes;
 * everything mutable about the object lives beside it, and everything *derived*
 * (power, toughness, keywords) is computed by the layer system in `layers.ts`
 * rather than stored, so continuous effects can never desynchronize.
 */
export interface GameObject {
  readonly oid: ObjectId;
  /** The physical card face, unchanged across every zone and incarnation. */
  readonly card: Card;
  /** Active transformed face while this object is a spell or permanent. */
  readonly faceCard?: CastableCard;
  /**
   * Copiable values established as this permanent entered (CR 707.2).
   *
   * This is a card snapshot rather than a source id: later changes to, or the
   * departure of, the chosen permanent do not change the copy. It exists only
   * on the battlefield incarnation and `moveObject` clears it on every zone
   * change, so blinking the physical Clone exposes its own printed face again.
   */
  readonly copiableCard?: Card;
  /** Player fixed by this battlefield incarnation's as-enters choice. */
  readonly chosenPlayer?: PlayerId;
  /** Card name fixed by this battlefield incarnation's as-enters choice. */
  readonly chosenCardName?: string;
  /** Noncopiable colors fixed by this battlefield incarnation's as-entry choice. */
  readonly chosenColors?: readonly Color[];
  /** Copiable values retained for abilities and triggers after departure. */
  readonly lastKnownCopiableCard?: Card;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  /** Player currently designated to protect this Battle. Battlefield-only. */
  readonly protector?: PlayerId;
  /** This Siege is waiting for its intrinsic defeat trigger to leave the stack. */
  readonly siegeDefeatPending?: true;
  readonly zone: ZoneId;
  /**
   * How many zone changes this physical card has made.
   *
   * The kernel keeps `oid` stable so logs can follow a card, while CR 400.7
   * makes it a new object after every move. This counter distinguishes those
   * rules objects without perturbing the allocator used by stack objects and
   * continuous effects. Absence is the initial incarnation (`0`) so stored
   * positions from before this field remain byte-identical until a card moves.
   */
  readonly incarnation?: number;
  /**
   * CR 613.7 timestamp of this battlefield incarnation.
   *
   * Present exactly while the object is on the battlefield. A zone change
   * clears it, and every later entry mints a new value from `GameState.nextId`,
   * so derived static effects keep their true order even when the battlefield
   * array shrinks or a copied ability supplies the effect.
   */
  readonly battlefieldTimestamp?: number;
  /** Exile incarnations this battlefield incarnation linked to itself. */
  readonly linkedExile?: readonly LinkedExileReference[];
  /** Source-linked exile retained across one battlefield departure for LKI. */
  readonly lastKnownLinkedExile?: readonly LinkedExileReference[];
  /** Capability proving this exact exile incarnation is still source-linked. */
  readonly linkedExileId?: number;
  readonly token: boolean;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
  readonly damage: number;
  /** True once any damage from a deathtouch source has been marked this turn. */
  readonly deathtouched: boolean;
  /** Counters on the permanent; they change P/T in layer 7d (CR 613.4d). */
  readonly counters: Counters;
  /**
   * The permanent this one is attached to (CR 301.5), absent when it is
   * attached to nothing.
   *
   * Optional rather than a required `ObjectId | null`, which is `Counters`'
   * reasoning one field out: every object written before attachment existed
   * canonicalizes byte-identically after it, so no `stateFingerprint`, no
   * replay and no stored position moved because the kernel learned a new word.
   * Absence is also the honest spelling — an unattached Equipment is not
   * attached to a null permanent — and `exactOptionalPropertyTypes` makes the
   * kernel say so by omitting the key rather than assigning `undefined`, which
   * `detached` (`attach.ts`) is the one owner of.
   *
   * It is battlefield status like `tapped` and `counters`, so CR 400.7 resets
   * it on every zone change; `moveObject` does that for the same reason it
   * clears damage.
   */
  readonly attachedTo?: ObjectId;
  /**
   * Set while this permanent owes one skipped untap step (CR 302.6's other
   * half): the "it doesn't untap during its controller's next untap step" a
   * spell like Frost Breath or Sleep prints beside its tap.
   *
   * `true` or absent rather than a boolean, and optional rather than a required
   * `boolean`, for `attachedTo`'s reason at the field above: `false` and absent
   * would be two spellings of one state, and every object written before the
   * kernel learned this word canonicalizes byte-identically after it, so no
   * `stateFingerprint`, no replay and no stored position moved.
   *
   * It is consumed by the untap step whether or not it prevented anything, so a
   * permanent that was bounced back and recast, or untapped by something else
   * first, does not carry the debt into a later turn.
   *
   * Battlefield status like `tapped` and `counters`, so CR 400.7 resets it on
   * every zone change; `moveObject` deletes it where it deletes
   * `loyaltyActivatedTurn`.
   */
  readonly skipsNextUntap?: true;
  /** Turn number this permanent last paid a loyalty cost; reset only by a zone change. */
  readonly loyaltyActivatedTurn?: number;
  /** Ability indexes with a printed once-each-turn limit and their last-used turn. */
  readonly activationLimitedTurns?: Readonly<Record<number, number>>;
  /** Layer-derived characteristics retained across one battlefield departure for LKI. */
  readonly lastKnownSourceCharacteristics?: SourceCharacteristics;
  /** Layer-derived non-keyword abilities retained across one battlefield departure for LKI. */
  readonly lastKnownAbilities?: readonly Ability[];
  /** Layer-derived controller retained across one battlefield departure for LKI. */
  readonly lastKnownController?: PlayerId;
}

export interface SourceCharacteristics {
  readonly colors: readonly Color[];
  readonly subtypes: readonly string[];
  /** Layer-6 keywords relevant when this source later deals damage. */
  readonly keywords?: readonly Keyword[];
}

export type Target =
  | { readonly kind: 'player'; readonly player: PlayerId }
  | { readonly kind: 'permanent'; readonly oid: ObjectId }
  | { readonly kind: 'card'; readonly oid: ObjectId }
  | { readonly kind: 'spell'; readonly oid: ObjectId };

/** Positive per-target damage shares, keyed by effect-list index. */
export type DamageAllocations = Readonly<Record<number, readonly number[]>>;

/** Which mutually exclusive CR 601.2f casting price the player announced. */
export type CastingCostChoice = 'mana' | 'alternative' | 'overload' | 'withoutMana';

/** A cast or trigger whose plural members and damage shares are being collected. */
export interface PendingPluralTargets {
  readonly origin: 'cast' | 'activation' | 'trigger';
  readonly player: PlayerId;
  /** Card object for a cast; ability object for a trigger. */
  readonly oid: ObjectId;
  readonly targets: readonly (Target | null)[];
  readonly multiTargets: Readonly<Record<number, readonly Target[]>>;
  readonly damageAllocations: DamageAllocations;
  /** Plural slots whose member selection is finished. */
  readonly finishedTargetSlots: readonly number[];
  readonly x?: number;
  readonly mode?: number;
  readonly castingCost?: CastingCostChoice;
  readonly sacrifices?: readonly ObjectId[];
  readonly abilityIndex?: number;
  readonly taps?: readonly ObjectId[];
  /** Cards paid by a staged cast or activation's discard cost. */
  readonly discards?: readonly ObjectId[];
}

/**
 * A triggered ability on the stack (CR 113.7a): an object that is not a card.
 * `sourceOid` names the permanent whose printed text it came from, which may
 * already have left the battlefield — CR 608.2 resolves it anyway.
 */
export interface AbilityOnStack {
  readonly sourceOid: ObjectId;
  /** Index into the source card values retained by its `StackEntry`. */
  readonly index: number;
}

/**
 * Event data a triggered ability must retain without turning it into a target.
 *
 * Exalted refers back to the lone attacker that caused it to trigger,
 * `selfDealsCombatDamageToCreature` refers back to the creature that took the
 * damage, `selfBlocksCreature` refers back to the attacker in one block pairing,
 * and `selfBlocksOrIsBlockedByGreaterPower` refers back to the larger creature
 * on the other side of the block. CR 115 targets none of them, so this data must
 * never share the `StackEntry.targets` tuple whose members are chosen,
 * displayed, and rechecked as targets.
 *
 * `kind` is the condition that retained the referent, taken from the DSL's
 * `TRIGGERING_CREATURE_CONDITIONS` rather than spelled out again. This file
 * carried its own copy of that list for one commit and the replay log schema
 * carried a third; the schema's went stale the day the kernel gained
 * `selfBlocksOrIsBlockedByGreaterPower`, and the first game that put one on the
 * stack would not load. One list, in the package all three readers depend on.
 */
export type TriggerContextKind =
  | TriggeringCreatureCondition
  | TriggeringPlayerCondition
  | TriggeringStackObjectCondition
  | 'selfIsDealtDamage';

/** Trigger conditions created by the rules rather than authored card text. */
export type IntrinsicTriggerCondition = 'siegeDefeated';

export type TriggerContext =
  | {
      readonly kind: TriggeringCreatureCondition;
      readonly triggeringCreature: ObjectId;
      /** CR 400.7 identity of the battlefield object that caused the trigger. */
      readonly triggeringCreatureIncarnation: number;
      /** Event-retained LKI for effects that read that creature's power. */
      readonly triggeringCreaturePower?: number;
      /** Event-retained LKI for effects that read that creature's toughness. */
      readonly triggeringCreatureToughness?: number;
      /** Final post-replacement damage retained by a creature-damage event. */
      readonly triggeringDamageAmount?: number;
    }
  | {
      readonly kind: TriggeringStackObjectCondition;
      readonly triggeringStackObject: ObjectId;
    }
  | {
      readonly kind: Exclude<TriggeringPlayerCondition, 'selfDealsCombatDamageToPlayer'>;
      readonly triggeringPlayer: PlayerId;
      /** Tablet's cast-time intersection, retained before the spell can leave the stack. */
      readonly triggeringSpellChosenColorCount?: number;
      /** Soul Tithe's last attached host when its upkeep trigger fired. */
      readonly enchantedPermanent?: ObjectId;
      readonly enchantedPermanentIncarnation?: number;
    }
  | {
      readonly kind: 'selfDealsCombatDamageToPlayer';
      readonly triggeringPlayer: PlayerId;
      /** Final post-replacement amount, retained only when an effect reads it. */
      readonly triggeringDamageAmount?: number;
    }
  | {
      readonly kind: 'selfIsDealtDamage';
      readonly triggeringDamageAmount: number;
      readonly chosenPlayer: PlayerId;
      /** Present only on a created retaliation trigger. */
      readonly triggeringCreature?: ObjectId;
      readonly triggeringCreatureIncarnation?: number;
      readonly triggeringCreaturePower?: number;
      readonly triggeringCreatureToughness?: number;
    };

/**
 * One object on the stack. `targets` is parallel to `card.effects`: index `i`
 * holds the target chosen for effect `i`, or `null` when that effect needs
 * none. Targets are locked in at cast time and rechecked on resolution.
 *
 * One nullable field rather than a union, because a union would widen
 * `popStackEntry`, the counterSpell target list, `isTargetStillLegal`'s stack
 * scan and `removeFromZone`'s stack case for one bit of information. `ability`
 * is `null` for a spell; non-null makes the entry an ability, and its `oid` is
 * an `ab<n>` with no `GameObject` behind it.
 */
export interface StackEntry {
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly targets: readonly (Target | null)[];
  /** Battlefield incarnation chosen for each ordinary permanent target. */
  readonly targetIncarnations?: readonly (number | null)[];
  /**
   * Chosen members for a plural target slot, including both bounded `count`
   * and `anyNumber`, keyed by the same effect-list index `targets` is parallel
   * to. `targets[i]` stays `null` for a plural slot —
   * "no single target" is true of it either way — so every generic reader of
   * `targets` (`popStackEntry`, the counterSpell scan, narration, projection,
   * the cast UI) keeps seeing the ordinary "no target" shape it already
   * handles instead of a fourth `Target` kind it would have to be taught
   * about. Only the places that resolve a plural slot's *effect* read
   * this map: `stack.ts`'s `planResolution` (CR 608.2b's per-member recheck)
   * and `effects.ts`'s `tapPermanent` apply. A slot with no entry here, or an
   * entry that is `[]` ("chose none of the up to two"), is not a special
   * case either function has to guess at — both already treat "nothing to
   * do" as the empty case.
   */
  readonly multiTargets?: Readonly<Record<number, readonly Target[]>>;
  /** Battlefield incarnation chosen for each plural permanent target member. */
  readonly multiTargetIncarnations?: Readonly<Record<number, readonly (number | null)[]>>;
  /** Per-member shares for plural damage divided as its controller chooses. */
  readonly damageAllocations?: DamageAllocations;
  readonly ability: AbilityOnStack | null;
  /** Copiable source card values captured when this ability joined the stack. */
  readonly sourceCard?: Card;
  /**
   * The mode chosen for a modal spell or activated ability (CR 700.2), by index
   * into its `modes`; `null` when no mode was announced. Fixed once the stack
   * object is pushed (`pushSpell` or `pushAbility`),
   * the same way `targets` is — `@mtg/dsl`'s `spellEffectsFor` is the one
   * place that reads it back with the selected casting profile.
   */
  readonly mode: number | null;
  /** Retained event referents for a trigger; null for spells and activations. */
  readonly triggerContext: TriggerContext | null;
  /**
   * The value announced for this object's `{X}`; `null` when it printed none.
   *
   * Both kinds of announcement land here and the field deliberately does not
   * record which: a spell announces X as it is cast (CR 601.2b) and an
   * activated ability as it is activated (CR 602.2b routes an activation
   * through the same CR 601.2 steps), and by the time either is on the stack
   * the number has been chosen and paid. `mtg-nhyv.17` is when the second kind
   * started arriving — before it, an activation always banked `null` here and
   * `applyResolution` passed a hardcoded one on to the effects, which is the
   * line that had to change for Silklash Spider to deal the damage it prints.
   * A triggered ability still banks `null`, because it has no cost and nobody
   * announces anything as it goes on the stack.
   */
  readonly x: number | null;
  /** Alternate spell-effect/cost profile fixed as the spell was cast. */
  readonly castingCost?: CastingCostChoice;
  /** CR 608.2b source qualities captured while a permanent source still existed. */
  readonly sourceCharacteristics: SourceCharacteristics | null;
  /** Layer-derived LKI of the sole permanent sacrificed to cast or activate this object. */
  readonly paidSacrificePower?: number;
  /** Layer-derived toughness LKI of that same paid permanent. */
  readonly paidSacrificeToughness?: number;
  /** Mana value fixed before the sole discarded activation cost leaves hand. */
  readonly paidDiscardManaValue?: number;
  /**
   * The battlefield incarnation of an ability's source when it triggered or
   * was activated. A live source-body relation survives only while this equals
   * the current object's incarnation.
   */
  readonly sourceBattlefieldIncarnation?: number;
  /** Exact source incarnation in its zone when this stack object was created. */
  readonly sourceIncarnationAtStackCreation?: number;
  /** Source-linked exile captured as a trigger fired, before its source moved on. */
  readonly sourceLinkedExile?: readonly LinkedExileReference[];
  /** A one-shot delayed zone change resolving through ordinary stack rules. */
  readonly delayedZoneChange?: DelayedZoneChange;
  /** CR 310.11b's intrinsic Siege defeat trigger, not printed card text. */
  readonly siegeDefeat?: true;
  /** A one-shot delayed counter placement resolving through ordinary stack rules. */
  readonly delayedCounterPlacement?: DelayedCounterPlacement;
  /** A one-shot delayed spell-copy trigger resolving through ordinary stack rules. */
  readonly delayedSpellCopy?: DelayedSpellCopyTrigger;
  /** A copied spell has no card object in a zone, so it retains its copiable card here. */
  readonly copiedSpell?: {
    readonly card: InstantCard | SorceryCard;
    readonly copiedFrom: ObjectId;
    readonly sourceOid: ObjectId;
  };
}

/**
 * What a resolution has done so far, banked so a pause cannot lose it.
 *
 * Every amount that counts a span of one resolution reads the event log from a
 * `ResolutionMark`, and a resolution that stops to ask a question resumes in a
 * later `reduce` whose log starts empty (`beginTrace`). So the pre-pause half
 * of every such count has to cross the pause on the state, and it crosses as
 * one record rather than as a field per amount: the four fields here are read
 * by the two exile tallies, `damageDealtThisResolution`, and
 * `lifeLostThisResolution`; they are threaded through the same twenty call
 * sites in `scry.ts`, and another amount of this shape adds a field here
 * instead of a parameter to all twenty.
 *
 * Counts, not marks. A mark is an index into `trace.events` and the events that
 * answer "the number of cards exiled this way" are in the previous reduction,
 * where no index in this one can reach them.
 */
export interface ResolutionTally {
  /** Cards — never tokens — this resolution has put into exile. */
  readonly exiled: number;
  /** Permanents moved from the battlefield to exile, including tokens. */
  readonly exiledPermanents: number;
  /** Cards moved from a graveyard to a library during this resolution. */
  readonly graveyardCardsShuffled?: number;
  /** Damage this resolution has dealt, after prevention and CR 614 replacement. */
  readonly damage: number;
  /** Life lost directly this resolution, excluding damage. */
  readonly lifeLost: number;
  /** Permanents actually sacrificed earlier in this resolution. */
  readonly sacrificedPermanents?: number;
  /** Layer-derived LKI when one earlier resolving instruction sacrificed a permanent. */
  readonly sacrificedPermanentPower?: number;
}

/** A resolution that has done nothing yet, and what every unpaused caller passes. */
export const NOTHING_TALLIED: ResolutionTally = {
  exiled: 0,
  exiledPermanents: 0,
  graveyardCardsShuffled: 0,
  damage: 0,
  lifeLost: 0,
  sacrificedPermanents: 0,
};

/** One still-unapplied slot in a resolution interrupted by scry. */
export interface PendingResolutionEffect {
  readonly effect: Effect;
  /** Apply only after this resolution actually sacrificed a permanent. */
  readonly requiresSacrificeThisResolution?: true;
  readonly target: Target | null;
  /** Surviving members for a plural slot; see `StackEntry.multiTargets`. */
  readonly multiTarget?: readonly Target[];
  /** Shares paired by index with `multiTarget`. */
  readonly damageAllocation?: readonly number[];
  /** Layer-derived LKI for an amount that reads an earlier creature target. */
  readonly referentToughness?: number;
  /** Earlier legal player target retained for a live hand-size reading. */
  readonly referentPlayer?: PlayerId;
  /** Earlier creature target retained when a later cohort says “other.” */
  readonly referentOid?: ObjectId;
  /** Live-or-LKI power retained from the creature that caused this trigger. */
  readonly triggeringCreaturePower?: number;
  /** Live-or-LKI toughness retained from the creature that caused this trigger. */
  readonly triggeringCreatureToughness?: number;
  /** Final post-replacement damage retained from the triggering event. */
  readonly triggeringDamageAmount?: number;
  readonly triggeringSpellChosenColorCount?: number;
  /** Source-linked exile captured by the enclosing trigger. */
  readonly sourceLinkedExile?: readonly LinkedExileReference[];
  /** The source incarnation that must still be current when this effect applies. */
  readonly sourceBattlefieldIncarnation?: number;
  /** Source provenance retained even when the ability no longer has a live source relation. */
  readonly sourceIncarnationAtStackCreation?: number;
  /** Layer-derived LKI retained from a spell or ability's paid sacrifice. */
  readonly paidSacrificePower?: number;
  /** Layer-derived toughness LKI retained from a spell or ability's paid sacrifice. */
  readonly paidSacrificeToughness?: number;
  /** Mana value retained from a card discarded to pay an activation. */
  readonly paidDiscardManaValue?: number;
  /** Source values retained only for an effect that creates a delayed record. */
  readonly delayedSourceCard?: Card;
  /** Printed ability index, or zero for an effect on a spell card. */
  readonly sourceAbilityIndex?: number;
  /** Damage-relevant source LKI retained across resolution pauses. */
  readonly sourceCharacteristics?: SourceCharacteristics;
}

/**
 * The resolution continuation a scry decision temporarily owns.
 *
 * `cards` is exactly the visible top window, never the whole library. The
 * spell has already left the stack list but its card object remains in the
 * stack zone until `objectToGraveyard` is finalized after the remaining
 * effects. Abilities and copied spells carry `null` there.
 */
export interface PendingScry {
  readonly player: PlayerId;
  /** The printed scry number, even when the library holds fewer cards. */
  readonly count: number;
  readonly cards: readonly ObjectId[];
  readonly sourceOid: ObjectId;
  /** Copiable source retained only when the resolving spell is a copy. */
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  /** What this resolution had already done when the scry stopped it. */
  readonly tally: ResolutionTally;
  /** Triggers raised before this in-resolution choice, held until resolution ends. */
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** A bounded top-library question and its banked resolution continuation. */
export interface PendingTopLibrary {
  readonly player: PlayerId;
  readonly chooser: PlayerId;
  readonly kind: 'order' | 'select' | 'partition' | 'pile';
  readonly cards: readonly ObjectId[];
  readonly eligible?: readonly ObjectId[];
  /** Where an unchosen selection window goes; absent means the legacy bottom path. */
  readonly selectionRest?: 'bottom' | 'graveyard';
  /** The whole selection window was revealed rather than privately looked at. */
  readonly selectionPublic?: true;
  readonly piles?: readonly [readonly ObjectId[], readonly ObjectId[]];
  /** Destination for the pile the controller did not choose; absent is graveyard. */
  readonly pileRest?: 'bottom';
  /** Which edge receives an explicitly ordered group. */
  readonly orderDestination?: 'bottom';
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
  /** Guild Feud's ordered opponent/you selections, including an entry-choice pause. */
  readonly guildFeud?: {
    readonly phase: 'opponentSelection' | 'opponentEntry' | 'controllerSelection' | 'controllerEntry';
    readonly opponent: PlayerId;
    readonly chosen?: ObjectId;
    readonly firstCreature?: { readonly oid: ObjectId; readonly incarnation: number };
  };
}

/** A resolving Redirect or Reverberate waiting for its final target tuple. */
export interface PendingSpellTargets {
  /** The player who controls the resolving target-changing effect. */
  readonly player: PlayerId;
  /** The original spell whose targets are read, changed, or copied. */
  readonly spell: ObjectId;
  readonly operation: 'changeSpellTargets' | 'copySpell';
  readonly sourceOid: ObjectId;
  /** Copiable source retained only when the resolving spell is itself a copy. */
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** A resolving effect waiting for the revealed card's complete cast declaration. */
export interface PendingFreeCast {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  /** Zone the resolving permission expects this exact incarnation to occupy. */
  readonly from: 'hand' | 'exile';
  /** Active card face the permission casts; absent means the physical front. */
  readonly card?: CastableCard;
  /** Exiled originals whose transient card copies may be cast in either order. */
  readonly copyCandidates?: readonly PendingCardCopyCast[];
  /** Exiled original spells from one bounded top-library batch, cast in any order. */
  readonly originalCandidates?: readonly PendingOriginalFreeCast[];
  /** Every exact exiled incarnation the same batch must clean up if still present. */
  readonly cleanupExileBatch?: readonly PendingExiledBatchCard[];
  /** Whether declining is a legal answer to this permission. */
  readonly optional?: true;
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** One exiled original and the copiable values fixed when its copy was made. */
export interface PendingCardCopyCast {
  readonly oid: ObjectId;
  readonly incarnation: number;
  readonly card: InstantCard | SorceryCard;
}

/** One castable original and its exact exile incarnation. */
export interface PendingOriginalFreeCast {
  readonly oid: ObjectId;
  readonly incarnation: number;
  readonly card: CastableCard;
}

/** One member of a resolving effect's fixed exile batch. */
export interface PendingExiledBatchCard {
  readonly oid: ObjectId;
  readonly incarnation: number;
}

/**
 * The resolution continuation a library search temporarily owns.
 *
 * Every field after `cards` is `PendingScry`'s, carried for the identical
 * reason and documented there: the effects that have not run yet, the chosen X,
 * the object headed for a graveyard, the `ResolutionTally` that a later
 * `exiledThisResolution` or `damageDealtThisResolution` amount would otherwise
 * read as zero, and the triggers held until the resolution ends. The two records are separate types rather
 * than one shared continuation with a question attached, because a shared
 * record would let a `reduce` arm answer the wrong question against a state
 * that typechecks — the same discriminant argument `@mtg/engine`'s
 * `RecordedBackend` / `ObservedBackend` split makes.
 *
 * `cards` is exactly the cards the filter matched, in library order, and never
 * the whole library. That is not an optimization: it is what the searching seat
 * is shown (`visibility.ts` un-conceals precisely this list), so a record
 * holding the whole library would be a projection rule away from handing a seat
 * its own deck order.
 *
 * `destination` is where the found cards go. It is on the record rather than
 * re-read off the effect, because the effect is no longer in `remaining` by the
 * time the answer arrives — the runner banks what is left *after* the step it
 * stopped on. `count`, `reveal` and `taken` cross the pause for the same reason
 * and are the same fact about the step that stopped.
 *
 * **A multi-card search is several pauses and one record, not one pause with a
 * wide answer.** `Action.searchLibrary` names one card, and it stayed that way:
 * a search for two answered as an unordered pair would need the whole
 * `combinations` enumeration `chooseDiscards` pays for — binomial in the
 * library rather than in a hand — and would renumber every recorded
 * single-card search's option index. So the record holds `taken`, the cards
 * chosen so far in library order, and the runner re-pauses until `count` is met
 * or the seat declines. `cards` is narrowed on each re-pause to the matches
 * *after* the last one taken, which is `selectionPool`'s rule at a different
 * zone: choosing two of twelve in either order is one selection and must not be
 * two routes to it.
 *
 * Nothing moves until the last answer. CR 701.19 is one action — look, take,
 * shuffle — so a search for two that stops halfway is still a search that took
 * what it took, and a card already in a hand while its sibling is still being
 * chosen would be visible to a seat mid-action and would shrink the library the
 * remaining question is asked against.
 */
export interface PendingSearch {
  /** The seat choosing which matching cards the search finds. */
  readonly player: PlayerId;
  /** Whose library is being searched and shuffled; normally the chooser's. */
  readonly libraryOwner: PlayerId;
  readonly cards: readonly ObjectId[];
  readonly destination: SearchDestinationPlan;
  /**
   * The restriction a homogeneous search stated, so a surface can print it.
   *
   * `mtg-la2p`. Absent on a heterogeneous search, whose current restriction is
   * `activeFilterQuota.filter` and whose later ones are in
   * `remainingFilterQuotas`; the effect schema admits exactly one of the two, so
   * between this field and that one the restriction is always on the record.
   * It is carried rather than re-derived from the source card because a source
   * that reaches two searches leaves a reader nothing to disambiguate them with,
   * and because a triggered search's source is a permanent whose effects a
   * card-level walk does not reach.
   */
  readonly filter?: CardFilter;
  /** How many cards this search still wants, resolved when it paused. */
  readonly count: number;
  /** CR 701.16a: whether the cards taken are shown to both seats. */
  readonly reveal: boolean;
  /** Whether CR 701.19b permits this search to fail to find a matching card. */
  readonly mayFail: boolean;
  /** Cards taken so far, in library order; empty on the first pause. */
  readonly taken: readonly ObjectId[];
  /** Current heterogeneous quota; absent for the original homogeneous search. */
  readonly activeFilterQuota?: SearchFilterQuota;
  /** Quotas after the current one, preserved in printed order. */
  readonly remainingFilterQuotas?: readonly SearchFilterQuota[];
  /** Cards already assigned to the current quota. */
  readonly activeFilterQuotaTaken?: number;
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
  /** This search may attach its result only to this still-current source incarnation. */
  readonly sourceBattlefieldIncarnation?: number;
  /** Jace's later libraries, searched by this same controller in player order. */
  readonly jaceArchitectOwnersRemaining?: readonly PlayerId[];
  /** Exact castable originals already exiled by earlier searches in that sequence. */
  readonly jaceArchitectExiled?: readonly PendingOriginalFreeCast[];
}

/**
 * The resolution continuation a CR 701.8 discard temporarily owns.
 *
 * **One record for two effect kinds, which is the opposite of the choice
 * `PendingScry` and `PendingSearch` made, and the reason is the same rule read
 * the other way.** Those two are separate types because they carry different
 * fields — a scry has a count and an order, a search has a filter, a
 * destination and one card or none — so a shared record would let a `reduce`
 * arm answer the wrong question against a state that typechecks. `discardCards`
 * and `chooseDiscard` carry *identical* fields: a hand, a count, and who is
 * being asked. Splitting them would make two types with one shape, which no
 * discriminant protects and every reader has to learn are the same thing.
 *
 * What differs between them is data on this record rather than the record's
 * identity:
 *
 *  - `player` is the seat being asked. `discardCards` asks the hand's owner
 *    (CR 701.8a: the discarding player chooses); `chooseDiscard` asks the
 *    effect's controller.
 *  - `owner` is whose hand the cards leave, and therefore whose graveyard they
 *    land in. The two are equal for `discardCards` and never equal for
 *    `chooseDiscard`, whose target kinds name an opponent.
 *  - `revealed` records that CR 701.16a already showed the hand to both
 *    players, which is what makes it legal to offer a seat a decision naming
 *    cards in the other seat's hidden zone.
 *
 * `cards` is the hand as it stood when the resolution stopped, banked rather
 * than re-read when the answer arrives. That is the load-bearing half of the
 * reveal: a chooser is picking from what they were shown, and a hand that
 * changed in between would leave the two lists disagreeing.
 *
 * `count` is already bounded by the hand — CR 701.8a discards as many as
 * possible when the printed number is larger — so nothing downstream has to ask
 * again whether the number is payable.
 *
 * Every field after `revealed` is `PendingScry`'s, carried for the identical
 * reason and documented there.
 */
/**
 * The resolution continuation a graveyard choice temporarily owns.
 *
 * `PendingSearch`'s fields with the library swapped for a graveyard, and the
 * one difference that matters is not a field at all: **nothing here is
 * concealed**. A library is hidden, so `PendingSearch.cards` is exactly what
 * the searching seat is shown and the record is stripped from the other seat's
 * projection; a graveyard is a public zone (CR 400.2), so the same list names
 * cards both players could already read off the table and no projection rule
 * has anything to remove. That is why this record is absent from
 * `visibility.ts` while the other three are in it, and why a reviewer looking
 * for the missing arm should find this sentence instead of adding one.
 *
 * `player` is the seat being asked and is always this resolution's
 * `controller`, which is one field more than the data strictly needs. It is
 * here because `PendingHandDiscard` proves the two come apart — a
 * `chooseDiscard` asks the controller about somebody else's hand — so a
 * decision that read `controller` to find out who owes an answer would be
 * right by coincidence rather than by construction.
 *
 * `cards` is the matching cards in both graveyards, in seat order, banked at
 * the pause rather than re-derived when the answer arrives: `legal.ts`
 * enumerated the options from this list, so a card that left the graveyard in
 * between is still a card the chooser was offered.
 *
 * `destination` is on the record for `PendingSearch`'s stated reason — the
 * effect is no longer in `remaining` by the time the answer arrives. `control`
 * and `alsoBecomes` are here for that reason and no other: both are read at the
 * moment the chosen card arrives, and by then the effect that printed them is
 * gone. Both are optional and absent means the printed default — the card
 * arrives under its owner's control and gains nothing — so every record written
 * before Rise from the Grave existed still says what it said.
 *
 * Every field after `alsoBecomes` is `PendingScry`'s, carried for the identical
 * reason and documented there.
 */
export interface PendingGraveyardChoice {
  readonly player: PlayerId;
  readonly cards: readonly ObjectId[];
  /**
   * The restriction the effect stated, so a surface can print it (`mtg-la2p`).
   *
   * `chooseFromGraveyard` always states one, so this is not optional the way
   * `PendingSearch.filter` is.
   */
  readonly filter: CardFilter;
  readonly destination: GraveyardChoiceDestination;
  readonly control?: GraveyardChoiceControl;
  readonly alsoBecomes?: GraveyardArrivalGrant;
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/**
 * A mandatory, non-targeted choice among the resolving controller's filtered
 * permanents. The candidate list is public and frozen when resolution reaches
 * the effect; the answer still rechecks zone, controller, incarnation, and
 * filter so a constructed action cannot move an ineligible object.
 */
export interface PendingBattlefieldChoice {
  readonly player: PlayerId;
  readonly permanents: readonly PendingPermanentUntapChoice[];
  readonly filter: TargetFilter;
  readonly destination: 'hand';
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** A frozen creature-token candidate retains the battlefield incarnation that was offered. */
export interface PendingPopulateCandidate {
  readonly oid: ObjectId;
  readonly incarnation: number;
}

/** CR 701.30's mandatory, non-targeting token choice and its resolution continuation. */
export interface PendingPopulate {
  readonly player: PlayerId;
  readonly tokens: readonly PendingPopulateCandidate[];
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/**
 * CR 701.17's question: which filtered permanents a resolving
 * `sacrificePermanent` takes, asked of each affected player rather than the
 * caster.
 *
 * `PendingGraveyardChoice`'s shape with the graveyard swapped for the
 * battlefield, and the same reasoning carries: the battlefield is a public
 * zone (CR 403.2's zone list, same footing as CR 400.2's graveyard), so
 * nothing here is concealed and this record has no arm in `visibility.ts`
 * either. `player` is who answers: the target of an edict or the current seat
 * in an APNAP sweep. `sacrificeSelf` never needed this field because its
 * answerer is fixed at print time, while both of these forms are not.
 *
 * `permanents` is the answering player's filtered candidates at the moment of the pause,
 * banked rather than re-derived when the answer arrives, for
 * `PendingGraveyardChoice.cards`'s stated reason: `legal.ts` enumerated the
 * options from this list, so a permanent that left the battlefield in between
 * is still one the chooser was offered — `validatePermanentSacrifice`
 * re-checks the chosen id against current state regardless, the same
 * belt-and-suspenders `validateKeepLegend` applies to a legend-rule choice.
 *
 * No `owner`/chooser split: unlike `chooseDiscard`, which lets the caster's
 * side name what leaves an opponent's hand, no effect in this vocabulary lets
 * one player choose which of another player's permanents is sacrificed — CR
 * 701.17a fixes that choice with the permanent's controller, so `player` is
 * both who is asked and whose board `permanents` was read from.
 *
 * No "decline" option: unlike a graveyard choice, which CR 701.19a lets a
 * search-adjacent effect leave unanswered, a sacrifice is mandatory once a
 * legal candidate exists, so `permanentSacrificeDecision` never offers a null
 * choice the way `graveyardChoiceDecision` does — the pause only happens at
 * all because `applyResolutionEffects` auto-resolves the zero- and
 * fully-forced cases without asking, mirroring `discardCards`'s "forced when
 * choosable.length <= count" branch. For a player sweep, every seat's list is
 * frozen before the first question and `chosen` banks all answers until every
 * seat has finished, as CR 101.4 requires.
 *
 * Every field after `permanents` is `PendingGraveyardChoice`'s, carried for
 * the identical reason and documented there.
 */
export interface PendingPermanentSacrificeGroup {
  readonly player: PlayerId;
  readonly permanents: readonly ObjectId[];
  readonly count: number;
}

export interface PendingPermanentSacrificeChoice {
  readonly oid: ObjectId;
  readonly player: PlayerId;
}

export interface PendingPermanentSacrifice {
  readonly player: PlayerId;
  readonly permanents: readonly ObjectId[];
  /** How many more of this player's candidates must be named. */
  readonly remainingCount: number;
  /** Candidate groups still to choose after `player`, frozen in APNAP order. */
  readonly remainingGroups: readonly PendingPermanentSacrificeGroup[];
  /** Choices banked across seats; no permanent moves until all seats finish. */
  readonly chosen: readonly PendingPermanentSacrificeChoice[];
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** A resolving group untap stopped while its controller selects a public set. */
export interface PendingPermanentUntapChoice {
  readonly oid: ObjectId;
  /** Battlefield incarnation offered by the resolving spell. */
  readonly incarnation: number;
}

export interface PendingPermanentUntap {
  /** Canonical suffix of frozen candidates still available to choose. */
  readonly permanents: readonly PendingPermanentUntapChoice[];
  readonly chosen: readonly PendingPermanentUntapChoice[];
  readonly remainingCount: number;
  /** Rechecked at every answer and again when the chosen group is applied. */
  readonly filter: TargetFilter;
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** One APNAP answer already banked by a resolving card-name instruction. */
export interface ChosenCardName {
  readonly player: PlayerId;
  readonly name: string;
}

/** A resolution stopped while each player chooses a card name. */
export interface PendingCardNameChoice {
  readonly player: PlayerId;
  readonly remainingPlayers: readonly PlayerId[];
  readonly chosen: readonly ChosenCardName[];
  /** Present only for the closed nonland-name opponent-zone exile operation. */
  readonly targetPlayer?: PlayerId;
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** A named three-zone search stopped while its caster chooses a canonical subset. */
export interface PendingNamedZoneExile {
  readonly player: PlayerId;
  readonly targetPlayer: PlayerId;
  readonly name: string;
  readonly candidates: readonly ObjectId[];
  readonly chosen: readonly ObjectId[];
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/**
 * CR 701.8's question, and the one pending record that carries two card lists.
 *
 * `cards` is what the chooser was *shown* and `choosable` is what they may
 * *name*, and they are the same list on every card that does not print a
 * filter. `PendingSearch` needs only one because a search shows the searcher
 * exactly the cards it may take; CR 701.16a reveals a whole hand, and Duress
 * then constrains the choice to part of it, so the two questions come apart on
 * the first card that prints the narrow half.
 *
 * Which list a reader wants follows from which surface they are: `cards` is the
 * *leak* surface, so `visibility.ts` un-conceals it for the chooser and nothing
 * else, and `choosable` is the *decision* surface, so `legal.ts` enumerates the
 * options from it and `Decision.hand` is it. Collapsing them one way hides
 * cards the reveal already showed, and the other way offers cards the printed
 * sentence refuses — and the second is the bug the two-list shape exists to
 * make unrepresentable: `validateAction`, `asksInSteps` and both simulator bots
 * build a `chooseDiscards` out of `Decision.hand`, so a `hand` holding refused
 * cards is four callers minting illegal actions rather than one.
 *
 * `count` is clamped against `choosable` and not against `cards`, because CR
 * 701.8a's "as many as possible" counts the cards that can actually be
 * discarded. A hand of six with two legal cards and a printed count of two
 * discards both without asking, exactly as a hand of two does.
 */
export interface PendingHandDiscard {
  readonly player: PlayerId;
  readonly owner: PlayerId;
  readonly count: number;
  readonly cards: readonly ObjectId[];
  /** The subset of `cards` the printed filter allows; equal to `cards` when there is none. */
  readonly choosable: readonly ObjectId[];
  readonly revealed: boolean;
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** The common tail banked by a decision that pauses an effect mid-resolution. */
export interface PendingResolutionContinuation {
  readonly sourceOid: ObjectId;
  readonly sourceCard?: InstantCard | SorceryCard;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/** A stack-using mana effect waiting for its controller to choose one printed color. */
export interface PendingManaColorChoice extends PendingResolutionContinuation {
  readonly player: PlayerId;
  readonly colors: readonly ManaColor[];
  readonly effect: Extract<Effect, { readonly kind: 'addMana' }>;
}

/**
 * A filtered one-card decision over a hand revealed by the same resolving
 * instruction.
 *
 * `cards` is the complete reveal and `choosable` is the subset the printed
 * filter admits, mirroring `PendingHandDiscard` without inheriting discard
 * semantics. `outcome` is banked with the continuation so the answer can retain
 * the exact object for a free cast or only its printed name for a cross-zone
 * purge. The record is stripped from every seat except `player`; the public
 * `handRevealed` event remains the other seat's record of what was shown.
 */
export interface PendingRevealedHandChoice extends PendingResolutionContinuation {
  readonly player: PlayerId;
  readonly owner: PlayerId;
  readonly cards: readonly ObjectId[];
  readonly choosable: readonly ObjectId[];
  readonly outcome: Extract<Effect, { readonly kind: 'chooseFromRevealedHand' }>['outcome'];
}

/** The rest of a resolution banked while CR 615.7 asks for a damage allocation. */
export type PendingDamageResolution = PendingResolutionContinuation;

/**
 * A simultaneous damage batch stopped before any member happens.
 *
 * Sources and plans are canonicalized before they enter state. `allocations`
 * banks completed shield choices while `plan.sources[0]` is the source the
 * current small decision asks about; no damage is applied until every plan is
 * complete, so replay never depends on the caller's array order.
 */
export interface PendingDamagePrevention {
  readonly player: PlayerId;
  readonly instances: readonly DamageInstance[];
  readonly plan: DamagePreventionPlan;
  readonly remainingPlans: readonly DamagePreventionPlan[];
  readonly remainingAmount: number;
  readonly chosen: readonly { readonly sourceOid: ObjectId; readonly amount: number }[];
  readonly allocations: readonly DamagePreventionAllocation[];
  readonly resumePriority: PlayerId | null;
  readonly resolution?: PendingDamageResolution;
  /** Original permanent incarnations to tap after this paused batch is applied. */
  readonly postDamageTaps?: readonly { readonly oid: ObjectId; readonly incarnation: number }[];
}

export type CombatDefender =
  | PlayerId
  | { readonly kind: 'planeswalker'; readonly oid: ObjectId }
  | { readonly kind: 'battle'; readonly oid: ObjectId };

export interface Attack {
  readonly oid: ObjectId;
  readonly defender: CombatDefender;
}

/** Blockers are stored in damage-assignment order (CR 509.2). */
export interface Block {
  readonly attacker: ObjectId;
  readonly blockers: readonly ObjectId[];
}

/** Attackers one creature blocks, in that blocker's CR 509.3 damage order. */
export interface AttackerOrder {
  readonly blocker: ObjectId;
  readonly attackers: readonly ObjectId[];
}

export interface CombatState {
  readonly attacks: readonly Attack[];
  readonly blocks: readonly Block[];
  /** Player temporarily authorized to submit this combat's otherwise unchanged legal block declaration. */
  readonly blockDeclarationAuthority?: PlayerId;
  /** Present only when a blocker is assigned to two or more attackers. */
  readonly attackerOrders?: readonly AttackerOrder[];
  readonly firstStrikeDamageDone: boolean;
  readonly regularDamageDone: boolean;
  /**
   * How many positions of each attacker's damage assignment order are settled,
   * while the order is being announced a position at a time (`legal.ts`'s
   * `orderDecision`).
   *
   * The order itself is not stored here — it is `blocks`, in the order the
   * blockers are listed in — so this adds a count and never a second copy of
   * the same fact. It is present only between the first answer to an ordering
   * and the last, which is what makes a mid-sequence position tell itself
   * apart: a position that owes `blockerOrder` while this names an attacker has
   * some of the order in and the rest of it outstanding.
   *
   * The keys are attackers, deliberately. `damage-order.ts`'s `pointedAt` walks
   * everything in `CombatState` except `blocks` to find the objects the position
   * singles out, so a field that named blockers would single out every blocker
   * it named and unmerge the twins `damageOrderClasses` exists to merge. An
   * attacker is already named by `attacks`, so this adds nothing to that walk.
   */
  readonly ordered?: Readonly<Record<ObjectId, number>>;
  /** Settled positions of each multi-blocker's attacker order (CR 509.3). */
  readonly attackersOrdered?: Readonly<Record<ObjectId, number>>;
  /**
   * How many of the creatures that could attack have been answered for, while
   * the attack is being declared one creature at a time (`legal.ts`'s
   * `attackerDecision`, `mtg-tb7v` stage 2).
   *
   * The declaration itself is `attacks`; this is the one thing that list cannot
   * say about itself, because a creature that was asked and held back looks
   * exactly like a creature that has not been asked. The count is read against
   * `eligibleAttackers`, which is stable across the sequence: nothing taps until
   * the declaration finishes.
   *
   * Present only between the first answer and the last. A position that owes
   * `attackers` while this is set has some of the declaration in and the rest
   * outstanding; every other position drops the field, so `stateFingerprint`
   * hashes exactly what it hashed before.
   */
  readonly attacksSettled?: number;
  /**
   * How many of the creatures that could block have been answered for, while the
   * block is being declared one creature at a time (`legal.ts`'s
   * `blockerDecision`, `mtg-tb7v` stage 2).
   *
   * The same shape as `attacksSettled` and for the same reason: `blocks` holds
   * the pairs, and a creature that declined to block leaves no pair behind. Read
   * against `eligibleBlockers`, which is stable across the sequence.
   *
   * `undo.ts` and `session.ts`'s `undoTo` are the other readers. A position that
   * owes `declareBlockers` while `blocks` is non-empty is mid-sequence by
   * construction, and that is the predicate a rewind refuses to land on
   * (`docs/design/blocker-sequence-commitment.md`).
   */
  readonly blocksSettled?: number;
  /** Settled attacker choices for the current unlimited-capacity blocker. */
  readonly blockerAttacksSettled?: number;
}

export const EMPTY_COMBAT: CombatState = {
  attacks: [],
  blocks: [],
  firstStrikeDamageDone: false,
  regularDamageDone: false,
};

export const STEPS = [
  'untap',
  'upkeep',
  'draw',
  'precombatMain',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
  'endCombat',
  'postcombatMain',
  'end',
  'cleanup',
] as const;

export type Step = (typeof STEPS)[number];

export type Phase = 'beginning' | 'precombatMain' | 'combat' | 'postcombatMain' | 'ending';

export const PHASE_OF: Readonly<Record<Step, Phase>> = {
  untap: 'beginning',
  upkeep: 'beginning',
  draw: 'beginning',
  precombatMain: 'precombatMain',
  beginCombat: 'combat',
  declareAttackers: 'combat',
  declareBlockers: 'combat',
  firstStrikeDamage: 'combat',
  combatDamage: 'combat',
  endCombat: 'combat',
  postcombatMain: 'postcombatMain',
  end: 'ending',
  cleanup: 'ending',
};

export function isMainPhase(step: Step): boolean {
  return step === 'precombatMain' || step === 'postcombatMain';
}

/**
 * A non-priority decision the kernel is blocked on.
 *
 * `mulligan` is the only one asked before turn 1 — CR 103.4, `mulligan.ts` —
 * and it is why `TurnState` can hold an `awaiting` while `number` is still 0.
 *
 * `triggerTargets` and `optionalTrigger` belong to one triggered ability at two
 * different moments of its life: the first is CR 603.3d, asked as the ability is
 * put on the stack, and the second is CR 603.3b's "you may", asked as it
 * resolves. Both are stops *inside* the settle loop rather than at a priority
 * window, which is the one thing about them that is new — `trigger-choice.ts`
 * carries the argument and `reduce.ts`'s header states the contract they satisfy.
 *
 * `legendRule` is a stop inside the settle loop too, and it is the first one
 * raised by a *state-based action* rather than by the stack: CR 704.5j hands the
 * pick to the controller of the duplicates, so the sweep in `sba.ts` cannot
 * finish without an answer. It is the only kind whose asked player is neither
 * the active player nor whoever holds priority — the seat with two of a name is,
 * and either seat can be that.
 *
 * `may` (`mtg-bc2.152.4`) is `optionalTrigger`'s CR 603.3b pause widened from a
 * triggered ability to a spell, and from "always the controller" to whichever
 * player the card names (`@mtg/dsl`'s `MayChooser`) — CR 601.2c's "you may" is
 * asked of a named player exactly the way an optional trigger's is asked of its
 * controller, so the two kinds share the pause/resume shape and differ only in
 * who is asked and what is on the stack. `may-choice.ts` carries the argument.
 *
 * `'unless'` is the third of that family and the only one addressed to a player
 * the card does not name: CR 118.8's toll is charged to whoever the spell is
 * aimed at, so the seat is derived from the entry's targets rather than from a
 * printed word (`unless-choice.ts`).
 */
export type AwaitKind =
  | 'mulligan'
  | 'openingHandAction'
  | 'attackers'
  | 'blockers'
  | 'blockerOrder'
  | 'attackerOrder'
  | 'discard'
  | 'triggerTargets'
  | 'pluralTargets'
  | 'damageAllocation'
  | 'optionalTrigger'
  | 'legendRule'
  | 'may'
  | 'unless'
  | 'scry'
  | 'manaColor'
  | 'topLibraryOrder'
  | 'topLibrarySelect'
  | 'topLibraryPartition'
  | 'topLibraryPile'
  /**
   * CR 701.19's search, the second member of the family `'scry'` opened.
   *
   * It is a distinct kind rather than a reuse, even though both are answered by
   * the same runner, because what is being asked differs in shape: a scry asks
   * for an ordering of a window and always has exactly one legal answer per
   * ordering, and a search asks for one card out of a filtered set or for
   * nothing at all. One kind covering both would make `pendingDecision` read
   * two pending records to find out which question it is enumerating.
   */
  | 'searchLibrary'
  /**
   * A search has finished choosing cards and now asks which found card uses
   * the `one` arm of a one-and-rest destination plan.
   *
   * This is separate from `'searchLibrary'` because the legal answers differ:
   * the first question includes CR 701.19c's fail-to-find option, while this
   * one must name exactly one of the cards already found and revealed.
   */
  | 'searchDestination'
  /**
   * CR 701.8's discard, the third member of the family `'scry'` opened and the
   * one that is *not* a distinct kind per effect.
   *
   * `discardCards` and `chooseDiscard` share it, because the question they ask
   * has one shape — choose `count` of these cards — and `PendingHandDiscard`
   * carries the two things that differ as fields. That is the same test the
   * paragraph above applies and it comes out the other way: `pendingDecision`
   * reads one record here and enumerates one question, which is exactly what a
   * second kind would have bought and the reason there is no second kind.
   *
   * Distinct from `'discard'`, which is CR 514.1's cleanup and is not a
   * resolution at all: it asks the active player at end of turn, its count is
   * derived from `config.maximumHandSize`, and answering it finishes a step
   * rather than resuming a spell.
   */
  | 'handDiscard'
  /** A controller is choosing one filtered card from a hand just revealed. */
  | 'revealedHandChoice'
  /**
   * `chooseFromGraveyard`, the fourth member of the family `'scry'` opened and
   * the first whose question is about a zone both seats can read.
   *
   * A distinct kind rather than a reuse of `'searchLibrary'`, which is the
   * nearest shape: both ask for one card out of a filtered list or for nothing.
   * They are still two questions, because the seat is shown different things
   * and told different things — a search un-conceals a window of a hidden zone
   * and shuffles afterwards, and this reads a public zone and shuffles nothing
   * — so a surface rendering "chooses which card to take out of their library"
   * over a graveyard choice would be stating a fact about the game that is not
   * true. `pendingDecision` reading one record per kind is what keeps that from
   * being a runtime convention.
   */
  | 'graveyardChoice'
  /** A mandatory controlled-permanent choice made during resolution. */
  | 'battlefieldChoice'
  | 'populate'
  /**
   * `sacrificePermanent`, the fifth member of the family `'scry'` opened and
   * the first whose question is about the battlefield rather than a hidden or
   * shufflable zone.
   *
   * A distinct kind rather than a reuse of `'graveyardChoice'`, its nearest
   * shape (both ask for one object out of a public-zone list): the asked
   * player differs by construction. A graveyard choice's `player` is always
   * `controller`, the caster's side; this kind's `player` is always the
   * effect's affected player rather than necessarily its controller, so a
   * surface that rendered the two alike would name the wrong seat on every
   * edict and every APNAP sweep.
   *
   * Mandatory, unlike `'graveyardChoice'`: CR 701.17a leaves a controller with
   * a legal permanent no way to decline, so `permanentSacrificeDecision` offers
   * no null option, and `applyResolutionEffects` never pauses at all when the
   * entire required choice is forced.
   */
  | 'permanentSacrifice'
  /** A resolving non-targeted group untap is collecting its optional set. */
  | 'permanentUntap'
  /** A permanent is entering and its controller may choose copied values. */
  | 'entryCopy'
  | 'entryCounter'
  | 'entryAura'
  | 'entryTimestampOrder'
  /** A creature replacement is choosing one complete copiable entry form. */
  | 'entryCharacteristics'
  /** A permanent replacement offers one optional as-entry counter. */
  | 'entryOptionalCounter'
  /** A permanent replacement offers life payment instead of entering tapped. */
  | 'entryPayLife'
  /** A permanent's mandatory as-enters player choice. */
  | 'entryPlayer'
  | 'entryColors'
  | 'spellTargets'
  /** A revealed nonland must be cast for zero mana if a legal declaration exists. */
  | 'freeCast'
  /** CR 615.7: allocation of a finite shield across simultaneous sources. */
  | 'damagePrevention'
  /** CR 201.4 card-name input collected inside a resolving effect. */
  | 'cardName'
  /** A resolving named-card search is collecting its optional cross-zone subset. */
  | 'namedZoneExile';

export interface TurnState {
  readonly number: number;
  readonly active: PlayerId;
  readonly step: Step;
  /** Whoever currently holds priority; `null` in steps that grant none. */
  readonly priority: PlayerId | null;
  /** Consecutive priority passes since the stack last changed. */
  readonly passes: number;
  readonly landsPlayed: number;
  /** Life each player actually lost this turn; gains never subtract from it. */
  readonly lifeLostThisTurn: readonly [number, number];
  /** Players who actually received one or more damage this turn, after replacement. */
  readonly playersDealtDamageThisTurn: readonly PlayerId[];
  /** Exact source incarnations that actually dealt nonzero damage this turn. */
  readonly damageSourcesThisTurn: readonly {
    readonly oid: ObjectId;
    readonly incarnation: number;
  }[];
  /** Creature incarnations actually damaged by a source-linked die-to-exile instruction this turn. */
  readonly damageLinkedDeathExileThisTurn?: readonly {
    readonly oid: ObjectId;
    readonly incarnation: number;
    readonly sourceOid: ObjectId;
    readonly sourceIncarnation: number;
    readonly controller: PlayerId;
    readonly timestamp: number;
  }[];
  /** Players who successfully cast at least one spell this turn; copies do not enter this set. */
  readonly playersWhoCastSpellThisTurn: readonly PlayerId[];
  /** Players who declared at least one creature as an attacker this turn. */
  readonly playersWhoAttackedWithCreatureThisTurn: readonly PlayerId[];
  /** Exact graveyard incarnations that arrived there from the battlefield this turn. */
  readonly battlefieldToGraveyardThisTurn: readonly {
    readonly oid: ObjectId;
    readonly incarnation: number;
  }[];
  readonly awaiting: AwaitKind | null;
  /** Set with `awaiting`, so the kernel knows who owes the decision. */
  readonly awaitingPlayer: PlayerId | null;
}

export interface PlayerState {
  readonly id: PlayerId;
  /** Number of turns this seat has begun, including extra turns. */
  readonly turnsBegun: number;
  readonly life: number;
  /** Index 0 is the top of the library. */
  readonly library: readonly ObjectId[];
  readonly hand: readonly ObjectId[];
  readonly graveyard: readonly ObjectId[];
  readonly pool: ManaPool;
  readonly lost: boolean;
  readonly attemptedDrawFromEmptyLibrary: boolean;
  /**
   * London mulligans this seat has taken (CR 103.4), which is also the number of
   * cards a keep puts on the bottom of the library.
   *
   * It stays on the seat after the opening hand is settled rather than being
   * thrown away with the decision, because it is what the replay log's
   * `num_mulligans` column counts — a column read off a decision nobody kept a
   * record of would go back to reporting zero forever.
   */
  readonly mulligans: number;
  /**
   * True once this seat has kept and is done being asked. Separate from
   * `mulligans` because "kept a seven" and "has not been asked yet" are both
   * zero mulligans and only one of them is still owed a question.
   */
  readonly keptHand: boolean;
}

export interface GameConfig {
  readonly seed: string;
  readonly startingLife: number;
  readonly openingHandSize: number;
  readonly maximumHandSize: number;
  readonly maximumTurns: number;
  readonly startingPlayer: PlayerId;
  /** CR 103.8a: the player who goes first skips their first draw step. */
  readonly startingPlayerSkipsFirstDraw: boolean;
}

export type GameEndReason = 'lifeZero' | 'emptyLibrary' | 'spellOrAbility' | 'concede' | 'turnLimit';

/**
 * How a game ended.
 *
 * A draw is `winner === null`, and it arises two ways: nobody lost (the turn
 * cap) or every player still in the game lost at the same time (CR 104.4b).
 * `loser` names the one player who lost and is therefore `null` for both kinds
 * of draw; `players[i].lost` is the per-seat record that separates "everybody
 * lost" from "nobody lost". `reason` summarizes with the lowest-seat loser's
 * reason — a simultaneous loss can have two different causes, and that detail
 * survives in full as one `playerLost` event per loser.
 */
export interface GameResult {
  readonly winner: PlayerId | null;
  readonly loser: PlayerId | null;
  readonly reason: GameEndReason;
  readonly endedOnTurn: number;
}

/** True when the game ended with no winner: the turn cap, or CR 104.4b. */
export function isDraw(result: GameResult): boolean {
  return result.winner === null;
}

/**
 * A permanent's printed cost reduction (CR 601.2f), registered while its
 * source is on the battlefield.
 *
 * A parallel array to `continuous` rather than a member of it: `@mtg/dsl`'s
 * `cost-reduction.ts` argues why folding this into `ContinuousEffect` would
 * either break `effectForModification`'s one-modification-one-effect
 * invariant or add a case five `assertNever` switches would have to grow a
 * branch for, and why the CR 613 layer walk is the wrong place regardless — a
 * spell's cost is decided before the spell is an object that walk can reach.
 * `@mtg/kernel`'s `cost.ts` registers and reads this array the same way
 * `abilities.ts` registers and reads `continuous`: entry-time registration
 * through `completeArrival`, expiry through `moveObject`, both funneled
 * through the same two choke points (`zones.ts`).
 */
export interface RegisteredCostModifier {
  readonly id: string;
  readonly sourceOid: ObjectId;
  /** Only this permanent's controller pays less; CR 601.2f says "you cast". */
  readonly controller: PlayerId;
  /** Fixed or turn-history-derived generic mana shaved off the cost. */
  readonly amount: number | { readonly kind: 'opponentsLifeLostThisTurn' };
  /** `null` reduces every spell type; otherwise this is the exact disjunction. */
  readonly cardTypes: readonly CardKind[] | null;
}

/**
 * A CR 508/509 combat rule imposed on one creature for the rest of the turn.
 *
 * The turn-scoped half of what `StaticModification`'s combat kinds do
 * permanently (`hasCombatModification`, `combat.ts`). It is a third parallel
 * array rather than a member of `continuous` or a duration on the static, and
 * both of those were tried first:
 *
 * - `ContinuousEffect` cannot host it. Every member of that union carries a
 *   `layer`, because `layers.ts` walks them in CR 613 order; a combat
 *   requirement or restriction applies at CR 508.1/509.1 when the declaration
 *   is checked and has no layer to sit in. A member with a meaningless `layer`
 *   would be a lie the layer walk has to route around.
 * - A `duration` on `StaticModification` cannot host it either. Combat statics
 *   are not registered anywhere; `hasCombatModification` re-reads the printed
 *   ability off the source object every time it is asked. There is no
 *   registration for a duration to live on, and a printed ability does not stop
 *   being printed at end of turn.
 *
 * So the rule is recorded against the creature it constrains, cleared wholesale
 * by `cleanupTurnEffects` (CR 514.2, `turn.ts`), and swept when the subject
 * leaves the battlefield (`moveObject`, `zones.ts`) — the same two choke points
 * `costModifiers` uses, for the same reason. The subject sweep is not
 * housekeeping: this kernel reuses an object's id across a zone change, so a
 * rule left behind would come back with the card.
 *
 * A union rather than one shape with a nullable field, because only one of the
 * five rules carries a defender. The creature-relative rules constrain one
 * creature without naming anyone else. "Attacks you if able"
 * names a player, and CR 109.5 fixes who "you" is when the ability resolves —
 * so the player is stored, not re-derived from the source's controller. A Siren
 * that changes hands after resolving does not redirect the creature it lured.
 */
export type TurnCombatRule =
  | {
      readonly rule: 'cantBeBlockedThisTurn';
      /** The ability that imposed it; provenance, the way `ReplacementEffect` keeps one. */
      readonly sourceOid: ObjectId;
      /** The creature the rule constrains. */
      readonly subject: ObjectId;
    }
  | {
      readonly rule: 'attacksYouThisTurnIfAble';
      readonly sourceOid: ObjectId;
      readonly subject: ObjectId;
      /** The player the subject must attack; CR 109.5's "you", fixed at resolution. */
      readonly defender: PlayerId;
    }
  | {
      /** A CR 508.1d requirement that deliberately leaves the defender open. */
      readonly rule: 'attacksThisTurnIfAble';
      readonly sourceOid: ObjectId;
      readonly subject: ObjectId;
    }
  | {
      /** A CR 509.1b restriction on one creature for the rest of the turn. */
      readonly rule: 'cantBlockThisTurn';
      readonly sourceOid: ObjectId;
      readonly subject: ObjectId;
    }
  | {
      /** A blocker-relative CR 509.1c requirement for one creature. */
      readonly rule: 'blocksThisTurnIfAble';
      readonly sourceOid: ObjectId;
      readonly subject: ObjectId;
    };

/**
 * A player-relative rule installed by a resolving effect until cleanup.
 *
 * One discriminated list owns the duration and provenance while the casting,
 * countering, and targeting seams consume only their own members. Adding a new
 * turn rule therefore adds a union member instead of another GameState array.
 */
export type TurnPlayerRule =
  | {
      readonly rule: 'cantCastSpells';
      readonly sourceOid: ObjectId;
      /** The player who cannot begin casting. Fixed when the effect resolves. */
      readonly player: PlayerId;
    }
  | {
      readonly rule: 'spellsCantBeCounteredBySpellColors';
      readonly sourceOid: ObjectId;
      /** The controller whose spells receive the rule. */
      readonly player: PlayerId;
      readonly colors: readonly Color[];
    }
  | {
      readonly rule: 'creaturesCantBeTargetedBySpellColors';
      readonly sourceOid: ObjectId;
      /** The controller whose current creatures receive the rule. */
      readonly player: PlayerId;
      readonly colors: readonly Color[];
    };

export interface GameState {
  readonly objects: Readonly<Record<ObjectId, GameObject>>;
  readonly players: readonly [PlayerState, PlayerState];
  readonly battlefield: readonly ObjectId[];
  readonly exile: readonly ObjectId[];
  /** Last element is the top of the stack; resolution is LIFO. */
  readonly stack: readonly StackEntry[];
  /** Persistent command-zone emblems in creation order. */
  readonly emblems: readonly Emblem[];
  /** CR 613 continuous effects, in creation order; `layers.ts` orders them. */
  readonly continuous: readonly ContinuousEffect[];
  /** CR 601.2f cost reductions currently registered; `cost.ts` reads them. */
  readonly costModifiers: readonly RegisteredCostModifier[];
  /** CR 614/615 replacement and prevention effects; `replacement.ts` runs them. */
  readonly replacements: readonly ReplacementEffect[];
  /** CR 508/509 combat rules imposed for this turn only; `combat.ts` reads them. */
  readonly turnCombatRules: readonly TurnCombatRule[];
  /** Player-relative casting/countering/targeting rules lasting through this turn. */
  readonly turnPlayerRules: readonly TurnPlayerRule[];
  /** CR 701.29 rules lasting until the detaining controller's next turn. */
  readonly detentions: readonly DetentionRule[];
  /** Temporary source-linked retaliation rules, in resolution order. */
  readonly damageRetaliations: readonly DamageRetaliationRule[];
  readonly attackDebuffs: readonly AttackDebuffRule[];
  readonly turn: TurnState;
  readonly combat: CombatState;
  readonly rng: RngState;
  readonly nextId: number;
  /** Monotonic capability source for exact source-linked exile incarnations. */
  readonly nextLinkedExileId?: number;
  /** One-shot delayed zone changes, in creation order. */
  readonly delayedZoneChanges?: readonly DelayedZoneChange[];
  /** One-shot delayed counter placements, in creation order. */
  readonly delayedCounterPlacements?: readonly DelayedCounterPlacement[];
  /** One-shot next-spell copy triggers, all expiring at cleanup. */
  readonly delayedSpellCopies?: readonly DelayedSpellCopy[];
  /** Extra turns inserted after the current turn, plus the ordinary player that resumes afterward. */
  readonly extraTurnSequence?: {
    readonly queue: readonly PlayerId[];
    readonly resume: PlayerId;
  };
  readonly result: GameResult | null;
  readonly config: GameConfig;
  /**
   * Players who have not finished card-authored pregame actions, in the order
   * they act. Present only between the final keep and turn 1, then removed so
   * ordinary gameplay state keeps no dead phase marker.
   */
  readonly openingHandActionPlayers?: readonly PlayerId[];
  /** Present only while a resolution is stopped on CR 701.18. */
  readonly pendingScry?: PendingScry;
  /** Present only while one resolving mana ability still owes color choices. */
  readonly pendingManaCombination?: PendingManaCombination;
  /** Present while an ordinary stack-using mana effect awaits its resolution-time color. */
  readonly pendingManaColorChoice?: PendingManaColorChoice;
  /** Present only for one of the bounded top-library decisions. */
  readonly pendingTopLibrary?: PendingTopLibrary;
  /** Present only while a resolution is stopped on CR 701.19. */
  readonly pendingSearch?: PendingSearch;
  /** Present only while a resolution is stopped on CR 701.8. */
  readonly pendingHandDiscard?: PendingHandDiscard;
  /** Present while a linked revealed-hand choice awaits its one answer. */
  readonly pendingRevealedHandChoice?: PendingRevealedHandChoice;
  /**
   * Present only while a resolution is stopped on a `chooseFromGraveyard`.
   *
   * The one pending record with no arm in `visibility.ts`, because a graveyard
   * is a public zone and there is nothing in it to conceal; the record's own
   * docblock carries the argument.
   */
  readonly pendingGraveyardChoice?: PendingGraveyardChoice;
  /** Public controlled-permanent candidates for a resolving battlefield choice. */
  readonly pendingBattlefieldChoice?: PendingBattlefieldChoice;
  /** Present while CR 701.30 waits for one controlled creature token to copy. */
  readonly pendingPopulate?: PendingPopulate;
  /**
   * Present only while a resolution is stopped on CR 701.17's edict.
   *
   * Another record with no arm in `visibility.ts`, for the docblock's stated
   * reason: the battlefield is as public as the graveyard, so there is
   * nothing here to conceal from the non-asked seat either.
   */
  readonly pendingPermanentSacrifice?: PendingPermanentSacrifice;
  /** Public battlefield candidates for a resolving non-targeted group untap. */
  readonly pendingPermanentUntap?: PendingPermanentUntap;
  /** Present only while a copy-as-entry replacement awaits its choice. */
  readonly pendingEntryCopy?: PendingEntryCopy;
  /** Present only while an as-entry replacement chooses a controlled permanent. */
  readonly pendingEntryCounterChoice?: PendingEntryCounterChoice;
  /** Present while a non-spell Aura chooses one legal, non-targeted host. */
  readonly pendingEntryAuraChoice?: PendingEntryAuraChoice;
  /** Present before a creature with bounded characteristic modes enters. */
  readonly pendingEntryCharacteristicsChoice?: PendingEntryCharacteristicsChoice;
  /** Present before an optional as-entry counter replacement is answered. */
  readonly pendingEntryOptionalCounterChoice?: PendingEntryOptionalCounterChoice;
  /** Present before a pay-life-or-enter-tapped replacement is answered. */
  readonly pendingEntryPayLifeChoice?: PendingEntryPayLifeChoice;
  /** Present while a permanent chooses a player before entering. */
  readonly pendingEntryPlayerChoice?: PendingEntryPlayerChoice;
  /** Present while a permanent chooses a card name before entering. */
  readonly pendingEntryCardNameChoice?: PendingEntryCardNameChoice;
  readonly pendingEntryColorsChoice?: PendingEntryColorsChoice;
  /** Present while one simultaneous public-zone cohort banks all as-entry choices. */
  readonly pendingBattlefieldEntryBatch?: PendingBattlefieldEntryBatch;
  /** Present while a resolving stack-copy or retarget effect asks for targets. */
  readonly pendingSpellTargets?: PendingSpellTargets;
  /** Public staged targeting state for a plural spell or trigger. */
  readonly pendingPluralTargets?: PendingPluralTargets;
  /** Present while a revealed nonland awaits its complete free-cast declaration. */
  readonly pendingFreeCast?: PendingFreeCast;
  /** Present only while a resolving effect is collecting APNAP card names. */
  readonly pendingCardNameChoice?: PendingCardNameChoice;
  /** Present after a nonland name is chosen while matching cross-zone cards are selected. */
  readonly pendingNamedZoneExile?: PendingNamedZoneExile;
  /** Present while simultaneous source damage awaits a CR 615.7 allocation. */
  readonly pendingDamagePrevention?: PendingDamagePrevention;
  /** Triggered abilities retained across an in-resolution scry stop. */
  readonly deferredTriggers?: readonly PendingTrigger[];
  /**
   * The cards already named toward the set-selection this position is stopped
   * on — the cleanup discard at CR 514.1, the London mulligan's bottoming at CR
   * 103.4, or a resolution stopped on CR 701.8 — while that selection is being
   * answered one card at a time (`legal.ts`'s `discardDecision`,
   * `mulliganDecision` and `handDiscardDecision`, `mtg-cs8t` steps 1 and 2).
   *
   * One field for all three because a position is stopped on at most one of
   * them: `turn.awaiting` says which, and it is `'discard'`, `'mulligan'` or
   * `'handDiscard'` and never two at once. The one that names cards in a hand
   * its chooser does not own is `'handDiscard'` under a `chooseDiscard`, and it
   * is the reason the concealment note at the end of this docblock is about the
   * seat being asked rather than about the hand's owner.
   *
   * The cards are held here rather than moved as they are named, because a
   * card moved a question early would stop being in the hand its own selection
   * is chosen from — the same reason CR 508.1f's tapping waits for the whole
   * attack (`reduce.ts`'s `onDeclareAttackers`).
   *
   * The list is in increasing hand order, which is what makes one path of
   * answers reach each selection: "the cards after the last one chosen" is the
   * step's option list, so the k! spellings of one set collapse to one route and
   * a recorded integer names a move rather than a route.
   *
   * Present only between the first answer and the last. Every other position
   * drops the field, so `stateFingerprint` (`fork.ts`) hashes exactly what it
   * hashed before, and `visibility.ts` conceals it from the seat not being
   * asked, because it names cards in a hand that seat may not identify.
   */
  readonly pendingSelection?: readonly ObjectId[];
}

/** A copy-as-entry replacement banked before the zone change occurs. */
export interface PendingEntryCopy {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly creatures: readonly ObjectId[];
}

/** A counter placement banked before the entering permanent changes zones. */
export interface PendingEntryCounterChoice {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly permanents: readonly ObjectId[];
  /** Copiable values selected by an earlier copy-as-entry replacement. */
  readonly copiedCard: Card | null;
}

/** A mandatory CR 303.4f host choice made before the Aura changes zones. */
export interface PendingEntryAuraChoice {
  readonly player: PlayerId;
  /** The entire paused entry, so a non-batch choice resumes without losing prior choices or X. */
  readonly entry: PendingBattlefieldEntry;
  readonly permanents: readonly ObjectId[];
}

/** A complete copiable characteristic choice banked before the zone change. */
export interface PendingEntryCharacteristicsChoice {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly modes: readonly EntryCharacteristicMode[];
  /** Copiable values selected by an earlier copy-as-entry replacement. */
  readonly copiedCard: Card | null;
}

/** An optional counter replacement chosen before the permanent changes zones. */
export interface PendingEntryOptionalCounterChoice {
  readonly player: PlayerId;
  /** The whole paused entry, including earlier copy or characteristic choices. */
  readonly entry: PendingBattlefieldEntry;
  readonly counter: EntryCounterKind;
  readonly count: number;
}

/** A land entry replacement waiting for its controller's bounded life-payment answer. */
export interface PendingEntryPayLifeChoice {
  readonly player: PlayerId;
  /** The whole paused entry, including earlier copy or characteristic choices. */
  readonly entry: PendingBattlefieldEntry;
  readonly life: number;
}

/** A mandatory player choice banked before the permanent changes zones. */
export interface PendingEntryPlayerChoice {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly copiedCard: Card | null;
}

/** A mandatory card-name choice banked before the permanent changes zones. */
export interface PendingEntryCardNameChoice {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly copiedCard: Card | null;
}

/** A mandatory exactly-two-color choice banked before the permanent changes zones. */
export interface PendingEntryColorsChoice {
  readonly player: PlayerId;
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly copiedCard: Card | null;
}

/** One permanent whose as-entry choices are ready to commit with its cohort. */
export interface PendingBattlefieldEntry {
  readonly oid: ObjectId;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly chosenX: number;
  /** Present, including `null`, once a copy-as-entry choice has been answered. */
  readonly copiedCard?: Card | null;
  readonly counterPermanent?: ObjectId;
  readonly chosenPlayer?: PlayerId;
  readonly chosenCardName?: string;
  readonly chosenColors?: readonly Color[];
  readonly characteristicsMode?: EntryCharacteristicMode;
  /** Present, including null, once an optional entry-counter choice is answered. */
  readonly optionalCounter?: { readonly counter: EntryCounterKind; readonly count: number } | null;
  /** Present once a pay-life-or-enter-tapped replacement has been answered. */
  readonly paidEntryLife?: boolean;
  /** Undefined for non-Auras, null when CR 303.4g leaves an Aura in its old zone. */
  readonly auraHost?: ObjectId | null;
}

/** One controller's CR 613.7m relative timestamp order, collected earliest first. */
export interface PendingEntryTimestampGroup {
  readonly player: PlayerId;
  readonly chosen: readonly ObjectId[];
  readonly remaining: readonly ObjectId[];
}

/** Shared pre-event context and banked choices for simultaneous battlefield entry. */
export interface PendingBattlefieldEntryBatch {
  /** Battlefield membership before any member of this event enters. */
  readonly baselineBattlefield: readonly ObjectId[];
  /** Continuous records that existed before any member of this event entered. */
  readonly baselineContinuousIds: readonly string[];
  /** Replacement records that existed before any member of this event entered. */
  readonly baselineReplacementIds: readonly string[];
  /** Every physical card in this event. */
  readonly cohort: readonly ObjectId[];
  readonly prepared: readonly PendingBattlefieldEntry[];
  readonly remaining: readonly PendingBattlefieldEntry[];
  /** APNAP groups appear after all other as-entry choices have been banked. */
  readonly timestampGroups?: readonly PendingEntryTimestampGroup[];
  /** The resolving spell or ability tail that resumes after the batch commits. */
  readonly resolution?: PendingResolutionContinuation;
}

/** The card values this battlefield incarnation currently copies. */
export function copiableCardOf(object: GameObject): Card {
  return object.copiableCard ?? object.faceCard ?? object.card;
}

/** The card an already-created ability or trigger still refers to after departure. */
export function lastKnownCopiableCardOf(object: GameObject): Card {
  return object.zone === 'battlefield'
    ? copiableCardOf(object)
    : (object.lastKnownCopiableCard ?? object.card);
}

/**
 * The seats in APNAP order: the active player, then everyone else.
 *
 * CR 101.4's order, and the one an effect that says "each player" has to walk.
 * The slice is two-player, so this is a pair, and it is derived from
 * `state.turn.active` rather than from seat order for the reason replay needs:
 * "each player draws a card" on turn three and on turn four deal different
 * cards, and a kernel that walked seat 0 first would deal the same ones.
 *
 * Here rather than beside its callers because there are two of them in
 * different files — the trigger stack (CR 603.3b) and the effect table's player
 * sweeps — and a second derivation of turn order is a second chance for the two
 * to disagree about who acts first.
 */
export function apnapOrder(state: GameState): readonly PlayerId[] {
  const active = state.turn.active;
  return [active, ...PLAYER_IDS.filter((player) => player !== active)];
}

export function isGameOver(state: GameState): boolean {
  return state.result !== null;
}
