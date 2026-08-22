/**
 * The two surfaces the motion layer draws: the plane a traveling card is drawn
 * on, and the highlight a permanent wears when something happens to it in place.
 *
 * `../../motion/runner.ts` decides *when* either appears and never decides what
 * either looks like. That split is this package's oldest rule — `../tokens.ts`
 * is the only file where a color is chosen, and a runner that assembled a
 * keyframe would either hard-code one or interpolate a custom property the Web
 * Animations API does not interpolate.
 *
 * **Both are outside layout.** The layer is `position: fixed`, so nothing it
 * holds can reflow the table underneath it; the mark is a `box-shadow`, which
 * paints outside the border box without taking any space. `./slot.ts` pairs
 * `aspect-ratio` with `min-height: 0` to make every face on the board one
 * height, and `./arrival.ts` records what happens to that pair the moment an
 * animation touches a length.
 *
 * **Under `prefers-reduced-motion: reduce` the marks do not run.** The plan is
 * already empty under that query (`../../motion/reduced-motion.ts`), so no
 * attribute is ever set and this block is the belt to that suspenders: a
 * stylesheet may not depend on a script having run. `../base.ts` clamps every
 * animation on the page to 1ms under the same query, and 1ms of a highlight is a
 * single frame of colored ring — a flash, which is the thing a viewer asking for
 * less motion is asking not to get. So it is `animation: none`, the same answer
 * `./arrival.ts` gives for the same reason.
 */
import { cssNumber } from '../number';
import { MARK_FAST_MS, MARK_MS } from '../../motion/timing';

/**
 * How wide the ring around a marked permanent is, in pixels.
 *
 * Three device pixels rather than a share of the card, unlike the identity frame
 * `../../card/anatomy.ts` sizes: this is chrome laid over a card rather than
 * part of the printed face, and it has to be equally visible on a 56px land tile
 * and a 136px board face. It is a shadow, so no width of it can move a box.
 */
const MARK_RING_PX = 3;

/**
 * The layer, and why it is a child of the play surface rather than of `<body>`.
 *
 * A ghost is `position: fixed`, which is measured against the viewport unless an
 * ancestor is a containing block for it — a transform, a filter or layout
 * containment. Nothing between the play root and here declares one, for the
 * reason `../../board/CardSlot.ts` gives about the hover zoom: that panel is
 * fixed for the same reason and would break the same way. Keeping the layer
 * inside the route also means it goes when the route goes.
 *
 * `pointer-events: none` on the plane and everything in it: a card in flight is
 * a picture of something that already happened, and a click landing on it would
 * be a click that missed the board.
 */
const LAYER = `
[data-motion='layer'] {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}
[data-motion='ghost'] {
  position: fixed;
  pointer-events: none;
  will-change: transform, opacity;
}
[data-motion='ghost'] > .mtg-slot {
  width: 100%;
  height: 100%;
  margin: 0;
}
`;

/**
 * The mark: a ring that rises and falls, in the color of what happened.
 *
 * Four kinds, four tokens already on the palette, and each one is the color that
 * surface already uses for that meaning — damage is `--mtg-negative` because
 * that is the tone the life total drops in, a counter is `--mtg-positive`, a
 * trigger naming a permanent is `--mtg-accent` because accent is this product's
 * selection color and being targeted is being singled out, and a tap is
 * `--mtg-ink-faint` because it is the one that must not shout.
 *
 * One keyframe set for all four, with the color handed in as a custom property
 * the rule sets, so the timing and the shape of the beat cannot drift between
 * kinds.
 */
const MARK = `
@keyframes mtg-motion-mark {
  from { box-shadow: 0 0 0 0 transparent; }
  50% { box-shadow: 0 0 0 ${cssNumber(MARK_RING_PX)}px var(--motion-mark); }
  to { box-shadow: 0 0 0 0 transparent; }
}
.mtg-slot[data-motion-mark] > .mtg-card {
  animation: mtg-motion-mark ${cssNumber(MARK_MS)}ms var(--mtg-ease);
  border-radius: var(--mtg-radius-card);
}
.mtg-slot[data-motion-mark='damage'] > .mtg-card { --motion-mark: var(--mtg-negative); }
.mtg-slot[data-motion-mark='counter'] > .mtg-card { --motion-mark: var(--mtg-positive); }
.mtg-slot[data-motion-mark='target'] > .mtg-card { --motion-mark: var(--mtg-accent); }
.mtg-slot[data-motion-mark='tap'] > .mtg-card {
  --motion-mark: var(--mtg-ink-faint);
  animation-duration: ${cssNumber(MARK_FAST_MS)}ms;
}
@media (prefers-reduced-motion: reduce) {
  .mtg-slot[data-motion-mark] > .mtg-card {
    animation: none;
  }
}
`;

export const MOTION_CSS = `${LAYER}${MARK}`;
