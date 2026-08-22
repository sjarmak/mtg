/**
 * Two ways into a game, side by side, when the checkout has both.
 *
 * A person arriving at `npm run play` with a precon file staged has two honest
 * options — pick one of the finished decks, or open six packs and build — and
 * neither is a footnote to the other. So they are two buttons at the top of the
 * page rather than a flag, a route, or a paragraph of documentation.
 *
 * # Which screen you are looking at is view state, and the selection is not
 *
 * The deal inputs — the seed and the two deck ids — go in the hash, because a
 * game is reproduced from them and a table has to be nameable. Which of the two
 * builders is on screen reproduces nothing: pressing Play from either one
 * publishes everything the game was made of. So the toggle lives here, in
 * state, and the hash stays the record of games rather than of clicks.
 *
 * Both children are constructed by the caller and only one is mounted. That is
 * deliberate: a `SealedGame` element is cheap, and its pool is opened in a lazy
 * state initializer at *mount*, so nothing is dealt for the screen nobody is
 * looking at.
 */
import { createElement, Fragment, useState } from 'react';
import type { ReactElement } from 'react';

export type BuilderKind = 'precon' | 'sealed';

export interface BuilderSwitchProps {
  readonly precon: (onPlayingChange: (playing: boolean) => void) => ReactElement;
  readonly sealed: (onPlayingChange: (playing: boolean) => void) => ReactElement;
  /** Which one opens. The precon decks, when there are any. */
  readonly initial?: BuilderKind;
}

export const BUILDER_SWITCH_LABEL = 'How to play';
export const PRECON_TAB_LABEL = 'Preconstructed decks';
export const SEALED_TAB_LABEL = 'Open a sealed pool';

function tab(
  kind: BuilderKind,
  label: string,
  current: BuilderKind,
  onSelect: (kind: BuilderKind) => void,
): ReactElement {
  const chosen = kind === current;
  return createElement(
    'button',
    {
      key: kind,
      type: 'button',
      className: 'mtg-btn',
      'aria-pressed': chosen,
      ...(chosen ? { 'data-variant': 'primary' } : {}),
      onClick: (): void => {
        onSelect(kind);
      },
    },
    label,
  );
}

export function BuilderSwitch(props: BuilderSwitchProps): ReactElement {
  const [kind, setKind] = useState<BuilderKind>(props.initial ?? 'precon');
  const [playing, setPlaying] = useState(false);
  const child = kind === 'precon' ? props.precon : props.sealed;
  return createElement(
    Fragment,
    null,
    playing
      ? null
      : createElement(
          'div',
          { className: 'mtg-toolbar', role: 'group', 'aria-label': BUILDER_SWITCH_LABEL },
          tab('precon', PRECON_TAB_LABEL, kind, setKind),
          tab('sealed', SEALED_TAB_LABEL, kind, setKind),
        ),
    createElement(Fragment, { key: kind }, child(setPlaying)),
  );
}
