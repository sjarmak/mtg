/**
 * Which objects the reader is pointing at, and from where.
 *
 * `mtg-47o` and `mtg-exe`, which were one question wearing two hats: two of one
 * seat's Gloom Hands are the same name on the board and the same name in the
 * log, and neither surface can say which is which. The answer taken over
 * printing an identity mark on each copy is that a log line **points**: hovering
 * or pressing the sentence lights the objects it names, on the board, where the
 * player is already looking.
 *
 * The alternative was a mark -- a number, a letter, a color swatch -- beside
 * every name in both places. It reads worse in both: a log line becomes "Player
 * one's Gloom Hand (2) deals 2 damage", which is a sentence with a footnote in
 * it, and a board face grows a badge that means nothing except in the presence
 * of its twin, on a face that already carries counters, damage and combat flags
 * (`../../board/CardSlot.ts`'s `marks`). Pointing costs the board nothing when
 * nobody is pointing, and it answers the question for every line, not only for
 * the lines that happen to name a duplicated card.
 *
 * # Why this is a hook and not a field on the selection state
 *
 * It is nobody's selection. `./selection.ts` holds what the player has chosen to
 * act on and `./inspect.ts` holds what they are reading, and both of those
 * outlive the gesture that set them -- deliberately, and `inspect.ts` argues
 * why. Pointing is the opposite: it is alive exactly as long as the pointer is
 * over the line or the latch is on, and it changes nothing about what a press on
 * the board would do. Folding it into either would give a durable piece of state
 * a transient member, and the first bug would be a highlight surviving the thing
 * that put it there.
 *
 * # What it deliberately does not do
 *
 * It does not scroll, focus, or select. A log line about a permanent that has
 * since left the battlefield lights nothing, and that is the true answer rather
 * than a failure: the object is gone, and the alternative is a surface that
 * pretends otherwise. It also lights nothing on the stack, whose entries carry
 * `data-permanent-key` too -- a line naming a spell is nearly always read after
 * that spell has resolved, so the stack arm would be a code path for a moment
 * that does not happen.
 */
import { useCallback, useMemo, useState } from 'react';

/** Nobody is pointing, and the same reference every time, so the memo holds. */
const NOTHING: ReadonlySet<string> = new Set<string>();

export interface Pointing {
  /** The kernel object ids to light, empty when nobody is pointing. */
  readonly keys: ReadonlySet<string>;
  /** What the game log calls with the objects a line names, or `null`. */
  readonly onPoint: (objects: readonly string[] | null) => void;
}

export function usePointing(): Pointing {
  const [objects, setObjects] = useState<readonly string[] | null>(null);
  const onPoint = useCallback((next: readonly string[] | null): void => {
    setObjects(next);
  }, []);
  const keys = useMemo(
    (): ReadonlySet<string> =>
      objects === null || objects.length === 0 ? NOTHING : new Set<string>(objects),
    [objects],
  );
  return { keys, onPoint };
}
