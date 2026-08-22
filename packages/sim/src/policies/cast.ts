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
 */
import type { Card } from '@mtg/dsl';
import { cardManaValue, effectsFor } from '@mtg/dsl';
import type { Action, AgentView, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { availableMana, getObject } from '@mtg/kernel';
import type { CastPolicyConfig, GreedyBotConfig } from '../config';
import { printedCardValue } from '../evaluate';
import { scoreTargets } from './target';

type CastAction = Extract<Action, { type: 'castSpell' }>;

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
): boolean {
  const isTrick = effectsFor(card, mode).some((effect) => effect.kind === 'pumpUntilEndOfTurn');
  if (isTrick && state.combat.attacks.length === 0) return false;
  if (card.kind !== 'instant' || !config.holdInstants) return true;
  if (state.stack.length > 0) return true;
  if (state.turn.active !== me) return true;
  return COMBAT_RESPONSE_STEPS.has(state.turn.step);
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
    if (option.type !== 'castSpell') continue;
    const card = getObject(state, option.oid).card;
    const mode = option.mode ?? null;
    const timingKey = `${String(option.oid)}:${String(mode)}`;
    let allowed = timingOk.get(timingKey);
    if (allowed === undefined) {
      allowed = castTimingAllows(state, view.player, card, mode, config.cast);
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
      );
    if (!allowed && value < config.target.lethalBonus) continue;
    const existing = best.get(option.oid);
    if (existing === undefined || value > existing.value) {
      best.set(option.oid, {
        action: option,
        card,
        value,
        cost: cardManaValue(card) + (option.x ?? 0),
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
