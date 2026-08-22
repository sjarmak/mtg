/**
 * One seat at a table on another machine.
 *
 * The counterpart of `LiveGame`, and the shape of the difference is the point of
 * the whole lane. `LiveGame` holds a session and hands the device across the
 * table between decisions; this holds a link and never hands anything to anyone,
 * because the other player is in another room with their own screen. So the
 * handoff card is gone and the thing that replaces it is the connection state:
 * the two ways a game can be not-your-turn are the opponent thinking and the
 * network being down, and a player is entitled to know which.
 *
 * **The viewer is fixed.** `usePlaySession`'s `seatOnDeck` moves the board to
 * whichever seat is being asked, which is right on a shared screen and is the
 * one thing that must not happen here: this browser is one seat, it holds that
 * seat's link, and the server will not send it the other seat's cards even if
 * something asked. `snapshot.seat` is where the board is drawn from, and it
 * comes from the server rather than from a prop, so a page cannot decide to be
 * the other player.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { AutoPassSettings, PlayerId, Step } from '@mtg/kernel';
import type { SeatSnapshot } from '@mtg/netplay';
import { sessionViewOf } from '../../net/snapshot';
import { useRemoteTable } from '../../net/remote-table';
import type { PositionArt } from './position';
import { PlayView } from './PlayView';

/** The title of the panel drawn while there is no position to draw. */
export const CONNECTING_LABEL = 'Connecting';

export interface RemoteGameProps {
  /** Where the table answers; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /** The link this player was given. It is the seat. */
  readonly token: string;
  readonly artFor?: PositionArt;
}

/**
 * The wire's auto-pass back into the kernel's.
 *
 * The inverse of `remote-table.ts`'s `toWire`, and here rather than imported
 * from `@mtg/netplay` for the same reason: a value import from that package
 * would put `node:http` in this bundle.
 */
function autoPassOf(snapshot: SeatSnapshot): AutoPassSettings {
  return {
    enabled: snapshot.autoPass.enabled,
    passUnstopped: snapshot.autoPass.passUnstopped,
    stops: {
      yourTurn: new Set<Step>(snapshot.autoPass.stops.yourTurn),
      theirTurn: new Set<Step>(snapshot.autoPass.stops.theirTurn),
    },
  };
}

function notice(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body', role: 'status' }, body),
  );
}

export function RemoteGame(props: RemoteGameProps): ReactElement {
  const { snapshot, error, connected, choose, setAutoPass, yieldTo } = useRemoteTable(
    props.base,
    props.token,
  );

  if (snapshot === null) {
    // Nothing has arrived yet. The error line is the whole of what this page
    // knows, and it is the useful half: a mistyped link and a server that is not
    // running are both "no board", and only one of them is worth restarting
    // anything over.
    return notice(
      CONNECTING_LABEL,
      error === null ? 'Asking the table for this seat.' : `Cannot reach the table: ${error}`,
    );
  }

  const seat: PlayerId = snapshot.seat;
  const other: PlayerId = seat === 0 ? 1 : 0;
  // Only when the other seat owes it. The game being over is a different state
  // and `PlayView` draws its own panel for that one.
  const awaitingName = snapshot.awaiting === other ? snapshot.names[other] : null;

  return createElement(
    'div',
    { className: 'mtg-live' },
    connected
      ? null
      : createElement(
          'p',
          { className: 'mtg-prompt__warning', role: 'alert' },
          'Reconnecting to the table. The game is safe: it lives on the server, and this page picks up where it left off.',
        ),
    error === null ? null : createElement('p', { className: 'mtg-prompt__warning', role: 'alert' }, error),
    createElement(PlayView, {
      session: sessionViewOf(snapshot),
      viewer: seat,
      names: snapshot.names,
      onChoose: choose,
      awaitingName,
      autoPass: autoPassOf(snapshot),
      onAutoPass: setAutoPass,
      onYield: yieldTo,
      ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
    }),
  );
}
