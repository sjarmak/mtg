/**
 * How a builder's workbench is shared between the pool and the deck.
 *
 * `mtg-rgc.19`. Two builders draw this workbench -- `./ConstructedBuilder.ts`
 * and `../play/SealedBuilder.ts` -- from one stylesheet block and one set of
 * class names, so the divider between their panes is stated once here rather
 * than assembled twice from `../../panel/SplitHandle.ts`. What that file offers
 * is a control; what this file decides is which two panes it is between, what
 * the arrangement it replaces is worth, and where each builder's answer is kept.
 *
 * The share sizes the **pool**, which is the first row of the framed grid. A
 * separate key per builder, because a sealed pool and a Constructed collection
 * are different activities on different days: a person who wants the whole
 * screen for a sealed pool they are seeing for the first time is not asking for
 * the same split next time they open a Constructed deck they have been cutting
 * for a week.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { SplitHandle } from '../../panel/SplitHandle';
import { splitStyle } from '../../panel/split';
import { BUILDER_POOL_SHARE } from '../../styles/deck';
import { SPLIT_THICKNESS_PX } from '../../styles/panel';
import { useSplit } from '../../panel/split';
import type { SplitFloors, SplitState } from '../../panel/split';

/** Which builder's workbench this is, and therefore which stored share. */
export type BuilderKind = 'constructed' | 'sealed';

/**
 * What the stylesheet's own arrangement is worth, announced and never drawn.
 *
 * Read out of `../../styles/deck.ts` rather than typed here, because a handle
 * that snaps back to a share the sheet never drew is worse than no default at
 * all. That file gives the sealed builder's framed workbench two fifths of pool
 * against three of deck, and the pool's is the one this handle sizes.
 */
export const BUILDER_DEFAULT_SHARE = BUILDER_POOL_SHARE;

/**
 * The Constructed builder's, which divides the width rather than the height.
 *
 * `mtg-x6xq`: five fifths to three, the collection on the left. The two are
 * different numbers because they are shares of different things -- a pool you
 * are reading against a deck you are building, laid out along different axes --
 * and one constant serving both would be a coincidence rather than a decision.
 */
export const DECKBUILD_DEFAULT_SHARE = 0.625;

/**
 * The least either pane may be dragged to.
 *
 * 12rem is a pane's own chrome plus a card in it: `../../styles/deck.ts` puts a
 * pane's header and filters at about 180px, and a workbench where one side is
 * nothing but a header bar has stopped being a workbench. The grid needs this
 * stated because a percentage track does not grow for the item in it
 * (`../../panel/split.ts`).
 *
 * The two are not the same string, and the difference is the gutter. The clamp
 * sizes the *first* row out of the container's whole height, so what the second
 * pane is left is that height less the first row, less the divider, less the two
 * gaps around it. A floor that named 12rem for both measured the deck at 160px
 * on a 564px workbench while the clamp reported it had kept 192 -- the 32px of
 * gutter was subtracted from the pane rather than from the room the panes share.
 */
export const BUILDER_SPLIT_FLOORS: SplitFloors = {
  first: '12rem',
  second: `calc(12rem + var(--mtg-space-3) * 2 + ${String(SPLIT_THICKNESS_PX)}px)`,
};

/**
 * The workbench's inline tracks, once a person has dragged the divider.
 *
 * Both rows rather than the pool's alone. `../../styles/deck.ts` sizes the deck
 * pane to what it holds, so the pool is not squeezed by a deck that is not using
 * its share, and the tracks it does that with are the two this replaces. Writing
 * the deck's track here is what makes a dragged split beat that rule: an inline
 * custom property outranks a stylesheet, so somebody who has said how they want
 * this workbench shared keeps it whatever the deck happens to hold.
 *
 * `undefined` when nothing has been dragged, so the element carries no style
 * attribute at all and both tracks come from the stylesheet.
 */
export function builderSplitStyle(share: number | null): Readonly<Record<string, string>> | undefined {
  const pool = splitStyle('--split-a', share, BUILDER_SPLIT_FLOORS);
  return pool === undefined ? undefined : { ...pool, '--split-b': 'minmax(0, 3fr)' };
}

/**
 * Which axis a builder's divider runs along, and therefore which handle it is.
 *
 * The sealed workbench is stacked, so its divider is horizontal and dragging it
 * moves height; the Constructed one is side by side, so its divider is vertical
 * and dragging it moves width (`mtg-x6xq`). Both write `--split-a`, which is the
 * first track either way.
 */
export function builderSplitAxis(kind: BuilderKind): 'horizontal' | 'vertical' {
  return kind === 'constructed' ? 'vertical' : 'horizontal';
}

/** Where one builder's split is kept. */
export function builderSplitName(kind: BuilderKind): string {
  return `builder.${kind}`;
}

/** One builder's pool-over-deck share. */
export function useBuilderSplit(kind: BuilderKind): SplitState {
  return useSplit(builderSplitName(kind));
}

/**
 * The divider, placed by the grid rather than by where it is written.
 *
 * Last among the panes' children, because both builders draw the deck pane
 * first and `../../styles/deck.ts` puts the pool above it by named area for the
 * reason it records: below the frame gate the screen is a document and the deck
 * is what you came to read. The handle takes the `split` area between them and
 * is `display: none` at every size that has no frame to divide.
 */
export function builderSplitHandle(split: SplitState, kind: BuilderKind = 'sealed'): ReactElement {
  return createElement(SplitHandle, {
    label: 'the pool and the deck',
    orientation: builderSplitAxis(kind),
    share: split.share,
    defaultShare: kind === 'constructed' ? DECKBUILD_DEFAULT_SHARE : BUILDER_DEFAULT_SHARE,
    onShare: split.setShare,
  });
}
