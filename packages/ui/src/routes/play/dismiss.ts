/**
 * A panel drawn over the board needs a way out that is not "find the control
 * that opened it".
 *
 * `mtg-5jl`, observed in a browser on 2026-08-13: the stops panel was opened
 * from the turn badge, and thirty clicks later it was still covering the
 * opponent's life total, zone counts and first permanent slot. The panel did
 * have two exits — the badge is a toggle, and `TurnStops.ts` caught Escape on
 * its own element — and neither one was reachable from where the player was.
 * The badge reads as a status label rather than a control, and the Escape
 * handler was on an element the ring leaves the moment you click the board, so
 * the key stopped arriving at exactly the point the panel became a nuisance.
 *
 * So the two dismissals that do not depend on where the ring is sitting live
 * here, bound on the document while the panel is open:
 *
 *  - **Escape**, from anywhere, and it says which way it was dismissed so the
 *    caller can hand the ring back to the control that opened the panel.
 *  - **A pointer press outside**, which is what a player means by clicking the
 *    thing the panel is covering. This one moves no focus: the press is already
 *    on its way to whatever it landed on, and stealing the ring back mid-gesture
 *    would fight the click that follows it. A caller whose panel is drawn over a
 *    surface that is *part of answering the panel* turns it off with `outside`,
 *    and `DismissInput` says why that case exists.
 *
 * Bubble phase rather than capture, which is what keeps this from outranking the
 * handlers already on the route. React attaches its own listeners at the root
 * container, so a synthetic handler that stops propagation — `PlayView`'s
 * Escape, which closes an open picker — stops the native event before it reaches
 * the document and this never sees the press. An open picker therefore still
 * answers the key it was already answering, and the second Escape closes the
 * panel behind it.
 *
 * The workspace tsconfig has no `lib: dom` (`../../mount.ts` writes out why), so
 * the three DOM facts this needs are declared structurally and checked at
 * runtime, and the hook is a no-op wherever there is no document.
 */
import { useEffect, useRef } from 'react';
import { asContainer } from './focus';
import type { ContainerNode } from './focus';

/** Which way the panel was dismissed, which is the whole of what a caller needs. */
export type DismissVia = 'escape' | 'outside';

/** The parts of the two events this reads, and nothing else. */
interface DismissEvent {
  readonly key?: string;
  readonly target?: unknown;
}

interface DismissHost {
  addEventListener(type: 'keydown' | 'pointerdown', handler: (event: DismissEvent) => void): void;
  removeEventListener(type: 'keydown' | 'pointerdown', handler: (event: DismissEvent) => void): void;
}

function dismissHost(): DismissHost | null {
  const host = globalThis as { readonly document?: unknown };
  const document = host.document;
  if (typeof document !== 'object' || document === null) return null;
  const partial = document as Partial<DismissHost>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  return document as DismissHost;
}

export interface DismissInput {
  /** Bound only while this is true; a closed panel listens to nothing. */
  readonly open: boolean;
  /**
   * The element the panel and the control that opens it both live in. A press
   * inside it is not an outside press — the opener's own toggle is the exit it
   * always had, and it must not be closed twice by one gesture.
   */
  readonly within: () => ContainerNode | null;
  /**
   * Whether a pointer press outside `within` dismisses. Defaults to true, which
   * is what a panel covering a static board wants.
   *
   * `./ask-flyout.ts` passes false, and the reason generalizes: the outside
   * press is a dismissal only where the thing under the panel is not part of
   * answering it. The ask flyout is drawn over a live board while the game is
   * waiting on this seat, and aiming a spell, staging an attacker and assigning
   * a blocker are all presses on cards outside the box that the box itself then
   * answers — so an outside press there is the player using the panel, and
   * closing on it would take the panel away at the moment it started working.
   */
  readonly outside?: boolean;
  readonly onDismiss: (via: DismissVia) => void;
}

export function useDismissable(input: DismissInput): void {
  // The latest callbacks, so the listeners are bound once per opening rather
  // than once per render. Written in an effect rather than during the render
  // that produced them, because a render React discards must not be able to
  // leave a stale closure behind.
  const latest = useRef(input);
  useEffect((): void => {
    latest.current = input;
  });

  useEffect((): (() => void) | undefined => {
    if (!input.open) return undefined;
    const host = dismissHost();
    if (host === null) return undefined;

    const onKeyDown = (event: DismissEvent): void => {
      if (event.key !== 'Escape') return;
      latest.current.onDismiss('escape');
    };
    const onPointerDown = (event: DismissEvent): void => {
      if (latest.current.outside === false) return;
      const root = asContainer(latest.current.within());
      // No container is not an excuse to close: a panel that dismissed itself on
      // every press because it could not find its own root would be worse than
      // the panel that never dismissed at all.
      if (root === null || root.contains(event.target)) return;
      latest.current.onDismiss('outside');
    };

    host.addEventListener('keydown', onKeyDown);
    host.addEventListener('pointerdown', onPointerDown);
    return (): void => {
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('pointerdown', onPointerDown);
    };
  }, [input.open]);
}
