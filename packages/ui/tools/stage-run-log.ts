/**
 * Finding the statistics log that belongs to the set being played.
 *
 * `stage-precons.ts` decides which deck list this set can be dealt, and
 * `stage-set-art.ts` decides which manifest has this set's pictures. This is
 * the third of the same decision and it was the one nobody was making: a
 * hand-cut three-game slice of a *Tideglass* run was committed in `public/` and
 * served on every launch, so the flagship's Analysis tab reported another set's
 * games and the shell wore the count on every route. Nothing staged that file
 * and nothing cleared it.
 *
 * # The rule: the whole log, or nothing
 *
 * A statistics log's numbers are aggregates over a run — win rates, turn
 * medians, matchup tables — so a slice of one is not a smaller true thing, it
 * is the first N games of a schedule that plays its matchups in order. That is
 * why nothing here cuts a log down to size: a candidate is staged whole or
 * rejected, the way `choosePreconFile` takes every card of a deck list or none
 * of it.
 *
 * Identity is the set code, and it is checked on every row rather than on the
 * header, because the header carries no set at all. The code is a weaker claim
 * than the precon rule's — two builds of one set share it — and it is the whole
 * of what a log carries about its subject, so the launcher prints the run seed
 * beside it and the tab names both. What it rules out is the failure that was
 * actually on screen: another set entirely.
 *
 * # Why there is no fallback
 *
 * There is no cheap way to produce a matching log. `npm run slice` at its
 * default 60 games per matchup is 2,700 games; the run on this machine wrote 62
 * MB of JSONL. A launcher cannot spend that, and the three bot games it *can*
 * afford (`stage-replay.ts`) would put a 3-game win rate on a dashboard. So
 * when nothing matches, the staged file is removed and the Analysis tab shows
 * its `absent` state naming `npm run slice`, which is the same answer
 * `analysis.json` and `calibration.json` already give a fresh checkout.
 */
import { rmSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readReplayLog } from '../src/replay/timeline';
import type { ReplayLog } from '../src/replay/types';

/** The file name the page fetches, staged into `packages/ui/public/`. */
export const RUN_LOG_FILENAME = 'replay.slice.jsonl';

/**
 * How large a staged log may be.
 *
 * The page fetches this file whole and parses every row of it in the browser,
 * so the ceiling is a property of the reader rather than of the disk. A game
 * row is ~24 KB of 17lands columns, which puts this at about 340 games — a
 * run somebody asked for with `--games`, not a full sweep. A full sweep is
 * refused by name rather than truncated, because a truncated log reports the
 * first matchups of a schedule as if they were the run.
 */
export const MAX_RUN_LOG_BYTES = 8 * 1024 * 1024;

export interface RunLogCandidate {
  readonly path: string;
  /** Human phrase for where this came from, used in the launcher's line. */
  readonly what: string;
}

export interface ChosenRunLog {
  readonly candidate: RunLogCandidate;
  /** The file's own bytes; the page is served the run's file, not a re-encoding. */
  readonly text: string;
  readonly log: ReplayLog;
}

/** Why a candidate was passed over. Kept so the launcher can say what it found. */
export interface RejectedRunLog {
  readonly candidate: RunLogCandidate;
  readonly why: string;
}

export interface RunLogSearch {
  readonly chosen: ChosenRunLog | null;
  readonly rejected: readonly RejectedRunLog[];
  /** The set the search was for; `null` when the set document named no code. */
  readonly setCode: string | null;
}

/**
 * Where a statistics log is looked for, given the set document being staged.
 *
 * Beside the set first, because a run that wrote its set and its log into one
 * directory has said they belong together — `logs/replay.jsonl` next to the
 * set, then one level up, which is the layout `npm run slice` writes
 * (`out/slice/set/set.json` beside `out/slice/logs/replay.jsonl`). The repo's
 * own slice output last, since it is whatever the last run left there.
 */
export function runLogCandidatesFor(setPath: string, repoRoot: string): readonly RunLogCandidate[] {
  const setDir = dirname(setPath);
  return [
    { path: join(setDir, 'logs', 'replay.jsonl'), what: 'a log beside the set' },
    { path: join(setDir, '..', 'logs', 'replay.jsonl'), what: 'a log in the set’s run directory' },
    { path: join(repoRoot, 'out', 'slice', 'logs', 'replay.jsonl'), what: 'the most recent slice run' },
  ];
}

export interface ChooseRunLogOptions {
  /** Injectable so the tests can describe a checkout without creating one. */
  readonly read?: (path: string) => string | null;
  /** Checked before the read, so an unservable file is never loaded into memory. */
  readonly sizeOf?: (path: string) => number | null;
}

/**
 * The first candidate that is this set's run, whole and readable.
 *
 * A candidate on disk that does not qualify is *rejected with a reason* rather
 * than skipped: the likeliest cause is a real run of the previous set, and that
 * is exactly the file whose numbers would look right on the page.
 */
export function chooseRunLog(
  candidates: readonly RunLogCandidate[],
  setCode: string | null,
  options: ChooseRunLogOptions = {},
): RunLogSearch {
  // A set document with no code cannot be matched against anything, and
  // guessing from the card ids would be inventing the subject the whole file
  // exists to check.
  if (setCode === null) return { chosen: null, rejected: [], setCode };
  const read = options.read ?? defaultRead;
  const sizeOf = options.sizeOf ?? defaultSize;
  const rejected: RejectedRunLog[] = [];
  for (const candidate of candidates) {
    const bytes = sizeOf(candidate.path);
    if (bytes === null) continue;
    if (bytes > MAX_RUN_LOG_BYTES) {
      rejected.push({
        candidate,
        why:
          `is ${megabytes(bytes)} MB and the page reads a statistics log whole, ` +
          `so anything over ${megabytes(MAX_RUN_LOG_BYTES)} MB is not staged`,
      });
      continue;
    }
    const text = read(candidate.path);
    if (text === null) continue;
    let log: ReplayLog;
    try {
      log = readReplayLog(text);
    } catch (cause: unknown) {
      rejected.push({ candidate, why: cause instanceof Error ? cause.message : String(cause) });
      continue;
    }
    if (log.games.length === 0) {
      rejected.push({ candidate, why: 'holds a header and no games' });
      continue;
    }
    const expansions = [...new Set(log.games.map((game) => game.metadata.expansion))];
    const foreign = expansions.filter((code) => code !== setCode);
    if (foreign.length > 0) {
      rejected.push({ candidate, why: `is about ${foreign.join(', ')}, and this set is ${setCode}` });
      continue;
    }
    return { chosen: { candidate, text, log }, rejected, setCode };
  }
  return { chosen: null, rejected, setCode };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function defaultRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function defaultSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * Puts the chosen log where the page fetches it, or takes the last one away.
 *
 * The removal is the half that matters. A log staged for the set played an hour
 * ago is not stale data on a tab nobody opens: the Analysis tab summarizes it,
 * and the shell badge carries the count on every route.
 */
export function writeRunLog(target: string, search: RunLogSearch): void {
  if (search.chosen === null) {
    rmSync(target, { force: true });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, search.chosen.text, 'utf8');
}

/** One line for the launcher's stdout, whatever the search found. */
export function describeRunLog(search: RunLogSearch): string {
  const notes = search.rejected.map((entry) => `  - ${entry.candidate.path}: ${entry.why}`);
  if (search.chosen === null) {
    const head =
      search.setCode === null
        ? 'This set document names no set code, so no statistics log can be matched to it; ' +
          'the Analysis tab shows its empty state.'
        : `No statistics log on disk is about ${search.setCode}, so the Analysis tab says nothing ` +
          'was measured. Run `npm run slice` to produce one.';
    return notes.length === 0 ? head : `${head}\n${notes.join('\n')}`;
  }
  const { candidate, log } = search.chosen;
  const head =
    `Staged ${String(log.games.length)} games of ${String(search.setCode)} for the Analysis tab ` +
    `from ${candidate.what} (seed ${log.runSeed}).`;
  return notes.length === 0 ? head : `${head}\n${notes.join('\n')}`;
}
