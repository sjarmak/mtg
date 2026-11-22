/** Turn-scoped facts derived at the authoritative life-total mutation seams. */
import type { PlayerId } from './ids';
import type { GameState } from './state';

export function recordLifeLostThisTurn(state: GameState, player: PlayerId, amount: number): GameState {
  if (amount <= 0) return state;
  const current = state.turn.lifeLostThisTurn;
  const lifeLostThisTurn =
    player === 0
      ? ([current[0] + amount, current[1]] as const)
      : ([current[0], current[1] + amount] as const);
  return { ...state, turn: { ...state.turn, lifeLostThisTurn } };
}

export function lifeLostByOpponentsThisTurn(state: GameState, controller: PlayerId): number {
  return state.turn.lifeLostThisTurn[controller === 0 ? 1 : 0];
}
