/**
 * The curation grid: every card of the set, with every picture that exists of it.
 *
 * Presentational on purpose — it holds no state that outlives a tap and writes
 * nothing. Ranking is `ranking.ts` and persistence is the endpoint; what is
 * here is the arrangement a person taps at, so a test can drive the whole
 * gesture without a server and the page cannot record a pick the model did
 * not make. The one exception is the regeneration picker's open/closed panel
 * and its in-progress toggles: that is UI transiently held mid-gesture, the
 * same way a `<details>` element holds its own open state, and it commits
 * nothing until Save reasons is tapped.
 *
 * Four gestures, and no fifth:
 *
 * - **Tap a picture** to rank it. The number drawn on it is its position, and a
 *   second tap on a numbered picture drops it. `aria-pressed` carries the same
 *   fact the border does, and the accessible name says the position outright,
 *   because a blue outline is not a rank to somebody listening to the page.
 * - **Compare** opens the full raster. It is a separate control rather than a
 *   long press: a long press on a tablet is also the text-selection gesture and
 *   the browser's image menu, and a ranking page cannot afford to lose taps to
 *   either.
 * - **Ask for another** opens the cause picker, on every card, not just the 224
 *   of 253 with a single candidate. the playtester's first 21 flags included cards
 *   with two candidates already staged — a picker gated on "nothing to rank
 *   against" is a picker that cannot say what is wrong with a picture she
 *   already ranked, which is exactly the case that motivated asking for a
 *   cause at all.
 * - **The cause picker** is four toggles in plain words, a free-text note, and
 *   a Save reasons button, reached and operated by tap alone, because this page runs on a
 *   tablet from the couch and a keyboard is not always in reach. Confirming
 *   with nothing toggled still records the request (cause unstated is still a
 *   request), and a separate "Not wrong after all" clears the card's entry.
 *   Re-opening a flagged card's picker shows its recorded causes and note so
 *   they can be edited rather than retyped.
 */
import { createElement as h, Fragment, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { CurationCandidate, CurationCard, CurationIndex } from '../lab/curation-index';
import { MAX_NOTE_CHARS } from './client';
import type { Cause, RegenerationRow } from './client';
import { rankOf } from './ranking';
import type { CurationState } from './ranking';

/** The four causes, in the order the picker draws them, each with its plain-word label. */
const CAUSE_LABELS: ReadonlyMap<Cause, string> = new Map([
  ['outer-border', 'White border around the art'],
  ['mirrored-duplication', 'Pillarboxed, content mirrored into the bars'],
  ['seam-in-art', 'A seam drawn into the picture'],
  ['wrong-subject', 'Not the thing the card names'],
]);

/** What a confirmed picker gesture reports upward: a full replacement, or a clear. */
export type RegenerationEdit =
  | { readonly cardId: string; readonly requested: true; readonly causes: Cause[]; readonly note?: string }
  | { readonly cardId: string; readonly requested: false };

export interface CurateGridProps {
  readonly index: CurationIndex;
  readonly state: CurationState;
  /** Cards a regeneration has been asked for, keyed by id, with the recorded cause. */
  readonly requested: ReadonlyMap<string, RegenerationRow>;
  readonly onTap: (cardId: string, digest: string) => void;
  readonly onUndo: () => void;
  readonly onRegenerate: (edit: RegenerationEdit) => void;
  readonly onCompare: (candidate: CurationCandidate | null) => void;
  /** The raster being looked at closely, or `null` when the grid is plain. */
  readonly comparing: CurationCandidate | null;
  readonly canUndo: boolean;
  /** The last refusal from the endpoint, shown until the next successful write. */
  readonly problem: string | null;
}

/** What the rank badge and the accessible name both say about one picture. */
function pickLabel(card: CurationCard, candidate: CurationCandidate, rank: number | null): string {
  const where = rank === null ? 'unranked' : `preference ${String(rank)}`;
  return `${card.name}, ${candidate.alt} (${candidate.run}), ${where}`;
}

function candidateTile(
  card: CurationCard,
  candidate: CurationCandidate,
  props: CurateGridProps,
): ReactElement {
  const rank = rankOf(props.state, card.id, candidate.digest);
  return h(
    'div',
    { key: candidate.digest, className: 'curate__candidate' },
    h(
      'button',
      {
        type: 'button',
        className: 'curate__pick',
        'aria-pressed': rank !== null,
        'aria-label': pickLabel(card, candidate, rank),
        onClick: () => {
          props.onTap(card.id, candidate.digest);
        },
      },
      h('img', { src: candidate.thumb, alt: candidate.alt, loading: 'lazy' }),
    ),
    rank === null ? null : h('span', { className: 'curate__rank', 'aria-hidden': true }, String(rank)),
    h(
      'button',
      {
        type: 'button',
        className: 'curate__compare',
        onClick: () => {
          props.onCompare(candidate);
        },
      },
      'Compare',
    ),
  );
}

/** A cause toggle, sized for a thumb rather than a mouse pointer. */
function causeToggle(cause: Cause, checked: boolean, onToggle: (cause: Cause) => void): ReactElement {
  return h(
    'button',
    {
      key: cause,
      type: 'button',
      className: 'curate__cause',
      'aria-pressed': checked,
      onClick: () => {
        onToggle(cause);
      },
    },
    CAUSE_LABELS.get(cause) ?? cause,
  );
}

interface RegenerationPickerProps {
  readonly card: CurationCard;
  readonly recorded: RegenerationRow | undefined;
  readonly onRegenerate: (edit: RegenerationEdit) => void;
}

/**
 * The open/closed picker for one card. Its own component, rather than inline
 * in `cardBlock`, because opening it needs local state — which candidate's
 * panel is open, and the causes and note mid-edit before it is saved — and that
 * state has to reset to what is on disk each time the panel opens, not
 * whatever was left over from the last card this component happened to draw.
 */
function RegenerationPicker(props: RegenerationPickerProps): ReactElement {
  const { card, recorded } = props;
  const [open, setOpen] = useState(false);
  const [causes, setCauses] = useState<readonly Cause[]>(recorded?.causes ?? []);
  const [note, setNote] = useState(recorded?.note ?? '');

  const openPanel = (): void => {
    setCauses(recorded?.causes ?? []);
    setNote(recorded?.note ?? '');
    setOpen(true);
  };

  const toggleCause = (cause: Cause): void => {
    setCauses(causes.includes(cause) ? causes.filter((c) => c !== cause) : [...causes, cause]);
  };

  const confirm = (): void => {
    const trimmed = note.trim();
    props.onRegenerate({
      cardId: card.id,
      requested: true,
      causes: [...causes],
      ...(trimmed.length === 0 ? {} : { note: trimmed }),
    });
    setOpen(false);
  };

  const clear = (): void => {
    props.onRegenerate({ cardId: card.id, requested: false });
    setOpen(false);
  };

  if (!open) {
    return h(
      'button',
      {
        type: 'button',
        className: 'curate__button',
        'aria-pressed': recorded !== undefined,
        onClick: openPanel,
      },
      recorded === undefined ? 'Ask for another' : 'Flagged — edit',
    );
  }

  return h(
    'div',
    { className: 'curate__picker', role: 'group', 'aria-label': `Why is ${card.name} wrong?` },
    h(
      'div',
      { className: 'curate__causes' },
      ...Array.from(CAUSE_LABELS.keys()).map((cause) =>
        causeToggle(cause, causes.includes(cause), toggleCause),
      ),
    ),
    h(
      'label',
      { className: 'curate__note-label', htmlFor: `curate-note-${card.id}` },
      // The count is shown, and only near the ceiling, because the first
      // session pasted whole reference descriptions in here and a `maxLength`
      // of 500 clipped two of them mid-sentence without saying anything. A
      // browser enforcing a limit by discarding keystrokes is the one behavior
      // this field must not have: what gets discarded is the part of the note a
      // prompt would have been rewritten from.
      note.length > MAX_NOTE_CHARS - 400
        ? `Note (optional) — ${String(MAX_NOTE_CHARS - note.length)} characters left`
        : 'Note (optional)',
    ),
    h('textarea', {
      id: `curate-note-${card.id}`,
      className: 'curate__note',
      value: note,
      onChange: (event: { target: { value: string } }) => {
        setNote(event.target.value.slice(0, MAX_NOTE_CHARS));
      },
    }),
    h(
      'div',
      { className: 'curate__picker-actions' },
      h(
        'button',
        { type: 'button', className: 'curate__button curate__confirm', onClick: confirm },
        'Save reasons',
      ),
      recorded === undefined
        ? null
        : h(
            'button',
            { type: 'button', className: 'curate__button curate__clear', onClick: clear },
            'Not wrong after all',
          ),
      h(
        'button',
        {
          type: 'button',
          className: 'curate__button curate__cancel',
          onClick: () => {
            setOpen(false);
          },
        },
        'Cancel',
      ),
    ),
  );
}

function cardBlock(card: CurationCard, props: CurateGridProps): ReactElement {
  return h(
    'section',
    { key: card.id, className: 'curate__card', 'aria-label': card.name },
    h('h2', { className: 'curate__name' }, card.name),
    h(
      'div',
      { className: 'curate__candidates' },
      ...card.candidates.map((candidate) => candidateTile(card, candidate, props)),
    ),
    h(RegenerationPicker, {
      card,
      recorded: props.requested.get(card.id),
      onRegenerate: props.onRegenerate,
    }),
  );
}

/** The full raster, over everything, dismissed by the one control that opened it. */
function compareOverlay(props: CurateGridProps): ReactNode {
  const candidate = props.comparing;
  if (candidate === null) return null;
  return h(
    'div',
    { className: 'curate__full', role: 'dialog', 'aria-label': `Full illustration: ${candidate.alt}` },
    h('img', { src: candidate.full, alt: candidate.alt }),
    h(
      'button',
      {
        type: 'button',
        className: 'curate__button',
        onClick: () => {
          props.onCompare(null);
        },
      },
      'Close',
    ),
  );
}

export function CurateGrid(props: CurateGridProps): ReactElement {
  const { index } = props;
  return h(
    Fragment,
    null,
    h(
      'div',
      { className: 'curate__bar' },
      h('span', { className: 'curate__title' }, `${String(index.cards.length)} cards`),
      h(
        'button',
        {
          type: 'button',
          className: 'curate__button',
          disabled: !props.canUndo,
          onClick: props.onUndo,
        },
        'Undo',
      ),
    ),
    props.problem === null ? null : h('p', { className: 'curate__status', role: 'alert' }, props.problem),
    index.cards.length === 0
      ? h(
          'p',
          { className: 'curate__empty' },
          'No illustrations are staged. Run `npm run curate` to build the contact sheet.',
        )
      : h('div', { className: 'curate__cards' }, ...index.cards.map((card) => cardBlock(card, props))),
    compareOverlay(props),
  );
}
