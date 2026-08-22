/**
 * Exile: the zone a card leaves for, drawn so leaving is not the same as
 * vanishing.
 *
 * `mtg-iidz`. It ships with the `exileTarget` effect, and the reason it has to
 * is that a removal spell whose card goes somewhere the player cannot look
 * reads as a bug rather than as a rule. The graveyard already had a strip you
 * open (`./Graveyard.ts`); this is the same panel, the same order contract, and
 * a different sentence, because the two zones differ in what they mean and in
 * nothing else the board draws.
 *
 * **Newest first, exactly as the graveyard is**, and for the same reason: the
 * kernel's zone array is oldest-first, and the thing a player is looking for is
 * what just left. The Arena defect quoted in `./Graveyard.ts` names this zone
 * outright — "the order of a Graveyard or Exile zone" — so drawing the second
 * of the two in the opposite order would be reintroducing the exact bug that
 * paragraph was written down to prevent.
 *
 * **Split by owner before it reaches here.** The kernel keeps one game-wide
 * exile (`@mtg/kernel`'s `GameState.exile`) rather than one per seat, and the
 * board hangs each seat's zones off that seat's own pod (`./Board.ts`), so the
 * caller is what decides whose card an exiled object is — from
 * `GameObject.owner`, which is what a card's owner means in every zone and does
 * not change when the card moves.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { ZoneBrowser } from './ZoneBrowser';
import type { BrowserCard } from './ZoneBrowser';

export type ExileCard = BrowserCard;

export interface ExileProps {
  readonly label: string;
  /** Ordered oldest-first, matching the kernel's zone array. */
  readonly cards: readonly ExileCard[];
  /** Whose cards these are, passed through to the browser's `data-seat`. */
  readonly seat?: string;
}

/** The sort contract, as a function: newest first, stable, nothing else. */
function exileOrder(cards: readonly ExileCard[]): readonly ExileCard[] {
  return [...cards].reverse();
}

export function Exile(props: ExileProps): ReactElement {
  return createElement(ZoneBrowser, {
    label: props.label,
    cards: exileOrder(props.cards),
    emptyText: 'exile is empty',
    zone: 'exile',
    ...(props.seat === undefined ? {} : { seat: props.seat }),
  });
}
