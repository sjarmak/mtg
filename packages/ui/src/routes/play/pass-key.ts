/**
 * Space or Enter takes the pass.
 *
 * The cheapest half of `mtg-bc2.140`: the stop set removes the priorities the
 * player did not ask to be shown, and this makes the ones that are left cost a
 * keystroke instead of a mouse trip across the table to the rail. Both halves
 * are needed. A stop set answers the windows a player never wants; the key
 * answers the ones they do want and are looking at.
 *
 * On the document rather than on the table's own `onKeyDown`, which is the one
 * design decision here and it is forced. `PlayView` catches Escape on
 * `.mtg-play` because every focusable thing on the table is inside that element,
 * and that is exactly the property a pass key does not have: submitting a choice
 * unmounts the button that was pressed, so the focus ring falls to the document
 * body and the next keystroke has nothing inside the React tree to bubble
 * through. A shortcut that stops working after the first press is not one.
 *
 * The workspace tsconfig has no `lib: dom` (see `mount.ts`), so the two DOM
 * facts this needs are declared structurally and checked at runtime. That also
 * makes the hook a no-op wherever there is no document, which is what a
 * server-rendered table wants.
 *
 * **A combat pause takes the same key, and the caller decides that** (`mtg-rgc.2`).
 * While the game is halted on a beat the kernel has asked nothing, so there is
 * no pass to take and this hook would otherwise refuse every press and print the
 * note below at a player who has no decision in front of them. `PlayView` hands
 * the Continue in instead. It is the same gesture — "get on with it" — and
 * binding it to a second key would be asking a player to know which of two
 * silences they are looking at before they press anything. Nothing about a beat
 * reaches this file: it takes a function and does not ask what it does.
 *
 * **The other half of `mtg-s9p` is that a key which cannot fire says so.** The
 * hook used to bind nothing at all when the kernel enumerated no pass — a
 * mulligan, a blocker assignment, an ordering, a discard — so the same keystroke
 * that moves the game on every priority did nothing whatever on those, with the
 * only sign being a pass button drawn disabled somewhere else on the screen. It
 * now binds either way and reports the press it could not spend, which the
 * priority bar prints beside the pass and announces.
 */
import { useEffect, useState } from 'react';
import { LEGAL_MOVES_LABEL } from './rail';

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
const CONTROLS: readonly string[] = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY', 'DETAILS'];

function keyHost(): KeyHost | null {
  const host = globalThis as { readonly document?: unknown };
  const document = host.document;
  if (typeof document !== 'object' || document === null) return null;
  const partial = document as Partial<KeyHost>;
  if (typeof partial.addEventListener !== 'function') return null;
  if (typeof partial.removeEventListener !== 'function') return null;
  return document as KeyHost;
}

/**
 * Whether the press already belongs to something.
 *
 * The tag list is the first half and a declared `role` is the second
 * (`mtg-bz2.16`). A stack entry that a spell may be aimed at is a `role='button'`
 * on the row rather than a nested `button` element, because the strip spends
 * width and a second box on every legal row is what stops a deep stack fitting;
 * it answers Enter and Space itself, exactly as the tags above do. Without this
 * clause the same Enter aimed the spell *and* passed priority — one keystroke,
 * two moves, and the second one was the whole rest of the turn.
 *
 * Read off the attribute rather than off any list of roles, because the promise
 * being made is the element's own: anything that says it is a button has taken
 * responsibility for these two keys.
 */
function insideControl(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const tag = (target as { readonly tagName?: unknown }).tagName;
  if (typeof tag === 'string' && CONTROLS.includes(tag.toUpperCase())) return true;
  const read = (target as { readonly getAttribute?: unknown }).getAttribute;
  if (typeof read !== 'function') return false;
  return (read as (name: string) => unknown).call(target, 'role') === 'button';
}

function isInteractiveCard(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const read = (target as { readonly getAttribute?: unknown }).getAttribute;
  if (typeof read !== 'function') return false;
  return (read as (name: string) => unknown).call(target, 'data-interactive') === 'true';
}

/**
 * What the surface says about a press it could not spend.
 *
 * It names the list the moves are actually in rather than only reporting the
 * refusal, because "nothing happened" is what the player already knew. `rail.ts`
 * owns that name, so the sentence cannot come to disagree with the group it
 * points at.
 */
export const NO_PASS_NOTE = `Space passes priority, and this decision has no pass in it. Its moves are in the ${LEGAL_MOVES_LABEL} list.`;

export interface PassKeyInput {
  /**
   * What the key spends: the pass, the Continue while a combat beat is on
   * screen, or `null` when there is neither — a finished game, or a decision the
   * kernel enumerated no `passPriority` for.
   */
  readonly pass: (() => void) | null;
  /**
   * `session.decisions`, which is what a note is scoped to.
   *
   * A note is about one position, so it outlives that position by exactly zero
   * renders. Comparing the count clears it without an effect and without a
   * timer, the way `selection.ts` closes a picker, which also means a note can
   * never be left on screen describing a decision that has already been made.
   */
  readonly decisions: number;
}

/**
 * Binds the pass key, and reports the press it had no pass for.
 *
 * Returns the note to draw, or null. Bound whether or not there is a pass:
 * a keystroke that does nothing and says nothing is the half of `mtg-s9p` that
 * is not about focus at all.
 */
export function usePassKey(input: PassKeyInput): string | null {
  const { pass, decisions } = input;
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  useEffect((): (() => void) | undefined => {
    const host = keyHost();
    if (host === null) return undefined;
    const onKeyDown = (event: KeyPress): void => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      if (event.repeat === true || event.altKey === true) return;
      if (event.ctrlKey === true || event.metaKey === true) return;
      if (insideControl(event.target) && (event.key === 'Enter' || !isInteractiveCard(event.target))) return;
      // Space scrolls the page otherwise, which on a table bounded by the
      // viewport moves the board out from under the person who just passed —
      // and moves it out from under one who has just been told why their key
      // did nothing, which would be the same defect twice.
      event.preventDefault?.();
      if (pass === null) {
        setRefusedAt(decisions);
        return;
      }
      pass();
    };
    host.addEventListener('keydown', onKeyDown);
    return (): void => {
      host.removeEventListener('keydown', onKeyDown);
    };
  }, [pass, decisions]);
  return refusedAt === decisions ? NO_PASS_NOTE : null;
}
