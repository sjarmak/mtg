/**
 * Structured log → the wide 17lands-shaped row.
 *
 * This is the join surface. One object per game, keys identical to 17lands'
 * replay CSV headers, plus `sim_`-prefixed columns of our own. Turn columns run
 * from 1 to however many turns the game lasted — 17lands stops at 30, and going
 * past it is exactly the "superset" part of the contract.
 */
import type { ReplayRow, ReplayValue, SimGameLog, TurnRecord } from './schema';
import {
  eotColumn,
  ownerColumn,
  REPLAY_GAME_COLUMNS,
  REPLAY_TOTAL_FIELDS,
  SIDES,
  sideColumn,
  TURN_OWNER_FIELDS,
  TURN_SIDE_EOT_FIELDS,
  TURN_SIDE_FIELDS,
  totalColumn,
} from './schema';

function writeTurn(row: Record<string, ReplayValue>, record: TurnRecord): void {
  for (const field of TURN_OWNER_FIELDS) {
    row[ownerColumn(record.owner, record.turn, field)] = record[field];
  }
  for (const side of SIDES) {
    const stats = record[side];
    for (const field of TURN_SIDE_FIELDS) {
      row[sideColumn(record.owner, record.turn, side, field)] = stats[field];
    }
    for (const field of TURN_SIDE_EOT_FIELDS) {
      row[eotColumn(record.owner, record.turn, side, field)] = stats[`eot_${field}`];
    }
  }
}

/** Flattens one game's log into the wide replay row. */
export function replayRow(log: SimGameLog): ReplayRow {
  const row: Record<string, ReplayValue> = {};
  for (const column of REPLAY_GAME_COLUMNS) row[column] = log.metadata[column];
  for (const side of SIDES) {
    for (const field of REPLAY_TOTAL_FIELDS) {
      row[totalColumn(side, field)] = log.totals[side][field];
    }
  }
  for (const record of log.turns) writeTurn(row, record);
  for (const [key, value] of Object.entries(log.extras)) row[key] = value;
  return row;
}

/**
 * Exactly the column names a row built from these turn records must carry —
 * metadata, totals, and the per-turn block for each turn that was actually
 * played. Used by the schema test to assert we never quietly drop, rename, or
 * invent a 17lands column.
 */
export function expectedReplayColumns(turns: readonly TurnRecord[]): readonly string[] {
  const columns: string[] = [...REPLAY_GAME_COLUMNS];
  for (const side of SIDES) {
    for (const field of REPLAY_TOTAL_FIELDS) columns.push(totalColumn(side, field));
  }
  for (const record of turns) {
    const owner = record.owner;
    for (const field of TURN_OWNER_FIELDS) columns.push(ownerColumn(owner, record.turn, field));
    for (const side of SIDES) {
      for (const field of TURN_SIDE_FIELDS) columns.push(sideColumn(owner, record.turn, side, field));
      for (const field of TURN_SIDE_EOT_FIELDS) columns.push(eotColumn(owner, record.turn, side, field));
    }
  }
  return columns;
}
