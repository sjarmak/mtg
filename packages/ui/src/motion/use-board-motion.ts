/**
 * The seam between a rendered table and the motion layer: one hook, one ref.
 *
 * A caller attaches the ref to whatever element contains the board and passes
 * the session's event array. Everything else — what moved, in which order, for
 * how long, and whether the viewer wants any of it — is decided by `./plan.ts`
 * and played by `./runner.ts`.
 *
 * **The batch is the events appended since the last commit.** That is the whole
 * of the bookkeeping, and it is why the layer needs no diff of the board and no
 * view state per card: React has already committed the new table, the events say
 * what the kernel did to get there, and the two are matched by object id. A game
 * that restarts hands back a shorter array, which yields an empty batch rather
 * than replaying an opening hand as thirty flying cards.
 *
 * **It holds nothing the game can see.** No `choices` entry, no `GameState`
 * field, nothing `stateFingerprint` or `replaySession` can reach — the rule
 * `@mtg/kernel`'s `beats.ts` states for the combat pauses. Two players watching
 * the same recorded game with different motion preferences see the same game.
 *
 * The layout effect runs on every commit rather than on a dependency list. The
 * thing it has to notice is that a box moved, and a box moves for reasons no
 * dependency array can name: a viewport resize, a rail collapsing, a font
 * loading, a neighbor arriving and re-fitting the row. The work on a commit with
 * no new events is one `querySelectorAll` and one rect per card, which is the
 * price of a layer that is never wrong about where a card was.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameEvent, PlayerId } from '@mtg/kernel';
import { motionPlan } from './plan';
import { asMotionRoot, createMotionRunner } from './runner';
import type { MotionRoot, MotionRunner } from './runner';
import { prefersReducedMotion, watchReducedMotion } from './reduced-motion';

export interface BoardMotionInput {
  readonly events: readonly GameEvent[];
  readonly viewer: PlayerId;
}

export interface BoardMotion {
  /** Attach to the element the board is drawn inside. */
  readonly ref: (node: unknown) => void;
  /**
   * Whether this viewer has asked for reduced motion, as the media query
   * currently answers it.
   *
   * Reported rather than kept private because a surface can owe the player
   * something that the motion was going to deliver. A beat drawn as movement
   * (`../routes/play/beat-motion.ts`) offers its acknowledgment *during* the
   * movement; under `prefers-reduced-motion: reduce` `./plan.ts` returns an
   * empty plan, so there is no movement for it to be during, and a surface that
   * did not ask would hand a reduced-motion player a pause with nothing to press.
   */
  readonly reduced: boolean;
  /**
   * End whatever is playing, keeping the board and the snapshot of it.
   *
   * `MotionRunner.cut` with the hook's runner supplied; stable for the life of
   * the component, so it can sit in a dependency list.
   */
  readonly cut: () => void;
}

/**
 * A layout effect on the client, a plain effect on a server render.
 *
 * `renderToStaticMarkup` runs no effect of either kind, but React warns about a
 * layout effect it cannot run, and a warning printed by the play surface on
 * every server-rendered test page is noise that trains a reader to skip warnings.
 */
const useCommit =
  (globalThis as { readonly document?: unknown }).document === undefined ? useEffect : useLayoutEffect;

export function useBoardMotion(input: BoardMotionInput): BoardMotion {
  const root = useRef<MotionRoot | null>(null);
  const runner = useRef<MotionRunner | null>(null);
  const seen = useRef(0);
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect((): (() => void) => watchReducedMotion(setReduced), []);

  useCommit((): void => {
    const node = root.current;
    if (node === null) return;
    const events = input.events;
    const fresh = events.slice(Math.min(seen.current, events.length));
    seen.current = events.length;
    const live = runner.current ?? createMotionRunner();
    runner.current = live;
    live.sync(node, motionPlan(fresh, { viewer: input.viewer, reduced }));
  });

  useEffect(
    () => (): void => {
      runner.current?.reset();
      runner.current = null;
    },
    [],
  );

  /*
   * One function for the life of the component, and that is load-bearing rather
   * than tidy.
   *
   * React detaches and re-attaches a callback ref whose identity changed: it
   * calls the old one with `null` and the new one with the node, before every
   * commit's layout effects. A ref rebuilt on each render therefore fired the
   * teardown below on every render of a live game, which dropped the snapshot of
   * where each card was — so `sync` found no previous board, took its
   * first-commit path, and animated nothing, for the whole game. Measured in
   * chrome against `npm run play` on 2026-08-17: playing a land moved the card
   * from hand to battlefield with `Element.animate` never called once.
   *
   * With a stable identity, a `null` here means what the teardown assumes it
   * means: the element is going away.
   */
  const ref = useCallback((node: unknown): void => {
    const next = asMotionRoot(node);
    // Unmounting, or a ref handed something that cannot be measured. Either
    // way the snapshot describes a board that is gone, and a snapshot of a
    // gone board would make the next commit look like thirty departures.
    if (next === null) runner.current?.reset();
    root.current = next;
  }, []);

  /* Stable for the same reason `ref` is: it goes in a dependency list. */
  const cut = useCallback((): void => {
    runner.current?.cut();
  }, []);

  return { ref, reduced, cut };
}
