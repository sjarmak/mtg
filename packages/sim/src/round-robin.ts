/**
 * The round robin: every unordered pair of decks, once, at a fixed volume.
 *
 * This is the shape both the balance gate and the thin slice run, and until now
 * each had its own copy of the loop. One copy means one place where the seed
 * format, the seating rule and the volume live, which matters because the gate
 * and the loop are only comparable if they schedule games identically.
 *
 * Seat 0 always holds the earlier deck in the list and only the play/draw seat
 * alternates inside a matchup, so the on-the-play measurement is a property of
 * the format rather than of the schedule. The run seed for a matchup is
 * `<runSeed>/<deckA.name>-<deckB.name>`, derived from position rather than from
 * a counter, so adding or removing a deck cannot silently renumber the others.
 *
 * ## Volume
 *
 * `decision-synthesis.md` §5 pins the sweep at 10^4 seeded games per set
 * revision, and ADR-0001 §6.1 writes the throughput kill-test against exactly
 * that quantity. Ten color pairs make 45 unordered matchups, so the pinned
 * total is `gamesPerMatchupFor(10)` = 223 games per matchup (10,035 games).
 * `PINNED_SWEEP_GAMES` and that helper exist so callers name the pinned scope
 * instead of hardcoding a number that then drifts away from the document.
 */
import type { DeckList } from '@mtg/kernel';
import type { BotSpec } from './bots';
import { greedySpec } from './bots';
import type { EnumerationCaps, GameBudget } from './driver';
import type { SimGameLog } from './log/schema';
import type { MatchRun } from './match-run';
import type { MatchSpec } from './match';
import type { SimPool } from './pool';
import { withSimPool } from './pool';
import { runMatchSerial } from './runner';

/** The sweep size pinned by `decision-synthesis.md` §5 / ADR-0001 §6.1. */
export const PINNED_SWEEP_GAMES = 10_000;

/** Unordered pairs of `deckCount` decks: the number of matchups in a round robin. */
export function matchupCount(deckCount: number): number {
  if (!Number.isInteger(deckCount) || deckCount < 2) {
    throw new Error(`a round robin needs at least two decks, got ${String(deckCount)}`);
  }
  return (deckCount * (deckCount - 1)) / 2;
}

/**
 * Games per matchup needed for a sweep of at least `totalGames` games.
 * Rounded up, so the delivered volume meets the pinned scope rather than
 * missing it by a rounding error.
 */
export function gamesPerMatchupFor(deckCount: number, totalGames: number = PINNED_SWEEP_GAMES): number {
  if (!Number.isInteger(totalGames) || totalGames <= 0) {
    throw new Error(`a sweep needs a positive integer game count, got ${String(totalGames)}`);
  }
  return Math.ceil(totalGames / matchupCount(deckCount));
}

export interface RoundRobinOptions {
  readonly runSeed: string;
  readonly gamesPerMatchup: number;
  /** Builds the seat's bot for a deck. Defaults to `greedy:<deck name>`. */
  readonly botFor?: ((deck: DeckList) => BotSpec) | undefined;
  readonly collectLogs?: boolean | undefined;
  /** Count each trigger condition's fires and each activation arm's uses, per game, on every outcome. */
  readonly censusAbilities?: boolean | undefined;
  readonly expansion?: string | undefined;
  readonly eventType?: string | undefined;
  readonly gameTime?: string | undefined;
  readonly alternatePlayFirst?: boolean | undefined;
  readonly maximumTurns?: number | undefined;
  readonly budget?: GameBudget | undefined;
  readonly caps?: EnumerationCaps | undefined;
}

export interface RoundRobinRun {
  readonly runs: readonly MatchRun[];
  readonly logs: readonly SimGameLog[];
  readonly matchups: number;
  readonly gamesPerMatchup: number;
  readonly games: number;
  readonly elapsedMillis: number;
  readonly gamesPerSecond: number;
}

function defaultBot(deck: DeckList): BotSpec {
  return greedySpec(`greedy:${deck.name}`);
}

/**
 * The schedule, as data. Exposed separately from the runners so a caller can
 * inspect, filter or replay exactly what would have been played — and so the
 * two runners below cannot disagree about what a round robin is.
 */
export function roundRobinSpecs(
  decks: readonly DeckList[],
  options: RoundRobinOptions,
): readonly MatchSpec[] {
  matchupCount(decks.length);
  if (!Number.isInteger(options.gamesPerMatchup) || options.gamesPerMatchup <= 0) {
    throw new Error(
      `a round robin needs a positive integer game count, got ${String(options.gamesPerMatchup)}`,
    );
  }
  const botFor = options.botFor ?? defaultBot;
  const specs: MatchSpec[] = [];
  for (let first = 0; first < decks.length; first += 1) {
    for (let second = first + 1; second < decks.length; second += 1) {
      const deckA = decks[first];
      const deckB = decks[second];
      if (deckA === undefined || deckB === undefined) {
        throw new Error(`round robin: missing deck at ${first}/${second}`);
      }
      specs.push({
        runSeed: `${options.runSeed}/${deckA.name}-${deckB.name}`,
        games: options.gamesPerMatchup,
        decks: [deckA, deckB],
        bots: [botFor(deckA), botFor(deckB)],
        alternatePlayFirst: options.alternatePlayFirst,
        maximumTurns: options.maximumTurns,
        budget: options.budget,
        caps: options.caps,
        collectLogs: options.collectLogs ?? true,
        censusAbilities: options.censusAbilities,
        expansion: options.expansion,
        eventType: options.eventType,
        gameTime: options.gameTime,
      });
    }
  }
  return specs;
}

function collect(
  specs: readonly MatchSpec[],
  runs: readonly MatchRun[],
  gamesPerMatchup: number,
  elapsedMillis: number,
): RoundRobinRun {
  const logs = runs.flatMap((run) => run.logs);
  const games = runs.reduce((total, run) => total + run.outcomes.length, 0);
  return {
    runs,
    logs,
    matchups: specs.length,
    gamesPerMatchup,
    games,
    elapsedMillis,
    gamesPerSecond: elapsedMillis === 0 ? 0 : (games * 1000) / elapsedMillis,
  };
}

/** Every matchup on this thread, in schedule order. */
export function runRoundRobinSerial(decks: readonly DeckList[], options: RoundRobinOptions): RoundRobinRun {
  const specs = roundRobinSpecs(decks, options);
  const started = Date.now();
  const runs = specs.map((spec) => runMatchSerial(spec));
  return collect(specs, runs, options.gamesPerMatchup, Date.now() - started);
}

export interface PooledRoundRobinOptions extends RoundRobinOptions {
  /** An open pool to reuse. When omitted, one is booted and closed here. */
  readonly pool?: SimPool | undefined;
  /** Workers to boot when no pool is supplied. */
  readonly workers?: number | undefined;
}

/**
 * Every matchup across one pool of workers that stays warm for the whole sweep.
 *
 * The pool is shared across matchups on purpose. Booting workers costs about as
 * much as a short matchup takes to play, so a pool per matchup spends the sweep
 * compiling TypeScript; that cost is what made the serial path faster at gate
 * volumes and it is the thing this function removes.
 */
export async function runRoundRobin(
  decks: readonly DeckList[],
  options: PooledRoundRobinOptions,
): Promise<RoundRobinRun> {
  const specs = roundRobinSpecs(decks, options);
  const supplied = options.pool;
  if (supplied !== undefined) {
    const started = Date.now();
    const runs = await supplied.runMatches(specs);
    return collect(specs, runs, options.gamesPerMatchup, Date.now() - started);
  }
  const started = Date.now();
  const runs = await withSimPool({ workers: options.workers }, (pool) => pool.runMatches(specs));
  // Charged with pool startup: a sweep that boots its own workers pays for them.
  return collect(specs, runs, options.gamesPerMatchup, Date.now() - started);
}
