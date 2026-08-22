/**
 * The action alphabet: everything an agent is ever allowed to submit.
 *
 * Actions are *decisions*, not state transitions. Turn-based actions (untap,
 * draw, combat damage) are never actions — the kernel performs them itself
 * while settling, so an agent can only ever choose between things the rules
 * actually leave open. That is the seam the bots and the future LLM referee
 * plug into: the kernel enumerates, the agent picks, the kernel mutates.
 */
import type { ObjectId, PlayerId } from './ids';
import type { CombatDefender, ManaColor, Target } from './state';

export interface AttackDeclaration {
  readonly oid: ObjectId;
  readonly defender: CombatDefender;
}

export interface BlockDeclaration {
  readonly blocker: ObjectId;
  readonly attacker: ObjectId;
}

export interface BlockerOrdering {
  readonly attacker: ObjectId;
  readonly blockers: readonly ObjectId[];
}

export type Action =
  | { readonly type: 'passPriority'; readonly player: PlayerId }
  | { readonly type: 'playLand'; readonly player: PlayerId; readonly oid: ObjectId }
  | {
      readonly type: 'castSpell';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      /** Parallel to the card's effect list; `null` where an effect needs no target. */
      readonly targets: readonly (Target | null)[];
      /**
       * CR 601.2b: the value announced for this cost's {X}, chosen as the
       * spell is cast. Absent rather than `undefined` for a cost with no X
       * (`exactOptionalPropertyTypes`, the same convention `attachedTo`
       * states in `state.ts`): a card printed before X existed casts with no
       * key here to omit, and `validateCast` rejects the two mismatches this
       * leaves open — an X with no cost to belong to, and a cost that needs
       * one and got none.
       */
      readonly x?: number;
      /**
       * CR 700.2: which mode of a modal spell was chosen, by index into
       * `card.modes`, announced as the spell is cast. Absent for the same
       * reason `x` is: a non-modal card carries no `modes` list and so no key
       * here to omit, and `validateCast` rejects the two mismatches this
       * leaves open — a mode with no list to belong to, and a modal card cast
       * with none chosen.
       */
      readonly mode?: number;
      /**
       * Chosen members for a `TargetSpec.count` slot ("up to two target
       * creatures", `mtg-kg44`), keyed by index into `card.effects` the same
       * way `targets` is. Absent for the same reason `x` and `mode` are: a
       * card with no counted slot casts with no key here to omit, and
       * `validateCast` rejects a submission that names an index the card
       * does not have a counted slot at, or more members than `count` allows.
       *
       * Sibling of `targets` rather than a member of it, because `targets` is
       * `Target | null` per slot and "chose two creatures" is not a single
       * `Target` — see `StackEntry.multiTargets`' docblock for why that stayed
       * a side channel instead of a fourth `Target` variant. Scoped to
       * `castSpell` only: `checkAbilityEffectTarget` (`@mtg/dsl`) never calls
       * `checkTargetCount`, so a `count` slot cannot appear on a printed
       * ability's effect list, and `activateAbility` and
       * `chooseTriggerTargets` carry no matching field.
       */
      readonly multiTargets?: Readonly<Record<number, readonly ObjectId[]>>;
    }
  | {
      readonly type: 'activateManaAbility';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly color: ManaColor;
    }
  | {
      /**
       * CR 602: a printed activated ability, paid for and put on the stack.
       *
       * Deliberately a sibling of `activateManaAbility` rather than a
       * generalization of it. CR 605.1: a mana ability does not use the stack
       * and cannot be responded to, which is why that one reduces to
       * `produceMana` inline with no stack entry. They are different rules, and
       * merging them would put a stack entry where the rules forbid one.
       */
      readonly type: 'activateAbility';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      /** Index into the permanent's `card.abilities`. */
      readonly abilityIndex: number;
      /** Parallel to the ability's effect list; `null` where an effect needs no target. */
      readonly targets: readonly (Target | null)[];
      /**
       * CR 601.2b, reached through CR 602.2b: the value announced for this
       * ability's `{X}`, chosen as the ability is activated and therefore known
       * before it is ever on the stack.
       *
       * The same field `castSpell` carries, for the same reason and under the
       * same convention — absent rather than `undefined` for a cost with no X,
       * and `validateActivation` rejects the two mismatches that leaves open, an
       * X with no cost to belong to and a cost that needs one and got none.
       * Silklash Spider's `{X}{G}{G}` is the printed case, and its damage reads
       * the number back out of `StackEntry.x` at resolution.
       */
      readonly x?: number;
      /**
       * The permanents `cost.sacrificeOther` eats, chosen by the activating
       * player (CR 601.2g). Empty when the cost names none, which is every
       * ability written before Chests: an always-present list rather than an
       * optional field, so "this activation sacrifices nothing" has one
       * spelling and `validateAction` can check the length unconditionally.
       *
       * The source itself is never in here even when `cost.sacrificeSelf` is
       * set. That payment is not a choice, so it is not agent input.
       */
      readonly sacrifices: readonly ObjectId[];
      /**
       * The cards `cost.discard` pays with, chosen by the activating player
       * (CR 601.2h).
       *
       * Optional where `sacrifices` is required, and the difference is not
       * inconsistency — it is which spelling the union already had. `x` and
       * `mode` above are optional for the reason that applies here: a card that
       * names no such cost carries no field to be empty, and `validateAction`
       * rejects both mismatches an optional field leaves open, a discard list
       * against an ability with no discard cost and an ability with one
       * activated without a list. `sacrifices` is required because it was
       * added when the union had no optional member to follow, and changing it
       * now would touch every construction site in the workspace to say
       * nothing new.
       */
      readonly discards?: readonly ObjectId[];
    }
  | {
      /**
       * CR 603.3d: the targets of a triggered ability, chosen as it is put on
       * the stack.
       *
       * `oid` is the *ability object* on the stack (an `ab<n>`), not the
       * permanent that printed it. That is the object the choice belongs to: two
       * copies of one trigger can be on the stack at once, each owing its own
       * targets, and only the ability id tells them apart.
       *
       * The action carries no accept/decline flag. Choosing targets is not
       * optional even when the ability is (CR 601.2c is about putting the object
       * on the stack; the "may" is answered later, by `answerOptionalTrigger`),
       * and a trigger with no legal target is removed before anybody is asked.
       */
      readonly type: 'chooseTriggerTargets';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      /** Parallel to the trigger's effect list; `null` where an effect needs none. */
      readonly targets: readonly (Target | null)[];
    }
  | {
      /**
       * CR 603.3b: the answer to a triggered ability's "you may", given as the
       * ability resolves.
       *
       * Declining is a decision and not a skip, which is why it is an action
       * with a `false` in it rather than the absence of one: it is enumerated as
       * a legal option, recorded in `session.choices` like every other answer,
       * and reported in the event log as `triggerDeclined`. A game in which the
       * controller declined and a game in which the trigger never fired are
       * different games, and the log has to be able to tell them apart.
       */
      readonly type: 'answerOptionalTrigger';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly accept: boolean;
    }
  | {
      /**
       * CR 601.2c: the answer to a spell's "you may", given as the spell
       * resolves. `answerOptionalTrigger`'s shape, for a spell rather than a
       * triggered ability (`mtg-bc2.152.4`): `player` is whoever the card
       * named as chooser, which need not be the caster, so an opponent
       * answers their own copy of this action the same way a controller does.
       *
       * Declining is recorded the same deliberate way `answerOptionalTrigger`
       * records it: an action with a `false` in it, enumerated as a legal
       * option, reported as `spellDeclined` — a declined "you may" spell and a
       * spell that was never cast are different games.
       */
      readonly type: 'answerMay';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly accept: boolean;
    }
  | {
      /**
       * CR 118.8: the answer to a spell's printed toll, given as the spell
       * resolves. `answerMay`'s shape, with `pay` where that one has `accept`
       * and the opposite sense — a toll paid stops the spell, a "you may"
       * accepted runs it — so the two words are deliberately different and a
       * mistyped one does not typecheck into the wrong meaning.
       *
       * `player` is the seat the spell is aimed at rather than a seat the card
       * names, and it is the one action in this union whose acceptance costs
       * the acting player mana that is not part of casting anything.
       */
      readonly type: 'answerUnless';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly pay: boolean;
    }
  | {
      readonly type: 'declareAttackers';
      readonly player: PlayerId;
      readonly attackers: readonly AttackDeclaration[];
      /**
       * How many of the creatures that could attack this answers for, counted
       * off `eligibleAttackers` in kernel order. Absent means all of them, which
       * is the whole declaration and the only shape anything outside the kernel
       * builds.
       *
       * It exists because a declaration cannot say how much of itself is an
       * answer: a creature held back leaves nothing behind, so the prefix that
       * has been asked is a fact about the sequence and not about the pairs
       * (`mtg-tb7v` stage 2, `legal.ts`'s `attackerDecision`). An answer names
       * only creatures inside its prefix, repeats every attack already
       * declared, and settles at least one creature more than the last one did.
       */
      readonly settled?: number;
    }
  | {
      readonly type: 'declareBlockers';
      readonly player: PlayerId;
      readonly blocks: readonly BlockDeclaration[];
      /**
       * How many of the creatures that could block this answers for, counted off
       * `eligibleBlockers` in kernel order. Absent means all of them; see
       * `declareAttackers.settled` for why the count cannot be read off the
       * pairs.
       *
       * A prefix is held to one rule a whole declaration is not: it must be
       * completable. Menace (CR 702.110b) is the only rule that can make a
       * partial block a dead end, and `legal.ts` refuses such a prefix at the
       * offer rather than at the commit, so no listed option is a trap.
       */
      readonly settled?: number;
    }
  | {
      readonly type: 'orderBlockers';
      readonly player: PlayerId;
      readonly orders: readonly BlockerOrdering[];
    }
  | { readonly type: 'discard'; readonly player: PlayerId; readonly oids: readonly ObjectId[] }
  | {
      /**
       * CR 701.8: the cards a *resolution* discards, named by whoever the
       * effect asks.
       *
       * A separate kind from `discard` above, which is CR 514.1's cleanup and
       * only looks the same. That one asks the active player at end of turn,
       * derives its count from `config.maximumHandSize`, and finishes a step
       * when it is answered; this one is owed mid-resolution, carries a count
       * the card printed, and resumes a spell. Reusing `discard` would have
       * meant one reducer arm reading `awaiting` to find out which rule it was
       * performing, and `narrate.ts` calling both of them "discards down to
       * hand size".
       *
       * `player` is the seat answering, which under a `chooseDiscard` is not
       * the seat whose cards these are — the pending record holds the owner and
       * `answerHandDiscard` sends the cards to that player's graveyard.
       */
      readonly type: 'chooseDiscards';
      readonly player: PlayerId;
      readonly oids: readonly ObjectId[];
    }
  | {
      /** CR 701.18: both groups are ordered from the top of the library downward. */
      readonly type: 'scry';
      readonly player: PlayerId;
      readonly top: readonly ObjectId[];
      readonly bottom: readonly ObjectId[];
    }
  | {
      /**
       * CR 701.19a: which card the search takes, or nothing.
       *
       * `found: null` is always offered, and it is not a courtesy. CR 701.19c
       * lets a player fail to find even when the library holds a match, which
       * is the rule that makes a search safe to log: a seat that had to take a
       * card whenever one existed would have `librarySearched.found` read off
       * the library rather than off the choice, and the boolean would tell the
       * opponent the contents of a hidden zone.
       *
       * One card and not a list, because every search in the vocabulary takes
       * one — `searchLibraryEffect` (`@mtg/dsl`) prints no count, and a count
       * would need the whole ordered-subset enumeration `scry` pays for
       * without a card asking for it.
       */
      readonly type: 'searchLibrary';
      readonly player: PlayerId;
      readonly found: ObjectId | null;
    }
  | {
      /**
       * Which card a `chooseFromGraveyard` takes, or nothing.
       *
       * `searchLibrary`'s shape one zone over, and `chosen: null` is offered
       * for a different reason than `found: null` is. There it is CR 701.19c,
       * which exists so a public failure cannot leak the contents of a hidden
       * zone; here the zone is public and nothing leaks either way, so the null
       * arm is what makes "you may return target creature card" (Gravedigger)
       * and "return target creature card" (Disentomb) one effect instead of
       * two, with no `optional` flag for a card to set wrong.
       *
       * One card and not a list, because every printed clause this vocabulary
       * covers takes one: `chooseFromGraveyardEffect` (`@mtg/dsl`) prints no
       * count, and Spelltwine — the one M13 card that takes two — needs to
       * *cast* what it exiles and is out of reach for that reason rather than
       * this one.
       */
      readonly type: 'chooseFromGraveyard';
      readonly player: PlayerId;
      readonly chosen: ObjectId | null;
    }
  | {
      /**
       * CR 103.4: shuffle this opening hand back and draw a new one.
       *
       * It carries nothing but the seat, because a mulligan chooses nothing —
       * the whole hand goes back and a whole hand comes out. What the player
       * chose is *that*, which is why it is an action rather than a flag on the
       * keep.
       */
      readonly type: 'mulligan';
      readonly player: PlayerId;
    }
  | {
      /**
       * CR 103.4: keep this opening hand, putting one card on the bottom of the
       * library per mulligan already taken.
       *
       * The two halves ride in one action rather than two decisions, and that is
       * the one place this implementation compresses the rules. The London
       * mulligan bottoms after every player has kept; a player's own hand is the
       * only input to which cards go, and nothing between the keep and the
       * bottoming can change it in a two-player game, so asking both questions at
       * once produces the same position and one fewer stop to answer.
       *
       * `bottom` is exact rather than a prefix: it holds precisely as many cards
       * as `Decision.count` names, and every one of them has to be in the hand
       * being kept.
       */
      readonly type: 'keepHand';
      readonly player: PlayerId;
      readonly bottom: readonly ObjectId[];
    }
  | {
      /**
       * CR 704.5j: which of the same-named legendary permanents this player
       * keeps. The rest go to their owners' graveyards.
       *
       * `oid` names the survivor rather than the losers, which is the shape the
       * rule itself has ("that player chooses one of them") and the shape that
       * cannot be answered wrongly by arithmetic: an action that listed the
       * losers could name too few and leave the collision standing, so the sweep
       * would ask again forever.
       *
       * It carries no name and no group. Both are re-derived from the state by
       * `validateAction`, because the collision is a fact about the board and an
       * agent holding a stale decision must not be able to bury a permanent that
       * is no longer in one.
       */
      readonly type: 'keepLegend';
      readonly player: PlayerId;
      readonly oid: ObjectId;
    }
  | {
      /**
       * CR 701.17a: which creature a resolving `sacrificePermanent` takes.
       *
       * `keepLegend`'s shape, not `chooseFromGraveyard`'s: `oid` names the one
       * permanent chosen, re-validated against current state by
       * `validateAction` rather than trusted from a stale decision, the same
       * "the board is the authority" argument `keepLegend`'s docblock makes.
       * No null arm, unlike `chooseFromGraveyard`'s: a sacrifice is mandatory
       * whenever a legal candidate exists, so there is no printed "or nothing"
       * for a null to mean.
       */
      readonly type: 'sacrificePermanent';
      readonly player: PlayerId;
      readonly oid: ObjectId;
    }
  | { readonly type: 'concede'; readonly player: PlayerId };

export type ActionType = Action['type'];

/**
 * The three moves a surface builds rather than picks.
 *
 * A combat declaration is the only kind of action a player assembles out of
 * several presses, and it is also the only kind whose enumeration is exponential
 * in the board — which is why `session.ts` can end up recording one as itself
 * rather than as an index. Named here so both ends of a wire and both play
 * surfaces read one definition of which actions those are.
 */
export type DeclarationAction = Extract<
  Action,
  { readonly type: 'declareAttackers' | 'declareBlockers' | 'orderBlockers' }
>;

/** The declaration this action is, or null when it is some other move. */
export function asDeclaration(action: Action): DeclarationAction | null {
  switch (action.type) {
    case 'declareAttackers':
    case 'declareBlockers':
    case 'orderBlockers':
      return action;
    default:
      return null;
  }
}

/** Thrown when an agent submits something the rules do not allow. */
export class IllegalActionError extends Error {
  readonly action: Action;

  constructor(action: Action, reason: string) {
    super(`illegal action ${action.type} by player ${action.player}: ${reason}`);
    this.name = 'IllegalActionError';
    this.action = action;
  }
}
