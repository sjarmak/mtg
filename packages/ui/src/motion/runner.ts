/**
 * The half of the motion layer that touches the page: it measures the board,
 * matches a plan's cues to the elements the cues are about, and plays them.
 *
 * # The mechanism, in one paragraph
 *
 * Every card on the table already carries its kernel object id
 * (`../board/CardSlot.ts` writes `data-permanent-key`, and the hand writes the
 * same attribute for the same reason: a hand of two Mountains draws two
 * identical faces). So a snapshot of the board is a map from object id to the
 * box that object occupied, taken after every commit. When the next commit
 * lands, an object whose box moved is animated from the old box to the new one,
 * an object that has appeared is animated in from the zone the event says it
 * came from, and an object that has gone is animated out to the zone the event
 * says it went to. First, Last, Invert, Play — `./geometry.ts` argues why it is
 * measured rather than written down.
 *
 * # A departure animates the element React just removed
 *
 * `mtg-ncg` records why the CSS-only lane stopped short of departures: an
 * animation on the way out cannot be fired by insertion, and it needs the
 * element held past its removal. Here is what that costs, and it is less than it
 * sounds. The snapshot holds the element itself, not a copy of it. React detaches
 * a removed node but does not destroy it, so on the commit where a creature dies
 * the snapshot is holding the exact node the player was looking at a frame ago,
 * complete with its art, its counters and its damage. Re-parenting it into the
 * ghost layer is legal precisely because React has let go of it — the check is
 * `isConnected`, and a node still in the document is never taken. Nothing is
 * cloned, no markup is rebuilt, and the thing that flies to the graveyard is the
 * card rather than a drawing of one.
 *
 * # What paces it
 *
 * The plan (`./plan.ts`) says when each cue starts. A move is played through the
 * Web Animations API with `delay` and `fill: 'backwards'`, which holds the card
 * at its origin until its turn comes. A timer could not do that: between the
 * commit and the timer firing the card would be sitting at its destination, so a
 * chain of five moves would show five cards teleport and then travel.
 *
 * A mark is the other way round — a timer, then an attribute, and the sheet owns
 * what a mark looks like (`../styles/board/motion.ts`). A highlight is a color
 * and a glow, and this package has exactly one place where a color may be
 * chosen; a keyframe assembled here would either hard-code one or interpolate a
 * custom property the API does not interpolate.
 *
 * # Nothing here is load-bearing for correctness
 *
 * Every path in this file is allowed to find nothing and do nothing. A zone with
 * no element, a card the viewer may not see, a browser with no
 * `Element.animate`, a snapshot from before a route change — each one ends in a
 * cue that is skipped. The board is already correct without any of it; this only
 * decides whether the player got to watch it happen.
 *
 * The DOM types are declared here rather than imported because the workspace
 * tsconfig has no `lib: dom` (`../../test/play/arrival.test.ts` records the same
 * constraint). They are the members this file calls and nothing more, which also
 * makes the runner drivable from a test with no browser in it.
 */
import type { MotionCue, MotionPlan, MoveCue } from './plan';
import { MOVE_EASING } from './timing';
import { fallbackRect, invert, laneSelector, MAT_SELECTOR, transformOf, zoneSelector } from './geometry';
import type { Rect } from './geometry';

export interface MotionKeyframe {
  readonly transform?: string;
  readonly opacity?: string;
}

export interface MotionTiming {
  readonly duration: number;
  readonly delay: number;
  readonly easing: string;
  readonly fill: 'backwards';
}

export interface MotionAnimation {
  cancel: () => void;
  onfinish: (() => void) | null;
}

export interface MotionNode {
  readonly getBoundingClientRect: () => Rect;
  readonly getAttribute: (name: string) => string | null;
  readonly setAttribute: (name: string, value: string) => void;
  readonly removeAttribute: (name: string) => void;
  readonly appendChild: (child: MotionNode) => unknown;
  readonly remove: () => void;
  readonly isConnected: boolean;
  readonly animate?: (frames: readonly MotionKeyframe[], timing: MotionTiming) => MotionAnimation;
}

export interface MotionDocument {
  readonly createElement: (tag: string) => MotionNode;
}

export interface MotionRoot extends MotionNode {
  readonly querySelector: (selector: string) => MotionNode | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<MotionNode>;
  readonly ownerDocument: MotionDocument | null;
}

/** The one impure thing a test replaces: when a mark's attribute goes on and off. */
export interface MotionHost {
  readonly schedule: (fn: () => void, ms: number) => () => void;
}

const DEFAULT_HOST: MotionHost = {
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return (): void => {
      clearTimeout(handle);
    };
  },
};

/** The attribute the sheet draws a mark from, and the one that says FLIP is live. */
export const MARK_ATTRIBUTE = 'data-motion-mark';
export const MOTION_ATTRIBUTE = 'data-motion';

/** Under a pixel of movement is a reflow rounding, not a card going anywhere. */
const MOVED_EPSILON = 1;

interface Snapshot {
  readonly el: MotionNode;
  readonly rect: Rect;
}

export interface MotionRunner {
  /**
   * Reconcile one commit: play the cues this plan asks for against the board as
   * it is laid out right now, then remember the board for the next commit.
   */
  readonly sync: (root: MotionRoot, plan: MotionPlan) => void;
  /**
   * Stop everything in flight where it is, and keep the board.
   *
   * The player asked to move on (`../routes/play/beat-motion.ts`): a pause that
   * is being reported as movement offers its Continue *during* the movement, so
   * pressing it has to end the movement rather than leave the game running on
   * behind an animation nobody is watching any more. Nothing is lost by cutting
   * — the board already shows the result of every cue in flight, which is this
   * package's oldest property — so the cut is a jump to the end rather than an
   * undo.
   *
   * Distinct from `reset` in exactly one field, and it is the field that
   * matters: the snapshot of where each card is survives. `reset` drops it
   * because the board it describes is going away; a cut happens in the middle of
   * a live game, and dropping it there would take the *next* batch's motion with
   * it — `sync` would find no previous board, take its first-commit path, and
   * animate nothing on the commit the player pressed Continue to see.
   */
  readonly cut: () => void;
  /** Drop everything in flight and forget the board. Route changes and unmounts. */
  readonly reset: () => void;
}

/** The board's objects and where they are, right now. */
function snapshot(root: MotionRoot): Map<string, Snapshot> {
  const found = new Map<string, Snapshot>();
  for (const el of Array.from(root.querySelectorAll('[data-permanent-key]'))) {
    const key = keyOf(el);
    if (key === null || found.has(key)) continue;
    found.set(key, { el, rect: el.getBoundingClientRect() });
  }
  return found;
}

/** The object id off an element, which is the handle everything here is keyed by. */
function keyOf(el: MotionNode): string | null {
  return el.getAttribute('data-permanent-key');
}

/**
 * One cue per object, from the first `from` to the last `to`.
 *
 * A spell cast and resolved inside one commit emits hand→stack and
 * stack→graveyard, and the DOM only ever shows the end of that: replaying both
 * would animate a card to a stack it is no longer on and then away from it. The
 * player saw one card go from their hand to the graveyard, so that is the one
 * movement, and it starts when the first of the two was going to.
 */
function movesByObject(cues: readonly MotionCue[]): readonly MoveCue[] {
  const collapsed = new Map<string, MoveCue>();
  for (const cue of cues) {
    if (cue.kind !== 'move') continue;
    const open = collapsed.get(cue.oid);
    collapsed.set(cue.oid, open === undefined ? cue : { ...open, to: cue.to, seat: cue.seat });
  }
  return [...collapsed.values()];
}

/** Where a zone is on screen, or where it would be if the board drew it. */
function zoneRect(root: MotionRoot, cue: MoveCue, zone: 'from' | 'to', size: Rect): Rect | null {
  const selector = zoneSelector(zone === 'from' ? cue.from : cue.to, cue.seat);
  const anchor = selector === null ? null : root.querySelector(selector);
  if (anchor !== null) {
    const rect = anchor.getBoundingClientRect();
    // An anchor with no area is a zone the layout has not given a box — an empty
    // graveyard strip, a stack that draws nothing when it is empty
    // (`../board/StackZone.ts`). Falling back is truer than traveling to a point.
    if (rect.width > 0 && rect.height > 0) return { ...rect, width: size.width, height: size.height };
  }
  const lane = root.querySelector(laneSelector(cue.seat));
  if (lane === null) return null;
  return fallbackRect(lane.getBoundingClientRect(), cue.seat, size);
}

function moved(before: Rect, after: Rect): boolean {
  return Math.abs(before.x - after.x) > MOVED_EPSILON || Math.abs(before.y - after.y) > MOVED_EPSILON;
}

export function createMotionRunner(host: MotionHost = DEFAULT_HOST): MotionRunner {
  let previous: Map<string, Snapshot> | null = null;
  let layer: MotionNode | null = null;
  const running = new Map<string, MotionAnimation>();
  const pending = new Set<() => void>();
  /*
   * The permanents currently wearing a mark attribute.
   *
   * A mark is a timer that sets an attribute and a second timer that takes it
   * off, so canceling the timers alone leaves the ring painted on a card for the
   * rest of the game. That was harmless while `reset` was the only canceler —
   * the board it marked was being thrown away — and it stops being harmless the
   * moment a live game can cut a chain short.
   */
  const marked = new Set<MotionNode>();

  /** The fixed, inert plane every traveling card is drawn on. */
  function ghostLayer(root: MotionRoot): MotionNode | null {
    if (layer !== null && layer.isConnected) return layer;
    const doc = root.ownerDocument;
    if (doc === null) return null;
    const made = doc.createElement('div');
    made.setAttribute(MOTION_ATTRIBUTE, 'layer');
    made.setAttribute('aria-hidden', 'true');
    root.appendChild(made);
    layer = made;
    return made;
  }

  function play(el: MotionNode, frames: readonly MotionKeyframe[], cue: MotionCue): MotionAnimation | null {
    const animate = el.animate;
    if (animate === undefined) return null;
    const open = running.get(cue.oid);
    if (open !== undefined) open.cancel();
    const animation = animate.call(el, frames, {
      duration: cue.durationMs,
      delay: cue.atMs,
      easing: MOVE_EASING,
      // Backwards, so the card holds its starting transform through the delay
      // and never appears at its destination first. Never forwards: a filled
      // animation's values sit in the animation origin and would outrank every
      // author declaration for the rest of the card's life on the table, which
      // is the trap `../styles/board/arrival.ts` records.
      fill: 'backwards',
    });
    running.set(cue.oid, animation);
    return animation;
  }

  /** A card that is still on the table and is somewhere else than it was. */
  function playMove(cue: MoveCue, before: Rect, after: Snapshot): void {
    const step = invert(before, after.rect);
    play(after.el, [{ transform: transformOf(step.dx, step.dy, step.scale) }, { transform: 'none' }], cue);
  }

  /** A card the board has just drawn for the first time, coming from its old zone. */
  function playArrival(root: MotionRoot, cue: MoveCue, after: Snapshot): void {
    const from = zoneRect(root, cue, 'from', after.rect);
    if (from === null) return;
    const step = invert(from, after.rect);
    play(
      after.el,
      [
        { transform: transformOf(step.dx, step.dy, step.scale), opacity: '0' },
        { transform: 'none', opacity: '1' },
      ],
      cue,
    );
  }

  /**
   * A card the board has stopped drawing, flying to wherever it went.
   *
   * The node is the one React removed, re-parented into the ghost layer at the
   * box it last occupied. It is taken only when it is genuinely detached, so a
   * card that merely moved to another parent — the equipment tray
   * (`../board/Battlefield.ts`) is the case — is never stolen out of the table.
   */
  function playDeparture(root: MotionRoot, cue: MoveCue, before: Snapshot): void {
    if (before.el.isConnected) return;
    const plane = ghostLayer(root);
    if (plane === null) return;
    const to = zoneRect(root, cue, 'to', before.rect);
    if (to === null) return;
    const doc = root.ownerDocument;
    if (doc === null) return;
    const ghost = doc.createElement('div');
    ghost.setAttribute(MOTION_ATTRIBUTE, 'ghost');
    ghost.setAttribute(
      'style',
      `left:${String(before.rect.x)}px;top:${String(before.rect.y)}px;width:${String(before.rect.width)}px;height:${String(before.rect.height)}px;`,
    );
    ghost.appendChild(before.el);
    plane.appendChild(ghost);
    const step = invert(before.rect, to);
    // Inverted the other way round from an arrival: the ghost is *at* the origin,
    // so the transform runs from nothing to the offset that lands it on the
    // destination, and it fades out as it gets there because the pile it is
    // joining draws it as a name rather than as a card.
    const animation = play(
      ghost,
      [
        { transform: 'none', opacity: '1' },
        { transform: transformOf(-step.dx, -step.dy, 1 / (step.scale === 0 ? 1 : step.scale)), opacity: '0' },
      ],
      cue,
    );
    if (animation === null) {
      ghost.remove();
      return;
    }
    animation.onfinish = (): void => {
      ghost.remove();
    };
  }

  /** A highlight in place: the attribute goes on at the cue's beat and off at its end. */
  function playMark(cue: MotionCue, at: Snapshot | undefined): void {
    if (cue.kind !== 'mark' || at === undefined) return;
    const start = host.schedule((): void => {
      at.el.setAttribute(MARK_ATTRIBUTE, cue.mark);
      marked.add(at.el);
      const stop = host.schedule((): void => {
        at.el.removeAttribute(MARK_ATTRIBUTE);
        marked.delete(at.el);
        pending.delete(stop);
      }, cue.durationMs);
      pending.add(stop);
      pending.delete(start);
    }, cue.atMs);
    pending.add(start);
  }

  /**
   * Everything both stoppers do: cancel what is animating, cancel what is
   * waiting to, take off every mark that went on and has not come off, and drop
   * the ghost layer with the departed cards still parented to it.
   *
   * The marks are the part that is easy to leave out. A canceled timer never
   * runs, so the attribute it was going to remove stays on the card, and the
   * sheet keeps drawing the ring — a permanent that took damage during a cut
   * beat would wear the damage highlight for the rest of the game. The set is
   * the only record of which cards are wearing one, because the attribute is
   * written on elements React owns and may have replaced since.
   */
  function stopAll(): void {
    for (const animation of running.values()) animation.cancel();
    running.clear();
    for (const cancel of pending) cancel();
    pending.clear();
    for (const el of marked) el.removeAttribute(MARK_ATTRIBUTE);
    marked.clear();
    if (layer !== null) layer.remove();
    layer = null;
  }

  return {
    sync: (root, plan): void => {
      const current = snapshot(root);
      const before = previous;
      previous = current;
      // The board says FLIP is live, which turns off the CSS-only arrival
      // (`../styles/board/arrival.ts`) so one object never gets two vocabularies.
      // Written even under reduced motion: the right answer there is one
      // animation off rather than the other one on.
      root.setAttribute(MOTION_ATTRIBUTE, 'on');
      // And on the mat itself, which is where the sheet's guard looks. The root
      // is an ancestor of it rather than the mat (`./geometry.ts`'s
      // `MAT_SELECTOR` says why), so marking only the root left the older
      // arrival running underneath this one.
      root.querySelector(MAT_SELECTOR)?.setAttribute(MOTION_ATTRIBUTE, 'on');
      // The first commit is the whole board appearing, which is a page load and
      // not an event. Nothing animates until there is a previous board to have
      // moved from.
      if (before === null || plan.cues.length === 0) return;
      for (const cue of movesByObject(plan.cues)) {
        const was = before.get(cue.oid);
        const is = current.get(cue.oid);
        if (is !== undefined && was !== undefined) {
          if (moved(was.rect, is.rect)) playMove(cue, was.rect, is);
          continue;
        }
        if (is !== undefined) {
          playArrival(root, cue, is);
          continue;
        }
        if (was !== undefined) playDeparture(root, cue, was);
      }
      for (const cue of plan.cues) {
        if (cue.kind === 'mark') playMark(cue, current.get(cue.oid));
      }
    },
    cut: stopAll,
    reset: (): void => {
      stopAll();
      previous = null;
    },
  };
}

/**
 * `node` as something this runner can measure and query, or null when it is not.
 *
 * The same structural narrowing `../routes/play/focus.ts` uses on a focusable
 * node, and for the same reason: React hands a ref `unknown` as far as this
 * package's tsconfig is concerned, and a cast that asserts rather than checks
 * would turn a server render into a crash instead of into nothing happening.
 */
export function asMotionRoot(node: unknown): MotionRoot | null {
  if (typeof node !== 'object' || node === null) return null;
  const partial = node as Partial<MotionRoot>;
  return typeof partial.querySelectorAll === 'function' &&
    typeof partial.getBoundingClientRect === 'function' &&
    typeof partial.appendChild === 'function'
    ? (node as MotionRoot)
    : null;
}
