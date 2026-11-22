/**
 * Whether the brief is legal, and what the run will use where the form is blank.
 *
 * `mtg-yddw.2`. Two things a form cannot say for itself. The first is the
 * verdict: the schema lives on the server (`@mtg/design-data` reads its canon
 * off disk at import time, so no browser can hold it), and this panel is where
 * its answer arrives as a sentence rather than as red boxes alone. The second is
 * the *derived* numbers — a blank tertiary budget is defaulted from the set size,
 * and nothing on screen could otherwise tell a designer what number that is.
 *
 * A brief that is refused only in fields nobody has reached yet is *not* a
 * verdict this panel shouts. It opened saying "7 fields are refused, marked
 * above" over a form with nothing marked and nothing typed (`mtg-dcxg.3`), which
 * is both untrue — nothing was marked — and the wrong thing to say first. So the
 * count it reports is the count of refusals actually drawn beside a field, and
 * when that is none it says the brief is not finished rather than that it is
 * broken. What is still outstanding is counted beside the run button.
 *
 * With no server the panel says so and names the command. That is a state, not
 * an error: the form still edits, the JSON is still exact, and the file still
 * saves. What is missing is the judgment, and saying which command restores it
 * is more use than an error code.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { DESIGN_SERVER_COMMAND } from './client';
import type { ValidationAnswer } from './client';
import { panel } from './fields';

export const STATUS_TITLE = 'Is this brief legal?';

export const PENDING_NOTE = 'Asking the design server…';

export const VALID_NOTE = 'The generator accepts this brief.';

/** Said while the brief is unfinished but nothing has been refused on screen. */
export const UNFINISHED_NOTE =
  'Not yet: the brief is still incomplete. Each field is checked as you leave it, and what is outstanding is counted beside the run button.';

export function issueCountNote(count: number): string {
  return count === 1
    ? 'One field is refused. It is marked above.'
    : `${String(count)} fields are refused, marked above.`;
}

export function unreachableNote(reason: string): string {
  return `${reason}. The form still edits and the JSON below is exact; what is missing is the verdict. Start a server with ${DESIGN_SERVER_COMMAND}.`;
}

export interface StatusPanelProps {
  /** Null before the first answer, which is the one moment nothing can be said. */
  readonly answer: ValidationAnswer | null;
  readonly pending: boolean;
  /** How many refusals are drawn beside a field, which is what "marked above" means. */
  readonly shown: number;
}

function derivedRows(answer: ValidationAnswer): readonly ReactElement[] {
  if (answer.kind !== 'valid') return [];
  const { derived } = answer;
  const facts: readonly (readonly [string, number])[] = [
    ['Tertiary budget the run will use', derived.tertiaryBudget],
    ['Named cards', derived.requiredCards],
    ['Cards written by hand and carried through', derived.authoredCards],
    ['Mechanics', derived.mechanics],
  ];
  return facts.map(([label, value]) =>
    createElement(
      'div',
      { key: label, className: 'mtg-fact' },
      createElement('span', { className: 'mtg-fact__label' }, label),
      createElement('span', { className: 'mtg-fact__value' }, String(value)),
    ),
  );
}

export function StatusPanel(props: StatusPanelProps): ReactElement {
  const { answer, pending, shown } = props;
  if (answer === null) {
    return panel(STATUS_TITLE, null, createElement('p', { className: 'mtg-design__hint' }, PENDING_NOTE));
  }
  const unmarked = answer.kind === 'invalid' && shown === 0;
  const verdict =
    answer.kind === 'valid'
      ? VALID_NOTE
      : answer.kind === 'invalid'
        ? unmarked
          ? UNFINISHED_NOTE
          : issueCountNote(shown)
        : unreachableNote(answer.reason);
  return panel(
    STATUS_TITLE,
    null,
    createElement(
      'p',
      {
        className: 'mtg-design__verdict',
        'data-state': unmarked ? 'unfinished' : answer.kind,
        role: 'status',
      },
      pending ? `${verdict} ${PENDING_NOTE}` : verdict,
    ),
    ...derivedRows(answer),
  );
}
