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
