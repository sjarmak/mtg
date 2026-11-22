/**
 * The pass, in a place that does not move.
 *
 * The playtester, 2026-08-13, after playing the lab: "the 'pass' button should
 * always be in the same spot maybe in the upper right area of your hand or
 * something". It was one option among the enumerated ones, so it sat wherever
 * the `Turn` group happened to fall as the list grew and shrank, and it is the
 * move most priorities of most turns end in.
 *
 * It is not a shortcut around the enumeration and there is deliberately no path
 * here that builds an `Action`. `at` is `passIndex`'s answer over the pending
 * decision, which is the same index the rail's own entry carries and the same
 * one the space key takes, and `null` means the kernel enumerated no pass in
 * this decision — a mulligan, a blocker assignment, an ordering, a discard.
 *
 * Null draws the button disabled rather than dropping it, which is the whole
 * point: a control whose promise is that it stays put cannot leave the screen
 * when the answer is no. Disabled it is out of the tab order and says why by
 * being drawn as unavailable, the same bargain an unplayable hand card takes.
 *
 * `mtg-bz2.4` made it prominent without editing it: the button is unchanged and
 * now sits inside `priority.ts`'s bar, which says who holds priority in the row
 * this button already owned. That is the shape any further addition should take
 * — `mtg-bz2.7`'s yield options are the next one — because the two rules here
 * are absolute. Nothing may make it move, and nothing may give it a path that
 * does not run through an index the kernel handed out.
 *
 * # The second gesture
 *
 * `mtg-nxh` is `mtg-bz2.14`'s last unreached row: *hold or menu on Pass opens
 * yield options*. Yield was reachable only through the turn badge's disclosure
 * in the toolbar — a different control, in a different place, at the other end
 * of the screen from the button a player is already holding.
 *
 * The options are `./yields.ts`'s, which is the list the badge draws, so the two
 * openings offer the same two boundaries and call the same `onYield`. That is
 * the whole of the answer to the question the bead left open: opening a yield
 * from the pass rather than from the badge changes where the player is, not what
 * a yield is.
 *
 * Both gestures, for both input models. A long press is `../../card/press.ts`'s
 * recognizer, which arms for touch and pen only and leaves a mouse the model it
 * has; the mouse's opening is the context menu, which is the same gesture that
 * opens a card's own menu one column over. Neither one passes: a press that
 * opened the menu claims the click that would follow it, exactly as it does on a
 * card face, because a hold that both yielded and passed would spend a priority
 * the player was still deciding about.
 *
 * The panel is drawn under the button rather than over the board, and it is a
 * sibling inside the same wrapper — that is what lets `./dismiss.ts` tell an
 * outside press from a press on the button that opened it. Nothing here moves
 * the button: the wrapper is the button's own box until the panel opens, and the
 * panel is drawn out of flow, so the promise that the pass does not move under
 * the cursor survives the addition.
 */
import { createElement, useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { usePressGestures } from '../../card/press';
import { useDismissable } from './dismiss';
import { asContainer } from './focus';
import type { ContainerNode } from './focus';
import { YIELDS } from './yields';
import type { YieldBoundary } from '@mtg/kernel';

/**
 * What the fixed pass button says, whatever the stack holds.
 *
 * The rail's own entry for the same option reads `Let it resolve` with a count
 * of what is on the stack under it, and that is right for a list with room to
 * explain itself. This one is a fixed home, and half of what makes a home fixed
 * is that the word does not change under the cursor.
 */
export const PASS_LABEL = 'Pass';

/** What the panel the second gesture opens is called, for a reader who cannot see it. */
export const PASS_YIELDS_LABEL = 'Yield options';

export interface PassProps {
  /** `passIndex`'s answer over the pending decision, or null. */
  readonly at: number | null;
  readonly onPass: () => void;
  /**
   * Whether a yield can be taken at all, which is the badge's own rule: a yield
   * spends the windows this seat would otherwise be asked in, so it needs a pass
   * to spend. Null `at` and `canYield` therefore move together in practice, and
   * the flag is still separate because the caller owns the predicate.
   */
  readonly canYield?: boolean;
  /**
   * A caller with no yield to offer — a replay frame, a read-only render — gets
   * the button it always had and no second gesture at all.
   */
  readonly onYield?: ((boundary: YieldBoundary) => void) | undefined;
  /**
   * Whether this pass would also spend an unspent land drop (`./land-drop.ts`,
   * `mtg-re3`).
   *
   * It marks the button and changes nothing else: `at` is untouched, no confirm
   * is introduced, and the click still submits the index the kernel handed out.
   * The two rules at the top of this file both hold — the button does not move,
   * and it has no path that does not run through an enumerated index.
   */
  readonly landDrop?: boolean;
}

export function PassControl(props: PassProps): ReactElement {
  const { at, onPass, onYield } = props;
  const canYield = props.canYield ?? false;
  const [open, setOpen] = useState(false);
  const root = useRef<ContainerNode | null>(null);
  const offersYield = onYield !== undefined && canYield;

  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  useDismissable({
    open,
    within: (): ContainerNode | null => root.current,
    onDismiss: close,
  });

  // The touch model's opening. `onActivate` is deliberately not passed: a repeat
  // press on the pass would be a second pass, and the button's own click is
  // already exactly that.
  const press = usePressGestures({
    onMenu: offersYield
      ? (): void => {
          setOpen(true);
        }
      : undefined,
  });

  const button = createElement(
    'button',
    {
      type: 'button',
      className: 'mtg-btn mtg-play__pass',
      'data-variant': 'primary',
      disabled: at === null,
      // An attribute rather than a second class, so `../../styles/board/status.ts`
      // marks it and nothing has to remember to take a class back off.
      ...(props.landDrop === true ? { 'data-land-drop': true } : {}),
      onClick: (): void => {
        // The click a long press produced belongs to the gesture that fired, not
        // to the pass. `../../card/Card.ts` spends the same claim for the same
        // reason.
        if (press.consumeClick()) return;
        onPass();
      },
      ...(offersYield
        ? {
            'aria-haspopup': true,
            'aria-expanded': open,
            onContextMenu: (event: { preventDefault: () => void }): void => {
              event.preventDefault();
              setOpen(true);
            },
            onPointerDown: press.onPointerDown,
            onPointerUp: press.onPointerUp,
            onPointerMove: press.onPointerMove,
            onPointerCancel: press.onPointerCancel,
          }
        : {}),
    },
    PASS_LABEL,
  );

  if (!offersYield) return button;

  return createElement(
    'div',
    {
      className: 'mtg-pass',
      ref: (node: unknown): void => {
        root.current = asContainer(node);
      },
    },
    button,
    open
      ? createElement(
          'div',
          { className: 'mtg-pass__yields', role: 'group', 'aria-label': PASS_YIELDS_LABEL },
          ...YIELDS.map((yielded, index) =>
            createElement(
              'button',
              {
                key: yielded.boundary,
                type: 'button',
                className: 'mtg-btn',
                autoFocus: index === 0,
                onClick: (): void => {
                  close();
                  onYield(yielded.boundary);
                },
              },
              yielded.label,
            ),
          ),
        )
      : null,
  );
}

export function passButton(props: PassProps): ReactElement {
  return createElement(PassControl, props);
}
