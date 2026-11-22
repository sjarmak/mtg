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

/**
 * Which seat of the table: a position in `SessionSpec.seats`, counting from zero.
 *
 * A non-negative whole number, not a two-value union: a Commander pod seats four.
 * It is a plain `number` rather than a nominal brand because a brand would make
 * every literal `0` and `1` in the packages that already speak this contract a
 * cast, for a check `isSeatId` makes at the one place a seat arrives from outside
 * (a wire message). Whether a seat id names a seat *at a given table* is a
 * question about that table; `seatIdsOf` answers it.
 */
export type SeatId = number;

/** The fewest seats a table has: a match is between two sides at the least. */
export const MIN_SEATS = 2;

/**
 * One entry per seat, at least `MIN_SEATS` of them.
 *
 * A tuple with a rest rather than a plain list, so `entries[0]` and `entries[1]`
 * stay defined under `noUncheckedIndexedAccess` for every reader that has always
 * spoken of two seats, while `entries[seat]` for a seat that is only known to be
 * a number is honestly possibly absent.
 */
export type PerSeat<Entry> = readonly [Entry, Entry, ...Entry[]];

/**
 * Narrows a list built at run time to `PerSeat`. A table under `MIN_SEATS`
 * seats is refused (`matchRulesRefusals`) before any backend builds a per-seat
 * list from it, so the throw is a caller bug and not a state to handle.
 */
export function perSeat<Entry extends object>(entries: readonly Entry[]): PerSeat<Entry> {
  const [first, second, ...rest] = entries;
  if (first === undefined || second === undefined) {
    throw new Error(
      `perSeat: ${String(entries.length)} entries, and a table has at least ${String(MIN_SEATS)}`,
    );
  }
  return [first, second, ...rest];
}

/** True for a value that could be a seat id at some table: a non-negative whole number. */
export function isSeatId(value: unknown): value is SeatId {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Every seat id of a table with this many seats, in table order. */
export function seatIdsOf(seatCount: number): readonly SeatId[] {
  return Array.from({ length: seatCount }, (_unused, seat) => seat);
}

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
  | { readonly kind: 'printed'; readonly format: string }
  | {
      /**
       * Printed cards plus one or more generated sets, all executed by one
       * backend. The reference names content; it does not smuggle DSL values
       * into this neutral package. A Forge implementation resolves every set
       * code and accepts this arm only when the whole resolved payload
       * transpiles, with every refusal reported through `supports`.
       */
      readonly kind: 'mixed';
      readonly format: string;
      readonly customSetCodes: readonly string[];
    };

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
  /** Cards outside the main deck, including a card Forge may validate as a companion. */
  readonly sideboard?: readonly DeckSlot[];
  /**
   * The cards that begin the game in the command zone, on a commander table.
   *
   * One slot per commander, each at count one; two slots is a partner pair.
   * Absent on the standard game, and `matchRulesRefusals` says so in both
   * directions: a commander table with no commander is a deck with no general,
   * and a standard table naming one is a card the game would never put anywhere.
   */
  readonly commanders?: readonly DeckSlot[];
}

/** Exact namespace used to resolve one card in a mixed-content match. */
export type CardOrigin =
  | { readonly kind: 'printed' }
  | { readonly kind: 'custom'; readonly setCode: string; readonly cardId: string };

export interface DeckSlot {
  readonly name: string;
  readonly count: number;
  /** Optional for single-namespace content; required by backends for mixed content. */
  readonly origin?: CardOrigin;
}

/**
 * Which game a table plays.
 *
 * `standard` is the two-player game every backend has always been handed, and
 * is what an absent `rules` means. `commander` is the Commander board, a pod of any size from two up:
 * each deck names its commanders, the command zone is a zone the projection
 * draws, and combat damage from one commander is tracked per commander. The
 * variant is a routing fact the way `ContentRef.kind` is: our kernel runs the
 * standard game only and says so through `supports`, and a Forge
 * implementation opens a commander table under Forge's own Commander game
 * type, or refuses it by name until it can.
 */
export type GameVariant = 'standard' | 'commander' | 'momir';

export interface MatchRules {
  readonly variant: GameVariant;
  /** Life each seat starts on. Public state, so `checkBackend` reads it back off the opening board. */
  readonly startingLife: number;
}

export const STANDARD_RULES: MatchRules = { variant: 'standard', startingLife: 20 };
export const COMMANDER_RULES: MatchRules = { variant: 'commander', startingLife: 40 };
export const MOMIR_RULES: MatchRules = { variant: 'momir', startingLife: 24 };

export interface SessionSpec {
  readonly content: ContentRef;
  /** One per seat, at least `MIN_SEATS`; a two-seat table is the standard game. */
  readonly seats: PerSeat<SeatSpec>;
  /**
   * The rules the table plays under, or absent for the standard game.
   *
   * Absent rather than required, so that every table already written keeps its
   * meaning and every backend that never heard of a variant is handed nothing
   * new. A backend reads it through `rulesOf`, never off the field.
   */
  readonly rules?: MatchRules;
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

/** The rules a table plays under, with the standard game as the unstated default. */
export function rulesOf(table: SessionSpec): MatchRules {
  return table.rules ?? STANDARD_RULES;
}

/**
 * One seat's spec, for a seat id that names a seat at this table. The
 * counterpart of `seatViewOf`: a seat the table does not have is a caller bug.
 */
export function seatSpecOf(table: SessionSpec, seat: SeatId): SeatSpec {
  const found = table.seats[seat];
  if (found === undefined) throw new Error(`seatSpecOf: the table has no seat ${String(seat)}`);
  return found;
}

/**
 * Why a table's rules and its decks disagree, as reasons a backend can list.
 *
 * This is the half of the variant every backend refuses identically, so it is
 * stated once here rather than once per backend: a backend's own `supports`
 * appends it to whatever else it has to say. Whether the cards themselves make
 * a legal Commander deck is not asked here, because that is a question about
 * the cards and only the backend holding them can answer it.
 */
export function matchRulesRefusals(table: SessionSpec): readonly string[] {
  const rules = rulesOf(table);
  const reasons: string[] = [];
  if (table.seats.length < MIN_SEATS) {
    reasons.push(`${String(table.seats.length)} seats: a match needs at least ${String(MIN_SEATS)}`);
  }
  if (!Number.isSafeInteger(rules.startingLife) || rules.startingLife <= 0) {
    reasons.push(
      `starting life ${String(rules.startingLife)}: a seat starts on a positive whole number of life`,
    );
  }
  table.seats.forEach((seat, index) => {
    const commanders = seat.deck.commanders;
    const who = `seat ${String(index)} (${seat.name})`;
    if (rules.variant === 'standard') {
      if (commanders !== undefined) {
        reasons.push(`${who} names a commander, and the standard game has no command zone to put it in`);
      }
      return;
    }
    if (rules.variant === 'momir') {
      if (commanders !== undefined) {
        reasons.push(`${who} names a commander, and a Momir table has an avatar instead`);
      }
      const counts = new Map(seat.deck.cards.map((slot) => [slot.name, slot.count]));
      const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
      if (seat.deck.cards.length !== basics.length || basics.some((name) => counts.get(name) !== 12)) {
        reasons.push(
          `${who} has a Momir deck other than 12 each of Plains, Island, Swamp, Mountain, and Forest`,
        );
      }
      return;
    }
    if (commanders === undefined || commanders.length === 0) {
      reasons.push(`${who} names no commander, and a commander table seats no deck without one`);
      return;
    }
    for (const slot of commanders) {
      if (slot.count !== 1) {
        reasons.push(
          `${who} names ${String(slot.count)} copies of commander "${slot.name}"; a commander is one card`,
        );
      }
    }
  });
  return reasons;
}
