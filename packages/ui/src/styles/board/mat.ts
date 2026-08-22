/**
 * The mat itself: the printed table every other block cuts a well into.
 *
 * The composition is direction B, `docs/mockups/direction-b-playmat.html`: the
 * table is one printed mat and the zones are wells cut into it, rather than five
 * bordered boxes floating on the page. The mat's four surfaces and its shadow
 * are the only tokens this sheet adds, and `../tokens.ts` records why they are
 * declared outside `TOKEN_CSS`.
 *
 * The three grid columns are the whole layout: the pods are a fixed column, the
 * lanes take what is left and the rail is a fixed width, which is what puts
 * every variable-length thing on the width axis. `./fit.ts` re-values all three
 * under a height budget on the play route and `./rail.ts` says what may sit in
 * the third column.
 *
 * The two-column fallback at the foot of this sheet is the board drawn *outside*
 * a height budget — the rail wraps to a second implicit row and the page grows.
 * A fitted table cannot take that answer, and for a while it took no answer at
 * all: `./fit.ts`'s `TABLE .mtg-board` out-specifies this bare selector, media
 * queries add no specificity, and so a played table below the breakpoint kept
 * all three tracks. `./geometry.ts`'s `THREE_COLUMN_MIN_WIDTH_PX` carries that
 * reading and says where the fitted routes answer it instead.
 *
 * **The pod column is `mtg-rgc.1`, and it is a reclaim rather than a move.** The
 * two players' vitals used to be a horizontal strip at the top of each lane, so
 * the table spent a row of its scarce axis on each seat and neither strip used
 * more than a third of the width it was given. In a column of their own the
 * opponent's pod sits at the top and yours at the bottom — Magic Online's
 * arrangement, and the reason it is worth copying is that both seats' vitals are
 * then one vertical scan that never crosses the board. `justify-content:
 * space-between` is what puts them at the two ends; on a page with no height
 * budget the column is only as tall as its content and the two simply stack.
 *
 * **And the span between the two pods is where the ask goes** (`mtg-rgc.4`).
 * That column left a tall empty middle, which is exactly where Magic Online
 * draws its prompt box, so `../../board/Board.ts`'s `prompt` slot renders
 * between the two pods and the played table fills it with the move list. The
 * column is stretch-aligned so a block in it takes the track's width rather than
 * its own; `./rail.ts` argues both rails' widths together and states what the
 * ask may do with the span, because how much of the mat the two columns take
 * between them is one decision and not two.
 *
 * A board that passes no prompt — the replay frame does not — draws the two pods
 * at the ends of an empty column, exactly as it did before.
 *
 * **A seat is a column of two zones, and the near seat is a column of three**
 * (`mtg-rgc.6`). The step bar goes between the battlefield and the hand, which is
 * where Magic Online draws it and which is inside the near band rather than
 * beside it, because the hand is inside the near band too. `.mtg-board__side` is
 * a flex column and needed no rule for it: the bar stretches to the lane's width
 * and `../views.ts` holds it at the height of its own content. `./fit.ts` takes
 * the extra gap back on the play route, where a gap is a card.
 */
import { cssNumber } from '../number';
import { NARROW_TABLE_QUERY } from './geometry';
import { POD_WIDTH_REM } from './status';

export const MAT_CSS = `
.mtg-board {
  display: grid;
  grid-template-columns: ${cssNumber(POD_WIDTH_REM)}rem minmax(0, 1fr) 16rem;
  gap: var(--mtg-space-4); align-items: start;
  padding: var(--mtg-space-3);
  background-color: var(--mtg-mat);
  background-image:
    repeating-linear-gradient(45deg, var(--mtg-mat-weave) 0 1px, transparent 1px 5px),
    repeating-linear-gradient(-45deg, var(--mtg-mat-weave) 0 1px, transparent 1px 5px);
  border: 1px solid var(--mtg-mat-edge);
  border-radius: var(--mtg-radius-lg);
  box-shadow: var(--mtg-shadow-table);
}
.mtg-board__pods {
  display: flex; flex-direction: column; justify-content: space-between;
  align-items: stretch; min-width: 0;
  gap: var(--mtg-space-3);
}
.mtg-board__lanes { display: flex; flex-direction: column; gap: var(--mtg-space-3); min-width: 0; }
.mtg-board__side { display: flex; flex-direction: column; gap: var(--mtg-space-2); }
.mtg-board__divider { height: 1px; background: var(--mtg-mat-edge); margin: var(--mtg-space-1) 0; }
.mtg-board__rail { display: flex; flex-direction: column; gap: var(--mtg-space-3); }
@media ${NARROW_TABLE_QUERY} {
  .mtg-board { grid-template-columns: ${cssNumber(POD_WIDTH_REM)}rem minmax(0, 1fr); }
}
`;
