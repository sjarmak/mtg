/**
 * What a match is made of, said without naming an engine.
 *
 * A backend is handed a `SessionSpec` and gives back a session. Everything in here
 * is either a plain value or a reference the backend resolves for itself, which
 * is the whole trick: our kernel resolves `dsl-set` by loading DSL cards, and a
 * foreign engine resolves `printed` by naming real printings to whatever it
 * already has. Neither reference type carries a card, because a card is exactly
 * the thing the two engines cannot agree about.
 */

/** Which side of the table. Two seats, and the contract says so on purpose. */
export type SeatId = 0 | 1;

export const SEAT_IDS: readonly SeatId[] = [0, 1];

/** Who answers for a seat. */
export type SeatController =
  /** A person, or a surface standing in for one. Decisions come back through `submit`. */
  | 'local'
  /** The backend's own bot. The session settles past it without asking. */
  | 'engine';

export interface SeatSpec {
  readonly name: string;
  readonly controller: SeatController;
  readonly deck: DeckRef;
}

/**
 * The content a match is played with, by reference.
 *
 * `kind` is the routing fact: `dsl-set` is content this lab generated and the
 * kernel can execute, `printed` is real cards it cannot. ADR-0001 §9.2 makes
 * that a per-match decision taken once, before the first card is drawn, and this
 * is the field it is taken from.
 */
export type ContentRef =
  | { readonly kind: 'dsl-set'; readonly setCode: string }
  | { readonly kind: 'printed'; readonly format: string };

/**
 * A deck, as a list of names and counts.
 *
 * Names rather than card objects, for the reason above: a DSL card and a printed
 * card are different values and only the backend knows which it is holding. A
 * name the backend cannot resolve is a `content-unresolved` error at `open`,
 * which is the whole of the validation this layer can honestly do.
 */
export interface DeckRef {
  readonly name: string;
  readonly cards: readonly DeckSlot[];
}

export interface DeckSlot {
  readonly name: string;
  readonly count: number;
}

export interface SessionSpec {
  readonly content: ContentRef;
  readonly seats: readonly [SeatSpec, SeatSpec];
  /**
   * The seed the match is dealt from, or null to let the backend pick one.
   *
   * A recorded backend must report the seed it actually used, whichever of those
   * two happened, because the record is worth nothing without it. An observed
   * backend may state a seed and is making no promise by doing so — see
   * `determinism.ts`.
   */
  readonly seed: string | null;
  /** Turn limit, or null for the backend's own. Kept because a bot match needs one. */
  readonly maximumTurns: number | null;
}

/** How a match ended, in the vocabulary both engines already share. */
export interface MatchResult {
  readonly winner: SeatId | null;
  /** Free text, because the reasons an engine can end a game are its own. */
  readonly reason: string;
  readonly endedOnTurn: number;
}
