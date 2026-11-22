/**
 * Two people, one set of packs, and a pick each.
 *
 * `RemoteSealed` is the room whose pools were opened sealed. This is the same
 * room one phase earlier: the two seats take a card at a time out of packs the
 * server deals, and when the packs run out the pools they drafted are the pools
 * that screen builds from. Nothing converts one into the other — the draft
 * writes into the field the build phase reads, and the phase on the next poll is
 * what swaps the screen.
 *
 * # The pack arrives as ids, like the pool
 *
 * And is resolved here for the same reason, against the same set, with the same
 * refusal: a card this page cannot draw is named rather than dropped. A pack
 * silently one card short is a pack whose picks do not mean what the server
 * thinks they mean, because what crosses back is a **position** in it.
 *
 * # A taken pack is put down before the poll says so
 *
 * The pack this seat is looking at goes away the moment its pick lands, and
 * stays away until a poll brings a room with a later revision. Waiting the full
 * poll interval would leave the card that was just taken sitting in the pack,
 * pressable, for up to two seconds — and the second press would be a pick out of
 * a pack that has already been passed. What replaces it is the same wait this
 * screen draws whenever the other seat owes a pick, because that is exactly what
 * is being waited for.
 *
 * # A pick is committed, not tapped
 *
 * The same decision `../draft/DraftPack.ts` argues and for the same reason: a
 * pick cannot be taken back, and on a phone a tap is also how you scroll. So
 * choosing reads a card into the rail and the rail's foot is what sends it.
 */
import { createElement, useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import type { RoomView } from '@mtg/netplay';
import { Card } from '../../card/Card';
import { ContextRail } from '../../panel/ContextRail';
import type { RailSection } from '../../panel/ContextRail';
import { sendPick } from '../../net/room';
import { LanInvite } from './LanInvite';
import type { PositionArt } from './position';

/** What the rail's foot says before a card has been chosen. */
export const DRAFT_PICK_IDLE_LABEL = 'Pick a card';

/** What it says while a pick is crossing. */
export const DRAFT_PICK_SENDING_LABEL = 'Picking';

/** The title over the wait for the other seat's pick. */
export const DRAFT_WAITING_TITLE = 'Waiting for the other player';

/** What the pack region is called, for a screen reader and for a test. */
export const DRAFT_PACK_LABEL = 'Your pack';

const CARD_SECTION = 'Card';
const POOL_SECTION = 'Drafted';

export interface RemoteDraftProps {
  /** Where the room answers; `/api` when Vite is proxying, which it is. */
  readonly base: string;
  /** The seat this player holds, in the draft and in the game it becomes. */
  readonly token: string;
  /** The room as the poll last saw it. */
  readonly view: RoomView;
  /** This seat's pool so far, already resolved by the caller. */
  readonly pool: readonly DslCard[];
  /** The pack in front of this seat as cards, or null when it owes no pick. */
  readonly pack: readonly DslCard[] | null;
  /** The last thing the poll could not do, drawn without stopping the draft. */
  readonly problem?: string;
  readonly artFor?: PositionArt;
}

/** Where this seat is in the draft, as a sentence rather than two numbers. */
export function draftProgressLabel(view: RoomView): string {
  const pack = view.pack;
  if (pack === null) return `${String(view.pool.length)} drafted`;
  const rounds = view.rounds > 0 ? ` of ${String(view.rounds)}` : '';
  return `Pack ${String(pack.round)}${rounds} · Pick ${String(pack.pickNumber)}`;
}

/**
 * Which card in the pack is under inspection, by position and not by id.
 *
 * `./../draft/DraftPack.ts` states the whole argument: a pack can hold two
 * copies of one common, and `at` is how many cards this seat had drafted when
 * the choice was made, so a selection stops matching when the next pack arrives
 * and nothing has to clear it.
 */
interface Selection {
  readonly at: number;
  readonly index: number;
}

export function RemoteDraft(props: RemoteDraftProps): ReactElement {
  const { base, token, view, pack } = props;
  // By position rather than by id: a pack can hold two copies of one card, and
  // an id would light both of them up and send an ambiguous pick. The count of
  // cards already drafted is what expires it — when the next pack lands the
  // count has moved and the selection stops matching, so nothing has to clear
  // it and no stale card can be committed into a pack that no longer holds it.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [section, setSection] = useState<string>(CARD_SECTION);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The revision this seat's last pick was sent against, or null. See the
  // header: the pack is put down on the press and picked up again by the poll.
  const [pickedAt, setPickedAt] = useState<number | null>(null);
  // What the pointer or the keyboard is resting on, by position in the pack
  // (`mtg-pklv`, and `../draft/DraftPack.ts` has the argument). A `Selection` rather
  // than a card for the same two reasons: a pack can hold two copies of one
  // common, and a pointer left over a face the next pack replaced must read as
  // nothing rather than as the card that used to be there.
  const [hover, setHover] = useState<Selection | null>(null);

  const taken = props.pool.length;
  const chosenIndex = selection !== null && selection.at === taken ? selection.index : null;
  const chosen = chosenIndex === null ? null : (pack?.[chosenIndex] ?? null);
  const waiting = pack === null || (pickedAt !== null && view.revision <= pickedAt);
  const hoveredIndex = hover !== null && hover.at === taken ? hover.index : null;
  const hovered = hoveredIndex === null ? null : (pack?.[hoveredIndex] ?? null);
  // Chosen, then pointed at, then empty: the same order the local draft screen
  // reads, because the two are one surface over two backends and a player who
  // learned the panel on one is owed it on the other.
  const reading = chosen ?? hovered;

  const point = useCallback(
    (index: number, card: DslCard | null): void => {
      if (card !== null) {
        setHover({ at: taken, index });
        return;
      }
      // Only the face still holding the panel may empty it: a click focuses the
      // pressed face before the old one blurs.
      setHover((seen) => (seen !== null && seen.at === taken && seen.index === index ? null : seen));
    },
    [taken],
  );

  const select = useCallback(
    (index: number): void => {
      setSelection({ at: taken, index });
      // The card goes where the eye already is. A rail left on the pool would
      // answer a tap with no visible change, which reads as a dead control.
      setSection(CARD_SECTION);
    },
    [taken],
  );

  const commit = useCallback((): void => {
    if (chosenIndex === null) return;
    setSending(true);
    setRefusal(null);
    setPickedAt(view.revision);
    void sendPick(base, token, chosenIndex).then((answer) => {
      setSending(false);
      setSelection(null);
      setRefusal(answer.ok ? null : answer.message);
      // A refused pick did not happen, so the pack comes back: the reasons it is
      // refused — a pack already passed, a room that moved on — are all things a
      // person acts on by looking at what is in front of them now.
      if (!answer.ok) setPickedAt(null);
    });
  }, [base, token, chosenIndex, view.revision]);

  const sections: readonly RailSection[] = useMemo(
    () => [
      {
        name: CARD_SECTION,
        render: (): ReactElement | null =>
          reading === null
            ? null
            : createElement(Card, {
                key: reading.id,
                card: reading,
                size: 'full',
                art: props.artFor?.(reading) ?? null,
              }),
        empty: 'Point at a card in the pack to read it here.',
      },
      {
        name: POOL_SECTION,
        count: props.pool.length,
        render: (): ReactElement | null =>
          props.pool.length === 0
            ? null
            : createElement(
                'div',
                { className: 'mtg-thumbs mtg-thumbs--rail' },
                // Newest first: the card just taken is the one being checked
                // against.
                ...props.pool
                  .map((card, index) =>
                    createElement(Card, {
                      key: `${String(index)}/${card.id}`,
                      card,
                      size: 'compact',
                      art: props.artFor?.(card) ?? null,
                    }),
                  )
                  .reverse(),
              ),
        empty: 'Nothing drafted yet. Your first pick lands here.',
      },
    ],
    [reading, props.pool, props.artFor],
  );

  const foot = createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn',
      'data-variant': 'primary',
      disabled: chosen === null || sending,
      onClick: commit,
    },
    sending ? DRAFT_PICK_SENDING_LABEL : chosen === null ? DRAFT_PICK_IDLE_LABEL : `Pick ${chosen.name}`,
  );

  const notes: readonly (ReactElement | null)[] = [
    props.problem === undefined
      ? null
      : createElement('p', { key: 'poll', className: 'mtg-page-note', role: 'status' }, props.problem),
    refusal === null
      ? null
      : createElement('p', { key: 'refused', className: 'mtg-page-note', role: 'alert' }, refusal),
  ];

  return createElement(
    'div',
    { className: 'mtg-draft mtg-screen' },
    createElement('h1', { className: 'mtg-sr-only' }, 'Draft'),
    createElement(LanInvite, { base, token }),
    ...notes.filter((note): note is ReactElement => note !== null),
    createElement(
      'div',
      { className: 'mtg-strip', 'aria-live': 'polite' },
      createElement('span', { className: 'mtg-strip__title' }, draftProgressLabel(view)),
      createElement('span', { className: 'mtg-strip__note' }, `${String(taken)} drafted`),
      createElement('span', { className: 'mtg-strip__spacer' }),
    ),
    createElement(
      'div',
      { className: 'mtg-work' },
      createElement(
        'div',
        { className: 'mtg-work__main' },
        createElement(
          'div',
          { className: 'mtg-work__scroll' },
          waiting
            ? createElement(
                'div',
                { className: 'mtg-empty' },
                createElement('span', { className: 'mtg-empty__title' }, DRAFT_WAITING_TITLE),
                createElement(
                  'span',
                  { className: 'mtg-empty__body', role: 'status' },
                  'Your pick is in. The next pack arrives once they have taken a card.',
                ),
              )
            : createElement(
                'div',
                { className: 'mtg-thumbs', role: 'group', 'aria-label': DRAFT_PACK_LABEL },
                ...(pack ?? []).map((card, index) =>
                  createElement(Card, {
                    key: `${String(view.revision)}/${String(index)}/${card.id}`,
                    card,
                    size: 'board',
                    art: props.artFor?.(card) ?? null,
                    selected: index === chosenIndex,
                    // Every pack, not only the first: committing removes the
                    // button that was pressed, and without this focus falls to
                    // the body once per pick.
                    autoFocus: index === 0,
                    onSelect: (): void => {
                      select(index);
                    },
                    // Reading, never choosing: the rail's commit keeps naming
                    // whatever was actually chosen.
                    onHover: (over: DslCard | null): void => {
                      point(index, over);
                    },
                  }),
                ),
              ),
        ),
      ),
      createElement(ContextRail, {
        label: 'Draft context',
        sections,
        active: section,
        onSelect: setSection,
        foot,
      }),
    ),
  );
}
