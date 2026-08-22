/**
 * The second input model, on the axis that is a gesture.
 *
 * `mtg-yg8`. The card face has had three gestures since `mtg-bz2.2` and all
 * three are a pointer's: a click selects, a double click plays the default move,
 * a right click or the context key opens the menu. Two of those do not exist on
 * a tablet. There is no right button, and iOS Safari's `dblclick` is unreliable
 * — a double tap is the browser's own zoom gesture, so the second press is held
 * back and sometimes spent on the page instead of on the card. the playtester's own
 * table (`mtg-bz2.14`) names the replacements: *long press zooms and opens
 * context actions*, and *tap a selected card again confirms the obvious action*.
 *
 * # One stream, not two families
 *
 * This is a Pointer Events recognizer rather than a touch branch beside a mouse
 * branch. `touchstart`/`mousedown` pairs drift — the two paths are edited a year
 * apart and stop agreeing about what a press is — and the browser already
 * unifies them: one `pointerdown` per press, whatever made it, carrying the
 * `pointerType` that says which. So there is one code path and one condition
 * inside it.
 *
 * **The condition is `pointerType === 'touch' || pointerType === 'pen'`, an
 * inclusion list rather than an exclusion of `'mouse'` alone.** A mouse reaches
 * every one of these actions already, and arming a long press for it would mean
 * a slow click on a card opened a menu instead of playing the card — a gesture
 * nobody asked for, on the surface everybody uses today. So a mouse press arms
 * nothing here and keeps `./Card.ts`'s `onDoubleClick` and `onContextMenu`
 * exactly as they were. A pen is not a mouse: it has no second button on the two
 * tablets that matter and it is held like a finger, so it takes the touch model.
 * An exclusion of `'mouse'` alone also arms for `''`, which is `pointerType`'s
 * spec default on a `PointerEvent` nothing set it on — a synthetic dispatch,
 * not a finger or a stylus — so naming the two real sources is what keeps a
 * fabricated event from taking the touch path a genuine one would.
 *
 * # What each gesture decides
 *
 * The ordering `../routes/play/selection.ts` argues for the pointer holds here
 * unchanged, because these gestures dispatch into the same three callbacks:
 *
 *  - **A tap** is not recognized at all. It reaches the face as an ordinary
 *    `click`, and `onSelect` decides what it means. Nothing in this file delays
 *    it, swallows it, or waits to see whether a second one is coming — a
 *    recognizer that held every tap for 300ms to rule out a double tap would tax
 *    the common gesture to pay for the rare one.
 *  - **A long press** — held past `LONG_PRESS_MS` without moving past
 *    `PRESS_SLOP_PX` — takes the focus ring and opens the menu. The ring is the
 *    zoom half of the playtester's sentence and costs nothing to give: the zoom panel
 *    is already revealed by `:focus-within` on the slot (`../styles/card.ts`),
 *    which is the keyboard's route to it, so a long press reaches the whole card
 *    through machinery that was already there. It also fixes the ring where the
 *    menu expects it — `selection.ts` hands it back to whatever held it when the
 *    menu opened, and on a tablet that would otherwise be the document body.
 *  - **A repeat press** — a second press landing within `REPEAT_PRESS_MS` of the
 *    last one's release and within `PRESS_SLOP_PX` of where it landed — plays
 *    the card's default move, which is what the double click plays. It fires on
 *    the second press's *down* rather than on its release, so the click that
 *    press produces can be spent here rather than reaching `onSelect` and
 *    closing the panel the first tap opened.
 *
 * A gesture that fired **claims the click that follows it**, which is the whole
 * of the coordination between this file and the face's own `onClick`.
 * `consumeClick` reads that claim and clears it. Without it a long press would
 * open the menu and then the release would select the card underneath, and the
 * repeat press would activate and then select — the same double-acting this
 * surface already refused once, in the `detail >= 2` guard `./Card.ts` carries
 * for the mouse.
 *
 * # What is not decided here
 *
 * Nothing about what a move *is*. This file recognizes a shape in a pointer
 * stream and calls one of two callbacks; which move that reaches, and whether
 * there is an honest default at all, stays in `selection.ts` and
 * `../routes/play/default-action.ts`, where the refusal to guess at a player's
 * intent is written down.
 *
 * A drag is not here either. `mtg-bz2.14`'s table has "drag a creature forward
 * marks it as an attacker", and a drag is a different recognizer over the same
 * stream — `PRESS_SLOP_PX` is exactly the threshold it would pick up at, which
 * is why movement past it cancels rather than being ignored.
 */
import { useEffect, useRef } from 'react';
import { asFocusable } from '../routes/play/focus';
import type { FocusableNode } from '../routes/play/focus';

/**
 * How long a press is held before it is a long press.
 *
 * 500ms, which is what iOS spends before its own selection callout and what
 * Android's `ViewConfiguration` has called a long press since the beginning. A
 * shorter threshold turns a slow tap into a menu; a longer one is a gesture
 * people give up on halfway through. It is the same number on both sides of that
 * trade, so it is worth taking the platforms' own.
 */
export const LONG_PRESS_MS = 500;

/**
 * How long after a release a second press is still the same gesture.
 *
 * 400ms rather than a browser's double-click interval, which is a system
 * preference this code cannot read. The upper bound is what makes a repeat press
 * safe rather than fast: past it, two presses on one card are two taps, and the
 * second one selects. Under it they are the "tap it again" of the gesture table.
 */
export const REPEAT_PRESS_MS = 400;

/**
 * How far a finger may travel and still be pressing rather than dragging.
 *
 * 10 CSS px. A finger on glass never holds still, and a threshold at zero would
 * cancel every long press ever made. It is also the distance a drag has to clear
 * before it is a drag, which is why the two gestures share one number: a stream
 * cannot be both, and the point where it stops being a press is the point where
 * it starts being something else.
 */
export const PRESS_SLOP_PX = 10;

/**
 * The members this recognizer reads off a pointer event, checked structurally.
 *
 * The workspace tsconfig has no `lib: dom` (`AGENTS.md` says why), so a DOM fact
 * is declared as the narrowest interface that states it. React's own
 * `PointerEvent` satisfies this, which is what makes the handlers assignable to
 * a button's props.
 */
export interface PointerGestureEvent {
  readonly pointerType: string;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: unknown;
}

/** What a face hands the recognizer: the two gestures it has something to do with. */
export interface PressInput {
  /** Opened by a long press, when the face has a menu at all. */
  readonly onMenu?: (() => void) | undefined;
  /** Played by a repeat press, when the face has a default move at all. */
  readonly onActivate?: (() => void) | undefined;
}

/** The handlers a face spreads onto its element, and the claim its click reads. */
export interface PressGestures {
  onPointerDown(event: PointerGestureEvent): void;
  onPointerMove(event: PointerGestureEvent): void;
  onPointerUp(event: PointerGestureEvent): void;
  onPointerCancel(event: PointerGestureEvent): void;
  /**
   * Whether the click about to be delivered was already answered by a gesture,
   * clearing the claim as it reports it. Called once, first, from the face's own
   * `onClick`.
   */
  consumeClick(): boolean;
}

/** Everything one face remembers between presses. Never read during a render. */
interface PressState {
  timer: ReturnType<typeof setTimeout> | null;
  /** The press being tracked, so a second finger cannot cancel the first's. */
  pointer: number | null;
  /**
   * The element the press landed on, taken while the event is still being
   * dispatched.
   *
   * React nulls `currentTarget` the moment a handler returns, so reading it from
   * inside the long-press timer gets nothing — the ring stayed on the body, the
   * menu had no opener to remember, and Escape handed the ring nowhere. The
   * element is what the gesture needs, so the element is what is kept.
   */
  target: FocusableNode | null;
  downX: number;
  downY: number;
  /** When the last press that was not itself a gesture let go, and where. */
  upAt: number;
  upX: number;
  upY: number;
  /** A gesture fired, so the click this press produces is already spent. */
  claimed: boolean;
}

function fresh(): PressState {
  return {
    timer: null,
    pointer: null,
    target: null,
    downX: 0,
    downY: 0,
    upAt: 0,
    upX: 0,
    upY: 0,
    claimed: false,
  };
}

/** Within the slop of a remembered point, which is what "the same place" means. */
function near(x: number, y: number, atX: number, atY: number): boolean {
  return Math.abs(x - atX) <= PRESS_SLOP_PX && Math.abs(y - atY) <= PRESS_SLOP_PX;
}

/**
 * The two touch gestures over one face, as handlers to spread onto it.
 *
 * A hook because the state is per-face and survives renders without being drawn
 * — the same reason `selection.ts` keeps the element that opened a picker in a
 * ref. The board re-renders on every kernel decision, so state held any other
 * way would be reset under the finger.
 *
 * Callers pass the callbacks fresh on every render; they are read off the ref at
 * the moment a gesture fires rather than captured when the timer is armed, so a
 * press that spans a re-render dispatches into the current position rather than
 * into the one it started in.
 */
export function usePressGestures(input: PressInput): PressGestures {
  const state = useRef<PressState>(fresh());
  const latest = useRef<PressInput>(input);
  latest.current = input;

  function disarm(): void {
    const timer = state.current.timer;
    if (timer !== null) clearTimeout(timer);
    state.current.timer = null;
  }

  // The card the timer was armed on can leave the battlefield -- killed,
  // bounced, sacrificed, the ordinary traffic of a game -- inside
  // `LONG_PRESS_MS` of the press that armed it, and its face unmounts without
  // ever delivering the pointer event that would have disarmed the timer
  // itself. Left alone the timer still fires: `held.target?.focus()` reaches a
  // node the document no longer has, and `onMenu` opens for a card that is not
  // there to open a menu for. The empty dependency array is deliberate --
  // this runs once per face, on mount and unmount only, the same lifetime the
  // ref itself has.
  useEffect(() => disarm, []);

  function onPointerDown(event: PointerGestureEvent): void {
    // An inclusion list, not an exclusion list. `pointerType` is `''` by spec
    // default on a `PointerEvent` nothing set it on -- a synthetic dispatch,
    // not a finger or a stylus -- and an exclusion of `'mouse'` alone let such
    // an event through to the touch model same as a real touch would. A mouse
    // keeps the model it already has, whole -- `./Card.ts`'s right click and
    // double click are that model, and a second recognizer over the same
    // stream would be two answers to one press -- and a pen is held like a
    // finger on the two tablets that matter, so those two are the arming set.
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    disarm();
    const now = Date.now();
    const at = state.current;
    at.pointer = event.pointerId;
    at.target = asFocusable(event.currentTarget);
    at.downX = event.clientX;
    at.downY = event.clientY;
    at.claimed = false;

    const activate = latest.current.onActivate;
    if (
      activate !== undefined &&
      at.upAt !== 0 &&
      now - at.upAt <= REPEAT_PRESS_MS &&
      near(event.clientX, event.clientY, at.upX, at.upY)
    ) {
      // The second press of a repeat, answered on the way down so the click it
      // is about to produce can be claimed rather than reaching `onSelect`.
      at.claimed = true;
      at.upAt = 0;
      activate();
      return;
    }

    if (latest.current.onMenu === undefined) return;
    at.timer = setTimeout((): void => {
      const held = state.current;
      held.timer = null;
      held.claimed = true;
      // The ring first, then the menu. `selection.ts` remembers whoever held it
      // when the menu opened and hands it back on dismissal, and on a tablet
      // that would otherwise be the body; taking it here is also what reveals
      // the zoom, through the `:focus-within` the keyboard already uses.
      held.target?.focus();
      latest.current.onMenu?.();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerGestureEvent): void {
    const at = state.current;
    if (at.pointer !== event.pointerId || at.timer === null) return;
    if (near(event.clientX, event.clientY, at.downX, at.downY)) return;
    // Past the slop this is a drag, a scroll of the hand rail, or a finger
    // wandering off the card. None of them is a long press.
    disarm();
    at.upAt = 0;
  }

  function onPointerUp(event: PointerGestureEvent): void {
    const at = state.current;
    if (at.pointer !== event.pointerId) return;
    disarm();
    at.pointer = null;
    if (at.claimed) {
      // A press a gesture already answered is not the first half of a repeat.
      at.upAt = 0;
      return;
    }
    at.upAt = Date.now();
    at.upX = event.clientX;
    at.upY = event.clientY;
  }

  function onPointerCancel(event: PointerGestureEvent): void {
    const at = state.current;
    if (at.pointer !== event.pointerId) return;
    disarm();
    at.pointer = null;
    at.upAt = 0;
    // A canceled pointer produces no click, so a claim taken during it has
    // nothing left to spend and outlives the gesture it belonged to. The next
    // click on this face is somebody else's -- a mouse, or the Enter key, which
    // this recognizer never sees and so can never learn it swallowed one of.
    at.claimed = false;
  }

  function consumeClick(): boolean {
    const at = state.current;
    if (!at.claimed) return false;
    at.claimed = false;
    return true;
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, consumeClick };
}
