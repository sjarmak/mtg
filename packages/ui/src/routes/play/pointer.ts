/**
 * Whether this seat is being played with a finger, for the two answers that
 * change when it is.
 *
 * The playtester, 2026-08-22, playing sideways on a phone: "There should be an easy
 * way to continue passing priority since pressing space isn't an option on
 * mobile easily."
 *
 * Ordinary priority already takes one press wherever it is played: `./pass.ts`'s
 * button is fixed on the strip at a touch target's size and is drawn enabled
 * whenever the kernel enumerated a pass. The state her sentence is about is the
 * **halt** — a combat beat, or any beat at all for a player who asked for
 * reduced motion. `./PlayView.ts` gives a halt no `passAt`, because a pause is
 * not a priority window and the kernel enumerates nothing in one, so the fixed
 * button is drawn disabled and the only press in the state is the beat panel's
 * Continue. In a shut column that panel is behind the alert
 * (`./ask-flyout.ts`), and the alert's own two words were `Paused` and `Press
 * Space` — a shortcut `./pass-key.ts` really does bind, and really does continue
 * a beat with, on a keyboard. On a phone it is advice that cannot be taken, in
 * the one state where it is the only advice offered.
 *
 * So the pointer is read, and it decides two things and nothing else: what the
 * strip says a halt is answered by, and whether a halt arrives already drawn.
 * Both are in `./ask-flyout.ts` and its docblock argues the second at length.
 *
 * `(pointer: coarse)` is the primary input, which is the question being asked —
 * not "is this a small screen", which is `../../styles/board/geometry.ts`'s
 * `CRAMPED_TABLE_QUERY` and is already wrong for a tablet in a keyboard case and
 * for a narrow window on a desktop. A machine with both a trackpad and a
 * touchscreen reports `fine` here and keeps the keyboard sentence, which is the
 * correct answer for it: the space key works.
 *
 * The mechanism underneath is `./collapse-preference.ts`'s, whose two exported
 * halves take the query as an argument rather than naming one. The names there
 * say `cramped` because a column's width is what wanted them first; what they
 * actually do is hold a boolean against a media query and keep it current, which
 * is this too. A second copy of the same nine lines is what the rule of three is
 * for.
 */
import { useEffect, useState } from 'react';
import { crampedTable, watchCrampedTable } from './collapse-preference';

/** The primary input, asked of the host directly. */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * True while the primary input is a finger.
 *
 * False where the host cannot be asked — no `matchMedia`, or a host that throws
 * — which is `crampedTable`'s answer and the right one here: the keyboard
 * sentence is what this route said before there was a pointer question, and a
 * seat that gets it wrongly still has every control the other arm has.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() => crampedTable(COARSE_POINTER_QUERY));
  useEffect((): (() => void) => watchCrampedTable(COARSE_POINTER_QUERY, setCoarse), []);
  return coarse;
}
