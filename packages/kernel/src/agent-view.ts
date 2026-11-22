import type { Action } from './actions';
import type { AgentObservation, AgentView } from './agent';
import type { PlayerId } from './ids';
import type { Decision } from './legal';
import type { GameState } from './state';
import { seatState } from './visibility';

export type PrivilegedAgentPreview = (action: Action) => GameState;

/** Project privileged state into the only state type player policy may consume. */
export function observeState(state: GameState, player: PlayerId, deliveryKey: string): AgentObservation {
  return seatState(state, player, deliveryKey) as AgentObservation;
}

export function agentDecision(decision: Decision): Decision {
  const options = decision.options.filter((option) => option.type !== 'concede');
  return options.length === decision.options.length ? decision : ({ ...decision, options } as Decision);
}

/**
 * Construct the only runtime value that should cross into a player agent.
 *
 * The optional preview callback remains on the privileged side of this seam:
 * callers apply an action to the real position, while this module projects the
 * returned position before the agent can inspect it.
 */
export function agentView(
  state: GameState,
  player: PlayerId,
  decision: Decision,
  deliveryKey: string,
  preview?: PrivilegedAgentPreview,
): AgentView {
  const visible = observeState(state, player, deliveryKey);
  const offered = agentDecision(decision);
  if (preview === undefined) return { state: visible, player, decision: offered };
  return {
    state: visible,
    player,
    decision: offered,
    previewSettled: (action) => observeState(preview(action), player, `${deliveryKey}:preview`),
  };
}
