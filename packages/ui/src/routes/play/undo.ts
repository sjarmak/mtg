/**
 * The take-back, as a control.
 *
 * `mtg-bz2.13` landed the whole mechanism and none of the surface:
 * `@mtg/kernel`'s `undo.ts` decides the boundary set, `session.ts` rewinds or
 * refuses, and `./use-session.ts` puts `undo()`, `canUndo` and the refusal on the
 * handle. Nothing drew a button, so the feature was reachable only from a test.
 *
 * **It is pressable while `canUndo` is false, and that is the point rather than
 * an oversight.** The kernel answers a refused undo with a sentence saying why -
 * nothing to take back, or the last commit boundary is behind a shuffle - and
 * `./use-session.ts` puts that sentence on the error line, which `./LiveGame.ts`
 * draws as an alert. A control that guarded itself on `canUndo` would replace
 * that sentence with a press that does nothing, which is the silence the
 * refusal was written for. So availability is drawn (`data-available`) and never
 * enforced, and neither `disabled` nor `aria-disabled` is set: both are claims
 * that the press does nothing, and the press is what produces the answer.
 *
 * **In the priority foot, beside the pass**, rather than beside the odometer it
 * undoes. `./toolbar.ts`'s `.mtg-play-meta` is the odometer's own row and is the
 * better sentence - the count of decisions since the last boundary, and the way
 * to give them back - but `styles/mobile.ts` draws that row `display: none` on a
 * landscape phone and `styles/board/rail.ts` does the same in the shut ask
 * column, both deliberately, so the take-back would be missing on exactly the
 * screens where a misplaced tap is likeliest. The foot survives both: it is
 * where `./pass.ts` sits for the same reason.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

/** The accessible name, read by the surface and by every test that finds it. */
export const UNDO_LABEL = 'Take back';

export interface UndoProps {
  /**
   * Whether the kernel would move on a press. For drawing the control, never for
   * guarding it; `./use-session.ts` says the same thing about its own `canUndo`.
   */
  readonly canUndo: boolean;
  readonly onUndo: () => void;
}

export function undoButton(props: UndoProps): ReactElement {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-undo',
      'data-available': props.canUndo ? 'true' : 'false',
      onClick: props.onUndo,
    },
    UNDO_LABEL,
  );
}
