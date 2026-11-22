import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCommanderHeadToHeadResults, parsePrintedDeckWinRates } from '@mtg/printed-card';
import type { CommanderHeadToHeadResults, PrintedDeckWinRates } from '@mtg/printed-card';
import type { PrintedFormatIndex } from '../src/lab/printed-format';

export const DECK_WIN_RATES_FILENAME = 'commander-precon-win-rates-v1.json';
export const HEAD_TO_HEAD_FILENAME = 'commander-head-to-head-v1.json';

export function deckWinRatesPath(repoRoot: string): string {
  return join(repoRoot, 'packages', 'data', 'data', 'commander-power', DECK_WIN_RATES_FILENAME);
}

export function headToHeadPath(repoRoot: string): string {
  return join(repoRoot, 'packages', 'data', 'data', 'commander-power', HEAD_TO_HEAD_FILENAME);
}

export function readDeckWinRates(path: string): PrintedDeckWinRates | undefined {
  if (!existsSync(path)) return undefined;
  return parsePrintedDeckWinRates(JSON.parse(readFileSync(path, 'utf8')));
}

export function readHeadToHead(path: string): CommanderHeadToHeadResults | undefined {
  if (!existsSync(path)) return undefined;
  return parseCommanderHeadToHeadResults(JSON.parse(readFileSync(path, 'utf8')));
}

export function describeDeckWinRates(
  table: PrintedDeckWinRates | undefined,
  index: PrintedFormatIndex,
): string {
  if (table === undefined) {
    return 'Deck win rates: no table in this checkout, so the Commander deck picker shows no pairing figures.';
  }
  const staged = index.formats.filter((row) => row.deckWinRatesUrl !== undefined).map((row) => row.name);
  return staged.length === 0
    ? `Deck win rates: ${table.source.name} figures were read, and no staged format carries a deck they measure.`
    : `Deck win rates: ${table.source.name} figures staged for ${staged.join(', ')}.`;
}

export function describeHeadToHead(
  table: CommanderHeadToHeadResults | undefined,
  index: PrintedFormatIndex,
): string {
  if (table === undefined) {
    return 'Head-to-head results: no table in this checkout, so the Commander deck picker shows no lab measurement.';
  }
  const staged = index.formats.filter((row) => row.headToHeadUrl !== undefined).map((row) => row.name);
  return staged.length === 0
    ? 'Head-to-head results: the table was read, and no staged format carries a deck it measures.'
    : `Head-to-head results: staged for ${staged.join(', ')}.`;
}
