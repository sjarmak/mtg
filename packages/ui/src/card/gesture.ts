/**
 * The pointer and keyboard events a face reads, and the one key test among them.
 *
 * Declared structurally rather than imported: the workspace tsconfig has no
 * `lib: dom` (`../mount.ts` writes out why), and React's own event types satisfy
 * these, which is what makes a handler typed against them assignable to a
 * button's props.
 *
 * They were `./Card.ts`'s until `../routes/deck/StripColumns.ts` needed the same
 * two gestures. A strip is not a card face — it is a name bar 26 pixels tall —
 * but the gestures on it mean what they mean on a face, and `isMenuKey` is the
 * part that must not be written twice: a second copy is a second chance for one
 * surface to answer `Shift+F10` and the other not to.
 */

/** The event members the context gesture reads. */
export interface GestureEvent {
  preventDefault(): void;
}

export interface KeyGestureEvent extends GestureEvent {
  readonly key: string;
  readonly shiftKey: boolean;
}

/** How many presses this click is part of; 2 is the second half of a double click. */
export interface ClickGestureEvent {
  readonly detail: number;
}

/**
 * The keyboard's two ways of asking for a context menu.
 *
 * `ContextMenu` is the dedicated key and `Shift+F10` is the long-standing
 * binding for keyboards without one; both are what a screen-reader user reaches
 * for. Without them the right click would be the only route to a card's menu,
 * and a gesture with no keyboard equivalent is a gesture some players do not
 * have.
 */
export function isMenuKey(event: KeyGestureEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}
