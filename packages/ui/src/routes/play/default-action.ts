/**
 * Which of a card's moves a double click plays, and when it has none.
 *
 * `mtg-bz2.2` asks for three gestures on one object — single click is the
 * obvious action, double click is the default action, right click is the menu —
 * under one stated constraint from the playtester: *do not make the UI excessively
 * infer intent*. A default action is the one gesture of the three that has to
 * pick a move out of several, so the constraint lands entirely on this file.
 *
 * The rule is structural rather than a ranking, because a ranking is a guess
 * written down. **A card's default is the one offered move that names that card
 * and nothing else.** Every choice reaching here already names the card — that
 * is what put it in `choicesByObject`'s bucket — so the question is only whether
 * it also names something else, and `PlayChoice.oids` answers it without anyone
 * having to decide that tapping outranks attacking.
 *
 * What that rule does to the four shapes the enumeration actually produces:
 *
 *  - **One move.** Not this function's business at all: a single click has
 *    already played it, and `selection.ts` never asks. Stated here because it is
 *    why a double click on a land taps it — the first click did.
 *  - **A spell with several legal aims.** `oidsOf` puts a cast's target in the
 *    label rather than in `oids`, so all of them name the card alone, there are
 *    several, and there is no default. That is the case the constraint is about:
 *    two aims are two different spells, and a surface that picked one has
 *    guessed. The menu the first click opened stays open, and it asks.
 *  - **A creature while attackers are declared.** The kernel enumerates
 *    combinations, so a creature is in one option by itself and in one per
 *    combination it shares. Exactly one names it alone, and that is the default:
 *    this creature attacks. It is the same move a single click already submits
 *    when it is the only creature that can attack, which is the consistency
 *    argument for calling it the default when it is not.
 *  - **A blocker, an ordering, a trigger aimed at two things.** Every option
 *    names a second object, so nothing names the card alone and there is no
 *    default. Right again: a block is a statement about two creatures and
 *    picking the second one for the player is the guess this rule refuses.
 *
 * `mtg-bz2.5`'s incremental combat and `mtg-bz2.3`'s staged cast are what turn
 * the second and fourth cases into something a player builds a click at a time.
 * Until they land, the honest answer for those is a menu, not a default.
 */
import type { PlayChoice } from './prompt';

/**
 * The move a double click on this card plays, or null when the card has none.
 *
 * Takes the choices already narrowed to one card (`choicesByObject`'s value), so
 * it cannot be handed a move that acts on something else and mistake it for a
 * default.
 */
export function defaultChoice(choices: readonly PlayChoice[]): PlayChoice | null {
  const alone = choices.filter((choice) => new Set(choice.oids).size === 1);
  const only = alone[0];
  return alone.length === 1 && only !== undefined ? only : null;
}
