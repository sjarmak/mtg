/**
 * The one control that says which set the browsing tabs are showing.
 *
 * It lives in the shell rather than on the Cards tab, and that placement is the
 * point rather than a layout preference: Cards, Customize and Analysis all read
 * one staged set, and a picker that only existed where the cards are drawn
 * would leave the other two on the set somebody just switched away from.
 *
 * It does not reach Play (`mtg-a982g.5`). Which set a game is dealt from is the
 * section's question and each section answers it differently -- Draft offers
 * the cube, Sealed does not, Commander offers neither and lists printed decks
 * -- so the choice is drawn in the section, out of what that section can
 * actually deal (`../routes/play/sources.ts`).
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
 *
 * It is also why the *Custom* and *Magic* grouping costs nothing here
 * (`mtg-tewc.2`): `<optgroup>` is the platform's answer to the same question
 * `../lab/set-origin.ts` asks, it adds no height to the closed control, and on a
 * phone it is the system's own sheet drawing the headings.
 *
 * It is also the only surface that chooses a set. There was a Sets page beside
 * it with the same list drawn as rows, and the playtester cut it: a page you navigate
 * to in order to change what every other page is showing is a worse control than
 * a control that is on every other page.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { setDisplayName } from '../lab/set-label';
import { groupSetsByOrigin, setKindLabel } from '../lab/set-origin';
import type { StagedSetRow } from '../lab/set-index';

/** Picker facts are independent of whether a source is executable or printed. */
export type SetPickerRow = Pick<StagedSetRow, 'stem' | 'name' | 'origin'> & {
  readonly cardCount?: number;
};

export interface SetPickerProps {
  readonly sets: readonly SetPickerRow[];
  readonly selected: string;
  readonly onSelect: (stem: string) => void;
}

/** The accessible name of the control, named once so the tests cannot drift from it. */
export const SET_PICKER_LABEL = 'Set';

/**
 * What one row is called in the list.
 *
 * A native `<select>` draws the selected option's own text when it is closed, so
 * the option label *is* the closed state, and the playtester's instruction is about
 * the closed state: "the set selector should display only the human-readable set
 * name". It used to read `the flagship set — 371 cards, the committed fixture`
 * and that made the widest thing in the header a sentence about a build
 * directory.
 *
 * The disambiguation it was carrying is real and stays, narrowed to the case
 * that needs it: `out/XMP/set.json` and the committed fixture are both called
 * the flagship set, and a picker drawing two identical options is a picker
 * hiding one of them. So the card count is appended only when another staged set
 * shares this one's display name — the fact that actually differs between two
 * builds of one set, and the one a person can act on. The launcher's phrase for
 * where the build came from is not drawn at all.
 */
export function setOptionLabel(row: SetPickerRow, sets: readonly SetPickerRow[]): string {
  const name = setDisplayName(row);
  const shared = sets.some((other) => other.stem !== row.stem && setDisplayName(other) === name);
  if (!shared) return name;
  return row.cardCount === undefined
    ? `${name} — ${setKindLabel(row.origin)}`
    : `${name} — ${String(row.cardCount)} cards`;
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
      createElement('span', { className: 'mtg-setpick__name' }, setDisplayName(current)),
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
      ...groupSetsByOrigin(sets).map((group) =>
        createElement(
          'optgroup',
          { key: group.origin, label: group.label },
          ...group.rows.map((row) =>
            createElement('option', { key: row.stem, value: row.stem }, setOptionLabel(row, sets)),
          ),
        ),
      ),
    ),
  );
}
