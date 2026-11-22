/**
 * The frame a deck is read in, and the way back out of it.
 *
 * `mtg-c52t`. Split out of `../DeckRoute.ts`, where all three of that route's
 * screens called it: the built artifact, a written precon, and the Constructed
 * builder. It is the one part of those three that is the same arrangement rather
 * than the same subject.
 */
import { Fragment, createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { builderScreen } from './BuilderScreen';
import type { DeckScreenKind } from './BuilderScreen';

/**
 * The way out of the builder, back to the shelf it was opened from.
 *
 * It is the default rather than the only answer since `mtg-r9vgk`: the deck
 * library and the Constructed builder both come off a shelf of every deck and
 * say so, but the Commander section's decks come off that section's own picker,
 * and `All decks` named a place that page does not have. A host that came from
 * somewhere else names it (`../printed/PrintedPreconRoute.ts`).
 */
export const DECKS_BACK_LABEL = 'All decks';

/**
 * An open deck as a screen: a head that stays put, and one region that scrolls.
 *
 * `mtg-nuk3`. The MTGO capture's deck editor is an app frame — each pane is a
 * fixed-height box with its own scrollbar and a header bar outside the scroll
 * region, inside a window that never scrolls — and this route was a document
 * that scrolled from the shell bar to the mana base. The half-measure the bead
 * refuses is fixed-height panes inside a document that still scrolls, which buys
 * three nested scroll regions and none of the benefit; the frame is the half
 * that has to come first, and it is this.
 *
 * Nothing here is new machinery. `../../styles/panel.ts` already states the
 * contract (`.mtg-screen` fills the viewport once, `.mtg-work__scroll` is the
 * only thing allowed to grow) and the draft route and `RemoteDraft` are already
 * built on it. `data-rail='none'` because a deck has no rail yet; the left
 * filter rail is `mtg-m9op` and is blocked on this route having a pool to
 * filter at all.
 *
 * What it buys, beyond matching the capture. The pane header's sticky offset
 * stops being a measured number: `../../styles/deck.ts` pins it 3.5rem down to
 * clear an opaque shell bar it cannot measure, and gives up entirely below
 * 450px where that bar wraps and stops having one height. Inside a scroll
 * container there is no bar overhead to clear, so the offset stops being a
 * measurement of anything outside the pane and the narrow-viewport exception
 * goes with it. What it is instead is this scrollport's own padding, negated,
 * for the reason `../../styles/deck.ts` states: sticky measures from the padding
 * box and `overflow` clips at it, so zero would pin the header one padding
 * short of the edge it is clipped at.
 *
 * Per-pane scrollbars, which is the rest of the capture's shape, are not here.
 * The question that blocked them — where the plan, the shared criteria and the
 * mana base live once the panes are fixed-height boxes — is answered by
 * `mtg-z4q6`: behind the head's `DECK_DETAILS_LABEL` button, which is why this
 * function takes a `head` slot at all. What is left of `mtg-tz11` is the panes
 * themselves becoming boxes with their own scrollbars.
 *
 * The arrangement itself is `./BuilderScreen.ts`'s since `mtg-sk1c`, which
 * gave the sealed builder's three hosts the same frame. What stays here is this
 * route's head bar, which is the only part of a screen that differs by host.
 */
export function deckScreen(
  title: string,
  body: ReactElement,
  onBack: () => void,
  head?: ReactNode,
  screen: DeckScreenKind = 'mtg-deck-screen',
  backLabel: string = DECKS_BACK_LABEL,
): ReactElement {
  return builderScreen({
    screen,
    head: createElement(
      Fragment,
      null,
      createElement('h1', { className: 'mtg-page-title' }, title),
      createElement('span', { className: 'mtg-toolbar__spacer' }),
      head ?? null,
      createElement('button', { type: 'button', className: 'mtg-btn', onClick: onBack }, backLabel),
    ),
    body,
  });
}
