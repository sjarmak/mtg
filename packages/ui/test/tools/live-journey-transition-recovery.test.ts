/**
 * `mtg-8x0u1`: a commander cast that landed on the battlefield was reported
 * as a failed cast because the UI transition wait timed out first. This
 * covers the decision `Page.playUntil` makes once it re-checks the goal.
 */
import { describe, expect, it } from 'vitest';
import { transitionStallOutcome } from '../../tools/live-journey-transition-recovery';

const TIMEOUT_MESSAGE =
  'timed out waiting for transition after Kardur, Doomscourge:; alert="";' + ' controls=[]; text="TURN 17"';

describe('transitionStallOutcome', () => {
  it('is not a failure when the goal is already met, however the wait ended', () => {
    const outcome = transitionStallOutcome(true, TIMEOUT_MESSAGE, 'Kardur, Doomscourge');
    expect(outcome).toEqual({
      ok: true,
      note: `transition stalled after Kardur, Doomscourge, goal already met: ${TIMEOUT_MESSAGE}`,
    });
  });

  it('fails, distinguishing a stalled transition from the goal itself, when the goal is still unmet', () => {
    const outcome = transitionStallOutcome(false, TIMEOUT_MESSAGE, 'Kardur, Doomscourge');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a failure outcome');
    expect(outcome.message).toContain('goal still unmet after a stalled UI transition');
    expect(outcome.message).toContain(TIMEOUT_MESSAGE);
  });
});
