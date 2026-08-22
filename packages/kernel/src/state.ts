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
  Card,
  CardKind,
  Color,
  Effect,
  GraveyardArrivalGrant,
  GraveyardChoiceControl,
  GraveyardChoiceDestination,
  InstantCard,
  SearchDestination,
  SorceryCard,
  TriggeringCreatureCondition,
} from '@mtg/dsl';
import { MANA_COLORS } from '@mtg/dsl';
import type { ContinuousEffect, Counters } from './continuous';
import type { ObjectId, PlayerId } from './ids';
import { PLAYER_IDS } from './ids';
import type { PendingTrigger } from './triggers';
import type { ReplacementEffect } from './replacement-effects';
import type { RngState } from './rng';

export type ZoneId = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack';

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

export const EMPTY_MANA_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/**
 * A card (or token) in play. `card` is the DSL record and never changes;
 * everything mutable about the object lives beside it, and everything *derived*
 * (power, toughness, keywords) is computed by the layer system in `layers.ts`
 * rather than stored, so continuous effects can never desynchronize.
 */
export interface GameObject {
  readonly oid: ObjectId;
  readonly card: Card;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly zone: ZoneId;
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
  /** Layer-derived characteristics retained across one battlefield departure for LKI. */
  readonly lastKnownSourceCharacteristics?: SourceCharacteristics;
}

export interface SourceCharacteristics {
  readonly colors: readonly Color[];
  readonly subtypes: readonly string[];
}

export type Target =
  | { readonly kind: 'player'; readonly player: PlayerId }
  | { readonly kind: 'permanent'; readonly oid: ObjectId }
  | { readonly kind: 'spell'; readonly oid: ObjectId };

/**
 * A triggered ability on the stack (CR 113.7a): an object that is not a card.
 * `sourceOid` names the permanent whose printed text it came from, which may
 * already have left the battlefield — CR 608.2 resolves it anyway.
 */
export interface AbilityOnStack {
  readonly sourceOid: ObjectId;
  /** Index into `getObject(state, sourceOid).card.abilities`. */
  readonly index: number;
}

/**
 * Event data a triggered ability must retain without turning it into a target.
 *
 * Exalted refers back to the lone attacker that caused it to trigger,
 * `selfDealsCombatDamageToCreature` refers back to the creature that took the
 * damage, and `selfBlocksOrIsBlockedByGreaterPower` refers back to the larger
 * creature on the other side of the block. CR 115 targets none of them, so this
 * data must never share the `StackEntry.targets` tuple whose members are
 * chosen, displayed, and rechecked as targets.
 *
 * `kind` is the condition that retained the referent, taken from the DSL's
 * `TRIGGERING_CREATURE_CONDITIONS` rather than spelled out again. This file
 * carried its own copy of that list for one commit and the replay log schema
 * carried a third; the schema's went stale the day the kernel gained
 * `selfBlocksOrIsBlockedByGreaterPower`, and the first game that put one on the
 * stack would not load. One list, in the package all three readers depend on.
 */
export type TriggerContextKind = TriggeringCreatureCondition;

export type TriggerContext = {
  readonly kind: TriggerContextKind;
  readonly triggeringCreature: ObjectId;
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
  /**
   * Chosen members for a `TargetSpec.count` slot ("up to two target
   * creatures"), keyed by the same effect-list index `targets` is parallel
   * to, added for `mtg-kg44`. `targets[i]` stays `null` for a counted slot —
   * "no single target" is true of it either way — so every generic reader of
   * `targets` (`popStackEntry`, the counterSpell scan, narration, projection,
   * the cast UI) keeps seeing the ordinary "no target" shape it already
   * handles instead of a fourth `Target` kind it would have to be taught
   * about. Only the two places that resolve a counted slot's *effect* read
   * this map: `stack.ts`'s `planResolution` (CR 608.2b's per-member recheck)
   * and `effects.ts`'s `tapPermanent` apply. A slot with no entry here, or an
   * entry that is `[]` ("chose none of the up to two"), is not a special
   * case either function has to guess at — both already treat "nothing to
   * do" as the empty case.
   */
  readonly multiTargets?: Readonly<Record<number, readonly ObjectId[]>>;
  readonly ability: AbilityOnStack | null;
  /**
   * The mode chosen at cast time for a modal spell (CR 700.2), by index into
   * `card.modes`; `null` for every ability entry and for a spell with no
   * `modes` to choose among. Fixed once the entry is pushed (`pushSpell`),
   * the same way `targets` is — `@mtg/dsl`'s `effectsFor(card, mode)` is the
   * one place that reads it back to decide which effect list resolves.
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
  /** CR 608.2b source qualities captured while a permanent source still existed. */
  readonly sourceCharacteristics: SourceCharacteristics | null;
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
 * one record rather than as a field per amount: the two fields here are read by
 * `exiledThisResolution` and `damageDealtThisResolution`, they are threaded
 * through the same twenty call sites in `scry.ts`, and a third amount of this
 * shape adds a field here instead of a parameter to all twenty.
 *
 * Counts, not marks. A mark is an index into `trace.events` and the events that
 * answer "the number of cards exiled this way" are in the previous reduction,
 * where no index in this one can reach them.
 */
export interface ResolutionTally {
  /** Cards — never tokens — this resolution has put into exile. */
  readonly exiled: number;
  /** Damage this resolution has dealt, after prevention and CR 614 replacement. */
  readonly damage: number;
}

/** A resolution that has done nothing yet, and what every unpaused caller passes. */
export const NOTHING_TALLIED: ResolutionTally = { exiled: 0, damage: 0 };

/** One still-unapplied slot in a resolution interrupted by scry. */
export interface PendingResolutionEffect {
  readonly effect: Effect;
  readonly target: Target | null;
  /** Surviving members for a counted slot; see `StackEntry.multiTargets`. */
  readonly multiTarget?: readonly ObjectId[];
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
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  /** What this resolution had already done when the scry stopped it. */
  readonly tally: ResolutionTally;
  /** Triggers raised before this in-resolution choice, held until resolution ends. */
  readonly deferredTriggers: readonly PendingTrigger[];
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
  readonly player: PlayerId;
  readonly cards: readonly ObjectId[];
  readonly destination: SearchDestination;
  /** How many cards this search still wants, resolved when it paused. */
  readonly count: number;
  /** CR 701.16a: whether the cards taken are shown to both seats. */
  readonly reveal: boolean;
  /** Cards taken so far, in library order; empty on the first pause. */
  readonly taken: readonly ObjectId[];
  readonly sourceOid: ObjectId;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
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
  readonly destination: GraveyardChoiceDestination;
  readonly control?: GraveyardChoiceControl;
  readonly alsoBecomes?: GraveyardArrivalGrant;
  readonly sourceOid: ObjectId;
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

/**
 * CR 701.17's question: which creature a resolving `sacrificePermanent`
 * takes, asked of the target player rather than the caster.
 *
 * `PendingGraveyardChoice`'s shape with the graveyard swapped for the
 * battlefield, and the same reasoning carries: the battlefield is a public
 * zone (CR 403.2's zone list, same footing as CR 400.2's graveyard), so
 * nothing here is concealed and this record has no arm in `visibility.ts`
 * either. `player` is who answers and is always the effect's target, which is
 * the whole point of the card — `sacrificeSelf` never needed this field
 * because its answerer is fixed at print time, and an edict's is not.
 *
 * `permanents` is the target player's creatures at the moment of the pause,
 * banked rather than re-derived when the answer arrives, for
 * `PendingGraveyardChoice.cards`'s stated reason: `legal.ts` enumerated the
 * options from this list, so a creature that left the battlefield in between
 * is still a creature the chooser was offered — `validatePermanentSacrifice`
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
 * legal target exists, so `permanentSacrificeDecision` never offers a null
 * choice the way `graveyardChoiceDecision` does — the pause only happens at
 * all because `applyResolutionEffects` auto-resolves the zero- and
 * one-candidate cases without asking, mirroring `discardCards`'s "forced when
 * choosable.length <= count" branch.
 *
 * Every field after `permanents` is `PendingGraveyardChoice`'s, carried for
 * the identical reason and documented there.
 */
export interface PendingPermanentSacrifice {
  readonly player: PlayerId;
  readonly permanents: readonly ObjectId[];
  readonly sourceOid: ObjectId;
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
  readonly controller: PlayerId;
  readonly remaining: readonly PendingResolutionEffect[];
  readonly x: number | null;
  readonly objectToGraveyard: ObjectId | null;
  readonly tally: ResolutionTally;
  readonly deferredTriggers: readonly PendingTrigger[];
}

export type CombatDefender = PlayerId | { readonly kind: 'planeswalker'; readonly oid: ObjectId };

export interface Attack {
  readonly oid: ObjectId;
  readonly defender: CombatDefender;
}

/** Blockers are stored in damage-assignment order (CR 509.2). */
export interface Block {
  readonly attacker: ObjectId;
  readonly blockers: readonly ObjectId[];
}

export interface CombatState {
  readonly attacks: readonly Attack[];
  readonly blocks: readonly Block[];
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
  | 'attackers'
  | 'blockers'
  | 'blockerOrder'
  | 'discard'
  | 'triggerTargets'
  | 'optionalTrigger'
  | 'legendRule'
  | 'may'
  | 'unless'
  | 'scry'
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
  /**
   * `sacrificePermanent`, the fifth member of the family `'scry'` opened and
   * the first whose question is about the battlefield rather than a hidden or
   * shufflable zone.
   *
   * A distinct kind rather than a reuse of `'graveyardChoice'`, its nearest
   * shape (both ask for one object out of a public-zone list): the asked
   * player differs by construction. A graveyard choice's `player` is always
   * `controller`, the caster's side; this kind's `player` is always the
   * effect's *target*, so a surface that rendered the two alike would name the
   * wrong seat on every edict.
   *
   * Mandatory, unlike `'graveyardChoice'`: CR 701.17a leaves a controller with
   * a legal creature no way to decline, so `permanentSacrificeDecision` offers
   * no null option, and `applyResolutionEffects` never pauses at all when the
   * candidate list has zero or one entries.
   */
  | 'permanentSacrifice';

export interface TurnState {
  readonly number: number;
  readonly active: PlayerId;
  readonly step: Step;
  /** Whoever currently holds priority; `null` in steps that grant none. */
  readonly priority: PlayerId | null;
  /** Consecutive priority passes since the stack last changed. */
  readonly passes: number;
  readonly landsPlayed: number;
  /**
   * The seats that have been dealt damage this turn, in the order damage first
   * reached each, so `Condition`'s `noOpponentDealtDamageThisTurn` (`@mtg/dsl`)
   * has a fact to read.
   *
   * On `TurnState` rather than beside `turnCombatRules`, because the reset is
   * the whole question and this record's is `landsPlayed`'s: `beginTurn`
   * rebuilds the turn record wholesale, so a field added here is cleared at the
   * turn boundary by construction and cannot drift from the other per-turn
   * accumulator the way two hand-written resets would. `turnCombatRules` is
   * cleared by `cleanupTurnEffects` instead because CR 514.2 is the rule that
   * ends those, and it also needs a sweep when its subject changes zones —
   * neither applies to a player, who has no zone to leave.
   *
   * Written at `applyDamage`'s one player-recipient branch (`damage.ts`), after
   * replacement, so damage that was prevented or redirected to a permanent
   * never lands here. Life lost any other way is not damage and does not, which
   * is the distinction the printed clause draws.
   */
  readonly damagedPlayers: readonly PlayerId[];
  readonly awaiting: AwaitKind | null;
  /** Set with `awaiting`, so the kernel knows who owes the decision. */
  readonly awaitingPlayer: PlayerId | null;
}

export interface PlayerState {
  readonly id: PlayerId;
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

export type GameEndReason = 'lifeZero' | 'emptyLibrary' | 'concede' | 'turnLimit';

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
  /** Generic mana shaved off the cost; never negative (`CostReductionSchema`). */
  readonly amount: number;
  /** `null` reduces every spell type; matches `CostReduction.cardType`. */
  readonly cardType: CardKind | null;
}

/**
 * A CR 508/509 combat rule imposed on one creature for the rest of the turn.
 *
 * The turn-scoped half of what `StaticModification`'s six combat kinds do
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
 * A union rather than one shape with a nullable field, because the two rules
 * carry different amounts of information. "Can't be blocked" is a restriction
 * on a creature and says nothing about anyone else. "Attacks you if able" names
 * a player, and CR 109.5 fixes who "you" is when the ability resolves — so the
 * player is stored, not re-derived from the source's controller. A Siren that
 * changes hands after resolving does not redirect the creature it lured.
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
    };

export interface GameState {
  readonly objects: Readonly<Record<ObjectId, GameObject>>;
  readonly players: readonly [PlayerState, PlayerState];
  readonly battlefield: readonly ObjectId[];
  readonly exile: readonly ObjectId[];
  /** Last element is the top of the stack; resolution is LIFO. */
  readonly stack: readonly StackEntry[];
  /** CR 613 continuous effects, in creation order; `layers.ts` orders them. */
  readonly continuous: readonly ContinuousEffect[];
  /** CR 601.2f cost reductions currently registered; `cost.ts` reads them. */
  readonly costModifiers: readonly RegisteredCostModifier[];
  /** CR 614/615 replacement and prevention effects; `replacement.ts` runs them. */
  readonly replacements: readonly ReplacementEffect[];
  /** CR 508/509 combat rules imposed for this turn only; `combat.ts` reads them. */
  readonly turnCombatRules: readonly TurnCombatRule[];
  readonly turn: TurnState;
  readonly combat: CombatState;
  readonly rng: RngState;
  readonly nextId: number;
  readonly result: GameResult | null;
  readonly config: GameConfig;
  /** Present only while a resolution is stopped on CR 701.18. */
  readonly pendingScry?: PendingScry;
  /** Present only while a resolution is stopped on CR 701.19. */
  readonly pendingSearch?: PendingSearch;
  /** Present only while a resolution is stopped on CR 701.8. */
  readonly pendingHandDiscard?: PendingHandDiscard;
  /**
   * Present only while a resolution is stopped on a `chooseFromGraveyard`.
   *
   * The one pending record with no arm in `visibility.ts`, because a graveyard
   * is a public zone and there is nothing in it to conceal; the record's own
   * docblock carries the argument.
   */
  readonly pendingGraveyardChoice?: PendingGraveyardChoice;
  /**
   * Present only while a resolution is stopped on CR 701.17's edict.
   *
   * Another record with no arm in `visibility.ts`, for the docblock's stated
   * reason: the battlefield is as public as the graveyard, so there is
   * nothing here to conceal from the non-asked seat either.
   */
  readonly pendingPermanentSacrifice?: PendingPermanentSacrifice;
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
