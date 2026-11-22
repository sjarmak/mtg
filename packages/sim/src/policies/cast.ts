/**
 * Cast policy: what to cast, at what, and when.
 *
 * Three named heuristics:
 *
 *  - `bestTargetingPerCard` — collapses the kernel's enumerated (card, target
 *    tuple) options down to one best-scoring option per card.
 *  - `castTimingAllows` — holds instants for the opponent's turn or for after
 *    blockers, and holds combat tricks until there is a combat to trick.
 *  - `bestSpendPlan` — the mana-efficiency half: picks the highest-value set of
 *    spells that fits under this turn's available mana, so the bot casts two
 *    two-drops rather than one four-drop when that is worth more. Exhaustive
 *    while the candidate set is small, value-per-mana greedy above that.
 *
 * Plus one subtraction the three of them share: a permanent that a state
 * trigger removes the instant it arrives is worth its body to nobody, so
 * `diesOnArrival` takes the body back out of the score
 * (`policies/entry-survival.ts`).
 */
import type { Card } from '@mtg/dsl';
import { manaValue, spellEffectsFor } from '@mtg/dsl';
import type { Action, AgentView, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { availableMana, countTargetInstances, getObject, selectedCastingManaCost } from '@mtg/kernel';
import type { CastPolicyConfig, GreedyBotConfig } from '../config';
import { boardCreatureValue, printedCardValue } from '../evaluate';
import { diesOnArrival } from './entry-survival';
import { scoreTargets } from './target';

type CastAction = Extract<Action, { type: 'castSpell' | 'beginCastSpell' }>;

export interface CastCandidate {
  readonly action: CastAction;
  readonly card: Card;
  readonly value: number;
  readonly cost: number;
}

const COMBAT_RESPONSE_STEPS = new Set([
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
]);

/**
 * True when this card should be cast at this moment rather than held.
 *
 * `mode` is the option's chosen mode (`null` off a non-modal card, matching
 * `effectsFor`'s own convention): a modal card's `card.effects` is empty by
 * construction, so reading it here would never recognize a pump mode as a
 * trick and would let the bot fire it outside combat every time.
 */
export function castTimingAllows(
  state: GameState,
  me: PlayerId,
  card: Card,
  mode: number | null,
  config: CastPolicyConfig,
  castingCost?: CastAction['castingCost'],
): boolean {
  const effects =
    castingCost === 'overload'
      ? spellEffectsFor(card, null, 'overload')
      : spellEffectsFor(card, mode, 'ordinary');
  const isTrick = effects.some((effect) => effect.kind === 'pumpUntilEndOfTurn');
  if (isTrick && state.combat.attacks.length === 0) return false;
  if (card.kind !== 'instant' || !config.holdInstants) return true;
  if (state.stack.length > 0) return true;
  if (state.turn.active !== me) return true;
  return COMBAT_RESPONSE_STEPS.has(state.turn.step);
}

/**
 * What this cast option gives up to pay its additional sacrifice.
 *
 * The kernel enumerates one option per legal sacrifice set, and nothing else
 * about the option changes with it, so an unpriced payment left the policy
 * choosing between them by enumeration order — `mtg-sejo`: a bot at 21 life
 * against a 4/2 sacrificed a 2/3 flying first striker to Fling for two, with a
 * worse creature standing beside it. Priced, the same scan takes the cheapest
 * body that pays, and a Fling that costs more than it deals scores at or below
 * zero, which is where `chooseCast` already holds the card.
 *
 * `boardCreatureValue` is the one function this package prices a creature with,
 * the same one `choosePermanentToSacrifice` reads; a noncreature permanent ties
 * at zero there and does here for the same reason.
 */
function sacrificedValue(
  state: GameState,
  sacrifices: readonly ObjectId[] | undefined,
  config: GreedyBotConfig,
): number {
  if (sacrifices === undefined) return 0;
  return sacrifices.reduce((sum, oid) => sum + boardCreatureValue(config.cast, state, oid), 0);
}

/**
 * The body this cast does not actually get to keep.
 *
 * A permanent whose own state trigger sacrifices it on arrival is on the
 * battlefield for no priority at all, so what the caster buys is the spell's
 * effects and none of the permanent — which on Phylactery Lich, the card that
 * reported this, is nothing whatsoever. Subtracting the printed value rather
 * than filtering the option keeps the two halves separable: a permanent that
 * dies on arrival but resolves a worthwhile effect on the way still scores that
 * effect, and `chooseCast` holds anything that lands at or below zero, which is
 * where a bare doomed body lands.
 */
function doomedBodyValue(state: GameState, player: PlayerId, card: Card, config: GreedyBotConfig): number {
  if (card.kind === 'instant' || card.kind === 'sorcery') return 0;
  return diesOnArrival(state, player, card) ? printedCardValue(config.cast, card) : 0;
}

/** What this cast option gives up from hand as its additional discard. */
function discardedValue(
  state: GameState,
  discards: readonly ObjectId[] | undefined,
  config: GreedyBotConfig,
): number {
  if (discards === undefined) return 0;
  return discards.reduce((sum, oid) => sum + printedCardValue(config.cast, getObject(state, oid).card), 0);
}

/**
 * One best-scoring option per castable card in hand.
 *
 * The timing filter is applied per option rather than per card, because a line
 * that wins the game on resolution is never held: `scoreTargets` marks it with
 * `lethalBonus`, and that overrides `castTimingAllows`.
 */
export function bestTargetingPerCard(view: AgentView, config: GreedyBotConfig): readonly CastCandidate[] {
  const state = view.state;
  const best = new Map<ObjectId, CastCandidate>();
  // Keyed by oid and mode together: a modal card offers one `castSpell`
  // option per mode (`legal.ts`'s `modeOptionsFor`), and one mode can be a
  // combat trick while another is not, so the timing verdict for one mode
  // must not be reused for its siblings.
  const timingOk = new Map<string, boolean>();
  for (const option of view.decision.options) {
    if (option.type !== 'castSpell' && option.type !== 'beginCastSpell') continue;
    const physical = getObject(state, option.oid);
    const card =
      view.decision.kind === 'freeCast' && state.pendingFreeCast?.oid === option.oid
        ? (state.pendingFreeCast.card ?? physical.card)
        : physical.card;
    if (card.kind === 'land') continue;
    const mode = option.mode ?? null;
    const timingKey = `${String(option.oid)}:${String(mode)}:${String(option.castingCost)}`;
    let allowed = timingOk.get(timingKey);
    if (allowed === undefined) {
      allowed =
        view.decision.kind === 'freeCast' ||
        castTimingAllows(state, view.player, card, mode, config.cast, option.castingCost);
      timingOk.set(timingKey, allowed);
    }
    const value =
      printedCardValue(config.cast, card) +
      scoreTargets(
        state,
        view.player,
        card,
        option.targets,
        config.cast,
        config.target,
        config.race,
        option.x ?? 0,
        mode,
        option.type === 'castSpell' ? option.multiTargets : undefined,
        option.type === 'castSpell' ? option.damageAllocations : undefined,
        option.sacrifices,
        option.castingCost,
      ) -
      sacrificedValue(state, option.sacrifices, config) -
      discardedValue(state, option.discards, config) -
      doomedBodyValue(state, view.player, card, config);
    if (!allowed && value < config.target.lethalBonus) continue;
    const existing = best.get(option.oid);
    const cost = manaValue(
      selectedCastingManaCost(
        state,
        view.player,
        card,
        option.x,
        option.castingCost ?? 'mana',
        countTargetInstances(option.targets, option.type === 'castSpell' ? option.multiTargets : undefined),
      ),
    );
    // Identical declarations keep the live no-mana price. A printed
    // alternative still loses its old tie against the ordinary price because
    // its life or permanent payment is not represented by `cost`.
    if (
      existing === undefined ||
      value > existing.value ||
      (value === existing.value &&
        ((option.castingCost === 'withoutMana' && existing.action.castingCost !== 'withoutMana') ||
          (existing.action.castingCost === 'alternative' && option.castingCost !== 'alternative')))
    ) {
      best.set(option.oid, {
        action: option,
        card,
        value,
        cost,
      });
    }
  }
  return [...best.values()];
}

function planValue(plan: readonly CastCandidate[], weight: number): number {
  let total = 0;
  for (const candidate of plan) total += candidate.value + candidate.cost * weight;
  return total;
}

function exhaustivePlan(
  candidates: readonly CastCandidate[],
  mana: number,
  weight: number,
): readonly CastCandidate[] {
  let best: readonly CastCandidate[] = [];
  let bestValue = 0;
  const total = 1 << candidates.length;
  for (let mask = 1; mask < total; mask += 1) {
    const chosen: CastCandidate[] = [];
    let spend = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const candidate = candidates[index];
      if (candidate === undefined) continue;
      spend += candidate.cost;
      if (spend > mana) break;
      chosen.push(candidate);
    }
    if (spend > mana || chosen.length === 0) continue;
    const value = planValue(chosen, weight);
    if (value > bestValue) {
      bestValue = value;
      best = chosen;
    }
  }
  return best;
}

function greedyPlan(
  candidates: readonly CastCandidate[],
  mana: number,
  weight: number,
): readonly CastCandidate[] {
  const ranked = [...candidates].sort(
    (a, b) => b.value / Math.max(1, b.cost) - a.value / Math.max(1, a.cost),
  );
  const chosen: CastCandidate[] = [];
  let spend = 0;
  for (const candidate of ranked) {
    if (candidate.value + candidate.cost * weight <= 0) continue;
    if (spend + candidate.cost > mana) continue;
    chosen.push(candidate);
    spend += candidate.cost;
  }
  return chosen;
}

/**
 * Hard ceiling on the width of the subset search, above the profile's own
 * `planMaxCandidates`. The profile tunes where the exact search stops being
 * worth its cost; this bounds where it stops being safe at all, and a profile
 * cannot raise it.
 *
 * Two things break above it. The search is 2^n masks over n candidates, so 16
 * costs about a million inner steps and 20 costs twenty million — per priority
 * decision, in a run of ten thousand games. And `1 << n` is a 32-bit signed
 * operation, so at n >= 31 the mask count overflows (`1 << 32` is 1) and the
 * loop plans nothing at all, which reads as a bot that declines to cast.
 *
 * Sixteen distinct castable cards in hand is already past anything a real game
 * reaches, so the ceiling bounds the pathological case without touching the
 * real one.
 */
export const MAX_EXHAUSTIVE_PLAN_CANDIDATES = 16;

/** The highest-value set of casts that fits under this turn's available mana. */
export function bestSpendPlan(
  candidates: readonly CastCandidate[],
  mana: number,
  config: CastPolicyConfig,
): readonly CastCandidate[] {
  if (candidates.length === 0) return [];
  const width = Math.min(config.planMaxCandidates, MAX_EXHAUSTIVE_PLAN_CANDIDATES);
  if (candidates.length <= width) {
    return exhaustivePlan(candidates, mana, config.manaEfficiencyWeight);
  }
  return greedyPlan(candidates, mana, config.manaEfficiencyWeight);
}

/** The cast to make right now, or `null` when the bot would rather hold up mana. */
export function chooseCast(view: AgentView, config: GreedyBotConfig): CastAction | null {
  const candidates = bestTargetingPerCard(view, config);
  if (candidates.length === 0) return null;
  const mana = availableMana(view.state, view.player);
  const plan = bestSpendPlan(candidates, mana, config.cast);
  let best: CastCandidate | null = null;
  for (const candidate of plan) {
    if (candidate.value <= 0) continue;
    if (best === null || candidate.value > best.value) best = candidate;
  }
  return best === null ? null : best.action;
}
