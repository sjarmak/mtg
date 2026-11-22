/**
 * The one move that is strictly worse than free to skip.
 *
 * `mtg-re3`, observed in a browser on the flagship set: "Twice in one game I
 * passed my main phase holding a Swamp and a Mountain and lost the drop with no
 * prompt, no color change and no confirm; by turn 5 I had one land in play and
 * eight cards in hand, and nothing on screen had ever said so."
 *
 * It was never a legality bug. The enumeration offered `Play Swamp` and
 * `Play Mountain` beside `Pass` at both main phases, exactly as it should have,
 * and the pass was drawn with the same weight it has at every other priority of
 * the game. That is the whole complaint: a land drop is the one action in Magic
 * that costs nothing, cannot be responded to profitably, and does not come back
 * — every other skipped move is a move you still hold. Skipping it looked like
 * skipping anything else.
 *
 * # It says so, it does not refuse
 *
 * No confirm, and no disabled pass. A player has real reasons to hold a land —
 * a bluff, a card they would rather draw into, a second main they mean to come
 * back at — and a surface that made them answer a dialog to do it would be
 * wrong about the game twice a turn. What was missing was the sentence, so the
 * sentence is what this adds, next to the button that spends the window.
 *
 * # Derived from the enumeration, never from a rule of its own
 *
 * The predicate is "the kernel is offering this seat a `playLand` right now",
 * which is `../play/prompt.ts`'s `PlayChoice.kind` and nothing else. The
 * one-per-turn rule, the timing, whose turn it is and whether the stack is
 * empty are all already inside that answer, so there is no second definition of
 * a land drop here to fall out of step with the kernel's. A seat that is not
 * being asked has no choices, and so has no note.
 *
 * It counts *objects* rather than choices, because two lands in hand are two
 * options and one land that two different choices name would not be two drops.
 */
import type { PlayPrompt } from './prompt';

/** The accessible name of the region the note is announced in. */
export const LAND_DROP_LABEL = 'Land drop';

/**
 * How many distinct lands in hand the pending enumeration would play, which is
 * zero whenever the drop is spent, the timing is wrong, or the seat is not the
 * one being asked.
 */
export function playableLands(prompt: PlayPrompt | null): number {
  if (prompt === null) return 0;
  const oids = new Set<string>();
  for (const choice of prompt.choices) {
    if (choice.kind !== 'playLand') continue;
    for (const oid of choice.oids) oids.add(oid);
  }
  return oids.size;
}

/**
 * What the foot says about the unspent drop, or null when there is nothing to
 * say.
 *
 * The count is in it because the two readings differ in what they cost: one
 * land held back is a decision a player may well have made, and four is a hand
 * that has stopped being played. It reads as a statement of the position rather
 * than as advice, for the reason above — this surface does not know why the
 * land is being held.
 */
export function landDropNote(prompt: PlayPrompt | null): string | null {
  const count = playableLands(prompt);
  if (count === 0) return null;
  if (count === 1) return 'Land drop unspent, and a land in hand would take it';
  return `Land drop unspent, and ${String(count)} lands in hand would take it`;
}
