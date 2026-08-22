/**
 * Game-metadata columns for one finished game.
 *
 * Seat 0 is always `user` and seat 1 always `oppo`, so `won`/`on_play` are read
 * from seat 0's point of view exactly as 17lands reads them from the submitting
 * player's. Which seat is on the play alternates per game (see `seeds.ts`), not
 * which deck sits in which seat, so the deck→seat mapping stays fixed across a
 * run and the aggregates stay interpretable.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import type { DeckList, GameEndReason, GameResult, PlayerId } from '@mtg/kernel';
import type { GameMetadata, SimExtras } from './schema';
import { SIM_LOG_SCHEMA_VERSION } from './schema';

/** WUBRG-ordered color string for a deck, e.g. `"WU"`. 17lands' `main_colors` format. */
export function deckColorString(deck: DeckList): string {
  const present = new Set<Color>();
  for (const card of deck.cards) {
    for (const color of colorsOf(card)) present.add(color);
  }
  return COLORS.filter((color) => present.has(color)).join('');
}

function colorsOf(card: Card): readonly Color[] {
  if (card.kind === 'land') return card.producesMana.filter((mana): mana is Color => mana !== 'C');
  return card.colors;
}

export interface MetadataInputs {
  readonly expansion: string;
  readonly eventType: string;
  readonly gameTime: string;
  readonly runSeed: string;
  readonly gameSeed: string;
  readonly index: number;
  readonly decks: readonly [DeckList, DeckList];
  readonly botNames: readonly [string, string];
  readonly startingPlayer: PlayerId;
  readonly result: GameResult;
  readonly decisions: number;
  /** London mulligans taken per seat, seat 0 first; read off the finished game. */
  readonly mulligans: readonly [number, number];
}

export function buildMetadata(inputs: MetadataInputs): GameMetadata {
  return {
    expansion: inputs.expansion,
    event_type: inputs.eventType,
    draft_id: inputs.gameSeed,
    draft_time: inputs.gameTime,
    game_time: inputs.gameTime,
    build_index: 0,
    match_number: 1,
    game_number: 1,
    // 17lands ranks are human ladder tiers; bots have none. The bot identity
    // lives in `sim_user_bot` / `sim_oppo_bot` instead of squatting on `rank`.
    rank: '',
    opp_rank: '',
    main_colors: deckColorString(inputs.decks[0]),
    splash_colors: '',
    on_play: inputs.startingPlayer === 0 ? 1 : 0,
    // CR 103.4 is a decision the kernel asks and the bots answer, so these two
    // count what the seats actually did. They were structural zeroes for as long
    // as no decision produced them; a zero here now means a kept seven.
    num_mulligans: inputs.mulligans[0],
    opp_num_mulligans: inputs.mulligans[1],
    opp_colors: deckColorString(inputs.decks[1]),
    num_turns: inputs.result.endedOnTurn,
    won: inputs.result.winner === 0 ? 1 : 0,
  };
}

export function buildExtras(inputs: MetadataInputs, reason: GameEndReason): SimExtras {
  return {
    sim_schema_version: SIM_LOG_SCHEMA_VERSION,
    sim_run_seed: inputs.runSeed,
    sim_game_seed: inputs.gameSeed,
    sim_game_index: inputs.index,
    sim_user_deck: inputs.decks[0].name,
    sim_oppo_deck: inputs.decks[1].name,
    sim_user_bot: inputs.botNames[0],
    sim_oppo_bot: inputs.botNames[1],
    sim_winner: inputs.result.winner,
    sim_end_reason: reason,
    sim_decisions: inputs.decisions,
  };
}
