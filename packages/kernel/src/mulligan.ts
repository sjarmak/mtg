/**
 * The London mulligan (CR 103.4): the one decision asked before turn 1.
 *
 * The rule, in the order this module runs it. Every player draws a full opening
 * hand. Each player in turn order says whether they keep; a player who does not
 * shuffles their hand back into the library, shuffles, and draws a full hand
 * again. That repeats until every player has kept. A player who kept after N
 * mulligans then puts N cards of their choice on the bottom of their library, so
 * a mulligan costs a card and never costs selection — which is the whole reason
 * the London rule replaced the Paris one, and the reason it is worth having here
 * rather than the cheaper "draw one fewer".
 *
 * ## Where it sits in the machine
 *
 * `createGame` deals the hands and then opens this question instead of beginning
 * turn 1, so the kernel's first `pendingDecision` is a mulligan rather than a
 * priority. `turn.number` is still 0 while it runs, which is what makes the
 * phase visible without a second state machine: `awaiting` is `'mulligan'`,
 * nobody holds priority, and the settle loop stops exactly as it does for a
 * discard. `beginTurn` is called from here, once, when the last seat keeps.
 *
 * ## Two seats, one round at a time
 *
 * The asking order is turn order, and a player who has kept is never asked
 * again, so the seat that owes the next answer is the one with the fewest
 * mulligans among those still deciding, ties going to the starting player. That
 * is round-robin without a round counter: a seat still in the phase has taken
 * exactly one mulligan per round it has been through, so its mulligan count *is*
 * the round it is waiting on.
 *
 * ## Why it terminates
 *
 * A seat that has mulliganed as many times as its opening hand is wide would
 * bottom every card it drew, so a further mulligan cannot change what it keeps.
 * The enumeration stops offering one there and `validateAction` refuses it,
 * which bounds the phase at `openingHandSize` mulligans per seat rather than
 * relying on an agent to stop asking.
 *
 * Everything random here is the seeded generator in state, through
 * `shuffleLibrary`. A mulliganed game still replays from its seed plus a list of
 * integers.
 */
import type { ObjectId, PlayerId } from './ids';
import { opponentOf } from './ids';
import type { GameState } from './state';
import type { Trace } from './trace';
import { emit, playerOf, updatePlayer, withState } from './trace';
import { beginTurn, withTurn } from './turn';
import { drawCards, moveObject, shuffleLibrary } from './zones';

/** Turn order: the starting player, then the other seat. */
function askingOrder(state: GameState): readonly [PlayerId, PlayerId] {
  const first = state.config.startingPlayer;
  return [first, opponentOf(first)];
}

/**
 * The seat that owes the next mulligan answer, or `null` when both have kept.
 *
 * Fewest mulligans first, ties to turn order, which is the round-robin the
 * header describes.
 */
export function nextMulliganPlayer(state: GameState): PlayerId | null {
  let chosen: PlayerId | null = null;
  for (const player of askingOrder(state)) {
    if (playerOf(state, player).keptHand) continue;
    if (chosen === null || playerOf(state, player).mulligans < playerOf(state, chosen).mulligans) {
      chosen = player;
    }
  }
  return chosen;
}

/** How many cards a keep by this seat puts on the bottom (CR 103.4). */
export function cardsToBottom(state: GameState, player: PlayerId): number {
  const seat = playerOf(state, player);
  return Math.min(seat.mulligans, seat.hand.length);
}

/** True while another mulligan could still change what this seat keeps. */
export function canMulligan(state: GameState, player: PlayerId): boolean {
  return playerOf(state, player).mulligans < state.config.openingHandSize;
}

/**
 * Asks the next seat, or starts turn 1 when nobody is left to ask.
 *
 * The single exit from the phase, run by `createGame` to open it and by the
 * reducer after every answer, so "the opening hand is settled" is decided in one
 * place rather than at each of the two answers.
 */
export function askMulligan(trace: Trace): Trace {
  const next = nextMulliganPlayer(trace.state);
  if (next === null) return beginTurn(trace, trace.state.config.startingPlayer);
  return withState(
    trace,
    withTurn(trace.state, { priority: null, awaiting: 'mulligan', awaitingPlayer: next }),
  );
}

/**
 * CR 103.4: the hand goes back, the library is shuffled, a full hand is dealt.
 *
 * The count is raised before the redraw so the event reports the mulligan this
 * hand was dealt for, which is also the number of cards a keep of it will
 * bottom.
 */
export function takeMulligan(trace: Trace, player: PlayerId): Trace {
  let current = trace;
  for (const oid of playerOf(current.state, player).hand) {
    current = moveObject(current, oid, 'library');
  }
  current = shuffleLibrary(current, player);
  const mulligans = playerOf(current.state, player).mulligans + 1;
  current = withState(
    current,
    updatePlayer(current.state, player, (seat) => ({ ...seat, mulligans })),
  );
  current = emit(current, { type: 'handMulliganed', player, mulligans });
  return drawCards(current, player, current.state.config.openingHandSize);
}

/**
 * CR 103.4: the hand is kept and the named cards go to the bottom.
 *
 * `moveObject` into the library appends, and index 0 is the top, so the bottom
 * is what "append" means here. They go in the order the action named them, which
 * is the order the player chose; a set with a canonical order would be a
 * different game only in a deck nobody has drawn to yet, and the choice is the
 * player's to make either way.
 */
export function keepHand(trace: Trace, player: PlayerId, bottom: readonly ObjectId[]): Trace {
  let current = trace;
  for (const oid of bottom) {
    current = moveObject(current, oid, 'library');
  }
  const mulligans = playerOf(current.state, player).mulligans;
  current = withState(
    current,
    updatePlayer(current.state, player, (seat) => ({ ...seat, keptHand: true })),
  );
  return emit(current, { type: 'handKept', player, mulligans, bottomed: bottom });
}
