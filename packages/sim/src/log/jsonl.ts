/**
 * JSONL output.
 *
 * One line per game, each line the wide replay row. JSONL rather than CSV
 * because the column set is not fixed up front (a 40-turn game carries more
 * turn columns than a 9-turn one) and because a streaming append is the only
 * write pattern a mass run needs. Column *names* are the contract, not the file
 * format: `replayRow` output loads straight into a dataframe and joins against
 * a 17lands replay CSV on the shared names.
 *
 * The first line of every file is a header record (`sim_record: 'header'`)
 * carrying the schema version, so a reader can refuse a file it does not
 * understand instead of silently misreading columns.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ReplayRow, SimGameLog } from './schema';
import { SIM_LOG_SCHEMA_VERSION } from './schema';
import { replayRow } from './row';

export interface JsonlHeader {
  readonly sim_record: 'header';
  readonly sim_schema_version: string;
  readonly sim_run_seed: string;
  readonly sim_games: number;
}

export function jsonlHeader(runSeed: string, games: number): JsonlHeader {
  return {
    sim_record: 'header',
    sim_schema_version: SIM_LOG_SCHEMA_VERSION,
    sim_run_seed: runSeed,
    sim_games: games,
  };
}

function serialize(value: JsonlHeader | ReplayRow): string {
  return `${JSON.stringify(value)}\n`;
}

/** Writes a whole run's logs, replacing whatever was at `path`. */
export function writeReplayJsonl(path: string, runSeed: string, logs: readonly SimGameLog[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [serialize(jsonlHeader(runSeed, logs.length))];
  for (const log of logs) lines.push(serialize(replayRow(log)));
  writeFileSync(path, lines.join(''), 'utf8');
}

/** Appends more games to an existing file; the header is not rewritten. */
export function appendReplayJsonl(path: string, logs: readonly SimGameLog[]): void {
  if (logs.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, logs.map((log) => serialize(replayRow(log))).join(''), 'utf8');
}

/** Parses a JSONL file's text back into a header plus rows. */
export function parseReplayJsonl(text: string): { header: JsonlHeader; rows: readonly ReplayRow[] } {
  const lines = text.split('\n').filter((line) => line.length > 0);
  const first = lines[0];
  if (first === undefined) throw new Error('replay JSONL is empty: no header record');
  const header: unknown = JSON.parse(first);
  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { sim_record?: unknown }).sim_record !== 'header'
  ) {
    throw new Error('replay JSONL does not start with a header record');
  }
  const parsed = header as JsonlHeader;
  if (parsed.sim_schema_version !== SIM_LOG_SCHEMA_VERSION) {
    throw new Error(
      `replay JSONL schema ${parsed.sim_schema_version} does not match ${SIM_LOG_SCHEMA_VERSION}`,
    );
  }
  const rows = lines.slice(1).map((line): ReplayRow => JSON.parse(line) as ReplayRow);
  return { header: parsed, rows };
}
