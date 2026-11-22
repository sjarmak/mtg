/** Target policy for Redirect/Reverberate's resolution-time choice. */
import { spellCardByOid, type Action, type AgentView, type Decision } from '@mtg/kernel';
import type { GreedyBotConfig } from '../config';
import { scoreTargets } from './target';

type ChooseSpellTargetsAction = Extract<Action, { type: 'chooseSpellTargets' }>;
type SpellTargetsDecision = Extract<Decision, { kind: 'spellTargets' }>;

/** Picks the target tuple whose copied or redirected resolution is best for this seat. */
export function chooseSpellTargets(
  view: AgentView,
  config: GreedyBotConfig,
  decision: SpellTargetsDecision,
): ChooseSpellTargetsAction {
  const entry = view.state.stack.find((candidate) => candidate.oid === decision.oid);
  const card = spellCardByOid(view.state, decision.oid);
  if (entry === undefined || card === null) {
    throw new Error(`spell target policy: ${decision.oid} is not a spell on the stack`);
  }
  let best: ChooseSpellTargetsAction | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const option of decision.options) {
    if (option.type !== 'chooseSpellTargets') continue;
    const value = scoreTargets(
      view.state,
      view.player,
      card,
      option.targets,
      config.cast,
      config.target,
      config.race,
      entry.x ?? 0,
      entry.mode,
      option.multiTargets,
      option.damageAllocations,
    );
    if (value > bestValue) {
      best = option;
      bestValue = value;
    }
  }
  if (best === null) {
    throw new Error(`spell target policy: the kernel asked about ${decision.oid} and offered none`);
  }
  return best;
}
