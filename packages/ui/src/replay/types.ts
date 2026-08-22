/**
 * The timeline structure both the replay viewer and the analysis dashboard read.
 *
 * `ReplayGame` is deliberately a superset of `@mtg/sim`'s `SimGameLog`: the same
 * `metadata` / `extras` / `totals` / `turns` shape, plus the game's position in
 * the file. That makes the reader a true inverse of the sim's `replayRow`
 * flattening, which is what `test/replay-contract.test.ts` asserts by
 * re-flattening a parsed game and comparing it to the original line.
 */
import type { EndReason, ReplaySide } from './columns';

export interface SideTurnStats {
  readonly instants_sorceries_cast: number;
  readonly abilities: number;
  readonly combat_damage_taken: number;
  readonly creatures_killed_combat: number;
  readonly creatures_killed_non_combat: number;
  readonly mana_spent: number;
  readonly sim_triggers: number;
  readonly eot_cards_in_hand: number;
  readonly eot_lands_in_play: number;
  readonly eot_creatures_in_play: number;
  readonly eot_non_creatures_in_play: number;
  readonly eot_life: number;
}

/** One turn, owned by one seat, with both seats' stats attributed. */
export interface TimelineTurn {
  readonly turn: number;
  readonly owner: ReplaySide;
  readonly cards_drawn: number;
  readonly cards_tutored: number;
  readonly cards_discarded: number;
  readonly lands_played: number;
  readonly creatures_cast: number;
  readonly non_creatures_cast: number;
  readonly creatures_attacked: number;
  readonly creatures_blocked: number;
  readonly creatures_unblocked: number;
  readonly creatures_blocking: number;
  readonly user: SideTurnStats;
  readonly oppo: SideTurnStats;
}

export interface SideTotals {
  readonly cards_drawn: number;
  readonly cards_tutored: number;
  readonly cards_discarded: number;
  readonly lands_played: number;
  readonly creatures_cast: number;
  readonly non_creatures_cast: number;
  readonly instants_sorceries_cast: number;
  readonly mana_spent: number;
}

export interface ReplayMetadata {
  readonly expansion: string;
  readonly event_type: string;
  readonly draft_id: string;
  readonly draft_time: string;
  readonly game_time: string;
  readonly build_index: number;
  readonly match_number: number;
  readonly game_number: number;
  readonly rank: string;
  readonly opp_rank: string;
  readonly main_colors: string;
  readonly splash_colors: string;
  readonly on_play: 0 | 1;
  readonly num_mulligans: number;
  readonly opp_num_mulligans: number;
  readonly opp_colors: string;
  readonly num_turns: number;
  readonly won: 0 | 1;
}

export interface ReplayExtras {
  readonly sim_schema_version: string;
  readonly sim_run_seed: string;
  readonly sim_game_seed: string;
  readonly sim_game_index: number;
  readonly sim_user_deck: string;
  readonly sim_oppo_deck: string;
  readonly sim_user_bot: string;
  readonly sim_oppo_bot: string;
  readonly sim_winner: 0 | 1 | null;
  readonly sim_end_reason: EndReason;
  readonly sim_decisions: number;
}

export interface ReplayGame {
  /** Position in the file, 0-based. Not a sim column. */
  readonly index: number;
  readonly metadata: ReplayMetadata;
  readonly extras: ReplayExtras;
  readonly totals: Readonly<Record<ReplaySide, SideTotals>>;
  readonly turns: readonly TimelineTurn[];
}

export interface ReplayHeader {
  readonly sim_record: 'header';
  readonly sim_schema_version: string;
  readonly sim_run_seed: string;
  readonly sim_games: number;
}

export interface ReplayLog {
  readonly schemaVersion: string;
  readonly runSeed: string;
  /**
   * Games the header claims. Not authoritative: `appendReplayJsonl` adds rows
   * without rewriting the header, and a sliced file keeps the original count.
   * Compare against `games.length` when the difference matters.
   */
  readonly declaredGames: number;
  readonly games: readonly ReplayGame[];
}

/** Life totals at end of each turn, ready to plot. */
export interface LifePoint {
  readonly turn: number;
  readonly owner: ReplaySide;
  readonly user: number;
  readonly oppo: number;
}
