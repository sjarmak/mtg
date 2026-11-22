/**
 * Two people, two sealed pools, two decks nobody else cut.
 *
 * `RemoteGame` is one seat at a table whose decks were already built when it was
 * dealt. This is the screen before that one, for the game the playtester asked for:
 * both players open their own pool, build their own deck, and the table starts
 * when the second deck lands. The link is the same link throughout — the room
 * and the table it becomes answer to one token — so nobody is handed a second
 * one halfway through, and this component simply stops being a builder and
 * starts being a board.
 *
 * # A drafting room lands here too
 *
 * `RemoteDraft` is the phase before this one, and this component is what
 * dispatches to it: a room opened by *Draft against each other* deals packs
 * first and pools afterwards, and the token, the link and the set are the same
 * throughout. So the screen follows the phase, and nobody is handed a second
 * address halfway through.
 *
 * # The pool arrives as ids, and the room says what prints them
 *
 * `@mtg/netplay`'s room sends card ids in pool order, because a 90-card pool
 * repeated every two seconds is a lot of set to send twice. What those ids are
 * resolved *against* is the room's own set, fetched once by `useRoomSet`, and
 * not the set this tab has open. Those are different things and used to be
 * conflated: the lab stages every set it found and lets a person switch between
 * them, so a room dealt from the reduced M13 and read by a tab showing The
 * flagship set refused a pool that was perfectly good (`mtg-77i6`). The set
 * a room deals from is a fact about the room, so the room is what says it.
 *
 * A missing id therefore no longer means the two people are on different sets —
 * that condition is now unreachable. It means the lab that dealt this room sent
 * a pool its own set does not print, which is a refusal for the reason it always
 * was: a builder that quietly dropped a card would cut a deck the server would
 * not assemble, and the person cutting it would find out at the board.
 *
 * # What crosses back is indices
 *
 * The chosen cards go out as positions in that same pool, which is what makes
 * playing a card the pool never held unsayable rather than merely refused, and
 * the deck is assembled on the server by the same function this screen previews
 * with. What the person sees and what the table shuffles are one computation.
 *
 * # A deck can be sent twice
 *
 * Until the other seat submits there is no game, so a sent deck is still an
 * editable one and re-sending replaces it. That is not a hole: the server
 * refuses every submission once the table exists, and the seat sending it is the
 * seat it belongs to.
 */
import { createElement, Fragment, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card, Color } from '@mtg/dsl';
import type { RoomView } from '@mtg/netplay';
import { renderCopy } from '../../copy';
import { useRoom, useRoomSet, submitBuild } from '../../net/room';
import { LanInvite } from './LanInvite';
import type { PositionArt } from './position';
import { RemoteDraft } from './RemoteDraft';
import { RemoteGame } from './RemoteGame';
import { SealedBuilder } from './SealedBuilder';
import {
  adjustBasics,
  clearSelection,
  deckFor,
  resuggest,
  resuggestBasics,
  suggestSelection,
  toggle,
} from './sealed';
import type { SealedBuild } from './sealed';

/** The title over the wait for the room's first answer. */
export const ROOM_OPENING_TITLE = 'Opening your pool';

/** The title over a pool the room's own set does not print. */
export const ROOM_MISMATCH_TITLE = 'This pool is not from the set the room dealt it from';

/** The title over a room that would not hand over the set it deals. */
export const ROOM_SET_TITLE = 'This room would not say what set it deals';

/** What the primary button says, since it sends a deck rather than starting one. */
export const ROOM_SEND_LABEL = 'Send this deck';

/** What it says while the deck is in flight. */
export const ROOM_SENDING_LABEL = 'Sending';

/** What the pool is called here, where two of them exist. */
export const ROOM_POOL_LABEL = 'Your sealed pool';

export interface RemoteSealedProps {
  /** Where the room answers; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /** The link this player was given. It is the seat, in the room and after it. */
  readonly token: string;
  readonly artFor?: PositionArt;
}

function notice(title: string, body: string): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-empty' },
    createElement('span', { className: 'mtg-empty__title' }, title),
    createElement('span', { className: 'mtg-empty__body', role: 'status' }, renderCopy(body)),
  );
}

/** The pool as cards, or the ids the room's own set does not print. */
function resolvePool(
  pool: readonly string[],
  set: readonly Card[],
): { readonly cards: readonly Card[] } | { readonly missing: readonly string[] } {
  const byId = new Map(set.map((card) => [card.id, card]));
  const cards: Card[] = [];
  const missing: string[] = [];
  for (const id of pool) {
    const card = byId.get(id);
    if (card === undefined) missing.push(id);
    else cards.push(card);
  }
  return missing.length === 0 ? { cards } : { missing };
}

/** What a pool the room's own set does not print says, and whose bug it is. */
function mismatchNote(missing: readonly string[]): string {
  return (
    `The room serves the set its pool is printed in, and that set has no card for ` +
    `${missing.slice(0, 3).join(', ')}` +
    (missing.length > 3 ? ` and ${String(missing.length - 3)} more` : '') +
    '. That is the lab that dealt this room disagreeing with itself, so there is nothing to change on this machine; ' +
    'restart the lab that dealt it and open a new room.'
  );
}

export function RemoteSealed(props: RemoteSealedProps): ReactElement {
  const { view, error } = useRoom(props.base, props.token);
  const room = useRoomSet(props.base, props.token);
  const art = props.artFor === undefined ? {} : { artFor: props.artFor };

  if (view === null) {
    return notice(ROOM_OPENING_TITLE, error ?? 'Reading the pool this seat was dealt.');
  }
  // Asked for before the phase is read, because every phase but the board needs
  // it: a pool, a pack and a build preview are all cards, and the board has its
  // own snapshot. A room whose set never arrives says so rather than falling
  // back to whatever this tab has open, which is the whole point of the route.
  if (room.cards === null && view.phase !== 'playing') {
    if (room.error !== null) return notice(ROOM_SET_TITLE, room.error);
    return notice(ROOM_OPENING_TITLE, 'Reading the set this room deals from.');
  }
  // The room keeps answering after the game starts, and this is what that is
  // for: the poll flips a phase and the builder becomes the board, under the
  // token it already held.
  if (view.phase === 'playing') {
    return createElement(RemoteGame, { base: props.base, token: props.token, ...art });
  }
  // Non-null past the guard above; the `??` is what says so without an assertion.
  const cards = room.cards ?? [];
  // A drafting room is this room one phase earlier, and it is dispatched from
  // here rather than mounted separately for the reason the board is: one token
  // addresses the packs, the build and the game, so the screen a person is
  // looking at is a function of the phase and never of which link they followed.
  if (view.phase === 'draft') {
    const pack = view.pack;
    const drafting = resolvePool([...view.pool, ...(pack?.cards ?? [])], cards);
    if ('missing' in drafting) return notice(ROOM_MISMATCH_TITLE, mismatchNote(drafting.missing));
    return createElement(RemoteDraft, {
      base: props.base,
      token: props.token,
      view,
      pool: drafting.cards.slice(0, view.pool.length),
      pack: pack === null ? null : drafting.cards.slice(view.pool.length),
      ...art,
      ...(error === null ? {} : { problem: error }),
    });
  }
  const resolved = resolvePool(view.pool, cards);
  if ('missing' in resolved) return notice(ROOM_MISMATCH_TITLE, mismatchNote(resolved.missing));
  return createElement(RoomBuild, {
    base: props.base,
    token: props.token,
    view,
    pool: resolved.cards,
    set: cards,
    ...art,
    ...(error === null ? {} : { problem: error }),
  });
}

interface RoomBuildProps {
  readonly base: string;
  readonly token: string;
  readonly view: RoomView;
  readonly pool: readonly Card[];
  /**
   * The room's own set, not the page's.
   *
   * Load-bearing on both sides of the wire: `DeckBuildConfig.set` is what makes
   * the mana base print the *set's* basics, and the server assembles the sent
   * deck with the room's set. Handing this the page's staged set previewed one
   * set's basics over another set's pool and keyed the art manifest wrong.
   */
  readonly set: readonly Card[];
  readonly artFor?: PositionArt;
  /** The last thing the poll could not do, drawn without stopping the build. */
  readonly problem?: string;
}

/**
 * The build itself, mounted once the pool is known and kept across every poll.
 *
 * State lives here rather than a level up for the reason `SealedGame` gives: a
 * build is *cut*, and re-deriving it from a prop that moves every two seconds
 * would throw away somebody's work on a schedule. The pool a room deals never
 * changes, so this component mounts once and the polling parent redraws around
 * it.
 */
function RoomBuild(props: RoomBuildProps): ReactElement {
  const { base, token, view } = props;
  const [build, setBuild] = useState<SealedBuild>(() => ({
    pool: props.pool,
    chosen: suggestSelection(props.pool),
    basics: null,
    set: props.set,
    // A room hands over a list of cards. Whatever dealt it did so on the host,
    // and the provenance did not come with it, so this build declines the
    // question rather than answering "no foils" for a pool it never opened.
    foils: null,
  }));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const deck = useMemo(() => deckFor(build), [build]);

  const send = useCallback((): void => {
    setSending(true);
    setRefusal(null);
    void submitBuild(base, token, { chosen: build.chosen, basics: build.basics }).then((answer) => {
      setSending(false);
      setSent(answer.ok);
      setRefusal(answer.ok ? null : answer.message);
    });
  }, [base, token, build]);

  const others = view.seats.filter((_, index) => index !== view.seat);
  const waiting = others.filter((seat) => !seat.ready).map((seat) => seat.name);
  const status = sent
    ? waiting.length === 0
      ? 'Your deck is in. The game starts as soon as the table is ready.'
      : `Your deck is in. Waiting for ${waiting.join(' and ')}.`
    : null;

  // The room's own chrome goes inside the builder's frame rather than above it.
  // Since `mtg-sk1c` the builder fills the window exactly once, and a sibling
  // outside it takes the height it asks for and leaves the panes the rest: the
  // invite is a URL, a token and a code somebody is reading off the screen, and
  // three status lines can arrive under it. `SealedBuilderProps.banner` puts all
  // of that in the box `../../styles/deck.ts` already caps at two fifths and
  // scrolls, which is where everything that is not a pane lives.
  const banner = createElement(
    Fragment,
    null,
    createElement(LanInvite, { base, token }),
    ...(props.problem === undefined
      ? []
      : [createElement('p', { key: 'poll', className: 'mtg-page-note', role: 'status' }, props.problem)]),
    ...(refusal === null
      ? []
      : [createElement('p', { key: 'refused', className: 'mtg-page-note', role: 'alert' }, refusal)]),
    ...(status === null
      ? []
      : [createElement('p', { key: 'sent', className: 'mtg-page-note', role: 'status' }, status)]),
  );

  return createElement(SealedBuilder, {
    banner,
    build,
    deck,
    seed: view.room,
    poolLabel: ROOM_POOL_LABEL,
    playLabel: sending ? ROOM_SENDING_LABEL : ROOM_SEND_LABEL,
    contextNote: contextNoteFor(view),
    // Which pool this is, read off the room rather than off the link somebody
    // followed: a drafting room deals rounds and a sealed one deals none, and
    // the two arrive at this same screen one phase apart. No `setRef` beside
    // it, for the reason the room needs nothing from this page's set — the
    // cards crossed as ids and the room serves the set they are printed in, so
    // whatever this tab has staged is not what a kept deck came from.
    onToggle: (index: number): void => {
      setBuild((current) => toggle(current, index));
    },
    onSuggest: (): void => {
      setBuild((current) => resuggest(current));
    },
    onClear: (): void => {
      setBuild((current) => clearSelection(current));
    },
    onAdjustBasics: (color: Color, delta: number): void => {
      setBuild((current) => adjustBasics(current, color, delta));
    },
    onSuggestBasics: (): void => {
      setBuild((current) => resuggestBasics(current));
    },
    onPlay: send,
    source: view.rounds > 0 ? 'draft' : 'sealed',
    ...(props.artFor === undefined ? {} : { artFor: props.artFor }),
  });
}

/** What this screen is, said to the person looking at it. */
function contextNoteFor(view: RoomView): string {
  const others = view.seats.filter((_, index) => index !== view.seat);
  const opponent = others[0]?.name ?? 'the other player';
  return (
    `This pool is yours alone: ${opponent} opened their own from the same table, and neither of you ` +
    `can see the other's cards. Send a ${String(view.deckSize)}-card deck and the game starts once you both have.`
  );
}
