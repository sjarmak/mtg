/**
 * The four controls the workbench form is built from, and the rule they share
 * with the set designer's: a refusal is drawn next to the field that earned it.
 *
 * # Why these are not `../../design/fields.ts`
 *
 * That module is the same idea and is not the same code, and the difference is
 * the half that matters. Its every field routes its refusal through
 * `../../design/refusals.ts`, which is a map from *brief* pointers to *brief*
 * sentences — "every set needs a code", "mechanic names must be unique". A deck
 * form has none of those pointers and none of those sentences, so sharing the
 * controls means parameterizing the vocabulary, which is the one part of them
 * that is not shared.
 *
 * So this is the second of the two, written for this form, and the note is here
 * rather than in a commit message: **a third form is where these get extracted**
 * — into `../../../panel/`, taking the sentence-chooser as an argument. Two is
 * under the rule of three; three is the point at which the parameterized version
 * is cheaper than a third copy.
 *
 * Functions returning elements rather than components, for the reason the design
 * route gives: a component per field would give each its own state, and the
 * draft is one value held by the screen. Every keystroke is handed up and the
 * whole draft comes back down.
 *
 * No JSX — the workspace tsconfig compiles `.ts` and sets no `jsx` — so this is
 * `createElement` throughout, like the rest of `packages/ui`.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Issue } from './client';

/** The refusals that belong to one field: its own, and anything inside it. */
export function issuesAt(issues: readonly Issue[], pointer: string): readonly Issue[] {
  return issues.filter((issue) => issue.pointer === pointer || issue.pointer.startsWith(`${pointer}/`));
}

function refused(issues: readonly Issue[], pointer: string): boolean {
  return issuesAt(issues, pointer).length > 0;
}

/**
 * Zod writes for a developer reading a stack trace. "Too small: expected string
 * to have >=1 characters" names no field, no unit and no consequence, and it is
 * what a person sees on a form nobody has typed into yet.
 *
 * So the machine phrasings are replaced and everything else is passed through
 * untouched, which is the rule the design route's own refusal module states:
 * nothing here decides *whether* a field is refused — the server did that — and
 * a sentence the server wrote for a human is already the right sentence.
 */
const MECHANICAL = /^(Too small|Too big|Invalid|Expected|Required|Unrecognized)/;

export function sayIssue(issue: Issue): string {
  return MECHANICAL.test(issue.message)
    ? `this is not a value this field takes (${issue.message})`
    : issue.message;
}

/** One field's refusals, drawn under it. Nothing at all when there are none. */
export function issueNote(issues: readonly Issue[], pointer: string): ReactElement | null {
  const mine = issuesAt(issues, pointer);
  if (mine.length === 0) return null;
  return createElement(
    'ul',
    { className: 'mtg-workbench__issues', 'data-pointer': pointer },
    mine.map((issue, index) =>
      createElement(
        'li',
        { key: `${issue.pointer}-${String(index)}`, className: 'mtg-workbench__issue' },
        sayIssue(issue),
      ),
    ),
  );
}

interface FieldShell {
  readonly id: string;
  readonly label: string;
  readonly pointer: string;
  readonly issues: readonly Issue[];
  /** Said under the field before anything is refused: what it is for. */
  readonly hint?: string;
}

function shell(props: FieldShell, control: ReactElement): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-workbench__field' },
    createElement('label', { className: 'mtg-fact__label', htmlFor: props.id }, props.label),
    control,
    props.hint === undefined ? null : createElement('p', { className: 'mtg-workbench__hint' }, props.hint),
    issueNote(props.issues, props.pointer),
  );
}

export interface TextFieldProps extends FieldShell {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Rows above one draw a textarea: a deck goal is a paragraph, an archetype is not. */
  readonly rows?: number;
  readonly placeholder?: string;
}

export function textField(props: TextFieldProps): ReactElement {
  const shared = {
    id: props.id,
    className: 'mtg-input',
    value: props.value,
    onChange: (event: { readonly target: { readonly value: string } }): void => {
      props.onChange(event.target.value);
    },
    'data-refused': refused(props.issues, props.pointer) ? 'true' : 'false',
    'data-pointer': props.pointer,
    ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
  };
  return shell(
    props,
    props.rows !== undefined && props.rows > 1
      ? createElement('textarea', { ...shared, rows: props.rows })
      : createElement('input', { ...shared, type: 'text' }),
  );
}

export interface NumberFieldProps extends FieldShell {
  /**
   * The empty string is a real value here and means "not stated".
   *
   * Every optional number on this form is a criterion the model decides when
   * nobody states it — the land count says so outright — so a blank box has to
   * survive being blank rather than snapping to a zero that would be a stated
   * ceiling of nothing.
   */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly min?: number;
  readonly max?: number;
}

export function numberField(props: NumberFieldProps): ReactElement {
  return shell(
    props,
    createElement('input', {
      id: props.id,
      type: 'number',
      className: 'mtg-input',
      value: props.value,
      inputMode: 'numeric',
      onChange: (event: { readonly target: { readonly value: string } }): void => {
        props.onChange(event.target.value);
      },
      'data-refused': refused(props.issues, props.pointer) ? 'true' : 'false',
      'data-pointer': props.pointer,
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.max === undefined ? {} : { max: props.max }),
    }),
  );
}

export interface ChipOption {
  readonly value: string;
  readonly label: string;
  /**
   * Drawn small beside the label: a set's card count, a color's painted pip.
   *
   * A node rather than a string, because the color chips' note is a mana symbol
   * and a mana symbol is drawn from the registry rather than written out as the
   * characters `{W}`.
   */
  readonly note?: ReactNode;
}

export interface ChipsFieldProps {
  readonly label: string;
  readonly pointer: string;
  readonly issues: readonly Issue[];
  readonly options: readonly ChipOption[];
  readonly selected: readonly string[];
  readonly onToggle: (value: string) => void;
  /** Drawn instead of an empty row: a row with no chips reads as a list of none. */
  readonly absent: string;
  readonly hint?: string;
}

/**
 * A row of chips rather than a multi-select, for the reason the design route
 * gives: the question is "which of these", which is a row of things to look at
 * and not a control to scroll.
 */
export function chipsField(props: ChipsFieldProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-workbench__field' },
    createElement('span', { className: 'mtg-fact__label' }, props.label),
    props.options.length === 0
      ? createElement('p', { className: 'mtg-workbench__hint' }, props.absent)
      : createElement(
          'div',
          { className: 'mtg-chips', role: 'group', 'aria-label': props.label },
          props.options.map((option) =>
            createElement(
              'button',
              {
                key: option.value,
                type: 'button',
                className: 'mtg-chip',
                'data-pointer': props.pointer,
                'data-selected': props.selected.includes(option.value) ? 'true' : 'false',
                'aria-pressed': props.selected.includes(option.value),
                onClick: (): void => {
                  props.onToggle(option.value);
                },
              },
              option.label,
              option.note === undefined
                ? null
                : createElement('span', { className: 'mtg-chip__note' }, option.note),
            ),
          ),
        ),
    props.hint === undefined ? null : createElement('p', { className: 'mtg-workbench__hint' }, props.hint),
    issueNote(props.issues, props.pointer),
  );
}

/** One entry toggled in or out of a list, without mutating it. */
export function toggled(list: readonly string[], value: string): readonly string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}
