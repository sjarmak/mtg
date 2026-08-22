/**
 * The one button that submits a choice.
 *
 * It has a module of its own because two surfaces draw it and they must not be
 * able to disagree. The rail lists every legal move and the picker lists one
 * card's own, and both are slices of the same enumeration carrying the same
 * index; a second button written beside one of them would be a second opinion
 * about what pressing it does. `prompt.ts` and `board/Graveyard.ts` name the
 * same failure — two functions that can disagree — and this is that rule applied
 * to the surface `mtg-bz2`'s lanes are about to grow a third and fourth caller
 * of.
 *
 * It takes two variations. Whether it opens holding the focus ring is a
 * picker's need and never the rail's. Whether it prints its whole label or only
 * the part that is its own is the rail's need and never the picker's: the rail
 * prints a run of same-act choices under one shared line (`rail.ts`), and a
 * button under that line repeats nothing above it.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { Action } from '@mtg/kernel';
import { askFitAttributes } from '../../styles/ask-fit';
import type { ChoiceText, PlayChoice } from './prompt';

/**
 * What a button draws when the words it shares with its neighbors are already
 * printed above it.
 *
 * `name` is the whole of what the button said before it was folded, and it goes
 * on `aria-label`, so **the accessible name does not move when the visible text
 * does**. A screen reader still hears the act, the source and the target in one
 * announcement, because a reader arrives at the button rather than reading down
 * the column, and a shared line it never reached explains nothing.
 *
 * A folded button draws no detail line, and that is not the detail going
 * missing: every member of a run carries the same detail — it is half of what
 * `rail.ts` cut the run on — so the run prints it once above them, beside the
 * act. Printing it again here would be the repetition the fold exists to remove.
 */
export interface FoldedLabel {
  /** The visible text: what this option has that its neighbors do not. */
  readonly text: string;
  /** The unfolded label and detail, which stays the accessible name. */
  readonly name: string;
}

/**
 * The whole of what a folded button used to say, which stays its name.
 *
 * Here rather than beside either caller, because it is the other half of
 * `FoldedLabel` above: `text` is what a button draws once the words it shares
 * are printed elsewhere, and this is the sentence that must survive on
 * `aria-label` whatever the visible text becomes. Two callers fold for different
 * reasons — `rail.ts` folds a run of moves onto a shared act, `declare-panel.ts`
 * folds one confirm whose enumerated label lists every creature in the
 * declaration — and a second spelling of "the whole sentence" is a second thing
 * a screen reader could be told.
 *
 * The two halves are two sentences and are punctuated as two (`mtg-0xq`). Both
 * shared spans above a run carry `aria-hidden`, so this string is the entire
 * screen-reader path through a folded rail, and joined with a bare space it ran
 * the target's last word into the detail's first: `Equip {1} → Player two's
 * Sandmark Gate Guard Scimitar of the Dunes · Equipped creature gets +3/+1.` reads
 * aloud as one name, and the board it was measured on offered twelve buttons
 * that differed only in that half. The visible rendering never had the problem,
 * because the detail is a block of its own above the run.
 *
 * A period rather than a dash or a middle dot: the join wants a sentence
 * boundary, which is the one thing every screen reader pauses on and the one
 * separator that is not already inside a detail (`prompt.ts` builds
 * `<source> · <grant>` with the dot). It is added only when the label does not
 * already end in its own punctuation — an ability's printed line ends in a
 * period whenever the fold did not slice a target off the end of it, and
 * `until end of turn.. Lab Warden` would be the doubled punctuation this
 * separator is otherwise worth.
 */
export function unfoldedName(choice: ChoiceText): string {
  if (choice.detail === null) return choice.label;
  const stop = /[.!?:;]$/.test(choice.label) ? '' : '.';
  return `${choice.label}${stop} ${choice.detail}`;
}

/**
 * Everything the button draws, with what pressing it does left to the caller.
 *
 * Extracted so the one press that submits something other than an index draws
 * the identical button. `declare-panel.ts`'s confirm can be a constructed
 * declaration past the 512-option cap (`declare.ts`), which has no index and so
 * no `PlayChoice`; going through this rather than writing a second button beside
 * it is the same rule the file header states.
 */
export interface SubmitButton {
  /** React's key, and the only thing here that is not drawn. */
  readonly key: string;
  readonly kind: Action['type'];
  readonly text: string;
  readonly detail: string | null;
  /** The whole sentence, put on `aria-label` when the visible text is folded. */
  readonly name: string | null;
  readonly takeFocus: boolean;
  readonly onSubmit: () => void;
}

/**
 * The span a choice's visible words go in, wherever they are drawn.
 *
 * Five call sites built this span by hand, and the ask column's fit ladder
 * (`../../styles/ask-fit.ts`) is published as attributes *on this element*, so
 * a sixth hand-built one would be a label that silently never shrinks. That is
 * the failure this module's own docblock is about, one element in: not two
 * buttons that disagree about what pressing them does, but two labels that
 * disagree about how narrow a column they can survive. The rail draws all five
 * — its move list through `submitButton`, and the declare roster, the blocker
 * order and the cast panel's answers directly — so all five are in the column
 * the ladder is measured against.
 */
export function choiceLabel(text: string): ReactElement {
  return createElement('span', { className: 'mtg-choice__label', ...askFitAttributes(text) }, text);
}

export function submitButton(input: SubmitButton): ReactElement {
  return createElement(
    'button',
    {
      key: input.key,
      type: 'button',
      className: 'mtg-choice',
      'data-kind': input.kind,
      ...(input.name === null ? {} : { 'aria-label': input.name }),
      // React focuses an `autoFocus` element when it mounts, which is the only
      // moment this is set: the rail never asks for it, and a picker's first
      // option mounts exactly when the picker opens.
      ...(input.takeFocus ? { autoFocus: true } : {}),
      onClick: input.onSubmit,
    },
    choiceLabel(input.text),
    input.detail === null ? null : createElement('span', { className: 'mtg-choice__detail' }, input.detail),
  );
}

export function choiceButton(
  choice: PlayChoice,
  onChoose: (index: number) => void,
  takeFocus = false,
  folded: FoldedLabel | null = null,
): ReactElement {
  return submitButton({
    key: String(choice.index),
    kind: choice.kind,
    text: folded === null ? choice.label : folded.text,
    // A folded button draws no detail line; `FoldedLabel` above says why.
    detail: folded === null ? choice.detail : null,
    name: folded === null ? null : folded.name,
    takeFocus,
    onSubmit: () => {
      onChoose(choice.index);
    },
  });
}
