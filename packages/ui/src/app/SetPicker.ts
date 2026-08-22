/**
 * The one control that says which set the whole lab is showing.
 *
 * It lives in the shell rather than on the Cards tab, and that placement is the
 * point rather than a layout preference: every tab reads the staged set. The
 * Draft tab deals packs from its collation, the Play tab deals a sealed pool
 * from its cards, the Deck tab resolves a decklist against them, and the board
 * paints them from its art manifest. A picker that only existed where the cards
 * are drawn would leave the Draft tab dealing the previous set's packs, which is
 * the same bug one indirection further along.
 *
 * # One set renders as a label
 *
 * A dropdown with one option is a control that does nothing, and a control that
 * does nothing reads as a control that is broken. One staged set is also the
 * ordinary state of this repository — a checkout that has never run
 * `reference:reduced` has exactly the flagship — so it gets a static label, and
 * only a real choice gets a `<select>`.
 *
 * Zero staged sets renders nothing at all. The tabs already have their own empty
 * states naming `npm run play`, and a picker over an empty list would be a
 * second, worse statement of the same thing.
 *
 * # Why a native `<select>`
 *
 * The list is short, flat, and has no state beyond which row is current, which
 * is the whole of what a `<select>` is for. A custom listbox would cost keyboard
 * handling, focus management and an `aria-activedescendant` contract to arrive
 * at what the platform already does, and it would do it in the one bar that has
 * a height budget on two routes.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { StagedSetRow } from '../lab/set-index';

export interface SetPickerProps {
  readonly sets: readonly StagedSetRow[];
  readonly selected: string;
  readonly onSelect: (stem: string) => void;
}

/** The accessible name of the control, named once so the tests cannot drift from it. */
export const SET_PICKER_LABEL = 'Set';

/**
 * What one row is called in the list.
 *
 * The name alone does not identify a build: `out/XMP/set.json` and the committed
 * fixture are both called the flagship set, and a picker that drew two
 * identical options would be a picker that hides one of them. So the row's card
 * count and the launcher's own phrase for where it came from ride along — the
 * two facts that actually differ between two builds of one set.
 */
export function setOptionLabel(row: StagedSetRow): string {
  return `${row.name} — ${String(row.cardCount)} cards, ${row.what}`;
}

export function SetPicker(props: SetPickerProps): ReactElement | null {
  const { sets, selected, onSelect } = props;
  const current = sets.find((row) => row.stem === selected) ?? sets[0];
  if (current === undefined) return null;
  if (sets.length === 1) {
    return createElement(
      'span',
      { className: 'mtg-setpick mtg-setpick--only', 'data-set': current.stem },
      createElement('span', { className: 'mtg-setpick__label' }, SET_PICKER_LABEL),
      createElement('span', { className: 'mtg-setpick__name' }, current.name),
    );
  }
  return createElement(
    'label',
    { className: 'mtg-setpick', 'data-set': current.stem },
    createElement('span', { className: 'mtg-setpick__label' }, SET_PICKER_LABEL),
    createElement(
      'select',
      {
        className: 'mtg-select mtg-setpick__select',
        value: current.stem,
        // Structurally typed, the way every other select on this page is: the
        // workspace tsconfig has no `lib: dom`, so `HTMLSelectElement` is not
        // nameable here.
        onChange: (event: { target: { value: string } }) => {
          onSelect(event.target.value);
        },
      },
      ...sets.map((row) => createElement('option', { key: row.stem, value: row.stem }, setOptionLabel(row))),
    ),
  );
}
