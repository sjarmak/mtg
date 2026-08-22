/**
 * The event-log reader: `@mtg/sim` replay JSONL in, per-turn timeline out.
 *
 * The log is written wide (17lands' layout) because that is the join surface
 * for calibration. Nothing on screen wants a 749-column object, so this is the
 * one place the wide row is turned back into turns, and both the replay viewer
 * and the analysis dashboard read the result.
 *
 * Every column is looked up by name and typechecked. A missing or wrongly-typed
 * column raises `ReplayLogError` naming the line and the column rather than
 * defaulting to zero: a silent zero in a balance dashboard is a wrong number
 * presented as a right one.
 */
import {
  END_REASONS,
  EXTRA_STRING_FIELDS,
  GAME_COLUMNS,
  REPLAY_SCHEMA_VERSION,
  SIDES,
  eotColumn,
  ownerColumn,
  sideColumn,
  totalColumn,
} from './columns';
import type {
  EndReason,
  ReplaySide,
  TotalField,
  TurnOwnerField,
  TurnSideEotField,
  TurnSideField,
} from './columns';
import type {
  LifePoint,
  ReplayExtras,
  ReplayGame,
  ReplayLog,
  ReplayMetadata,
  SideTotals,
  SideTurnStats,
  TimelineTurn,
} from './types';

export class ReplayLogError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`replay log line ${line}: ${message}`);
    this.name = 'ReplayLogError';
    this.line = line;
  }
}

type RawRow = Readonly<Record<string, unknown>>;

function parseLine(text: string, line: number): RawRow {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new ReplayLogError(`not valid JSON (${String(cause)})`, line);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReplayLogError('expected a JSON object', line);
  }
  return value as RawRow;
}

function num(row: RawRow, column: string, line: number): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReplayLogError(`column ${column} is not a finite number`, line);
  }
  return value;
}

function str(row: RawRow, column: string, line: number): string {
  const value = row[column];
  if (typeof value !== 'string') throw new ReplayLogError(`column ${column} is not a string`, line);
  return value;
}

function bit(row: RawRow, column: string, line: number): 0 | 1 {
  const value = num(row, column, line);
  if (value !== 0 && value !== 1) throw new ReplayLogError(`column ${column} must be 0 or 1`, line);
  return value;
}

function metadataOf(row: RawRow, line: number): ReplayMetadata {
  for (const column of GAME_COLUMNS) {
    if (!(column in row)) throw new ReplayLogError(`missing column ${column}`, line);
  }
  return {
    expansion: str(row, 'expansion', line),
    event_type: str(row, 'event_type', line),
    draft_id: str(row, 'draft_id', line),
    draft_time: str(row, 'draft_time', line),
    game_time: str(row, 'game_time', line),
    build_index: num(row, 'build_index', line),
    match_number: num(row, 'match_number', line),
    game_number: num(row, 'game_number', line),
    rank: str(row, 'rank', line),
    opp_rank: str(row, 'opp_rank', line),
    main_colors: str(row, 'main_colors', line),
    splash_colors: str(row, 'splash_colors', line),
    on_play: bit(row, 'on_play', line),
    num_mulligans: num(row, 'num_mulligans', line),
    opp_num_mulligans: num(row, 'opp_num_mulligans', line),
    opp_colors: str(row, 'opp_colors', line),
    num_turns: num(row, 'num_turns', line),
    won: bit(row, 'won', line),
  };
}

function endReasonOf(row: RawRow, line: number): EndReason {
  const value = str(row, 'sim_end_reason', line);
  const match = END_REASONS.find((reason) => reason === value);
  if (match === undefined) throw new ReplayLogError(`unknown sim_end_reason ${value}`, line);
  return match;
}

function winnerOf(row: RawRow, line: number): 0 | 1 | null {
  const value = row['sim_winner'];
  if (value === null) return null;
  return bit(row, 'sim_winner', line);
}

function extrasOf(row: RawRow, line: number): ReplayExtras {
  const strings: Record<string, string> = {};
  for (const field of EXTRA_STRING_FIELDS) strings[field] = str(row, field, line);
  const schemaVersion = strings['sim_schema_version'] ?? '';
  if (schemaVersion !== REPLAY_SCHEMA_VERSION) {
    throw new ReplayLogError(`row schema ${schemaVersion} does not match ${REPLAY_SCHEMA_VERSION}`, line);
  }
  return {
    sim_schema_version: schemaVersion,
    sim_run_seed: strings['sim_run_seed'] ?? '',
    sim_game_seed: strings['sim_game_seed'] ?? '',
    sim_game_index: num(row, 'sim_game_index', line),
    sim_user_deck: strings['sim_user_deck'] ?? '',
    sim_oppo_deck: strings['sim_oppo_deck'] ?? '',
    sim_user_bot: strings['sim_user_bot'] ?? '',
    sim_oppo_bot: strings['sim_oppo_bot'] ?? '',
    sim_winner: winnerOf(row, line),
    sim_end_reason: endReasonOf(row, line),
    sim_decisions: num(row, 'sim_decisions', line),
  };
}

function totalsOf(row: RawRow, side: ReplaySide, line: number): SideTotals {
  const read = (field: TotalField): number => num(row, totalColumn(side, field), line);
  return {
    cards_drawn: read('cards_drawn'),
    cards_tutored: read('cards_tutored'),
    cards_discarded: read('cards_discarded'),
    lands_played: read('lands_played'),
    creatures_cast: read('creatures_cast'),
    non_creatures_cast: read('non_creatures_cast'),
    instants_sorceries_cast: read('instants_sorceries_cast'),
    mana_spent: read('mana_spent'),
  };
}

function ownerOfTurn(row: RawRow, turn: number, line: number): ReplaySide {
  const owners = SIDES.filter((side) => ownerColumn(side, turn, 'cards_drawn') in row);
  const [only] = owners;
  if (owners.length !== 1 || only === undefined) {
    throw new ReplayLogError(`turn ${turn} is owned by ${owners.length} seats; expected exactly one`, line);
  }
  return only;
}

function sideStatsOf(
  row: RawRow,
  owner: ReplaySide,
  turn: number,
  side: ReplaySide,
  line: number,
): SideTurnStats {
  const field = (name: TurnSideField): number => num(row, sideColumn(owner, turn, side, name), line);
  const eot = (name: TurnSideEotField): number => num(row, eotColumn(owner, turn, side, name), line);
  return {
    instants_sorceries_cast: field('instants_sorceries_cast'),
    abilities: field('abilities'),
    combat_damage_taken: field('combat_damage_taken'),
    creatures_killed_combat: field('creatures_killed_combat'),
    creatures_killed_non_combat: field('creatures_killed_non_combat'),
    mana_spent: field('mana_spent'),
    sim_triggers: field('sim_triggers'),
    eot_cards_in_hand: eot('cards_in_hand'),
    eot_lands_in_play: eot('lands_in_play'),
    eot_creatures_in_play: eot('creatures_in_play'),
    eot_non_creatures_in_play: eot('non_creatures_in_play'),
    eot_life: eot('life'),
  };
}

function turnOf(row: RawRow, turn: number, line: number): TimelineTurn {
  const owner = ownerOfTurn(row, turn, line);
  const own = (field: TurnOwnerField): number => num(row, ownerColumn(owner, turn, field), line);
  return {
    turn,
    owner,
    cards_drawn: own('cards_drawn'),
    cards_tutored: own('cards_tutored'),
    cards_discarded: own('cards_discarded'),
    lands_played: own('lands_played'),
    creatures_cast: own('creatures_cast'),
    non_creatures_cast: own('non_creatures_cast'),
    creatures_attacked: own('creatures_attacked'),
    creatures_blocked: own('creatures_blocked'),
    creatures_unblocked: own('creatures_unblocked'),
    creatures_blocking: own('creatures_blocking'),
    user: sideStatsOf(row, owner, turn, 'user', line),
    oppo: sideStatsOf(row, owner, turn, 'oppo', line),
  };
}

/** One wide replay row to one game timeline. */
export function readReplayGame(row: RawRow, index: number, line: number): ReplayGame {
  const metadata = metadataOf(row, line);
  if (!Number.isInteger(metadata.num_turns) || metadata.num_turns < 0) {
    throw new ReplayLogError(`num_turns ${metadata.num_turns} is not a turn count`, line);
  }
  const turns: TimelineTurn[] = [];
  for (let turn = 1; turn <= metadata.num_turns; turn += 1) turns.push(turnOf(row, turn, line));
  return {
    index,
    metadata,
    extras: extrasOf(row, line),
    totals: { user: totalsOf(row, 'user', line), oppo: totalsOf(row, 'oppo', line) },
    turns,
  };
}

function readHeader(row: RawRow, line: number): { version: string; runSeed: string; games: number } {
  if (row['sim_record'] !== 'header') {
    throw new ReplayLogError('file does not start with a header record', line);
  }
  const version = str(row, 'sim_schema_version', line);
  if (version !== REPLAY_SCHEMA_VERSION) {
    throw new ReplayLogError(`schema ${version} does not match ${REPLAY_SCHEMA_VERSION}`, line);
  }
  return { version, runSeed: str(row, 'sim_run_seed', line), games: num(row, 'sim_games', line) };
}

/** Reads a whole replay JSONL file: header record, then one game per line. */
export function readReplayLog(text: string): ReplayLog {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const first = lines[0];
  if (first === undefined) throw new ReplayLogError('file is empty', 1);
  const header = readHeader(parseLine(first, 1), 1);
  const games = lines.slice(1).map((line, index) => {
    const row = parseLine(line, index + 2);
    if (row['sim_record'] === 'header') {
      throw new ReplayLogError('unexpected second header record', index + 2);
    }
    return readReplayGame(row, index, index + 2);
  });
  return {
    schemaVersion: header.version,
    runSeed: header.runSeed,
    declaredGames: header.games,
    games,
  };
}

/** End-of-turn life totals for both seats, in turn order. */
export function lifeSeries(game: ReplayGame): readonly LifePoint[] {
  return game.turns.map((turn) => ({
    turn: turn.turn,
    owner: turn.owner,
    user: turn.user.eot_life,
    oppo: turn.oppo.eot_life,
  }));
}

/** The seat that won, or `null` for a draw or an unfinished game. */
export function winningSide(game: ReplayGame): ReplaySide | null {
  const winner = game.extras.sim_winner;
  if (winner === null) return null;
  return winner === 0 ? 'user' : 'oppo';
}

/** `WU vs WB` — the matchup a game was played under. */
export function matchupLabel(game: ReplayGame): string {
  return `${game.extras.sim_user_deck} vs ${game.extras.sim_oppo_deck}`;
}
