import type { Action } from './actions';
import { pendingDecision } from './legal';
import { reduce } from './reduce';
import type { GameState } from './state';

const SETTLE_CAP = 64;

/** Apply one candidate and mechanically pass priority until its stack is quiet. */
export function settleAgentAction(state: GameState, action: Action): GameState {
  let current = reduce(state, action).state;
  for (let step = 0; step < SETTLE_CAP; step += 1) {
    if (current.result !== null || current.stack.length === 0) return current;
    const decision = pendingDecision(current, 1);
    if (decision === null || decision.kind !== 'priority') return current;
    current = reduce(current, { type: 'passPriority', player: decision.player }).state;
  }
  return current;
}
