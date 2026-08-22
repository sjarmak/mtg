/**
 * What the backend is asking, and what may be answered.
 *
 * **The neutral channel is the enumeration, and only the enumeration.** The
 * backend lists the moves it will accept; a surface picks one by its id and
 * sends the id back. That is the whole protocol, and it is the narrowest one
 * that both engines can implement, because it needs no agreement about what a
 * move *is* — only that a list can be printed and an element of it named.
 *
 * `@mtg/kernel` has a second door, `chooseAction`, which takes a constructed
 * move and asks whether it is legal. That door is what the MTGO-style board uses
 * for a click-built block declaration, and it stays kernel-specific
 * (ADR-0001 §9.5): constructing a move means writing down the engine's action
 * algebra, and two engines do not share one. A surface that wants it asks for
 * the kernel by name.
 *
 * **`complete` is the truncation, and it is an admission rather than a
 * feature.** `@mtg/kernel` caps enumeration at 512 and says so, because a
 * declaration space is a product and a product is exponential in the board. A
 * backend-neutral surface has to be told, and it costs one boolean, so it is
 * told. `mtg-bc2.151.1` asked what to do about the other side of that boolean,
 * and the section below is the answer.
 *
 * **A move id is opaque and comes from the backend.** A surface may hold one,
 * compare two, and send one back. It may not build one. The kernel's are the
 * option's index rendered as a string; a subprocess backend's will be whatever
 * its wire format needs, and neither is a contract.
 *
 * # A truncated list is a hole, and the contract is not what fills it
 *
 * `mtg-bc2.151.1` states a fork: either the contract grows a second channel — a
 * backend-supplied constructor for one named decision kind — or a surface that
 * needs one holds a `GameSession` and says so. The answer is neither. The
 * channel already carries everything needed, the backend is putting the wrong
 * value through it, and the hole closes on the backend's side.
 *
 * **The measurement, re-taken rather than inherited.** Two attackers and six
 * untapped creatures that can each block either of them is 3^6 = 729 legal
 * declarations; `blockerDecision` lists 512 and reports `complete: false`, so
 * 217 of them have no id and cannot be submitted through `submit` at all. The
 * bead's arithmetic is exact. What the bead understates is the shape: the same
 * board with three attackers and eight blockers is 65,536 legal declarations
 * against the same 512, and the 512 name only 13 of the 24 (blocker, attacker)
 * pairs that are legal, so three of the eight creatures appear in no listed
 * option at all. It is not a combat-only problem either — `castOptions` and
 * `activationOptions` multiply the same way, and `@mtg/kernel`'s
 * `chest-and-keys.test.ts` holds a priority decision that truncates.
 *
 * **Why not a constructor in the contract.** To construct a block a caller must
 * be able to name one, and the smallest naming is a list of (blocker, attacker)
 * pairs of `oid`s. That much needs no kernel import, so the objection is not
 * dependency: it is that the contract would then hold a *term for blocking*.
 * `PendingDecision.kind` is a string on purpose — "a surface that switches on it
 * exhaustively has picked a backend" — and a constructor typed on one named kind
 * is the first entry in a decision taxonomy the contract deliberately does not
 * have. It would not stay one entry. Attack declarations truncate, damage
 * assignment orders truncate, target tuples and sacrifice payments truncate, and
 * each arrives as its own bead with its own reasonable case. A contract that
 * grows an arm per Magic decision is a rules engine with the rules deleted.
 *
 * **Why not "the surface holds a `GameSession`".** That is today's arrangement
 * and ADR-0001 §12.5(3) files it as the gap rather than the answer: the surfaces
 * that reach past the contract to `@mtg/kernel` are "each one a place a
 * backend-specific assumption can hide". `mtg-bc2.151`'s third acceptance
 * criterion is a play client that runs a whole match against a selected backend
 * *without backend-specific rules logic in UI components*. Answering blocks
 * through `GameSession` puts the kernel's action algebra in the one component
 * where combat is decided, which is the criterion failing at the exact decision
 * it was written for.
 *
 * **Why not a bigger cap.** A cap is a memory bound over an exponential, so it
 * buys board size logarithmically: doubling 512 buys 0.63 of a blocker against
 * two attackers, and a cap of a million truncates at thirteen. There is no
 * number that makes the truncation unreachable, and every number large enough to
 * try produces a list no person can be shown — `mtg-y1t` measured 256 options as
 * 63,133px under the fold, and `mtg-2aca` measured 512 as a scrolling column of
 * seven-line paragraphs, hundreds of them character-for-character identical.
 *
 * # What the channel already has
 *
 * An exponential decision is a product or a permutation, and both are sequences
 * of small decisions. Six blockers against two attackers is one 729-way question
 * or six 3-way ones; six blockers ordered against one attacker is one 720-way
 * question or a 6-way one, then a 5-way one, and so on. **A backend may already
 * ask it the second way**, because nothing here says a decision must be answered
 * in one submit: `submit` returns a session, that session carries the next
 * decision, and a backend that asks six small questions in a row is using the
 * contract exactly as written. No new term, no new arm, no new member.
 *
 * So `complete: false` is not the contract admitting it cannot express
 * something. It is a backend handing a surface a list it has already said is not
 * the list, when it had the option of asking a question it could finish.
 * `checkBackend` reports it as a finding for that reason — `conformance.ts`
 * carries the check and what it does not claim.
 *
 * # Why the determinism split is not the precedent, and `labels.ts` is
 *
 * The reflex is `determinism.ts`'s: a promise a foreign engine may not keep goes
 * in a narrowing type, so a caller that needs it says so in a signature. Two arms
 * of a `constructsMoves` discriminant is the shape that follows, and it is wrong
 * here for the reason that file calls the one that matters — its third. Recorded
 * and observed backends carry *different kinds of record*, a seed and a move list
 * against a list of observed positions, and a flag would make one look like the
 * other with a feature missing. Nothing of the sort is true here: both arms would
 * take a `MoveId` in `submit` and hand back a session, and the only difference
 * would be whether one more id exists. A discriminant that narrows to no new
 * member is a boolean spelled longer.
 *
 * `labels.ts`'s third reason is the one that fits, and it settles the shape
 * without any of this: **truncation is not a property of a backend.**
 * Determinism is true of an engine for every game it will ever play. Truncation
 * is true of one decision at one position — the same kernel enumerates 256
 * blocks completely on one board and 512 of 65,536 on the next — so a static
 * declaration would be a claim no backend could keep. The declaration therefore
 * belongs on the value and is computed per decision, which is what `complete`
 * already is. The field is not the problem; the silence behind it was.
 *
 * # What a foreign backend does with this
 *
 * Nothing, if it never truncates. A bridge whose combat channel is incremental —
 * assign a blocker, assign another, commit — is already decomposed and reports
 * `complete: true` at every question it asks, because each question it asks is
 * small. That is the ordinary case and it is why this answer asks nothing new of
 * anybody.
 *
 * A backend that can neither enumerate a space nor decompose it is a backend
 * that cannot be driven through *any* surface at that decision, and it fails
 * `checkBackend` with the reason on it. That failure is the point: it lands at
 * the seam, before the backend ships, rather than in front of a player who has
 * found a block they cannot declare.
 *
 * Notably this asks nothing about *constructing* moves. A backend with no
 * constructed-move door at all — the toy in `stub.ts` is one — is unaffected,
 * which is the tell that the fork's first branch was solving the wrong problem.
 * The kernel has that door (`chooseAction`, and `Choice` widened to
 * `number | Action` under `mtg-y1t.2`, so a move with no index records itself)
 * and it is still the backend that truncates. Owning a constructor did not stop
 * the hole; only not truncating does.
 */
import type { SeatId } from './table';

/**
 * The backend's name for one move it will accept.
 *
 * Opaque by convention rather than by branding, because a branded string cannot
 * cross a JSON wire without a cast at the far end, and this type is built to
 * cross one. Validation is at the boundary instead: `submit` refuses an id that
 * is not on the current list with `unknown-move`, which is the check a brand
 * would have been standing in for.
 */
export type MoveId = string;

/** An object a move points at, by the projection's own opaque identity. */
export interface MoveTarget {
  readonly oid: string;
  readonly name: string;
}

export interface MoveOption {
  readonly id: MoveId;
  /**
   * What the move says, in a sentence a person reads.
   *
   * The backend writes it, because the backend is the only thing that knows what
   * the move does. **It carries no promise of being distinct**: two legal moves
   * that read the same is `mtg-cee`, and a backend writing one sentence per move
   * with no sight of the rest of the list will produce it. A surface that draws
   * this string straight onto a button has reproduced that bug.
   *
   * `labels.ts` is the contract's own answer — it appends what the projection
   * says separates the colliding moves, and marks the ones it could not separate
   * — and it argues at length which rungs of `@mtg/ui`'s `naming.ts` rule can
   * live behind a neutral contract and which cannot.
   */
  readonly text: string;
  readonly targets: readonly MoveTarget[];
}

export interface PendingDecision {
  readonly seat: SeatId;
  /**
   * What kind of question this is, in the backend's vocabulary.
   *
   * A string rather than a union for the same reason `TurnView.step` is: the
   * kernel's eight decision kinds are the kernel's. A surface may group or label
   * by it; a surface that switches on it exhaustively has picked a backend.
   */
  readonly kind: string;
  /** The question, in a sentence. */
  readonly prompt: string;
  readonly options: readonly MoveOption[];
  /** False when the backend stopped listing before it ran out of legal moves. */
  readonly complete: boolean;
}
