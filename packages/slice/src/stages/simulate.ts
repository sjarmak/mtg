/**
 * Stage 3 — the seeded mass simulation.
 *
 * Every unordered pair of the ten decks plays `gamesPerMatchup` games, so each
 * color pair accumulates nine matchups' worth of evidence and the metrics
 * stage can judge it against the 200-distinct-game floor. Seats are fixed per
 * matchup and only the play/draw seat alternates, which keeps the on-the-play
 * measurement a property of the format rather than of the schedule.
 *
 * Wall-clock numbers are collected here because this is the run the ADR's
 * throughput kill-test is actually about: greedy bots, replay logging on, the
 * configuration a balance revision pays for.
 */
import type { SimGameLog } from '@mtg/sim';
import { greedySpec, runMatch, runMatchSerial, writeReplayJsonl } from '@mtg/sim';
import type { MatchSpec } from '@mtg/sim';
import { failStage } from '../errors';
import type { SliceDeck } from './decks';

export interface SimStageResult {
  readonly logs: readonly SimGameLog[];
  readonly matchups: number;
  readonly gamesPerMatchup: number;
  readonly games: number;
  readonly elapsedMillis: number;
  /** Greedy bots with replay logging on: the number a balance revision pays. */
  readonly gamesPerSecond: number;
  readonly workers: number;
  readonly logPath: string;
}

export interface SimStageOptions {
  readonly decks: readonly SliceDeck[];
  readonly runSeed: string;
  readonly gamesPerMatchup: number;
  readonly workers: number;
  readonly expansion: string;
  readonly logPath: string;
}

function matchSpec(options: SimStageOptions, first: SliceDeck, second: SliceDeck): MatchSpec {
  return {
    runSeed: `${options.runSeed}/${first.key}-${second.key}`,
    games: options.gamesPerMatchup,
    decks: [first.deck, second.deck],
    bots: [greedySpec(`greedy:${first.key}`), greedySpec(`greedy:${second.key}`)],
    collectLogs: true,
    expansion: options.expansion,
  };
}

export async function runSimStage(options: SimStageOptions): Promise<SimStageResult> {
  const { decks } = options;
  if (decks.length < 2) failStage('sim', `a round robin needs at least two decks, got ${decks.length}`);

  const logs: SimGameLog[] = [];
  let matchups = 0;
  const started = Date.now();

  for (let first = 0; first < decks.length; first += 1) {
    for (let second = first + 1; second < decks.length; second += 1) {
      const deckA = decks[first];
      const deckB = decks[second];
      if (deckA === undefined || deckB === undefined) {
        failStage('sim', `the deck list is missing an entry at ${first}/${second}`);
      }
      const spec = matchSpec(options, deckA, deckB);
      const run =
        options.workers > 1 ? await runMatch(spec, { workers: options.workers }) : runMatchSerial(spec);
      if (run.logs.length !== options.gamesPerMatchup) {
        failStage(
          'sim',
          `${deckA.key} vs ${deckB.key} produced ${run.logs.length} game logs, expected ${options.gamesPerMatchup}` +
            '; a run that silently drops games would publish win rates over a set nobody chose',
        );
      }
      logs.push(...run.logs);
      matchups += 1;
    }
  }

  const elapsedMillis = Date.now() - started;
  if (logs.length === 0) failStage('sim', 'the round robin produced no game logs');

  writeReplayJsonl(options.logPath, options.runSeed, logs);

  return {
    logs,
    matchups,
    gamesPerMatchup: options.gamesPerMatchup,
    games: logs.length,
    elapsedMillis,
    gamesPerSecond: elapsedMillis === 0 ? 0 : (logs.length * 1000) / elapsedMillis,
    workers: options.workers,
    logPath: options.logPath,
  };
}
