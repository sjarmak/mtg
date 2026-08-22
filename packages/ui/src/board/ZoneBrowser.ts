/**
 * A zone you open rather than a zone you read: the count on the rail, every
 * card one click away.
 *
 * `mtg-bc2.138`. Arena spends no board space on the graveyard or the exile —
 * both open into an examinable browser on click, and the browser is a subsystem
 * rather than a popup: it scrolls, its order is a defined contract, and valid
 * targets are hoisted to the front (`docs/research/prior-art-board-layout.md`,
 * Arena addendum; Patch Notes 2022.13 is the ordering fix, 2021.04v2 the
 * library opening the same way). We drew both graveyards as standing lists in a
 * fixed right column, measured at 1440x900 as 257px wide with everything below
 * y=450 empty.
 *
 * Four decisions, each of which is somebody's cost:
 *
 * - **Closed by default, and closed is a strip rather than a list.** The whole
 *   reclaim is here. It is also what keeps the panel honest for a keyboard: a
 *   thirty-card graveyard drawn open is thirty tab stops between a player and
 *   the next thing on the rail, and closed it is one.
 * - **The order is the caller's and this component never re-sorts it.** That is
 *   the property 2022.13 is about. Arena's defect was not a bad order, it was
 *   three orders for one zone across three browsers; a component that sorted on
 *   its own would put a second order back. The strip names the first entry, so
 *   the closed and open views cannot disagree either.
 * - **Every card is a button.** Not because clicking one does something — it
 *   does not, and nothing here pretends otherwise — but because focus is how a
 *   keyboard reaches the zoom and a tap is how a touch screen does. A
 *   `role`-less element carrying a `title` is dropped from the accessibility
 *   tree outright, which this board has already been bitten by once
 *   (`../../test/board-marks.test.ts`).
 * - **The reveal is the battlefield's zoom, not a second mechanism.**
 *   `../card/ZoomPanel.ts`, a sibling of the button, revealed by the row's
 *   `:hover` and `:focus-within` in `../styles/board/browser.ts`.
 *
 * What is not here: the hoist. Arena shifts cards that are valid targets to the
 * front of the browser, which presumes a targeting mode this surface does not
 * have yet. When it does, the hoist belongs in the caller that knows what is
 * being targeted, beside the order it already chooses, rather than in here.
 */
import { createElement, useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { cardColorIdentity } from '../card/identity';
import { faceAccessibleName, faceDetailText } from '../card/Card';
import { ZoomPanel } from '../card/ZoomPanel';
import type { CardArt } from '../card/ArtSlot';

export interface BrowserCard {
  readonly key: string;
  readonly card: DslCard;
  /** `null` or omitted draws the labeled pending frame, as everywhere else. */
  readonly art?: CardArt | null;
}

export interface ZoneBrowserProps {
  /** The zone's name, spoken and printed: "Your graveyard". */
  readonly label: string;
  /**
   * Every card in the zone, in the order the browser draws them, first at the
   * top. The caller owns that order and owes it a written contract; see
   * `./Graveyard.ts` for the graveyard's.
   */
  readonly cards: readonly BrowserCard[];
  /** What an empty zone says about itself, in its own words. */
  readonly emptyText: string;
  /**
   * Whose pile this is, written to `data-seat` when given.
   *
   * A string rather than the board's seat union, because this component knows
   * nothing about seats and a browser is drawn in places that have none.
   */
  readonly seat?: string;
  /**
   * Which zone this is, written to `data-zone` when given.
   *
   * `data-seat` stopped being enough the moment a seat had two of these:
   * `../motion/geometry.ts` finds a graveyard by the seat attribute alone, and
   * with an exile hanging off the same pod (`./Exile.ts`) that selector matches
   * both piles and resolves by document order. A card flying to the wrong one of
   * two adjacent strips is the kind of wrong nobody files a bug about, so the
   * two say which they are rather than being told apart by where they sit.
   */
  readonly zone?: string;
}

/** `6 cards`, `1 card`. The count a screen reader hears on the toggle. */
function countPhrase(count: number): string {
  return count === 1 ? '1 card' : `${String(count)} cards`;
}

function entry(item: BrowserCard): ReactElement {
  return createElement(
    'li',
    { key: item.key, className: 'mtg-browser__row' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-browser__card',
        // The face's own two channels, on the element that stands in for it:
        // the name a card is read aloud by, and the detail text as the
        // description. `../card/Card.ts` argues both.
        'aria-label': faceAccessibleName(item.card),
        title: faceDetailText(item.card),
      },
      createElement('span', {
        className: 'mtg-swatch',
        'data-identity': cardColorIdentity(item.card),
        'aria-hidden': true,
      }),
      createElement('span', { className: 'mtg-browser__name' }, item.card.name),
    ),
    createElement(ZoomPanel, { card: item.card, art: item.art ?? null }),
  );
}

export function ZoneBrowser(props: ZoneBrowserProps): ReactElement {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = props.cards.length;
  const newest = props.cards[0];

  const label = createElement('span', { className: 'mtg-zone__label' }, props.label);
  const total = createElement('span', { className: 'mtg-zone__count' }, String(count));

  // An empty zone has nothing to open, so it draws no control at all rather
  // than a disabled one: a disabled button is skipped by some screen readers,
  // and the sentence beside it is the whole content of the zone.
  const head: ReactNode =
    count === 0
      ? createElement(
          'div',
          { className: 'mtg-browser__head' },
          label,
          total,
          createElement('span', { className: 'mtg-zone__empty' }, props.emptyText),
        )
      : createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-browser__head',
            'aria-expanded': open,
            'aria-controls': panelId,
            'aria-label': `${props.label}, ${countPhrase(count)}`,
            onClick: () => {
              setOpen(!open);
            },
          },
          label,
          total,
          newest === undefined
            ? null
            : createElement('span', { className: 'mtg-browser__newest' }, newest.card.name),
        );

  return createElement(
    'section',
    {
      className: 'mtg-zone mtg-browser',
      'data-tone': 'rail',
      'aria-label': props.label,
      // Which seat's pile this is, for anything that has to find it on the page
      // rather than read its label. `../motion/geometry.ts` is the caller: a card
      // going to a graveyard has to travel to *that player's* graveyard, and the
      // two piles hang off the two pods (`./Board.ts`) with nothing but their
      // words to tell them apart. A caller that names no seat writes no
      // attribute, so a browser drawn outside a board is unchanged.
      ...(props.seat === undefined ? {} : { 'data-seat': props.seat }),
      ...(props.zone === undefined ? {} : { 'data-zone': props.zone }),
    },
    head,
    open && count > 0
      ? createElement('ul', { className: 'mtg-browser__list', id: panelId }, ...props.cards.map(entry))
      : null,
  );
}
