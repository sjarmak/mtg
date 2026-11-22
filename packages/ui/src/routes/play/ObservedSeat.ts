/**
 * One seat at a Forge table played over the network.
 *
 * # The page follows the table's phase, and the builder is a guest in it
 *
 * A table born at `POST /api/observed` goes seating, playing, finished, and
 * every seat learns which by long-polling its own frame; `../../net/observed-table.ts`
 * holds that loop and this component draws whatever it has just been handed.
 * While the table is seating, the deck builder the format already owns is
 * rendered through `builder`, given the pool seed the table dealt this seat and
 * a `submitDeck` that hands the built deck up the wire. The builder is not told
 * it is on a network; it is told a seed and a button. Once both decks are in
 * the table opens Forge, the frame turns to playing, and `./BackendGame.ts`
 * takes the board with the seat's own client as its backend and the same long
 * poll as its feed, so a move the other seat makes arrives without this seat
 * doing anything.
 *
 * # What this seat may know
 *
 * The frame carries this seat's deck and never the other's, and the view has
 * the other hand nulled before it left the lab. `observedTableOf` states the
 * table that way, with a named placeholder where the other deck would be, and
 * nothing here asks for more.
 */
import { createElement, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { DeckRef, MatchRules, SeatId } from '@mtg/engine';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { observedSeatBackend, observedTableOf } from '../../net/observed-table';
import type { ObservedSeatClient, ObservedSeatState } from '../../net/observed-table';
import { BackendGame } from './BackendGame';
import { LanInvite } from './LanInvite';
import { CONNECTING_LABEL } from './RemoteGame';

export const OBSERVED_WAITING_LABEL = 'Waiting for the table to answer.';
export const OBSERVED_BUILD_LABEL = 'Build your deck, then hand it to the table.';
export const OBSERVED_SUBMITTED_LABEL = 'Your deck is in. Waiting for the other seat.';
export const OBSERVED_OPENING_LABEL = 'Both decks are in. Forge is opening the table.';
export const OBSERVED_SUBMIT_DECK_LABEL = 'Submit this deck to the table';
export const OBSERVED_LEAVE_LABEL = 'Leave the table';
export const OBSERVED_ENDED_LABEL = 'The table has closed';
export const OBSERVED_BACK_LABEL = 'Back';

/** Every observed seat link starts this way; kernel table tokens never do. */
export const OBSERVED_TOKEN_PREFIX = 'obs-';

/** Where an observed seat answers, once the hash names one. */
export interface ObservedSeatLink {
  readonly base: string;
  readonly token: string;
}

/** The observed seat the hash names, or undefined when its `table` is absent or a kernel table's. */
export function observedSeatLink(
  params: Readonly<Record<string, string>>,
  base: string,
): ObservedSeatLink | undefined {
  const token = params['table'];
  return token !== undefined && token.startsWith(OBSERVED_TOKEN_PREFIX) ? { base, token } : undefined;
}

/** What the builder is told about the seat it is building for. */
export interface ObservedSeating {
  readonly seat: SeatId;
  /** The seed this seat's pool is dealt from; the other seat has its own. */
  readonly poolSeed: string;
  /** Which seats have handed in a deck. */
  readonly submitted: readonly boolean[];
  /** This seat's own deck once it is in, or null while it is being built. */
  readonly deck: DeckRef | null;
}

export interface ObservedSeatProps {
  /** Where the table answers; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /** This browser's seat link. The server reads the seat off it. */
  readonly token: string;
  /** Exact printing data the board presents named objects with. */
  readonly printedCards: readonly PrintedCardPresentation[];
  /** The table's rules, when the format states any; Commander tables do. */
  readonly rules?: MatchRules;
  /** The format's own deck builder, drawn while the table is seating. */
  readonly builder: (seating: ObservedSeating, submitDeck: (deck: DeckRef) => void) => ReactElement;
  /** Takes the seat's link back out of the hash once the table is left. */
  readonly onLeave: () => void;
}

function notice(title: string, body: string, action: ReactElement | null = null): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body', role: 'status' }, body),
    action,
  );
}

function button(label: string, onClick: () => void): ReactElement {
  return createElement('button', { type: 'button', className: 'mtg-btn', onClick }, label);
}

/** What the status line says while the table is seating. */
export function seatingStatus(seating: ObservedSeating): string {
  if (seating.deck === null) return OBSERVED_BUILD_LABEL;
  return seating.submitted.every(Boolean) ? OBSERVED_OPENING_LABEL : OBSERVED_SUBMITTED_LABEL;
}

interface SeatingPanelProps {
  readonly base: string;
  readonly token: string;
  readonly seating: ObservedSeating;
  readonly refusal: string | null;
  readonly builder: ObservedSeatProps['builder'];
  readonly onSubmitDeck: (deck: DeckRef) => void;
  readonly onLeave: () => void;
}

function seatingPanel(props: SeatingPanelProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-play-route' },
    createElement(LanInvite, { base: props.base, token: props.token, route: 'observed' }),
    createElement('p', { className: 'mtg-page-note', role: 'status' }, seatingStatus(props.seating)),
    props.refusal === null
      ? null
      : createElement('p', { className: 'mtg-prompt__warning', role: 'alert' }, props.refusal),
    createElement('div', { className: 'mtg-toolbar' }, button(OBSERVED_LEAVE_LABEL, props.onLeave)),
    props.seating.deck === null ? props.builder(props.seating, props.onSubmitDeck) : null,
  );
}

/** The seat's own connection, created once per token and polled for as long as the seat is mounted. */
function useObservedSeat(base: string, token: string): [ObservedSeatClient, ObservedSeatState] {
  const [client] = useState(() => observedSeatBackend(base, token));
  useEffect(() => client.connect(), [client]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return [client, state];
}

/** Mount keyed by `token`: the connection is made once, and a new seat is a new mount. */
export function ObservedSeat(props: ObservedSeatProps): ReactElement {
  const [client, state] = useObservedSeat(props.base, props.token);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { onLeave } = props;
  const submitDeck = useCallback(
    (deck: DeckRef): void => {
      setRefusal(null);
      void client.submitDeck(deck).then(setRefusal);
    },
    [client],
  );
  const leave = useCallback((): void => {
    void client.leave().then(() => onLeave());
  }, [client, onLeave]);

  const frame = state.frame;
  if (frame === null) return notice(CONNECTING_LABEL, state.problem ?? OBSERVED_WAITING_LABEL);
  const phase = frame.phase;
  if (phase.kind === 'ended') {
    return notice(OBSERVED_ENDED_LABEL, phase.message, button(OBSERVED_BACK_LABEL, onLeave));
  }
  if (phase.kind === 'seating') {
    return seatingPanel({
      base: props.base,
      token: props.token,
      seating: { seat: frame.seat, poolSeed: phase.poolSeed, submitted: phase.submitted, deck: frame.deck },
      refusal: state.problem ?? refusal,
      builder: props.builder,
      onSubmitDeck: submitDeck,
      onLeave: leave,
    });
  }
  return createElement(
    'div',
    { className: 'mtg-play-route' },
    createElement(BackendGame, {
      key: props.token,
      backend: client.backend,
      table: observedTableOf(frame, phase, props.rules),
      printedCards: props.printedCards,
      feed: client.feed,
      onClose: leave,
    }),
  );
}
