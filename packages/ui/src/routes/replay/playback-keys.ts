/**
 * Space plays and pauses; the arrow keys step.
 *
 * A replay is watched with one hand, so the transport's five buttons and two
 * selects are not the only way to reach it. The bindings are the ones every
 * media surface and every debugger already trained the reader on: Space toggles
 * playback, Right steps forward, Left steps back.
 *
 * Bound on the document rather than on the view's own `onKeyDown`, for
 * `pass-key.ts`'s reason one route over: pressing a transport button leaves the
 * focus ring on a control that the next render may disable — `Play` becomes
 * `Pause`, `Next` disables at the last frame — and a shortcut that stops working
 * after the first press is not one.
 *
 * It refuses to fire from inside a control, which is not politeness either. The
 * browser already activates a focused button on Space and already moves a
 * focused select with the arrows, so firing as well would toggle playback for a
 * press aimed at the speed picker. Stepping is a step whether or not playback is
 * running, and the caller decides that a manual step pauses; nothing about
 * playback state reaches this file.
 *
 * The workspace tsconfig carries no `lib: dom`, so the two DOM facts this needs
 * are declared structurally and checked at runtime — which also makes the hook a
 * no-op wherever there is no document.
 */
import { useEffect } from 'react';

/** The parts of a keyboard event this needs, and nothing else. */
interface KeyPress {
  readonly key: string;
  readonly repeat?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly target?: unknown;
  preventDefault?: () => void;
}

interface KeyHost {
  addEventListener(type: 'keydown', handler: (event: KeyPress) => void): void;
  removeEventListener(type: 'keydown', handler: (event: KeyPress) => void): void;
}

/** Elements that answer these keys themselves; a shortcut must not double them. */
const CONTROLS: readonly string[] = [
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'A',
  'SUMMARY',
  'DETAILS',
  'OPTION',
];

function keyHost(): KeyHost | null {
  const host = globalThis as { readonly document?: unknown };
  const document = host.document;
  if (typeof document !== 'object' || document === null) return null;
  const partial = document as Partial<KeyHost>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  return document as KeyHost;
}

function insideControl(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const tag = (target as { readonly tagName?: unknown }).tagName;
  if (typeof tag === 'string' && CONTROLS.includes(tag.toUpperCase())) return true;
  const editable = (target as { readonly isContentEditable?: unknown }).isContentEditable;
  return editable === true;
}

export interface PlaybackKeysInput {
  /** Space: start playback, or stop it. */
  readonly onTogglePlay: () => void;
  /** An arrow key: `+1` for Right, `-1` for Left. */
  readonly onStep: (delta: number) => void;
}

/** Binds Space and the arrow keys for the replay transport. */
export function usePlaybackKeys(input: PlaybackKeysInput): void {
  const { onTogglePlay, onStep } = input;
  useEffect((): (() => void) | undefined => {
    const host = keyHost();
    if (host === null) return undefined;
    const onKeyDown = (event: KeyPress): void => {
      if (event.altKey === true || event.ctrlKey === true || event.metaKey === true) return;
      if (insideControl(event.target)) return;
      if (event.key === ' ') {
        if (event.repeat === true) return;
        // Space scrolls the page otherwise, which moves the board out from
        // under the person who just started playback.
        event.preventDefault?.();
        onTogglePlay();
        return;
      }
      // An arrow key repeats deliberately: held down, it scrubs.
      if (event.key === 'ArrowRight') {
        event.preventDefault?.();
        onStep(1);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault?.();
        onStep(-1);
      }
    };
    host.addEventListener('keydown', onKeyDown);
    return (): void => {
      host.removeEventListener('keydown', onKeyDown);
    };
  }, [onTogglePlay, onStep]);
}
