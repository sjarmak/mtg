/**
 * The motion layer: an animation is a rendering of an event, so this package
 * reads the kernel's event stream and nothing else.
 *
 * `./plan.ts` holds the reasoning, `./timing.ts` every number it spends, and
 * `./pace.ts` the one multiplier a player can put over all of them.
 */
export { motionPlan } from './plan';
export type { MarkCue, MotionCue, MotionMark, MotionPlan, MotionSeat, MoveCue } from './plan';
export { useBoardMotion } from './use-board-motion';
export type { BoardMotion, BoardMotionInput } from './use-board-motion';
export { asMotionRoot, createMotionRunner, MARK_ATTRIBUTE, MOTION_ATTRIBUTE } from './runner';
export type { MotionNode, MotionRoot, MotionRunner } from './runner';
export { prefersReducedMotion, REDUCED_MOTION_QUERY, watchReducedMotion } from './reduced-motion';
export {
  DEFAULT_PACE,
  isPace,
  nextPace,
  PACE_ATTRIBUTE,
  PACE_VAR,
  PACE_WORDS,
  PACES,
  paceCss,
  paced,
  paceScale,
} from './pace';
export type { Pace } from './pace';
export {
  BEAT_GAP_MS,
  ECHO_GAP_MS,
  MARK_FAST_MS,
  MARK_MS,
  MOTION_BUDGET_MS,
  MOVE_EASING,
  MOVE_MS,
} from './timing';
