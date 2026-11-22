/**
 * How `Page.playUntil` should report a stalled UI transition, once the goal
 * it was waiting on is re-checked directly.
 *
 * `mtg-8x0u1`: the acceptance-campaign commander-cast step failed with
 * "timed out waiting for transition after Kardur, Doomscourge" while the page
 * showed Kardur, Doomscourge already resolved onto the battlefield -- the
 * cast worked, only the wait for `phase !== 'submitting'` never resolved. The
 * cast and the wait on its UI transition are different things and can
 * disagree; `playUntil` re-checks its own `goal` when the transition wait
 * throws, and this function turns that re-check into the two outcomes the
 * bead's acceptance asks for: a goal already met is not a failure at all, and
 * a goal still unmet reports as one, worded so a reader does not mistake a
 * stalled transition for the goal itself having failed.
 */

export type TransitionStallOutcome =
  { readonly ok: true; readonly note: string } | { readonly ok: false; readonly message: string };

/** `goalReached` is the goal predicate re-evaluated after `waitErrorMessage` was thrown. */
export function transitionStallOutcome(
  goalReached: boolean,
  waitErrorMessage: string,
  label: string,
): TransitionStallOutcome {
  if (goalReached) {
    return { ok: true, note: `transition stalled after ${label}, goal already met: ${waitErrorMessage}` };
  }
  return {
    ok: false,
    message: `goal still unmet after a stalled UI transition: ${waitErrorMessage}`,
  };
}
