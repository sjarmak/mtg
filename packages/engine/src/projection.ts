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
 * cheaply reversible, and this field is why. What bumps it is a change a reader
 * has to know about to draw the board it always drew: a required field whose
 * meaning moved, or a field a board cannot be drawn without. An *optional*
 * field a reader may ignore does not, because a reader that ignores it draws
 * exactly what it drew before; `characteristics`, `keywords`, `pairedWith`,
 * `commandZone`, `commanderDamage`, `commanderCasts`, `poison` and
 * `playerCounters` are all of that kind, and a wire reader carries them when
 * they are present rather than refusing the position for not knowing them.
 * `commanderDamageMatrix` is of that kind too, but no wire reader carries it
 * yet: `@mtg/forge-export`'s observed protocol and `@mtg/ui`'s backend gateway
 * still read two seats and a fixed field list.
 *
 * **Concealment is a null, not an omission.** `SeatView.hand` is `null` when the
 * viewer may not see it and an array when they may. An absent field would be
 * indistinguishable from a backend that forgot, and `@mtg/kernel`'s
 * `visibility.ts` already argues that hiding at the projection layer is the only
 * honest place to do it once the position crosses a wire.
 */
import type { PerSeat, SeatId } from './table';

export const PROJECTION_VERSION = 4;

/** Current characteristics as resolved by the backend, not the printed face. */
export interface ObjectCharacteristics {
  readonly colors: readonly ('W' | 'U' | 'B' | 'R' | 'G')[];
  /** Null means no mana cost; "{0}" is an actual zero mana cost. */
  readonly manaCost: string | null;
  readonly token: boolean;
}

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
  /** True while this permanent is a declared attacker in the current combat. */
  readonly attacking: boolean;
  /**
   * What is blocking this attacker, by `oid`, in damage-assignment order (CR
   * 509.2). Present only on a declared attacker the defending player has
   * blocked; absent on an unblocked attacker and on everything else. A reader
   * that ignores it sees the projection it saw before, so it does not bump
   * `PROJECTION_VERSION`.
   */
  readonly blockedBy?: readonly string[];
  readonly damage: number;
  readonly controller: SeatId;
  /** Counter kind to count. A kind neither engine shares is still a string. */
  readonly counters: Readonly<Record<string, number>>;
  /** Absent means unreported, not colorless, no cost, or a nontoken. */
  readonly characteristics?: ObjectCharacteristics;
  /**
   * The keyword abilities this permanent has right now, as the backend resolved
   * them: printed English, lowercase, one entry per distinct ability, in the
   * backend's own order (`flying`, `first strike`, `protection from red`). It
   * is the *current* set, so a keyword granted by another permanent, a spell
   * until end of turn or a counter is here on the creature that received it and
   * gone when the grant ends, which the printed face cannot show because the
   * grant is not printed on the receiver.
   *
   * Written for every permanent on the battlefield, empty when it has none, so
   * an empty array on a reporting backend means "has none" and only an absent
   * field means "not reported". Absent for an object in any other zone, where
   * the printed face is the whole story. A string rather than a union because
   * the kernel's vocabulary is its own and a foreign engine's is larger; a
   * surface may show one and may test one for equality, and a surface that
   * needs to know what a keyword *does* is asking the backend a rules question.
   * Optional and ignorable, so it does not bump `PROJECTION_VERSION`.
   */
  readonly keywords?: readonly string[];
  /**
   * The permanent this one is paired with, by `oid` (soulbond, CR 702.95).
   *
   * Both members of a pair carry it and each names the other, so a surface may
   * key a pair off either end and needs no second lookup to tell which two
   * creatures are bonded to one another. It is what `keywords` cannot say: a
   * paired creature's granted ability is on the card as a keyword, and *whose*
   * pair it is has no other source. Present only on a paired permanent and
   * absent on everything else, so it is gone from the survivor the moment its
   * partner leaves the battlefield or changes controller (CR 702.95e).
   *
   * A backend that plays no soulbond never writes it, and absent therefore
   * carries no "unreported" meaning here: an unpaired permanent and a backend
   * that cannot pair look the same, which is correct because both draw nothing.
   * The kernel has no soulbond, so only a foreign engine fills it. Optional and
   * ignorable, so it does not bump `PROJECTION_VERSION`.
   */
  readonly pairedWith?: string;
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
  /** Public exiled cards owned by this seat. */
  readonly exile: readonly ObjectView[];
  readonly battlefield: readonly ObjectView[];
  /**
   * This seat's commanders while they sit in the command zone.
   *
   * Absent means the backend reports no such zone, which is what every backend
   * says on the standard game. On a commander table it is present at every
   * position, empty when the commanders are elsewhere, and `checkBackend` holds
   * a backend to that: a commander table whose opening board has no command
   * zone is a backend that took the table and played a different game.
   */
  readonly commandZone?: readonly ObjectView[];
  readonly avatars?: readonly ObjectView[];
  /** Combat damage this seat has taken from each commander, keyed by that commander's `oid`. */
  readonly commanderDamage?: Readonly<Record<string, number>>;
  /**
   * How many times this seat has cast each of its commanders from the command
   * zone, keyed by that commander's `oid`, in whatever zone it now sits. The
   * commander tax is a function of it (CR 903.8: {2} more for each previous
   * cast), so a board can say what the next cast costs before it is offered.
   */
  readonly commanderCasts?: Readonly<Record<string, number>>;
  /**
   * The top of this seat's library while it is public: cards every player may
   * look at where they sit, top first (Oracle of Mul Daya, Courser of Kruphix,
   * Vizier of the Menagerie). Absent means nothing there is revealed, which is
   * what every backend says on an ordinary position; a reader may ignore it.
   * The seat may play a land from it or cast a spell from it exactly when the
   * backend offers that through `objectActions`, so a board draws it the way it
   * draws a held card. A card named here is identified by both seats, and the
   * hidden-information check reads it as held rather than as a leak.
   */
  readonly libraryTop?: readonly ObjectView[];
  /**
   * Poison counters this seat has. Absent means the backend does not report
   * them, which is not the same as none; a seat with ten loses (CR 704.5c).
   */
  readonly poison?: number;
  /**
   * The other counters this seat holds, by kind: Energy, experience, rad,
   * ticket, or whatever a backend keeps on a player. A string key rather than a
   * union or a named field each, for the reason `TurnView.phase` is a string: the
   * set of kinds is the backend's and open, so a surface draws `kind: count` and
   * compares none, and a kind this contract never listed is still shown rather
   * than dropped. Only kinds the seat holds at least one of are keys, and the
   * whole field is absent when it holds none, so absent draws nothing.
   *
   * `poison` is not in here. It has its own field because a rule reads it (a
   * seat at ten has lost), and a backend that keeps poison beside the rest
   * states it once, there. A surface that draws a counters row reads both.
   * Optional and ignorable, so it does not bump `PROJECTION_VERSION`.
   */
  readonly playerCounters?: Readonly<Record<string, number>>;
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
  /** One view per seat, indexed by `SeatView.id`, in table order. */
  readonly seats: PerSeat<SeatView>;
  /**
   * Commander damage as a matrix: `commanderDamageMatrix[dealer][receiver]` is
   * the combat damage seat `receiver` has taken from seat `dealer`'s commanders,
   * summed over them (CR 903.10a is per commander, and the per-commander split
   * stays on `SeatView.commanderDamage`). Square, one row and column per seat.
   * Absent means the backend reports none, which is every backend on the
   * standard game; a reader that ignores it sees the projection it saw before.
   */
  readonly commanderDamageMatrix?: readonly (readonly number[])[];
}

/**
 * One seat's view, for a seat id that names a seat at this table.
 *
 * `view.seats[seat]` is possibly absent for a seat known only to be a number,
 * and a seat the table does not have is a caller bug rather than a position to
 * draw, so this says so instead of leaving every reader to.
 */
export function seatViewOf(view: Pick<TableView, 'seats'>, seat: SeatId): SeatView {
  const found = view.seats[seat];
  if (found === undefined) throw new Error(`seatViewOf: the table has no seat ${String(seat)}`);
  return found;
}
