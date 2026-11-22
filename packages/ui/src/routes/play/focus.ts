/**
 * The focus ring, in the one place this route reasons about it.
 *
 * `selection.ts` needed exactly one fact about a focused element — that the
 * thing which held the ring can be given it back — and declared it there,
 * because at the time it was the only surface on this route that moved focus at
 * all. `mtg-s9p` and `mtg-5jl` made it three: a panel header hands the ring back
 * to the table when a pointer press left it stranded, and the stops panel hands
 * it back to the badge it was opened from. Three copies of a structural stand-in
 * for `HTMLElement` are three chances to check a slightly different property, so
 * the stand-in lives here and the callers import it.
 *
 * Structural and runtime-checked, for the reason `../../mount.ts` writes out:
 * the workspace tsconfig has no `lib: dom`, so a DOM fact is declared as the
 * narrowest interface that states it and verified before it is used. That also
 * makes every function here a no-op wherever there is no document, which is what
 * a server-rendered table wants.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/** Structural stand-in for a focusable element: it can be given the ring. */
export interface FocusableNode {
  focus(): void;
}

/** Structural stand-in for an element that can be asked what it contains. */
export interface ContainerNode {
  contains(node: unknown): boolean;
}

/** Structural stand-in for an element that can be asked what it sits inside. */
export interface AncestorNode {
  closest(selector: string): unknown;
}

/** `node` as something focusable, or null when it is not. */
export function asFocusable(node: unknown): FocusableNode | null {
  if (typeof node !== 'object' || node === null) return null;
  const partial = node as Partial<FocusableNode>;
  return typeof partial.focus === 'function' ? (node as FocusableNode) : null;
}

/** `node` as something that can answer `contains`, or null when it cannot. */
export function asContainer(node: unknown): ContainerNode | null {
  if (typeof node !== 'object' || node === null) return null;
  const partial = node as Partial<ContainerNode>;
  return typeof partial.contains === 'function' ? (node as ContainerNode) : null;
}

/** `node` as something that can answer `closest`, or null when it cannot. */
export function asClosest(node: unknown): AncestorNode | null {
  if (typeof node !== 'object' || node === null) return null;
  const partial = node as Partial<AncestorNode>;
  return typeof partial.closest === 'function' ? (node as AncestorNode) : null;
}

/** Whatever holds the focus ring right now, or null when nothing does. */
export function focusedNode(): FocusableNode | null {
  const host = globalThis as { readonly document?: { readonly activeElement?: unknown } };
  return asFocusable(host.document?.activeElement);
}

/**
 * The ring, kept on a card that a press moves into or out of the combat band.
 *
 * `mtg-msln`. Staging a creature draws it in `../../board/CombatZone.ts` instead
 * of in the battlefield row, and those are different React subtrees, so the face
 * that was pressed is unmounted and the ring falls to the document. Assigning a
 * block does it the other way: the attacker keeps its node and the strip
 * reorders around it, and a move through `insertBefore` blurs whatever it
 * carries. Both are invisible to a pointer player and both cost a keyboard
 * player their place in the tab order, which is what makes this a bug rather
 * than a polish item.
 *
 * **It hands the ring back to the same permanent, not to a remembered node.**
 * The node is the thing that did not survive; the permanent did, and the board
 * keys every face by it (`data-permanent-key`, which is the object id). So the
 * keeper records a key on the press and looks the face up again after the
 * commit, which works whether the face moved subtree, moved position, or never
 * moved at all.
 *
 * **A press can also spend the thing it was made on**, which is why the keeper
 * takes a list rather than a key. Pressing an attacker in the band to answer
 * "which one does this creature block" is the case: the attacker is a control
 * only while that question is open, so answering it leaves a face that is no
 * longer a button and cannot hold a ring. The caller names the creature that
 * *is* still pressable after the press — the blocker whose question it was — and
 * the first face that can take the ring gets it.
 *
 * **It only acts when the ring actually fell.** A press that leaves the face
 * mounted and focused is the common case and must not be touched, and a press
 * that moved the ring somewhere deliberate — a question opening its answers with
 * `autoFocus`, which `selection.ts` relies on — must not be overruled. So the
 * effect is a no-op unless the ring is on the body or on nothing at all.
 *
 * A layout effect rather than a microtask, because the ring has to be back
 * before the browser paints; a frame with focus on the document is a frame where
 * a screen reader has already said so.
 */
export interface RingKeeper {
  /**
   * Records the permanents whose face may keep the ring across this commit, best
   * first. The first one still drawn as a control gets it.
   */
  readonly keep: (...keys: readonly string[]) => void;
}

/** Structural stand-in for the document, asked for one node and one active element. */
interface DocumentNode {
  readonly body?: unknown;
  readonly activeElement?: unknown;
  readonly querySelector?: (selector: string) => unknown;
}

function documentNode(): DocumentNode | null {
  const host = globalThis as { readonly document?: DocumentNode };
  return host.document ?? null;
}

/**
 * Whether the ring has fallen off the table.
 *
 * The body and nothing are the two shapes of "the document holds it": jsdom and
 * every browser park focus on `document.body` when a focused element leaves, and
 * a detached document reports null.
 */
export function ringFellToDocument(): boolean {
  const doc = documentNode();
  if (doc === null) return false;
  const active = doc.activeElement;
  return active === null || active === undefined || active === doc.body;
}

/** The pressable face drawn for this permanent right now, or null. */
export function permanentFace(key: string): FocusableNode | null {
  const doc = documentNode();
  if (typeof doc?.querySelector !== 'function') return null;
  return asFocusable(doc.querySelector(`[data-permanent-key="${key}"] button.mtg-card`));
}

/**
 * Hands the ring back to `key`'s face after the commit, if the commit dropped it.
 *
 * Exported and pure of React so the rule above is testable without a table, and
 * so the hook below is the three lines of wiring it should be.
 */
export function restoreRingTo(keys: readonly string[]): void {
  if (!ringFellToDocument()) return;
  for (const key of keys) {
    const face = permanentFace(key);
    if (face === null) continue;
    face.focus();
    return;
  }
}

/** The keeper a table wires its board presses through. */
export function useKeptRing(): RingKeeper {
  const wanted = useRef<readonly string[]>([]);
  useLayoutEffect((): void => {
    const keys = wanted.current;
    wanted.current = [];
    if (keys.length === 0) return;
    restoreRingTo(keys);
  });
  const keep = useCallback((...keys: readonly string[]): void => {
    wanted.current = keys;
  }, []);
  return { keep };
}
