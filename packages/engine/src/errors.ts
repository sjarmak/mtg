/**
 * What can go wrong, as values rather than as thrown exceptions.
 *
 * The kernel throws, and throwing is right for it: `choose` with an out-of-range
 * index is a caller bug one call after the kernel handed the options out, and a
 * bug should be loud. Across a process boundary the population is different. A
 * subprocess can die between two decisions, a wire can desync, a request can
 * time out — none of those is a caller bug, all of them are ordinary operating
 * conditions of a play backend, and a surface has to render them rather than
 * crash on them. So `submit` returns a result and does not throw for any of
 * these.
 *
 * The arms are a closed union so a surface can be made to handle each one. Two
 * of them exist only because a foreign backend can:
 *
 *  - `backend-failure` is the process dying, the wire desyncing, or a reply
 *    arriving that the contract cannot parse. An in-process reducer cannot
 *    produce it, which is exactly why it has to be in the type: a surface
 *    written against the kernel alone would never have grown the branch.
 *  - `timeout` is the cost ADR-0001 §9.4 charges for putting a boundary on the
 *    path of an ordinary click. It is a real error and never a default return,
 *    because a default return here would be the lab inventing a move.
 *
 * `unsupported` is the capability refusal: the caller asked for something this
 * backend declared it does not do. It names the capability so the message can
 * say which, and so a caller can tell it apart from a bug.
 */

export type SessionError =
  /** Nothing is pending, so there was nothing to answer. */
  | { readonly kind: 'no-decision-pending'; readonly message: string }
  /** The id is not on the current list. Includes how many were offered. */
  | { readonly kind: 'unknown-move'; readonly message: string; readonly offered: number }
  /** The backend accepted the id and then refused the move. A backend bug. */
  | { readonly kind: 'illegal-move'; readonly message: string }
  /** The backend cannot resolve the content or a deck it was handed. */
  | { readonly kind: 'content-unresolved'; readonly message: string; readonly unresolved: readonly string[] }
  /** Declared unsupported by this backend. `capability` names which. */
  | { readonly kind: 'unsupported'; readonly message: string; readonly capability: string }
  /** The boundary did not answer in time. */
  | { readonly kind: 'timeout'; readonly message: string; readonly millis: number }
  /** The backend died, desynced, or answered something unreadable. */
  | { readonly kind: 'backend-failure'; readonly message: string };

export type SessionErrorKind = SessionError['kind'];

/**
 * A result, so the failure is in the type rather than in the control flow.
 *
 * Generic in the session so the two determinism arms keep their own: submitting
 * on a recorded session gives back a recorded session, and the type says so
 * without a cast. That is what stops a surface from losing the recorded arm
 * halfway through a game and then finding it cannot replay.
 */
export type SubmitResult<S> =
  { readonly ok: true; readonly session: S } | { readonly ok: false; readonly error: SessionError };

export type OpenResult<S> =
  { readonly ok: true; readonly session: S } | { readonly ok: false; readonly error: SessionError };

export function describeSessionError(error: SessionError): string {
  return `${error.kind}: ${error.message}`;
}
