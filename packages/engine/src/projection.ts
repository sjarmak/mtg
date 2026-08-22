/**
 * The board, projected into something neither engine owns.
 *
 * A play surface needs a position to draw. `GameState` is the kernel's, and a
 * foreign engine has its own; handing either one to a component makes that
 * component an engine-specific component, which is exactly the thing ADR-0001
 * §9.5 buys the seam to avoid. So the contract states a projection, and both
 * backends map into it.
 *
 * **It is deliberately thin, and thin is not the same as finished.** What is
 * here is what a board draws and what a rail reads: who has priority, whose turn
 * it is, what is on each battlefield, what is on the stack, what a card is
 * called and how big it is. What is *not* here is everything a surface would
 * need to reason about the rules — continuous effects, replacement effects, the
 * layer derivation, targeting legality, mana availability. That omission is the
 * point rather than a gap to fill later: a surface that could re-derive legality
 * from the projection would be a second rules engine, and the contract's whole
 * claim is that the backend is the only one.
 *
 * **`version` is on the value, not in a doc comment.** The projection will
 * change shape, a recorded transcript holds projections, and a reader that
 * cannot tell which shape it is holding fails in the worst available way, which
 * is quietly drawing a stale board. ADR-0001 §9.6 lists the projection as
 * cheaply reversible, and this field is why.
 *
 * **Concealment is a null, not an omission.** `SeatView.hand` is `null` when the
 * viewer may not see it and an array when they may. An absent field would be
 * indistinguishable from a backend that forgot, and `@mtg/kernel`'s
 * `visibility.ts` already argues that hiding at the projection layer is the only
 * honest place to do it once the position crosses a wire.
 */
import type { SeatId } from './table';

export const PROJECTION_VERSION = 1;

/**
 * One object on the table, as much of it as is public.
 *
 * `oid` is the backend's own identity for the object and is opaque: a surface
 * may compare two of them and may use one as a key, and may not parse one. The
 * kernel's are numbers rendered as strings and a foreign engine's will not be.
 */
export interface ObjectView {
  readonly oid: string;
  readonly name: string;
  /** As printed, including any derivation the backend has already applied. */
  readonly typeLine: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly tapped: boolean;
  readonly damage: number;
  readonly controller: SeatId;
  /** Counter kind to count. A kind neither engine shares is still a string. */
  readonly counters: Readonly<Record<string, number>>;
}

export interface SeatView {
  readonly id: SeatId;
  readonly name: string;
  readonly life: number;
  /** Null when this viewer may not see the cards. Counts are always public. */
  readonly hand: readonly ObjectView[] | null;
  readonly handSize: number;
  readonly librarySize: number;
  readonly graveyard: readonly ObjectView[];
  readonly battlefield: readonly ObjectView[];
}

/**
 * Where the turn is.
 *
 * `phase` and `step` are strings rather than a union, because the union would be
 * the kernel's thirteen steps and a foreign engine's turn structure is its own.
 * A surface may show the string and may compare two of them for equality; a
 * surface that switches on the value is asserting it knows the backend.
 */
export interface TurnView {
  readonly number: number;
  readonly active: SeatId;
  readonly phase: string;
  readonly step: string;
}

export interface TableView {
  readonly version: typeof PROJECTION_VERSION;
  readonly turn: TurnView;
  /** Who holds priority, or null when nobody does. */
  readonly priority: SeatId | null;
  /** Top of the stack last, the order both engines print it in. */
  readonly stack: readonly ObjectView[];
  readonly seats: readonly [SeatView, SeatView];
}
