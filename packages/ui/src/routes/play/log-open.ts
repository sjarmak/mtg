/**
 * Whether the game log opens on its history or its one-line strip, remembered.
 *
 * `mtg-rgc.8`. The 2026-08-22 interface pass flipped the log to open by default
 * and `../../log/GameLog.ts` argues why: everything that used to share the
 * 17rem rail left it, so a shut log was no longer paying for a card, it was
 * leaving the rail's whole column drawn around a strip reading `GAME LOG 0`.
 * What the pass did not do is remember the answer, so a player who shut the log
 * got it back open on the next game, every game, forever. That is the same
 * complaint `./rail-collapse.ts` was written to answer for the columns, and it
 * gets the same mechanism rather than a second one.
 *
 * **Unanswered is a constant here, not a viewport.** The two columns fall back
 * to a media query because a phone genuinely cannot afford them. The log falls
 * back to `OPEN_BY_DEFAULT`, because a table too small to afford it has already
 * collapsed the rail this panel lives in (`./rail-collapse.ts`), and a second
 * viewport rule inside a column that is itself viewport-gated is two rules that
 * can disagree about one screen.
 *
 * **The cost of opening by default was measured before this was made sticky**,
 * because the bead asked for a measurement or a reason. `../../log/group.ts`
 * records that the shut strip exists precisely so `buildLog` is not run per
 * render, so an open-by-default log pays that build from turn one. Over a whole
 * played mirror game against the bot (144 decisions, 1119 events, story
 * density), `buildLog` costs 62ms in total: about 0.2ms per decision at the end
 * of the game, with the worst single call at 9.5ms on the first one and a
 * handful of 2-5ms outliers. It is memoized on the event array, so it runs once
 * per action rather than once per render. That is well inside a frame on the
 * surface where nothing moves until the player acts, so the flip stands and the
 * only thing worth changing is that it be remembered.
 */
import { OPEN_BY_DEFAULT } from '../../log/GameLog';
import { useStoredCollapse } from './collapse-preference';

/** Keyed like the two columns, under this surface's own namespace. */
export const LOG_OPEN_KEY = 'mtg.play.game-log';

export interface LogOpenPreference {
  readonly open: boolean;
  readonly toggle: () => void;
}

/**
 * Read as open rather than as collapsed, which is the direction the panel and
 * its `aria-expanded` both speak in; the store underneath keeps saying shut, so
 * the three preferences on this surface share one spelling on disk.
 */
export function useLogOpen(): LogOpenPreference {
  const { collapsed, toggle } = useStoredCollapse(LOG_OPEN_KEY, !OPEN_BY_DEFAULT);
  return { open: !collapsed, toggle };
}
