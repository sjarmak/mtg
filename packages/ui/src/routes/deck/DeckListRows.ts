/**
 * A deck as a decklist: one row per distinct card, quantity, name, mana cost.
 *
 * `mtg-umro`. The deck pane drew mana-value columns of overlapping strips at
 * both densities, which is the MTGO capture's answer and needs the capture's
 * width: `mtg-8osf` measured seven columns squeezed into 560px and moved the
 * whole workbench to a stacked arrangement to pay for them. the playtester, on the
 * stacked result, 2026-08-31: "the deck itself is pushed to the bottom where
 * cards are barely visible", and asked for the panes side by side with the deck
 * in a third of the width.
 *
 * Both cannot be true of columns, and only one of them has to be. A decklist is
 * what a narrow column is *for*: sixty cards in about twenty rows, quantities in
 * a line down the left edge, and the composition readable without moving the
 * eye sideways. So the deck pane's default density becomes this, the columns
 * stay as its card view, and the workbench gets its width back.
 *
 * # What a row is
 *
 * Quantity, name, cost. The type line is deliberately not on the row: the rows
 * are already grouped under a head that names the type, so printing `Creature —
 * Elf Druid` on every row under a head that says `Creature` spends the width
 * this list exists to save. What a group is comes from `./grouping.ts` and the
 * pane's own Group by control, so a reader who wants the curve instead of the
 * types gets the same rows under mana-value heads.
 *
 * # The gestures
 *
 * The same ones the strips carry (`./StripColumns.ts`), so a person who learned
 * the deck pane at one density has learned it at the other: a click selects the
 * row, a double click cuts a copy, a right click plays another. The `+`/`-`
 * pair is on the row as well, because a right click is not a keyboard move and
 * is not a touch move.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { isCastable } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { CONSTRUCTED_COPY_LIMIT } from '@mtg/deckbuild';
import { ManaPips } from '../../card/ManaPips';
import { groupHeadLabel, groupHeadText } from './grouping';
import type { Group } from './grouping';

export interface DeckListRowsProps {
  /** The deck's cards, already grouped and counted by `./grouping.ts`. */
  readonly groups: readonly Group<DslCard>[];
  /** How many copies of a card the deck plays. Never zero: a zero has no row. */
  readonly copiesOf: (card: DslCard) => number;
  /** The card id under the outline, or `undefined` when nothing is selected. */
  readonly selectedId?: string;
  readonly onSelect: (card: DslCard) => void;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  /** Names the list itself, apart from the pane's heading. */
  readonly label: string;
  /** What each control announces itself as. Both builders word these once. */
  readonly addLabel: (name: string) => string;
  readonly cutLabel: (name: string) => string;
  /**
   * Points at a row's card, for the floating preview (`./CardPreview.ts`).
   *
   * A decklist row is a name and a cost, which is less of a card than even a
   * compact face carries, so this is the pane where reading one in full matters
   * most. `null` on the way out.
   */
  readonly onPoint?: (card: DslCard | null, at: Pointed) => void;
}

/** Where the pointer is, in window coordinates. `./ConstructedBuilder.ts` owns it. */
export interface Pointed {
  readonly x: number;
  readonly y: number;
}

/** The workspace tsconfig has no `lib: dom`; these are the members read here. */
interface Boxed {
  readonly currentTarget: {
    readonly getBoundingClientRect: () => {
      readonly right: number;
      readonly top: number;
      readonly height: number;
    };
  };
}

interface PointerAt extends Boxed {
  readonly clientY: number;
}

/**
 * The row's own accessible name: the whole line, spoken as a line.
 *
 * The two step buttons inside it name themselves, and the row is a button too,
 * so without this it would announce as its three children read end to end --
 * "4 Arbor Elf Mana cost {G}", where the cost is a pip run whose accessible name
 * is a cost rather than a card's. One sentence instead.
 */
export function deckRowLabel(card: DslCard, copies: number): string {
  return `${String(copies)} ${card.name}`;
}

/** A row's own anchor: its right edge, halfway down. */
function edgeOf(element: Boxed['currentTarget']): Pointed {
  const box = element.getBoundingClientRect();
  return { x: box.right, y: box.top + box.height / 2 };
}

function row(props: {
  readonly card: DslCard;
  readonly copies: number;
  readonly selected: boolean;
  readonly onSelect: (card: DslCard) => void;
  readonly onAdd: (cardId: string) => void;
  readonly onCut: (cardId: string) => void;
  readonly addLabel: (name: string) => string;
  readonly cutLabel: (name: string) => string;
  readonly onPoint?: (card: DslCard | null, at: Pointed) => void;
}): ReactElement {
  const { card, copies } = props;
  const onPoint = props.onPoint;
  const step = (label: string, glyph: string, dark: boolean, act: () => void): ReactElement =>
    createElement(
      'button',
      {
        type: 'button',
        className: 'mtg-copies__step',
        'aria-label': label,
        disabled: dark,
        // The row is a button and these sit inside it; without this a press on
        // `+` would also select the row underneath, which is two moves for one
        // press and the second one is invisible.
        onClick: (event: { readonly stopPropagation: () => void }): void => {
          event.stopPropagation();
          act();
        },
      },
      glyph,
    );
  return createElement(
    'div',
    {
      key: card.id,
      className: 'mtg-decklines__row',
      'data-selected': props.selected ? 'true' : 'false',
      role: 'button',
      tabIndex: 0,
      'aria-label': deckRowLabel(card, copies),
      'aria-pressed': props.selected,
      onClick: (): void => {
        props.onSelect(card);
      },
      onDoubleClick: (): void => {
        props.onCut(card.id);
      },
      onContextMenu: (event: { readonly preventDefault: () => void }): void => {
        event.preventDefault();
        props.onAdd(card.id);
      },
      onKeyDown: (event: { readonly key: string; readonly preventDefault: () => void }): void => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onSelect(card);
      },
      ...(onPoint === undefined
        ? {}
        : {
            // The row's own right edge is the anchor, so the preview is drawn
            // off the list rather than over the rows above and below the one
            // being read. The pointer's y is kept because that is where the
            // reader is looking; a focus event carries none, so the row's own
            // middle stands in.
            onMouseEnter: (event: PointerAt): void => {
              onPoint(card, { x: edgeOf(event.currentTarget).x, y: event.clientY });
            },
            onMouseLeave: (): void => {
              onPoint(null, { x: 0, y: 0 });
            },
            onFocus: (event: Boxed): void => {
              onPoint(card, edgeOf(event.currentTarget));
            },
            onBlur: (): void => {
              onPoint(null, { x: 0, y: 0 });
            },
          }),
    },
    createElement('span', { className: 'mtg-decklines__qty', 'aria-hidden': true }, String(copies)),
    createElement('span', { className: 'mtg-decklines__name' }, card.name),
    isCastable(card)
      ? createElement(ManaPips, { cost: card.manaCost })
      : createElement('span', { className: 'mtg-decklines__nocost', 'aria-hidden': true }, '—'),
    createElement(
      'span',
      { className: 'mtg-decklines__steps' },
      step(props.cutLabel(card.name), '-', copies === 0, () => {
        props.onCut(card.id);
      }),
      step(props.addLabel(card.name), '+', copies >= CONSTRUCTED_COPY_LIMIT, () => {
        props.onAdd(card.id);
      }),
    ),
  );
}

export function DeckListRows(props: DeckListRowsProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-decklines', role: 'group', 'aria-label': props.label },
    ...props.groups.map((group) =>
      createElement(
        'div',
        { key: group.key, className: 'mtg-decklines__group' },
        createElement(
          'div',
          { className: 'mtg-decklines__head', 'aria-label': groupHeadLabel(group) },
          createElement(
            'span',
            { className: 'mtg-decklines__what', 'aria-hidden': true },
            groupHeadText(group),
          ),
          createElement(
            'span',
            { className: 'mtg-decklines__group-count', 'aria-hidden': true },
            String(group.cards),
          ),
        ),
        ...group.members.map((card) =>
          row({
            card,
            copies: props.copiesOf(card),
            selected: props.selectedId === card.id,
            onSelect: props.onSelect,
            onAdd: props.onAdd,
            onCut: props.onCut,
            addLabel: props.addLabel,
            cutLabel: props.cutLabel,
            ...(props.onPoint === undefined ? {} : { onPoint: props.onPoint }),
          }),
        ),
      ),
    ),
  );
}
