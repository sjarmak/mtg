/**
 * A whole-board evaluator: one number for "how good is this position for me".
 *
 * Every evaluator in `./evaluate` prices one *thing* — a card, a body, a
 * combat exchange — because a depth-0 policy only ever compares things. A
 * lookahead compares *positions*, so it needs the other kind, and this is the
 * only file in the package that has one.
 *
 * It is deliberately built out of the pieces the greedy policies already use:
 * `boardCreatureValue` for permanents, so a pumped creature and a damaged one
 * are priced the way every other policy prices them, and `printedCardValue`
 * for the noncreature permanents no board evaluator covered. A second, private
 * notion of what a creature is worth would let the lookahead and the policy it
 * refines disagree about the same board, and then neither number would mean
 * anything.
 *
 * What it does NOT do is model the future. It reads the position in front of
 * it: bodies, life, cards in hand, and whether the game is already over. The
 * search on top of it (`./search-bot`) is where the one ply of foresight lives.
 */
import type { AgentObservation, PlayerId } from '@mtg/kernel';
import { controllerOf, opponentOf, tryObject } from '@mtg/kernel';
import type { CastPolicyConfig, StateEvalConfig } from './config';
import { boardCreatureValue, printedCardValue } from './evaluate';

/** Everything one seat owns on the board and in hand, in one number. */
function sideValue(
  cast: CastPolicyConfig,
  config: StateEvalConfig,
  state: AgentObservation,
  player: PlayerId,
): number {
  let total = state.players[player].life * config.lifeWeight;
  total += state.players[player].hand.length * config.cardWeight;
  for (const oid of state.battlefield) {
    if (controllerOf(state, oid) !== player) continue;
    const object = tryObject(state, oid);
    if (object === undefined) continue;
    total +=
      config.permanentValue +
      (object.card.kind === 'creature'
        ? boardCreatureValue(cast, state, oid)
        : printedCardValue(cast, object.card));
  }
  return total;
}

/**
 * The position from `me`'s side: my side minus theirs, or a terminal verdict.
 *
 * The terminal values are finite rather than infinite on purpose. A search that
 * scored a win as `Infinity` would score *two* winning lines identically and
 * lose the ability to prefer the one that also keeps a creature; more
 * importantly, `Infinity - Infinity` is `NaN`, and a single `NaN` in a maximum
 * silently swallows every option after it. `winValue` only has to dominate the
 * material terms, and it does by two orders of magnitude.
 */
export function evaluateState(
  cast: CastPolicyConfig,
  config: StateEvalConfig,
  state: AgentObservation,
  me: PlayerId,
): number {
  const result = state.result;
  if (result !== null) {
    if (result.winner === me) return config.winValue;
    if (result.winner === opponentOf(me)) return -config.winValue;
    return config.drawValue;
  }
  return sideValue(cast, config, state, me) - sideValue(cast, config, state, opponentOf(me));
}
