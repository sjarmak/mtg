/**
 * Trigger policy: where to aim a triggered ability, and whether to take an
 * optional one.
 *
 * The two decisions CR 603.3 hands a player about an ability they never chose to
 * put on the stack. The kernel has already enumerated every legal target tuple
 * (CR 603.3d) and the two answers to a "you may" (CR 603.3b), so this policy
 * never has to know what is legal — only what is good.
 *
 * It scores both through `scoreEffectTargets`, which is the same switch a
 * spell's targets and an activation's go through, and that shared evaluator is
 * the whole point. Risk 3 of `docs/design/dsl-v1-ability-model.md` is a mechanic
 * the bots technically fire and never fire *usefully*: a balance sweep over a
 * set whose death trigger puts its +1/+1 counter on the opponent's best creature
 * reports healthy win rates for a format nobody has played. A trigger's counter
 * is priced here exactly as the same counter from a spell is priced, so the two
 * cannot come apart.
 *
 * Neither decision can be declined into nothing. A trigger that owes targets
 * must be aimed — the kernel removed it already if it could not be — so this
 * takes the best option however bad it is, and "the best of several bad aims" is
 * a real answer where `null` would be a bot that cannot answer a question it was
 * asked.
 */
import { effectsFor, manaValue } from '@mtg/dsl';
import type { Action, AgentView, Decision, ObjectId, Target } from '@mtg/kernel';
import { spellAwaitingMay, spellAwaitingUnless, triggerOnStack } from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { scoreEffectTargets } from './target';

type ChooseTargetsAction = Extract<Action, { type: 'chooseTriggerTargets' }>;
type AnswerAction = Extract<Action, { type: 'answerOptionalTrigger' }>;
type AnswerMayAction = Extract<Action, { type: 'answerMay' }>;
type AnswerUnlessAction = Extract<Action, { type: 'answerUnless' }>;
type TriggerTargetsDecision = Extract<Decision, { kind: 'triggerTargets' }>;
type OptionalTriggerDecision = Extract<Decision, { kind: 'optionalTrigger' }>;
type MayDecision = Extract<Decision, { kind: 'may' }>;
type UnlessDecision = Extract<Decision, { kind: 'unless' }>;

/** What this ability's printed effects are worth aimed at this exact tuple. */
function targetValue(
  view: AgentView,
  config: GreedyBotConfig,
  oid: ObjectId,
  targets: readonly (Target | null)[],
): number {
  const pending = triggerOnStack(view.state, oid);
  if (pending === null) return 0;
  // The trigger's own source, which is what a fight on an enters trigger
  // fights with; every other primitive ignores it. `pending.source` and not
  // `oid`: `oid` identifies the *stack entry*, which is not a game object and
  // has no power to fight with, and passing it crashed a sim worker the first
  // time a set printed a fight (`unknown game object` out of `powerOf`). The
  // two ids were interchangeable for every primitive that ignores the source,
  // which is why nothing caught it until one did not.
  return scoreEffectTargets(
    view.state,
    view.player,
    pending.ability.effects,
    targets,
    config.cast,
    config.target,
    config.race,
    0,
    pending.source,
  );
}

/**
 * Where to aim a trigger being put on the stack (CR 603.3d).
 *
 * Ties go to enumeration order, which is the kernel's `cartesian` over the
 * target spaces, so the bot is deterministic at a seed the way every other
 * policy here is.
 */
export function chooseTriggerTargets(
  view: AgentView,
  config: GreedyBotConfig,
  decision: TriggerTargetsDecision,
): ChooseTargetsAction {
  let best: ChooseTargetsAction | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const option of decision.options) {
    if (option.type !== 'chooseTriggerTargets') continue;
    const value = targetValue(view, config, option.oid, option.targets);
    if (value > bestValue) {
      best = option;
      bestValue = value;
    }
  }
  if (best === null) {
    throw new Error(`trigger policy: the kernel asked ${decision.oid} for targets and offered none`);
  }
  return best;
}

/**
 * Whether to take an optional trigger as it resolves (CR 603.3b).
 *
 * Zero is the threshold and it is not a tuned one: the ability costs nothing to
 * take, so the question is only whether resolving it leaves this seat better off
 * than not resolving it. A trigger aimed at the one legal target on a board
 * where that target is the opponent's creature scores negative and is declined,
 * which is the case that makes declining a real policy rather than a formality.
 */
export function answerOptionalTrigger(
  view: AgentView,
  config: GreedyBotConfig,
  decision: OptionalTriggerDecision,
): AnswerAction {
  const value = targetValue(view, config, decision.oid, decision.targets);
  return { type: 'answerOptionalTrigger', player: view.player, oid: decision.oid, accept: value > 0 };
}

/** What this "you may" spell's printed effects are worth aimed at this exact tuple. */
function mayValue(
  view: AgentView,
  config: GreedyBotConfig,
  oid: ObjectId,
  targets: readonly (Target | null)[],
): number {
  const pending = spellAwaitingMay(view.state);
  if (pending === null || pending.entry.oid !== oid) return 0;
  return scoreEffectTargets(
    view.state,
    view.player,
    effectsFor(pending.card, pending.entry.mode),
    targets,
    config.cast,
    config.target,
    config.race,
  );
}

/**
 * Whether to take a spell's "you may" as it resolves (CR 601.2c).
 *
 * `answerOptionalTrigger`'s policy exactly, widened to a spell: zero is the
 * threshold, and it is not tuned any differently, because the question is
 * still only whether resolving leaves this seat better off than not.
 */
export function answerMay(view: AgentView, config: GreedyBotConfig, decision: MayDecision): AnswerMayAction {
  const value = mayValue(view, config, decision.oid, decision.targets);
  return { type: 'answerMay', player: view.player, oid: decision.oid, accept: value > 0 };
}

/**
 * Whether to pay a spell's printed toll as it resolves (CR 118.8).
 *
 * Not `answerMay`'s policy, because the threshold is not zero. The other two
 * questions in this file compare doing a thing against doing nothing, and
 * nothing is free; this one compares two things that both cost, so the toll is
 * paid when what the spell would take is worth more than the mana that stops
 * it.
 *
 * Both halves of that comparison are borrowed rather than invented, and each
 * one had a wrong-looking obvious answer.
 *
 * The spell is scored **from its caster's seat**, not from the seat being
 * charged. Scoring it from the payer's own seat is the reading that first
 * suggests itself — the payer is the one deciding — and it produces a bot that
 * pays any toll below {50} to save a 0/1. `destroyScore` returns a flat
 * `-ownGoalPenalty` for a permanent belonging to the player it is scoring for,
 * and that number is a *sentinel* that keeps a bot from aiming its own removal
 * at itself, not a valuation of the creature. Read as a valuation it prices
 * every creature on the board identically. From the caster's seat the same
 * function returns `boardCreatureValue + killBonus + threatValue`, which is
 * what this creature in particular is worth, and denying it is exactly what
 * the payer is buying.
 *
 * The price is converted through `target.tollManaWeight` rather than compared
 * raw. A bare `manaValue` comparison mixes units: everything this module
 * produces is denominated in board score, and mana is not. That weight is not
 * `activate.manaValueWeight` either, for the reason its own comment gives —
 * that one prices mana that would otherwise go unused on our own turn, and a
 * toll is paid at instant speed out of mana with other uses.
 *
 * What it still does not weigh is what else that mana was for. It undercounts
 * a toll paid on the payer's own turn with a spell of their own to cast, and
 * overcounts one paid at the end of an opponent's turn with nothing else to
 * spend it on. The tier-1 bots have no notion of a plan to weigh either
 * against.
 *
 * A payer who cannot afford the price is never asked (`unless-choice.ts`), so
 * there is no arm here for "would pay but cannot".
 */
export function answerUnless(
  view: AgentView,
  config: GreedyBotConfig,
  decision: UnlessDecision,
): AnswerUnlessAction {
  const pending = spellAwaitingUnless(view.state);
  const denied =
    pending === null || pending.entry.oid !== decision.oid
      ? 0
      : scoreEffectTargets(
          view.state,
          pending.entry.controller,
          effectsFor(pending.card, pending.entry.mode),
          decision.targets,
          config.cast,
          config.target,
          config.race,
        );
  return {
    type: 'answerUnless',
    player: view.player,
    oid: decision.oid,
    pay: denied > manaValue(decision.cost) * config.target.tollManaWeight,
  };
}
