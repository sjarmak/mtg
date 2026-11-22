/**
 * The divider itself: the thing between two panes that a person drags.
 *
 * `mtg-rgc.19`. `./split.ts` holds where a split *is* and what may hold it
 * there; this file is the control that changes it, and it is one control rather
 * than one per surface because a draft's pack-over-pool, a builder's
 * pool-over-deck and the workspace's main-beside-rail are the same gesture at
 * three angles.
 *
 * # Three ways to move it, and why each is here
 *
 * **Dragging** is the gesture the ask names, and it is a Pointer Events
 * recognizer for the reason `../card/press.ts` gives at length: one stream, one
 * `pointerType` on it, no drifting mouse-and-touch pair. The pointer is captured
 * on the way down, so a hand that outruns a slow layout keeps steering the
 * divider instead of dropping it over whatever it happened to cross.
 *
 * **The arrow keys** move it in `SPLIT_STEP`s, because a divider reachable only
 * by pointer is a layout a keyboard cannot change; `role="separator"` with a
 * tabindex is the ARIA window-splitter pattern, and the pattern's own keys are
 * the arrows. `Home` and a double click both hand the split back to the
 * stylesheet -- the same undo by two routes, one for each input.
 *
 * # What it announces
 *
 * `aria-valuenow` is the share the divider is at, and while nothing has been
 * dragged there is no share: the stylesheet's arrangement is a `flex-basis` or a
 * pair of `fr` units, and asking the DOM what proportion those came out at would
 * be a measurement this package deliberately does not take during a render
 * (`../routes/deck/stack-box.ts` records why a layout read that feeds a layout
 * write chases itself). So each consumer states what its own default
 * arrangement is worth as a share, for announcing only. It is never used to draw
 * anything, and the first drag replaces it with a measured number.
 *
 * # No DOM types
 *
 * The workspace tsconfig has no `lib: dom` (`../mount.ts` says why), so what
 * this file reads off an event and off an element is declared as the narrowest
 * interface that states it and checked at runtime. React's own event types
 * satisfy them, which is what makes the handlers assignable to an element's
 * props.
 */
import { createElement, useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { DEFAULT_SPLIT_LIMITS, clampShare, nudged, restoresDefault, shareIn } from './split';
import type { SplitBox, SplitLimits } from './split';

/** The members a drag reads off a pointer event. React's `PointerEvent` has them. */
export interface SplitPointerEvent {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: unknown;
}

/** The members the keyboard half reads. React's `KeyboardEvent` has them. */
export interface SplitKeyEvent {
  readonly key: string;
  preventDefault(): void;
}

/** A pointer's target, once it has been checked for the capture pair. */
interface CapturingNode {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  readonly parentElement: unknown;
}

/** An element that can be asked where it is. */
interface MeasuredNode {
  getBoundingClientRect(): {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  };
}

function asCapturing(node: unknown): CapturingNode | null {
  if (typeof node !== 'object' || node === null) return null;
  const partial = node as Partial<CapturingNode>;
  if (typeof partial.setPointerCapture !== 'function') return null;
  if (typeof partial.releasePointerCapture !== 'function') return null;
  return node as CapturingNode;
}

function asMeasured(node: unknown): MeasuredNode | null {
  if (typeof node !== 'object' || node === null) return null;
  const partial = node as Partial<MeasuredNode>;
  if (typeof partial.getBoundingClientRect !== 'function') return null;
  return node as MeasuredNode;
}

/**
 * The container being divided, along the axis the divider moves on.
 *
 * The divider's own parent, because in all three consumers the divider is a
 * child of the box whose room is being shared out -- the flex column on the
 * draft, the grid on the builder and on the workspace. Reading the parent rather
 * than taking a ref keeps the control self-contained: a caller places it between
 * two panes and states nothing else.
 */
export function boxOf(target: unknown, orientation: SplitOrientation): SplitBox | null {
  const node = asCapturing(target);
  const parent = asMeasured(node === null ? null : node.parentElement);
  if (parent === null) return null;
  const rect = parent.getBoundingClientRect();
  return orientation === 'horizontal'
    ? { start: rect.top, extent: rect.height }
    : { start: rect.left, extent: rect.width };
}

/**
 * Which way the panes are stacked, named after the divider's own line.
 *
 * `horizontal` is a horizontal rule between a pane above and a pane below, and
 * it is dragged up and down. This is ARIA's sense of the word for a separator,
 * not the axis of travel, and it is the value that goes into
 * `aria-orientation` unchanged.
 */
export type SplitOrientation = 'horizontal' | 'vertical';

export interface SplitHandleProps {
  /**
   * What this divider is called, read as "resize <name>". Names the two panes:
   * "the pack and the drafted pool", not "splitter".
   */
  readonly label: string;
  readonly orientation: SplitOrientation;
  /** The share the first pane is at, or null while the stylesheet decides. */
  readonly share: number | null;
  /** What the stylesheet's own arrangement is worth, for announcing only. */
  readonly defaultShare: number;
  readonly limits?: SplitLimits;
  readonly onShare: (share: number | null) => void;
}

/**
 * A divider between two panes.
 *
 * Rendered by the container, between the two children it divides, and drawn by
 * `../styles/panel.ts`'s `.mtg-split` rules. It draws nothing of its own and
 * holds no layout: what moves when it is dragged is the custom property the
 * container carries.
 */
export function SplitHandle(props: SplitHandleProps): ReactElement {
  const limits = props.limits ?? DEFAULT_SPLIT_LIMITS;
  const [dragging, setDragging] = useState(false);
  // The box is taken once, on the way down, and not per move: a container whose
  // first pane is being resized changes height under the pointer in some
  // arrangements, and re-reading it mid-drag would make the divider chase the
  // hand that is holding it.
  const box = useRef<SplitBox | null>(null);
  const { onShare, orientation } = props;

  const onPointerDown = useCallback(
    (event: SplitPointerEvent): void => {
      const node = asCapturing(event.currentTarget);
      if (node === null) return;
      box.current = boxOf(event.currentTarget, orientation);
      if (box.current === null) return;
      node.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [orientation],
  );

  const onPointerMove = useCallback(
    (event: SplitPointerEvent): void => {
      const held = box.current;
      if (held === null) return;
      const at = shareIn(held, orientation === 'horizontal' ? event.clientY : event.clientX);
      if (at === null) return;
      onShare(clampShare(at, limits));
    },
    [limits, onShare, orientation],
  );

  const stop = useCallback((event: SplitPointerEvent): void => {
    const node = asCapturing(event.currentTarget);
    if (node !== null) node.releasePointerCapture(event.pointerId);
    box.current = null;
    setDragging(false);
  }, []);

  const onKeyDown = useCallback(
    (event: SplitKeyEvent): void => {
      if (restoresDefault(event.key)) {
        event.preventDefault();
        onShare(null);
        return;
      }
      const next = nudged(props.share ?? props.defaultShare, event.key, limits);
      if (next === null) return;
      event.preventDefault();
      onShare(next);
    },
    [limits, onShare, props.defaultShare, props.share],
  );

  const at = props.share ?? props.defaultShare;
  return createElement('div', {
    className: 'mtg-split',
    // The drag is live, which the cursor already says under the pointer and
    // nothing said anywhere else: the rule this feeds keeps the divider lit
    // while a hand that has wandered off it is still steering it.
    'data-dragging': dragging ? 'true' : 'false',
    'data-orientation': orientation,
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': orientation,
    'aria-label': `Resize ${props.label}`,
    'aria-valuenow': Math.round(at * 100),
    'aria-valuemin': Math.round(limits.min * 100),
    'aria-valuemax': Math.round(limits.max * 100),
    onPointerDown,
    onPointerMove,
    onPointerUp: stop,
    onPointerCancel: stop,
    onKeyDown,
    // The pointer's own undo, beside the keyboard's Home. A divider is the one
    // control on the page whose effect is a number nobody chose deliberately,
    // so getting back to the arrangement the page shipped with has to be
    // cheaper than dragging until it looks right again.
    onDoubleClick: (): void => {
      onShare(null);
    },
  });
}
