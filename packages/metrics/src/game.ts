/**
 * One normalized view of a finished game, plus the turn helpers every metric
 * needs.
 *
 * Two unit conversions live here and nowhere else, because getting either
 * wrong silently doubles or halves half the report:
 *
 *  - **Player turns vs rounds.** The kernel numbers turns globally — turn 1 is
 *    the starting player's, turn 2 is the opponent's — so `num_turns` counts
 *    player turns. 17lands' `average_game_length` counts each player's own
 *    turns (AFR 8.79, metrics report §2.5), which is what everyone means by
 *    "the game went nine turns". `rounds` is the 17lands-comparable number and
 *    is what the length band is stated in; `playerTurns` is the raw log value.
 *
 *  - **Own-turn ordinals.** A side's Nth turn is at global turn 2N-1 or 2N
 *    depending on who started, so "lands in play at end of turn 4" has to be
 *    read off the 4th turn record that side owns, never off global turn 4.
 */
import type { SimGameLog, Side, TurnRecord } from '@mtg/sim';

export const SIDE_LIST: readonly Side[] = ['user', 'oppo'];

export type EndReason = SimGameLog['extras']['sim_end_reason'];

/** Everything the metrics read off one game, with the units already sorted out. */
export interface GameFacts {
  readonly gameSeed: string;
  /** WUBRG color string of the seat-0 deck, e.g. `"WU"`. */
  readonly userColors: string;
  readonly oppoColors: string;
  readonly winner: Side | null;
  readonly onPlay: Side;
  /** Raw `num_turns`: global player turns. */
  readonly playerTurns: number;
  /** Player turns converted to 17lands-comparable rounds. */
  readonly rounds: number;
  readonly endReason: EndReason;
  readonly mirror: boolean;
}

export function roundsFromPlayerTurns(playerTurns: number): number {
  return Math.ceil(playerTurns / 2);
}

function winnerSide(winner: 0 | 1 | null): Side | null {
  if (winner === null) return null;
  return winner === 0 ? 'user' : 'oppo';
}

export function gameFacts(log: SimGameLog): GameFacts {
  const userColors = log.metadata.main_colors;
  const oppoColors = log.metadata.opp_colors;
  return {
    gameSeed: log.extras.sim_game_seed,
    userColors,
    oppoColors,
    winner: winnerSide(log.extras.sim_winner),
    onPlay: log.metadata.on_play === 1 ? 'user' : 'oppo',
    playerTurns: log.metadata.num_turns,
    rounds: roundsFromPlayerTurns(log.metadata.num_turns),
    endReason: log.extras.sim_end_reason,
    mirror: userColors === oppoColors,
  };
}

export function otherSide(side: Side): Side {
  return side === 'user' ? 'oppo' : 'user';
}

/** The colors the given seat played. */
export function colorsOf(facts: GameFacts, side: Side): string {
  return side === 'user' ? facts.userColors : facts.oppoColors;
}

/** Turn records owned by one side, in play order. */
export function ownTurns(log: SimGameLog, side: Side): readonly TurnRecord[] {
  return log.turns.filter((record) => record.owner === side);
}

/**
 * That side's `ordinal`-th own turn, or `undefined` when the game ended first.
 * Callers must treat `undefined` as "no observation", never as a zero — the
 * games that end early are exactly the ones whose mana development differed.
 */
export function ownTurn(log: SimGameLog, side: Side, ordinal: number): TurnRecord | undefined {
  if (ordinal < 1) return undefined;
  return ownTurns(log, side)[ordinal - 1];
}

/** Lands that side controlled at the end of its own `ordinal`-th turn. */
export function landsInPlayAt(log: SimGameLog, side: Side, ordinal: number): number | undefined {
  const record = ownTurn(log, side, ordinal);
  return record === undefined ? undefined : record[side].eot_lands_in_play;
}

/**
 * A turn where nobody advanced the board: no land, no spell from either side,
 * no attack. Draws and untaps do not count as advancement — the point of the
 * measure is Ludi's decisiveness criterion (metrics report §4.5), which asks
 * whether the position is going anywhere.
 */
export function isInertTurn(record: TurnRecord): boolean {
  return (
    record.lands_played === 0 &&
    record.creatures_cast === 0 &&
    record.non_creatures_cast === 0 &&
    record.creatures_attacked === 0 &&
    record.user.instants_sorceries_cast === 0 &&
    record.oppo.instants_sorceries_cast === 0
  );
}

/**
 * Cards a side has seen by the end of its own `ordinal`-th turn: the opening
 * seven plus one per draw step. The player on the play skips their first draw,
 * which the kernel implements and which the hypergeometric priors must match.
 */
export function cardsSeenBy(ordinal: number, onPlay: boolean, openingHand = 7): number {
  const draws = onPlay ? ordinal - 1 : ordinal;
  return openingHand + Math.max(0, draws);
}
