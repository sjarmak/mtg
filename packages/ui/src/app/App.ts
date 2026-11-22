/**
 * One app, peer modes.
 *
 * The surfaces built on this foundation (card renderer, replay viewer,
 * analysis dashboard, the tables) are *views* plugged into one shell, not
 * separate apps: a view is `(router) => ReactNode`, so it can read its own
 * params and its section out of the hash without the shell knowing what they
 * mean. There is one view per mode; which section of the mode it draws is the
 * view's own question about `router.route.sub`.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { GlobalStyles } from '../styles/index';
import { FeedbackOverlay } from '../feedback/FeedbackOverlay';
import { FeedbackToggle } from '../feedback/FeedbackToggle';
import { useFeedbackToggle } from '../feedback/toggle';
import { Shell } from './Shell';
import { modeParams, useHashRoute } from './router';
import type { RouteAt, UiMode, UiRouter } from './router';

export type UiView = (router: UiRouter) => ReactNode;
export type UiViews = Readonly<Record<UiMode, UiView>>;

export interface AppProps {
  readonly views: UiViews;
  readonly title?: string;
  /** Which set the page is showing; drawn in the bar on every route including play. */
  readonly setPicker?: ReactNode;
  /**
   * Shown under the bar, on the routes that are reading rather than playing.
   *
   * `mtg-aqxi.16`. The reduced-set disclosure rides here, and it used to ride on
   * every route, which put a two-line paragraph about collector positions above
   * the board and above the pack — on a phone and on a desktop alike. It is a
   * fact about the set, it never changes while you play, and the set picker in
   * the bar already carries the `Partial` badge. So the play routes drop it and
   * the reading routes keep it, where the sentence is next to the cards it is
   * about.
   */
  readonly notice?: ReactNode;
  /**
   * Whether a game is on the table on a route that is not Play.
   *
   * The deck builder hosts a constructed game of its own under Customize, and
   * while it does the notice would stand above a board exactly the way it stood
   * above Play's before `mtg-aqxi.16`. The route that seats the game reports it
   * up, and the shell keeps the sentence off the table for as long as it lasts.
   */
  readonly seated?: boolean;
  /** Mount the token sheet. Off when the host page already has it. Default on. */
  readonly withStyles?: boolean;
  /**
   * Draw the feedback helper's switch and, when it is on, its floating Report
   * button over every route (`../feedback/`). Default on; a host page that has
   * nowhere to file a report (the fixtures app) turns it off.
   */
  readonly withFeedback?: boolean;
}

/** Whether the route is a table rather than a page, and takes no standing notice. */
function playing(at: RouteAt, seated: boolean): boolean {
  return at.mode === 'play' || seated;
}

export function App(props: AppProps): ReactElement {
  const router = useHashRoute();
  const view = props.views[router.route.mode];
  const notice = playing(router.route, props.seated === true) ? undefined : props.notice;
  const at: RouteAt = router.route;
  const feedback = useFeedbackToggle();
  const withFeedback = props.withFeedback !== false;
  const shell = createElement(Shell, {
    ...at,
    modeParams: modeParams(router.route),
    onSelectMode: (mode: UiMode, params?: Readonly<Record<string, string>>): void => {
      router.goTo(params === undefined ? { mode } : { mode, params });
    },
    children: view(router),
    ...(props.title === undefined ? {} : { title: props.title }),
    ...(props.setPicker === undefined ? {} : { setPicker: props.setPicker }),
    ...(notice === undefined ? {} : { notice }),
    ...(withFeedback
      ? { tools: createElement(FeedbackToggle, { enabled: feedback.enabled, onChange: feedback.setEnabled }) }
      : {}),
  });
  // The helper is the third child rather than something inside the shell's
  // main region, because it is fixed to the viewport and drawn over whichever
  // route is up; off, it is nothing at all.
  const overlay = withFeedback && feedback.enabled ? createElement(FeedbackOverlay) : null;
  if (props.withStyles === false) return createElement(Fragment, null, shell, overlay);
  return createElement(Fragment, null, createElement(GlobalStyles), shell, overlay);
}
