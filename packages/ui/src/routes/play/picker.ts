/**
 * One card's own moves, drawn in the rail's column.
 *
 * The same button as the rail's, from the same list, carrying the same index —
 * `choice-button.ts` is the shared one and says why it is shared. It is a
 * labeled group so a screen reader announces whose moves these are, and it holds
 * only the choices that act on this card: widening it to the prompt would put
 * moves on a card that have nothing to do with it.
 *
 * One card can map to several choices, because a targeted spell enumerates once
 * per legal target. A card with one plays on click; a card with several opens
 * this. It keeps the model the whole surface rests on: there is nothing
 * half-assembled here, because every option in the picker came out of the
 * enumeration whole.
 *
 * Opening it takes the focus ring with it, to the first option. A menu that
 * opens behind the keyboard is a menu the keyboard cannot reach, and the card
 * that opened it is a `<button>` whose press already put the ring on the card
 * rather than on anything in the list. `selection.ts` hands the ring back to
 * that card when the menu closes.
 *
 * Escape closes it, by the same path the second click on the card takes, and
 * the key is caught on the table rather than on this element. A menu whose
 * dismissal only works while the ring is inside the menu stops working at the
 * first keystroke a person tries after opening it; `PlayView`'s own handler
 * carries the reason and the measurement.
 *
 * It is drawn at the bottom of the rail's column rather than over the table: a
 * menu asking which card you meant is no use drawn on top of that card, and it
 * opened there until `styles/board/picker.ts` moved it and wrote down the
 * measurement.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { choiceButton } from './choice-button';
import type { PlayChoice } from './prompt';

/** The accessible name of the picker holding one card's own moves. */
export function pickerLabel(cardName: string): string {
  return `Moves for ${cardName}`;
}

export function pickerPanel(
  cardName: string,
  choices: readonly PlayChoice[],
  onChoose: (index: number) => void,
): ReactElement {
  return createElement(
    'div',
    {
      className: 'mtg-picker',
      role: 'group',
      'aria-label': pickerLabel(cardName),
    },
    createElement('span', { className: 'mtg-picker__title' }, cardName),
    createElement(
      'div',
      { className: 'mtg-picker__list' },
      ...choices.map((choice, at) => choiceButton(choice, onChoose, at === 0)),
    ),
  );
}
