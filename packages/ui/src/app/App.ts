/**
 * One app, peer modes.
 *
 * The three surfaces built on this foundation (card renderer, replay viewer,
 * analysis dashboard) are *views* plugged into one shell, not three separate
 * apps: a view is `(route) => ReactNode`, so it can read its own params out of
 * the hash without the shell knowing what they mean.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { GlobalStyles } from '../styles/index';
import { Shell } from './Shell';
import { useHashRoute } from './router';
import type { UiMode, UiRouter } from './router';

export type UiView = (router: UiRouter) => ReactNode;
export type UiViews = Readonly<Record<UiMode, UiView>>;

export interface AppProps {
  readonly views: UiViews;
  readonly title?: string;
  readonly subtitle?: string;
  readonly aside?: ReactNode;
  /** Which set the page is showing; drawn in the bar on every route including play. */
  readonly setPicker?: ReactNode;
  /** Shown under the bar on every route; the reduced-set disclosure rides here. */
  readonly notice?: ReactNode;
  /** Mount the token sheet. Off when the host page already has it. Default on. */
  readonly withStyles?: boolean;
}

export function App(props: AppProps): ReactElement {
  const router = useHashRoute();
  const view = props.views[router.route.mode];
  const shell = createElement(Shell, {
    mode: router.route.mode,
    onSelectMode: router.goTo,
    children: view(router),
    ...(props.title === undefined ? {} : { title: props.title }),
    ...(props.subtitle === undefined ? {} : { subtitle: props.subtitle }),
    ...(props.aside === undefined ? {} : { aside: props.aside }),
    ...(props.setPicker === undefined ? {} : { setPicker: props.setPicker }),
    ...(props.notice === undefined ? {} : { notice: props.notice }),
  });
  if (props.withStyles === false) return shell;
  return createElement(Fragment, null, createElement(GlobalStyles), shell);
}
