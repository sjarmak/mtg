/**
 * The pass, in a place that does not move.
 *
 * The playtester, 2026-08-13, after playing the lab: "the 'pass' button should
 * always be in the same spot maybe in the upper right area of your hand or
 * something". It was one option among the enumerated ones, so it sat wherever
 * the `Turn` group happened to fall as the list grew and shrank, and it is the
 * move most priorities of most turns end in.
 *
 * It is not a shortcut around the enumeration and there is deliberately no path
 * here that builds an `Action`. `at` is `passIndex`'s answer over the pending
 * decision, which is the same index the rail's own entry carries and the same
 * one the space key takes, and `null` means the kernel enumerated no pass in
 * this decision — a mulligan, a blocker assignment, an ordering, a discard.
 *
 * Null draws the button disabled rather than dropping it, which is the whole
 * point: a control whose promise is that it stays put cannot leave the screen
 * when the answer is no. Disabled it is out of the tab order and says why by
 * being drawn as unavailable, the same bargain an unplayable hand card takes.
 *
 * `mtg-bz2.4` made it prominent without editing it: the button is unchanged and
 * now sits inside `priority.ts`'s bar, which says who holds priority in the row
 * this button already owned. That is the shape any further addition should take
 * — `mtg-bz2.7`'s yield options are the next one — because the two rules here
 * are absolute. Nothing may make it move, and nothing may give it a path that
 * does not run through an index the kernel handed out.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

/**
 * What the fixed pass button says, whatever the stack holds.
 *
 * The rail's own entry for the same option reads `Let it resolve` with a count
 * of what is on the stack under it, and that is right for a list with room to
 * explain itself. This one is a fixed home, and half of what makes a home fixed
 * is that the word does not change under the cursor.
 */
export const PASS_LABEL = 'Pass';

export function passButton(at: number | null, onPass: () => void): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-play__pass',
      'data-variant': 'primary',
      disabled: at === null,
      onClick: onPass,
    },
    PASS_LABEL,
  );
}
