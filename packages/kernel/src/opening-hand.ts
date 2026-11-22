/**
 * Card-authored actions taken after mulligans and before turn 1.
 *
 * The remaining-player list is state, not reducer-local control flow, because
 * every choice returns through the public decision seam. Its order is CR 103's
 * starting-player order. A player stays at the head while choosing actions, so
 * multiple eligible cards can be used in any order; choosing `null` removes
 * that player and is the explicit decision to finish.
 */
import { openingHandActionOf } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import type { GameState } from './state';
import type { Trace } from './trace';
import { playerOf, withState } from './trace';
import { beginTurn, withTurn } from './turn';
import { getObject, moveObject } from './zones';

/** Eligible objects in stable hand order. */
export function eligibleOpeningHandActionCards(state: GameState, player: PlayerId): readonly ObjectId[] {
  return playerOf(state, player).hand.filter((oid) => {
    const object = state.objects[oid];
    return (
      object !== undefined &&
      object.zone === 'hand' &&
      object.owner === player &&
      openingHandActionOf(object.card) !== undefined
    );
  });
}

function withRemainingPlayers(state: GameState, players: readonly PlayerId[]): GameState {
  return { ...state, openingHandActionPlayers: players };
}

function withoutRemainingPlayers(state: GameState): GameState {
  const { openingHandActionPlayers: _completed, ...ready } = state;
  return ready;
}

/**
 * Asks the next player who has a live action, skipping seats with none and
 * beginning turn 1 when every seat has finished.
 */
export function askOpeningHandAction(trace: Trace): Trace {
  let current = trace;
  let remaining = current.state.openingHandActionPlayers ?? [];
  for (;;) {
    const player = remaining[0];
    if (player === undefined) {
      const ready = withState(current, withoutRemainingPlayers(current.state));
      return beginTurn(ready, ready.state.config.startingPlayer);
    }
    if (eligibleOpeningHandActionCards(current.state, player).length > 0) {
      return withState(
        current,
        withTurn(withRemainingPlayers(current.state, remaining), {
          priority: null,
          awaiting: 'openingHandAction',
          awaitingPlayer: player,
        }),
      );
    }
    remaining = remaining.slice(1);
    current = withState(current, withRemainingPlayers(current.state, remaining));
  }
}

/** Opens the pregame action round in starting-player order. */
export function beginOpeningHandActions(trace: Trace): Trace {
  const first = trace.state.config.startingPlayer;
  const opened = withState(trace, withRemainingPlayers(trace.state, [first, opponentOf(first)]));
  return askOpeningHandAction(opened);
}

/** Applies one chosen card action, or finishes this player's action round. */
export function answerOpeningHandAction(trace: Trace, player: PlayerId, oid: ObjectId | null): Trace {
  const remaining = trace.state.openingHandActionPlayers ?? [];
  if (remaining[0] !== player) {
    throw new Error(`answerOpeningHandAction: player ${String(player)} is not being asked`);
  }
  if (oid === null) {
    const finished = withState(trace, withRemainingPlayers(trace.state, remaining.slice(1)));
    return askOpeningHandAction(finished);
  }

  const action = openingHandActionOf(getObject(trace.state, oid).card);
  if (action === undefined) throw new Error('answerOpeningHandAction: card has no opening-hand action');
  let answered: Trace;
  switch (action.kind) {
    case 'beginOnBattlefield':
      answered = moveObject(trace, oid, 'battlefield');
      break;
  }
  return askOpeningHandAction(answered);
}
