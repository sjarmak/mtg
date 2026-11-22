/**
 * How fast this viewer asked the table to move, kept the way every other view
 * preference in this lab is kept.
 *
 * `mtg-kwu`. `../../motion/pace.ts` holds what a pace *is* — the four settings
 * and the multiplier each one applies — and holds it with no notion of a
 * browser, so it can be reasoned about by a test that mounts nothing. This file
 * is the other half: where the answer is stored, and how a component reads it.
 *
 * # Why it is a preference and not a session option
 *
 * Because the game does not wait for it. A pace scales how long a rendering
 * takes; it appends nothing to `choices`, reaches no `GameState` field, and
 * `stateFingerprint` over a game is identical whatever it is set to. Two players
 * watching one recorded game at two paces are watching the same game, in the
 * same sense that two players with different reduced-motion settings already
 * are.
 *
 * The near miss is the combat beats, which look like the same kind of setting
 * and are not: a beat pauses the kernel until the player dismisses it, which is
 * a decision in the log. That is why `SessionOptions` holds the beats and why
 * this is here instead, and it is also why there is no single "pacing" control
 * covering both — a beat has no duration to scale.
 *
 * # Why it defaults to `normal`
 *
 * `../../motion/timing.ts` argues every duration it spends against the playtester's
 * complaint that effects happening automatically are jarring, and those
 * arguments were the whole of `mtg-81a` and `mtg-ncg`. `normal` is that table,
 * unscaled. A default of anything else would mean the numbers those beads
 * settled are no longer what the surface ships, which would quietly reopen them.
 *
 * # Why `localStorage` and not the session
 *
 * `../deck/view-mode.ts` settled the mechanism for a view preference in this lab
 * and this is that mechanism, unchanged: one namespaced key through
 * `../deck/local-store.ts`, a stored value that is not one of the known words
 * treated as nothing stored, and a write whose failure is dropped, because a
 * preference that cannot be kept behaves exactly like a first visit.
 */
import { useCallback, useState } from 'react';
import { DEFAULT_PACE, isPace } from '../../motion/pace';
import type { Pace } from '../../motion/pace';
import { readStored, writeStored } from '../deck/local-store';

/** Where the answer is kept. Namespaced like every other key in this lab. */
export const PACE_STORE_KEY = 'mtg.play.pace';

/**
 * The stored pace, or the default.
 *
 * `isPace` is the whole of the validation and it is the right amount: anything
 * that is not one of the four words is a hand-edited store or a build that
 * spelled a pace differently, and in both cases the honest answer is the state a
 * first visit is in rather than a table that moves at `NaN`.
 */
export function readPace(): Pace {
  const found = readStored(PACE_STORE_KEY);
  return isPace(found) ? found : DEFAULT_PACE;
}

export interface PacePreference {
  readonly pace: Pace;
  readonly setPace: (next: Pace) => void;
}

/** The preference, read once per mount and written back on every change. */
export function usePace(): PacePreference {
  const [pace, setState] = useState<Pace>(() => readPace());
  const setPace = useCallback((next: Pace): void => {
    writeStored(PACE_STORE_KEY, next);
    setState(next);
  }, []);
  return { pace, setPace };
}
