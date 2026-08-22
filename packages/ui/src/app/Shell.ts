/**
 * The app shell: one bar, peer modes, one content region.
 *
 * The mode switch is a segmented control because peers do not need a
 * hierarchy, and `aria-current="page"` carries the state so
 * the selected mode is announced rather than merely darker.
 */
import { createElement } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';
import { ROUTE_SCOPE_ATTRIBUTE } from '../styles/tokens';
import { MODE_LABELS, routeHash, UI_MODES } from './router';
import type { UiMode } from './router';

export interface ShellProps {
  readonly mode: UiMode;
  readonly onSelectMode: (mode: UiMode) => void;
  readonly title?: string;
  readonly subtitle?: string;
  /** Right-hand slot in the bar: run seed, set code, data provenance. */
  readonly aside?: ReactNode;
  /**
   * Which set the whole page is showing, and the control that changes it.
   *
   * Drawn on every route, the play route included, and that is the difference
   * between this slot and `aside`. The aside is provenance about a measured run
   * and a table can do without it; this is the subject of everything on screen.
   * A picker the play route dropped would mean the one route where a person
   * spends an hour is the one route that cannot say which set they are playing.
   */
  readonly setPicker?: ReactNode;
  /**
   * A standing statement about what is on screen, under the bar on every route.
   *
   * The subtitle and the aside are both dropped on the play route, which is
   * right for decoration and wrong for this: a reduced set is most misleading
   * exactly where somebody is drawing from the pool. So this slot is drawn on
   * every route, and it is a `role="status"` region rather than a styled
   * sentence, because a disclosure a screen reader never reaches is not a
   * disclosure.
   */
  readonly notice?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The accessible name of the notice region, named once so the shell and the
 * tests that look for it cannot drift apart.
 *
 * It is specific where the slot is generic, and deliberately: the one thing this
 * region has ever carried is what a set is missing, and a region announced as
 * "notice" tells a screen-reader user nothing about which of the page's claims
 * it just heard. A second kind of notice would want its own slot rather than a
 * share of this label.
 */
export const SHELL_NOTICE_LABEL = 'Set completeness';

/** True for a plain, unmodified left click: the one case this owns navigation for. */
function isPlainLeftClick(event: ReactMouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A mode is a real anchor, not a button: `href` carries the hash the router
 * would put there itself, so middle-click and ctrl/cmd-click open a second tab
 * on that mode instead of doing nothing. A plain left click still goes through
 * `onSelect` so the SPA never reloads the page to get there.
 */
function modeItem(current: UiMode, mode: UiMode, onSelect: (mode: UiMode) => void): ReactElement {
  const selected = mode === current;
  return createElement(
    'a',
    {
      key: mode,
      className: 'mtg-modes__item',
      href: routeHash({ mode, params: {} }),
      ...(selected ? { 'aria-current': 'page' as const } : {}),
      onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        onSelect(mode);
      },
    },
    MODE_LABELS[mode],
  );
}

/**
 * The shell root also names the route it is showing. That attribute is the hook
 * a per-route palette hangs on, and `styles/tokens.ts` now selects on it from
 * both directions: the scope re-values the palette for everything inside the
 * shell, and a `:root:has(…)` rule above it hands the viewport the scheme its
 * scrollbar and its native controls are drawn in, which is the one part of a
 * palette a selector on the shell is one level too far in to decide.
 */
export function Shell(props: ShellProps): ReactElement {
  const { mode, onSelectMode } = props;
  const focusedPlay = mode === 'play';
  return createElement(
    'div',
    { className: 'mtg-shell', [ROUTE_SCOPE_ATTRIBUTE]: mode },
    createElement(
      'header',
      { className: 'mtg-shell__bar' },
      createElement(
        'div',
        { className: 'mtg-shell__mark' },
        createElement('span', { className: 'mtg-shell__title' }, props.title ?? 'MTG Lab'),
        focusedPlay || props.subtitle === undefined
          ? null
          : createElement('span', { className: 'mtg-shell__subtitle' }, props.subtitle),
      ),
      props.setPicker === undefined ? null : props.setPicker,
      createElement(
        'nav',
        { className: 'mtg-modes', 'aria-label': 'View mode' },
        ...UI_MODES.map((item) => modeItem(mode, item, onSelectMode)),
      ),
      createElement('span', { className: 'mtg-shell__spacer' }),
      focusedPlay || props.aside === undefined
        ? null
        : createElement('div', { className: 'mtg-shell__aside' }, props.aside),
    ),
    props.notice === undefined
      ? null
      : createElement(
          'p',
          { className: 'mtg-shell__notice', role: 'status', 'aria-label': SHELL_NOTICE_LABEL },
          props.notice,
        ),
    createElement('main', { className: 'mtg-shell__main' }, props.children),
  );
}
