/**
 * The whole card, drawn beside a small one and shown only on hover or focus.
 *
 * One panel for every surface that abbreviates a card, because a second copy of
 * the zoom wiring is a second copy that can drift — the argument
 * `../board/CardSlot.ts` already makes for using one slot component on the
 * battlefield and in the hand, one level down. `../styles/card.ts` owns the
 * placement and the `display: none` it starts from; each surface adds the pair
 * of triggers that reveal it, and both halves of that pair are mandatory:
 * `:hover` is the pointer's and `:focus-within` is the keyboard's, and a
 * surface that declares only the first is unreachable without a mouse.
 *
 * Four properties the placement holds, recorded in `CardSlot`'s docblock and
 * true wherever this is used: it never swallows a click (`pointer-events:
 * none`), it is a sibling of the interactive element rather than a child, it is
 * `position: fixed` so a scrolling well cannot clip it, and it adds no
 * dependency — it is a second render of `Card` at `full`.
 *
 * **The panel is exactly a card, and used not to be.** The playtester, 2026-08-13:
 * "when hovering over to see the full card while playing it shows a border that
 * extends further vertically". The `full` face carried a `min-height` at the
 * printed trim rather than an `aspect-ratio`, which is a floor and not a shape,
 * so a talkative card grew and drew its 7px identity border down the grown box.
 * A gallery hid that behind its neighbors; a panel floating on its own did not.
 * The fix is in `../styles/card.ts` at the face rather than here, because the
 * same floor made every full face in the lab a different height, and this
 * surface was only the place it was impossible to miss.
 *
 * **This is the surface the fit ladder's floor answers to.** The face is a fixed
 * box, the rules box takes what the trim leaves, and the text steps down inside
 * it (`../styles/card.ts`, `FACE_TRIM`) — so a wordy card is a card set small.
 * A panel drawn at the face's own width would set it just as small and be no
 * answer at all, which is why the panel is now 20rem against the face's 15.25
 * and its rules box goes back to step 0. `ZOOM_FACE_WIDTH_REM`'s docblock has
 * the arithmetic for why 20 is enough room to do that in.
 *
 * A limit worth stating, unchanged: a `pointer-events: none` panel cannot be
 * scrolled, so nothing here may rely on a scrollbar. It does not — the rules box
 * is `overflow-y: clip` at every size now. Text past even this panel is
 * reachable through the `title` of the face the panel is beside
 * (`faceDetailText`), and the guard against it arising is upstream:
 * `@mtg/card-render` fits the printed rules box against a measured metrics table
 * and `checkSvgOverflow` fails a face whose ink escapes it.
 *
 * `aria-hidden`, because the thing it is beside already carries the card's name
 * and its detail text. Without it a screen reader reads every card twice.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from './Card';
import type { FaceStats } from './Card';
import type { CardArt } from './ArtSlot';

export interface ZoomPanelProps {
  readonly card: DslCard;
  readonly art?: CardArt | null;
  /**
   * The permanent's current size. Present, it is drawn instead of the printed
   * numbers: a zoom that reverted to the print would make the detail channel
   * disagree with the thing it is a detail of, and the hover is where a player
   * checks a creature before combat. A card in a graveyard is a card again, so
   * that zone passes nothing.
   */
  readonly stats?: FaceStats;
}

export function ZoomPanel(props: ZoomPanelProps): ReactElement {
  const stats = props.stats;
  return createElement(
    'div',
    { className: 'mtg-zoom', 'aria-hidden': true },
    createElement(Card, {
      card: props.card,
      art: props.art ?? null,
      size: 'full',
      ...(stats === undefined ? {} : { stats }),
    }),
  );
}
