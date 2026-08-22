/**
 * Legend-rule policy: which copy of a legend to keep (CR 704.5j).
 *
 * The kernel enumerates one option per same-named legendary permanent the seat
 * controls, so this policy never has to know what is legal — only which body it
 * would rather be left with. `boardCreatureValue` is the same evaluator the cast
 * and targeting policies price a creature with, so a legend that has been pumped,
 * counter-loaded or damaged is priced here exactly as it is priced everywhere
 * else, and the three cannot come apart.
 *
 * A noncreature legend scores zero from that evaluator and every option in such a
 * collision therefore ties. That is a real limit and not a hidden one: the tie
 * breaks on enumeration order, which is entry order, so a collision of two
 * legendary artifacts keeps the older. The two things that separate them on a
 * board this bot can read — counters and marked damage — only exist on a
 * creature, so the honest score for two otherwise identical artifacts is the
 * same score.
 *
 * Tapped state is deliberately not a term. A permanent kept while tapped untaps
 * on its controller's next untap step, so preferring the untapped one would be
 * buying half a turn at the price of whatever the tapped one is actually worth,
 * and the evaluator already prices that.
 */
import type { Action, AgentView, Decision } from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { boardCreatureValue } from '../evaluate';

type KeepLegendAction = Extract<Action, { type: 'keepLegend' }>;
type LegendRuleDecision = Extract<Decision, { kind: 'legendRule' }>;

/**
 * Keeps the most valuable of the duplicates, ties going to enumeration order so
 * the bot stays deterministic at a seed.
 */
export function chooseLegendToKeep(
  view: AgentView,
  config: GreedyBotConfig,
  decision: LegendRuleDecision,
): KeepLegendAction {
  let best: KeepLegendAction | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const option of decision.options) {
    if (option.type !== 'keepLegend') continue;
    const value = boardCreatureValue(config.cast, view.state, option.oid);
    if (value > bestValue) {
      best = option;
      bestValue = value;
    }
  }
  if (best === null) {
    throw new Error(`legend policy: the kernel asked which ${decision.name} to keep and offered none`);
  }
  return best;
}
