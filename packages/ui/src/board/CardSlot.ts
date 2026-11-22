/**
 * A place on the table with a card in it, and the whole card on hover.
 *
 * One component for the battlefield and the hand, because the two differ in
 * three attributes and agree about everything that matters: both draw the
 * `board` face, both hand the same face to the same zoom, and a second copy of
 * the zoom wiring is a second copy that can drift.
 *
 * **The zoom.** `docs/research/prior-art-board-layout.md` finds hover-zoom
 * universal (every surveyed client but Cockatrice has one, and Cockatrice is the
 * one that gives up the most) and free in layout terms, which makes it the only
 * detail channel compatible with fitting five zones on one screen. Daybreak say
 * it out loud for Magic Online: the small card is acceptable *because* zoom
 * exists.
 *
 * This docblock used to end that paragraph with "so the board face may drop the
 * rules box, and this is where the rules box went". `mtg-u69` made it false:
 * the board face prints as many lines of its own rules box as its height holds
 * (`../card/anatomy.ts`, `BOARD_REGIONS`), with no pointer event involved. So
 * the zoom is not the only copy of a permanent's rules text; it is the copy
 * that is never clipped, never ellipsized and never cut by a line the box had
 * no room for, which is a smaller claim and the true one. A docblock asserting
 * the board face has no rules box is how the rules box gets dropped again.
 *
 * Four properties it has to hold, and how:
 *
 * - **It must not swallow the click that plays the card.** The panel is a
 *   sibling of the face rather than a child, and it is `pointer-events: none`
 *   in `../styles/card.ts`. Nothing about it is in the hit-test path.
 * - **It must survive the face being a `<button>`.** It is outside the button
 *   entirely, so no interactive element is nested in another and no `div` is
 *   smuggled into phrasing content.
 * - **It must not be clipped by the well it sits in.** Every zone body on the
 *   played table is `overflow: auto`, which clips absolutely positioned
 *   descendants. The panel is `position: fixed`, and a fixed box is clipped only
 *   by an ancestor that is a containing block for it — a transform, a filter, or
 *   layout containment. That is why the slot centers its face with flexbox
 *   rather than the `translate(-50%, -50%)` it used to, and why no ancestor of
 *   a slot may take `container-type: size`.
 * - **It must add no dependency.** It is a second render of the same component
 *   revealed by `:hover` and `:focus-within`, so a keyboard gets it too.
 *
 * The panel itself is `../card/ZoomPanel.ts`, which every surface that
 * abbreviates a card draws — the graveyard browser is the second — so those
 * four properties are stated and held in one place rather than per surface.
 *
 * **A finger reaches the whole card too, and this file has no touch branch.**
 * There is no hover on a touch screen, so for as long as `:hover` was the only
 * trigger this paragraph said a touch user got nothing. Two changes since:
 * `mtg-u69` put a rules box on the board face, so the abbreviation is smaller
 * than it was, and `mtg-yg8` gave the face a long press (`../card/press.ts`)
 * whose first act is to take the focus ring — which is the second trigger
 * already in `../styles/card.ts`, `:focus-within` on the slot. So a gesture
 * reaches the panel through the machinery the keyboard was using.
 *
 * On the played table it deliberately does not: `../styles/card.ts` stands the
 * panel down under `.mtg-board` on a coarse pointer, because `mtg-aqxi.1` gives
 * the tapped card to the rail instead and two answers to one tap is one too
 * many on the screen with the least room. The Cards gallery and the deck tabs
 * keep the panel, having no rail to hand the reading to. The face's `title`
 * (`../card/Card.ts`, `faceDetailText`) is the copy a screen reader hears
 * everywhere, whatever the pointer is.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../card/Card';
import type { FaceStats } from '../card/Card';
import { ZoomPanel } from '../card/ZoomPanel';
import type { CardArt } from '../card/ArtSlot';

/** Which kind of place this is. A hand slot never taps; a play slot may. */
export type SlotKind = 'play' | 'hand';

/**
 * How the slot draws the card in it: the board thumbnail every permanent wears,
 * or the art-only tile the mana base wears (`../card/Card.ts`, `CardSize`).
 *
 * A prop rather than a second slot component, because everything this file is
 * for — the zoom's four properties, the picker's placement, the marks over the
 * corner — is the same for a tile as for a face, and a land that lost any of it
 * would be a land you could not tap, could not read and could not see the
 * counters on.
 */
export type SlotFace = 'board' | 'art';

export interface CardSlotProps {
  readonly kind: SlotKind;
  /** Which face the card is drawn as; absent is the board thumbnail. */
  readonly face?: SlotFace;
  readonly card: DslCard;
  readonly art?: CardArt | null;
  readonly selected?: boolean;
  /** The face's only foot text now that no face on screen prints a collector line. */
  readonly footnote?: string;
  /** Present makes the face a button; absent leaves it inert. */
  readonly onSelect?: () => void;
  /**
   * The other two gestures on the same face: a double click, and a right click
   * or the context key. Both are dropped when the face is inert, because they
   * are gestures on a card you can act on and this slot draws cards you cannot.
   */
  readonly onActivate?: () => void;
  readonly onMenu?: () => void;
  /**
   * The card's own list of moves, drawn when it has more than one on offer.
   *
   * A sibling of the face rather than a child, for the reason the zoom is one:
   * a menu nested inside a button is an interactive element inside another, and
   * the click that picks an option would be a click on the card underneath it.
   * `../styles/board/picker.ts` takes it out of the flow the same way, so a slot in a
   * scrolling zone body cannot clip it.
   */
  readonly picker?: ReactNode;
  readonly tapped?: boolean;
  /** The permanent's current size; absent prints the card's own numbers. */
  readonly stats?: FaceStats;
  /** The kernel object id, so a caller can match a rendered card back. */
  readonly permanentKey?: string;
  /**
   * Whether the reader is currently pointing at this card from somewhere else.
   *
   * `mtg-47o`. A game log line names an object; pressing or hovering that line
   * lights the object here, which is how two of one seat's Gloom Hands are told
   * apart without either of them printing a number. Written as an attribute only
   * when it is true, unlike `data-tapped`: not-pointed-at is the resting state of
   * every card on the table, and an attribute on all of them would be a fact
   * about nothing.
   */
  readonly pointed?: boolean;
  /** Counters, damage and combat flags, drawn over the slot's own corner. */
  readonly marks?: ReactNode;
  /** A control covering the resting face, used by a permanent pile opener. */
  readonly cover?: ReactNode;
}

export function CardSlot(props: CardSlotProps): ReactElement {
  const art = props.art ?? null;
  const onSelect = props.onSelect;
  const base = {
    card: props.card,
    size: props.face ?? ('board' as const),
    art,
    selected: props.selected === true,
    ...(props.footnote === undefined ? {} : { footnote: props.footnote }),
    ...(props.stats === undefined ? {} : { stats: props.stats }),
  };
  const onActivate = props.onActivate;
  const onMenu = props.onMenu;
  const face =
    onSelect === undefined
      ? base
      : {
          ...base,
          onSelect,
          ...(onActivate === undefined
            ? {}
            : {
                onActivate: (): void => {
                  onActivate();
                },
              }),
          ...(onMenu === undefined
            ? {}
            : {
                onMenu: (): void => {
                  onMenu();
                },
              }),
        };
  return createElement(
    'div',
    {
      className: 'mtg-slot',
      'data-slot': props.kind,
      ...(props.tapped === undefined ? {} : { 'data-tapped': props.tapped }),
      ...(props.permanentKey === undefined ? {} : { 'data-permanent-key': props.permanentKey }),
      ...(props.picker === undefined ? {} : { 'data-picking': true }),
      ...(props.pointed === true ? { 'data-pointed': true } : {}),
    },
    createElement(Card, face),
    /* A horizontal identity ribbon for a rotated card when narrow crowded rows
       fan over their lower edges. Hidden in every ordinary layout and hidden
       from assistive technology because Card already carries the full name. */
    props.tapped === true
      ? createElement('span', { className: 'mtg-slot__fan-name', 'aria-hidden': true }, props.card.name)
      : null,
    // After the face rather than before it, and that is load-bearing rather
    // than tidy: `../styles/board/slot.ts` anchors the badges to the card's own
    // art window, and an anchor is only an acceptable one for a positioned
    // element that comes after it in tree order (CSS Anchor Positioning §3.2).
    // Measured in chrome-headless-shell 151: with the row first, every
    // `position-anchor` declaration is dropped and the badges stay in the
    // slot's corner. It reads better too — a screen reader now hears the card
    // and then what has happened to it, rather than the other way round.
    props.marks ?? null,
    createElement(ZoomPanel, {
      card: props.card,
      art,
      ...(props.stats === undefined ? {} : { stats: props.stats }),
    }),
    props.picker ?? null,
    props.cover ?? null,
  );
}
