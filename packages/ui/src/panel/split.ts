/**
 * Where a workspace divides, when the person using it has said.
 *
 * `mtg-rgc.19`. the playtester, 2026-08-29: "the different panes should be
 * resizable". Every split in the lab is a constant today -- the draft pack takes
 * what its faces need and the drafted pool takes the rest, the rail is
 * `RAIL_REM`, the builder's workbench is two parts pool to three parts deck --
 * and all three are the same guess made once for every player and every moment
 * of a draft. A player reading a pack wants the pack; the same player counting
 * their curve at pick eleven wants the pool. MTGO's splits are all draggable for
 * that reason and this is the same offer.
 *
 * # A share, not a length
 *
 * What is stored is a fraction of the container, so a split survives a window
 * that changes size: a pack given 380 of 900 pixels is given the same *half* of
 * a 1200px window rather than the same 380px of it, which is what a person who
 * dragged it there meant. It is also what makes the value portable between the
 * three consumers, one of which divides a width and two a height.
 *
 * The share is written into one CSS custom property on the container and read by
 * whichever rule already sized that pane -- `flex-basis` on the draft pack, a
 * grid track on the builder and the rail. That is deliberate: the *default*
 * arrangement stays in the stylesheet where it was argued, the property is unset
 * until somebody drags something, and `var(--split-a, auto)` falls back to
 * exactly the layout this repository already measured. Nothing about the first
 * visit changes.
 *
 * # What clamps it
 *
 * Both ends, twice, and neither is redundant. The stylesheet holds the real
 * floors -- the drafted pool's column floor, the pack's own row floor -- as
 * `min-block-size`, so a share that would starve a pane is refused by the layout
 * whatever this file thinks. The limits here are the softer question of what a
 * *handle* may be dragged to: a pane dragged to nothing leaves a person holding
 * a divider with no way to see what they just did, so the handle stops while
 * there is still a pane on both sides of it. A stored share is clamped on read
 * for the same reason, because a store outlives the build that wrote it.
 *
 * # Why it is view state
 *
 * The same argument `../routes/play/rail-collapse.ts` made about the panel and
 * `../routes/deck/view-mode.ts` made about density: a split is not a move, it
 * enters no artifact, and the kernel cannot see it. So it is held by the view
 * and written to `localStorage`, and a store that cannot be read or written
 * leaves the surface drawing its default, which is the state a first visit is
 * in. The accessor is `../routes/deck/local-store.ts`, which is where this
 * package's three preference readers already share one.
 */
import { useCallback, useState } from 'react';
import { readStored, writeStored } from '../routes/deck/local-store';

/** How far a pane may be dragged: a share of the container, at both ends. */
export interface SplitLimits {
  readonly min: number;
  readonly max: number;
}

/**
 * How far one arrow press moves a divider.
 *
 * Two percent, which is about 18px of a 900px window: small enough that holding
 * the key is a smooth adjustment rather than a series of jumps, large enough
 * that one press does something visible. A keyboard divider that moves by a
 * pixel is a control nobody can use.
 */
export const SPLIT_STEP = 0.02;

/**
 * What a stored share says when the answer is "nothing, use the stylesheet's".
 *
 * A word rather than an absent key, because `../routes/deck/local-store.ts`
 * offers a read and a write and no remove -- and because a share of zero is a
 * legitimate-looking number that means something quite different.
 */
export const SPLIT_UNSET = 'auto';

/** The limits every consumer uses unless it has a reason of its own. */
export const DEFAULT_SPLIT_LIMITS: SplitLimits = { min: 0.15, max: 0.85 };

/** A share held to its limits. Callers pass finite numbers; storage validates. */
export function clampShare(share: number, limits: SplitLimits = DEFAULT_SPLIT_LIMITS): number {
  return Math.min(limits.max, Math.max(limits.min, share));
}

/** The container a divider divides, along the one axis it moves on. */
export interface SplitBox {
  readonly start: number;
  readonly extent: number;
}

/**
 * Where a pointer is, as a share of the box it is in.
 *
 * Null for a box with no extent, which is a container that has not been laid out
 * yet: dividing by it would hand back an infinity that the clamp would then
 * dutifully turn into a legitimate-looking share.
 */
export function shareIn(box: SplitBox, position: number): number | null {
  if (!(box.extent > 0)) return null;
  return (position - box.start) / box.extent;
}

/**
 * Where an arrow key moves the divider from, given where it is.
 *
 * `null` means this key is not one of ours and the event is left alone. Home
 * gives the split back to the stylesheet rather than moving it to a limit, which
 * is `mtg-rgc.19`'s own wording ("Home restores the default") and the more
 * useful of the two: a person who has lost track of what they dragged wants the
 * arrangement the page shipped with, and the two limits are reachable by holding
 * an arrow down.
 */
export function nudged(
  current: number,
  key: string,
  limits: SplitLimits = DEFAULT_SPLIT_LIMITS,
): number | null {
  if (key === 'ArrowUp' || key === 'ArrowLeft') return clampShare(current - SPLIT_STEP, limits);
  if (key === 'ArrowDown' || key === 'ArrowRight') return clampShare(current + SPLIT_STEP, limits);
  return null;
}

/** Whether a key hands the split back to the stylesheet. */
export function restoresDefault(key: string): boolean {
  return key === 'Home';
}

/** Where a surface's split is kept, namespaced so two surfaces cannot collide. */
export function splitStoreKey(name: string): string {
  return `mtg.split.${name}`;
}

/**
 * The stored share for one split, or null for none.
 *
 * A value that is not a number in range is treated as nothing stored rather than
 * as an error: the only ways to get one are a hand-edited store or a build that
 * kept something else under this key, and in both cases the honest answer is the
 * arrangement a first visit sees.
 */
export function readSplitShare(name: string, limits: SplitLimits = DEFAULT_SPLIT_LIMITS): number | null {
  const found = readStored(splitStoreKey(name));
  if (found === null || found === SPLIT_UNSET) return null;
  const parsed = Number.parseFloat(found);
  if (!Number.isFinite(parsed)) return null;
  return clampShare(parsed, limits);
}

/**
 * Keeps a share, or the fact that there is none.
 *
 * The report is dropped for the reason every other preference in this package
 * drops it: a page in a private window refuses the write, the split still moves,
 * and it forgets across a reload -- which is the behavior of a first visit.
 */
export function writeSplitShare(name: string, share: number | null): void {
  writeStored(splitStoreKey(name), share === null ? SPLIT_UNSET : share.toFixed(4));
}

export interface SplitState {
  /** The share this split is at, or null while the stylesheet still decides. */
  readonly share: number | null;
  readonly setShare: (share: number | null) => void;
}

/**
 * One split's share, read from the store on first render and written back on
 * every change.
 *
 * The initializer is a function so the read happens once per mount, and `name`
 * is closed over rather than watched, for the reasons `view-mode.ts` gives about
 * a pane: a split's identity is which two panes it is between, and that does not
 * change under it.
 */
export function useSplit(name: string, limits: SplitLimits = DEFAULT_SPLIT_LIMITS): SplitState {
  const [share, keep] = useState<number | null>(() => readSplitShare(name, limits));
  const setShare = useCallback(
    (next: number | null): void => {
      const held = next === null ? null : clampShare(next, limits);
      writeSplitShare(name, held);
      keep(held);
    },
    [name, limits],
  );
  return { share, setShare };
}

/**
 * The custom property a container carries, as a style object or nothing at all.
 *
 * Nothing, rather than a property set to `auto`, so an undragged surface renders
 * the markup it rendered before this file existed -- which keeps the whole
 * feature out of the way of every snapshot and every gate that reads the DOM of
 * a first visit.
 */
export function splitStyle(
  property: string,
  share: number | null,
  floors?: SplitFloors,
): Readonly<Record<string, string>> | undefined {
  if (share === null) return undefined;
  const at = `${(share * 100).toFixed(2)}%`;
  if (floors === undefined) return { [property]: at };
  return { [property]: `clamp(${floors.first}, ${at}, calc(100% - ${floors.second}))` };
}

/**
 * The least each pane may be given, as CSS lengths, for a container that will
 * not enforce it on its own.
 *
 * A flex container does: an item's `min-block-size` beats the basis it was
 * given, and its sibling's beats the room the first one wanted, so the draft's
 * pack and pool hold each other apart with the floors they already had. A
 * **grid track** sized to a percentage does not -- the item overflows the track
 * and lands on whatever is under it -- so the builder's workbench states its
 * floors here and the share is clamped between them in the value itself.
 *
 * When the container is too short to honor both, `clamp` returns its minimum:
 * the first pane keeps its floor and the second scrolls, which is the same
 * answer this stylesheet gives everywhere else a frame runs out of room.
 */
export interface SplitFloors {
  readonly first: string;
  readonly second: string;
}
