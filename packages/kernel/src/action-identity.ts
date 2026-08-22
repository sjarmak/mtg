/**
 * When two `Action` values are the same move.
 *
 * `chooseAction` in `session.ts` has to turn a constructed action back into its
 * index in `Decision.options`, because the recorded choice must stay an integer
 * for `replaySession` to spend. That makes "is this the same move the kernel
 * enumerated?" a question with a load-bearing answer, and the answer has to be
 * exact in both directions: a false miss refuses a legal move, and a false hit
 * records an index for a move the player did not make.
 *
 * **`canonicalJson` is the object half and only the object half.** Its own
 * docblock in `@mtg/dsl` states the property this needs — equal values produce
 * byte-identical output, with keys recursively sorted, so a caller that builds
 * `{ player, type, oid }` matches an enumeration that built `{ type, player,
 * oid }`. It also states the property this cannot use alone: it *preserves
 * array order by design*. Four of the action alphabet's lists are sets in the
 * rules and would compare unequal to their own enumerated twin the moment a
 * player clicked two creatures in the other order, which is exactly how a click
 * built declaration arrives (`mtg-bz2.5`).
 *
 * So the value is canonicalized first — those four lists sorted, everything
 * else left as written — and `canonicalJson` compares the result. Sorting is a
 * claim about the rules and is made only where the rules make it:
 *
 *  - `declareAttackers.attackers` and `declareBlockers.blocks` are sets. CR
 *    508.1 and 509.1 declare a group at once; nothing reads their order, and
 *    `validateAttackers`/`validateBlocks` check them as sets already.
 *  - `discard.oids` and `keepHand.bottom` are sets for the same reason:
 *    `validateAction` checks each against the hand and rejects a repeat, and
 *    the count is what the rule names.
 *  - `orderBlockers.orders` is sorted by attacker and *not* inside. The outer
 *    list is one entry per multiply-blocked attacker, which `validateOrdering`
 *    looks up by attacker id; the inner `blockers` list is CR 509.2's damage
 *    assignment order, which is the entire content of the choice.
 *
 * Two lists are deliberately left positional. `targets` is parallel to an
 * effect list — slot 2 is the second effect's target and swapping two entries
 * is a different aiming of the same spell. `sacrifices` is left positional
 * because nothing here has established that it is not: `validateSacrifices`
 * treats it as a set, but `reduce` sacrifices in the order given, so two orders
 * emit two event logs. A caller that wants to construct one takes the
 * enumeration's order or gets a refusal naming the reason, which is the right
 * failure for a list nobody has checked.
 */
import { canonicalJson } from '@mtg/dsl';
import type { Action } from './actions';

/** Sorts by the canonical text of each member, which is a total order on JSON. */
function sortedBy<T>(items: readonly T[]): readonly T[] {
  return [...items]
    .map((item): readonly [string, T] => [canonicalJson(item), item])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, item]) => item);
}

/**
 * The action with its unordered lists put in one order, so two spellings of one
 * move produce one string.
 *
 * Exported because a recorded choice can be an action rather than an index
 * (`session.ts`), and a recording wants the one spelling for the same reason
 * `actionKey` wants the one string: two players who clicked the same block in
 * different orders made one move and must write one recording.
 */
export function canonicalAction(action: Action): Action {
  switch (action.type) {
    case 'declareAttackers':
      return { ...action, attackers: sortedBy(action.attackers) };
    case 'declareBlockers':
      return { ...action, blocks: sortedBy(action.blocks) };
    case 'orderBlockers':
      return { ...action, orders: sortedBy(action.orders) };
    case 'discard':
      return { ...action, oids: [...action.oids].sort() };
    case 'keepHand':
      return { ...action, bottom: [...action.bottom].sort() };
    default:
      return action;
  }
}

/** The canonical text of a move, equal exactly when two actions are one move. */
export function actionKey(action: Action): string {
  return canonicalJson(canonicalAction(action));
}

/** True when both values name the same move; see `actionKey`. */
export function sameAction(left: Action, right: Action): boolean {
  return actionKey(left) === actionKey(right);
}

/**
 * Where `action` sits in an enumeration, or `null` when it is not in one.
 *
 * The first match rather than the only one: a decision that enumerated one move
 * twice would be a bug in the enumeration, and picking the earlier index keeps
 * this a pure function of the list either way.
 */
export function indexOfAction(options: readonly Action[], action: Action): number | null {
  const wanted = actionKey(action);
  for (const [index, option] of options.entries()) {
    if (actionKey(option) === wanted) return index;
  }
  return null;
}
