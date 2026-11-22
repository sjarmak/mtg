/**
 * The app shell: one bar, peer modes, one content region.
 *
 * The mode switch is a segmented control because peers do not need a
 * hierarchy, and `aria-current="page"` carries the state so
 * the selected mode is announced rather than merely darker. Under it, a mode
 * with more than one section draws a second row of the same shape for them.
 */
import { createElement } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';
import { ROUTE_SCOPE_ATTRIBUTE, SUB_SCOPE_ATTRIBUTE } from '../styles/tokens';
import { DEFAULT_SUBS, MODE_LABELS, PRIMARY_MODES, SUB_LABELS, UI_SUBS, routeHash } from './router';
import type { SubOf, UiMode, UiSub } from './router';

/**
 * Which mode the shell shows and, optionally, which of that mode's sections.
 * A distributive union for the reason `RouteAt` is one: `{ mode: 'cards', sub:
 * 'replay' }` fails to typecheck. The sub is optional so a rig that mounts a
 * mode on its default section says `{ mode: 'play' }` and nothing more.
 */
export type ShellAt = { [M in UiMode]: { readonly mode: M; readonly sub?: SubOf<M> } }[UiMode];

export type ShellProps = ShellAt & {
  readonly modeParams?: Readonly<Record<string, string>>;
  readonly onSelectMode: (mode: UiMode, params?: Readonly<Record<string, string>>) => void;
  /**
   * What the mark reads.
   *
   * It reads `MTG Lab` and it is not the set's name. the playtester, 2026-08-22:
   * "instead of having the set name in the upper left always that should just be
   * MTG Lab". The lab used to name itself after whatever was staged, which meant
   * the one fixed point in the chrome moved every time the picker did, and the
   * set's name is already on the picker two inches to the right.
   */
  readonly title?: string;
  /**
   * Which set the page is browsing, and the control that changes it.
   *
   * Absent on Play, which chooses its own set in the section
   * (`../routes/play/SourceChoice.ts`): the four Play sections offer different
   * things -- Draft has the cube in it and Commander has none of the sets --
   * and one dropdown over all of them could only be right for one section at a
   * time. Every other route browses one staged set and this is what says which.
   */
  readonly setPicker?: ReactNode;
  /**
   * A standing statement about what is on screen, under the bar on every route.
   *
   * A reduced set is most misleading exactly where somebody is drawing from the
   * pool, so this slot is drawn on every route, and it is a `role="status"`
   * region rather than a styled
   * sentence, because a disclosure a screen reader never reaches is not a
   * disclosure.
   */
  readonly notice?: ReactNode;
  /**
   * Controls drawn at the bar's far end, after the spacer: the feedback
   * helper's switch (`../feedback/FeedbackToggle.ts`). The bar has one right
   * edge and this is the slot for it, so a second control lands beside the
   * first rather than in a second header.
   */
  readonly tools?: ReactNode;
  readonly children: ReactNode;
};

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

/** The accessible name of a mode's section row. */
export function subsLabel(mode: UiMode): string {
  return `${MODE_LABELS[mode]} sections`;
}

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
function modeItem(
  current: UiMode,
  mode: UiMode,
  onSelect: (mode: UiMode) => void,
  params: Readonly<Record<string, string>>,
): ReactElement {
  const selected = mode === current;
  return createElement(
    'a',
    {
      key: mode,
      className: 'mtg-modes__item',
      href: routeHash({ mode, params }),
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
 * A section is the same kind of anchor, without the click handler: the browser
 * sets the hash and the router's `hashchange` listener parses it, which is what
 * keeps a section press from counting as a landing (`./router.ts` on
 * `landing`). The href carries the mode's params so the source survives.
 */
function subItem(
  mode: UiMode,
  current: UiSub,
  sub: UiSub,
  params: Readonly<Record<string, string>>,
): ReactElement {
  return createElement(
    'a',
    {
      key: sub,
      className: 'mtg-subs__item',
      href: routeHash({ mode, sub, params }),
      ...(sub === current ? { 'aria-current': 'page' as const } : {}),
    },
    SUB_LABELS[sub],
  );
}

/**
 * The mark, which is also the way back to Play.
 *
 * `mtg-aqxi.17` made the corner of the app a control rather than a caption, and
 * it is the same anchor a mode tab is — `href` first, `onSelect` for the plain
 * left click — so it opens in a second tab the way every other route does.
 *
 * Where it goes changed: it used to lead to a landing page that listed the sets,
 * the decks and the destinations, which is three things the destinations
 * themselves already hold. Play is the thing a person opened this lab to do, so
 * the mark leads there, and choosing a set is the picker beside it
 * (`./SetPicker.ts`) rather than a page of its own.
 *
 * The accessible name is the mark plus where it goes, because "MTG Lab" alone
 * announces as a piece of branding and gives a screen-reader user no reason to
 * press it. On Play itself it carries `aria-current`, which is how the tab row
 * already says where you are.
 *
 * It carries no params, unlike a mode tab: a tab's `onSelect` falls back to
 * `modeParams(route)` on purpose, so switching sections keeps the set and
 * opponent you had. The mark is the one link in the bar whose job is to leave
 * that behind -- the playtester, 2026-09-27: pressing it while browsing a specific
 * set was landing back on Play still pinned to that set instead of its plain
 * default. `params: {}` here (and on the `onSelect` call below) is what
 * overrides the fallback rather than triggering it.
 */
const MARK_DESTINATION: UiMode = 'play';

function homeMark(
  current: UiMode,
  props: ShellProps,
  onSelect: (mode: UiMode, params?: Readonly<Record<string, string>>) => void,
): ReactElement {
  const label = props.title ?? 'MTG Lab';
  return createElement(
    'a',
    {
      className: 'mtg-shell__mark',
      href: routeHash({ mode: MARK_DESTINATION, params: {} }),
      'aria-label': `${label}, ${MODE_LABELS[MARK_DESTINATION]}`,
      ...(current === MARK_DESTINATION ? { 'aria-current': 'page' as const } : {}),
      onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        onSelect(MARK_DESTINATION, {});
      },
    },
    createElement('span', { className: 'mtg-shell__title' }, label),
  );
}

/**
 * The shell root also names the route it is showing, twice: the mode and the
 * section. The mode attribute is the hook a per-route palette hangs on, and
 * `styles/tokens.ts` selects on it from both directions: the scope re-values
 * the palette for everything inside the shell, and a `:root:has(…)` rule above
 * it hands the viewport the scheme its scrollbar and its native controls are
 * drawn in, which is the one part of a palette a selector on the shell is one
 * level too far in to decide. The section attribute is what a sheet about one
 * section keys on (`viewScope`).
 */
export function Shell(props: ShellProps): ReactElement {
  const { mode, onSelectMode } = props;
  const sub: UiSub = props.sub ?? DEFAULT_SUBS[mode];
  const params = props.modeParams ?? {};
  return createElement(
    'div',
    { className: 'mtg-shell', [ROUTE_SCOPE_ATTRIBUTE]: mode, [SUB_SCOPE_ATTRIBUTE]: sub },
    createElement(
      'header',
      { className: 'mtg-shell__bar' },
      homeMark(mode, props, onSelectMode),
      props.setPicker === undefined ? null : props.setPicker,
      createElement(
        'nav',
        { className: 'mtg-modes', 'aria-label': 'View mode' },
        ...PRIMARY_MODES.map((item) => modeItem(mode, item, onSelectMode, params)),
      ),
      createElement('span', { className: 'mtg-shell__spacer' }),
      props.tools === undefined ? null : props.tools,
    ),
    createElement(
      'nav',
      { className: 'mtg-subs', 'aria-label': subsLabel(mode) },
      ...UI_SUBS[mode].map((item) => subItem(mode, sub, item, params)),
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
