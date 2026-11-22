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
import type {
  ActivatedAbility,
  Card,
  CastableCard,
  Effect,
  EntryCharacteristicMode,
  ManaCost,
} from '@mtg/dsl';
import {
  assertNever,
  canonicalJson,
  COLORS,
  effectsForActivatedAbility,
  hasTarget,
  isAttachingAbility,
  isAuraCard,
  isCastable,
  isLoyaltyAbility,
  isGuildFeudAbility,
  isManaAbility,
  isMultipleTargetSpec,
  isReturnAnotherCreatureOrSacrificeSelfAbility,
  isTargetedFight,
  isVariableLoyaltyCost,
  manaValue,
  MAX_CHOSEN_X,
  MAX_SCRY_COUNT,
  openingHandActionOf,
  renderCastingRestriction,
  renderOpponentLifeLossCastingRestriction,
  resolveX,
  spellEffectsFor,
} from '@mtg/dsl';
import { counterCount } from './continuous';
import { lifeLostByOpponentsThisTurn } from './life-history';
import {
  attackRequirement,
  attacksCompletable,
  blockRequirementCoverage,
  blockRequirements,
  blockRequirementsReachable,
  maximizeBlockRequirements,
  requiredAttackers,
} from './combat-declarations';
import { countTargetInstances } from './target-count';
import {
  hasPluralTargets,
  minimumPluralChoice,
  isPluralTargetEffect,
  shouldStagePluralTargets,
  validatePluralTargets,
} from './plural-targets';
import type { DamageAllocationDecision, PluralTargetsDecision } from './plural-decisions';
import { damageAllocationDecision, pluralTargetsDecision } from './plural-decisions';
import { isLegalAuraHost, isLegalHost } from './attach';
import { canBeTargetedBy } from './keyword-abilities';
import type { Action, AttackDeclaration, BlockDeclaration, CastingCostChoice } from './actions';
import { MAX_CARD_NAME_LENGTH } from './actions';
import {
  attackCohortRestriction,
  attackersNeedingOrder,
  blockersNeedingAttackerOrder,
  canBlock,
  canBlockAnyNumber,
  combatDefenders,
  eligibleAttackers,
  eligibleBlockers,
  isLegalCombatDefender,
  validateBlocks,
} from './combat';
import { damageOrderClasses } from './damage-order';
import { damagePreventionRange } from './damage';
import type { Enumerated } from './enumerate';
import {
  cartesian,
  combinations,
  DEFAULT_ENUMERATION_CAP,
  distinctPermutations,
  permutations,
  subsets,
} from './enumerate';
import { honoursDistinctSlots, isTargetStillLegal, sameTarget } from './effects';
import { maxPayableX, selectedCastingManaCost } from './cost';
import type { ObjectId, PlayerId } from './ids';
import {
  activatedAbilitiesProhibited,
  abilitiesOf,
  controlledBy,
  currentActivatedAbilityAt,
  controllerOf,
  hasCardType,
  hasKeyword,
  hasSubtype,
  isCreatureObject,
} from './layers';
import { opponentOf } from './ids';
import { nameOf } from './backend-naming';
import { availableMana, canPay, landProducesOnBattlefield } from './mana';
import { canPayAttackTaxes } from './attack-tax';
import { anyColorCombinationAmount } from './mana-ability';
import type { SpellOnStack } from './may-choice';
import { spellAwaitingMay } from './may-choice';
import type { TolledStackObject } from './unless-choice';
import { stackAwaitingUnless } from './unless-choice';
import { canMulligan, cardsToBottom } from './mulligan';
import { eligibleOpeningHandActionCards } from './opening-hand';
import type { LegendCollision } from './sba';
import { pendingLegendCollision } from './sba';
import type {
  AttackerOrder,
  Block,
  CombatDefender,
  DamageAllocations,
  EntryCounterKind,
  GameState,
  ManaColor,
  PendingPermanentUntap,
  PendingPermanentUntapChoice,
  PendingBattlefieldChoice,
  PendingPopulate,
  PendingPopulateCandidate,
  PendingCardCopyCast,
  PendingFreeCast,
  Target,
} from './state';
import { isMainPhase } from './state';
import { isAttacking, satisfiesTargetFilter } from './target-filter';
import {
  multipleTargetCandidates,
  everySlotHasAChoice,
  targetChoicesFor,
  targetChoicesForActivation,
  targetChoicesForEffects,
} from './target-choices';
import { playerOf } from './trace';
import {
  cleanupDiscardCount,
  flashCastingPermissionApplies,
  freeCastFromHandPermissionApplies,
  staticPlayerRuleApplies,
} from './player-rules';
import type { TriggerOnStack } from './trigger-choice';
import { optionalTriggerOnTop, triggerAwaitingTargets, triggerTargetChoices } from './trigger-choice';
import { returnAnotherCreatureCandidates } from './return-another-creature';
import { stackEntryTargetingController } from './abilities';
import { canUntapObject, getObject, tryObject } from './zones';
import { selectPrintedByCardFilter } from './zone-filter';
import { isDetained } from './detention';
import { spellCard } from './stack-spell';

/** One eligible blocker and every attacker it may legally block. */
export interface BlockCandidates {
  readonly blocker: ObjectId;
  /** Whether this creature may be assigned to one attacker or several. */
  readonly capacity: 'one' | 'any';
  /** Never empty: a creature that can block nothing is not a candidate list. */
  readonly attackers: readonly ObjectId[];
}

export type Decision =
  | {
      /** A copy-as-entry replacement: every legal creature plus decline. */
      readonly kind: 'entryCopy';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly creatures: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** A mandatory permanent choice made by an as-entry counter replacement. */
      readonly kind: 'entryCounter';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly permanents: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** A required choice among complete copiable forms before entry. */
      readonly kind: 'entryCharacteristics';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly modes: readonly EntryCharacteristicMode[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** An optional counter replacement answered before entry. */
      readonly kind: 'entryOptionalCounter';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly counter: EntryCounterKind;
      readonly count: number;
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** An optional life payment answered before entry. */
      readonly kind: 'entryPayLife';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly life: number;
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** A mandatory player choice made before a permanent enters. */
      readonly kind: 'entryPlayer';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** A mandatory exactly-two-color choice made before a permanent enters. */
      readonly kind: 'entryColors';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** CR 303.4f's mandatory, non-targeted host choice for an entering Aura. */
      readonly kind: 'entryAura';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly permanents: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** The remaining objects in one controller's CR 613.7m timestamp order. */
      readonly kind: 'entryTimestampOrder';
      readonly player: PlayerId;
      readonly ordered: readonly ObjectId[];
      readonly remaining: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** CR 615.7: one source's share of a finite simultaneous-damage shield. */
      readonly kind: 'damagePrevention';
      readonly player: PlayerId;
      readonly effectId: string;
      readonly source: { readonly sourceOid: ObjectId; readonly damage: number };
      readonly remaining: number;
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** The complete target tuple a resolving Redirect or copy effect may use. */
      readonly kind: 'spellTargets';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      readonly targets: readonly (Target | null)[];
      readonly multiTargets?: Readonly<Record<number, readonly Target[]>>;
      readonly damageAllocations?: DamageAllocations;
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /** One filtered card from a hand revealed by the resolving instruction. */
      readonly kind: 'revealedHandChoice';
      readonly player: PlayerId;
      readonly owner: PlayerId;
      /** Eligible subset only; the pending record retains the complete reveal. */
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /** Every complete declaration that can cast the revealed card for zero mana. */
      readonly kind: 'freeCast';
      readonly player: PlayerId;
      readonly oid: ObjectId;
      /** Whether leaving the card in its current zone is a legal answer. */
      readonly optional: boolean;
      readonly options: readonly Action[];
      readonly complete: boolean;
    }
  | {
      /**
       * Card-authored actions available after every hand is kept and before
       * turn 1. Cards are in stable hand order and the final option explicitly
       * finishes this player's action round.
       */
      readonly kind: 'openingHandAction';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** CR 201.4: free text, not an enumeration of hidden or format card names. */
      readonly kind: 'cardName';
      readonly player: PlayerId;
      /** Earlier APNAP choices, public to players choosing later (CR 101.4b). */
      readonly chosen: readonly { readonly player: PlayerId; readonly name: string }[];
      readonly input: {
        readonly kind: 'text';
        readonly label: 'Card name';
        readonly minLength: 1;
        readonly maxLength: typeof MAX_CARD_NAME_LENGTH;
      };
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** Remaining canonical matches from a resolving named three-zone search. */
      readonly kind: 'namedZoneExile';
      readonly player: PlayerId;
      readonly targetPlayer: PlayerId;
      readonly name: string;
      readonly cards: readonly ObjectId[];
      readonly chosen: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** CR 701.18: every ordered partition of the visible top window. */
      readonly kind: 'scry';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      readonly kind: 'topLibraryOrder';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      readonly kind: 'topLibrarySelect';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly eligible: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      readonly kind: 'topLibraryPartition';
      readonly player: PlayerId;
      readonly cards: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      readonly kind: 'topLibraryPile';
      readonly player: PlayerId;
      readonly piles: readonly [readonly ObjectId[], readonly ObjectId[]];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** Every found card that may be assigned to the destination plan's `one` arm. */
      readonly kind: 'searchDestination';
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
      /** Mandatory current controlled-permanent choice; no decline arm. */
      readonly kind: 'battlefieldChoice';
      readonly player: PlayerId;
      readonly permanents: readonly ObjectId[];
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** CR 701.30's mandatory, non-targeting controlled creature-token choice. */
      readonly kind: 'populate';
      readonly player: PlayerId;
      readonly tokens: readonly ObjectId[];
      readonly options: readonly (
        Extract<Action, { type: 'choosePopulateToken' }> | Extract<Action, { type: 'concede' }>
      )[];
      readonly complete: true;
    }
  | {
      /**
       * CR 701.17a: which of the affected player's own filtered permanents a
       * resolving `sacrificePermanent` takes.
       *
       * The graveyard choice above with the zone swapped for the battlefield —
       * same public-zone reasoning, same "not stripped from the other seat's
       * projection" consequence — and `legendRuleDecision`'s shape otherwise:
       * one option per filtered candidate and no "take none" arm, because CR
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
       * `complete` is always `true`: one option per currently eligible
       * permanent, linear in the board, nothing to truncate.
       */
      readonly kind: 'permanentSacrifice';
      readonly player: PlayerId;
      readonly permanents: readonly ObjectId[];
      readonly remaining: number;
      readonly options: readonly Action[];
      readonly complete: true;
    }
  | {
      /** A canonical prefix choice for a non-targeted group untap. */
      readonly kind: 'permanentUntap';
      readonly player: PlayerId;
      readonly permanents: readonly ObjectId[];
      readonly remaining: number;
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
      /** A resolving stack object is choosing one of its printed mana colors. */
      readonly kind: 'manaColor';
      readonly player: PlayerId;
      readonly colors: readonly ManaColor[];
      readonly options: readonly Action[];
      readonly complete: true;
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
      readonly kind: 'orderAttackers';
      readonly player: PlayerId;
      readonly blocks: readonly AttackerOrder[];
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
  | PluralTargetsDecision
  | DamageAllocationDecision
  | {
      /**
       * Answer a triggered ability's yes/no choice as it resolves.
       *
       * `targets` is what the ability was aimed at when it went on the stack,
       * which is the half of the question the options themselves cannot show:
       * the two options are "yes" and "no", and what is being said yes to is the
       * printed line pointed at these. Most uses are CR 603.3b optional
       * triggers; Faerie Impostor reuses the shape for its optional return
       * cost, whose declined branch sacrifices the source.
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

function castingRuleBlocks(state: GameState, player: PlayerId): boolean {
  return state.turnPlayerRules.some((rule) => rule.rule === 'cantCastSpells' && rule.player === player);
}

function castPermissionError(state: GameState, player: PlayerId): string | undefined {
  if (castingRuleBlocks(state, player)) return "you can't cast spells this turn";
  if (staticPlayerRuleApplies(state, player, 'cantCastSpellsIfAttackedWithCreatureThisTurn')) {
    return "you can't cast spells after attacking with a creature this turn";
  }
  return undefined;
}

function cardCastingRestrictionError(
  state: GameState,
  player: PlayerId,
  card: CastableCard,
): string | undefined {
  if (
    card.kind === 'creature' &&
    card.opponentsLifeLostThisTurnCasting === true &&
    lifeLostByOpponentsThisTurn(state, player) === 0
  ) {
    return renderOpponentLifeLossCastingRestriction(card.name);
  }
  const restriction = card.castingRestriction;
  if (restriction === undefined) return undefined;
  switch (restriction.kind) {
    case 'prohibitedPlayerTurns':
      return state.turn.active === player && restriction.turns.includes(playerOf(state, player).turnsBegun)
        ? renderCastingRestriction(restriction, card.name)
        : undefined;
  }
}

function castTimingError(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  card: CastableCard,
): string | undefined {
  const permission = castPermissionError(state, player);
  if (permission !== undefined) return permission;
  const restriction = cardCastingRestrictionError(state, player, card);
  if (restriction !== undefined) return restriction;
  if (
    card.kind === 'instant' ||
    card.keywordAbilities?.some((ability) => ability.kind === 'flash') === true ||
    atSorcerySpeed(state, player) ||
    flashCastingPermissionApplies(state, player, oid)
  ) {
    return undefined;
  }
  return 'wrong timing for this card type';
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
  multiTargets: Readonly<Record<number, readonly Target[]>> | undefined,
  damageAllocations: DamageAllocations | undefined,
  castingCost: CastingCostChoice | undefined,
  sacrifices: readonly ObjectId[] | undefined,
  discards: readonly ObjectId[] | undefined,
): Action {
  return {
    type: 'castSpell',
    player,
    oid,
    targets,
    ...(x !== undefined ? { x } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(multiTargets !== undefined ? { multiTargets } : {}),
    ...(damageAllocations !== undefined ? { damageAllocations } : {}),
    ...(castingCost !== undefined ? { castingCost } : {}),
    ...(sacrifices !== undefined ? { sacrifices } : {}),
    ...(discards !== undefined ? { discards } : {}),
  };
}

/** The filtered permanent payment belonging to the selected casting price. */
function spellSacrificeRequirement(card: CastableCard, castingCost: CastingCostChoice) {
  if (castingCost === 'alternative') return card.alternativeCost?.sacrificeMatching;
  if (card.kind !== 'instant' && card.kind !== 'sorcery') return undefined;
  const cost = card.additionalCost;
  return cost !== undefined && 'sacrificeMatching' in cost ? cost.sacrificeMatching : undefined;
}

/** The hand-card payment belonging to the selected casting price. */
function spellDiscardRequirement(card: CastableCard, castingCost: CastingCostChoice): number | undefined {
  if (castingCost === 'alternative' || (card.kind !== 'instant' && card.kind !== 'sorcery')) {
    return undefined;
  }
  const cost = card.additionalCost;
  return cost !== undefined && 'discard' in cost ? cost.discard : undefined;
}

function buildBeginCastAction(
  player: PlayerId,
  oid: ObjectId,
  targets: readonly (Target | null)[],
  x: number | undefined,
  mode: number | undefined,
  castingCost: CastingCostChoice | undefined,
  sacrifices: readonly ObjectId[] | undefined,
  discards: readonly ObjectId[] | undefined,
): Action {
  return {
    type: 'beginCastSpell',
    player,
    oid,
    targets,
    ...(x !== undefined ? { x } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(castingCost !== undefined ? { castingCost } : {}),
    ...(sacrifices !== undefined ? { sacrifices } : {}),
    ...(discards !== undefined ? { discards } : {}),
  };
}

/** Every permanent set that can pay this spell's additional sacrifice. */
function spellSacrificePayments(
  state: GameState,
  player: PlayerId,
  card: CastableCard,
  castingCost: CastingCostChoice,
  cap: number,
): Enumerated<readonly ObjectId[]> {
  const payment = spellSacrificeRequirement(card, castingCost);
  if (payment === undefined) return { items: [[]], complete: true };
  const candidates = state.battlefield.filter(
    (oid) => controllerOf(state, oid) === player && satisfiesTargetFilter(state, oid, payment.filter),
  );
  return combinations(candidates, payment.count, cap);
}

/** Every hand-card set that can pay this spell's additional discard. */
function spellDiscardPayments(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  card: CastableCard,
  castingCost: CastingCostChoice,
  cap: number,
): Enumerated<readonly ObjectId[]> {
  const count = spellDiscardRequirement(card, castingCost);
  if (count === undefined) return { items: [[]], complete: true };
  const candidates = playerOf(state, player).hand.filter((candidate) => candidate !== oid);
  return combinations(candidates, count, cap);
}

/** Validates the chosen objects against the same spell-payment predicate. */
function validateSpellSacrifices(
  state: GameState,
  player: PlayerId,
  card: CastableCard,
  castingCost: CastingCostChoice,
  offered: readonly ObjectId[],
): string | null {
  const payment = spellSacrificeRequirement(card, castingCost);
  const wanted = payment?.count ?? 0;
  if (offered.length !== wanted) {
    return payment === undefined
      ? `this spell sacrifices nothing, and ${String(offered.length)} was offered`
      : `the additional cost sacrifices ${String(wanted)} matching permanents, and ${String(offered.length)} was offered`;
  }
  if (payment === undefined) return null;
  const eligible = new Set(
    state.battlefield.filter(
      (oid) => controllerOf(state, oid) === player && satisfiesTargetFilter(state, oid, payment.filter),
    ),
  );
  const seen = new Set<ObjectId>();
  for (const oid of offered) {
    if (seen.has(oid)) return `${oid} was offered twice`;
    seen.add(oid);
    if (!eligible.has(oid)) {
      return `${oid} does not match a permanent you control permitted by this additional cost`;
    }
  }
  return null;
}

/** Validates the chosen hand cards against the same spell-payment predicate. */
function validateSpellDiscards(
  state: GameState,
  player: PlayerId,
  spellOid: ObjectId,
  card: CastableCard,
  castingCost: CastingCostChoice,
  offered: readonly ObjectId[],
): string | null {
  const wanted = spellDiscardRequirement(card, castingCost) ?? 0;
  if (offered.length !== wanted) {
    return wanted === 0
      ? `this spell discards nothing, and ${String(offered.length)} was offered`
      : `the additional cost discards ${String(wanted)} card, and ${String(offered.length)} was offered`;
  }
  if (wanted === 0) return null;
  const eligible = new Set(playerOf(state, player).hand.filter((oid) => oid !== spellOid));
  const seen = new Set<ObjectId>();
  for (const oid of offered) {
    if (seen.has(oid)) return `${oid} was offered twice`;
    seen.add(oid);
    if (!eligible.has(oid)) return `${oid} is not another card in your hand`;
  }
  return null;
}

/** Explicit choices only on cards that actually print an alternative. */
function castingCostChoicesFor(card: CastableCard): readonly CastingCostChoice[] {
  return card.alternativeCost === undefined ? ['mana'] : ['mana', 'alternative'];
}

function payableCastingCosts(
  state: GameState,
  player: PlayerId,
  card: CastableCard,
  x: number | undefined,
  targetCount: number,
): readonly CastingCostChoice[] {
  return castingCostChoicesFor(card).filter((castingCost) => {
    if (
      castingCost === 'alternative' &&
      (card.alternativeCost === undefined || playerOf(state, player).life < card.alternativeCost.payLife)
    ) {
      return false;
    }
    return canPay(state, player, selectedCastingManaCost(state, player, card, x, castingCost, targetCount));
  });
}

function castActionsForMode(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  card: CastableCard,
  x: number | undefined,
  mode: number | undefined,
  effects: readonly Effect[],
  cap: number,
  castingCostOverride?: readonly CastingCostChoice[],
): Enumerated<Action> {
  const choices = isAuraCard(card)
    ? targetChoicesFor(state, card, player, oid)
    : targetChoicesForEffects(state, effects, player, oid);
  if (!everySlotHasAChoice(choices)) return { items: [], complete: true };
  const targetOptions = cartesian(choices, cap);
  const items: Action[] = [];
  let complete = targetOptions.complete;
  for (const targets of targetOptions.items) {
    if (!honoursDistinctSlots(effects, targets)) continue;
    const minimum = hasPluralTargets(effects) ? minimumPluralChoice(state, effects, player, oid) : null;
    if (hasPluralTargets(effects) && minimum === null) continue;
    const targetCount = countTargetInstances(targets, minimum?.multiTargets);
    const castingCosts = castingCostOverride ?? [
      ...payableCastingCosts(state, player, card, x, targetCount),
      ...(freeCastFromHandPermissionApplies(state, player) && (x === undefined || x === 0)
        ? (['withoutMana'] as const)
        : []),
    ];
    for (const castingCost of castingCosts) {
      const sacrificePayments = spellSacrificePayments(state, player, card, castingCost, cap - items.length);
      if (!sacrificePayments.complete) complete = false;
      const discardPayments = spellDiscardPayments(state, player, oid, card, castingCost, cap - items.length);
      if (!discardPayments.complete) complete = false;
      const namesSacrifice = spellSacrificeRequirement(card, castingCost) !== undefined;
      for (const sacrifices of sacrificePayments.items) {
        for (const discards of discardPayments.items) {
          const namedCastingCost =
            castingCost === 'withoutMana' ||
            card.alternativeCost !== undefined ||
            ((card.kind === 'instant' || card.kind === 'sorcery') && card.overload !== undefined)
              ? castingCost
              : undefined;
          const namedSacrifices = namesSacrifice ? sacrifices : undefined;
          const namedDiscards =
            spellDiscardRequirement(card, castingCost) === undefined ? undefined : discards;
          if (minimum !== null) {
            if (
              validateCast(
                state,
                player,
                oid,
                targets,
                x,
                mode,
                minimum.multiTargets,
                minimum.damageAllocations,
                namedCastingCost,
                sacrifices,
                discards,
              ) !== null
            ) {
              continue;
            }
            items.push(
              buildBeginCastAction(
                player,
                oid,
                targets,
                x,
                mode,
                namedCastingCost,
                namedSacrifices,
                namedDiscards,
              ),
            );
          } else {
            items.push(
              buildCastAction(
                player,
                oid,
                targets,
                x,
                mode,
                undefined,
                undefined,
                namedCastingCost,
                namedSacrifices,
                namedDiscards,
              ),
            );
          }
          if (items.length >= cap) return { items, complete: false };
        }
      }
    }
  }
  return { items, complete };
}

function castOptionsForCard(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  card: CastableCard,
  cap: number,
): Enumerated<Action> {
  if (castTimingError(state, player, oid, card) !== undefined) return { items: [], complete: true };
  const payableXOptions = xOptionsFor(state, player, card, cap);
  const xOptions =
    card.manaCost.hasX &&
    payableXOptions.values.length === 0 &&
    freeCastFromHandPermissionApplies(state, player)
      ? { values: [0] as const, complete: true }
      : payableXOptions;
  const items: Action[] = [];
  let complete = xOptions.complete;
  for (const x of xOptions.values) {
    for (const mode of modeOptionsFor(card)) {
      const effects = spellEffectsFor(card, mode ?? null, 'ordinary');
      const actions = castActionsForMode(state, player, oid, card, x, mode, effects, cap - items.length);
      items.push(...actions.items);
      if (!actions.complete) complete = false;
      if (items.length >= cap) return { items, complete: false };
    }
  }
  if ((card.kind === 'instant' || card.kind === 'sorcery') && card.overload !== undefined) {
    const variable = card.overload.cost.hasX;
    const ceiling = Math.min(MAX_CHOSEN_X, availableMana(state, player));
    const overloadX: readonly (number | undefined)[] = variable
      ? Array.from({ length: ceiling + 1 }, (_, index) => index)
      : [undefined];
    const effects = spellEffectsFor(card, null, 'overload');
    const targets = effects.map(() => null);
    for (const x of overloadX) {
      const action = buildCastAction(
        player,
        oid,
        targets,
        x,
        undefined,
        undefined,
        undefined,
        'overload',
        undefined,
        undefined,
      );
      if (
        validateCast(state, player, oid, targets, x, undefined, undefined, undefined, 'overload') === null
      ) {
        items.push(action);
      }
      if (items.length >= cap) return { items, complete: false };
    }
  }
  return { items, complete };
}

/**
 * Complete declarations for one effect-instructed cast without its mana cost.
 * Timing and mana availability are deliberately absent; targets, modes and
 * mandatory additional sacrifices use the ordinary cast enumerators.
 */
export function freeCastOptionsForCard(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  card: CastableCard,
  cap: number,
): Enumerated<Action> {
  if (cap <= 0) return { items: [], complete: false };
  if (castPermissionError(state, player) !== undefined) return { items: [], complete: true };
  if (cardCastingRestrictionError(state, player, card) !== undefined) return { items: [], complete: true };
  const x = card.manaCost.hasX ? 0 : undefined;
  const items: Action[] = [];
  let complete = true;
  for (const mode of modeOptionsFor(card)) {
    const effects = spellEffectsFor(card, mode ?? null, 'ordinary');
    const actions = castActionsForMode(state, player, oid, card, x, mode, effects, cap - items.length, [
      'withoutMana',
    ]);
    items.push(...actions.items);
    if (!actions.complete) complete = false;
    if (items.length >= cap) return { items, complete: false };
  }
  return { items, complete };
}

/** Resolves one currently valid candidate from an interrupted free-cast instruction. */
export function pendingFreeCastCandidate(
  state: GameState,
  pending: PendingFreeCast,
  oid: ObjectId,
): { readonly card: CastableCard; readonly copy: PendingCardCopyCast | null } | null {
  const object = tryObject(state, oid);
  const copy = pending.copyCandidates?.find((candidate) => candidate.oid === oid);
  if (copy !== undefined) {
    const incarnation = object?.incarnation ?? 0;
    return object?.zone === 'exile' && incarnation === copy.incarnation ? { card: copy.card, copy } : null;
  }
  const original = pending.originalCandidates?.find((candidate) => candidate.oid === oid);
  if (original !== undefined) {
    const incarnation = object?.incarnation ?? 0;
    return object?.zone === 'exile' && incarnation === original.incarnation
      ? { card: original.card, copy: null }
      : null;
  }
  if (pending.oid !== oid || object?.zone !== pending.from) return null;
  const card = pending.card ?? object.card;
  return isCastable(card) ? { card, copy: null } : null;
}

function castOptions(state: GameState, player: PlayerId, cap: number): Enumerated<Action> {
  if (cap < 0) return { items: [], complete: false };
  const limit = cap + 1;
  const items: Action[] = [];
  let complete = true;
  for (const oid of playerOf(state, player).hand) {
    const card = getObject(state, oid).card;
    if (!isCastable(card)) continue;
    const options = castOptionsForCard(state, player, oid, card, limit - items.length);
    items.push(...options.items);
    if (!options.complete) complete = false;
    if (items.length > cap) return { items: items.slice(0, cap), complete: false };
  }
  return { items, complete };
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
 * `cost.sacrificeSelf` and `cost.exileSelf` add no condition of their own, and
 * that is a finding rather than an omission. CR 701.17a lets a player sacrifice
 * any permanent they control, with no further restriction, and CR 701.11a can
 * move the same controlled battlefield source to exile. In either case, "the
 * source-leaving payment is available" is exactly "the source is a permanent
 * this player controls" — which the first two lines below already require of
 * every activation. A separate check here would be a branch nothing can enter.
 * What the two lines gain is weight: they are now the reason either ability can
 * be paid for exactly once, since the source has left the battlefield when the
 * cost is paid and neither `controlledBy` nor this guard will see it again.
 *
 * CR 302.6 is deliberately *not* extended to it. Summoning sickness restricts
 * `{T}` and `{Q}` and nothing else, so a creature that arrived this turn may
 * sacrifice or exile itself for its own ability; hoisting that check out of the
 * tap branch would refuse a legal activation.
 *
 * `cost.sacrificeOther` is the one part of a cost that can be unpayable for a
 * reason the board states rather than the source does, so it is the one that
 * adds a condition here: a player holding one Key cannot open a Chest that
 * costs two. It is checked by counting the permanents that qualify rather than
 * by looking at what the agent offered, because this guard runs before there is
 * an offer — `validateSacrifices` checks the offer itself.
 *
 * A printed `activateOnlyAsSorcery` declaration shares the same predicate as
 * equip and loyalty abilities. It lives on the full engine ability only, so
 * adding scavenge does not teach the set generator a new timing lever.
 */
function canonicalCardName(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}

/** Whether a live retained-name rule prohibits this particular non-mana ability. */
function chosenNameActivationIsProhibited(
  state: GameState,
  oid: ObjectId,
  ability: ActivatedAbility,
): boolean {
  if (isManaAbility(ability)) return false;
  const subjectName = canonicalCardName(nameOf(state, oid));
  return state.battlefield.some((sourceOid) => {
    const chosen = state.objects[sourceOid]?.chosenCardName;
    if (chosen === undefined || canonicalCardName(chosen) !== subjectName) return false;
    return abilitiesOf(state, sourceOid).some(
      (candidate) =>
        candidate.kind === 'staticActivationRule' &&
        candidate.rule === 'chosenNameNonManaAbilitiesCantActivate',
    );
  });
}

function activationProhibitionReason(
  state: GameState,
  oid: ObjectId,
  ability?: ActivatedAbility,
): string | null {
  if (isDetained(state, oid)) {
    return "this permanent is detained and its activated abilities can't be activated";
  }
  if (activatedAbilitiesProhibited(state, oid)) {
    return "this permanent's activated abilities can't be activated";
  }
  return ability !== undefined && chosenNameActivationIsProhibited(state, oid, ability)
    ? "a source with the chosen name can't activate non-mana abilities"
    : null;
}

/** Stack objects that can pay the closed Nivmagus activation cost right now. */
function controlledInstantOrSorcerySpells(state: GameState, player: PlayerId): readonly ObjectId[] {
  return state.stack
    .filter((entry) => {
      if (entry.controller !== player) return false;
      const card = spellCard(state, entry);
      return card?.kind === 'instant' || card?.kind === 'sorcery';
    })
    .map((entry) => entry.oid);
}

function activationBlocker(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  ability: ActivatedAbility,
  abilityIndex?: number,
): string | null {
  const object = tryObject(state, oid);
  if (ability.activationZone === 'graveyard') {
    if (object === undefined || object.zone !== 'graveyard' || object.owner !== player) {
      return 'source is not in your graveyard';
    }
  } else {
    if (object === undefined || object.zone !== 'battlefield') return 'source is not on the battlefield';
    if (controllerOf(state, oid) !== player) return 'you do not control that source';
    const prohibited = activationProhibitionReason(state, oid, ability);
    if (prohibited !== null) return prohibited;
  }
  if (ability.activateOnlyWhileAttacking === true && !isAttacking(state, oid)) {
    return 'this ability can be activated only while its source is attacking';
  }
  if (ability.activateOnlyAsSorcery === true && !atSorcerySpeed(state, player)) {
    return 'this ability can be activated only as a sorcery';
  }
  if (
    ability.activateOnlyOnceEachTurn === true &&
    abilityIndex !== undefined &&
    object.activationLimitedTurns?.[abilityIndex] === state.turn.number
  ) {
    return 'this ability has already been activated this turn';
  }
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
    if (
      !isVariableLoyaltyCost(ability.loyaltyCost) &&
      ability.loyaltyCost < 0 &&
      loyalty + ability.loyaltyCost < 0
    ) {
      return `the loyalty cost removes ${String(-ability.loyaltyCost)} counters and this permanent has ${String(loyalty)}`;
    }
  }
  const removedCounter = ability.cost.removeCounter;
  if (removedCounter !== undefined) {
    const available = counterCount(object.counters, removedCounter.counter);
    if (available < removedCounter.count) {
      return `the cost removes ${String(removedCounter.count)} ${removedCounter.counter} counter and this permanent has ${String(available)}`;
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
  if (ability.cost.payLife !== undefined && playerOf(state, player).life < ability.cost.payLife) {
    return `you cannot pay ${String(ability.cost.payLife)} life`;
  }
  if (
    ability.cost.exileControlledInstantOrSorcerySpell === true &&
    controlledInstantOrSorcerySpells(state, player).length === 0
  ) {
    return 'the cost needs an instant or sorcery spell you control on the stack';
  }
  const sacrifice = sacrificeCostOf(ability);
  if (sacrifice !== undefined) {
    if (sacrifice.kind === 'landSubtypePair') {
      if (sacrificePayments(state, player, oid, ability, 1).items.length === 0) {
        return `the cost needs one ${sacrifice.subtypes[0]} and one ${sacrifice.subtypes[1]} permanent you control`;
      }
    } else {
      const available = sacrificeCandidates(state, player, oid, ability).length;
      if (available < sacrifice.count) {
        return sacrifice.kind === 'other'
          ? `you control ${available} ${sacrifice.subtype} permanents and the cost sacrifices ${sacrifice.count}`
          : `you control ${available} matching permanents and the cost sacrifices ${sacrifice.count}`;
      }
    }
  }
  const tapMatching = ability.cost.tapMatching;
  if (tapMatching !== undefined) {
    const available = tapMatchingCandidates(state, player, oid, ability).length;
    if (available < tapMatching.count) {
      return `you control ${available} untapped matching permanents and the cost taps ${tapMatching.count}`;
    }
  }
  // CR 601.2h: a cost is paid in full or the activation is rewound, and CR
  // 701.8a's "as many as possible" is about an *effect* rather than a cost. So
  // a hand short of the number cannot pay at all — this is the one place the
  // two discards differ in arithmetic, and reading the effect's clamp here
  // would let a player activate for free with an empty hand.
  const discard = ability.cost.discard;
  const discardMatching = ability.cost.discardMatching;
  if (discard !== undefined || discardMatching !== undefined) {
    const eligible = discardCandidates(state, player, ability);
    const wanted = discard ?? discardMatching?.count ?? 0;
    const hasPayment =
      discardMatching === undefined || discardPayments(state, player, ability, 1).items.length > 0;
    if (eligible.length < wanted || !hasPayment) {
      if (discardMatching !== undefined) {
        return 'the cost discards two nonland cards with the same name and you hold no eligible pair';
      }
      return ability.cost.discardFilter === undefined
        ? `the cost discards ${String(wanted)} and you hold ${String(eligible.length)}`
        : `the cost discards ${String(wanted)} matching cards and you hold ${String(eligible.length)} eligible cards`;
    }
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
 * The permanents a chosen sacrifice cost could eat right now.
 *
 * CR 701.17a: a player may sacrifice a permanent they control, and nothing
 * else. The subtype is read through `hasSubtype`, which is layer-aware, so a
 * Key that a CR 613 layer-4 effect turned into a Wall stops paying for Chests
 * while it is one. `source` is excluded because the field is named for what it
 * is: `sacrificeSelf` is the source's own payment and this is everything else,
 * and letting a Chest count itself as a Key would let a one-Key cost be paid
 * with no Key at all.
 */
type SacrificeCost =
  | {
      readonly kind: 'other';
      readonly count: number;
      readonly subtype: string;
    }
  | {
      readonly kind: 'matching';
      readonly count: number;
      readonly filter: NonNullable<ActivatedAbility['cost']['sacrificeMatching']>['filter'];
      readonly excludeSource?: true;
    }
  | {
      readonly kind: 'landSubtypePair';
      readonly count: 2;
      readonly subtypes: readonly [string, string];
    };

/** The one chosen-permanent sacrifice predicate a validated ability carries. */
function sacrificeCostOf(ability: ActivatedAbility): SacrificeCost | undefined {
  if (ability.cost.sacrificeLandSubtypePair !== undefined) {
    return { kind: 'landSubtypePair', count: 2, subtypes: ability.cost.sacrificeLandSubtypePair };
  }
  if (ability.cost.sacrificeMatching !== undefined) {
    const { excludeSource, ...matching } = ability.cost.sacrificeMatching;
    return { kind: 'matching', ...matching, ...(excludeSource === true ? { excludeSource: true } : {}) };
  }
  if (ability.cost.sacrificeOther !== undefined) {
    return { kind: 'other', ...ability.cost.sacrificeOther };
  }
  return undefined;
}

function sacrificeCandidates(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  ability: ActivatedAbility,
): readonly ObjectId[] {
  const sacrifice = sacrificeCostOf(ability);
  if (sacrifice === undefined) return [];
  return sacrifice.kind === 'other'
    ? state.battlefield.filter(
        (oid) =>
          oid !== source && controllerOf(state, oid) === player && hasSubtype(state, oid, sacrifice.subtype),
      )
    : sacrifice.kind === 'matching'
      ? matchingPermanentCandidates(state, player, sacrifice).filter(
          (oid) => sacrifice.excludeSource !== true || oid !== source,
        )
      : state.battlefield.filter(
          (oid) =>
            controllerOf(state, oid) === player &&
            sacrifice.subtypes.some((subtype) => hasSubtype(state, oid, subtype)),
        );
}

type MatchingPermanentCost = NonNullable<ActivatedAbility['cost']['sacrificeMatching']>;

/** Current-characteristic controlled candidates shared by sacrifice and tap cohorts. */
function matchingPermanentCandidates(
  state: GameState,
  player: PlayerId,
  cost: MatchingPermanentCost,
): readonly ObjectId[] {
  return state.battlefield.filter(
    (oid) =>
      controllerOf(state, oid) === player &&
      (cost.nontoken !== true || state.objects[oid]?.token === false) &&
      satisfiesTargetFilter(state, oid, cost.filter),
  );
}

function tapMatchingCandidates(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  ability: ActivatedAbility,
): readonly ObjectId[] {
  const cost = ability.cost.tapMatching;
  if (cost === undefined) return [];
  return matchingPermanentCandidates(state, player, cost).filter(
    (oid) => (!ability.cost.tapSelf || oid !== source) && !getObject(state, oid).tapped,
  );
}

/** The set rules common to every chosen-permanent activation payment. */
function validateDistinctChosenPermanents(
  offered: readonly ObjectId[],
  eligible: ReadonlySet<ObjectId>,
  invalid: (oid: ObjectId) => string,
): string | null {
  const seen = new Set<ObjectId>();
  for (const oid of offered) {
    if (seen.has(oid)) return `${oid} was offered twice`;
    seen.add(oid);
    if (!eligible.has(oid)) return invalid(oid);
  }
  return null;
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
  const sacrifice = sacrificeCostOf(ability);
  const wanted = sacrifice?.count ?? 0;
  if (offered.length !== wanted) {
    if (sacrifice === undefined) return `this ability sacrifices nothing, and ${offered.length} was offered`;
    return sacrifice.kind === 'other'
      ? `the cost sacrifices ${wanted} ${sacrifice.subtype} permanents, and ${offered.length} was offered`
      : sacrifice.kind === 'matching'
        ? `the cost sacrifices ${wanted} matching permanents, and ${offered.length} was offered`
        : `the cost sacrifices one ${sacrifice.subtypes[0]} and one ${sacrifice.subtypes[1]}, and ${offered.length} was offered`;
  }
  if (sacrifice === undefined) return null;
  if (sacrifice.kind === 'landSubtypePair') {
    const distinct = validateDistinctChosenPermanents(
      offered,
      new Set(sacrificeCandidates(state, player, source, ability)),
      (oid) => `${oid} is not a ${sacrifice.subtypes[0]} or ${sacrifice.subtypes[1]} permanent you control`,
    );
    if (distinct !== null) return distinct;
    const [first, second] = offered;
    if (first === undefined || second === undefined) return 'the land-subtype pair is incomplete';
    const direct =
      hasSubtype(state, first, sacrifice.subtypes[0]) && hasSubtype(state, second, sacrifice.subtypes[1]);
    const reversed =
      hasSubtype(state, first, sacrifice.subtypes[1]) && hasSubtype(state, second, sacrifice.subtypes[0]);
    return direct || reversed
      ? null
      : `the cost needs one ${sacrifice.subtypes[0]} and one ${sacrifice.subtypes[1]}`;
  }
  const eligible = new Set(sacrificeCandidates(state, player, source, ability));
  return validateDistinctChosenPermanents(offered, eligible, (oid) =>
    sacrifice.kind === 'other'
      ? `${oid} is not a ${sacrifice.subtype} permanent you control`
      : `${oid} does not match a permanent you control permitted by this sacrifice cost`,
  );
}

function validateTapMatching(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  ability: ActivatedAbility,
  offered: readonly ObjectId[] | undefined,
): string | null {
  const cost = ability.cost.tapMatching;
  if (cost === undefined) {
    return offered === undefined ? null : 'this ability has no matching tap cost, and a tap list was offered';
  }
  if (offered === undefined) return `the cost taps ${cost.count} matching permanents, and none were offered`;
  if (offered.length !== cost.count) {
    return `the cost taps ${cost.count} matching permanents, and ${offered.length} were offered`;
  }
  const eligible = new Set(tapMatchingCandidates(state, player, source, ability));
  return validateDistinctChosenPermanents(
    offered,
    eligible,
    (oid) => `${oid} is not an untapped matching permanent you control permitted by this tap cost`,
  );
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
  const matching = ability.cost.discardMatching;
  const wanted = ability.cost.discard ?? matching?.count ?? 0;
  if (offered.length !== wanted) {
    if (ability.cost.discard === undefined && matching === undefined) {
      return `this ability discards nothing, and ${offered.length} was offered`;
    }
    return `the cost discards ${wanted} cards, and ${offered.length} was offered`;
  }
  const hand = new Set(playerOf(state, player).hand);
  const eligible = new Set(discardCandidates(state, player, ability));
  const seen = new Set<ObjectId>();
  for (const oid of offered) {
    if (seen.has(oid)) return `${oid} was offered twice`;
    seen.add(oid);
    if (!hand.has(oid)) return `${oid} is not in your hand`;
    if (!eligible.has(oid)) return `${oid} does not match the discard filter`;
  }
  if (matching !== undefined) {
    const names = offered.map((oid) => getObject(state, oid).card.name);
    if (new Set(names).size !== 1) return 'the discarded cards do not have the same name';
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
  const sources = [...controlledBy(state, player), ...playerOf(state, player).graveyard];
  for (const oid of sources) {
    const abilities = abilitiesOf(state, oid);
    for (const [abilityIndex, ability] of abilities.entries()) {
      if (ability.kind !== 'activated') continue;
      // CR 605.3a: a mana ability does not use the stack, so it is never an
      // `activateAbility`. `manaAbilityOptions` offers it instead, once per
      // color it can make. Without this line the same printed ability would be
      // offered twice under two action types, and the `activateAbility` copy
      // would push it onto the stack.
      if (isManaAbility(ability)) continue;
      if (activationBlocker(state, player, oid, ability, abilityIndex) !== null) continue;
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
  const variableLoyalty = ability.loyaltyCost !== undefined && isVariableLoyaltyCost(ability.loyaltyCost);
  if (!ability.cost.mana.hasX && !variableLoyalty) {
    return { items: [undefined], complete: true };
  }
  const excluded = ability.cost.tapSelf ? [oid] : [];
  let max = MAX_CHOSEN_X;
  if (ability.cost.mana.hasX) {
    const ceiling = availableMana(state, player);
    let maxPayable: number | null = null;
    for (let x = ceiling; x >= 0; x -= 1) {
      if (canPay(state, player, resolveX(ability.cost.mana, x), excluded)) {
        maxPayable = x;
        break;
      }
    }
    if (maxPayable === null) return { items: [], complete: true };
    max = Math.min(max, maxPayable);
  }
  if (variableLoyalty) {
    max = Math.min(max, counterCount(getObject(state, oid).counters, 'loyalty'));
  }
  const bounded = Math.min(max, cap);
  return {
    items: Array.from({ length: bounded + 1 }, (_, index) => index),
    complete: bounded === max,
  };
}

/**
 * Every activation of one current ability: every target tuple against every
 * legal payment plan.
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
  const payments = activationPayments(state, player, oid, ability, cap);
  const options: Action[] = [];
  let complete = payments.complete;
  const modes = ability.modes === undefined ? [undefined] : ability.modes.map((_mode, index) => index);
  for (const mode of modes) {
    const effects = effectsForActivatedAbility(ability, mode ?? null);
    const combos =
      ability.cost.exileControlledInstantOrSorcerySpell === true
        ? {
            items: controlledInstantOrSorcerySpells(state, player).map((spell): readonly Target[] => [
              { kind: 'spell', oid: spell },
            ]),
            complete: true,
          }
        : cartesian(targetChoicesForActivation(state, ability, player, oid, mode ?? null), cap);
    if (!combos.complete) complete = false;
    const plural = hasPluralTargets(effects);
    const minimum = plural ? minimumPluralChoice(state, effects, player, oid) : null;
    if (plural && minimum === null) continue;
    for (const targets of combos.items) {
      // Each slot was enumerated independently, so reject repeated targets for
      // effect positions that declare themselves distinct.
      if (!honoursDistinctSlots(effects, targets)) continue;
      for (const payment of payments.items) {
        if (options.length >= cap) return { items: options, complete: false };
        options.push(
          buildActivationAction(player, oid, abilityIndex, targets, payment.sacrifices, {
            taps: ability.cost.tapMatching === undefined ? undefined : payment.taps,
            discards:
              ability.cost.discard === undefined && ability.cost.discardMatching === undefined
                ? undefined
                : payment.discards,
            x: payment.x,
            mode,
          }),
        );
      }
    }
  }
  return { items: options, complete };
}

interface ActivationPayment {
  readonly sacrifices: readonly ObjectId[];
  readonly taps: readonly ObjectId[];
  readonly discards: readonly ObjectId[];
  readonly x: number | undefined;
}

/** The payable product of every chosen activation-cost dimension. */
function activationPayments(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  ability: ActivatedAbility,
  cap: number,
): Enumerated<ActivationPayment> {
  const sacrifices = sacrificePayments(state, player, oid, ability, cap);
  const taps = matchingTapPayments(state, player, oid, ability, cap);
  const discards = discardPayments(state, player, ability, cap);
  const xValues = activationXOptions(state, player, oid, ability, cap);
  const items: ActivationPayment[] = [];
  for (const sacrifice of sacrifices.items) {
    for (const tap of taps.items) {
      for (const discard of discards.items) {
        for (const x of xValues.items) {
          const excluded = [...(ability.cost.tapSelf ? [oid] : []), ...tap];
          if (!canPay(state, player, resolveX(ability.cost.mana, x ?? 0), excluded)) continue;
          if (items.length >= cap) return { items, complete: false };
          items.push({ sacrifices: sacrifice, taps: tap, discards: discard, x });
        }
      }
    }
  }
  return {
    items,
    complete: sacrifices.complete && taps.complete && discards.complete && xValues.complete,
  };
}

/**
 * Builds one `activateAbility` action.
 *
 * `buildCastAction` one card type out, and it exists for the same reason that
 * one does: `taps`, `discards`, and `x` are independently optional and
 * `exactOptionalPropertyTypes` forbids writing `undefined` into any slot, so
 * each is folded in through a conditional spread that omits the key.
 *
 * All three slots arrive as "present or `undefined`" and the caller decides which.
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
  optional: {
    readonly taps: readonly ObjectId[] | undefined;
    readonly discards: readonly ObjectId[] | undefined;
    readonly x: number | undefined;
    readonly mode: number | undefined;
  },
): Action {
  return {
    type: 'activateAbility',
    player,
    oid,
    abilityIndex,
    targets,
    sacrifices,
    ...(optional.taps !== undefined ? { taps: optional.taps } : {}),
    ...(optional.discards !== undefined ? { discards: optional.discards } : {}),
    ...(optional.x !== undefined ? { x: optional.x } : {}),
    ...(optional.mode !== undefined ? { mode: optional.mode } : {}),
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
  const sacrifice = sacrificeCostOf(ability);
  if (sacrifice === undefined) return { items: [[]], complete: true };
  if (sacrifice.kind === 'landSubtypePair') {
    const left = state.battlefield.filter(
      (candidate) =>
        controllerOf(state, candidate) === player && hasSubtype(state, candidate, sacrifice.subtypes[0]),
    );
    const right = state.battlefield.filter(
      (candidate) =>
        controllerOf(state, candidate) === player && hasSubtype(state, candidate, sacrifice.subtypes[1]),
    );
    const items: ObjectId[][] = [];
    const seen = new Set<string>();
    let complete = true;
    for (const first of left) {
      for (const second of right) {
        if (first === second) continue;
        const pair = [first, second].sort();
        const key = pair.join('\0');
        if (seen.has(key)) continue;
        seen.add(key);
        if (items.length >= cap) {
          complete = false;
          continue;
        }
        items.push(pair);
      }
    }
    return { items, complete };
  }
  const candidates = sacrificeCandidates(state, player, oid, ability);
  return combinations(candidates, sacrifice.count, cap);
}

function matchingTapPayments(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  ability: ActivatedAbility,
  cap: number,
): Enumerated<readonly ObjectId[]> {
  const cost = ability.cost.tapMatching;
  if (cost === undefined) return { items: [[]], complete: true };
  return combinations(tapMatchingCandidates(state, player, oid, ability), cost.count, cap);
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
  const matching = ability.cost.discardMatching;
  const discard = ability.cost.discard ?? matching?.count;
  if (discard === undefined) return { items: [[]], complete: true };
  const candidates = discardCandidates(state, player, ability);
  if (matching === undefined) return combinations(candidates, discard, cap);

  // Group before applying the cap. Filtering the first `cap` combinations
  // afterwards can discard every returned cross-name pair even when a legal
  // pair occurs later in hand order, making legality depend on hand order.
  const byName = new Map<string, ObjectId[]>();
  for (const oid of candidates) {
    const name = getObject(state, oid).card.name;
    const group = byName.get(name);
    if (group === undefined) byName.set(name, [oid]);
    else group.push(oid);
  }
  const items: Array<readonly ObjectId[]> = [];
  for (const group of byName.values()) {
    if (group.length < discard) continue;
    if (items.length >= cap) return { items, complete: false };
    const payments = combinations(group, discard, cap - items.length);
    items.push(...payments.items);
    if (!payments.complete) return { items, complete: false };
  }
  return { items, complete: true };
}

/** Cards in the activator's hand that the printed discard cost permits. */
function discardCandidates(
  state: GameState,
  player: PlayerId,
  ability: ActivatedAbility,
): readonly ObjectId[] {
  const hand = playerOf(state, player).hand;
  if (ability.cost.discardMatching !== undefined) {
    return selectPrintedByCardFilter(state, hand, { excludeCardTypes: ['land'] });
  }
  const filter = ability.cost.discardFilter;
  return filter === undefined ? hand : selectPrintedByCardFilter(state, hand, filter);
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
function indexedManaAbilities(
  state: GameState,
  oid: ObjectId,
): readonly { readonly ability: ActivatedAbility; readonly index: number }[] {
  return abilitiesOf(state, oid).flatMap((ability, index) =>
    ability.kind === 'activated' && isManaAbility(ability) ? [{ ability, index }] : [],
  );
}

function manaAbilityColors(ability: ActivatedAbility): readonly ManaColor[] {
  return ability.effects.flatMap((effect) => (effect.kind === 'addMana' ? effect.produces : []));
}

function fixedManaAbilityAmount(ability: ActivatedAbility): number | undefined {
  const effect = ability.effects[0];
  return effect?.kind === 'addMana' && typeof effect.amount === 'number' ? effect.amount : undefined;
}

/** The canonical Lantern grant, whose choices subsume a basic land's intrinsic one. */
function isUnrestrictedAnyColorTapAbility(ability: ActivatedAbility): boolean {
  const effect = ability.effects[0];
  const cost = ability.cost;
  return (
    ability.effects.length === 1 &&
    effect?.kind === 'addMana' &&
    effect.amount === 1 &&
    effect.produces.join('') === 'WUBRG' &&
    cost.tapSelf &&
    !cost.sacrificeSelf &&
    !cost.mana.hasX &&
    manaValue(cost.mana) === 0 &&
    cost.printedManaPips === undefined &&
    cost.payLife === undefined &&
    cost.exileSelf === undefined &&
    cost.sacrificeOther === undefined &&
    cost.sacrificeMatching === undefined &&
    cost.sacrificeLandSubtypePair === undefined &&
    cost.tapMatching === undefined &&
    cost.discard === undefined &&
    cost.discardFilter === undefined &&
    cost.discardMatching === undefined &&
    cost.removeCounter === undefined &&
    ability.attach === undefined &&
    ability.loyaltyCost === undefined &&
    ability.regenerateSelf === undefined &&
    ability.activateOnlyWhileAttacking === undefined &&
    ability.activateOnlyAsSorcery === undefined &&
    ability.activationZone === undefined &&
    ability.modes === undefined &&
    ability.counterTargetSpellUnless === undefined
  );
}

function manaSourceBlocker(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  abilityIndex?: number,
): string | null {
  const object = tryObject(state, oid);
  if (object === undefined || object.zone !== 'battlefield') return 'source is not on the battlefield';
  // Layer-aware, to agree with `controlledBy`, which is what enumerates these
  // actions. Reading the raw `controller` field here let the previous
  // controller of a control-changed permanent keep tapping it.
  if (controllerOf(state, oid) !== player) return 'you do not control that source';
  const indexed = indexedManaAbilities(state, oid);
  if (abilityIndex !== undefined) {
    const selected = indexed.find((entry) => entry.index === abilityIndex);
    return selected === undefined
      ? 'that slot is not a mana ability'
      : activationBlocker(state, player, oid, selected.ability, selected.index);
  }
  const intrinsic = landProducesOnBattlefield(state, oid);
  if (intrinsic.length === 0 && indexed.length === 1) {
    return activationBlocker(state, player, oid, indexed[0]!.ability, indexed[0]!.index);
  }
  // A printed mana ability went through the ordinary activation gate above.
  // Lands reach mana actions through this intrinsic route instead.
  const prohibited = activationProhibitionReason(state, oid);
  if (prohibited !== null) return prohibited;
  if (intrinsic.length === 0) return 'that source has no unambiguous mana ability';
  if (object.tapped) return 'source is already tapped';
  return null;
}

function manaAbilityOptions(state: GameState, player: PlayerId): readonly Action[] {
  const options: Action[] = [];
  for (const oid of controlledBy(state, player)) {
    const intrinsic = landProducesOnBattlefield(state, oid);
    const indexed = indexedManaAbilities(state, oid);
    const anyColor = indexed.find(
      ({ ability, index }) =>
        isUnrestrictedAnyColorTapAbility(ability) && manaSourceBlocker(state, player, oid, index) === null,
    );
    if (intrinsic.length > 0 && manaSourceBlocker(state, player, oid) === null) {
      for (const color of intrinsic) {
        if (anyColor === undefined || !manaAbilityColors(anyColor.ability).includes(color)) {
          options.push({ type: 'activateManaAbility', player, oid, color });
        }
      }
    }
    for (const { ability, index } of indexed) {
      if (isUnrestrictedAnyColorTapAbility(ability) && index !== anyColor?.index) continue;
      if (manaSourceBlocker(state, player, oid, index) !== null) continue;
      const abilityIndex = intrinsic.length === 0 && indexed.length === 1 ? undefined : index;
      const amount = fixedManaAbilityAmount(ability);
      for (const color of manaAbilityColors(ability)) {
        options.push({
          type: 'activateManaAbility',
          player,
          oid,
          color,
          ...(abilityIndex === undefined ? {} : { abilityIndex }),
          ...(amount === undefined || amount === 1 ? {} : { amount }),
        });
      }
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
  // attack (unlike menace's contention over *which blocker*). The independent
  // cohort restriction still needs `attacksCompletable` before a prefix is
  // offered, because a lone Mogg must retain a route to a companion.
  //
  // A turn-scoped `attacksYouThisTurnIfAble` rides the same filter and adds the
  // one thing the static does not: it narrows *which* defender, so it is read
  // per creature through `attackRequirement` rather than as a flat list.
  const required = new Map(rest.map((oid) => [oid, attackRequirement(state, oid, defenders)] as const));
  const globallyRequired = requiredAttackers(state, eligible, defenders);
  const mustAttack = rest.filter((oid) => globallyRequired.has(oid));
  const options: Action[] = [];
  let listable = true;
  if (defenders.length === 1) {
    const enumerated = subsets(rest, cap);
    listable = enumerated.complete;
    if (listable) {
      for (const chosen of enumerated.items) {
        if (mustAttack.some((oid) => !chosen.includes(oid))) continue;
        if (attackCohortRestriction(state, [...fixed.map((attack) => attack.oid), ...chosen]) !== null)
          continue;
        const attackers = [
          ...fixed,
          ...chosen.map((oid): AttackDeclaration => ({ oid, defender: playerDefender })),
        ];
        if (!canPayAttackTaxes(state, player, attackers)) continue;
        options.push({
          type: 'declareAttackers',
          player,
          attackers,
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
        if (
          attackCohortRestriction(
            state,
            attackers.map((attack) => attack.oid),
          ) !== null
        )
          continue;
        if (!canPayAttackTaxes(state, player, attackers)) continue;
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
    options: listable
      ? options
      : nextAttackerOptions(state, eligible, fixed, defenders, settled, player, globallyRequired),
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
  required: ReadonlySet<ObjectId>,
): readonly Action[] {
  const asking = eligible[settled];
  // Unreachable: the caller is here because the remaining space did not fit
  // under the cap, and an empty remainder enumerates to one.
  if (asking === undefined) throw new Error('attackerDecision: no creature is left to ask about');
  const options: Action[] = [];
  const requirement = attackRequirement(state, asking, defenders);
  const later = eligible.slice(settled + 1);
  if (
    !required.has(asking) &&
    canPayAttackTaxes(state, player, fixed) &&
    attacksCompletable(
      state,
      fixed.map((attack) => attack.oid),
      later,
      required,
    )
  ) {
    options.push({ type: 'declareAttackers', player, attackers: fixed, settled: settled + 1 });
  }
  for (const target of requirement.allowed) {
    const attackers = [...fixed, { oid: asking, defender: target }];
    if (!canPayAttackTaxes(state, player, attackers)) continue;
    if (
      !attacksCompletable(
        state,
        attackers.map((attack) => attack.oid),
        later,
        required,
      )
    )
      continue;
    options.push({
      type: 'declareAttackers',
      player,
      attackers,
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
    if (blockable.length > 0) {
      candidates.push({
        blocker,
        capacity: canBlockAnyNumber(state, blocker) ? 'any' : 'one',
        attackers: blockable,
      });
    }
  }
  const settled = state.combat.blocksSettled ?? 0;
  const attackerChoicesSettled = state.combat.blockerAttacksSettled ?? 0;
  const fixed = declaredBlocks(state);
  const perBlockerChoices = perBlocker.map((blockable, index): Enumerated<readonly ObjectId[]> => {
    const blocker = eligible[index];
    if (blocker !== undefined && canBlockAnyNumber(state, blocker)) return subsets(blockable, cap);
    return { items: [[], ...blockable.map((attacker) => [attacker])], complete: true };
  });
  // CR 509.1c: `target` is the joint maximum across attackers that must be
  // blocked and blockers that must participate. Competing families share the
  // same blocker capacity, and menace contributes only when its whole legal
  // group is possible, so the ceiling is computed once over the eligible pool.
  const requirements = blockRequirements(state);
  const target = maximizeBlockRequirements(state, requirements, eligible).coverage;
  const currentBlocker = eligible[settled];
  const currentBlockable = perBlocker[settled] ?? [];
  const currentSubsets = subsets(currentBlockable, cap);
  const sequenceUnlimited =
    currentBlocker !== undefined &&
    canBlockAnyNumber(state, currentBlocker) &&
    (attackerChoicesSettled > 0 || !currentSubsets.complete);
  if (sequenceUnlimited) {
    return {
      kind: 'declareBlockers',
      player,
      attackers,
      eligible,
      candidates,
      options: nextUnlimitedBlockerOptions(
        state,
        eligible,
        currentBlockable,
        fixed,
        settled,
        attackerChoicesSettled,
        player,
        requirements,
        target,
      ),
      complete: true,
    };
  }
  const enumerated = cartesian<readonly ObjectId[]>(
    perBlockerChoices.slice(settled).map((entry) => entry.items),
    cap,
  );
  const options: Action[] = [];
  if (enumerated.complete && perBlockerChoices.slice(settled).every((entry) => entry.complete)) {
    for (const assignments of enumerated.items) {
      const blocks: BlockDeclaration[] = [...fixed];
      for (const [index, attackersForBlocker] of assignments.entries()) {
        const blocker = eligible[settled + index];
        if (blocker === undefined) continue;
        for (const attacker of attackersForBlocker) blocks.push({ blocker, attacker });
      }
      if (validateBlocks(state, opponentOf(state.turn.active), blocks) !== null) continue;
      if (blockRequirementCoverage(state, blocks, requirements) < target) continue;
      options.push({ type: 'declareBlockers', player, blocks });
    }
    if (options.length === 0) options.push({ type: 'declareBlockers', player, blocks: fixed });
  } else {
    options.push(
      ...nextBlockerOptions(state, eligible, perBlockerChoices, fixed, settled, player, requirements, target),
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
 * One yes/no attacker choice inside an unlimited-capacity blocker's subset.
 *
 * A ten-attacker subset has 1,024 members and therefore cannot be an option
 * rail under the shipped cap. Asking the same mathematical subset one member
 * at a time keeps every member reachable with two options per step. The action
 * repeats the chosen pairs; `attackerChoicesSettled` records the declined
 * members that no pair can otherwise represent.
 */
function nextUnlimitedBlockerOptions(
  state: GameState,
  eligible: readonly ObjectId[],
  blockable: readonly ObjectId[],
  fixed: readonly BlockDeclaration[],
  settled: number,
  attackerChoicesSettled: number,
  player: PlayerId,
  requirements: ReturnType<typeof blockRequirements>,
  target: number,
): readonly Action[] {
  const blocker = eligible[settled];
  const attacker = blockable[attackerChoicesSettled];
  if (blocker === undefined || attacker === undefined) {
    throw new Error('blockerDecision: no unlimited blocker choice is left to ask about');
  }
  const nextAttacker = attackerChoicesSettled + 1;
  const blockerFinished = nextAttacker === blockable.length;
  const nextSettled = blockerFinished ? settled + 1 : settled;
  const available = blockerFinished ? eligible.slice(nextSettled) : [blocker, ...eligible.slice(settled + 1)];
  const options: Action[] = [];
  for (const include of [false, true]) {
    const blocks = include ? [...fixed, { blocker, attacker }] : fixed;
    if (!blockRequirementsReachable(state, blocks, requirements, target, available)) continue;
    options.push({
      type: 'declareBlockers',
      player,
      blocks,
      settled: nextSettled,
      ...(blockerFinished ? {} : { attackerChoicesSettled: nextAttacker }),
    });
  }
  return options;
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
 * A prefix is offered only when some complete legal declaration extends it.
 * Menace can make a partial block a dead end, and the
 * cohort restriction can require a distinct companion, so an option that cannot
 * be completed is a trap the whole contract forbids — `checkBackend` plays a
 * game by taking `options[0]` and files a finding when an offered move is
 * refused. Refusing at the offer needs no new player-facing state or refusal
 * path, and the final filter uses canonical whole-declaration validation.
 *
 * `blockRequirementsReachable` owns both halves of that completion: declaration
 * legality for partial menace/cohort groups and CR 509.1c's precomputed joint
 * maximum. Keeping one solver seam prevents those answers from drifting.
 */
function nextBlockerOptions(
  state: GameState,
  eligible: readonly ObjectId[],
  perBlocker: readonly Enumerated<readonly ObjectId[]>[],
  fixed: readonly BlockDeclaration[],
  settled: number,
  player: PlayerId,
  requirements: ReturnType<typeof blockRequirements>,
  target: number,
): readonly Action[] {
  const asking = eligible[settled];
  // Unreachable: the caller is here because the remaining product did not fit
  // under the cap, and an empty remainder enumerates to one.
  if (asking === undefined) throw new Error('blockerDecision: no creature is left to ask about');
  const later = eligible.slice(settled + 1);
  const options: Action[] = [];
  for (const selection of perBlocker[settled]?.items ?? [[]]) {
    const blocks = [...fixed, ...selection.map((attacker) => ({ blocker: asking, attacker }))];
    if (!blockRequirementsReachable(state, blocks, requirements, target, later)) continue;
    options.push({ type: 'declareBlockers', player, blocks, settled: settled + 1 });
  }
  return options;
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

/** CR 509.3's blocker-to-attacker damage order, symmetric with CR 509.2. */
function attackerOrderDecision(state: GameState, player: PlayerId, cap: number): Decision {
  const blocks = blockersNeedingAttackerOrder(state);
  const settled = state.combat.attackersOrdered ?? {};
  const classes = blocks.map((block) => damageOrderClasses(state, block.attackers));
  const fixed = blocks.map((block) => block.attackers.slice(0, settled[block.blocker] ?? 0));
  const rest = blocks.map((block) => block.attackers.slice(settled[block.blocker] ?? 0));
  const perBlocker = rest.map((remaining, index) =>
    distinctPermutations(remaining, (attacker) => classes[index]?.get(attacker) ?? attacker, cap),
  );
  const product = cartesian(
    perBlocker.map((entry) => entry.items),
    cap,
  );
  const listable = product.complete && perBlocker.every((entry) => entry.complete);
  const options = listable
    ? product.items.map((orders): Action => ({
        type: 'orderAttackers',
        player,
        orders: orders.map((attackers, index) => ({
          blocker: blocks[index]?.blocker ?? '',
          attackers: [...(fixed[index] ?? []), ...attackers],
        })),
      }))
    : nextAttackerPositionOptions(blocks, fixed, rest, perBlocker, classes, player);
  return { kind: 'orderAttackers', player, blocks, options, complete: true };
}

function nextAttackerPositionOptions(
  blocks: readonly AttackerOrder[],
  fixed: readonly (readonly ObjectId[])[],
  rest: readonly (readonly ObjectId[])[],
  perBlocker: readonly Enumerated<readonly ObjectId[]>[],
  classes: readonly ReadonlyMap<ObjectId, string>[],
  player: PlayerId,
): readonly Action[] {
  const asking = perBlocker.findIndex((entry) => !entry.complete || entry.items.length > 1);
  const block = blocks[asking];
  const remaining = rest[asking];
  if (block === undefined || remaining === undefined) {
    throw new Error('attackerOrderDecision: no blocker has an ordering left to ask about');
  }
  const keyOf = (attacker: ObjectId): string => classes[asking]?.get(attacker) ?? attacker;
  const offered = new Set<string>();
  const options: Action[] = [];
  for (const attacker of remaining) {
    const key = keyOf(attacker);
    if (offered.has(key)) continue;
    offered.add(key);
    options.push({
      type: 'orderAttackers',
      player,
      orders: [{ blocker: block.blocker, attackers: [...(fixed[asking] ?? []), attacker] }],
    });
  }
  return options;
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
  if (decision.kind === 'orderBlockers') {
    return decision.options.some((option) => {
      if (option.type !== 'orderBlockers') return true;
      return decision.blocks.some((block) => {
        const entry = option.orders.find((order) => order.attacker === block.attacker);
        return entry === undefined || entry.blockers.length < block.blockers.length;
      });
    });
  }
  if (decision.kind !== 'orderAttackers') return false;
  return decision.options.some((option) => {
    if (option.type !== 'orderAttackers') return true;
    return decision.blocks.some((block) => {
      const entry = option.orders.find((order) => order.blocker === block.blocker);
      return entry === undefined || entry.attackers.length < block.attackers.length;
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
  const player = stackEntryTargetingController(state, pending.entry);
  const effects = pending.ability.effects;
  const settled = pending.entry.targets;
  const choices = triggerTargetChoices(state, pending);
  if (hasPluralTargets(effects)) {
    const ordinary = cartesian(choices, cap);
    const options = ordinary.items.flatMap((targets): Action[] =>
      honoursDistinctSlots(effects, targets)
        ? [{ type: 'chooseTriggerTargets', player, oid: pending.entry.oid, targets }]
        : [],
    );
    return {
      kind: 'triggerTargets',
      player,
      oid: pending.entry.oid,
      source: pending.source,
      abilityIndex: pending.index,
      options,
      complete: ordinary.complete,
    };
  }
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
 * Answer a triggered ability's yes/no resolution choice.
 *
 * Ordinary CR 603.3b optional triggers offer both answers in this order. A paid
 * optional trigger whose controller cannot currently pay offers decline alone:
 * the permission remains optional, while an impossible payment is not a legal
 * action. Faerie Impostor's answer instead chooses whether to pay its return
 * cost; accepting is omitted when no other controlled creature can pay it.
 * `complete` is unconditionally true because no enumeration cap can bite on
 * either list.
 */
function optionalTriggerDecision(state: GameState, pending: TriggerOnStack): Decision {
  const player =
    pending.ability.kind === 'triggered' &&
    pending.ability.opponentMaySacrificeCreatureThenTapAndCounterSelf === true
      ? opponentOf(pending.entry.controller)
      : pending.entry.controller;
  const oid = pending.entry.oid;
  const payment =
    pending.ability.kind === 'triggered' ? pending.ability.optionalControllerPayment : undefined;
  return {
    kind: 'optionalTrigger',
    player,
    oid,
    source: pending.source,
    abilityIndex: pending.index,
    targets: pending.entry.targets,
    options:
      payment === undefined || canPay(state, player, payment.cost)
        ? [
            { type: 'answerOptionalTrigger', player, oid, accept: true },
            { type: 'answerOptionalTrigger', player, oid, accept: false },
          ]
        : [{ type: 'answerOptionalTrigger', player, oid, accept: false }],
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

function topLibraryDecision(state: GameState): Decision {
  const pending = state.pendingTopLibrary;
  if (pending === undefined) throw new Error('topLibraryDecision: no top-library choice is pending');
  if (pending.kind === 'order') {
    const ordered = permutations(pending.cards, 120);
    if (!ordered.complete) throw new Error('topLibraryDecision: order exceeds its schema bound');
    return {
      kind: 'topLibraryOrder',
      player: pending.chooser,
      cards: pending.cards,
      options: ordered.items.map((cards) => ({
        type: 'orderTopLibrary' as const,
        player: pending.chooser,
        cards,
      })),
      complete: true,
    };
  }
  if (pending.kind === 'select') {
    const options: Action[] = [];
    for (const chosen of [...(pending.eligible ?? []), null]) {
      const rest = pending.cards.filter((oid) => oid !== chosen);
      const orders = pending.selectionRest === 'graveyard' ? [rest] : permutations(rest, 6).items;
      for (const order of orders) {
        options.push({ type: 'selectFromTopLibrary', player: pending.chooser, chosen, rest: order });
      }
    }
    return {
      kind: 'topLibrarySelect',
      player: pending.chooser,
      cards: pending.cards,
      eligible: pending.eligible ?? [],
      options,
      complete: true,
    };
  }
  if (pending.kind === 'partition') {
    const [anchor, ...rest] = pending.cards;
    const options: Action[] = [];
    for (let mask = 0; mask < 2 ** rest.length; mask += 1) {
      const first = anchor === undefined ? [] : [anchor];
      const second: ObjectId[] = [];
      rest.forEach((oid, index) => ((mask & (1 << index)) === 0 ? first : second).push(oid));
      options.push({ type: 'separateTopLibraryPiles', player: pending.chooser, first, second });
    }
    return {
      kind: 'topLibraryPartition',
      player: pending.chooser,
      cards: pending.cards,
      options,
      complete: true,
    };
  }
  if (pending.piles === undefined) throw new Error('topLibraryDecision: pile choice has no piles');
  return {
    kind: 'topLibraryPile',
    player: pending.chooser,
    piles: pending.piles,
    options: [0, 1].map((pile) => ({
      type: 'chooseTopLibraryPile' as const,
      player: pending.chooser,
      pile: pile as 0 | 1,
    })),
    complete: true,
  };
}

function sameMembers(actual: readonly ObjectId[], expected: readonly ObjectId[]): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((oid) => expected.includes(oid))
  );
}

function searchDecision(state: GameState): Decision {
  const pending = state.pendingSearch;
  if (pending === undefined) throw new Error('searchDecision: no search is pending');
  const options: Action[] = pending.cards.map((oid) => ({
    type: 'searchLibrary' as const,
    player: pending.player,
    found: oid,
  }));
  if (pending.mayFail) options.push({ type: 'searchLibrary', player: pending.player, found: null });
  return { kind: 'searchLibrary', player: pending.player, cards: pending.cards, options, complete: true };
}

function searchDestinationDecision(state: GameState): Decision {
  const pending = state.pendingSearch;
  if (pending === undefined) {
    throw new Error('searchDestinationDecision: no search destination is pending');
  }
  const options: Action[] = pending.taken.map((one) => ({
    type: 'chooseSearchDestination',
    player: pending.player,
    one,
  }));
  return {
    kind: 'searchDestination',
    player: pending.player,
    cards: pending.taken,
    options,
    complete: true,
  };
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

/** Whether a frozen battlefield candidate still has the values the effect requires. */
export function isCurrentBattlefieldChoiceCandidate(
  state: GameState,
  pending: PendingBattlefieldChoice,
  candidate: PendingPermanentUntapChoice,
): boolean {
  const object = state.objects[candidate.oid];
  return (
    object?.zone === 'battlefield' &&
    (object.incarnation ?? 0) === candidate.incarnation &&
    controllerOf(state, candidate.oid) === pending.player &&
    satisfiesTargetFilter(state, candidate.oid, pending.filter)
  );
}

function battlefieldChoiceDecision(state: GameState): Decision {
  const pending = state.pendingBattlefieldChoice;
  if (pending === undefined) throw new Error('battlefieldChoiceDecision: no battlefield choice is pending');
  const permanents = pending.permanents
    .filter((candidate) => isCurrentBattlefieldChoiceCandidate(state, pending, candidate))
    .map((candidate) => candidate.oid);
  return {
    kind: 'battlefieldChoice',
    player: pending.player,
    permanents,
    options: permanents.map((chosen): Action => ({
      type: 'chooseFromBattlefield',
      player: pending.player,
      chosen,
    })),
    complete: true,
  };
}

/** Whether one frozen Populate candidate is still the same controlled creature token. */
export function isCurrentPopulateCandidate(
  state: GameState,
  pending: PendingPopulate,
  candidate: PendingPopulateCandidate,
): boolean {
  const object = state.objects[candidate.oid];
  return (
    object?.zone === 'battlefield' &&
    object.token &&
    (object.incarnation ?? 0) === candidate.incarnation &&
    controllerOf(state, candidate.oid) === pending.player &&
    isCreatureObject(state, candidate.oid)
  );
}

function populateDecision(state: GameState): Decision {
  const pending = state.pendingPopulate;
  if (pending === undefined) throw new Error('populateDecision: no Populate choice is pending');
  const tokens = pending.tokens
    .filter((candidate) => isCurrentPopulateCandidate(state, pending, candidate))
    .map((candidate) => candidate.oid);
  return {
    kind: 'populate',
    player: pending.player,
    tokens,
    options: tokens.map((token): Extract<Action, { type: 'choosePopulateToken' }> => ({
      type: 'choosePopulateToken',
      player: pending.player,
      token,
    })),
    complete: true,
  };
}

function entryCopyDecision(state: GameState): Decision {
  const pending = state.pendingEntryCopy;
  if (pending === undefined) throw new Error('entryCopyDecision: no entry-copy choice is pending');
  const copies = pending.creatures.map((copyOf): Action => ({
    type: 'chooseEntryCopy',
    player: pending.player,
    oid: pending.oid,
    copyOf,
  }));
  return {
    kind: 'entryCopy',
    player: pending.player,
    oid: pending.oid,
    creatures: pending.creatures,
    options: [...copies, { type: 'chooseEntryCopy', player: pending.player, oid: pending.oid, copyOf: null }],
    complete: true,
  };
}

function entryCounterDecision(state: GameState): Decision {
  const pending = state.pendingEntryCounterChoice;
  if (pending === undefined) throw new Error('entryCounterDecision: no entry counter choice is pending');
  return {
    kind: 'entryCounter',
    player: pending.player,
    oid: pending.oid,
    permanents: pending.permanents,
    options: pending.permanents.map((permanent): Action => ({
      type: 'chooseEntryCounterPermanent',
      player: pending.player,
      oid: pending.oid,
      permanent,
    })),
    complete: true,
  };
}

function entryCharacteristicsDecision(state: GameState): Decision {
  const pending = state.pendingEntryCharacteristicsChoice;
  if (pending === undefined) {
    throw new Error('entryCharacteristicsDecision: no entry characteristic choice is pending');
  }
  return {
    kind: 'entryCharacteristics',
    player: pending.player,
    oid: pending.oid,
    modes: pending.modes,
    options: pending.modes.map((_, mode): Action => ({
      type: 'chooseEntryCharacteristics',
      player: pending.player,
      oid: pending.oid,
      mode,
    })),
    complete: true,
  };
}

function entryOptionalCounterDecision(state: GameState): Decision {
  const pending = state.pendingEntryOptionalCounterChoice;
  if (pending === undefined) {
    throw new Error('entryOptionalCounterDecision: no optional entry counter choice is pending');
  }
  return {
    kind: 'entryOptionalCounter',
    player: pending.player,
    oid: pending.entry.oid,
    counter: pending.counter,
    count: pending.count,
    options: [true, false].map((accept): Action => ({
      type: 'chooseEntryOptionalCounter',
      player: pending.player,
      oid: pending.entry.oid,
      accept,
    })),
    complete: true,
  };
}

function entryPayLifeDecision(state: GameState): Decision {
  const pending = state.pendingEntryPayLifeChoice;
  if (pending === undefined) {
    throw new Error('entryPayLifeDecision: no entry life-payment choice is pending');
  }
  const decline: Extract<Action, { type: 'chooseEntryPayLife' }> = {
    type: 'chooseEntryPayLife',
    player: pending.player,
    oid: pending.entry.oid,
    life: pending.life,
    pay: false,
  };
  const pay: Extract<Action, { type: 'chooseEntryPayLife' }> = { ...decline, pay: true };
  return {
    kind: 'entryPayLife',
    player: pending.player,
    oid: pending.entry.oid,
    life: pending.life,
    options: playerOf(state, pending.player).life < pending.life ? [decline] : [pay, decline],
    complete: true,
  };
}

function entryPlayerDecision(state: GameState): Decision {
  const pending = state.pendingEntryPlayerChoice;
  if (pending === undefined) throw new Error('entryPlayerDecision: no entry player choice is pending');
  return {
    kind: 'entryPlayer',
    player: pending.player,
    oid: pending.oid,
    options: state.players.map((candidate): Action => ({
      type: 'chooseEntryPlayer',
      player: pending.player,
      oid: pending.oid,
      chosen: candidate.id,
    })),
    complete: true,
  };
}

function entryColorsDecision(state: GameState): Decision {
  const pending = state.pendingEntryColorsChoice;
  if (pending === undefined) throw new Error('entryColorsDecision: no entry color choice is pending');
  const options: Action[] = COLORS.flatMap((left, index) =>
    COLORS.slice(index + 1).map((right) => ({
      type: 'chooseEntryColors' as const,
      player: pending.player,
      oid: pending.oid,
      colors: [left, right] as const,
    })),
  );
  return { kind: 'entryColors', player: pending.player, oid: pending.oid, options, complete: true };
}

function entryAuraDecision(state: GameState): Decision {
  const pending = state.pendingEntryAuraChoice;
  if (pending === undefined) throw new Error('entryAuraDecision: no Aura entry choice is pending');
  return {
    kind: 'entryAura',
    player: pending.player,
    oid: pending.entry.oid,
    permanents: pending.permanents,
    options: pending.permanents.map((host): Action => ({
      type: 'chooseEntryAuraHost',
      player: pending.player,
      oid: pending.entry.oid,
      host,
    })),
    complete: true,
  };
}

function entryTimestampOrderDecision(state: GameState): Decision {
  const group = state.pendingBattlefieldEntryBatch?.timestampGroups?.find(
    (candidate) => candidate.remaining.length > 1,
  );
  if (group === undefined) {
    throw new Error('entryTimestampOrderDecision: no timestamp group is awaiting an answer');
  }
  return {
    kind: 'entryTimestampOrder',
    player: group.player,
    ordered: group.chosen,
    remaining: group.remaining,
    options: group.remaining.map((oid): Action => ({
      type: 'chooseEntryTimestampNext',
      player: group.player,
      oid,
    })),
    complete: true,
  };
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
 * permanent that left the battlefield between the pause and the answer is
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
    remaining: pending.remainingCount,
    options: pending.permanents.map((oid): Action => ({ type: 'sacrificePermanent', player, oid })),
    complete: true,
  };
}

export function isCurrentPermanentUntapCandidate(
  state: GameState,
  pending: PendingPermanentUntap,
  candidate: PendingPermanentUntapChoice,
): boolean {
  const object = state.objects[candidate.oid];
  return (
    object?.zone === 'battlefield' &&
    (object.incarnation ?? 0) === candidate.incarnation &&
    canUntapObject(state, candidate.oid) &&
    satisfiesTargetFilter(state, candidate.oid, pending.filter)
  );
}

function permanentUntapDecision(state: GameState): Decision {
  const pending = state.pendingPermanentUntap;
  if (pending === undefined) throw new Error('permanentUntapDecision: no permanent untap is pending');
  const player = pending.controller;
  const permanents = pending.permanents
    .filter((candidate) => isCurrentPermanentUntapCandidate(state, pending, candidate))
    .map((candidate) => candidate.oid);
  return {
    kind: 'permanentUntap',
    player,
    permanents,
    remaining: pending.remainingCount,
    options: [
      ...permanents.map((oid): Action => ({ type: 'choosePermanentToUntap', player, oid })),
      { type: 'choosePermanentToUntap', player, oid: null },
    ],
    complete: true,
  };
}

function cardNameDecision(state: GameState): Decision {
  const resolving = state.pendingCardNameChoice;
  const entering = state.pendingEntryCardNameChoice;
  if (resolving === undefined && entering === undefined) {
    throw new Error('cardNameDecision: no card-name choice is pending');
  }
  return {
    kind: 'cardName',
    player: resolving?.player ?? entering!.player,
    chosen: resolving?.chosen ?? [],
    input: { kind: 'text', label: 'Card name', minLength: 1, maxLength: MAX_CARD_NAME_LENGTH },
    options: [],
    complete: true,
  };
}

function namesKnownLand(state: GameState, name: string): boolean {
  const canonical = name.trim().normalize('NFKC').toLowerCase();
  if (new Set(['plains', 'island', 'swamp', 'mountain', 'forest']).has(canonical)) return true;
  return Object.values(state.objects).some(
    (object) =>
      object.card.kind === 'land' && object.card.name.trim().normalize('NFKC').toLowerCase() === canonical,
  );
}

function namedZoneExileDecision(state: GameState): Decision {
  const pending = state.pendingNamedZoneExile;
  if (pending === undefined) throw new Error('namedZoneExileDecision: no named-zone exile is pending');
  return {
    kind: 'namedZoneExile',
    player: pending.player,
    targetPlayer: pending.targetPlayer,
    name: pending.name,
    cards: pending.candidates,
    chosen: pending.chosen,
    options: [
      ...pending.candidates.map((oid): Action => ({
        type: 'chooseNamedZoneExile',
        player: pending.player,
        oid,
      })),
      { type: 'chooseNamedZoneExile', player: pending.player, oid: null },
    ],
    complete: true,
  };
}

function damagePreventionDecision(state: GameState): Decision {
  const pending = state.pendingDamagePrevention;
  if (pending === undefined) {
    throw new Error('damagePreventionDecision: no prevention allocation is pending');
  }
  const source = pending.plan.sources[0];
  if (source === undefined) {
    throw new Error('damagePreventionDecision: no simultaneous source is awaiting allocation');
  }
  const { minimum, maximum } = damagePreventionRange(pending);
  const options: Action[] = [];
  for (let amount = minimum; amount <= maximum; amount += 1) {
    options.push({
      type: 'allocateDamagePrevention',
      player: pending.player,
      sourceOid: source.sourceOid,
      amount,
    });
  }
  return {
    kind: 'damagePrevention',
    player: pending.player,
    effectId: pending.plan.effectId,
    source,
    remaining: pending.remainingAmount,
    options,
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
function unlessDecision(pending: TolledStackObject): Decision {
  const player = pending.payer;
  const oid = pending.entry.oid;
  return {
    kind: 'unless',
    player,
    oid,
    cost: pending.cost,
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

function openingHandActionDecision(state: GameState, player: PlayerId): Decision {
  const cards = eligibleOpeningHandActionCards(state, player);
  return {
    kind: 'openingHandAction',
    player,
    cards,
    options: [
      ...cards.map((oid): Action => ({ type: 'chooseOpeningHandAction', player, oid })),
      { type: 'chooseOpeningHandAction', player, oid: null },
    ],
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
  const count = cleanupDiscardCount(state, player);
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

function revealedHandChoiceDecision(state: GameState): Decision {
  const pending = state.pendingRevealedHandChoice;
  if (pending === undefined) {
    throw new Error('revealedHandChoiceDecision: no revealed-hand choice is pending');
  }
  const mayDecline = pending.outcome.kind === 'mayCastWithoutPayingManaCost';
  const options: readonly Action[] = [
    ...(mayDecline
      ? [{ type: 'chooseFromRevealedHand', player: pending.player, chosen: null } as const]
      : []),
    ...pending.choosable.map((chosen): Action => ({
      type: 'chooseFromRevealedHand',
      player: pending.player,
      chosen,
    })),
  ];
  return {
    kind: 'revealedHandChoice',
    player: pending.player,
    owner: pending.owner,
    cards: pending.choosable,
    options,
    complete: true,
  };
}

function targetEqual(left: Target | null, right: Target | null): boolean {
  if (left === null || right === null) return left === right;
  return sameTarget(left, right);
}

function uniqueTargets(targets: readonly Target[]): readonly Target[] {
  return targets.filter(
    (target, index) => targets.findIndex((candidate) => sameTarget(candidate, target)) === index,
  );
}

function spellTargetContext(state: GameState): {
  readonly entry: GameState['stack'][number];
  readonly card: Card;
  readonly effects: readonly Effect[];
  readonly controller: PlayerId;
  readonly source: ObjectId | Card;
} | null {
  const pending = state.pendingSpellTargets;
  if (pending === undefined) return null;
  const entry = state.stack.find((candidate) => candidate.oid === pending.spell);
  if (entry === undefined || entry.ability !== null) return null;
  const card = spellCard(state, entry);
  if (card === null) return null;
  // Overload replacements are untargeted by construction, so a copied or
  // redirected overloaded spell can never open this target-changing decision.
  if (entry.castingCost === 'overload') return null;
  return {
    entry,
    card,
    effects: spellEffectsFor(card, entry.mode, 'ordinary'),
    controller: pending.operation === 'copySpell' ? pending.controller : entry.controller,
    source: entry.copiedSpell?.card ?? entry.oid,
  };
}

function spellMultiTargetOptions(
  state: GameState,
  context: NonNullable<ReturnType<typeof spellTargetContext>>,
  cap: number,
): Enumerated<Readonly<Record<number, readonly Target[]>> | undefined> {
  const original = context.entry.multiTargets;
  if (original === undefined) return { items: [undefined], complete: true };
  let maps: Readonly<Record<number, readonly Target[]>>[] = [{}];
  let complete = true;
  for (const [rawIndex, prior] of Object.entries(original)) {
    const index = Number(rawIndex);
    const effect = context.effects[index];
    if (effect === undefined) return { items: [], complete: true };
    const choices = isTargetedFight(effect)
      ? cartesian(
          [
            uniqueTargets([
              ...(prior[0] === undefined ? [] : [prior[0]]),
              ...multipleTargetCandidates(state, effect, context.controller, context.source, 0),
            ]),
            uniqueTargets([
              ...(prior[1] === undefined ? [] : [prior[1]]),
              ...multipleTargetCandidates(state, effect, context.controller, context.source, 1),
            ]),
          ],
          cap,
        )
      : combinations(
          uniqueTargets([
            ...prior,
            ...multipleTargetCandidates(state, effect, context.controller, context.source),
          ]),
          prior.length,
          cap,
        );
    if (!choices.complete) complete = false;
    const grown: Readonly<Record<number, readonly Target[]>>[] = [];
    for (const prefix of maps) {
      for (const chosen of choices.items) {
        if (grown.length >= cap) {
          complete = false;
          break;
        }
        grown.push({ ...prefix, [index]: chosen });
      }
      if (grown.length >= cap) break;
    }
    maps = grown;
  }
  return { items: maps, complete };
}

function spellTargetsDecision(state: GameState, cap: number): Decision {
  const pending = state.pendingSpellTargets;
  const context = spellTargetContext(state);
  if (pending === undefined || context === null) {
    throw new Error('spellTargetsDecision: no target spell is pending');
  }
  const legal = isAuraCard(context.card)
    ? targetChoicesFor(state, context.card, context.controller, context.entry.oid)
    : targetChoicesForEffects(state, context.effects, context.controller, context.source);
  const choices = legal.map((slot, index) => {
    const prior = context.entry.targets[index] ?? null;
    const withPrior = [prior, ...slot];
    return withPrior.filter(
      (target, at) => withPrior.findIndex((candidate) => targetEqual(candidate, target)) === at,
    );
  });
  const targetOptions = cartesian(choices, cap);
  const multiOptions = spellMultiTargetOptions(state, context, cap);
  const options: Action[] = [];
  let complete = targetOptions.complete && multiOptions.complete;
  for (const targets of targetOptions.items) {
    if (!honoursDistinctSlots(context.effects, targets)) continue;
    for (const multiTargets of multiOptions.items) {
      if (options.length >= cap) {
        complete = false;
        break;
      }
      options.push({
        type: 'chooseSpellTargets',
        player: pending.player,
        oid: pending.spell,
        targets,
        ...(multiTargets === undefined ? {} : { multiTargets }),
        ...(context.entry.damageAllocations === undefined
          ? {}
          : { damageAllocations: context.entry.damageAllocations }),
      });
    }
  }
  return {
    kind: 'spellTargets',
    player: pending.player,
    oid: pending.spell,
    targets: context.entry.targets,
    ...(context.entry.multiTargets === undefined ? {} : { multiTargets: context.entry.multiTargets }),
    ...(context.entry.damageAllocations === undefined
      ? {}
      : { damageAllocations: context.entry.damageAllocations }),
    options,
    complete,
  };
}

function freeCastDecision(state: GameState, cap: number): Decision {
  const pending = state.pendingFreeCast;
  if (pending === undefined) throw new Error('freeCastDecision: no free cast is pending');
  const castCap = pending.optional === true ? Math.max(0, cap - 1) : cap;
  const candidateOids = pending.copyCandidates?.map((candidate) => candidate.oid) ??
    pending.originalCandidates?.map((candidate) => candidate.oid) ?? [pending.oid];
  const casts = candidateOids.reduce<Enumerated<Action>>(
    (all, oid) => {
      const candidate = pendingFreeCastCandidate(state, pending, oid);
      if (candidate === null) return all;
      const next = freeCastOptionsForCard(
        state,
        pending.player,
        oid,
        candidate.card,
        castCap - all.items.length,
      );
      return { items: [...all.items, ...next.items], complete: all.complete && next.complete };
    },
    { items: [], complete: true },
  );
  const options: readonly Action[] =
    pending.optional === true
      ? [{ type: 'declineFreeCast', player: pending.player, oid: pending.oid }, ...casts.items]
      : casts.items;
  return {
    kind: 'freeCast',
    player: pending.player,
    oid: pending.oid,
    optional: pending.optional === true,
    options,
    complete: casts.complete,
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
  if (state.pendingManaCombination !== undefined) {
    const pending = state.pendingManaCombination;
    return {
      kind: 'priority',
      player: pending.player,
      options: COLORS.map((color): Action => ({
        type: 'activateManaAbility',
        player: pending.player,
        oid: pending.sourceOid,
        color,
      })),
      complete: true,
    };
  }
  const { awaiting, awaitingPlayer, priority } = state.turn;
  if (awaiting !== null && awaitingPlayer !== null) {
    switch (awaiting) {
      case 'mulligan':
        return mulliganDecision(state, awaitingPlayer, cap);
      case 'openingHandAction':
        return openingHandActionDecision(state, awaitingPlayer);
      case 'attackers':
        return attackerDecision(state, awaitingPlayer, cap);
      case 'blockers':
        return blockerDecision(state, awaitingPlayer, cap);
      case 'blockerOrder':
        return orderDecision(state, awaitingPlayer, cap);
      case 'attackerOrder':
        return attackerOrderDecision(state, awaitingPlayer, cap);
      case 'discard':
        return discardDecision(state, awaitingPlayer, cap);
      case 'handDiscard':
        return handDiscardDecision(state, cap);
      case 'revealedHandChoice':
        return revealedHandChoiceDecision(state);
      case 'triggerTargets': {
        const pending = triggerAwaitingTargets(state);
        // Unreachable through `reduce`, which sets this only when the entry is
        // there and clears it the moment the entry answers. It throws rather
        // than falling through to priority, because the fall-through would ask
        // the wrong player a question the position does not pose.
        if (pending === null) throw new Error('pendingDecision: no trigger on the stack owes targets');
        return triggerTargetsDecision(state, pending, cap);
      }
      case 'pluralTargets':
        return pluralTargetsDecision(state);
      case 'damageAllocation':
        return damageAllocationDecision(state);
      case 'optionalTrigger': {
        const pending = optionalTriggerOnTop(state);
        if (pending === null) throw new Error('pendingDecision: no optional trigger is resolving');
        return optionalTriggerDecision(state, pending);
      }
      case 'may': {
        const pending = spellAwaitingMay(state);
        // Unreachable through `reduce`, which raises this only from
        // `stack.ts`'s `awaitMay` and clears it the moment the spell answers.
        if (pending === null) throw new Error('pendingDecision: no spell is awaiting a "you may" answer');
        return mayDecision(pending);
      }
      case 'unless': {
        const pending = stackAwaitingUnless(state);
        // Unreachable through `reduce`, which raises this only from
        // `stack.ts`'s `awaitUnless` and clears it the moment the toll answers.
        if (pending === null)
          throw new Error('pendingDecision: no stack object is awaiting an "unless" answer');
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
      case 'manaColor': {
        const pending = state.pendingManaColorChoice;
        if (pending === undefined) throw new Error('pendingDecision: no mana color is pending');
        return {
          kind: 'manaColor',
          player: pending.player,
          colors: pending.colors,
          options: pending.colors.map((color) => ({
            type: 'chooseManaColor' as const,
            player: pending.player,
            color,
          })),
          complete: true,
        };
      }
      case 'topLibraryOrder':
      case 'topLibrarySelect':
      case 'topLibraryPartition':
      case 'topLibraryPile':
        return topLibraryDecision(state);
      case 'searchLibrary':
        return searchDecision(state);
      case 'searchDestination':
        return searchDestinationDecision(state);
      case 'graveyardChoice':
        return graveyardChoiceDecision(state);
      case 'battlefieldChoice':
        return battlefieldChoiceDecision(state);
      case 'populate':
        return populateDecision(state);
      case 'permanentSacrifice':
        return permanentSacrificeDecision(state);
      case 'permanentUntap':
        return permanentUntapDecision(state);
      case 'entryCopy':
        return entryCopyDecision(state);
      case 'entryCounter':
        return entryCounterDecision(state);
      case 'entryAura':
        return entryAuraDecision(state);
      case 'entryTimestampOrder':
        return entryTimestampOrderDecision(state);
      case 'entryCharacteristics':
        return entryCharacteristicsDecision(state);
      case 'entryOptionalCounter':
        return entryOptionalCounterDecision(state);
      case 'entryPayLife':
        return entryPayLifeDecision(state);
      case 'entryPlayer':
        return entryPlayerDecision(state);
      case 'entryColors':
        return entryColorsDecision(state);
      case 'spellTargets':
        return spellTargetsDecision(state, cap);
      case 'freeCast':
        return freeCastDecision(state, cap);
      case 'damagePrevention':
        return damagePreventionDecision(state);
      case 'cardName':
        return cardNameDecision(state);
      case 'namedZoneExile':
        return namedZoneExileDecision(state);
      default:
        return assertNever(awaiting, 'pendingDecision');
    }
  }
  if (priority !== null) return priorityDecision(state, priority, cap);
  return null;
}

export function ownedDecision(state: GameState, cap: number = DEFAULT_ENUMERATION_CAP): Decision | null {
  const decision = pendingDecision(state, cap);
  if (decision === null) return null;
  return {
    ...decision,
    options: [...decision.options, { type: 'concede', player: decision.player }],
  } as Decision;
}

/** Flat list of legal actions; empty when the kernel is not waiting on anyone. */
export function legalActions(state: GameState, cap: number = DEFAULT_ENUMERATION_CAP): readonly Action[] {
  return ownedDecision(state, cap)?.options ?? [];
}

function validateCast(
  state: GameState,
  player: PlayerId,
  oid: ObjectId,
  targets: readonly (Target | null)[],
  x?: number,
  mode?: number,
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: DamageAllocations,
  castingCost?: CastingCostChoice,
  sacrifices: readonly ObjectId[] = [],
  discards: readonly ObjectId[] = [],
): string | null {
  const object = tryObject(state, oid);
  const freeCast = castingCost === 'withoutMana';
  const pending = state.pendingFreeCast;
  const candidate =
    freeCast && pending?.player === player ? pendingFreeCastCandidate(state, pending, oid) : null;
  const effectFreeCast = candidate === null ? undefined : pending;
  if (effectFreeCast !== undefined) {
    if (object === undefined || object.zone !== effectFreeCast.from) {
      return `card is not in ${effectFreeCast.from}`;
    }
  } else {
    if (object === undefined || object.zone !== 'hand' || object.owner !== player) {
      return 'card is not in your hand';
    }
    if (freeCast && !freeCastFromHandPermissionApplies(state, player)) {
      return 'this card is not awaiting a cast without paying its mana cost and no live permission allows it';
    }
  }
  const card = candidate?.card ?? object.card;
  if (!isCastable(card)) return 'lands are played, not cast';
  if (effectFreeCast === undefined) {
    const timingError = castTimingError(state, player, oid, card);
    if (timingError !== undefined) return timingError;
  } else {
    const permissionError = castPermissionError(state, player);
    if (permissionError !== undefined) return permissionError;
    const restrictionError = cardCastingRestrictionError(state, player, card);
    if (restrictionError !== undefined) return restrictionError;
  }
  const overloadChosen = castingCost === 'overload';
  const selectedHasX =
    overloadChosen && (card.kind === 'instant' || card.kind === 'sorcery')
      ? card.overload?.cost.hasX === true
      : card.manaCost.hasX;
  if (selectedHasX && x === undefined) return 'this cost needs an announced X';
  if (!selectedHasX && x !== undefined) return 'this cost has no X to announce';
  if (freeCast && x !== undefined && x !== 0) return 'X must be 0 when casting without paying mana';
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
  if (
    castingCost !== undefined &&
    castingCost !== 'mana' &&
    castingCost !== 'alternative' &&
    castingCost !== 'overload' &&
    castingCost !== 'withoutMana'
  ) {
    return 'this spell has an unknown casting-cost choice';
  }
  if (!freeCast) {
    if (
      castingCost === undefined &&
      (card.alternativeCost !== undefined ||
        ((card.kind === 'instant' || card.kind === 'sorcery') && card.overload !== undefined))
    ) {
      return 'this spell needs a casting-cost choice';
    }
  }
  const selected = castingCost ?? 'mana';
  if (selected === 'alternative' && card.alternativeCost === undefined) {
    return 'this spell has no alternative casting cost to choose';
  }
  if (
    selected === 'overload' &&
    ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.overload === undefined)
  ) {
    return 'this spell has no overload casting cost to choose';
  }
  if (
    selected === 'alternative' &&
    card.alternativeCost !== undefined &&
    playerOf(state, player).life < card.alternativeCost.payLife
  ) {
    return `you cannot pay ${String(card.alternativeCost.payLife)} life`;
  }
  const additionalPayment = validateSpellSacrifices(state, player, card, selected, sacrifices);
  if (additionalPayment !== null) return additionalPayment;
  const discardPayment = validateSpellDiscards(state, player, oid, card, selected, discards);
  if (discardPayment !== null) return discardPayment;
  if (isAuraCard(card)) {
    if (multiTargets !== undefined || damageAllocations !== undefined) {
      return 'an Aura has no plural target choices or damage allocations';
    }
    if (targets.length !== 1) return 'an Aura chooses exactly one target';
    const target = targets[0];
    if (target === undefined || target === null || target.kind !== 'permanent') {
      return 'an Aura targets a permanent allowed by its enchant restriction';
    }
    if (!isLegalAuraHost(state, card, target.oid) || !canBeTargetedBy(state, target.oid, oid, player)) {
      return 'an Aura targets a permanent allowed by its enchant restriction';
    }
    return canPay(state, player, selectedCastingManaCost(state, player, card, x, selected))
      ? null
      : 'cannot pay the mana cost';
  }
  if (selected === 'overload') {
    if (multiTargets !== undefined || damageAllocations !== undefined) {
      return 'an overloaded spell has no plural target choices or damage allocations';
    }
    const effects = spellEffectsFor(card, null, 'overload');
    if (targets.length !== effects.length || targets.some((target) => target !== null)) {
      return 'an overloaded spell requires one untargeted slot per replacement effect';
    }
    return canPay(state, player, selectedCastingManaCost(state, player, card, x, selected))
      ? null
      : 'cannot pay the mana cost';
  }
  const effects = spellEffectsFor(card, mode ?? null, 'ordinary');
  if (targets.length !== effects.length) return 'one target slot per effect is required';
  const pluralError = validatePluralTargets(
    state,
    effects,
    targets,
    multiTargets,
    damageAllocations,
    player,
    oid,
  );
  if (pluralError !== null) return pluralError;
  for (const [index, effect] of effects.entries()) {
    // A plural target slot (`count` or `anyNumber`)
    // is chosen through `multiTargets`, not `targets` — `matchesTargetKind`
    // treats a `null` `targetCreature` target as absent rather than as "zero
    // of up to two", so routing it through the ordinary single-target check
    // below would reject the empty and one-target choices the wording is
    // written to allow. CR 601.2c governs submission here: every named
    // member must be legal right now and no two may name the same object,
    // the all-or-nothing sibling of CR 608.2b's resolution-time partial
    // survival (`stack.ts`'s `planResolution`).
    if (isPluralTargetEffect(effect)) continue;
    if (!isTargetStillLegal(state, effect, targets, index, player, oid)) {
      return `illegal target for effect ${index}`;
    }
  }
  const targetCount = countTargetInstances(targets, multiTargets);
  if (!canPay(state, player, selectedCastingManaCost(state, player, card, x, selected, targetCount))) {
    return 'cannot pay the mana cost';
  }
  return null;
}

function validateBeginCast(
  state: GameState,
  action: Extract<Action, { type: 'beginCastSpell' }>,
): string | null {
  const object = tryObject(state, action.oid);
  const pending = action.castingCost === 'withoutMana' ? state.pendingFreeCast : undefined;
  const card =
    pending === undefined ? object?.card : pendingFreeCastCandidate(state, pending, action.oid)?.card;
  if (card === undefined || !isCastable(card)) return 'card is not a castable card in the expected zone';
  if (action.castingCost === 'overload') return 'an overloaded spell has no plural target choice to stage';
  if (card.modes === undefined && action.mode !== undefined) return 'this spell has no modes to choose';
  if (card.modes !== undefined && (action.mode === undefined || card.modes[action.mode] === undefined)) {
    return 'this spell needs a valid mode';
  }
  const effects = spellEffectsFor(card, action.mode ?? null, 'ordinary');
  if (!hasPluralTargets(effects)) return 'this spell has no plural target choice to stage';
  const minimum = minimumPluralChoice(state, effects, action.player, action.oid);
  if (minimum === null) return 'this spell cannot satisfy its minimum plural target count';
  return validateCast(
    state,
    action.player,
    action.oid,
    action.targets,
    action.x,
    action.mode,
    minimum.multiTargets,
    minimum.damageAllocations,
    action.castingCost,
    action.sacrifices ?? [],
    action.discards ?? [],
  );
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
  multiTargets: Readonly<Record<number, readonly Target[]>> | undefined,
  damageAllocations: DamageAllocations | undefined,
  sacrifices: readonly ObjectId[],
  taps: readonly ObjectId[] | undefined,
  discards: readonly ObjectId[],
  x?: number,
  mode?: number,
): string | null {
  const ability = currentActivatedAbilityAt(state, oid, abilityIndex);
  if (ability === undefined) return 'that permanent has no activated ability there';
  // The mirror of the skip in `activationOptions`. CR 605.3a puts a mana
  // ability outside the stack entirely, so `activateAbility` is the wrong
  // action type for it however the agent constructed the submission — and an
  // agent that builds its own actions is exactly what `validateAction` exists
  // to catch.
  if (isManaAbility(ability)) return 'a mana ability is activated as a mana ability';
  if (ability.modes === undefined && mode !== undefined) return 'this ability has no modes to choose';
  if (ability.modes !== undefined && mode === undefined) {
    return 'this ability is modal and needs a chosen mode';
  }
  if (mode !== undefined && ability.modes?.[mode] === undefined) return 'mode is out of range';
  const effects = effectsForActivatedAbility(ability, mode ?? null);
  const blocker = activationBlocker(state, player, oid, ability, abilityIndex);
  if (blocker !== null) return blocker;
  const variableLoyalty = ability.loyaltyCost !== undefined && isVariableLoyaltyCost(ability.loyaltyCost);
  const announcesX = ability.cost.mana.hasX || variableLoyalty;
  if (announcesX && x === undefined) return 'this cost needs an announced X';
  if (!announcesX && x !== undefined) return 'this cost has no X to announce';
  if (x !== undefined && (!Number.isInteger(x) || x < 0 || x > MAX_CHOSEN_X)) {
    return `X must be an integer between 0 and ${MAX_CHOSEN_X}`;
  }
  if (variableLoyalty && x !== undefined) {
    const loyalty = counterCount(getObject(state, oid).counters, 'loyalty');
    if (x > loyalty) {
      return `the loyalty cost removes ${String(x)} counters and this permanent has ${String(loyalty)}`;
    }
  }
  const payment = validateSacrifices(state, player, oid, ability, sacrifices);
  if (payment !== null) return payment;
  const tapped = validateTapMatching(state, player, oid, ability, taps);
  if (tapped !== null) return tapped;
  if (
    !canPay(state, player, resolveX(ability.cost.mana, x ?? 0), [
      ...(ability.cost.tapSelf ? [oid] : []),
      ...(taps ?? []),
    ])
  ) {
    return 'cannot pay the mana cost';
  }
  const discarded = validateDiscards(state, player, ability, discards);
  if (discarded !== null) return discarded;
  if (ability.cost.exileControlledInstantOrSorcerySpell === true) {
    const selected = targets[0];
    if (
      targets.length !== 1 ||
      selected?.kind !== 'spell' ||
      !controlledInstantOrSorcerySpells(state, player).includes(selected.oid)
    ) {
      return 'the cost exiles exactly one instant or sorcery spell you control';
    }
    return null;
  }
  if (isAttachingAbility(ability)) return validateEquipTarget(state, player, oid, targets);
  if (targets.length !== effects.length) return 'one target slot per effect is required';
  const startsPluralChoice = shouldStagePluralTargets(effects, multiTargets, damageAllocations);
  const minimum = startsPluralChoice ? minimumPluralChoice(state, effects, player, oid) : undefined;
  if (startsPluralChoice && minimum === null) {
    return 'this ability cannot satisfy its minimum plural target count';
  }
  const pluralError = validatePluralTargets(
    state,
    effects,
    targets,
    minimum?.multiTargets ?? multiTargets,
    minimum?.damageAllocations ?? damageAllocations,
    player,
    oid,
  );
  if (pluralError !== null) return pluralError;
  for (const [index, effect] of effects.entries()) {
    if (isPluralTargetEffect(effect)) continue;
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
  multiTargets?: Readonly<Record<number, readonly Target[]>>,
  damageAllocations?: DamageAllocations,
): string | null {
  const pending = triggerAwaitingTargets(state);
  if (pending === null) return 'no trigger is choosing targets';
  if (pending.entry.oid !== oid) return `${pending.entry.oid} is the trigger being aimed, not ${oid}`;
  const effects = pending.ability.effects;
  const settled = pending.entry.targets;
  if (isGuildFeudAbility(pending.ability)) {
    if (multiTargets !== undefined || damageAllocations !== undefined) {
      return 'Guild Feud has one ordinary opponent target';
    }
    if (settled.length > 0) return 'the Guild Feud opponent is already chosen';
    if (targets.length !== 1) return 'Guild Feud requires exactly one opponent target';
    const target = targets[0];
    const offered = triggerTargetChoices(state, pending)[0] ?? [];
    return target !== undefined &&
      target !== null &&
      offered.some((choice) => choice !== null && sameTarget(choice, target))
      ? null
      : 'Guild Feud must target the legal opponent';
  }
  const hasPlural = hasPluralTargets(effects);
  if (hasPlural) {
    if (settled.length > 0) return 'a plural trigger target choice cannot rewrite settled slots';
    if (targets.length !== effects.length) return 'one target slot per effect is required';
    const source =
      state.objects[pending.source]?.zone === 'battlefield'
        ? pending.source
        : (pending.entry.sourceCharacteristics ?? pending.source);
    if (multiTargets === undefined && damageAllocations === undefined) {
      for (const [index, effect] of effects.entries()) {
        if (hasTarget(effect) && isMultipleTargetSpec(effect.target)) continue;
        if (!isTargetStillLegal(state, effect, targets, index, pending.entry.controller, source)) {
          return `illegal target for effect ${String(index)}`;
        }
      }
      return null;
    }
    const pluralError = validatePluralTargets(
      state,
      effects,
      targets,
      multiTargets,
      damageAllocations,
      pending.entry.controller,
      source,
    );
    if (pluralError !== null) return pluralError;
    for (const [index, effect] of effects.entries()) {
      if (hasTarget(effect) && isMultipleTargetSpec(effect.target)) continue;
      if (!isTargetStillLegal(state, effect, targets, index, pending.entry.controller, source)) {
        return `illegal target for effect ${String(index)}`;
      }
    }
    return null;
  }
  if (multiTargets !== undefined || damageAllocations !== undefined) {
    return 'this trigger has no plural target slots';
  }
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
        stackEntryTargetingController(state, pending.entry),
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
 * Full legality of a triggered ability's yes/no resolution answer.
 *
 * Declining is always legal. Accepting a paid CR 603.3b trigger additionally
 * requires its controller to be able to pay at the moment of resolution;
 * accepting Faerie Impostor's return cost requires another controlled
 * creature at that same moment.
 */
function validateOptionalTrigger(state: GameState, oid: ObjectId, accept: boolean): string | null {
  const pending = optionalTriggerOnTop(state);
  if (pending === null) return 'no optional trigger is resolving';
  if (pending.entry.oid !== oid) return `${pending.entry.oid} is the trigger resolving, not ${oid}`;
  const payment =
    pending.ability.kind === 'triggered' ? pending.ability.optionalControllerPayment : undefined;
  if (accept && payment !== undefined && !canPay(state, pending.entry.controller, payment.cost)) {
    return 'cannot pay the optional trigger cost';
  }
  if (
    accept &&
    isReturnAnotherCreatureOrSacrificeSelfAbility(pending.ability) &&
    returnAnotherCreatureCandidates(state, pending.source, pending.entry.controller).length === 0
  ) {
    return 'no other controlled creature can pay the return cost';
  }
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
  const pending = stackAwaitingUnless(state);
  if (pending === null) return 'no stack object is awaiting an "unless" answer';
  if (pending.entry.oid !== oid) {
    const object = pending.kind === 'spell' ? 'spell' : 'ability';
    return `${pending.entry.oid} is the ${object} resolving, not ${oid}`;
  }
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
 * Full legality of an answer to CR 701.17a against the frozen candidate group.
 *
 * `validateKeepLegend`'s shape and its stated reason: a control-change or a
 * second removal effect landing between the pause and the answer could
 * otherwise let an action name a permanent outside the affected player's
 * filtered group, repeat a choice, or answer for a seat the pause never asked.
 */
function validatePermanentSacrifice(state: GameState, player: PlayerId, oid: ObjectId): string | null {
  const pending = state.pendingPermanentSacrifice;
  if (pending === undefined) return 'no permanent sacrifice is pending';
  if (pending.player !== player) return `${pending.player} is being asked to sacrifice, not ${player}`;
  if (!pending.permanents.includes(oid)) return `${oid} is not one of the permanents ${player} may sacrifice`;
  return null;
}

function validatePermanentUntap(state: GameState, player: PlayerId, oid: ObjectId | null): string | null {
  const pending = state.pendingPermanentUntap;
  if (pending === undefined) return 'no permanent untap is pending';
  if (pending.controller !== player)
    return `${pending.controller} is choosing permanents to untap, not ${player}`;
  if (oid === null) return null;
  const candidate = pending.permanents.find((permanent) => permanent.oid === oid);
  if (candidate === undefined) return `${oid} is not one of the permanents ${player} may untap`;
  if (!isCurrentPermanentUntapCandidate(state, pending, candidate))
    return `${oid} is no longer a tappable permanent matching the untap filter`;
  return null;
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
  if (
    action.attackers.length > 0 &&
    staticPlayerRuleApplies(state, player, 'cantAttackWithCreaturesIfCastSpellThisTurn')
  ) {
    return "you can't attack with creatures after casting a spell this turn";
  }
  const order = eligibleAttackers(state);
  const eligible = new Set(order);
  const already = state.combat.attacksSettled ?? 0;
  const settled = action.settled ?? order.length;
  if (!Number.isInteger(settled) || settled < 0 || settled > order.length) {
    return 'a declaration answers for between none and all of the creatures that can attack';
  }
  const wholeEmptyDeclaration =
    order.length === 0 &&
    state.combat.attacksSettled === undefined &&
    action.settled === undefined &&
    action.attackers.length === 0;
  if (settled <= already && !wholeEmptyDeclaration) {
    return 'a declaration must answer for at least one more creature';
  }
  const asked = new Set(order.slice(0, settled));
  const seen = new Set<ObjectId>();
  for (const declaration of action.attackers) {
    if (!eligible.has(declaration.oid)) return `${declaration.oid} cannot attack`;
    if (!asked.has(declaration.oid)) return `${declaration.oid} has not been asked about yet`;
    if (seen.has(declaration.oid)) return `${declaration.oid} declared twice`;
    seen.add(declaration.oid);
    if (!isLegalCombatDefender(state, player, declaration.defender)) {
      return 'attackers must attack the opponent, an opposing planeswalker, or a Battle they protect';
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
  const globallyRequired = requiredAttackers(state, order, defenders);
  for (const oid of order.slice(0, settled)) {
    const requirement = attackRequirement(state, oid, defenders);
    if (!globallyRequired.has(oid)) continue;
    const declared = action.attackers.find((declaration) => declaration.oid === oid);
    if (declared === undefined) {
      return requirement.lured
        ? `${oid} attacks that player this turn if able and must attack`
        : requirement.turnScoped
          ? `${oid} attacks this turn if able and must attack`
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
  const declared = action.attackers.map((attack) => attack.oid);
  if (!canPayAttackTaxes(state, player, action.attackers)) {
    return 'the attacking player cannot pay the additional attack cost';
  }
  const whole = settled === order.length;
  if (whole) {
    const cohort = attackCohortRestriction(state, declared);
    if (cohort !== null) return cohort;
  } else if (!attacksCompletable(state, declared, order.slice(settled), globallyRequired)) {
    return 'no legal attack finishes that declaration';
  }
  return null;
}

/**
 * An answer to CR 509.1: the whole declaration, or a prefix of the creatures
 * that could block.
 *
 * `validateAttackerDeclaration`'s three prefix rules apply here too. Blocking
 * adds menace matching to the cohort completability both declarations need:
 * menace and cohort restrictions can fail only at the declaration level, so a
 * prefix is held to the per-pair rules and to a solver that says the block can
 * still be finished, and the last answer is held to the declaration rules.
 * `blockRequirementsReachable` carries the argument and refuses an
 * uncompletable prefix at the offer as well, so the two agree by construction.
 *
 * CR 509.1c rides beside menace on the same shape: the joint target over both
 * attacker-relative and blocker-relative requirements is checked against a
 * whole declaration or the best completion of a prefix. This is the actual
 * submission-time gate, so a caller that bypassed `blockerDecision`'s offered
 * options entirely (an adapter, a fuzzer) is held to the requirement too.
 */
export function validateBlockDeclaration(
  state: GameState,
  _player: PlayerId,
  action: Extract<Action, { type: 'declareBlockers' }>,
): string | null {
  const order = eligibleBlockers(state);
  const already = state.combat.blocksSettled ?? 0;
  const priorAttackerChoices = state.combat.blockerAttacksSettled ?? 0;
  const settled = action.settled ?? order.length;
  if (!Number.isInteger(settled) || settled < 0 || settled > order.length) {
    return 'a declaration answers for between none and all of the creatures that can block';
  }
  if (settled < already) return 'a declaration cannot take back an answered blocker';
  const attackerChoices = action.attackerChoicesSettled;
  if (attackerChoices !== undefined) {
    if (settled !== already) return 'attacker choices belong to the current blocker';
    const blocker = order[settled];
    if (blocker === undefined || !canBlockAnyNumber(state, blocker)) {
      return 'only an unlimited-capacity blocker can answer attackers one at a time';
    }
    const blockable = state.combat.attacks
      .map((attack) => attack.oid)
      .filter((attacker) => canBlock(state, blocker, attacker));
    if (
      !Number.isInteger(attackerChoices) ||
      attackerChoices <= priorAttackerChoices ||
      attackerChoices >= blockable.length
    ) {
      return 'a blocker declaration must answer for at least one more attacker and leave one still to ask';
    }
  } else if (settled === already && action.settled !== undefined) {
    return 'a declaration must answer for at least one more creature or attacker';
  }
  const asked = new Set(order.slice(0, settled));
  const current = attackerChoices === undefined ? undefined : order[settled];
  if (current !== undefined) asked.add(current);
  for (const block of action.blocks) {
    if (!asked.has(block.blocker)) return `${block.blocker} has not been asked about yet`;
    if (block.blocker === current && attackerChoices !== undefined) {
      const blockable = state.combat.attacks
        .map((attack) => attack.oid)
        .filter((attacker) => canBlock(state, current, attacker));
      const index = blockable.indexOf(block.attacker);
      if (index < 0 || index >= attackerChoices) {
        return `${block.attacker} has not been asked about for ${current} yet`;
      }
    }
  }
  const standingBlocks = declaredBlocks(state);
  for (const standing of standingBlocks) {
    const kept = action.blocks.find(
      (block) => block.blocker === standing.blocker && block.attacker === standing.attacker,
    );
    if (kept === undefined) {
      return action.blocks.some((block) => block.blocker === standing.blocker)
        ? `${standing.blocker} is already blocking something else`
        : `${standing.blocker} is already blocking and cannot be taken back`;
    }
  }
  if (priorAttackerChoices > 0) {
    const priorBlocker = order[already];
    if (priorBlocker === undefined) return 'the blocker declaration progress is outside the eligible list';
    const priorBlockable = state.combat.attacks
      .map((attack) => attack.oid)
      .filter((attacker) => canBlock(state, priorBlocker, attacker));
    for (const attacker of priorBlockable.slice(0, priorAttackerChoices)) {
      const stood = standingBlocks.some(
        (block) => block.blocker === priorBlocker && block.attacker === attacker,
      );
      const now = action.blocks.some(
        (block) => block.blocker === priorBlocker && block.attacker === attacker,
      );
      if (!stood && now) return `${priorBlocker} already declined to block ${attacker}`;
    }
  }
  const whole = settled === order.length;
  const reason = validateBlocks(state, opponentOf(state.turn.active), action.blocks, whole);
  if (reason !== null) return reason;
  const available = current === undefined ? order.slice(settled) : [current, ...order.slice(settled + 1)];
  const requirements = blockRequirements(state);
  const target = maximizeBlockRequirements(state, requirements, order).coverage;
  if (whole) {
    if (blockRequirementCoverage(state, action.blocks, requirements) < target) {
      return requirements.some((requirement) => requirement.kind === 'blocker')
        ? 'the block declaration does not satisfy as many requirements as jointly possible'
        : 'not as many creatures able to block a must-be-blocked attacker are blocking it as jointly possible';
    }
  } else if (!blockRequirementsReachable(state, action.blocks, requirements, target, available)) {
    return 'no legal block finishes the joint block requirements';
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

function validateAttackerOrdering(
  state: GameState,
  orders: readonly { blocker: ObjectId; attackers: readonly ObjectId[] }[],
): string | null {
  const needed = blockersNeedingAttackerOrder(state);
  const settled = state.combat.attackersOrdered ?? {};
  const seen = new Set<ObjectId>();
  let progress = false;
  for (const order of orders) {
    if (seen.has(order.blocker)) return `${order.blocker} is ordered twice`;
    seen.add(order.blocker);
    const block = needed.find((entry) => entry.blocker === order.blocker);
    if (block === undefined) return `${order.blocker} is not a blocker that needs an ordering`;
    if (order.attackers.length > block.attackers.length) {
      return `ordering for ${block.blocker} names more creatures than it blocks`;
    }
    const members = new Set(block.attackers);
    const named = new Set<ObjectId>();
    for (const attacker of order.attackers) {
      if (!members.has(attacker)) return `${order.blocker} is not blocking ${attacker}`;
      if (named.has(attacker)) return `${attacker} is ordered twice for ${order.blocker}`;
      named.add(attacker);
    }
    const already = settled[block.blocker] ?? 0;
    if (order.attackers.length < already) {
      return `ordering for ${block.blocker} takes back a position that is already settled`;
    }
    for (const [index, spelled] of order.attackers.slice(0, already).entries()) {
      if (spelled !== block.attackers[index]) {
        return `ordering for ${block.blocker} contradicts a position that is already settled`;
      }
    }
    if (order.attackers.length > already) progress = true;
  }
  return progress ? null : 'an ordering must settle at least one position';
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
  abilityIndex?: number,
  amount?: number,
): string | null {
  const pending = state.pendingManaCombination;
  if (pending !== undefined) {
    if (pending.player !== player || pending.sourceOid !== oid) {
      return 'a different mana source is completing its color combination';
    }
    if (color === 'C') return 'a color combination cannot include colorless mana';
    if (abilityIndex !== undefined || amount !== undefined) {
      return 'a later color choice cannot change the already-activated mana ability';
    }
    return null;
  }
  const blocked = manaSourceBlocker(state, player, oid, abilityIndex);
  if (blocked !== null) return blocked;
  const intrinsic = landProducesOnBattlefield(state, oid);
  const indexed = indexedManaAbilities(state, oid);
  const colors =
    abilityIndex === undefined
      ? intrinsic.length > 0
        ? intrinsic
        : indexed.length === 1
          ? manaAbilityColors(indexed[0]!.ability)
          : []
      : manaAbilityColors(indexed.find((entry) => entry.index === abilityIndex)!.ability);
  const selected =
    abilityIndex === undefined
      ? intrinsic.length === 0 && indexed.length === 1
        ? indexed[0]
        : undefined
      : indexed.find((entry) => entry.index === abilityIndex);
  const combinationAmount =
    selected === undefined ? null : anyColorCombinationAmount(state, player, selected.ability);
  if (combinationAmount !== null) {
    if (amount !== undefined) return 'the live mana combination amount is not submitted by the player';
    if (color === 'C') return 'a color combination cannot include colorless mana';
    return null;
  }
  if (!colors.includes(color)) {
    return `source cannot produce ${color}`;
  }
  if (amount !== undefined) {
    const expected = selected === undefined ? 1 : fixedManaAbilityAmount(selected.ability);
    if (expected !== amount) return `source does not produce ${String(amount)} mana`;
  }
  return null;
}

function validateSpellTargetChoice(
  state: GameState,
  action: Extract<Action, { type: 'chooseSpellTargets' }>,
): string | null {
  const pending = state.pendingSpellTargets;
  const context = spellTargetContext(state);
  if (pending === undefined || context === null) return 'no spell is choosing new targets';
  if (action.oid !== pending.spell) return 'that spell is not choosing new targets';
  if (action.targets.length !== context.entry.targets.length) {
    return 'a target change cannot alter the number of target slots';
  }
  if (isAuraCard(context.card)) {
    const prior = context.entry.targets[0] ?? null;
    const target = action.targets[0] ?? null;
    if (
      !targetEqual(prior, target) &&
      (target === null ||
        target.kind !== 'permanent' ||
        !isLegalAuraHost(state, context.card, target.oid) ||
        !canBeTargetedBy(state, target.oid, context.entry.oid, context.controller))
    ) {
      return 'replacement target 0 is not legal for that Aura spell';
    }
    if (
      action.multiTargets !== undefined ||
      context.entry.multiTargets !== undefined ||
      action.damageAllocations !== undefined ||
      context.entry.damageAllocations !== undefined
    ) {
      return 'an Aura spell has no plural target slots';
    }
    return null;
  }
  if (!honoursDistinctSlots(context.effects, action.targets)) {
    return "the replacement targets do not satisfy the spell's distinct targets";
  }
  for (const [index, target] of action.targets.entries()) {
    const prior = context.entry.targets[index] ?? null;
    if (targetEqual(prior, target)) continue;
    const effect = context.effects[index];
    if (effect === undefined) return 'a target change names a slot the spell does not have';
    if (!isTargetStillLegal(state, effect, action.targets, index, context.controller, context.source)) {
      return `replacement target ${String(index)} is not legal for that spell`;
    }
  }

  const priorMulti = context.entry.multiTargets;
  const nextMulti = action.multiTargets;
  if (
    canonicalJson(context.entry.damageAllocations ?? null) !== canonicalJson(action.damageAllocations ?? null)
  ) {
    return 'a target change cannot alter divided damage allocations';
  }
  if ((priorMulti === undefined) !== (nextMulti === undefined)) {
    return 'a target change cannot add or remove plural target slots';
  }
  if (priorMulti === undefined || nextMulti === undefined) return null;
  const priorKeys = Object.keys(priorMulti).sort();
  const nextKeys = Object.keys(nextMulti).sort();
  if (canonicalJson(priorKeys) !== canonicalJson(nextKeys)) {
    return 'a target change cannot add or remove plural target slots';
  }
  for (const rawIndex of priorKeys) {
    const index = Number(rawIndex);
    const prior = priorMulti[index] ?? [];
    const next = nextMulti[index] ?? [];
    if (prior.length !== next.length) return 'a target change cannot alter target count';
    if (uniqueTargets(next).length !== next.length)
      return 'a spell cannot target the same object twice in one list';
    const effect = context.effects[index];
    if (effect === undefined) return 'a target change names a slot the spell does not have';
    for (const [position, target] of next.entries()) {
      const previous = prior[position];
      if (previous !== undefined && sameTarget(previous, target)) continue;
      const candidates = multipleTargetCandidates(
        state,
        effect,
        context.controller,
        context.source,
        position,
      );
      if (!candidates.some((candidate) => sameTarget(candidate, target))) {
        return `replacement target ${String(index)} is not legal for that spell`;
      }
    }
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
  if (state.pendingManaCombination !== undefined && action.type !== 'activateManaAbility') {
    return 'the resolving mana ability still needs a color choice';
  }

  switch (action.type) {
    case 'passPriority':
      return decision.kind === 'priority' && state.pendingManaCombination === undefined
        ? null
        : 'you owe a different decision first';
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
    case 'beginCastSpell':
      if (decision.kind !== 'priority' && decision.kind !== 'freeCast') {
        return 'you owe a different decision first';
      }
      if (decision.kind === 'freeCast' && action.castingCost !== 'withoutMana') {
        return 'the revealed card must use the cast-without-mana choice';
      }
      if (
        decision.kind === 'freeCast' &&
        (state.pendingFreeCast === undefined ||
          pendingFreeCastCandidate(state, state.pendingFreeCast, action.oid) === null)
      ) {
        return 'the revealed card is the only spell this decision may cast';
      }
      if (action.type === 'beginCastSpell') return validateBeginCast(state, action);
      return validateCast(
        state,
        action.player,
        action.oid,
        action.targets,
        action.x,
        action.mode,
        action.multiTargets,
        action.damageAllocations,
        action.castingCost,
        action.sacrifices ?? [],
        action.discards ?? [],
      );
    case 'choosePluralTarget':
      if (decision.kind !== 'pluralTargets') return 'no plural target choice is pending';
      return decision.options.some((option) => canonicalJson(option) === canonicalJson(action))
        ? null
        : 'that is not a legal next plural target choice';
    case 'allocateDividedDamage':
      if (decision.kind !== 'damageAllocation') return 'no divided damage allocation is pending';
      return decision.options.some((option) => canonicalJson(option) === canonicalJson(action))
        ? null
        : 'that is not a legal next damage allocation';
    case 'activateManaAbility':
      if (decision.kind !== 'priority') return 'you owe a different decision first';
      return validateManaAbility(
        state,
        action.player,
        action.oid,
        action.color,
        action.abilityIndex,
        action.amount,
      );
    case 'chooseManaColor':
      if (decision.kind !== 'manaColor') return 'no stack-using mana effect is choosing a color';
      return decision.colors.includes(action.color) ? null : 'that color is not offered by this effect';
    case 'activateAbility':
      if (decision.kind !== 'priority') return 'you owe a different decision first';
      return validateActivation(
        state,
        action.player,
        action.oid,
        action.abilityIndex,
        action.targets,
        action.multiTargets,
        action.damageAllocations,
        action.sacrifices,
        action.taps,
        action.discards ?? [],
        action.x,
        action.mode,
      );
    case 'chooseTriggerTargets':
      if (decision.kind !== 'triggerTargets') return 'no trigger is choosing targets';
      return validateTriggerTargets(
        state,
        action.oid,
        action.targets,
        action.multiTargets,
        action.damageAllocations,
      );
    case 'answerOptionalTrigger':
      if (decision.kind !== 'optionalTrigger') return 'no optional trigger is resolving';
      return validateOptionalTrigger(state, action.oid, action.accept);
    case 'answerMay':
      if (decision.kind !== 'may') return 'no spell is awaiting a "you may" answer';
      return validateMay(state, action.oid);
    case 'answerUnless':
      if (decision.kind !== 'unless') return 'no spell is awaiting an "unless" answer';
      return validateUnless(state, action.player, action.oid);
    case 'declineFreeCast':
      return decision.kind === 'freeCast' && state.pendingFreeCast?.optional === true
        ? decision.oid === action.oid
          ? null
          : 'a different free cast is pending'
        : 'no optional free cast is pending';
    case 'keepLegend':
      if (decision.kind !== 'legendRule') return 'the legend rule is not being applied';
      return validateKeepLegend(state, action.player, action.oid);
    case 'sacrificePermanent':
      if (decision.kind !== 'permanentSacrifice') return 'no sacrifice is resolving';
      return validatePermanentSacrifice(state, action.player, action.oid);
    case 'choosePermanentToUntap':
      if (decision.kind !== 'permanentUntap') return 'no permanent untap is resolving';
      return validatePermanentUntap(state, action.player, action.oid);
    case 'chooseCardName':
      if (decision.kind !== 'cardName') return 'no card-name choice is resolving';
      if (action.name.trim().length === 0) return 'a card name cannot be empty';
      if (state.pendingCardNameChoice?.targetPlayer !== undefined && namesKnownLand(state, action.name)) {
        return 'the chosen name must be a nonland card name';
      }
      return action.name.length <= MAX_CARD_NAME_LENGTH
        ? null
        : `a card name cannot exceed ${String(MAX_CARD_NAME_LENGTH)} characters`;
    case 'chooseNamedZoneExile':
      if (decision.kind !== 'namedZoneExile') return 'no named-zone exile choice is resolving';
      if (action.oid === null) return null;
      return decision.cards.includes(action.oid) ? null : `${action.oid} is not an available named card`;
    case 'chooseSpellTargets':
      if (decision.kind !== 'spellTargets') return 'no spell is choosing new targets';
      return validateSpellTargetChoice(state, action);
    case 'chooseEntryCopy':
      if (decision.kind !== 'entryCopy') return 'no permanent is choosing copied entry values';
      if (action.oid !== decision.oid) return 'that permanent is not awaiting copied entry values';
      if (action.copyOf === null) return null;
      return decision.creatures.includes(action.copyOf)
        ? null
        : `${action.copyOf} is not a legal creature to copy`;
    case 'chooseEntryCounterPermanent':
      if (decision.kind !== 'entryCounter') return 'no permanent is choosing an as-entry counter bearer';
      if (action.oid !== decision.oid) return 'that permanent is not awaiting an entry counter choice';
      return decision.permanents.includes(action.permanent)
        ? null
        : `${action.permanent} is not a legal entry counter bearer`;
    case 'chooseEntryAuraHost':
      if (decision.kind !== 'entryAura') return 'no Aura is choosing an as-entry host';
      if (action.oid !== decision.oid) return 'that Aura is not awaiting an entry host';
      return decision.permanents.includes(action.host) ? null : `${action.host} is not a legal Aura host`;
    case 'chooseEntryTimestampNext':
      if (decision.kind !== 'entryTimestampOrder') return 'no entry timestamp order is being chosen';
      return decision.remaining.includes(action.oid)
        ? null
        : `${action.oid} is not available in the current entry timestamp order`;
    case 'chooseEntryCharacteristics':
      if (decision.kind !== 'entryCharacteristics') {
        return 'no creature is choosing as-entry characteristics';
      }
      if (action.oid !== decision.oid) return 'that creature is not awaiting entry characteristics';
      return Number.isSafeInteger(action.mode) && action.mode >= 0 && action.mode < decision.modes.length
        ? null
        : `${String(action.mode)} is not a legal entry characteristic mode`;
    case 'chooseEntryOptionalCounter':
      if (decision.kind !== 'entryOptionalCounter') {
        return 'no permanent is choosing an optional entry counter';
      }
      return action.oid === decision.oid
        ? null
        : 'that permanent is not awaiting an optional entry counter choice';
    case 'chooseEntryPayLife':
      if (decision.kind !== 'entryPayLife') {
        return 'no permanent is choosing an entry life payment';
      }
      if (action.oid !== decision.oid) return 'that permanent is not awaiting an entry life payment';
      if (action.life !== decision.life) return 'that is not the offered entry life payment';
      return decision.options.some(
        (option) => option.type === 'chooseEntryPayLife' && option.pay === action.pay,
      )
        ? null
        : `you cannot pay ${String(decision.life)} life`;
    case 'chooseEntryPlayer':
      if (decision.kind !== 'entryPlayer') return 'no permanent is choosing an as-entry player';
      if (action.oid !== decision.oid) return 'that permanent is not awaiting an entry player';
      return state.players.some((player) => player.id === action.chosen)
        ? null
        : `${String(action.chosen)} is not a player in this game`;
    case 'chooseEntryColors':
      if (decision.kind !== 'entryColors') return 'no permanent is choosing as-entry colors';
      if (action.oid !== decision.oid) return 'that permanent is not awaiting entry colors';
      return decision.options.some(
        (option) =>
          option.type === 'chooseEntryColors' &&
          option.colors[0] === action.colors[0] &&
          option.colors[1] === action.colors[1],
      )
        ? null
        : 'entry colors must be two distinct colors in WUBRG order';
    case 'allocateDamagePrevention': {
      if (decision.kind !== 'damagePrevention') return 'no damage prevention allocation is pending';
      if (action.sourceOid !== decision.source.sourceOid) {
        return `${action.sourceOid} is not the source currently being allocated`;
      }
      if (!Number.isSafeInteger(action.amount)) return 'the prevention allocation must be a safe integer';
      const pending = state.pendingDamagePrevention;
      if (pending === undefined) return 'no damage prevention allocation is pending';
      const { minimum, maximum } = damagePreventionRange(pending);
      return action.amount < minimum || action.amount > maximum
        ? `the prevention allocation must be between ${String(minimum)} and ${String(maximum)}`
        : null;
    }
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
    case 'orderTopLibrary':
      if (decision.kind !== 'topLibraryOrder') return 'no top-library order is resolving';
      return sameMembers(action.cards, decision.cards)
        ? null
        : 'the order must contain every looked-at card exactly once';
    case 'selectFromTopLibrary': {
      if (decision.kind !== 'topLibrarySelect') return 'no top-library selection is resolving';
      if (action.chosen !== null && !decision.eligible.includes(action.chosen))
        return 'that card is not an eligible selection';
      const expected = decision.cards.filter((oid) => oid !== action.chosen);
      if (
        state.pendingTopLibrary?.selectionRest === 'graveyard' &&
        JSON.stringify(action.rest) !== JSON.stringify(expected)
      ) {
        return 'the graveyard remainder must preserve the revealed order';
      }
      return sameMembers(action.rest, expected)
        ? null
        : 'the remainder must contain every unchosen card exactly once';
    }
    case 'separateTopLibraryPiles':
      if (decision.kind !== 'topLibraryPartition') return 'no top-library partition is resolving';
      return sameMembers([...action.first, ...action.second], decision.cards)
        ? null
        : 'the piles must contain every revealed card exactly once';
    case 'chooseTopLibraryPile':
      return decision.kind === 'topLibraryPile' ? null : 'no top-library pile choice is resolving';
    case 'searchLibrary': {
      if (decision.kind !== 'searchLibrary') return 'no search is resolving';
      if (action.found === null) {
        return state.pendingSearch?.mayFail === true ? null : 'this unrestricted search must find a card';
      }
      return decision.cards.includes(action.found)
        ? null
        : `${action.found} is not a card this search may find`;
    }
    case 'chooseSearchDestination':
      if (decision.kind !== 'searchDestination') return 'no search destination is being chosen';
      return decision.cards.includes(action.one) ? null : `${action.one} is not a card found by this search`;
    case 'chooseFromGraveyard': {
      if (decision.kind !== 'graveyardChoice') return 'no graveyard choice is resolving';
      if (action.chosen === null) return null;
      return decision.cards.includes(action.chosen)
        ? null
        : `${action.chosen} is not a card this effect may take from a graveyard`;
    }
    case 'chooseFromRevealedHand': {
      if (decision.kind !== 'revealedHandChoice') return 'no revealed-hand choice is resolving';
      if (action.chosen === null) {
        return state.pendingRevealedHandChoice?.outcome.kind === 'mayCastWithoutPayingManaCost'
          ? null
          : 'this revealed-hand choice cannot be declined';
      }
      return decision.cards.includes(action.chosen)
        ? null
        : `${action.chosen} is not an eligible card from the revealed hand`;
    }
    case 'chooseFromBattlefield': {
      if (decision.kind !== 'battlefieldChoice') return 'no battlefield choice is resolving';
      return decision.permanents.includes(action.chosen)
        ? null
        : `${action.chosen} is not a permanent this effect may return`;
    }
    case 'choosePopulateToken': {
      if (decision.kind !== 'populate') return 'no Populate choice is resolving';
      return decision.tokens.includes(action.token)
        ? null
        : `${action.token} is not a creature token this effect may copy`;
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
    case 'orderAttackers':
      if (decision.kind !== 'orderAttackers') return 'attacker order is not being chosen';
      return validateAttackerOrdering(state, action.orders);
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
    case 'chooseOpeningHandAction': {
      if (decision.kind !== 'openingHandAction') return 'you owe a different decision first';
      if (action.oid === null) return null;
      const object = tryObject(state, action.oid);
      if (object === undefined || object.zone !== 'hand' || object.owner !== action.player) {
        return 'card is not in your opening hand';
      }
      return openingHandActionOf(object.card) === undefined
        ? 'card has no eligible opening-hand action'
        : null;
    }
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
