/**
 * The reduction accumulator: a state plus the events produced getting there.
 *
 * Every internal kernel step has the shape `(Trace, ...args) => Trace`, which
 * keeps the whole engine composable and free of hidden mutation. The public
 * reducer is just `trace -> apply -> settle -> { state, events }`.
 */
import type { GameEvent } from './events';
import type { PlayerId } from './ids';
import type { GameObject, GameState, PlayerState } from './state';

export interface Trace {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export function beginTrace(state: GameState): Trace {
  return { state, events: [] };
}

export function emit(trace: Trace, ...events: readonly GameEvent[]): Trace {
  if (events.length === 0) return trace;
  return { state: trace.state, events: [...trace.events, ...events] };
}

export function withState(trace: Trace, state: GameState): Trace {
  return state === trace.state ? trace : { state, events: trace.events };
}

export function mapState(trace: Trace, fn: (state: GameState) => GameState): Trace {
  return withState(trace, fn(trace.state));
}

export function playerOf(state: GameState, player: PlayerId): PlayerState {
  return state.players[player];
}

export function updatePlayer(
  state: GameState,
  player: PlayerId,
  fn: (current: PlayerState) => PlayerState,
): GameState {
  const updated = fn(state.players[player]);
  const players: readonly [PlayerState, PlayerState] =
    player === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players };
}

export function putObject(state: GameState, object: GameObject): GameState {
  return { ...state, objects: { ...state.objects, [object.oid]: object } };
}
