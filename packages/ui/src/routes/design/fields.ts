/**
 * The controls every brief panel is built from, and the one rule they share:
 * a refusal is drawn next to the field that earned it.
 *
 * `mtg-yddw.2`. The server answers with issues keyed by pointer
 * (`mechanics.1.keywords`), which is the whole reason validation lives there and
 * is asked again on every edit — a list of refusals under a Save button is a
 * list a person has to map back onto a form by hand, and a twelve-field form
 * with three lists in it is where that stops working.
 *
 * These are functions returning elements rather than components. A component per
 * field would give each its own state, and the draft is one value held by the
 * route: every keystroke here is handed up, and what comes back down is the
 * whole draft. That is also what keeps the JSON box on screen exact rather than
 * nearly right.
 *
 * No JSX (the workspace tsconfig compiles `.ts` and sets no `jsx`), so this is
 * `createElement` throughout, like the rest of `packages/ui`.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { BriefIssue } from './client';
import { sayIssue } from './refusals';

/** The refusals that belong to one field: its own, and anything inside it. */
export function issuesAt(issues: readonly BriefIssue[], pointer: string): readonly BriefIssue[] {
  return issues.filter((issue) => issue.pointer === pointer || issue.pointer.startsWith(`${pointer}.`));
}

/** True when this field, or something under it, was refused. */
export function refused(issues: readonly BriefIssue[], pointer: string): boolean {
  return issuesAt(issues, pointer).length > 0;
}

/**
 * One field's refusals, drawn under it. Nothing at all when there are none.
 *
 * `value` is what the box holds, and it is here rather than in the caller
 * because blank and wrong are different refusals about the same field:
 * `./refusals.ts` needs it to tell "has not said yet" from "said something the
 * schema will not take".
 */
export function issueNote(
  issues: readonly BriefIssue[],
  pointer: string,
  value: string,
): ReactElement | null {
  const found = issuesAt(issues, pointer);
  if (found.length === 0) return null;
  return createElement(
    'p',
    { className: 'mtg-design__issue', role: 'status' },
    found.map((issue) => sayIssue(issue, value)).join(' '),
  );
}

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly issues: readonly BriefIssue[];
  readonly pointer: string;
  /** Rows above one draw a textarea: the theme is a paragraph, a set code is not. */
  readonly rows?: number;
  readonly placeholder?: string;
  /** Said under the field before anything is refused: what it is for. */
  readonly hint?: string;
}

/** A labeled box, its hint, and its refusals. */
export function textField(props: TextFieldProps): ReactElement {
  const { id, label, value, onChange, issues, pointer, rows, placeholder, hint } = props;
  const change = (event: { readonly target: { readonly value: string } }): void => {
    onChange(event.target.value);
  };
  const shared = {
    id,
    className: 'mtg-input',
    value,
    onChange: change,
    'data-refused': refused(issues, pointer) ? 'true' : 'false',
    'data-pointer': pointer,
    ...(placeholder === undefined ? {} : { placeholder }),
  };
  return createElement(
    'div',
    { className: 'mtg-design__field' },
    createElement('label', { className: 'mtg-fact__label', htmlFor: id }, label),
    rows !== undefined && rows > 1
      ? createElement('textarea', { ...shared, rows })
      : createElement('input', { ...shared, type: 'text' }),
    hint === undefined ? null : createElement('p', { className: 'mtg-design__hint' }, hint),
    issueNote(issues, pointer, value),
  );
}

export interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
  readonly issues: readonly BriefIssue[];
  readonly pointer: string;
  /**
   * What the unset entry says.
   *
   * Every narrowing field on a required card means "any" when it is blank, and
   * an entry reading "Any" alone reads as a value rather than as an absence. So
   * each caller names its own: "Any color", "Any rarity".
   */
  readonly anyLabel?: string;
  /**
   * Drawn but not answerable, because another field has not been answered yet.
   *
   * A seat ceiling is a ceiling *under* a stated rarity, so with no rarity above
   * it there is no list to offer. Hiding the field would leave a designer to
   * discover the option exists by reading the schema; offering it empty would
   * read as a narrowing this brief cannot make at all.
   */
  readonly disabled?: boolean;
  /** Said under the field before anything is refused: what it is for. */
  readonly hint?: string;
}

/** A closed list, offered as it came off the server rather than as a local copy. */
export function selectField(props: SelectFieldProps): ReactElement {
  const { id, label, value, options, onChange, issues, pointer, anyLabel, disabled, hint } = props;
  return createElement(
    'div',
    { className: 'mtg-design__field' },
    createElement('label', { className: 'mtg-fact__label', htmlFor: id }, label),
    createElement(
      'select',
      {
        id,
        className: 'mtg-select',
        value,
        ...(disabled === true ? { disabled: true } : {}),
        'data-refused': refused(issues, pointer) ? 'true' : 'false',
        'data-pointer': pointer,
        onChange: (event: { readonly target: { readonly value: string } }): void => {
          onChange(event.target.value);
        },
      },
      anyLabel === undefined ? null : createElement('option', { key: '', value: '' }, anyLabel),
      options.map((option) => createElement('option', { key: option, value: option }, option)),
    ),
    hint === undefined ? null : createElement('p', { className: 'mtg-design__hint' }, hint),
    issueNote(issues, pointer, value),
  );
}

export interface ChipsFieldProps {
  readonly label: string;
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly onToggle: (option: string) => void;
  readonly issues: readonly BriefIssue[];
  readonly pointer: string;
  /** Drawn in place of the chips when the vocabulary has not arrived. */
  readonly absent: string;
}

/**
 * A multiple choice over a closed list.
 *
 * Chips rather than a multi-select box: a keyword list is forty entries and the
 * question a designer is answering is "which of these", which is a row of things
 * to look at, not a control to scroll. When the vocabulary is missing the field
 * says so instead of drawing an empty row, because a row with no chips reads as
 * a list with nothing in it rather than a list that never arrived.
 */
export function chipsField(props: ChipsFieldProps): ReactElement {
  const { label, options, selected, onToggle, issues, pointer, absent } = props;
  return createElement(
    'div',
    { className: 'mtg-design__field' },
    createElement('span', { className: 'mtg-fact__label' }, label),
    options.length === 0
      ? createElement('p', { className: 'mtg-design__hint' }, absent)
      : createElement(
          'div',
          { className: 'mtg-chips', role: 'group', 'aria-label': label },
          options.map((option) =>
            createElement(
              'button',
              {
                key: option,
                type: 'button',
                className: 'mtg-chip',
                'data-pointer': pointer,
                'data-selected': selected.includes(option) ? 'true' : 'false',
                'aria-pressed': selected.includes(option),
                onClick: (): void => {
                  onToggle(option);
                },
              },
              option,
            ),
          ),
        ),
    issueNote(issues, pointer, selected.length === 0 ? '' : selected.join(' ')),
  );
}

/** One toggle, for the two flags a required card carries. */
export function checkField(
  id: string,
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): ReactElement {
  return createElement(
    'label',
    { className: 'mtg-field', htmlFor: id },
    createElement('input', {
      id,
      type: 'checkbox',
      checked,
      onChange: (event: { readonly target: { readonly checked: boolean } }): void => {
        onChange(event.target.checked);
      },
    }),
    createElement('span', { className: 'mtg-field__label' }, label),
  );
}

/** A panel with a heading, so every section of the editor is drawn the same. */
export function panel(
  title: string,
  subtitle: string | null,
  ...children: readonly ReactNode[]
): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, title),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      subtitle === null ? null : createElement('p', { className: 'mtg-prompt__explain' }, subtitle),
      ...children,
    ),
  );
}

/** One entry replaced, and one removed, without mutating the list either time. */
export function replacedAt<T>(list: readonly T[], index: number, value: T): readonly T[] {
  return list.map((entry, at) => (at === index ? value : entry));
}

export function removedAt<T>(list: readonly T[], index: number): readonly T[] {
  return list.filter((_, at) => at !== index);
}

/** A member added or taken out of a chip selection, kept in the offered order. */
export function toggled(
  selected: readonly string[],
  option: string,
  options: readonly string[],
): readonly string[] {
  const next = selected.includes(option)
    ? selected.filter((entry) => entry !== option)
    : [...selected, option];
  return options.filter((entry) => next.includes(entry));
}
