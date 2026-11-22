/**
 * How a draft screen's width is shared between the workspace and the rail.
 *
 * `mtg-veun`. `../../styles/panel.ts` lays `.mtg-work` out as a workspace of
 * `minmax(0, 1fr)` beside a rail of `RAIL_REM`, and that constant is one guess
 * made once for every screen and every moment of a draft. 17rem is right for the
 * card face the rail exists to draw and wide for the pick list under it, and on
 * a 1024px desk it is a sixth of the width a player cannot reclaim. The same
 * offer `../deck/builder-split.ts` makes between a pool and a deck, on the seam
 * that runs the other way.
 *
 * Not the rail's own collapse toggle (`../play/rail-collapse.ts`), which the
 * board and the replay have and which costs no grid column: that control is
 * all-or-nothing, and a rail that is merely *wide* is not a rail anybody wants
 * gone. The draft's rail has that control too now, and the two do not overlap:
 * a shut rail is a strip with no seam to drag, so `./DraftPack.ts` draws the
 * handle only while the rail is open, and the commit the rail's foot holds
 * moves under the pack rather than going with it.
 *
 * # It sizes the rail, and the share is the complement
 *
 * `../../panel/SplitHandle.ts` reports where the pointer is as a share of the
 * container, so the number that arrives here is the *workspace's* share. What
 * gets written is the rail's track, which is one minus it.
 *
 * That is the way round for two reasons, and the second is the load-bearing one.
 * The workspace stays `minmax(0, 1fr)` and takes whatever the rail leaves, which
 * is what a track holding a pack of fifteen faces wants to be. And `--split-a`
 * is already spoken for on this subtree: `.mtg-work__main` carries it for the
 * pack-over-pool divider inside the workspace, custom properties inherit, and a
 * rail share written as `--split-a` on `.mtg-work` would arrive at
 * `.mtg-draft .mtg-work__scroll`'s `flex: 0 1 var(--split-a, auto)` as the
 * pack's height. This bead is the one that puts two dividers on one screen, so
 * that collision is the new state of the file rather than a hypothetical.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { SplitHandle } from '../../panel/SplitHandle';
import { splitStyle, useSplit } from '../../panel/split';
import type { SplitFloors, SplitState } from '../../panel/split';
import { STRIP_REGION_SCROLLBAR_PX } from '../../styles/stack-box';

/** Where this split is kept. One rail, one seam, one key. */
export const RAIL_SPLIT_NAME = 'draft.rail';

/**
 * What the stylesheet's own arrangement is worth, announced and never drawn.
 *
 * A share cannot be read off the sheet here the way `../deck/builder-split.ts`
 * reads one off a pair of `fr` units, because the rail's default is a *length*:
 * 17rem of a 1392px workspace is 0.80 and 17rem of a 976px one is 0.71, and
 * there is no width at which one number is the sheet's answer. So this is the
 * measured share at the desk every other measurement in this lane was taken at,
 * 1440x900, and it is used for `aria-valuenow` and the arrow keys' starting
 * point and for nothing that draws. The first drag replaces it with a number
 * that came from the layout.
 */
export const RAIL_DEFAULT_SHARE = 0.8;

/**
 * The least each side may be drawn at, as CSS lengths.
 *
 * A grid track sized to a percentage does not grow for what is in it
 * (`../../panel/split.ts`), so these are clamped into the value rather than left
 * to a `min-inline-size` the way the draft's flexed panes leave theirs. They are
 * the stylesheet's backstop rather than the handle's limit -- a stored share
 * outlives the build that wrote it, and `DEFAULT_SPLIT_LIMITS` at this rig's
 * reference desk would hand the rail 212px, which is under its floor. So the
 * clamp is what actually stops the drag on this seam, not the limits.
 *
 * **The rail: 16rem.** Its one job is the card being read, drawn at
 * `data-size='full'` with `--card-w: 100%`, and `../../styles/panel.ts` pins
 * that face's `--rules-type` to the `--mtg-text-sm` token rather than letting it
 * scale with the face -- for a good reason, since a share of a percentage is a
 * percentage of the parent font size. The consequence is that a narrowing rail
 * does not shrink the rules text, it runs out of room for it, and
 * `[data-region='rules']` is `overflow-y: clip`. Measured over the twelve
 * `EXAMPLE_CARDS` faces at this root size: all twelve draw whole at 16rem, one
 * loses the end of its rules text at 15rem, five at 13rem, and the card *name*
 * starts clipping at 12rem. So the floor is the widest measured rail that lost
 * nothing, and it sits close under the 17rem default on purpose. This seam
 * mostly makes the rail *wider*, which is the direction somebody reading a card
 * wants; the room below the default is a rem, because that is all the card face
 * has.
 *
 * **The workspace: two pack columns.** `.mtg-draft .mtg-thumbs` floors a track
 * at 8.5rem, and one column is the fifteen-row scroll `mtg-rgc.18` measured and
 * fixed. Two columns, the gap between them, the scroll box's padding on both
 * sides and its border -- and the vertical scrollbar that box grows, the same 15
 * pixels `../deck/strips.ts` measured, which is the term that makes this a
 * measurement rather than a sum: without it the floor is 298px, and 298px drew
 * a single 265px column, which is the exact failure the floor is here to
 * prevent.
 *
 * The workspace also carries the gutter, because the clamp sizes the *rail* out
 * of the container's whole width and the divider's track sits inside that whole.
 * `BUILDER_SPLIT_FLOORS` states the same correction on the other seam.
 */
export const RAIL_SPLIT_FLOORS: SplitFloors = {
  first: '16rem',
  second: `calc(8.5rem * 2 + var(--mtg-space-2) * 3 + 2px + ${String(STRIP_REGION_SCROLLBAR_PX)}px + var(--mtg-space-3))`,
};

/**
 * The rail's inline track, once a person has dragged the divider.
 *
 * `undefined` when nothing has been dragged, so `.mtg-work` carries no style
 * attribute and the track is `../../styles/panel.ts`'s `RAIL_REM` exactly as it
 * was before this file existed.
 */
export function railSplitStyle(share: number | null): Readonly<Record<string, string>> | undefined {
  return splitStyle('--split-b', share === null ? null : 1 - share, RAIL_SPLIT_FLOORS);
}

/** This screen's workspace-beside-rail share. */
export function useRailSplit(): SplitState {
  return useSplit(RAIL_SPLIT_NAME);
}

/**
 * The divider, between the workspace and the rail.
 *
 * Placed by the grid's own order: `.mtg-work` lays its three tracks out in the
 * order its children are written, so this goes after the workspace and before
 * the rail and needs no named area. It is `display: none` at every size where
 * the rail is stacked under the workspace instead of beside it, since there is
 * no shared width to divide there.
 */
export function railSplitHandle(split: SplitState): ReactElement {
  return createElement(SplitHandle, {
    label: 'the workspace and the rail',
    orientation: 'vertical',
    share: split.share,
    defaultShare: RAIL_DEFAULT_SHARE,
    onShare: split.setShare,
  });
}
