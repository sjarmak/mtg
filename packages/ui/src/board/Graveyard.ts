/**
 * The graveyard: a count you glance at, and a browser you open.
 *
 * This file is the graveyard's half of `./ZoneBrowser.ts` — the words the zone
 * uses and, more importantly, the one thing the browser refuses to decide for
 * itself: the order.
 *
 * **The sort contract: newest first, everywhere the zone is drawn.** The
 * kernel's zone array is oldest-first, and what a player wants from a graveyard
 * at a glance is what just died, so the array is reversed exactly once, here.
 * Two consequences are the contract rather than side effects. The strip on the
 * rail names the same card the open browser lists first, because both read this
 * one order. And nothing re-sorts by name, by mana value or by type: the order
 * is the order things went to the graveyard in, which is the only one a player
 * can predict without reading a menu.
 *
 * The argument for writing it down at all is Arena's, and it is a bug report
 * rather than a preference. Patch Notes 2022.13: "Sometimes the order of a
 * Graveyard or Exile zone would, when examined, go old to new, then in another
 * browser it might go new to old, and then in a third type of browser it might
 * be random. They are now consistent." Three orders for one zone is what an
 * unstated contract decays into.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { ZoneBrowser } from './ZoneBrowser';
import type { BrowserCard } from './ZoneBrowser';

export type GraveyardCard = BrowserCard;

export interface GraveyardProps {
  readonly label: string;
  /** Ordered oldest-first, matching the kernel's zone array. */
  readonly cards: readonly GraveyardCard[];
  /** Whose pile it is, passed through to the browser's `data-seat`. */
  readonly seat?: string;
}

/** The sort contract, as a function: newest first, stable, nothing else. */
function graveyardOrder(cards: readonly GraveyardCard[]): readonly GraveyardCard[] {
  return [...cards].reverse();
}

export function Graveyard(props: GraveyardProps): ReactElement {
  return createElement(ZoneBrowser, {
    label: props.label,
    cards: graveyardOrder(props.cards),
    emptyText: 'graveyard is empty',
    zone: 'graveyard',
    ...(props.seat === undefined ? {} : { seat: props.seat }),
  });
}
