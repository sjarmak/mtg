/**
 * The one outer play surface used by every live rules engine.
 *
 * Rules adapters supply an already-wired table. This component owns only the
 * route furniture and interaction behavior that must not drift by backend:
 * toolbar placement, table sizing, inspection focus, disclosure focus parking,
 * and the Escape boundary for an open table interaction.
 */
import { createElement } from 'react';
import type {
  FocusEventHandler,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
  Ref,
} from 'react';
import { asClosest, asFocusable } from './focus';

export interface PlayFrameProps {
  readonly table: ReactNode;
  readonly toolbar?: ReactNode;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly onFocus?: FocusEventHandler<HTMLDivElement>;
  readonly onInspect?: (event: { readonly target: unknown }) => void;
  readonly onContextMenu?: (event: { readonly target: unknown; preventDefault: () => void }) => void;
  readonly onEscape?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  readonly projectionVersion?: number;
}

export function PlayFrame(props: PlayFrameProps): ReactElement {
  return createElement(
    'div',
    {
      className: 'mtg-play',
      'data-play-frame': 'shared',
      ...(props.rootRef === undefined ? {} : { ref: props.rootRef }),
      tabIndex: -1,
      ...(props.onFocus === undefined ? {} : { onFocus: props.onFocus }),
      ...(props.onContextMenu === undefined ? {} : { onContextMenu: props.onContextMenu }),
      onClickCapture: (event: { readonly target: unknown; stopPropagation: () => void }): void => {
        const pressed = asClosest(event.target);
        if (pressed === null || pressed.closest('[data-inspect-card]') === null) return;
        event.stopPropagation();
        props.onInspect?.(event);
      },
      onClick: (event: {
        readonly detail: number;
        readonly target: unknown;
        readonly currentTarget: unknown;
      }): void => {
        if (event.detail === 0) return;
        const pressed = asClosest(event.target);
        if (pressed === null || pressed.closest('[aria-expanded]') === null) return;
        asFocusable(event.currentTarget)?.focus();
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') props.onEscape?.(event);
      },
    },
    props.toolbar ?? null,
    createElement(
      'div',
      {
        className: 'mtg-play__table',
        role: 'region',
        'aria-label': 'Game table',
        ...(props.projectionVersion === undefined
          ? {}
          : { 'data-projection-version': props.projectionVersion }),
      },
      props.table,
    ),
  );
}
