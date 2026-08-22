/**
 * View state for the left-hand ask column. It changes no game record.
 *
 * The column defaults shut on a table with no room for it, open on one that has,
 * and remembers a press either way — the three states `./collapse-preference.ts`
 * holds and the right-hand rail has had since `mtg-l4w0`.
 *
 * It was a bare `useState(false)` until then, and the reason it was is worth
 * keeping because it stopped being true. `./rail-collapse.ts` argued that the
 * rail is the column worth collapsing because it holds *reference* material,
 * while this column holds the current ask, which is the thing a player is
 * deciding from. Every word of that was right when it was written and
 * `./ask-flyout.ts` retired it: a shut column now draws whichever panel the open
 * one would have drawn, over the board, on a press of the strip. So shutting
 * this column no longer takes the ask away, and on a landscape phone it hands
 * the lanes 104.25px of an 844px mat that were carrying a graveyard browser, a
 * play-meta line and two pods scrolling 574px of content through a 227px box.
 *
 * The condition is `SHORT_VIEWPORT_QUERY` rather than the rail's
 * `CRAMPED_TABLE_QUERY`, and the difference between them is the whole of this
 * decision. The rail is shut by a narrow window *or* a short one, because the log
 * is reference material either way. This column holds the ask, and the ask is
 * worth its width until the height runs out: in portrait a phone has 844px of it
 * and the mulligan, the target list and the blocker assignment are the first
 * things a player touches, so the column stays open there and the press
 * `./ask-flyout.ts` costs is not charged. Held sideways there is no height left
 * to hold a panel and the flyout is a better box for one anyway — it is not
 * bounded by 11rem, so the same moves lay out in columns instead of stacking.
 *
 * No key binding, and that is the one asymmetry with the rail. `b` is taken and
 * every free bare letter on this route is a letter a player might type into the
 * seed field; the strip is a touch target on the surface this matters on.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { SHORT_VIEWPORT_QUERY } from '../../styles/board/geometry';
import { useCollapsePreference } from './collapse-preference';
import type { CollapsePreference } from './collapse-preference';

export const ASK_PANEL_LABEL = 'Game details';

/** Where the preference is kept, namespaced so it cannot collide with a lane's. */
const STORE_KEY = 'mtg.play.ask-column';

/** The shared shape, under this column's own name for the callers that use it. */
export type AskCollapse = CollapsePreference;

export function useAskCollapse(): AskCollapse {
  return useCollapsePreference(STORE_KEY, SHORT_VIEWPORT_QUERY);
}

export function askToggle(state: AskCollapse): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-ask__head' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-btn mtg-ask__toggle',
        'aria-label': ASK_PANEL_LABEL,
        'aria-expanded': !state.collapsed,
        onClick: state.toggle,
      },
      createElement(
        'span',
        { className: 'mtg-ask__chevron', 'aria-hidden': true },
        state.collapsed ? '\u203a' : '\u2039',
      ),
      createElement('span', { className: 'mtg-ask__toggle-label', 'aria-hidden': true }, ASK_PANEL_LABEL),
    ),
  );
}
