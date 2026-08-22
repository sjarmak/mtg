/**
 * A dealt game, held and drawn, plus the one thing a shared screen needs that a
 * private one does not: a moment where the device changes hands.
 *
 * Both entry points render this — the route when a caller hands it a ready-made
 * game, the sealed screen for the game it just dealt — so the session, the error
 * line and the handoff live in one place rather than in two that drift.
 *
 * The handoff is the other half of drawing the board from the seat being asked.
 * The board following the question across the table is right; on a shared screen
 * it also means that the instant one player passes priority, the other player's
 * hand is on a screen the first player is still holding. So when the seat being
 * asked changes, the table is replaced by a card naming who the device is for,
 * and it waits to be told they have it. A one-person game never reaches that
 * card: the session only ever stops on that person's seat, so the seat being
 * asked never moves.
 */
import { createElement, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { PlayerId } from '@mtg/kernel';
import type { PositionArt } from './position';
import { PlayView } from './PlayView';
import { usePlaySession } from './use-session';
import type { PlayConfig } from './use-session';

export interface LiveGameProps {
  readonly config: PlayConfig;
  /**
   * Controls belonging to whatever dealt the game. At the table they join
   * `PlayView`'s own strip; the handoff card has no strip, so there they are the
   * row they always were.
   */
  readonly toolbar?: ReactNode;
  /** Passed straight through to the table; see `PlayView`. */
  readonly artFor?: PositionArt;
}

function handoffCard(name: string, onTake: () => void): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, `Pass the device to ${name}`),
    createElement(
      'span',
      { className: 'mtg-empty__body' },
      'The next decision is theirs, and the board will open on their hand. Nothing is shown until they say they are holding it.',
    ),
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        { type: 'button', className: 'mtg-btn', 'data-variant': 'primary', onClick: onTake },
        `I am ${name}`,
      ),
    ),
  );
}

export function LiveGame(props: LiveGameProps): ReactElement {
  const {
    session,
    viewer,
    beat,
    resume,
    choose,
    restart,
    error,
    autoPass,
    setAutoPass,
    watchBeats,
    setWatchBeats,
    yieldTo,
  } = usePlaySession(props.config);
  // Seeded from the seat on deck at mount rather than from `config.viewer`, so
  // arriving at a game already in progress hands the device to whoever is next
  // instead of opening on a card nobody asked for.
  const [holder, setHolder] = useState<PlayerId>(viewer);
  const names = props.config.names;
  // A finished game is not gated: there is no next decision to pass along, and
  // nothing left on the board that one of the two is not entitled to see. Nor is
  // a combat beat, and that is not an oversight: `usePlaySession` keeps the
  // viewer where it was while the game is paused, so a pause never moves the
  // board to a seat the person holding the device is not sitting in.
  const handing = session.pending !== null && viewer !== holder;

  // Named for the same reason `PlayRoute`'s root is: this wrapper is a link in
  // the chain that carries the viewport's leftover height down to the table.
  return createElement(
    'div',
    { className: 'mtg-live' },
    error === null ? null : createElement('p', { className: 'mtg-prompt__warning', role: 'alert' }, error),
    handing ? (props.toolbar ?? null) : null,
    handing
      ? handoffCard(names[viewer], (): void => {
          setHolder(viewer);
        })
      : createElement(PlayView, {
          session,
          viewer,
          names,
          onChoose: choose,
          onNewGame: restart,
          beat,
          onContinue: resume,
          // The auto-pass controls belong to whoever holds the session, which is
          // this component: they are settings for the seat being asked, and the
          // seat being asked is what this file already tracks.
          autoPass,
          onAutoPass: setAutoPass,
          // And the pauses, which belong to the same holder for the same reason
          // (`mtg-885`). One screen, one person's pacing: this is the component
          // that owns the session, so it is the one that can change an option on
          // it without the change reaching anything the game records.
          beats: watchBeats,
          onBeats: setWatchBeats,
          onYield: yieldTo,
          ...(props.toolbar === undefined ? {} : { toolbar: props.toolbar }),
          ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
        }),
  );
}
