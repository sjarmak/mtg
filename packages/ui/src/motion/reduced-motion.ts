/**
 * Whether the viewer has asked for less motion, read once and watched after.
 *
 * The hard requirement on this lane: `prefers-reduced-motion: reduce` turns all
 * of it off, and the game stays fully playable and readable without it. That is
 * cheap to honor here because nothing in the motion layer carries information —
 * every cue is a second rendering of something the board already draws and the
 * log already narrates, so an empty plan costs a player nothing but the pacing.
 *
 * Three places answer the query and they agree by construction. This one gates
 * the plan, so under reduce there are no cues and the runner never touches an
 * element. `../styles/board/motion.ts` turns off the sheet's own half — the mark
 * highlight and the ghost's fade — because a stylesheet must not depend on a
 * script having run. And `../styles/base.ts` already clamps every animation on
 * the page to 1ms, which is the backstop for anything either of them misses.
 *
 * It is watched rather than sampled once, because the setting is a system
 * preference a viewer can change while a game is open, and a game runs for an
 * hour.
 */

/** The query, written once so the sheet and the script cannot ask different things. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface MediaQueryLike {
  readonly matches: boolean;
  readonly addEventListener?: (type: 'change', listener: () => void) => void;
  readonly removeEventListener?: (type: 'change', listener: () => void) => void;
}

interface MediaHost {
  readonly matchMedia?: (query: string) => MediaQueryLike;
}

/**
 * The host's answer, or `false` where there is no host to ask.
 *
 * False rather than true on a server render or in a test environment with no
 * `matchMedia`: the plan is built again on the client, where the real answer
 * lives, and defaulting to "reduced" would mean a browser that never announces
 * the preference silently loses the feature.
 */
export function prefersReducedMotion(host: MediaHost = globalThis as MediaHost): boolean {
  return host.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

/**
 * Calls back whenever the preference changes, and returns the unsubscribe.
 *
 * A no-op unsubscribe when the host cannot be watched, so a caller never has to
 * ask whether it got a real subscription.
 */
export function watchReducedMotion(
  onChange: (reduced: boolean) => void,
  host: MediaHost = globalThis as MediaHost,
): () => void {
  const query = host.matchMedia?.(REDUCED_MOTION_QUERY);
  if (query?.addEventListener === undefined) return (): void => undefined;
  const listener = (): void => {
    onChange(query.matches);
  };
  query.addEventListener('change', listener);
  return (): void => {
    query.removeEventListener?.('change', listener);
  };
}
