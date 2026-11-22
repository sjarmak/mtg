/**
 * Sacrifice policy: which of the affected player's own filtered permanents a
 * resolving `sacrificePermanent` gives up (CR 701.17a).
 *
 * `legend.ts`'s policy inverted rather than duplicated with a new evaluator:
 * both ask the kernel's enumerated options which one this seat would rather be
 * left with. `boardCreatureValue` is the one function this package prices a
 * creature with everywhere else; noncreatures deliberately tie at zero until
 * the bot has a general permanent evaluator. A legend rule keeps the best of
 * several duplicates; a sacrifice gives up the lowest-valued candidate, so the
 * same scan with the comparison flipped is the whole difference — `<` in place
 * of `>`, with ties retaining enumeration order so the bot stays deterministic
 * at a seed.
 *
 * This runs whichever seat the sacrifice targets, never the caster: the
 * kernel only offers this decision to the player CR 701.17a makes choose, so
 * there is no branch here for "aimed at me" versus "aimed at them" the way
 * `misc.ts`'s `chooseDiscards` needs one.
 */
import type { Action, AgentView, Decision } from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { boardCreatureValue } from '../evaluate';

type SacrificePermanentAction = Extract<Action, { type: 'sacrificePermanent' }>;
type PermanentSacrificeDecision = Extract<Decision, { kind: 'permanentSacrifice' }>;

/**
 * Gives up the least valuable eligible permanent, ties going to enumeration
 * order so the bot stays deterministic at a seed.
 */
export function choosePermanentToSacrifice(
  view: AgentView,
  config: GreedyBotConfig,
  decision: PermanentSacrificeDecision,
): SacrificePermanentAction {
  let worst: SacrificePermanentAction | null = null;
  let worstValue = Number.POSITIVE_INFINITY;
  for (const option of decision.options) {
    if (option.type !== 'sacrificePermanent') continue;
    const value = boardCreatureValue(config.cast, view.state, option.oid);
    if (value < worstValue) {
      worst = option;
      worstValue = value;
    }
  }
  if (worst === null) {
    throw new Error('sacrifice policy: the kernel asked which permanent to sacrifice and offered none');
  }
  return worst;
}
