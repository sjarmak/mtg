/**
 * The agent seam: what the kernel is asking, what the legal answers are, and
 * whether a submitted answer is legal.
 *
 * `pendingDecision` is the only question the kernel ever asks. Agents (greedy
 * bots today, an LLM referee later) receive the decision, pick an action, and
 * hand it back; they never touch state. `validateAction` is the guard that
 * makes that safe — it re-derives legality from the state rather than trusting
 * the enumerated list, so an agent that constructs its own declaration (needed
 * when a declaration space is too large to enumerate) is checked just as hard.
 */
import type { ActivatedAbility, Card, CastableCard, Effect, ManaCost } from '@mtg/dsl';
import {
  assertNever,
  canonicalJson,
  effectsFor,
  hasTarget,
  isAttachingAbility,
  isAuraCard,
  isCastable,
  isLoyaltyAbility,
  isManaAbility,
  manaAbilityOf,
  manaSourceColors,
  MAX_CHOSEN_X,
  MAX_SCRY_COUNT,
  resolveX,
  targetCountOf,
} from '@mtg/dsl';
import { counterCount } from './continuous';
import { isLegalAuraHost, isLegalHost } from './attach';
import { canBeTargetedBy } from './keyword-abilities';
import { activatedAbilityAt } from './abilities';
import type { Action, AttackDeclaration, BlockDeclaration } from './actions';
import {
  attackersNeedingOrder,
  canBlock,
  combatDefenders,
  eligibleAttackers,
  eligibleBlockers,
  hasCombatModification,
  isLegalCombatDefender,
  luredDefenders,
  validateBlocks,
} from './combat';
import { damageOrderClasses } from './damage-order';
import type { Enumerated } from './enumerate';
import {
  cartesian,
  combinations,
  DEFAULT_ENUMERATION_CAP,
  distinctPermutations,
  permutations,
  subsets,
  subsetsUpToSize,
} from './enumerate';
import { honoursDistinctSlots, isTargetStillLegal, sameTarget, survivingMultipleTargets } from './effects';
import { effectiveManaCost, maxPayableX } from './cost';
import type { ObjectId, PlayerId } from './ids';
import { controlledBy, controllerOf, hasCardType, hasKeyword, hasSubtype, isCreatureObject } from './layers';
import { opponentOf } from './ids';
import { availableMana, canPay, landProduces } from './mana';
import type { SpellOnStack } from './may-choice';
import { spellAwaitingMay } from './may-choice';
import type { TolledSpellOnStack } from './unless-choice';
import { spellAwaitingUnless } from './unless-choice';
import { canMulligan, cardsToBottom } from './mulligan';
import type { LegendCollision } from './sba';
import { pendingLegendCollision } from './sba';
import type { Block, CombatDefender, GameState, ManaColor, Target } from './state';
import { isMainPhase } from './state';
import {
  countedSlotCandidates,
  everySlotHasAChoice,
  targetChoicesFor,
  targetChoicesForActivation,
  targetChoicesForEffects,
} from './target-choices';
import { playerOf } from './trace';
import type { TriggerOnStack } from './trigger-choice';
import { optionalTriggerOnTop, triggerAwaitingTargets, triggerTargetChoices } from './trigger-choice';
import { getObject, tryObject } from './zones';

/** One eligible blocker and every attacker it may legally block. */
export interface BlockCandidates {
  readonly blocker: ObjectId;
  /** Never empty: a creature that can block nothing is not a candidate list. */
  readonly attackers: readonly ObjectId[];
}

export type Decision =
  | {
      /** CR 701.18: every ordered partition of the visible top window. */
      readonly kind: 'scry';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /**
       * CR 701.19a: every card in the searcher's library the filter matches,
       * plus failing to find.
       *
       * `cards` is the *legal* answers and not the library, which is the whole
       * of this decision's concealment story — a seat reading its own decision
       * learns the matching cards, which CR 701.19a entitles it to, and the
       * other seat is never offered the decision at all, because the per-seat
       * projection strips `pendingSearch` out of a position the way it already
       * strips `pendingScry`. That sentence deliberately does not name the
       * projection function: `visibility.test.ts` keeps a ledger of the kernel
       * files allowed to so much as spell it, and it reads the source as text,
       * so a mention in a comment is a file claiming a right it does not have.
       *
       * `complete` is always `true`: the option list is one entry per match
       * plus one, so it is linear in the library and nothing here needs the
       * bound `scry`'s factorial enumeration is held to.
       */
      readonly kind: 'searchLibrary';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /**
       * Every card in a graveyard a `chooseFromGraveyard` filter matches, plus
       * taking none.
       *
       * The decision above with its concealment story removed. `cards` is the
       * legal answers here too, but a graveyard is a public zone (CR 400.2), so
       * that list names nothing the other seat could not already read off the
       * table — which is why this position is *not* stripped from the other
       * seat's projection and why the search's paragraph about who may see the
       * list has no counterpart here.
       *
       * `complete` is always `true` for the search's reason: one option per
       * match plus one, linear in the graveyards, nothing to truncate.
       */
      readonly kind: 'graveyardChoice';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /**
       * CR 701.17a: which of the target player's own creatures a resolving
       * `sacrificePermanent` takes.
       *
       * The graveyard choice above with the zone swapped for the battlefield —
       * same public-zone reasoning, same "not stripped from the other seat's
       * projection" consequence — and `legendRuleDecision`'s shape otherwise:
       * one option per candidate creature and no "take none" arm, because CR
       * 701.17a is mandatory whenever `permanents` is non-empty (an empty list
       * never reaches here at all; `applyResolutionEffects` resolves that case
       * without pausing).
       *
       * `permanents` names the candidates rather than `cards`, matching this
       * kind's own pending record (`PendingPermanentSacrifice`) rather than
       * `graveyardChoice`'s field name — a permanent and a graveyard card are
       * different enough objects that reusing the name would read as a copy-
       * paste rather than a deliberate reuse of the shape.
       *
       * `complete` is always `true`: one option per creature the target
       * controls, linear in the board, nothing to truncate.
       */
      readonly kind: 'permanentSacrifice';
      readonly player: PlayerId;
      readonly permanents: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /**
       * CR 103.4: keep this opening hand, or shuffle it back and draw another.
       *
       * `count` is what a keep costs — one card to the bottom per mulligan
       * already taken — and it is on the decision rather than left to be derived
       * from `mulligans`, because a hand can be shorter than the mulligan count
       * when a small library ran out and the number a keep must name is the
       * smaller of the two.
       */
      readonly kind: 'mulligan';
      readonly player: PlayerId;
      /** Mulligans this seat has already taken. */
      readonly mulligans: number;
      /** Cards a keep puts on the bottom of the library. */
      readonly count: number;
      readonly hand: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      readonly kind: 'priority';
      readonly player: PlayerId;
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      readonly kind: 'declareAttackers';
      readonly player: PlayerId;
      readonly defender: PlayerId;
      readonly defenders: readonly CombatDefender[];
      readonly eligible: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      readonly kind: 'declareBlockers';
      readonly player: PlayerId;
      readonly attackers: readonly ObjectId[];
      readonly eligible: readonly ObjectId[];
      /**
       * Per blocker, every attacker it may legally be assigned to (CR 509.1a).
       *
       * `options` is the declaration space and is exponential; this is the same
       * legality read one creature at a time, so its size is blockers x
       * attackers and no cap can reach it. It exists because the exponential
       * list is the wrong thing for a surface to read a creature's candidates
       * off: `mtg-y1t.2` measured a three-attacker, eight-blocker board where
       * the 512-option prefix mentions three of the eight blockers in no option
       * at all and offers 13 of the 24 legal pairs, so a roster built from
       * `options` silently drops creatures that can block.
       *
       * It is not a second opinion about who may block what. `blockerDecision`
       * builds the declaration space out of exactly this list, so the two agree
       * by construction rather than by agreement.
       */
      readonly candidates: readonly BlockCandidates[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      readonly kind: 'orderBlockers';
      readonly player: PlayerId;
      readonly blocks: readonly Block[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      readonly kind: 'discard';
      readonly player: PlayerId;
      readonly count: number;
      readonly hand: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * CR 701.8: which cards a resolution discards, and out of whose hand.
       *
       * `hand` is not always this seat's. Under a `chooseDiscard` the effect's
       * controller is asked about the opponent's cards, `owner` names whose
       * they are, and `revealed` records that CR 701.16a already showed them —
       * which is what makes offering this decision legal rather than a leak. A
       * surface reads `revealed` to decide whether it may print the card faces
       * to the seat being asked; a `discardCards` sets it false, and there the
       * seat is the owner and is entitled to its own hand anyway.
       *
       * `count` is already clamped to `hand` by the time the decision is built
       * (`scry.ts` performs the take-everything case rather than banking it),
       * so a surface never has to re-derive CR 701.8a's "as many as possible".
       *
       * `hand` is what may be *chosen*, which is the whole revealed hand on
       * every card that prints no filter and a subset of it on Duress. It is
       * never the seat's current hand: read `PendingHandDiscard` for the two
       * lists and which surface wants which.
       *
       * Distinct from `discard` above, which is CR 514.1's cleanup: that one
       * derives its count from `config.maximumHandSize` and finishes a step,
       * this one carries a printed count and resumes a spell.
       */
      readonly kind: 'handDiscard';
      readonly player: PlayerId;
      readonly owner: PlayerId;
      readonly count: number;
      readonly hand: readonly ObjectId[];
      readonly revealed: boolean;
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * CR 603.3d: aim a triggered ability that is being put on the stack.
       *
       * `oid` is the ability object; `source` and `abilityIndex` are the printed
       * text behind it, carried so a prompt can print the line and a bot can
       * score the effects without walking the stack for them.
       */
      readonly kind: 'triggerTargets';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly source: ObjectId;
      readonly abilityIndex: number;
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * CR 603.3b: take an optional trigger, or decline it, as it resolves.
       *
       * `targets` is what the ability was aimed at when it went on the stack,
       * which is the half of the question the options themselves cannot show:
       * the two options are "yes" and "no", and what is being said yes to is the
       * printed line pointed at these.
       */
      readonly kind: 'optionalTrigger';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly source: ObjectId;
      readonly abilityIndex: number;
      readonly targets: readonly (Target | null)[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * CR 601.2c: take a spell's "you may", or leave it, as it resolves.
       *
       * `optionalTrigger`'s shape (`mtg-bc2.152.4`), widened from a triggered
       * ability to a spell and from "always the controller" to whichever
       * player the card names — `player` here is who is asked, which need not
       * be who cast it, so a punisher spell's "an opponent may..." is
       * addressed to the right seat. No `source`/`abilityIndex`: a spell is
       * its own source, so `oid` is the whole of what a prompt needs to look
       * the question up, the way `targets` is what it needs to show what is
       * being said yes to.
       */
      readonly kind: 'may';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly targets: readonly (Target | null)[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * CR 118.8: pay a spell's printed toll and stop it, or let it happen.
       *
       * `may`'s shape aimed at the other side of the table, and `cost` is the
       * one field it adds. A prompt cannot render this question without the
       * price — "do you want to stop it" is not a decision until the player is
       * told what stopping it costs — and the price is on the card rather than
       * in the option list, which holds two actions that differ by a boolean.
       * `player` is derived from `targets` rather than named by the card
       * (`unless-choice.ts`), so it is never the spell's controller.
       */
      readonly kind: 'unless';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly cost: ManaCost;
      readonly targets: readonly (Target | null)[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * CR 704.5j: which of the same-named legendary permanents you keep.
       *
       * The only decision raised by a state-based action, and the only one whose
       * asked player is neither the active player nor the holder of priority.
       * `name` and `candidates` are on the decision because the option list
       * cannot carry them: every option is the same act pointed at a different
       * permanent, so a prompt with only the actions has nothing to put in its
       * headline.
       *
       * `complete` is unconditionally true, and no cap is threaded in. The
       * option list is the candidate list — one permanent, one option — so its
       * length is the number of same-named legends one player controls, which is
       * bounded by the battlefield and is two on every board anyone has played.
       */
      readonly kind: 'legendRule';
      readonly player: PlayerId;
      readonly name: string;
      readonly candidates: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    };

/**
 * CR 307.1: your turn, a main phase, an empty stack, and priority.
 *
 * Named and extracted because two different rules ask for it: a sorcery is cast
 * at this window, and CR 702.6b's equip is activated only at it. A second copy
 * would be a second chance for the two to disagree about what a main phase is.
 */
function atSorcerySpeed(state: GameState, player: PlayerId): boolean {
  return (
    state.turn.active === player &&
    isMainPhase(state.turn.step) &&
    state.stack.length === 0 &&
    state.turn.priority === player
  );
}

function canCastNow(state: GameState, player: PlayerId, card: Card): boolean {
  if (card.kind === 'instant') return true;
  return atSorcerySpeed(state, player);
}

/**
 * The X values worth offering for one card, or the single `undefined` slot a
 * card with no X carries — so `castOptions` can loop over one list either
 * way rather than branching its whole body on `hasX`.
 *
 * Bounded by `cap` the same way `cartesian` bounds target combinations,
 * because a spell with a large affordable range would otherwise multiply the
 * enumeration by that range on its own, uncapped by anything else in this
 * function. `complete` reports the truncation the same way `cartesian`'s
 * does, so a sweep that ran out of room here can tell.
 */
function xOptionsFor(
  state: GameState,
  player: PlayerId,
  card: CastableCard,
  cap: number,
): { readonly values: readonly (number | undefined)[]; readonly complete: boolean } {
  if (!card.manaCost.hasX) return { values: [undefined], complete: true };
  const max = maxPayableX(state, player, card);
  if (max === null) return { values: [], complete: true };
  // `MAX_CHOSEN_X` is a legality bound, not an enumeration bound, so it
  // narrows the range before `cap` does and never marks the result
  // incomplete: an X above it is a value `validateCast` refuses, not one this
  // function ran out of room for. Reporting it as truncation would tell a
  // sweep the kernel has more legal casts here than it does. Without this the
  // enumeration would offer casts its own validator throws on, which is the
  // one disagreement between the two lists this file exists to prevent.
  const announceable = Math.min(max, MAX_CHOSEN_X);
  const bounded = Math.min(announceable, cap);
  return {
    values: Array.from({ length: bounded + 1 }, (_, index) => index),
    complete: bounded === announceable,
  };
}

/**
 * The mode indices worth offering for one card, or the single `undefined`
 * slot a non-modal card carries — `xOptionsFor`'s shape, so `castOptions` can
 * loop over one list either way rather than branching on whether the card is
 * modal. CR 700.2 caps a mode list at `MAX_MODES` (6) in the schema itself
 * (`@mtg/dsl`'s `modal.ts`), an order of magnitude under any cap this file
 * enforces, so there is nothing here for `cap` to bound.
 */
function modeOptionsFor(card: CastableCard): readonly (number | undefined)[] {
  return card.modes === undefined ? [undefined] : card.modes.map((_, index) => index);
}

/**
 * Builds one `castSpell` action. `x`, `mode` and `multiTargets` are each
 * independently optional and `exactOptionalPropertyTypes` forbids writing
 * `undefined` into any of the three slots (`actions.ts`'s docblock on `x`),
 * so each is folded in through a conditional spread that omits the key
 * entirely when the value is `undefined` rather than setting it to
 * `undefined` — the same construction `pushSpell` (`stack.ts`) and
 * `ApplyContext` (`effects.ts`) already use for their own optional fields,
 * and the one this replaced a three-field-only four-branch `if` chain with:
 * a fourth optional field would have doubled that chain to eight branches
 * for no reader benefit over the spread saying the same thing once.
 */
function buildCastAction(
  player: PlayerId,
  oid: ObjectId,
  targets: readonly (Target | null)[],
  x: number | undefined,
  mode: number | undefined,
  multiTargets: Readonly<Record<number, readonly ObjectId[]>> | undefined,
): Action {
  return {
    type: 'castSpell',
    player,
    oid,
    targets,
    ...(x !== undefined ? { x } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(multiTargets !== undefined ? { multiTargets } : {}),
  };
}

/**
 * The `Action.multiTargets` maps worth offering for one effect list, one per
 * combination of member choices across every `TargetSpec.count` slot the
 * list carries ("up to two target creatures", `mtg-kg44`) — the single
 * `undefined` slot for a list with no counted slot, so `castOptions` can
 * cross this against its ordinary `Target | null` combinations the same way
 * `xOptionsFor` and `modeOptionsFor` let it cross X and mode without
 * branching on whether the card has either.
 *
 * `targetChoicesForEffects` deliberately answers a counted slot's own
 * `Target | null` question with `[null]` regardless of the board (its own
 * docblock explains why); this is the function that answers the different
 * question of what the side-channel choice may hold, using
 * `countedSlotCandidates`' individually-legal creature list and
 * `subsetsUpToSize` for "0 through count members, smallest first" the same
 * way any other bounded enumeration in this file is built.
 */
function multiTargetsOptionsFor(
  state: GameState,
  effects: readonly Effect[],
  controller: PlayerId,
  cap: number,
  source?: ObjectId,
): Enumerated<Readonly<Record<number, readonly ObjectId[]>> | undefined> {
  const counted = effects
    .map((effect, index) => ({ effect, index }))
    .filter((entry): entry is { effect: Effect; index: number } => {
      const { effect } = entry;
      return hasTarget(effect) && targetCountOf(effect.target) !== null;
    });
  if (counted.length === 0) return { items: [undefined], complete: true };
  let combos: Readonly<Record<number, readonly ObjectId[]>>[] = [{}];
  let complete = true;
  for (const { effect, index } of counted) {
    if (!hasTarget(effect)) continue;
    const count = targetCountOf(effect.target);
    if (count === null) continue;
    const candidates = countedSlotCandidates(state, effect, controller, source);
    const memberOptions = subsetsUpToSize(candidates, count, cap);
    if (!memberOptions.complete) complete = false;
    const grown: Readonly<Record<number, readonly ObjectId[]>>[] = [];
    for (const prefix of combos) {
      for (const chosen of memberOptions.items) {
        if (grown.length >= cap) {
          complete = false;
          break;
        }
        grown.push({ ...prefix, [index]: chosen });
      }
      if (grown.length >= cap) break;
    }
    combos = grown;
    if (!complete) break;
  }
  return { items: combos, complete };
}

function castOptions(state: GameState, player: PlayerId, cap: number): Enumerated<Action> {
  const hand = playerOf(state, player).hand;
  const options: Action[] = [];
  let complete = true;
  for (const oid of hand) {
    const card = getObject(state, oid).card;
    if (!isCastable(card)) continue;
    if (!canCastNow(state, player, card)) continue;
    const xOptions = xOptionsFor(state, player, card, cap);
    if (!xOptions.complete) complete = false;
    for (const x of xOptions.values) {
      if (!canPay(state, player, effectiveManaCost(state, player, card, x))) continue;
      for (const mode of modeOptionsFor(card)) {
        const effects = effectsFor(card, mode ?? null);
        // An Aura carries its restriction on `card.aura.enchant` and prints no
        // effect, so an effects-only enumeration hands it an empty slot list,
        // offers it with no target, and `validateCast` then refuses every cast
        // it produced — the card is uncastable while the enumeration reports it
        // castable. `validateCast` reads `isAuraCard` before it reads the effect
        // list; this reads it in the same order, so the two agree about what a
        // legal cast of this card is.
        //
        // The casting object goes through as the protection source in both arms
        // (CR 702.16b): a shrouded or protected permanent is not a choice the
        // enumeration may offer, and dropping the argument makes it one.
        const choices = isAuraCard(card)
          ? targetChoicesFor(state, card, player, oid)
          : targetChoicesForEffects(state, effects, player, oid);
        if (!everySlotHasAChoice(choices)) continue;
        const combos = cartesian(choices, cap);
        if (!combos.complete) complete = false;
        const multiTargetsOptions = isAuraCard(card)
          ? { items: [undefined], complete: true }
          : multiTargetsOptionsFor(state, effects, player, cap, oid);
        if (!multiTargetsOptions.complete) complete = false;
        for (const targets of combos.items) {
          // A tuple dropped for aiming two `distinct` slots at one target is a
          // tuple the card never offered, not one the cap cut off, so `complete`
          // stays whatever the enumeration said. Reporting truncation here would
          // tell the sweep the kernel ran out of room when it did not.
          if (!honoursDistinctSlots(effects, targets)) continue;
          for (const multiTargets of multiTargetsOptions.items) {
            options.push(buildCastAction(player, oid, targets, x, mode, multiTargets));
          }
        }
      }
    }
  }
  return { items: options, complete };
}

/**
 * Why this player cannot activate this printed ability right now, or `null`
 * when they can.
 *
 * One function, read by both the enumeration and `validateAction`, and that is
 * not the "trust the list" shortcut this file's header warns against: the
 * guard re-derives every condition from the state it is handed, so an agent
 * that constructs an activation the enumeration never offered is checked
 * against the same rules rather than against the list.
 *
 * The tap conditions are where the rules live. `cost.tapSelf` needs an untapped
 * source, and CR 302.6 needs one that is not summoning-sick *if it is currently
 * a creature* — `isCreatureObject` is layer-aware, so an animated artifact is
 * correctly sick and a creature that lost its type correctly is not. Control is
 * read through `controllerOf` rather than `GameObject.controller`, so a
 * control-change effect moves the ability with the permanent.
 *
 * `cost.sacrificeSelf` adds no condition of its own, and that is a finding
 * rather than an omission. CR 701.17a lets a player sacrifice any permanent
 * they control, with no further restriction, so "the sacrifice is available" is
 * exactly "the source is a permanent this player controls" — which the first
 * two lines below already require of every activation. A separate check here
 * would be a branch nothing can enter. What the two lines gain is weight: they
 * are now the reason a sacrifice ability can be paid for exactly once, since
 * the source is in the graveyard the moment the cost is paid and neither
 * `controlledBy` nor this guard will see it again.
 *
 * CR 302.6 is deliberately *not* extended to it. Summoning sickness restricts
 * `{T}` and `{Q}` and nothing else, so a creature that arrived this turn may
 * sacrifice itself for its own ability; hoisting that check out of the tap
 * branch would refuse a legal activation.
 *
 * `cost.sacrificeOther` is the one part of a cost that can be unpayable for a
 * reason the board states rather than the source does, so it is the one that
 * adds a condition here: a player holding one Key cannot open a Chest that
 * costs two. It is checked by counting the permanents that qualify rather than
 * by looking at what the agent offered, because this guard runs before there is
 * an offer — `validateSacrifices` checks the offer itself.
 *
 * An equip ability is the one exception, and it adds the two conditions CR
 * 702.6b writes into the keyword itself rather than into this card: it is
 * activated only as a sorcery, and CR 301.5e forbids an Equipment that is also
 * a creature from equipping one. Both are special-cased to equip rather than
 * generalized into a timing field on every activated ability, because CR 602.2
 * still leaves every other v1 ability instant-speed and a restriction field
 * nothing else sets is a field every renderer, the Forge transpiler and the
 * generator's prompt would have to learn to express one keyword. The day a
 * second sorcery-speed ability arrives, `atSorcerySpeed` is already named and
 * the field is one line.
 */
function activationBlocker(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  ability: ActivatedAbility,
): string | null {
  const object = tryObject(state, oid);
  if (object === undefined || object.zone !== 'battlefield') return 'source is not on the battlefield';
  if (controllerOf(state, oid) !== player) return 'you do not control that source';
  if (isAttachingAbility(ability)) {
    if (isCreatureObject(state, oid)) return 'an Equipment that is a creature cannot equip a creature';
    if (!atSorcerySpeed(state, player)) return 'equip is activated only as a sorcery';
  }
  if (isLoyaltyAbility(ability)) {
    if (!hasCardType(state, oid, 'planeswalker')) return 'a loyalty ability requires a planeswalker source';
    if (!atSorcerySpeed(state, player)) return 'a loyalty ability is activated only as a sorcery';
    if (object.loyaltyActivatedTurn === state.turn.number) {
      return 'this permanent has already activated a loyalty ability this turn';
    }
    const loyalty = counterCount(object.counters, 'loyalty');
    if (ability.loyaltyCost < 0 && loyalty + ability.loyaltyCost < 0) {
      return `the loyalty cost removes ${String(-ability.loyaltyCost)} counters and this permanent has ${String(loyalty)}`;
    }
  }
  if (ability.cost.tapSelf) {
    if (object.tapped) return 'source is already tapped';
    // CR 702.10c: haste does not clear summoning sickness, it waives what
    // sickness forbids — so the keyword is asked here rather than at the point
    // the flag is set, exactly as `eligibleAttackers` asks it for CR 702.10b.
    // The two restrictions sickness imposes are attacking and this cost, and
    // haste is the one keyword that lifts both.
    if (isCreatureObject(state, oid) && object.summoningSick && !hasKeyword(state, oid, 'haste')) {
      return 'that creature has not been under your control since your turn began';
    }
  }
  const sacrifice = ability.cost.sacrificeOther;
  if (sacrifice !== undefined) {
    const available = sacrificeCandidates(state, player, oid, sacrifice.subtype).length;
    if (available < sacrifice.count) {
      return `you control ${available} ${sacrifice.subtype} permanents and the cost sacrifices ${sacrifice.count}`;
    }
  }
  // CR 601.2h: a cost is paid in full or the activation is rewound, and CR
  // 701.8a's "as many as possible" is about an *effect* rather than a cost. So
  // a hand short of the number cannot pay at all — this is the one place the
  // two discards differ in arithmetic, and reading the effect's clamp here
  // would let a player activate for free with an empty hand.
  const discard = ability.cost.discard;
  if (discard !== undefined && playerOf(state, player).hand.length < discard) {
    return `the cost discards ${String(discard)} and you hold ${String(playerOf(state, player).hand.length)}`;
  }
  // An `{X}` in the cost is priced at zero here, and that is the whole question
  // this function asks: X = 0 is always announceable (CR 107.3f puts no floor on
  // it), so a player who cannot pay the cost with X = 0 cannot activate at any X
  // at all, and one who can is offered the range by `activationXOptions`.
  // `resolveX` is written out rather than left implicit because `canPay` reads
  // `generic` and the colored pips and would silently treat `{X}{G}{G}` as
  // `{G}{G}` either way — the call says which reading is intended.
  if (!canPay(state, player, resolveX(ability.cost.mana, 0), ability.cost.tapSelf ? [oid] : [])) {
    return 'cannot pay the mana cost';
  }
  return null;
}

/**
 * The permanents a `sacrificeOther` cost could eat right now.
 *
 * CR 701.17a: a player may sacrifice a permanent they control, and nothing
 * else. The subtype is read through `hasSubtype`, which is layer-aware, so a
 * Key that a CR 613 layer-4 effect turned into a Wall stops paying for Chests
 * while it is one. `source` is excluded because the field is named for what it
 * is: `sacrificeSelf` is the source's own payment and this is everything else,
 * and letting a Chest count itself as a Key would let a one-Key cost be paid
 * with no Key at all.
 */
function sacrificeCandidates(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  subtype: string,
): readonly ObjectId[] {
  return state.battlefield.filter(
    (oid) => oid !== source && controllerOf(state, oid) === player && hasSubtype(state, oid, subtype),
  );
}

/**
 * Whether the permanents an agent offered are the ones the cost asks for.
 *
 * Three rules, and each one is a way an offer can be wrong that the count alone
 * would miss: too few (or too many) named, the same permanent named twice to
 * make up the count, and a permanent that qualifies for everything except being
 * yours. The last is the one a hand-built action reaches most easily, because
 * an opponent's Key looks exactly like your own from everywhere but here.
 */
function validateSacrifices(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  ability: ActivatedAbility,
  offered: readonly ObjectId[],
): string | null {
  const sacrifice = ability.cost.sacrificeOther;
  const wanted = sacrifice?.count ?? 0;
  if (offered.length !== wanted) {
    if (sacrifice === undefined) return `this ability sacrifices nothing, and ${offered.length} was offered`;
    return `the cost sacrifices ${wanted} ${sacrifice.subtype} permanents, and ${offered.length} was offered`;
  }
  if (sacrifice === undefined) return null;
  const eligible = new Set(sacrificeCandidates(state, player, source, sacrifice.subtype));
  const seen = new Set<ObjectId>();
  for (const oid of offered) {
    if (seen.has(oid)) return `${oid} was offered twice`;
    seen.add(oid);
    if (!eligible.has(oid)) return `${oid} is not a ${sacrifice.subtype} permanent you control`;
  }
  return null;
}

/**
 * Whether the cards an agent offered pay this ability's `cost.discard`.
 *
 * `validateSacrifices` for a hidden zone, with the same three refusals — wrong
 * count, one card named twice, a card that is not the payer's to spend — and
 * one difference in how the last is judged. A sacrifice is checked against a
 * derived candidate list because a permanent can stop qualifying while staying
 * on the battlefield (a layer-4 effect changes its subtype); a hand card
 * qualifies by being in the hand and nothing else, so the check reads the zone
 * directly. `activationBlocker` has already refused a hand too small to pay,
 * so a wrong count here is an agent that built its own action.
 *
 * The offered list is not ordered against the hand the way a partial selection
 * is. This is a cost, paid whole at CR 601.2h and never asked one card at a
 * time, so there is no prefix for two orders of the same three cards to
 * disagree about — `oneAbilityOptions` enumerates each payment once, in
 * `combinations` order, and that is the only order a recording can hold.
 */
function validateDiscards(
  state: GameState,
  player: PlayerId,
  ability: ActivatedAbility,
  offered: readonly ObjectId[],
): string | null {
  const wanted = ability.cost.discard ?? 0;
  if (offered.length !== wanted) {
    if (ability.cost.discard === undefined) {
      return `this ability discards nothing, and ${offered.length} was offered`;
    }
    return `the cost discards ${wanted} cards, and ${offered.length} was offered`;
  }
  const hand = new Set(playerOf(state, player).hand);
  const seen = new Set<ObjectId>();
  for (const oid of offered) {
    if (seen.has(oid)) return `${oid} was offered twice`;
    seen.add(oid);
    if (!hand.has(oid)) return `${oid} is not in your hand`;
  }
  return null;
}

/**
 * Every activation this player could pay for right now, with every legal target
 * tuple.
 *
 * `castOptions` with three substitutions: the source list is the permanents
 * this player controls rather than their hand, the cost check is the ability's
 * rather than the card's, and the target spaces come from the ability's effect
 * list. Everything else — `cartesian`, `honoursDistinctSlots`, the `complete`
 * flag — is the same code a cast already runs through, which is what makes a
 * new action type reach the play surface as a button with no UI change.
 *
 * Activations multiply the option list at *every* priority window rather than
 * only on this player's own turn, which is the enumeration-growth risk the
 * design named. The cap is honored and reported the same way a cast's is, so
 * truncation shows up as `Decision.complete` going false rather than as options
 * quietly disappearing.
 */
function activationOptions(state: GameState, player: PlayerId, cap: number): Enumerated<Action> {
  const options: Action[] = [];
  let complete = true;
  for (const oid of controlledBy(state, player)) {
    const abilities = getObject(state, oid).card.abilities;
    for (const [abilityIndex, ability] of abilities.entries()) {
      if (ability.kind !== 'activated') continue;
      // CR 605.3a: a mana ability does not use the stack, so it is never an
      // `activateAbility`. `manaAbilityOptions` offers it instead, once per
      // color it can make. Without this line the same printed ability would be
      // offered twice under two action types, and the `activateAbility` copy
      // would push it onto the stack.
      if (isManaAbility(ability)) continue;
      if (activationBlocker(state, player, oid, ability) !== null) continue;
      const enumerated = oneAbilityOptions(state, player, oid, abilityIndex, ability, cap);
      if (!enumerated.complete) complete = false;
      options.push(...enumerated.items);
    }
  }
  return { items: options, complete };
}

/**
 * The X values worth offering for one activation, or the single `undefined`
 * slot an ability with no `{X}` carries — `xOptionsFor`'s shape and its
 * argument, for an ability rather than a spell, so `oneAbilityOptions` loops
 * over one list either way instead of branching its body on `hasX`.
 *
 * The search is `maxPayableX`'s and deliberately not a call to it. Two things
 * differ, and both would be wrong the other way round. It resolves X with
 * `resolveX` alone rather than through `effectiveManaCost`, because a CR 601.2f
 * cost reduction is written about *spells* and an activated ability is not one
 * (CR 602.2a) — `cost.ts`'s own docblock says this seam is spell costs only, and
 * routing an activation through it would offer an X the reducer then refuses to
 * charge for. And it passes the tap-self exclusion every other activation cost
 * check in this file passes, because a source paying its own `{T}` cannot also
 * tap for the mana; `availableMana` is still a fair ceiling for the countdown,
 * since excluding a source can only lower what is payable.
 *
 * `MAX_CHOSEN_X` narrows before `cap` does and never marks the result
 * incomplete, for the reason `xOptionsFor` gives at length: an X above it is a
 * value `validateActivation` refuses, not one this function ran out of room for.
 */
function activationXOptions(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  ability: ActivatedAbility,
  cap: number,
): Enumerated<number | undefined> {
  if (!ability.cost.mana.hasX) return { items: [undefined], complete: true };
  const excluded = ability.cost.tapSelf ? [oid] : [];
  const ceiling = availableMana(state, player);
  let max: number | null = null;
  for (let x = ceiling; x >= 0; x -= 1) {
    if (canPay(state, player, resolveX(ability.cost.mana, x), excluded)) {
      max = x;
      break;
    }
  }
  if (max === null) return { items: [], complete: true };
  const announceable = Math.min(max, MAX_CHOSEN_X);
  const bounded = Math.min(announceable, cap);
  return {
    items: Array.from({ length: bounded + 1 }, (_, index) => index),
    complete: bounded === announceable,
  };
}

/**
 * Every activation of one printed ability: every target tuple against every way
 * of paying its `sacrificeOther` cost.
 *
 * The cap bounds what this returns, not what any one dimension returns on its
 * own. A cast's cap bounds one card's whole option list, and an activation now
 * has several dimensions that multiply — C(20,2) payments against three targets
 * is 570 actions out of two enumerations that each stopped well inside 512 — so
 * capping them separately and multiplying would hand the agent a list longer
 * than the number the decision reports as its bound, with `complete` still true.
 * That is the failure the cap exists to make impossible: options are either all
 * there, or the decision says they are not.
 */
function oneAbilityOptions(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  abilityIndex: number,
  ability: ActivatedAbility,
  cap: number,
): Enumerated<Action> {
  // An empty slot needs no early-out: `cartesian` over a dimension with no
  // members yields no tuples and stays `complete`, so the loop below simply
  // does not run. A guard that only restates what the next line already does is
  // a guard no test can reach.
  const combos = cartesian(targetChoicesForActivation(state, ability, player, oid), cap);
  // Which permanents pay a `sacrificeOther` cost is a choice the same way a
  // target is, so it is enumerated the same way and rides in the same action. A
  // cost that names none yields the single empty payment, so the loop below runs
  // once per target tuple exactly as it did before.
  const payments = sacrificePayments(state, player, oid, ability, cap);
  // The third dimension, and the same argument a second time: which cards pay a
  // `cost.discard` is a choice, so it is enumerated rather than picked, and an
  // ability that names no discard yields the single empty payment so the loop
  // below runs exactly as many times as it did before.
  const discards = discardPayments(state, player, ability, cap);
  // The fourth dimension, and the one that grows fastest: an announced X (CR
  // 601.2b through CR 602.2b) is a choice like the other three, so it is
  // enumerated rather than picked, and an ability with no `{X}` yields the
  // single `undefined` slot so the loop below runs exactly as many times as it
  // did before. This is the growth `activationOptions` warns about, at every
  // priority window of both seats — which is why `checkActivationCost` refuses
  // an `{X}` no effect reads rather than letting a card multiply the option
  // list to change nothing.
  const xValues = activationXOptions(state, player, oid, ability, cap);
  const options: Action[] = [];
  for (const targets of combos.items) {
    // The one filter that is load-bearing here: each slot's choices were built
    // without looking at the others, so `cartesian` pairs a `distinct` slot with
    // the very target the slot before it took.
    if (!honoursDistinctSlots(ability.effects, targets)) continue;
    for (const sacrifices of payments.items) {
      for (const discarded of discards.items) {
        for (const x of xValues.items) {
          if (options.length >= cap) return { items: options, complete: false };
          options.push(
            buildActivationAction(player, oid, abilityIndex, targets, sacrifices, {
              discards: ability.cost.discard === undefined ? undefined : discarded,
              x,
            }),
          );
        }
      }
    }
  }
  return {
    items: options,
    complete: combos.complete && payments.complete && discards.complete && xValues.complete,
  };
}

/**
 * Builds one `activateAbility` action.
 *
 * `buildCastAction` one card type out, and it exists for the same reason that
 * one does: `discards` and `x` are independently optional and
 * `exactOptionalPropertyTypes` forbids writing `undefined` into either slot, so
 * each is folded in through a conditional spread that omits the key rather than
 * setting it to `undefined`. Writing that inline was a two-branch ternary while
 * `discards` was the only optional field; a second one would have made it four
 * branches saying one thing.
 *
 * Both slots arrive as "present or `undefined`" and the caller decides which.
 * A discard is `undefined` when the printed cost names none rather than when the
 * chosen list is empty, because an ability with no discard cost has never
 * carried the key at all and every recording made before that cost existed
 * holds the keyless spelling. `x` needs no such rule: `activationXOptions`
 * yields `undefined` exactly when the cost prints no `{X}`.
 */
function buildActivationAction(
  player: PlayerId,
  oid: ObjectId,
  abilityIndex: number,
  targets: readonly (Target | null)[],
  sacrifices: readonly ObjectId[],
  optional: { readonly discards: readonly ObjectId[] | undefined; readonly x: number | undefined },
): Action {
  return {
    type: 'activateAbility',
    player,
    oid,
    abilityIndex,
    targets,
    sacrifices,
    ...(optional.discards !== undefined ? { discards: optional.discards } : {}),
    ...(optional.x !== undefined ? { x: optional.x } : {}),
  };
}

/**
 * Every set of permanents that could pay this ability's `sacrificeOther` cost.
 *
 * An ability that names no sacrifice yields one payment, the empty one, rather
 * than none: `activationOptions` multiplies this against the target tuples, and
 * an empty list there would delete every option for every ability written
 * before Chests existed.
 *
 * The `cap` reaching `combinations` is the one that bounds the *work*. The
 * product cap in `oneAbilityOptions` bounds only what is returned, and it runs
 * after this call has already recursed to completion and built an array per
 * C(n,k) set, so dropping this argument would leave every option list identical
 * and build 91,390 arrays to keep 512 of them on a board of forty Keys and one
 * chest that eats four, at every priority window. It changes an
 * answer in exactly one place — a cost that could be paid many ways for an
 * ability with no legal target, where the product yields nothing and this
 * `complete` is the only one left to report — and that board is
 * `chest-and-keys.test.ts`'s "reports the cap that bit on a dimension that
 * produced no options at all".
 */
function sacrificePayments(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  ability: ActivatedAbility,
  cap: number,
): Enumerated<readonly ObjectId[]> {
  const sacrifice = ability.cost.sacrificeOther;
  if (sacrifice === undefined) return { items: [[]], complete: true };
  const candidates = sacrificeCandidates(state, player, oid, sacrifice.subtype);
  return combinations(candidates, sacrifice.count, cap);
}

/**
 * Every set of cards that could pay this ability's `cost.discard`.
 *
 * `sacrificePayments` over the hand, and it is the *third* multiplied
 * dimension, so the cap argument matters here for the reason that one spells
 * out at length: `combinations` recurses to completion and builds an array per
 * C(n,k) set before the product cap in `oneAbilityOptions` throws most of them
 * away. A seven-card hand paying two is 21 sets, which is nothing; the bound is
 * carried anyway because the cost is a printed number and a hand is not.
 *
 * The hand is read whole rather than filtered. Every card in a hand is a legal
 * discard — CR 701.8a names no restriction, and the DSL's cost carries a count
 * and no filter — so there is no candidate predicate to agree with, which is
 * why `validateDiscards` checks the zone directly instead of calling back here.
 */
function discardPayments(
  state: GameState,
  player: PlayerId,
  ability: ActivatedAbility,
  cap: number,
): Enumerated<readonly ObjectId[]> {
  const discard = ability.cost.discard;
  if (discard === undefined) return { items: [[]], complete: true };
  return combinations(playerOf(state, player).hand, discard, cap);
}

/**
 * Why a permanent cannot make mana right now, or `null` when it can.
 *
 * Two sources of mana, one guard. A land's choice is printed as
 * `producesMana` and costs exactly the tap, so its only blocker is being
 * tapped already. Everything else prints an activated mana ability, whose
 * blockers are the ordinary ones every activation answers to — summoning
 * sickness on a `{T}` cost (CR 302.6, waived by haste per CR 702.10c), a mana
 * cost the player cannot pay, a source that left the battlefield. Those
 * questions already have exactly one answer in this file, so this asks
 * `activationBlocker` rather than restating it; a Llanowar Elf that arrived
 * this turn is refused by the same line that refuses a tap ability on it.
 */
function manaSourceBlocker(state: GameState, player: PlayerId, oid: ObjectId): string | null {
  const object = tryObject(state, oid);
  if (object === undefined || object.zone !== 'battlefield') return 'source is not on the battlefield';
  // Layer-aware, to agree with `controlledBy`, which is what enumerates these
  // actions. Reading the raw `controller` field here let the previous
  // controller of a control-changed permanent keep tapping it.
  if (controllerOf(state, oid) !== player) return 'you do not control that source';
  const ability = manaAbilityOf(object.card);
  if (ability !== null) return activationBlocker(state, player, oid, ability);
  if (landProduces(object.card).length === 0) return 'that source has no mana ability';
  if (object.tapped) return 'source is already tapped';
  return null;
}

function manaAbilityOptions(state: GameState, player: PlayerId): readonly Action[] {
  const options: Action[] = [];
  for (const oid of controlledBy(state, player)) {
    if (manaSourceBlocker(state, player, oid) !== null) continue;
    for (const color of manaSourceColors(getObject(state, oid).card)) {
      options.push({ type: 'activateManaAbility', player, oid, color });
    }
  }
  return options;
}

function landOptions(state: GameState, player: PlayerId): readonly Action[] {
  if (state.turn.active !== player) return [];
  if (!isMainPhase(state.turn.step)) return [];
  if (state.stack.length > 0) return [];
  if (state.turn.landsPlayed >= 1) return [];
  return playerOf(state, player)
    .hand.filter((oid) => getObject(state, oid).card.kind === 'land')
    .map((oid): Action => ({ type: 'playLand', player, oid }));
}

function priorityDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const casts = castOptions(state, player, cap);
  const activations = activationOptions(state, player, cap);
  const options: Action[] = [
    { type: 'passPriority', player },
    ...landOptions(state, player),
    ...casts.items,
    ...activations.items,
    ...manaAbilityOptions(state, player),
  ];
  // `concede` is deliberately absent: it is always legal (see `validateAction`)
  // but it must never be picked by an agent sampling uniformly from options.
  return { kind: 'priority', player, options, complete: casts.complete && activations.complete };
}

/**
 * CR 508.1's declaration, and the cap decides how much of it one question asks
 * for.
 *
 * `mtg-tb7v` stage 2, and stage 1's shape read onto a product instead of a
 * permutation. The space is `(defenders + 1)^attackers`: ten creatures against
 * one opponent is 1,024 subsets against a cap of 512, and four creatures against
 * an opponent and three planeswalkers is 625. Everything past the cap had no
 * index, so a legal swing could not be declared through `submit` — and the
 * single-defender branch papered over exactly one of the missing ones by
 * appending "attack with everything", which is the shape of the defect rather
 * than a fix for it.
 *
 * **Hybrid, and the unit is the question rather than the position.** While the
 * whole remaining space fits under the cap it is listed and one answer finishes
 * the declaration, index for index what it was before — which is what keeps
 * every recording of a board that fits today replaying unchanged. When it does
 * not fit, the question shrinks to a single creature: attack with it, at each
 * legal defender, or hold it back, and the next question is asked against what
 * that settled.
 *
 * Creatures are asked about in `eligibleAttackers` order, one at a time, so
 * exactly one path of answers reaches each declaration. "Name the next attacker"
 * would reach the same swing by every ordering of the same answers, and then a
 * recorded integer would name a route rather than a move.
 *
 * `complete` is unconditionally true: a step list is one option per defender
 * plus one, so no cap can bite on it, and the declarations it does not list are
 * reached through the ones it does rather than left off the end.
 */
function attackerDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const eligible = eligibleAttackers(state);
  const defender = opponentOf(player);
  const defenders = combatDefenders(state, player);
  const playerDefender: CombatDefender = defender;
  const settled = state.combat.attacksSettled ?? 0;
  // The attacks already answered for, and only while the sequence is running.
  // A position that is not mid-declaration enumerates exactly what it always
  // did, whatever else is in `combat.attacks` — the marker is what says a
  // prefix has been answered, and reading the pairs instead would repeat an
  // attack the question was never asked about.
  const fixed: readonly AttackDeclaration[] =
    state.combat.attacksSettled === undefined
      ? []
      : state.combat.attacks.map((attack): AttackDeclaration => ({
          oid: attack.oid,
          defender: attack.defender,
        }));
  const rest = eligible.slice(settled);
  // CR 508.1d: a creature under `attacksEachCombatIfAble` must attack, and
  // `eligible` already means "able" — everything on it is untapped, unsick or
  // hasty, `defender`-free and not `cantAttack`, so "if able" is automatic for
  // anything reaching this filter. The requirement therefore reduces to
  // removing the "leave it home" outcome for these creatures, never to adding
  // one: there is no cross-creature contention over *which* defender to
  // attack (unlike menace's contention over *which blocker*), so no
  // completability check is needed the way `blocksCompletable` is for menace.
  //
  // A turn-scoped `attacksYouThisTurnIfAble` rides the same filter and adds the
  // one thing the static does not: it narrows *which* defender, so it is read
  // per creature through `attackRequirement` rather than as a flat list.
  const required = new Map(rest.map((oid) => [oid, attackRequirement(state, oid, defenders)] as const));
  const mustAttack = rest.filter((oid) => required.get(oid)?.mustAttack === true);
  const options: Action[] = [];
  let listable = true;
  if (defenders.length === 1) {
    const enumerated = subsets(rest, cap);
    listable = enumerated.complete;
    if (listable) {
      for (const chosen of enumerated.items) {
        if (mustAttack.some((oid) => !chosen.includes(oid))) continue;
        options.push({
          type: 'declareAttackers',
          player,
          attackers: [
            ...fixed,
            ...chosen.map((oid): AttackDeclaration => ({ oid, defender: playerDefender })),
          ],
        });
      }
    }
  } else {
    const enumerated = cartesian<CombatDefender | null>(
      rest.map((oid) => [null, ...(required.get(oid)?.allowed ?? defenders)]),
      cap,
    );
    listable = enumerated.complete;
    if (listable) {
      for (const assignment of enumerated.items) {
        const attackers: AttackDeclaration[] = [...fixed];
        let satisfiesMustAttack = true;
        for (const [index, assigned] of assignment.entries()) {
          const oid = rest[index];
          if (oid === undefined) continue;
          if (assigned !== null) attackers.push({ oid, defender: assigned });
          else if (mustAttack.includes(oid)) satisfiesMustAttack = false;
        }
        if (!satisfiesMustAttack) continue;
        options.push({ type: 'declareAttackers', player, attackers });
      }
    }
  }
  return {
    kind: 'declareAttackers',
    player,
    defender,
    defenders,
    eligible,
    options: listable ? options : nextAttackerOptions(state, eligible, fixed, defenders, settled, player),
    complete: true,
  };
}

/**
 * The question about one creature: attack with it at each legal defender, or
 * hold it back.
 *
 * The held-back answer settles the creature without adding a pair, which is the
 * whole reason `attacksSettled` is a count on the state rather than something a
 * reader could recover from `attacks`.
 *
 * The held-back answer is omitted outright for a creature carrying
 * `attacksEachCombatIfAble` (CR 508.1d) — `attackerDecision`'s docblock
 * explains why "if able" needs no completability check here: `eligible`
 * already filters to creatures that are able, so every remaining option
 * (attack at each legal defender) satisfies the requirement and only the
 * hold-back option violates it.
 */
function nextAttackerOptions(
  state: GameState,
  eligible: readonly ObjectId[],
  fixed: readonly AttackDeclaration[],
  defenders: readonly CombatDefender[],
  settled: number,
  player: PlayerId,
): readonly Action[] {
  const asking = eligible[settled];
  // Unreachable: the caller is here because the remaining space did not fit
  // under the cap, and an empty remainder enumerates to one.
  if (asking === undefined) throw new Error('attackerDecision: no creature is left to ask about');
  const options: Action[] = [];
  const requirement = attackRequirement(state, asking, defenders);
  if (!requirement.mustAttack) {
    options.push({ type: 'declareAttackers', player, attackers: fixed, settled: settled + 1 });
  }
  for (const target of requirement.allowed) {
    options.push({
      type: 'declareAttackers',
      player,
      attackers: [...fixed, { oid: asking, defender: target }],
      settled: settled + 1,
    });
  }
  return options;
}

function blockerDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const eligible = eligibleBlockers(state);
  const attackers = state.combat.attacks.map((attack) => attack.oid);
  // Built once and used twice: `candidates` is what a surface offers a creature,
  // and the same lists with a `null` in front are the slots the declaration
  // space is the product of. One walk of `canBlock`, so the roster and the
  // enumeration cannot disagree about who may block what.
  const perBlocker = eligible.map((blocker) =>
    attackers.filter((attacker) => canBlock(state, blocker, attacker)),
  );
  const candidates: BlockCandidates[] = [];
  for (const [index, blocker] of eligible.entries()) {
    const blockable = perBlocker[index] ?? [];
    if (blockable.length > 0) candidates.push({ blocker, attackers: blockable });
  }
  const settled = state.combat.blocksSettled ?? 0;
  const fixed = declaredBlocks(state);
  // CR 509.1c: the number of must-be-blocked attackers a finished declaration
  // has to cover is capped by how many can *jointly* be covered at once — two
  // must-attackers competing for the one creature able to block both cannot
  // both be served, and a menace lure costs two creatures rather than one — so
  // `target` is `mustBlockTarget` over the whole eligible pool, computed once
  // here rather than re-derived per candidate.
  const mustBeBlocked = attackers.filter((attacker) =>
    hasCombatModification(state, attacker, 'mustBeBlockedIfAble'),
  );
  const target = mustBlockTarget(state, outstandingDemands(state, [], mustBeBlocked), eligible);
  const enumerated = cartesian<ObjectId | null>(
    perBlocker.slice(settled).map((blockable) => [null, ...blockable]),
    cap,
  );
  const options: Action[] = [];
  if (enumerated.complete) {
    for (const assignment of enumerated.items) {
      const blocks: BlockDeclaration[] = [...fixed];
      for (const [index, attacker] of assignment.entries()) {
        const blocker = eligible[settled + index];
        if (attacker === null || blocker === undefined) continue;
        blocks.push({ blocker, attacker });
      }
      if (validateBlocks(state, player, blocks) !== null) continue;
      if (mustBlockCoverage(state, blocks, mustBeBlocked) < target) continue;
      options.push({ type: 'declareBlockers', player, blocks });
    }
    if (options.length === 0) options.push({ type: 'declareBlockers', player, blocks: fixed });
  } else {
    options.push(
      ...nextBlockerOptions(state, eligible, perBlocker, fixed, settled, player, mustBeBlocked, target),
    );
  }
  return {
    kind: 'declareBlockers',
    player,
    attackers,
    eligible,
    candidates,
    options,
    complete: true,
  };
}

/**
 * The pairs the declaration in progress has already settled, flattened.
 *
 * Empty unless the sequence is actually running. `blocksSettled` is what says a
 * prefix has been answered; the pairs alone cannot say it, and a position that
 * is not mid-declaration must enumerate and validate exactly what it always did.
 */
function declaredBlocks(state: GameState): readonly BlockDeclaration[] {
  if (state.combat.blocksSettled === undefined) return [];
  const pairs: BlockDeclaration[] = [];
  for (const block of state.combat.blocks) {
    for (const blocker of block.blockers) pairs.push({ blocker, attacker: block.attacker });
  }
  return pairs;
}

/**
 * The question about one creature: block each attacker it may legally block, or
 * stay home.
 *
 * A prefix is offered only when some complete legal declaration extends it
 * (`blocksCompletable`). That is the difference between this site and the attack
 * one: menace makes a partial block a dead end, and an option that cannot be
 * completed is a trap the whole contract forbids — `checkBackend` plays a game
 * by taking `options[0]` and files a finding when an offered move is refused.
 * Refusing at the offer needs no new player-facing state and no new refusal
 * path, and the last question's filter is exactly the menace rule itself, so the
 * finished declarations this sequence admits are the ones `validateBlocks`
 * admits.
 *
 * `mustBlockReachable` sits beside `blocksCompletable` as a second, independent
 * gate rather than merged into it: menace asks "does every owed attacker reach
 * its full count", CR 509.1c asks "does total coverage still reach a
 * precomputed joint maximum", and the two use different attacker sets and
 * different pass conditions. A prefix must clear both.
 */
function nextBlockerOptions(
  state: GameState,
  eligible: readonly ObjectId[],
  perBlocker: readonly (readonly ObjectId[])[],
  fixed: readonly BlockDeclaration[],
  settled: number,
  player: PlayerId,
  mustBeBlocked: readonly ObjectId[],
  target: number,
): readonly Action[] {
  const asking = eligible[settled];
  // Unreachable: the caller is here because the remaining product did not fit
  // under the cap, and an empty remainder enumerates to one.
  if (asking === undefined) throw new Error('blockerDecision: no creature is left to ask about');
  const later = eligible.slice(settled + 1);
  const options: Action[] = [];
  for (const blocks of [
    fixed,
    ...(perBlocker[settled] ?? []).map((attacker) => [...fixed, { blocker: asking, attacker }]),
  ]) {
    if (!blocksCompletable(state, blocks, later)) continue;
    if (!mustBlockReachable(state, blocks, mustBeBlocked, target, later)) continue;
    options.push({ type: 'declareBlockers', player, blocks, settled: settled + 1 });
  }
  return options;
}

/**
 * Whether some assignment of the creatures not yet asked turns this prefix into
 * a legal declaration.
 *
 * Menace (CR 702.110b) is the only rule in the vocabulary that a finished
 * declaration can fail while every pair in it is legal, so the obligation is
 * exactly "every menace attacker currently blocked by one creature needs one
 * more". Two such attackers cannot be served by the same creature, so it is a
 * bipartite matching rather than a count, and Kuhn's algorithm over at most
 * blockers x attackers edges settles it.
 *
 * Exact, never conservative. An approximation that refused too much would make a
 * legal declaration undeclarable, which is the defect being fixed wearing
 * another hat. If the vocabulary ever grows a declaration-level rule whose
 * completability cannot be decided exactly, the answer is that this kind stops
 * being asked in steps and goes back to a capped product with a named reason,
 * not a relaxed predicate here.
 */
function blocksCompletable(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  later: readonly ObjectId[],
): boolean {
  const counts = new Map<ObjectId, number>();
  for (const block of blocks) counts.set(block.attacker, (counts.get(block.attacker) ?? 0) + 1);
  const owed = [...counts.entries()]
    .filter(([attacker, count]) => count === 1 && hasKeyword(state, attacker, 'menace'))
    .map(([attacker]) => attacker);
  if (owed.length === 0) return true;
  const free = later.filter((blocker) => blocks.every((block) => block.blocker !== blocker));
  const takenBy = new Map<ObjectId, ObjectId>();
  const augment = (attacker: ObjectId, seen: Set<ObjectId>): boolean => {
    for (const blocker of free) {
      if (seen.has(blocker)) continue;
      if (!canBlock(state, blocker, attacker)) continue;
      seen.add(blocker);
      const holder = takenBy.get(blocker);
      if (holder === undefined || augment(holder, seen)) {
        takenBy.set(blocker, attacker);
        return true;
      }
    }
    return false;
  };
  return owed.every((attacker) => augment(attacker, new Set<ObjectId>()));
}

/**
 * How many creatures CR 702.110b makes an attacker cost to block: two when it
 * has menace, one otherwise.
 *
 * Menace is a restriction and "must be blocked if able" is a requirement, and
 * CR 509.1c reads the two together, so a lure that also has menace is blocked
 * by two creatures or by none — and when only one creature is able to block it
 * the requirement cannot be satisfied at all. No card in the set prints both
 * modifications, which is why the joint maximum below used to price every lure
 * at one blocker; three cards *grant* menace, so the combination arrives on the
 * battlefield rather than on a card, and the sealed harness got back a repaired
 * declaration that `validateBlocks` in `combat.ts` then threw out as an illegal
 * single block.
 */
function blockersRequired(state: GameState, attacker: ObjectId): number {
  return hasKeyword(state, attacker, 'menace') ? 2 : 1;
}

/** A must-be-blocked attacker and how many more blockers it is still owed. */
interface BlockDemand {
  readonly attacker: ObjectId;
  readonly needs: number;
}

/**
 * What a declaration still owes: every must-be-blocked attacker it has not yet
 * given its full complement, with the shortfall. A menace attacker already
 * blocked once needs one more, not two, which is what lets a prefix be judged
 * on the same footing as an empty declaration.
 */
function outstandingDemands(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  mustBeBlocked: readonly ObjectId[],
): readonly BlockDemand[] {
  const counts = new Map<ObjectId, number>();
  for (const block of blocks) counts.set(block.attacker, (counts.get(block.attacker) ?? 0) + 1);
  const demands: BlockDemand[] = [];
  for (const attacker of mustBeBlocked) {
    const needs = blockersRequired(state, attacker) - (counts.get(attacker) ?? 0);
    if (needs > 0) demands.push({ attacker, needs });
  }
  return demands;
}

/**
 * One blocker for every slot of every demand at once, as the assignment itself,
 * or null when no such assignment exists.
 *
 * Kuhn's algorithm over the *slots* rather than over the attackers: a menace
 * attacker's two slots compete for blockers with each other exactly as two
 * separate attackers would, which is the whole difference between this and a
 * pair matching. All or nothing by construction — a demand half-served is a
 * requirement not served, so a run that cannot fill every slot returns null
 * rather than a partial answer some caller might count.
 *
 * Two knobs a size-only caller never needs, both there for
 * `satisfyMustBeBlocked`, which wants the pairs: `seed` starts the search from
 * an assignment the caller already holds instead of from nothing, and
 * `blockers` is walked in the order given. Neither can turn a servable set
 * unservable — augmenting paths reach a maximum matching from any starting
 * matching, and a perfect matching of the slots is a maximum — so a caller that
 * expresses a preference gets a different assignment, never a worse one.
 */
function serveDemands(
  state: GameState,
  demands: readonly BlockDemand[],
  blockers: readonly ObjectId[],
  seed: ReadonlyMap<ObjectId, ObjectId> = new Map<ObjectId, ObjectId>(),
): ReadonlyMap<ObjectId, ObjectId> | null {
  const slots: ObjectId[] = [];
  for (const demand of demands) {
    for (let index = 0; index < demand.needs; index += 1) slots.push(demand.attacker);
  }
  const takenBy = new Map<ObjectId, number>();
  const filled = new Set<number>();
  for (const [blocker, attacker] of seed) {
    if (takenBy.has(blocker)) continue;
    if (!blockers.includes(blocker)) continue;
    if (!canBlock(state, blocker, attacker)) continue;
    const slot = slots.findIndex((owner, index) => owner === attacker && !filled.has(index));
    if (slot < 0) continue;
    takenBy.set(blocker, slot);
    filled.add(slot);
  }
  const augment = (slot: number, seen: Set<ObjectId>): boolean => {
    const attacker = slots[slot];
    if (attacker === undefined) return false;
    for (const blocker of blockers) {
      if (seen.has(blocker)) continue;
      if (!canBlock(state, blocker, attacker)) continue;
      seen.add(blocker);
      const holder = takenBy.get(blocker);
      if (holder === undefined || augment(holder, seen)) {
        takenBy.set(blocker, slot);
        return true;
      }
    }
    return false;
  };
  for (let slot = 0; slot < slots.length; slot += 1) {
    if (filled.has(slot)) continue;
    if (!augment(slot, new Set<ObjectId>())) return null;
    filled.add(slot);
  }
  const assignment = new Map<ObjectId, ObjectId>();
  for (const [blocker, slot] of takenBy) {
    const attacker = slots[slot];
    if (attacker !== undefined) assignment.set(blocker, attacker);
  }
  return assignment;
}

/** How many unit demands can be met at once: Kuhn's algorithm, one pair each. */
function maxUnitMatching(
  state: GameState,
  demands: readonly BlockDemand[],
  blockers: readonly ObjectId[],
): number {
  const takenBy = new Map<ObjectId, ObjectId>();
  const augment = (attacker: ObjectId, seen: Set<ObjectId>): boolean => {
    for (const blocker of blockers) {
      if (seen.has(blocker)) continue;
      if (!canBlock(state, blocker, attacker)) continue;
      seen.add(blocker);
      const holder = takenBy.get(blocker);
      if (holder === undefined || augment(holder, seen)) {
        takenBy.set(blocker, attacker);
        return true;
      }
    }
    return false;
  };
  let served = 0;
  for (const demand of demands) {
    if (augment(demand.attacker, new Set<ObjectId>())) served += 1;
  }
  return served;
}

/**
 * The first subset of `demands` of exactly `size` that `accept` takes, walked
 * in lexicographic order so a caller that has sorted its demands by preference
 * gets the most preferred subset that works. Null when none does.
 */
function firstAcceptedSubset(
  demands: readonly BlockDemand[],
  size: number,
  accept: (subset: readonly BlockDemand[]) => boolean,
): readonly BlockDemand[] | null {
  const chosen: BlockDemand[] = [];
  const walk = (index: number): readonly BlockDemand[] | null => {
    if (chosen.length === size) return accept(chosen) ? [...chosen] : null;
    if (demands.length - index < size - chosen.length) return null;
    const demand = demands[index];
    if (demand !== undefined) {
      chosen.push(demand);
      const taken = walk(index + 1);
      chosen.pop();
      if (taken !== null) return taken;
    }
    return walk(index + 1);
  };
  return walk(0);
}

/**
 * The CR 509.1c ceiling: the largest number of the given demands one
 * declaration can meet at once.
 *
 * Unit demands are a plain bipartite matching and that is still exactly what is
 * computed for them — two lures competing for the one creature able to block
 * either cannot both be served, so the ceiling is a matching size rather than a
 * count of individually-servable attackers. A menace lure breaks the matching
 * argument rather than bending it: it costs two blockers and is served all or
 * nothing, so serving it can cost two blockers that would have served two
 * ordinary lures, and no pair matching sees that. Nothing short of a search
 * over *which* demands are met decides it exactly.
 *
 * Exact, never conservative, for the same reason `blocksCompletable` is: a
 * ceiling set too high makes a legal declaration undeclarable, which is the
 * defect being fixed wearing another hat, and one set too low lets a defender
 * walk away from a requirement the rules do not let them decline.
 *
 * The search is bounded by the board rather than by a cap. Demands that cannot
 * be met on their own are dropped first — which is what removes a menace lure
 * with one capable blocker, the shape that produced the bug — and the subset
 * walk is entered only when a menace demand survives that filter.
 */
function mustBlockTarget(
  state: GameState,
  demands: readonly BlockDemand[],
  blockers: readonly ObjectId[],
): number {
  const servable = demands.filter((demand) => serveDemands(state, [demand], blockers) !== null);
  if (servable.length <= 1) return servable.length;
  if (!servable.some((demand) => demand.needs > 1)) {
    return maxUnitMatching(state, servable, blockers);
  }
  for (let size = servable.length; size > 1; size -= 1) {
    const found = firstAcceptedSubset(
      servable,
      size,
      (subset) => serveDemands(state, subset, blockers) !== null,
    );
    if (found !== null) return size;
  }
  return 1;
}

/**
 * How many must-be-blocked attackers a declaration already covers. A menace
 * attacker is covered by two blockers or by neither of them, so a single block
 * on one counts for nothing here — the same reading `validateBlocks` gives a
 * finished declaration.
 */
function mustBlockCoverage(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  mustBeBlocked: readonly ObjectId[],
): number {
  const counts = new Map<ObjectId, number>();
  for (const block of blocks) counts.set(block.attacker, (counts.get(block.attacker) ?? 0) + 1);
  return mustBeBlocked.filter((attacker) => (counts.get(attacker) ?? 0) >= blockersRequired(state, attacker))
    .length;
}

/**
 * Whether some assignment of the blockers not yet asked can still bring this
 * prefix's must-be-blocked coverage up to `target`.
 *
 * `target` is `mustBlockTarget` over the *full* eligible pool, computed once by
 * the caller before any question is asked. A prefix is reachable when its
 * current coverage plus the most of what it still owes that the blockers not
 * yet committed either way can meet reaches that ceiling — the same augmenting-
 * path shape as `blocksCompletable`, but against a coverage target instead of a
 * per-attacker count, because CR 509.1c lets a scarce capable blocker satisfy
 * at most one of several competing requirements.
 */
function mustBlockReachable(
  state: GameState,
  blocks: readonly BlockDeclaration[],
  mustBeBlocked: readonly ObjectId[],
  target: number,
  later: readonly ObjectId[],
): boolean {
  if (target === 0) return true;
  const covered = mustBlockCoverage(state, blocks, mustBeBlocked);
  if (covered >= target) return true;
  const free = later.filter((blocker) => blocks.every((block) => block.blocker !== blocker));
  const outstanding = outstandingDemands(state, blocks, mustBeBlocked);
  return covered + mustBlockTarget(state, outstanding, free) >= target;
}

/**
 * The same block declaration, with CR 509.1c satisfied.
 *
 * `validateBlockDeclaration` refuses a finished declaration that covers fewer
 * must-be-blocked attackers than could jointly be covered, and an agent that
 * *constructs* its declaration rather than picking one out of the enumeration
 * (`@mtg/sim`'s block policy, which prices every block against the race) has no
 * reason of its own to block a lure it would rather ignore. Rather than teach
 * every constructing agent the matching argument, the kernel hands back the
 * nearest declaration that passes: the agent decides which blocks it wants,
 * this decides which ones it owes.
 *
 * Owed beats wanted where the two collide, because the requirement is a rule
 * and a voluntary block is a preference — a blocker the requirement needs is
 * taken off whatever block it was making. It is taken last, though: blockers
 * already committed elsewhere are offered to the assignment only after the free
 * ones, the pairs already covering a must-attacker are seeded in first, and the
 * demands are walked most-covered first, so a declaration that satisfies the
 * rule already comes back untouched and one that nearly does gives up as little
 * as the rule allows.
 *
 * A menace lure is served with two blockers here or not at all, which is what
 * `blockersRequired` bought. Whatever is left over is still held to the same
 * rule: a *voluntary* two-blocker block that lost one of its blockers to the
 * requirement gives up the whole block rather than submit an illegal single.
 */
export function satisfyMustBeBlocked(
  state: GameState,
  blocks: readonly BlockDeclaration[],
): readonly BlockDeclaration[] {
  const mustBeBlocked = state.combat.attacks
    .map((attack) => attack.oid)
    .filter((attacker) => hasCombatModification(state, attacker, 'mustBeBlockedIfAble'));
  if (mustBeBlocked.length === 0) return blocks;
  const eligible = eligibleBlockers(state);
  const target = mustBlockTarget(state, outstandingDemands(state, [], mustBeBlocked), eligible);
  if (target === 0) return blocks;
  if (mustBlockCoverage(state, blocks, mustBeBlocked) >= target) return blocks;

  const counts = new Map<ObjectId, number>();
  for (const block of blocks) counts.set(block.attacker, (counts.get(block.attacker) ?? 0) + 1);
  const demands = outstandingDemands(state, [], mustBeBlocked)
    .filter((demand) => serveDemands(state, [demand], eligible) !== null)
    .sort((a, b) => (counts.get(b.attacker) ?? 0) - (counts.get(a.attacker) ?? 0));
  const seed = new Map<ObjectId, ObjectId>();
  for (const block of blocks) {
    if (mustBeBlocked.includes(block.attacker)) seed.set(block.blocker, block.attacker);
  }
  const committed = new Set(blocks.map((block) => block.blocker));
  const preferred = [
    ...eligible.filter((blocker) => !committed.has(blocker)),
    ...eligible.filter((blocker) => committed.has(blocker)),
  ];
  let owed: ReadonlyMap<ObjectId, ObjectId> | null = null;
  firstAcceptedSubset(demands, target, (subset) => {
    owed = serveDemands(state, subset, preferred, seed);
    return owed !== null;
  });
  // Unreachable: `target` is the size of a subset `mustBlockTarget` served over
  // this very pool, and `preferred` is that pool in another order.
  if (owed === null) throw new Error('satisfyMustBeBlocked: the joint maximum is not servable');

  const taken: ReadonlyMap<ObjectId, ObjectId> = owed;
  const repaired: BlockDeclaration[] = [];
  for (const [blocker, attacker] of taken) repaired.push({ blocker, attacker });
  for (const block of blocks) {
    if (!taken.has(block.blocker)) repaired.push(block);
  }
  const repairedCounts = new Map<ObjectId, number>();
  for (const block of repaired) {
    repairedCounts.set(block.attacker, (repairedCounts.get(block.attacker) ?? 0) + 1);
  }
  return repaired.filter(
    (block) => (repairedCounts.get(block.attacker) ?? 0) >= blockersRequired(state, block.attacker),
  );
}

/**
 * CR 509.2's damage assignment order, one entry per multiply-blocked attacker.
 *
 * The orderings that *differ*, not the permutations: two blockers the position
 * has nothing to say about separately are one slot, so a gang block by three
 * copies of one creature is one decision rather than six spellings of it
 * (`damage-order.ts` carries the argument, `mtg-2aca` the measurement). A player
 * who wants an ordering the list no longer separates still has it — the swapped
 * spelling stays legal, `validateOrdering` never looked at this list — and it
 * lands on the same board, which is what "the same decision" means.
 *
 * # The cap sets how much of the order one question settles, not which orders exist
 *
 * `mtg-tb7v` stage 1. An ordering is a permutation, and six blockers on one
 * attacker is 720 of them against a cap of 512, so 208 legal orders used to have
 * no index — unreachable through `submit` by any surface, and a `checkBackend`
 * finding against our own kernel (`@mtg/engine`'s `decision.ts`). A bigger cap
 * buys nothing: it is a memory bound over a factorial, so it buys board size
 * logarithmically and there is no number at which the truncation stops being
 * reachable.
 *
 * A permutation is a sequence of small decisions, so this asks it as one. **The
 * unit is the question rather than the position**: as long as every remaining
 * ordering fits under the cap they are all listed and one answer finishes the
 * order, exactly as before; when they do not, the question shrinks to a single
 * position of a single attacker's order and the next question is asked against
 * what that settled. One position at a time is the fallback the cap forces, not
 * the shape — a board of three blockers is still one question with six answers
 * on it, and every recorded index into that list still means what it meant.
 *
 * Two properties follow, and `order-sequence-reachability.test.ts` asserts both.
 * `complete` is now unconditionally true here, because the step list is one
 * option per slot the position can tell apart and is therefore linear in the
 * block rather than factorial in it — no cap can bite on it. And every legal
 * ordering is reachable: the whole-order branch lists all of them, and the step
 * branch offers every distinguishable next blocker, so an ordering is walked to
 * one position at a time and arrives.
 *
 * **A whole ordering stays a legal answer at a stepwise question**, which is what
 * every constructing caller depends on — both `@mtg/sim` bots build the order
 * out of `decision.blocks` and never read this list, and so does the play
 * surface's order panel. `validateOrdering` takes any answer that settles at
 * least one more position, from one position up to the whole thing, so a caller
 * that never looks at the enumeration cannot tell the two branches apart.
 */
function orderDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const blocks = attackersNeedingOrder(state);
  const settled = state.combat.ordered ?? {};
  const classes = blocks.map((block) => damageOrderClasses(state, block.blockers));
  const fixed = blocks.map((block) => block.blockers.slice(0, settled[block.attacker] ?? 0));
  const rest = blocks.map((block) => block.blockers.slice(settled[block.attacker] ?? 0));
  const perAttacker = rest.map((remaining, index) =>
    distinctPermutations(remaining, (blocker) => classes[index]?.get(blocker) ?? blocker, cap),
  );
  const product = cartesian(
    perAttacker.map((entry) => entry.items),
    cap,
  );
  const listable = product.complete && perAttacker.every((entry) => entry.complete);
  const options = listable
    ? product.items.map((orders): Action => ({
        type: 'orderBlockers',
        player,
        orders: orders.map((blockers, index) => ({
          attacker: blocks[index]?.attacker ?? '',
          blockers: [...(fixed[index] ?? []), ...blockers],
        })),
      }))
    : nextPositionOptions(blocks, fixed, rest, perAttacker, classes, player);
  return { kind: 'orderBlockers', player, blocks, options, complete: true };
}

/**
 * One option per creature that could be next in the order, for the first
 * attacker whose remaining order is still worth asking about.
 *
 * First rather than all at once, and one attacker rather than every attacker in
 * parallel, because that leaves exactly one path of answers to each ordering. A
 * question that offered a next blocker for every attacker at the same time would
 * reach the same orderings by every interleaving of the same answers, which
 * costs a recorded game its meaning: the integers would name a route rather than
 * a move.
 *
 * "Worth asking about" is more than one *distinguishable* ordering left, not
 * more than one blocker left. Twins that nothing in the position separates are
 * one slot here for the same reason they are one slot in the whole-order list,
 * so a remainder of three copies of one creature is not three forced questions.
 */
function nextPositionOptions(
  blocks: readonly Block[],
  fixed: readonly (readonly ObjectId[])[],
  rest: readonly (readonly ObjectId[])[],
  perAttacker: readonly Enumerated<readonly ObjectId[]>[],
  classes: readonly ReadonlyMap<ObjectId, string>[],
  player: PlayerId,
): readonly Action[] {
  const asking = perAttacker.findIndex((entry) => !entry.complete || entry.items.length > 1);
  const block = blocks[asking];
  const remaining = rest[asking];
  // Unreachable: the caller is here because the product of the per-attacker
  // orderings did not fit under the cap, and a product of ones is one.
  if (block === undefined || remaining === undefined) {
    throw new Error('orderDecision: no attacker has an ordering left to ask about');
  }
  const keyOf = (blocker: ObjectId): string => classes[asking]?.get(blocker) ?? blocker;
  const offered = new Set<string>();
  const options: Action[] = [];
  for (const blocker of remaining) {
    const key = keyOf(blocker);
    if (offered.has(key)) continue;
    offered.add(key);
    options.push({
      type: 'orderBlockers',
      player,
      orders: [{ attacker: block.attacker, blockers: [...(fixed[asking] ?? []), blocker] }],
    });
  }
  return options;
}

/**
 * Whether the options settle part of the decision rather than all of it.
 *
 * Read off the options instead of declared beside them, so it cannot drift from
 * what the list actually contains. `session.ts` is the caller: a constructed
 * move that finishes an order the kernel is asking one position at a time is
 * legal, complete, and on no list, and that is the one case where those three
 * facts together are not the kernel disagreeing with itself.
 *
 * The two combat declarations say it outright, because they can: `settled` is on
 * the action, so a step is a step by what it carries rather than by comparison
 * with the board. The damage assignment order has nowhere to put such a field —
 * an ordering is a list of positions and a prefix of it is the same shape — so
 * it is measured against the block instead.
 *
 * The two set selections are measured the same way, against `count`, and they
 * need no field for the same reason the order does not: every card a discard or
 * a bottoming names stays named, so a partial answer is shorter than a whole one
 * and says so. That is the difference from a declaration, where a creature held
 * back leaves nothing behind and the count cannot be read off the pairs.
 */
export function asksInSteps(decision: Decision): boolean {
  if (decision.kind === 'discard') {
    return decision.options.some(
      (option) => option.type === 'discard' && option.oids.length < decision.count,
    );
  }
  if (decision.kind === 'handDiscard') {
    return decision.options.some(
      (option) => option.type === 'chooseDiscards' && option.oids.length < decision.count,
    );
  }
  if (decision.kind === 'mulligan') {
    return decision.options.some(
      (option) => option.type === 'keepHand' && option.bottom.length < decision.count,
    );
  }
  if (decision.kind === 'declareAttackers' || decision.kind === 'declareBlockers') {
    return decision.options.some(
      (option) =>
        (option.type === 'declareAttackers' || option.type === 'declareBlockers') &&
        option.settled !== undefined,
    );
  }
  if (decision.kind !== 'orderBlockers') return false;
  return decision.options.some((option) => {
    if (option.type !== 'orderBlockers') return true;
    return decision.blocks.some((block) => {
      const entry = option.orders.find((order) => order.attacker === block.attacker);
      return entry === undefined || entry.blockers.length < block.blockers.length;
    });
  });
}

/**
 * One aiming of a trigger's remaining slots, or `null` when none exists.
 *
 * Depth-first with the first solution taken, because the question is whether a
 * prefix can be finished at all and not which finish is best. The only
 * cross-slot constraint is `distinct` (each slot's candidates were built without
 * looking at the others), so a slot is unfillable only when every candidate it
 * has is already spoken for, and the search backtracks over exactly that.
 *
 * The bound is the number of effects on one triggered ability, which is a small
 * number by construction, so this is cheap where it is called: once per candidate
 * offered at a sequenced question.
 */
function completesTrigger(
  effects: readonly Effect[],
  choices: readonly (readonly (Target | null)[])[],
  prefix: readonly (Target | null)[],
): readonly (Target | null)[] | null {
  if (prefix.length >= effects.length) {
    return honoursDistinctSlots(effects, prefix) ? prefix : null;
  }
  for (const candidate of choices[prefix.length] ?? []) {
    const grown = [...prefix, candidate];
    if (!honoursDistinctSlots(effects, grown)) continue;
    const finished = completesTrigger(effects, choices, grown);
    if (finished !== null) return finished;
  }
  return null;
}

/**
 * Every way to aim one triggered ability (CR 603.3d), asked whole or asked one
 * slot at a time.
 *
 * `castOptions`' body with the card's effect list swapped for the trigger's and
 * the cost check dropped, because a trigger is not paid for. The
 * `honoursDistinctSlots` filter stays for the reason it is there: each slot's
 * choices were built without looking at the others.
 *
 * There is no empty-slot early-out here, and there must not be. A trigger with
 * an unfillable slot has already been removed from the stack by
 * `removeTriggersWithoutTargets` (CR 603.3d again), so reaching this function
 * with one would mean the removal pass had missed it — and returning an empty
 * option list would then hand a player a question with no legal answer instead
 * of failing.
 *
 * **The product truncated, and it did so on an ordinary board.** Measured on this
 * checkout with the cap at 512: a two-slot trigger over a battlefield of 24
 * creatures is 576 aimings, of which 512 were listed and 64 had no id — legal
 * ways to aim a printed trigger that no surface could submit, and a
 * `checkEnumeration` finding against our own kernel. Twenty-three creatures is
 * not a contrived board for a set that prints seventy-nine token-making effects.
 * A bigger cap buys nothing: the product is exponential in the slot count, so it
 * buys board size logarithmically and there is no number at which the truncation
 * stops being reachable.
 *
 * So this asks the same question as a sequence, exactly as `orderDecision` does
 * for a damage assignment order. **The unit is the question rather than the
 * position**: while the remaining product fits, every aiming is listed and one
 * answer finishes the trigger, as before; when it does not, the question shrinks
 * to the next unfilled slot and the next question is asked against what that
 * settled. One slot at a time is the fallback the cap forces, not the shape.
 *
 * A prefix is offered only when some complete legal aiming extends it, which is
 * what `completesTrigger` is for. Offering a choice that cannot be finished
 * would be a question whose answer leads to a position with no legal answer, and
 * that is the trap the contract forbids rather than a smaller version of it.
 *
 * `complete` is therefore unconditionally true. The step branch lists one option
 * per candidate for a single slot, which is linear in the board rather than
 * exponential in the slot count, so no cap bites on it — the same property
 * `orderDecision` relies on.
 *
 * **A whole aiming stays a legal answer at a sequenced question**, so a caller
 * that never reads the enumeration cannot tell the two branches apart:
 * `validateTriggerTargets` takes any answer that settles at least one more slot,
 * from one slot up to all of them.
 */
function triggerTargetsDecision(state: GameState, pending: TriggerOnStack, cap: number): Decision {
  const player = pending.entry.controller;
  const effects = pending.ability.effects;
  const settled = pending.entry.targets;
  const choices = triggerTargetChoices(state, pending);
  const combos = cartesian(choices.slice(settled.length), cap);
  const options: Action[] = [];
  if (combos.complete) {
    for (const tail of combos.items) {
      const targets = [...settled, ...tail];
      if (!honoursDistinctSlots(effects, targets)) continue;
      options.push({ type: 'chooseTriggerTargets', player, oid: pending.entry.oid, targets });
    }
  } else {
    for (const candidate of choices[settled.length] ?? []) {
      const targets = [...settled, candidate];
      if (completesTrigger(effects, choices, targets) === null) continue;
      options.push({ type: 'chooseTriggerTargets', player, oid: pending.entry.oid, targets });
    }
  }
  return {
    kind: 'triggerTargets',
    player,
    oid: pending.entry.oid,
    source: pending.source,
    abilityIndex: pending.index,
    options,
    complete: true,
  };
}

/**
 * Take it or leave it (CR 603.3b).
 *
 * Two options, always both, always in this order: a "may" is never enumerated
 * as one, because an optional trigger whose only legal answer was "yes" would be
 * a mandatory trigger wearing the word. `complete` is unconditionally true —
 * there is no cap that can bite on a list of two — which is what stops the play
 * surface from printing a truncation warning over a yes/no question.
 */
function optionalTriggerDecision(pending: TriggerOnStack): Decision {
  const player = pending.entry.controller;
  const oid = pending.entry.oid;
  return {
    kind: 'optionalTrigger',
    player,
    oid,
    source: pending.source,
    abilityIndex: pending.index,
    targets: pending.entry.targets,
    options: [
      { type: 'answerOptionalTrigger', player, oid, accept: true },
      { type: 'answerOptionalTrigger', player, oid, accept: false },
    ],
    complete: true,
  };
}

/** `n!`, which is how many orders `MAX_SCRY_COUNT` cards can be put in. */
function factorial(n: number): number {
  let product = 1;
  for (let step = 2; step <= n; step += 1) product *= step;
  return product;
}

/**
 * Every ordered partition of the scried cards into a top and a bottom.
 *
 * The bound this enumeration answers to is the **schema's**, not the runtime
 * cap's: `MAX_SCRY_COUNT` exists so that a scry's decision space is finite by
 * construction, and its own docblock does the arithmetic — scry four is
 * `(4 + 1) * 4! = 120` ordered partitions. So the permutation walk is bounded
 * by what the schema admits rather than by `DEFAULT_ENUMERATION_CAP`, and the
 * throw below is an assertion that a scry arrived larger than the schema allows
 * rather than a report that the kernel ran out of room.
 *
 * Reading the runtime cap here is what `mtg-4nkq` found: it made a whole class
 * of scry crash instead of narrow the moment anyone lowered the cap under 120,
 * which is exactly when the cap-lowering sweep is being used as an instrument.
 * The two numbers are unrelated — one is a schema ceiling on how many cards a
 * card may scry, the other is a global option budget — and coupling them meant
 * the scry space could not be exercised at any cap below the shipped one.
 */
function scryDecision(state: GameState): Decision {
  const pending = state.pendingScry;
  if (pending === undefined) throw new Error('scryDecision: no scry is pending');
  const ordered = permutations(pending.cards, factorial(MAX_SCRY_COUNT));
  if (!ordered.complete) {
    throw new Error(
      `scryDecision: a scry of ${String(pending.cards.length)} exceeds the schema's ${String(MAX_SCRY_COUNT)}`,
    );
  }
  const options: Action[] = [];
  for (const permutation of ordered.items) {
    for (let topCount = permutation.length; topCount >= 0; topCount -= 1) {
      options.push({
        type: 'scry',
        player: pending.player,
        top: permutation.slice(0, topCount),
        bottom: permutation.slice(topCount),
      });
    }
  }
  return { kind: 'scry', player: pending.player, cards: pending.cards, options, complete: true };
}

function searchDecision(state: GameState): Decision {
  const pending = state.pendingSearch;
  if (pending === undefined) throw new Error('searchDecision: no search is pending');
  const options: Action[] = pending.cards.map((oid) => ({
    type: 'searchLibrary' as const,
    player: pending.player,
    found: oid,
  }));
  options.push({ type: 'searchLibrary', player: pending.player, found: null });
  return { kind: 'searchLibrary', player: pending.player, cards: pending.cards, options, complete: true };
}

/**
 * `searchDecision` over the banked graveyard list.
 *
 * The candidates are read off `pending.cards` rather than re-derived from the
 * graveyards, for `answerHandDiscard`'s stated reason: the chooser is answering
 * the question they were asked, and a card that left a graveyard between the
 * pause and the answer is still a card they were offered. Re-deriving would
 * also make this function and `validateAction` two independent readings of one
 * rule.
 */
function graveyardChoiceDecision(state: GameState): Decision {
  const pending = state.pendingGraveyardChoice;
  if (pending === undefined) throw new Error('graveyardChoiceDecision: no graveyard choice is pending');
  const options: Action[] = pending.cards.map((oid) => ({
    type: 'chooseFromGraveyard' as const,
    player: pending.player,
    chosen: oid,
  }));
  options.push({ type: 'chooseFromGraveyard', player: pending.player, chosen: null });
  return { kind: 'graveyardChoice', player: pending.player, cards: pending.cards, options, complete: true };
}

/**
 * CR 701.17a's question over the banked candidate list.
 *
 * `legendRuleDecision`'s shape: one option per candidate, no "take none" arm,
 * because both rules are mandatory whenever a candidate exists — the empty
 * case never reaches a decision at all, resolved without a pause by
 * `applyResolutionEffects`. The candidates are read off `pending.permanents`
 * rather than re-derived from the battlefield, `graveyardChoiceDecision`'s
 * stated reason: the chooser answers the question they were asked, and a
 * creature that left the battlefield between the pause and the answer is
 * still one they were offered.
 */
function permanentSacrificeDecision(state: GameState): Decision {
  const pending = state.pendingPermanentSacrifice;
  if (pending === undefined) throw new Error('permanentSacrificeDecision: no sacrifice is pending');
  const player = pending.player;
  return {
    kind: 'permanentSacrifice',
    player,
    permanents: pending.permanents,
    options: pending.permanents.map((oid): Action => ({ type: 'sacrificePermanent', player, oid })),
    complete: true,
  };
}

/**
 * Take it or leave it (CR 601.2c), `optionalTriggerDecision`'s shape for a
 * spell: the two options are always both, in this order, for the same reason
 * — a "you may" spell whose only legal answer was "yes" would be an ordinary
 * spell wearing the word.
 */
/**
 * Pay it or take it (CR 118.8), `mayDecision`'s shape for a toll. Two options,
 * always both: `spellAwaitingUnless` has already established that the payer can
 * afford the price, and a question whose only answer is "no" is not one this
 * kernel asks.
 */
function unlessDecision(pending: TolledSpellOnStack): Decision {
  const player = pending.payer;
  const oid = pending.entry.oid;
  return {
    kind: 'unless',
    player,
    oid,
    cost: pending.clause.cost,
    targets: pending.entry.targets,
    options: [
      { type: 'answerUnless', player, oid, pay: true },
      { type: 'answerUnless', player, oid, pay: false },
    ],
    complete: true,
  };
}

function mayDecision(pending: SpellOnStack): Decision {
  const player = pending.chooser;
  const oid = pending.entry.oid;
  return {
    kind: 'may',
    player,
    oid,
    targets: pending.entry.targets,
    options: [
      { type: 'answerMay', player, oid, accept: true },
      { type: 'answerMay', player, oid, accept: false },
    ],
    complete: true,
  };
}

/**
 * The cards a selection may still name: the ones after the last one it named.
 *
 * The restriction is what collapses the k! orderings of one set to one path of
 * answers. Choosing three of twelve one card at a time offers six routes to the
 * same three cards if any card may come next, and then two identical games
 * record different integers; taking them in hand order leaves exactly one.
 */
function selectionPool(hand: readonly ObjectId[], chosen: readonly ObjectId[]): readonly ObjectId[] {
  const last = chosen[chosen.length - 1];
  if (last === undefined) return hand;
  const at = hand.indexOf(last);
  // Unreachable: a selection in progress names cards out of the hand it is
  // chosen from, and nothing moves them until the selection finishes.
  if (at < 0) throw new Error(`selectionPool: ${last} was chosen but is not in the hand`);
  return hand.slice(at + 1);
}

/**
 * Every answer to "choose `count` of these", either as whole selections or one
 * card at a time.
 *
 * `mtg-cs8t` steps 1 and 2. A discard and the London mulligan's bottoming are
 * one `combinations` call each, which is binomial in the hand: twelve cards
 * discarding five is C(12,5) = 792 against a cap of 512, so 280 legal discards
 * used to have no index and no surface could submit them. A bigger cap buys
 * nothing — it is a memory bound over a binomial — so the question shrinks
 * instead of the answer being truncated.
 *
 * **The unit is the question rather than the position**, the hybrid `mtg-tb7v`
 * installed at the three combat sites: while the whole remaining space fits
 * under the cap every selection is listed, in the order `combinations` has
 * always produced, so every committed recording still means what it meant. Only
 * past the cap does the list become "which card goes next", asked against the
 * cards after the last one chosen and against nothing else.
 *
 * A step is offered only when the selection can still be finished from it: a
 * card so late in the hand that too few follow it cannot start a legal
 * selection, and an option that cannot be completed is a trap the session
 * contract forbids (`@mtg/engine`'s `checkBackend` plays a game by taking
 * `options[0]`). The pool is in hand order, so once too few cards follow one,
 * too few follow every card after it.
 */
function selectionAnswers(
  hand: readonly ObjectId[],
  count: number,
  chosen: readonly ObjectId[],
  cap: number,
): readonly (readonly ObjectId[])[] {
  const pool = selectionPool(hand, chosen);
  const owed = count - chosen.length;
  const enumerated = combinations(pool, owed, cap);
  if (enumerated.complete) return enumerated.items.map((rest) => [...chosen, ...rest]);
  const steps: (readonly ObjectId[])[] = [];
  for (const [index, oid] of pool.entries()) {
    if (pool.length - index < owed) break;
    steps.push([...chosen, oid]);
  }
  return steps;
}

/**
 * CR 103.4: every way to answer the opening hand.
 *
 * `discardDecision`'s shape with one option added. The keeps are every choice of
 * which cards go to the bottom — the same `selectionAnswers` a discard asks,
 * because "give up N of these" is the same question — and the mulligan is one
 * more option after them, offered only while another one could still change what
 * this seat keeps (`canMulligan`). Keeps come first so that the answer a player
 * gives most often is the one at the top of the list; the mulligan is last for
 * the same reason, and it stays last at every step of a bottoming asked one card
 * at a time, because abandoning a hand is an answer to the same question and not
 * a different one.
 *
 * A seat that has mulliganed as far as the rules allow is left with keeps alone,
 * which is a decision with one option when nothing has been drawn to choose
 * between. That is still a question and not a skip: it is the moment the hand is
 * accepted, and the log records it as one.
 *
 * `complete` is unconditionally true. A step list is one option per card that
 * can still start a legal bottoming, which is linear in the hand rather than
 * binomial in it, so no cap can bite on it.
 */
function mulliganDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const seat = playerOf(state, player);
  const count = cardsToBottom(state, player);
  const options: Action[] = selectionAnswers(seat.hand, count, state.pendingSelection ?? [], cap).map(
    (bottom): Action => ({ type: 'keepHand', player, bottom }),
  );
  if (canMulligan(state, player)) options.push({ type: 'mulligan', player });
  return {
    kind: 'mulligan',
    player,
    mulligans: seat.mulligans,
    count,
    hand: seat.hand,
    options,
    complete: true,
  };
}

/**
 * CR 704.5j: keep one of these, and the rest go to their owners' graveyards.
 *
 * The options are the candidates in entry order, which is the order the board is
 * drawn in and the order every other enumeration in this file uses. It is a
 * presentation order and nothing more now that the pick is a real answer — the
 * rule used to *be* that order, and a bot or a player that takes option 0 is
 * choosing what the kernel used to choose for them rather than being handed it.
 */
function legendRuleDecision(collision: LegendCollision): Decision {
  const player = collision.controller;
  return {
    kind: 'legendRule',
    player,
    name: collision.name,
    candidates: collision.candidates,
    options: collision.candidates.map((oid): Action => ({ type: 'keepLegend', player, oid })),
    complete: true,
  };
}

/**
 * CR 514.1: which cards go, when a hand is over the maximum size.
 *
 * `selectionAnswers` carries the shape and the argument; the two selection sites
 * differ only in which action a chosen set is spelled as. `complete` is
 * unconditionally true here for the same reason it is at the mulligan.
 */
function discardDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const hand = playerOf(state, player).hand;
  const count = hand.length - state.config.maximumHandSize;
  const options = selectionAnswers(hand, count, state.pendingSelection ?? [], cap).map((oids): Action => ({
    type: 'discard',
    player,
    oids,
  }));
  return { kind: 'discard', player, count, hand, options, complete: true };
}

/**
 * CR 701.8: which cards a resolution takes out of a hand.
 *
 * The third caller of `selectionAnswers`, and the first where the hand being
 * selected from is not necessarily the selecting seat's. That changes nothing
 * about the enumeration — "choose `count` of these" has one shape — and it is
 * the reason the selection helper takes a hand rather than reading one off a
 * player.
 *
 * The hand comes off the pending record rather than off the player, because
 * the chooser under a `chooseDiscard` is answering about the cards CR 701.16a
 * showed them and a hand that has changed since would offer a card nobody saw.
 * `complete` is unconditionally true for the reason it is at the other two
 * sites: past the cap the list becomes one option per card, which is linear.
 *
 * It comes off `choosable` rather than `cards`, which is the record's two lists
 * read the way its docblock says to read them: this is the decision surface, so
 * it carries the cards that may be named, and Duress's revealed creature is not
 * one of them. What the chooser was *shown* is the other list, un-concealed by
 * `visibility.ts` and reported in the `handRevealed` event — a surface that
 * wants to draw the whole hand with the refused cards grayed out reads it
 * there, and gets a `hand` here that no caller can build an illegal answer out
 * of.
 */
function handDiscardDecision(state: GameState, cap: number): Decision {
  const pending = state.pendingHandDiscard;
  if (pending === undefined) throw new Error('handDiscardDecision: no discard is pending');
  const options = selectionAnswers(pending.choosable, pending.count, state.pendingSelection ?? [], cap).map(
    (oids): Action => ({ type: 'chooseDiscards', player: pending.player, oids }),
  );
  return {
    kind: 'handDiscard',
    player: pending.player,
    owner: pending.owner,
    count: pending.count,
    hand: pending.choosable,
    revealed: pending.revealed,
    options,
    complete: true,
  };
}

/**
 * The decision the kernel is currently blocked on, or `null` when the game is
 * over.
 *
 * The `awaiting` switch is exhaustive over `AwaitKind` rather than falling
 * through to the priority branch, and that is the guard the two trigger stops
 * needed: a kind the switch does not answer would silently produce the priority
 * decision from a state where nobody holds priority, which is a wrong question
 * rather than a crash. `assertNever` turns the omission into a compile error.
 */
export function pendingDecision(state: GameState, cap: number = DEFAULT_ENUMERATION_CAP): Decision | null {
  if (state.result !== null) return null;
  const { awaiting, awaitingPlayer, priority } = state.turn;
  if (awaiting !== null && awaitingPlayer !== null) {
    switch (awaiting) {
      case 'mulligan':
        return mulliganDecision(state, awaitingPlayer, cap);
      case 'attackers':
        return attackerDecision(state, awaitingPlayer, cap);
      case 'blockers':
        return blockerDecision(state, awaitingPlayer, cap);
      case 'blockerOrder':
        return orderDecision(state, awaitingPlayer, cap);
      case 'discard':
        return discardDecision(state, awaitingPlayer, cap);
      case 'handDiscard':
        return handDiscardDecision(state, cap);
      case 'triggerTargets': {
        const pending = triggerAwaitingTargets(state);
        // Unreachable through `reduce`, which sets this only when the entry is
        // there and clears it the moment the entry answers. It throws rather
        // than falling through to priority, because the fall-through would ask
        // the wrong player a question the position does not pose.
        if (pending === null) throw new Error('pendingDecision: no trigger on the stack owes targets');
        return triggerTargetsDecision(state, pending, cap);
      }
      case 'optionalTrigger': {
        const pending = optionalTriggerOnTop(state);
        if (pending === null) throw new Error('pendingDecision: no optional trigger is resolving');
        return optionalTriggerDecision(pending);
      }
      case 'may': {
        const pending = spellAwaitingMay(state);
        // Unreachable through `reduce`, which raises this only from
        // `stack.ts`'s `awaitMay` and clears it the moment the spell answers.
        if (pending === null) throw new Error('pendingDecision: no spell is awaiting a "you may" answer');
        return mayDecision(pending);
      }
      case 'unless': {
        const pending = spellAwaitingUnless(state);
        // Unreachable through `reduce`, which raises this only from
        // `stack.ts`'s `awaitUnless` and clears it the moment the toll answers.
        if (pending === null) throw new Error('pendingDecision: no spell is awaiting an "unless" answer');
        return unlessDecision(pending);
      }
      case 'legendRule': {
        const collision = pendingLegendCollision(state);
        // Unreachable through `reduce`, which raises this only from a board in
        // violation and clears it with the answer that ends the violation.
        if (collision === null) throw new Error('pendingDecision: no legend rule collision is pending');
        return legendRuleDecision(collision);
      }
      case 'scry':
        return scryDecision(state);
      case 'searchLibrary':
        return searchDecision(state);
      case 'graveyardChoice':
        return graveyardChoiceDecision(state);
      case 'permanentSacrifice':
        return permanentSacrificeDecision(state);
      default:
        return assertNever(awaiting, 'pendingDecision');
    }
  }
  if (priority !== null) return priorityDecision(state, priority, cap);
  return null;
}

/** Flat list of legal actions; empty when the kernel is not waiting on anyone. */
export function legalActions(state: GameState, cap: number = DEFAULT_ENUMERATION_CAP): readonly Action[] {
  return pendingDecision(state, cap)?.options ?? [];
}

function validateCast(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  targets: readonly (Target | null)[],
  x?: number,
  mode?: number,
  multiTargets?: Readonly<Record<number, readonly ObjectId[]>>,
): string | null {
  const object = tryObject(state, oid);
  if (object === undefined || object.zone !== 'hand' || object.owner !== player) {
    return 'card is not in your hand';
  }
  const card = object.card;
  if (!isCastable(card)) return 'lands are played, not cast';
  if (!canCastNow(state, player, card)) return 'wrong timing for this card type';
  if (card.manaCost.hasX && x === undefined) return 'this cost needs an announced X';
  if (!card.manaCost.hasX && x !== undefined) return 'this cost has no X to announce';
  // CR 107.3f announces X as a whole number, and `MAX_CHOSEN_X` is this
  // kernel's hostile-input ceiling on it. All four conditions are checked
  // here rather than downstream because `resolveX` is deliberately total —
  // it clamps a negative value into 0 and folds a fractional one straight
  // into `generic` — so an unchecked announcement does not fail, it silently
  // becomes a different spell. `xOptionsFor` offers the same range.
  if (x !== undefined && (!Number.isInteger(x) || x < 0 || x > MAX_CHOSEN_X)) {
    return `X must be an integer between 0 and ${MAX_CHOSEN_X}`;
  }
  if (card.modes === undefined) {
    if (mode !== undefined) return 'this spell has no modes to choose';
  } else {
    if (mode === undefined) return 'this spell is modal and needs a chosen mode';
    if (mode < 0 || mode >= card.modes.length) return 'mode is out of range';
  }
  if (!canPay(state, player, effectiveManaCost(state, player, card, x))) return 'cannot pay the mana cost';
  if (isAuraCard(card)) {
    if (targets.length !== 1) return 'an Aura chooses exactly one target';
    const target = targets[0];
    if (target === undefined || target === null || target.kind !== 'permanent') {
      return 'an Aura targets a permanent allowed by its enchant restriction';
    }
    return isLegalAuraHost(state, card, target.oid) && canBeTargetedBy(state, target.oid, oid, player)
      ? null
      : 'an Aura targets a permanent allowed by its enchant restriction';
  }
  const effects = effectsFor(card, mode ?? null);
  if (targets.length !== effects.length) return 'one target slot per effect is required';
  for (const [index, effect] of effects.entries()) {
    // A `TargetSpec.count` slot ("up to two target creatures", `mtg-kg44`)
    // is chosen through `multiTargets`, not `targets` — `matchesTargetKind`
    // treats a `null` `targetCreature` target as absent rather than as "zero
    // of up to two", so routing it through the ordinary single-target check
    // below would reject the empty and one-target choices the wording is
    // written to allow. CR 601.2c governs submission here: every named
    // member must be legal right now and no two may name the same object,
    // the all-or-nothing sibling of CR 608.2b's resolution-time partial
    // survival (`stack.ts`'s `planResolution`).
    if (hasTarget(effect)) {
      const count = targetCountOf(effect.target);
      if (count !== null) {
        if (targets[index] !== null && targets[index] !== undefined) {
          return `effect ${index} is a counted slot; choose it through multiTargets, not targets`;
        }
        const members = multiTargets?.[index] ?? [];
        if (members.length > count) return `effect ${index} allows at most ${count} targets`;
        if (new Set(members).size !== members.length) {
          return `effect ${index}'s targets must be different objects`;
        }
        if (survivingMultipleTargets(state, effect, members, player, oid).length !== members.length) {
          return `illegal target for effect ${index}`;
        }
        continue;
      }
    }
    if (!isTargetStillLegal(state, effect, targets, index, player, oid)) {
      return `illegal target for effect ${index}`;
    }
  }
  return null;
}

/**
 * Full legality of a submitted activation, re-derived from the state.
 *
 * The target checks are `validateCast`'s, aimed at the ability's effect list
 * instead of the card's: one slot per effect, each still legal now.
 * `isTargetStillLegal` never learns which ability it belongs to, because the
 * recorded target is all it needs.
 *
 * There is no second `honoursDistinctSlots` pass here, and there was one until
 * a fixture reached it. `isTargetStillLegal` takes the whole tuple precisely so
 * that a `distinct` slot is judged against the slots before it (`effects.ts`
 * says so in its own docblock), so a repeated target fails at its own index
 * before any tuple-level check could see it. `validateCast` has never had one
 * either. The enumeration is the caller that still needs
 * `honoursDistinctSlots`, because `targetChoicesForEffects` fills each slot
 * without looking at the others and `cartesian` then pairs every choice with
 * every other.
 *
 * The `x` checks are `validateCast`'s four, word for word and for the same
 * reason: `resolveX` is total, so an unchecked announcement does not fail, it
 * silently charges a different cost. What differs is only the payment line —
 * the cost is resolved with `resolveX` alone rather than `effectiveManaCost`,
 * because a CR 601.2f reduction reduces spells and an activated ability is not
 * one, and the tap-self exclusion rides along the way `activationBlocker`
 * passes it.
 */
function validateActivation(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  abilityIndex: number,
  targets: readonly (Target | null)[],
  sacrifices: readonly ObjectId[],
  discards: readonly ObjectId[],
  x?: number,
): string | null {
  const ability = activatedAbilityAt(state, oid, abilityIndex);
  if (ability === undefined) return 'that permanent has no activated ability there';
  // The mirror of the skip in `activationOptions`. CR 605.3a puts a mana
  // ability outside the stack entirely, so `activateAbility` is the wrong
  // action type for it however the agent constructed the submission — and an
  // agent that builds its own actions is exactly what `validateAction` exists
  // to catch.
  if (isManaAbility(ability)) return 'a mana ability is activated as a mana ability';
  const blocker = activationBlocker(state, player, oid, ability);
  if (blocker !== null) return blocker;
  if (ability.cost.mana.hasX && x === undefined) return 'this cost needs an announced X';
  if (!ability.cost.mana.hasX && x !== undefined) return 'this cost has no X to announce';
  if (x !== undefined && (!Number.isInteger(x) || x < 0 || x > MAX_CHOSEN_X)) {
    return `X must be an integer between 0 and ${MAX_CHOSEN_X}`;
  }
  if (
    x !== undefined &&
    !canPay(state, player, resolveX(ability.cost.mana, x), ability.cost.tapSelf ? [oid] : [])
  ) {
    return 'cannot pay the mana cost';
  }
  const payment = validateSacrifices(state, player, oid, ability, sacrifices);
  if (payment !== null) return payment;
  const discarded = validateDiscards(state, player, ability, discards);
  if (discarded !== null) return discarded;
  if (isAttachingAbility(ability)) return validateEquipTarget(state, player, oid, targets);
  if (targets.length !== ability.effects.length) return 'one target slot per effect is required';
  for (const [index, effect] of ability.effects.entries()) {
    if (!isTargetStillLegal(state, effect, targets, index, player, oid)) {
      return `illegal target for effect ${index}`;
    }
  }
  return null;
}

/**
 * The one target an equip ability chooses (CR 702.6b): a creature you control.
 *
 * Written here rather than routed through `isTargetStillLegal`, which is keyed
 * by effect kind and an equip ability has no effect. `isLegalHost` is the same
 * predicate the enumeration built its list from and the same one the ability
 * rechecks when it resolves, so the three cannot come apart.
 */
function validateEquipTarget(
  state: GameState,
  player: PlayerId,
  sourceOid: ObjectId,
  targets: readonly (Target | null)[],
): string | null {
  if (targets.length !== 1) return 'equip chooses exactly one target';
  const target = targets[0];
  if (target === undefined || target === null || target.kind !== 'permanent') {
    return 'equip targets a creature you control';
  }
  return isLegalHost(state, player, target.oid, sourceOid) ? null : 'equip targets a creature you control';
}

/**
 * Full legality of a submitted target choice for a trigger, re-derived from the
 * state.
 *
 * `validateCast`'s target checks over the trigger's effect list, plus the one
 * question a cast never has to ask: is this the ability the kernel is waiting
 * on? An agent holding a stale decision could answer for an ability that has
 * already resolved, or for one further up the stack that has not been asked yet,
 * and both would leave an entry on the stack with nobody owing it anything.
 *
 * **Any answer that settles at least one more slot is taken**, from one slot up
 * to the whole aiming, because `triggerTargetsDecision` asks the question one
 * slot at a time when the whole product will not fit under the enumeration cap.
 * That is not a second protocol: the whole-aiming answer is still legal at a
 * sequenced question, so a surface that never reads the decision's option list
 * cannot tell the two branches apart, and `askForTriggerTargets` re-raises the
 * question until the last slot is filled.
 *
 * A short answer must repeat the slots already settled and must be extendable to
 * a complete legal aiming. Rewriting a settled slot would let a stale decision
 * undo a choice the trigger has already made, and an unextendable prefix would
 * walk into a position with no legal answer, which is the trap this shape exists
 * to close rather than a smaller version of it.
 */
function validateTriggerTargets(
  state: GameState,
  oid: ObjectId,
  targets: readonly (Target | null)[],
): string | null {
  const pending = triggerAwaitingTargets(state);
  if (pending === null) return 'no trigger is choosing targets';
  if (pending.entry.oid !== oid) return `${pending.entry.oid} is the trigger being aimed, not ${oid}`;
  const effects = pending.ability.effects;
  const settled = pending.entry.targets;
  if (targets.length <= settled.length) return 'at least one more target slot must be chosen';
  if (targets.length > effects.length) return 'one target slot per effect is required';
  for (const [index, already] of settled.entries()) {
    const repeated = targets[index] ?? null;
    const matches = already === null ? repeated === null : repeated !== null && sameTarget(already, repeated);
    if (!matches) return `target slot ${index} is already chosen and cannot be changed`;
  }
  if (!honoursDistinctSlots(effects, targets)) return 'each target slot must choose a different object';
  if (
    targets.length < effects.length &&
    completesTrigger(effects, triggerTargetChoices(state, pending), targets) === null
  ) {
    return 'no legal way to aim the remaining target slots extends this choice';
  }
  for (const [index, effect] of effects.entries()) {
    if (index >= targets.length) break;
    // The chooser is the entry's controller and not the player answering: CR
    // 603.3d hands the choice to the ability's controller, and a
    // controller-restricted mode has to be read against that player at every
    // moment it is checked.
    if (
      !isTargetStillLegal(
        state,
        effect,
        targets,
        index,
        pending.entry.controller,
        state.objects[pending.source]?.zone === 'battlefield'
          ? pending.source
          : (pending.entry.sourceCharacteristics ?? pending.source),
      )
    ) {
      return `illegal target for effect ${index}`;
    }
  }
  return null;
}

/**
 * Full legality of an answer to a "you may" (CR 603.3b).
 *
 * Both answers are always legal — that is what optional means — so the only
 * thing to check is that the ability being answered for is the one resolving.
 */
function validateOptionalTrigger(state: GameState, oid: ObjectId): string | null {
  const pending = optionalTriggerOnTop(state);
  if (pending === null) return 'no optional trigger is resolving';
  if (pending.entry.oid !== oid) return `${pending.entry.oid} is the trigger resolving, not ${oid}`;
  return null;
}

/**
 * Full legality of an answer to a spell's "you may" (CR 601.2c), mirroring
 * `validateOptionalTrigger` exactly. Both answers are always legal; the only
 * thing to check is that the spell being answered for is the one resolving.
 * Who is entitled to answer is already enforced by `validateAction`'s generic
 * `decision.player !== action.player` check before this runs, so there is no
 * chooser check to repeat here.
 */
function validateMay(state: GameState, oid: ObjectId): string | null {
  const pending = spellAwaitingMay(state);
  if (pending === null) return 'no spell is awaiting a "you may" answer';
  if (pending.entry.oid !== oid) return `${pending.entry.oid} is the spell resolving, not ${oid}`;
  return null;
}

/**
 * Full legality of an answer to CR 118.8, re-derived from the board.
 *
 * `validateMay` plus a payer check, and the payer is why the check is not
 * `validateMay` with a wider name. Who owes a "you may" is printed on the
 * card; who owes a toll is whoever the spell is currently aimed at, so an
 * agent holding a decision from before a control-change effect could otherwise
 * answer for a seat that is no longer being charged — and unlike a "you may",
 * answering costs that seat mana. `spellAwaitingUnless` also refuses to raise
 * the question at all for a player who cannot pay, so a `null` here is already
 * an affordability check.
 */
function validateUnless(state: GameState, player: PlayerId, oid: ObjectId): string | null {
  const pending = spellAwaitingUnless(state);
  if (pending === null) return 'no spell is awaiting an "unless" answer';
  if (pending.entry.oid !== oid) return `${pending.entry.oid} is the spell resolving, not ${oid}`;
  if (pending.payer !== player) return `${pending.payer} is the player being charged, not ${player}`;
  return null;
}

/**
 * Full legality of an answer to CR 704.5j, re-derived from the board.
 *
 * The collision is recomputed rather than read off the decision, for the reason
 * this file's header gives: an agent holding a stale decision could otherwise
 * name a permanent that has since left the collision — a control-change effect
 * ending mid-question is enough — and bury a permanent that is not in violation
 * at all.
 */
function validateKeepLegend(state: GameState, player: PlayerId, oid: ObjectId): string | null {
  const collision = pendingLegendCollision(state);
  if (collision === null) return 'no legend rule collision is pending';
  if (collision.controller !== player) return `the ${collision.name} permanents are not yours to choose`;
  if (!collision.candidates.includes(oid)) {
    return `${oid} is not one of the ${collision.name} permanents you control`;
  }
  return null;
}

/**
 * Full legality of an answer to CR 701.17a, re-derived from the board.
 *
 * `validateKeepLegend`'s shape and its stated reason: a control-change or a
 * second removal effect landing between the pause and the answer could
 * otherwise let a stale decision sacrifice a creature the asked player no
 * longer controls, or answer for a seat the pause was never asking.
 */
function validatePermanentSacrifice(state: GameState, player: PlayerId, oid: ObjectId): string | null {
  const pending = state.pendingPermanentSacrifice;
  if (pending === undefined) return 'no permanent sacrifice is pending';
  if (pending.player !== player) return `${pending.player} is being asked to sacrifice, not ${player}`;
  if (!pending.permanents.includes(oid)) return `${oid} is not one of the creatures ${player} controls`;
  return null;
}

/**
 * What CR 508.1d demands of one creature: whether it has to attack at all, and
 * which defenders a declaration may point it at.
 *
 * Two requirements land here and they compose differently. `attacksEachCombatIfAble`
 * (a printed static) says a creature attacks and says nothing about whom.
 * `attacksYouThisTurnIfAble` (a turn-scoped rule, `state.turnCombatRules`) says
 * both: the creature attacks, and it attacks the player who imposed it, so a
 * lured creature cannot satisfy the requirement by attacking a planeswalker
 * that player controls.
 *
 * A lure naming somebody who is not a legal defender of this attack narrows to
 * nothing, and CR 508.1a is what to do about it: a requirement that cannot be
 * obeyed is ignored rather than making the declaration illegal. So the empty
 * narrowing collapses back to "no requirement, every defender" rather than to
 * "this creature has no legal attack". The case is reachable — control of the
 * source can change after the rule is imposed — and treating it as a hard
 * constraint would produce a position with no legal declaration at all.
 *
 * Restrictions are not consulted here and do not need to be: every caller reads
 * `eligibleAttackers`, which has already dropped anything under `cantAttack` or
 * tapped or summoning-sick. That is CR 508.1's precedence (a restriction beats
 * a requirement) implemented by the requirement never seeing the creature.
 */
function attackRequirement(
  state: GameState,
  oid: ObjectId,
  defenders: readonly CombatDefender[],
): {
  readonly mustAttack: boolean;
  readonly lured: boolean;
  readonly allowed: readonly CombatDefender[];
} {
  const lured = luredDefenders(state, oid).filter((player) => defenders.includes(player));
  const forcedByStatic = hasCombatModification(state, oid, 'attacksEachCombatIfAble');
  if (lured.length === 0) return { mustAttack: forcedByStatic, lured: false, allowed: defenders };
  return {
    mustAttack: true,
    lured: true,
    allowed: defenders.filter((defender) => typeof defender === 'number' && lured.includes(defender)),
  };
}

/**
 * An answer to CR 508.1: the whole declaration, or a prefix of the creatures
 * that could attack.
 *
 * The whole declaration is still the shape every constructing caller sends, and
 * it is what an absent `settled` means. What widened is the floor (`mtg-tb7v`
 * stage 2): the kernel asks a wide board one creature at a time, so an answer
 * for the first few creatures has to be an answer, and the decision stands until
 * every creature has been asked. Three rules keep a prefix from being a way to
 * say nothing or to say something twice — it settles at least one creature more
 * than the last answer did, it names no creature it has not been asked about,
 * and it repeats every attack already declared exactly.
 */
export function validateAttackerDeclaration(
  state: GameState,
  player: PlayerId,
  action: Extract<Action, { type: 'declareAttackers' }>,
): string | null {
  const order = eligibleAttackers(state);
  const eligible = new Set(order);
  const already = state.combat.attacksSettled ?? 0;
  const settled = action.settled ?? order.length;
  if (!Number.isInteger(settled) || settled < 0 || settled > order.length) {
    return 'a declaration answers for between none and all of the creatures that can attack';
  }
  if (settled <= already) return 'a declaration must answer for at least one more creature';
  const asked = new Set(order.slice(0, settled));
  const seen = new Set<ObjectId>();
  for (const declaration of action.attackers) {
    if (!eligible.has(declaration.oid)) return `${declaration.oid} cannot attack`;
    if (!asked.has(declaration.oid)) return `${declaration.oid} has not been asked about yet`;
    if (seen.has(declaration.oid)) return `${declaration.oid} declared twice`;
    seen.add(declaration.oid);
    if (!isLegalCombatDefender(state, player, declaration.defender)) {
      return 'attackers must attack the opponent or an opposing planeswalker';
    }
  }
  // CR 508.1d: a creature under `attacksEachCombatIfAble` that has already been
  // asked (its position is inside the settled prefix) has made its final choice
  // for this declaration — the two-phase model never revisits a settled
  // creature — so "if able" must be checked the moment it is asked about, not
  // deferred to `whole`. `eligible`/`order` already restrict this to creatures
  // that are able (untapped, unsick or hasty, `defender`-free, not
  // `cantAttack`), so the only way to fail is to have left it off the list.
  const defenders = combatDefenders(state, player);
  for (const oid of order.slice(0, settled)) {
    const requirement = attackRequirement(state, oid, defenders);
    if (!requirement.mustAttack) continue;
    const declared = action.attackers.find((declaration) => declaration.oid === oid);
    if (declared === undefined) {
      return requirement.lured
        ? `${oid} attacks that player this turn if able and must attack`
        : `${oid} attacks each combat if able and must attack`;
    }
    // The second half of the requirement, and only a lure has one: the
    // declaration has to point the creature at a defender the requirement
    // admits. `attackRequirement` has already collapsed an unobeyable lure to
    // every defender (CR 508.1a), so this can only reject a declaration that
    // had a satisfying defender available and chose another.
    if (!requirement.allowed.some((allowed) => canonicalJson(allowed) === canonicalJson(declared.defender))) {
      return `${oid} must attack the player whose ability compelled it`;
    }
  }
  for (const attack of state.combat.attacks) {
    const kept = action.attackers.find((declaration) => declaration.oid === attack.oid);
    if (kept === undefined) return `${attack.oid} is already attacking and cannot be taken back`;
    if (canonicalJson(kept.defender) !== canonicalJson(attack.defender)) {
      return `${attack.oid} is already attacking something else`;
    }
  }
  return null;
}

/**
 * An answer to CR 509.1: the whole declaration, or a prefix of the creatures
 * that could block.
 *
 * `validateAttackerDeclaration`'s three rules, plus the one this site has and
 * that one does not: a prefix must be completable. Menace is the only rule a
 * finished declaration can fail while every pair in it is legal, so a prefix is
 * held to the per-pair rules and to a matching that says the block can still be
 * finished, and the last answer of a sequence is held to the menace rule itself.
 * `blocksCompletable` carries the argument and `legal.ts` refuses an
 * uncompletable prefix at the offer as well, so the two agree by construction.
 *
 * CR 509.1c rides beside menace on the same shape: `target` (a joint maximum,
 * `mustBlockTarget` over the full eligible pool) is checked against
 * coverage on the whole declaration and against reachability on a prefix,
 * exactly mirroring how `blocksCompletable` is checked for menace two lines
 * below — this is the actual submission-time gate, so a caller that bypassed
 * `blockerDecision`'s offered options entirely (an adapter, a fuzzer) is held
 * to the requirement too, not just a surface that took what it was offered.
 */
export function validateBlockDeclaration(
  state: GameState,
  player: PlayerId,
  action: Extract<Action, { type: 'declareBlockers' }>,
): string | null {
  const order = eligibleBlockers(state);
  const already = state.combat.blocksSettled ?? 0;
  const settled = action.settled ?? order.length;
  if (!Number.isInteger(settled) || settled < 0 || settled > order.length) {
    return 'a declaration answers for between none and all of the creatures that can block';
  }
  if (settled <= already) return 'a declaration must answer for at least one more creature';
  const asked = new Set(order.slice(0, settled));
  for (const block of action.blocks) {
    if (!asked.has(block.blocker)) return `${block.blocker} has not been asked about yet`;
  }
  for (const standing of declaredBlocks(state)) {
    const kept = action.blocks.find((block) => block.blocker === standing.blocker);
    if (kept === undefined) return `${standing.blocker} is already blocking and cannot be taken back`;
    if (kept.attacker !== standing.attacker) return `${standing.blocker} is already blocking something else`;
  }
  const whole = settled === order.length;
  const reason = validateBlocks(state, player, action.blocks, whole);
  if (reason !== null) return reason;
  if (!whole && !blocksCompletable(state, action.blocks, order.slice(settled))) {
    return 'no legal block finishes that declaration';
  }
  const attackers = state.combat.attacks.map((attack) => attack.oid);
  const mustBeBlocked = attackers.filter((attacker) =>
    hasCombatModification(state, attacker, 'mustBeBlockedIfAble'),
  );
  const target = mustBlockTarget(state, outstandingDemands(state, [], mustBeBlocked), order);
  if (whole) {
    if (mustBlockCoverage(state, action.blocks, mustBeBlocked) < target) {
      return 'not as many creatures able to block a must-be-blocked attacker are blocking it as jointly possible';
    }
  } else if (!mustBlockReachable(state, action.blocks, mustBeBlocked, target, order.slice(settled))) {
    return 'no legal block finishes the must-be-blocked requirement';
  }
  return null;
}

/**
 * An answer to the damage assignment order: any run of positions from one to all
 * of them.
 *
 * The whole order used to be the only shape, and it is still the shape every
 * constructing caller sends. What widened is the *floor* (`mtg-tb7v`): the
 * kernel asks a big order one position at a time, so a prefix of one attacker's
 * order has to be an answer, and the decision then stands until every position
 * is settled. Three rules keep that from being a way to say nothing —
 * an answer settles at least one new position, it never takes a settled one
 * back, and it never contradicts one.
 *
 * "Contradicts" is asked of the slot rather than the creature. Two blockers the
 * position cannot tell apart are one slot (`damage-order.ts`), so a caller who
 * spells a settled position with the twin has settled it the same way and is
 * taken; `settledAction` then rewrites the spelling to the one the board is
 * holding, so what is applied is what was already there.
 */
function validateOrdering(
  state: GameState,
  orders: readonly { attacker: ObjectId; blockers: readonly ObjectId[] }[],
): string | null {
  const needed = attackersNeedingOrder(state);
  const settled = state.combat.ordered ?? {};
  const seen = new Set<ObjectId>();
  let progress = false;
  for (const order of orders) {
    if (seen.has(order.attacker)) return `${order.attacker} is ordered twice`;
    seen.add(order.attacker);
    const block = needed.find((entry) => entry.attacker === order.attacker);
    if (block === undefined) return `${order.attacker} is not an attacker that needs an ordering`;
    if (order.blockers.length > block.blockers.length) {
      return `ordering for ${block.attacker} names more creatures than are blocking it`;
    }
    const members = new Set(block.blockers);
    const named = new Set<ObjectId>();
    for (const blocker of order.blockers) {
      if (!members.has(blocker)) return `${blocker} is not blocking ${block.attacker}`;
      if (named.has(blocker)) return `${blocker} is ordered twice against ${block.attacker}`;
      named.add(blocker);
    }
    const already = settled[block.attacker] ?? 0;
    if (order.blockers.length < already) {
      return `ordering for ${block.attacker} takes back a position that is already settled`;
    }
    if (already > 0) {
      const classes = damageOrderClasses(state, block.blockers);
      const keyOf = (oid: ObjectId): string => classes.get(oid) ?? oid;
      for (const [index, spelled] of order.blockers.slice(0, already).entries()) {
        const standing = block.blockers[index];
        if (standing === undefined || keyOf(spelled) !== keyOf(standing)) {
          return `ordering for ${block.attacker} contradicts a position that is already settled`;
        }
      }
    }
    if (order.blockers.length > already) progress = true;
  }
  if (!progress) return 'an ordering must settle at least one position';
  return null;
}

/**
 * An answer to a set selection: the whole choice, or a prefix of it in hand
 * order.
 *
 * The whole choice is the shape every constructing caller sends — both
 * `@mtg/sim` bots and `@mtg/kernel`'s own `simple-agent` build a discard and a
 * bottoming out of the hand and never read the enumeration — and it is held to
 * exactly the rules it always was: as many cards as the position asks for, each
 * of them in the hand, none of them twice. What widened is the *floor*
 * (`mtg-cs8t`): the kernel asks a wide selection one card at a time, so a prefix
 * has to be an answer, and the selection then stands until every card is named.
 *
 * Three rules keep a prefix from being a way to say nothing or a way to say the
 * same thing twice. It names at least one card the last answer did not. It never
 * takes a named card back. And it names its cards in hand order, which is what
 * leaves exactly one path of answers to each selection — without it the k!
 * orderings of one set are k! recordings of one move.
 *
 * A prefix is also refused when too few cards follow the last one it named, for
 * the same reason `legal.ts` never offers such a step: a selection that cannot
 * be finished is a dead end, and the contract's own conformance check plays a
 * game by taking `options[0]`.
 */
function validateSelection(
  state: GameState,
  hand: readonly ObjectId[],
  count: number,
  oids: readonly ObjectId[],
  wrongSize: string,
  /**
   * Whose hand the refusal names. `'your'` at the two sites where the seat
   * selecting owns the cards, and something else at the one where it does not:
   * a `chooseDiscard` asks the controller about an opponent's hand, and
   * "is not in your hand" would be a false statement about a true refusal.
   */
  whose = 'your',
): string | null {
  const inHand = new Set(hand);
  const seen = new Set<ObjectId>();
  for (const oid of oids) {
    if (!inHand.has(oid)) return `${oid} is not in ${whose} hand`;
    if (seen.has(oid)) return `${oid} listed twice`;
    seen.add(oid);
  }
  if (oids.length > count) return wrongSize;
  const chosen = state.pendingSelection ?? [];
  for (const oid of chosen) {
    if (!seen.has(oid)) return `${oid} is already chosen and cannot be taken back`;
  }
  // A whole answer is always an answer, including the empty one a seat on its
  // first opening hand gives: `count` is zero there, and "name one more card"
  // would refuse the only legal keep in the game.
  if (oids.length === count) return null;
  if (oids.length <= chosen.length) return 'a selection must name at least one more card';
  let previous = -1;
  for (const oid of oids) {
    const at = hand.indexOf(oid);
    if (at <= previous) return 'a partial selection names its cards in hand order';
    previous = at;
  }
  if (hand.length - previous - 1 < count - oids.length) {
    return 'too few cards follow the last one named to finish that selection';
  }
  return null;
}

function validateManaAbility(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  color: ManaColor,
): string | null {
  const blocked = manaSourceBlocker(state, player, oid);
  if (blocked !== null) return blocked;
  if (!manaSourceColors(getObject(state, oid).card).includes(color)) {
    return `source cannot produce ${color}`;
  }
  return null;
}

/**
 * Full legality check for a submitted action. Returns a reason string when the
 * action is illegal, `null` when it is legal.
 */
export function validateAction(state: GameState, action: Action): string | null {
  if (state.result !== null) return 'the game is already over';
  if (action.type === 'concede') return null;

  const decision = pendingDecision(state);
  if (decision === null) return 'the kernel is not waiting for a decision';
  if (decision.player !== action.player) return `it is player ${decision.player}'s decision`;

  switch (action.type) {
    case 'passPriority':
      return decision.kind === 'priority' ? null : 'you owe a different decision first';
    case 'playLand': {
      if (decision.kind !== 'priority') return 'you owe a different decision first';
      const object = tryObject(state, action.oid);
      if (object === undefined || object.zone !== 'hand' || object.owner !== action.player) {
        return 'card is not in your hand';
      }
      if (object.card.kind !== 'land') return 'that card is not a land';
      if (state.turn.active !== action.player) return 'lands are played on your own turn';
      if (!isMainPhase(state.turn.step)) return 'lands are played in a main phase';
      if (state.stack.length > 0) return 'lands are played with an empty stack';
      if (state.turn.landsPlayed >= 1) return 'you have already played a land this turn';
      return null;
    }
    case 'castSpell':
      if (decision.kind !== 'priority') return 'you owe a different decision first';
      return validateCast(
        state,
        action.player,
        action.oid,
        action.targets,
        action.x,
        action.mode,
        action.multiTargets,
      );
    case 'activateManaAbility':
      if (decision.kind !== 'priority') return 'you owe a different decision first';
      return validateManaAbility(state, action.player, action.oid, action.color);
    case 'activateAbility':
      if (decision.kind !== 'priority') return 'you owe a different decision first';
      return validateActivation(
        state,
        action.player,
        action.oid,
        action.abilityIndex,
        action.targets,
        action.sacrifices,
        action.discards ?? [],
        action.x,
      );
    case 'chooseTriggerTargets':
      if (decision.kind !== 'triggerTargets') return 'no trigger is choosing targets';
      return validateTriggerTargets(state, action.oid, action.targets);
    case 'answerOptionalTrigger':
      if (decision.kind !== 'optionalTrigger') return 'no optional trigger is resolving';
      return validateOptionalTrigger(state, action.oid);
    case 'answerMay':
      if (decision.kind !== 'may') return 'no spell is awaiting a "you may" answer';
      return validateMay(state, action.oid);
    case 'answerUnless':
      if (decision.kind !== 'unless') return 'no spell is awaiting an "unless" answer';
      return validateUnless(state, action.player, action.oid);
    case 'keepLegend':
      if (decision.kind !== 'legendRule') return 'the legend rule is not being applied';
      return validateKeepLegend(state, action.player, action.oid);
    case 'sacrificePermanent':
      if (decision.kind !== 'permanentSacrifice') return 'no sacrifice is resolving';
      return validatePermanentSacrifice(state, action.player, action.oid);
    case 'scry': {
      if (decision.kind !== 'scry') return 'no scry is resolving';
      if (action.top.length + action.bottom.length !== decision.cards.length) {
        return 'the scry choice must place every looked-at card exactly once';
      }
      const wanted = new Set(decision.cards);
      const seen = new Set<ObjectId>();
      for (const oid of [...action.top, ...action.bottom]) {
        if (!wanted.has(oid)) return `${oid} is not in the scry window`;
        if (seen.has(oid)) return `${oid} listed twice`;
        seen.add(oid);
      }
      return seen.size === wanted.size ? null : 'the scry choice must place every looked-at card';
    }
    case 'searchLibrary': {
      if (decision.kind !== 'searchLibrary') return 'no search is resolving';
      if (action.found === null) return null;
      return decision.cards.includes(action.found)
        ? null
        : `${action.found} is not a card this search may find`;
    }
    case 'chooseFromGraveyard': {
      if (decision.kind !== 'graveyardChoice') return 'no graveyard choice is resolving';
      if (action.chosen === null) return null;
      return decision.cards.includes(action.chosen)
        ? null
        : `${action.chosen} is not a card this effect may take from a graveyard`;
    }
    case 'declareAttackers':
      if (decision.kind !== 'declareAttackers') return 'attackers are not being declared';
      return validateAttackerDeclaration(state, action.player, action);
    case 'declareBlockers':
      if (decision.kind !== 'declareBlockers') return 'blockers are not being declared';
      return validateBlockDeclaration(state, action.player, action);
    case 'orderBlockers':
      if (decision.kind !== 'orderBlockers') return 'blocker order is not being chosen';
      return validateOrdering(state, action.orders);
    case 'mulligan':
      if (decision.kind !== 'mulligan') return 'the opening hands are already settled';
      return canMulligan(state, action.player)
        ? null
        : `you have already mulliganed ${String(state.config.openingHandSize)} times`;
    case 'keepHand':
      if (decision.kind !== 'mulligan') return 'the opening hands are already settled';
      return validateSelection(
        state,
        decision.hand,
        decision.count,
        action.bottom,
        `you must put exactly ${String(decision.count)} on the bottom`,
      );
    case 'discard':
      if (decision.kind !== 'discard') return 'you are not discarding';
      return validateSelection(
        state,
        decision.hand,
        decision.count,
        action.oids,
        `you must discard exactly ${String(decision.count)}`,
      );
    case 'chooseDiscards':
      if (decision.kind !== 'handDiscard') return 'no discard is resolving';
      return validateSelection(
        state,
        decision.hand,
        decision.count,
        action.oids,
        `you must name exactly ${String(decision.count)} to discard`,
        decision.owner === decision.player ? 'your' : "that player's",
      );
  }
}
