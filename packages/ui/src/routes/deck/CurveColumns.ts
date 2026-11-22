/**
 * A pane of whole cards, in one column per group, with the group's count over it.
 *
 * `mtg-rgc.21`. Three panes drew this: the Constructed builder's pool, the
 * sealed builder's pool, and the Decks tab's built artifact. Each had been a
 * wrapping run of faces at full density, each was already emitting its cards in
 * the grouping's order, and the playtester read all three on 2026-08-29 and could not
 * tell: "the cards should be sorted by mana cost even when they are in full
 * expanded view not only in compact view". A run that wraps has no column
 * boundaries and no counts, so the order it was in was not a thing the drawing
 * said. It says it now, and it says it once rather than in three places.
 *
 * Not `./StripColumns.ts`. That draws a *deck* -- one overlapping strip per copy
 * under a count, because the question there is how many of each and what shape
 * the list is. This draws a *collection*: every card whole, side by side, each
 * one carrying its own controls. The 2026-08-29 captures draw the two panes of
 * an editor differently on purpose and this is that difference, so the two
 * components stay two.
 *
 * The faces are the caller's, because what a face is differs by pane: a DSL card
 * with a `+`/`-` pair, a pool position that toggles, a real printing's tile.
 * What is shared is the group, its head and the count over it.
 *
 * How the groups are arranged is the pane's, through `flow`: side by side for a
 * pane laid out across a page, or stacked with the faces wrapping under each
 * head for a pane that is a column of the workbench. See `CurveFlow`.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { symbolizeLine } from '../../card/SymbolText';
import { groupHeadLabel, groupHeadText, groupHeadToken } from './grouping';
import type { Group } from './grouping';
import type { DeckViewMode } from './view-mode';

/**
 * Which way the groups are laid out, which is a fact about the pane's shape.
 *
 * `columns` is what this component was written as: one column per group, side by
 * side, the pane scrolling sideways past the ones that do not fit. It reads a
 * curve at a glance and it is what a pane laid out across a page can afford.
 *
 * `rows` is `mtg-xiso`. The Constructed collection moved into a column of the
 * workbench and the sideways scroll stopped being a fallback: measured at
 * 1600x1000, 900 cards in eight columns 26,769px deep, with the ninth column and
 * everything past it behind a horizontal scrollbar at the bottom of all of it.
 * The playtester asked for "a dense responsive grid of cards at a useful readable
 * size". So each group becomes a full-width row -- its head, then its faces
 * wrapping under it -- and the pane scrolls one way only. The order the groups
 * are in is still the grouping's, and it is still said out loud by the heads,
 * which is what `mtg-rgc.21` was about.
 */
export type CurveFlow = 'columns' | 'rows';

export interface CurveColumnsProps<T> {
  readonly groups: readonly Group<T>[];
  /** The pane's density, published so the sheet can size the faces in a column. */
  readonly view: DeckViewMode;
  readonly label: string;
  /** What goes in the column, under its head. One element per face. */
  readonly faces: (group: Group<T>) => readonly ReactNode[];
  /** How the groups are arranged. `columns` unless the pane says otherwise. */
  readonly flow?: CurveFlow;
}

/**
 * What goes in the head, drawn: a mana pip where the bucket is one symbol, the
 * bucket's own word where it is not.
 *
 * `mtg-84703`. Every head here was text -- `MV 3` over a mana-value column,
 * `White` over a color one -- and the color words are what the playtester asked to
 * get back: "no need to put White , Blue , Black etc text labels but just a
 * small indicator of the count for each color would be sufficient". The pip is
 * the indicator, `./StripColumns.ts` has drawn the mana one over the deck's
 * columns since 2026-08-29, and `./grouping.ts`'s `groupHeadToken` is the one
 * place that decides which buckets have one. The spoken head is unchanged: the
 * column carries `groupHeadLabel`'s sentence and the pip's own name never
 * reaches it.
 */
function headValue<T>(group: Group<T>): readonly ReactNode[] {
  const token = groupHeadToken(group);
  return token === null ? [groupHeadText(group)] : symbolizeLine(token);
}

export function CurveColumns<T>(props: CurveColumnsProps<T>): ReactElement {
  return createElement(
    'div',
    {
      className: 'mtg-builder-curve',
      role: 'group',
      'aria-label': props.label,
      'data-view': props.view,
      'data-flow': props.flow ?? 'columns',
    },
    ...props.groups.map((group) =>
      createElement(
        'div',
        {
          key: group.key,
          className: 'mtg-deck__column',
          role: 'group',
          // The group speaks its own head, which under mana value is the
          // sentence `groupHeadLabel` writes and under the other three axes
          // names the column in a word. See `./grouping.ts`.
          'aria-label': groupHeadLabel(group),
        },
        createElement(
          'span',
          { className: 'mtg-deck__column-head' },
          createElement('span', { className: 'mtg-deck__column-value' }, ...headValue(group)),
          createElement('span', { className: 'mtg-deck__column-count' }, String(group.cards)),
        ),
        ...props.faces(group),
      ),
    ),
  );
}
