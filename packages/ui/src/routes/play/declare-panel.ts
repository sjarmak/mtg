/**
 * The staged combat declaration, drawn in the rail where the flat move list was.
 *
 * `declare.ts` holds the model and the argument; this is the inside of the box.
 * Three things sit in it, in this order, and the order is load-bearing:
 *
 *  1. **The confirm, first.** It is the only control here that submits anything,
 *     it carries the index of the enumerated declaration the assignment names,
 *     and it is `choice-button.ts`'s button wearing the enumeration's own label —
 *     so the accessible name of the move a player commits to is the same string
 *     the flat rail printed on it. First rather than last for two reasons that
 *     agree: the empty declaration is both the commonest answer at a blocker
 *     prompt and the one the flat rail listed first, and a driver that presses
 *     the first button in the rail (`test/play/play.test.ts` is one, and so is a
 *     keyboard player tabbing in) must not land on a toggle it can press forever.
 *  2. **The roster**, one row per creature, saying what that creature is doing.
 *     Its own labeled group, because the rows are not legal moves — they build
 *     one — and a screen reader that announced them inside `LEGAL_MOVES_LABEL`
 *     with nothing between would be calling eight creatures eight moves.
 *  3. **Clear**, when anything is assigned. `cast-panel.ts`'s Cancel one route
 *     over, and the same thing is true of it: nothing here has reached the
 *     kernel, so there is nothing to take back and no commit boundary to check.
 *
 * The question stage replaces the roster rather than opening beside it, because
 * the rail is a 148px column and a menu drawn over a list in it would cover the
 * thing it is asking about.
 *
 * **When the assignment names no enumerated declaration the confirm is absent
 * and the panel says why.** That is a real position rather than a guard: one
 * blocker on a creature with menace (CR 702.110b) is an illegal declaration the
 * player is halfway through building, and the honest surface refuses the commit
 * while leaving every creature still pressable.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Choice, ObjectId } from '@mtg/kernel';
import { choiceLabel, submitButton } from './choice-button';
import { declarationWords } from './declare';
import type { Assignment, DeclarationPlan, DeclarationStage, DeclarationSubject } from './declare';

/** The accessible name of the group holding the creatures being declared. */
function rosterLabel(plan: DeclarationPlan): string {
  return declarationWords(plan.kind).roster;
}

/** The control that drops every assignment without touching the kernel. */
export const DECLARE_CLEAR_LABEL = 'Clear the assignment';

/** The control that leaves a creature's question without answering it. */
export const DECLARE_BACK_LABEL = 'Back to the creatures';

/** What one row says it is doing, which is also the row's accessible name. */
function subjectStatus(plan: DeclarationPlan, subject: DeclarationSubject, assignment: Assignment): string {
  const words = declarationWords(plan.kind);
  const held = assignment.get(subject.oid);
  if (held === undefined) return words.idle;
  const against = subject.candidates.find((candidate) => candidate.key === held);
  return words.busy(against?.label ?? held);
}

/**
 * What the confirm submits and what it announces.
 *
 * `choice` is an index into the pending enumeration where the assignment names
 * an enumerated declaration and the declaration itself where it does not — the
 * second happens past the 512-option cap, and `declare.ts` carries why. `name`
 * is the whole sentence either way, because the button is folded and the
 * accessible name must not move when the visible text does.
 */
export interface DeclarationConfirm {
  readonly choice: Choice;
  readonly name: string;
}

export interface DeclarePanelInput {
  readonly plan: DeclarationPlan;
  readonly stage: DeclarationStage;
  readonly assignment: Assignment;
  /** What confirming submits, or null when the rules refuse this assignment. */
  readonly confirm: DeclarationConfirm | null;
  /** The row that takes the ring as the roster mounts, or null (`selection.ts`). */
  readonly focus: ObjectId | null;
  /**
   * Whether the first answer takes the ring when a question opens.
   *
   * False for a question a press on the *card* opened (`mtg-bz2.5`'s board
   * half): the ring is on the card the player just pressed, and this panel is a
   * column away from it. `selection.ts` states the rule and owns the flag.
   */
  readonly answerFocus: boolean;
  /** Presses a creature's row: toggles it, or opens its question. */
  readonly onPress: (subject: DeclarationSubject) => void;
  /** Answers an open question; `null` declines. */
  readonly onPick: (oid: ObjectId, key: string | null) => void;
  /** Leaves an open question unanswered. */
  readonly onBack: () => void;
  /** Drops every assignment. */
  readonly onClear: () => void;
  /** Submits the finished declaration. */
  readonly onSubmit: (choice: Choice) => void;
}

function rosterRow(
  plan: DeclarationPlan,
  subject: DeclarationSubject,
  assignment: Assignment,
  onPress: (subject: DeclarationSubject) => void,
  takeFocus: boolean,
): ReactElement {
  const status = subjectStatus(plan, subject, assignment);
  const declared = assignment.has(subject.oid);
  return createElement(
    'button',
    {
      key: subject.oid,
      type: 'button',
      className: 'mtg-choice mtg-declare__row',
      'data-declared': declared ? 'true' : 'false',
      // The ring coming back from a question this row opened; `selection.ts`
      // argues why it is handed forward rather than restored. React focuses an
      // `autoFocus` element when it mounts, and the roster mounts exactly when
      // the question closes.
      ...(takeFocus ? { autoFocus: true } : {}),
      // The whole row in one announcement. The visible text is two lines and a
      // reader arriving at the button hears them as one sentence either way;
      // stating it keeps the comma, which is the difference between a name
      // followed by a state and a name that has been given a strange surname.
      'aria-label': `${subject.name}, ${status}`,
      // `rosterPress` decides what the press means; the row only reports it, so
      // the rule that a single-candidate creature toggles lives in one place.
      onClick: () => {
        onPress(subject);
      },
    },
    choiceLabel(subject.name),
    createElement('span', { className: 'mtg-choice__detail' }, status),
  );
}

function rosterBody(input: DeclarePanelInput): ReactNode {
  const { plan, assignment, confirm, focus, onPress, onClear, onSubmit } = input;
  return createElement(
    Fragment,
    null,
    confirm === null
      ? createElement(
          'p',
          { className: 'mtg-declare__note', role: 'note' },
          'The rules do not allow this assignment yet, so there is nothing to confirm.',
        )
      : // Folded, so the button that is always on screen stays two lines
        // whatever the declaration lists. `declare.ts` carries the measurement.
        submitButton({
          key: 'declare-confirm',
          kind: plan.kind,
          text: declarationWords(plan.kind).confirm(assignment.size),
          detail: null,
          name: confirm.name,
          takeFocus: false,
          onSubmit: () => {
            onSubmit(confirm.choice);
          },
        }),
    createElement(
      'div',
      { className: 'mtg-declare__roster', role: 'group', 'aria-label': rosterLabel(plan) },
      ...plan.subjects.map((subject) => rosterRow(plan, subject, assignment, onPress, subject.oid === focus)),
    ),
    assignment.size === 0
      ? null
      : createElement(
          'button',
          { type: 'button', className: 'mtg-btn mtg-declare__clear', onClick: onClear },
          DECLARE_CLEAR_LABEL,
        ),
  );
}

function questionBody(input: DeclarePanelInput, subject: DeclarationSubject): ReactNode {
  const { plan, assignment, answerFocus, onPick, onBack } = input;
  const words = declarationWords(plan.kind);
  const held = assignment.get(subject.oid);
  return createElement(
    Fragment,
    null,
    createElement('p', { className: 'mtg-declare__ask' }, words.ask(subject.name)),
    createElement(
      'div',
      { className: 'mtg-declare__answers', role: 'group', 'aria-label': words.ask(subject.name) },
      ...subject.candidates.map((candidate, at) =>
        createElement(
          'button',
          {
            key: candidate.key,
            type: 'button',
            className: 'mtg-choice mtg-declare__answer',
            'data-declared': held === candidate.key ? 'true' : 'false',
            // The first answer takes the ring for `cast-panel.ts`'s reason: a
            // panel that opens behind the keyboard is a panel the keyboard has
            // to go looking for. Not when the card itself opened the question,
            // where the ring is already where the player is looking.
            ...(at === 0 && answerFocus ? { autoFocus: true } : {}),
            onClick: () => {
              onPick(subject.oid, candidate.key);
            },
          },
          choiceLabel(candidate.label),
        ),
      ),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-choice mtg-declare__answer',
          'data-declared': held === undefined ? 'true' : 'false',
          onClick: () => {
            onPick(subject.oid, null);
          },
        },
        choiceLabel(words.decline),
      ),
    ),
    createElement(
      'button',
      { type: 'button', className: 'mtg-btn mtg-declare__back', onClick: onBack },
      DECLARE_BACK_LABEL,
    ),
  );
}

export function declarePanel(input: DeclarePanelInput): ReactElement {
  const { stage } = input;
  return createElement(
    'div',
    { key: 'declare', className: 'mtg-declare' },
    stage.kind === 'roster' ? rosterBody(input) : questionBody(input, stage.subject),
  );
}
