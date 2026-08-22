/**
 * The closure-sweep harness: run the balance gate's own schedule under a named
 * bot profile and report only the numbers bead `mtg-bc2.35` is about.
 *
 * Why this exists, and why it lives here rather than in `@mtg/metrics`: the
 * question "do the bots close games?" is a question about the bots, and the
 * answer has to be measurable from inside `@mtg/sim` without importing the
 * package that grades it. All three waived gates are recoverable from
 * `GameOutcome` alone, so this file re-derives them from the same definitions
 * `@mtg/metrics` uses:
 *
 *  - `length.longTail`      = share of games at or past round 15
 *                             (`gameLengthDistribution`, `longGameShare`)
 *  - `decisiveness.stall`   = share of games ending on `turnLimit`
 *  - `decisiveness.decided` = share of games with a winner by round 15
 *
 * A round is `ceil(playerTurns / 2)`, the 17lands-comparable unit
 * (`@mtg/metrics` `roundsFromPlayerTurns`). The definitions are restated on
 * purpose and pinned by `test/closure-stats.test.ts`; the alternative is a
 * dependency cycle between the package under test and the package that grades
 * it.
 *
 * The corpus is the balance gate's frozen fixture set, read read-only from
 * `@mtg/setgen`'s fixture tree — the one committed copy of it since
 * `mtg-bc2.86`, and the same file `@mtg/metrics` loads. Grading the bots on a
 * different pool than the gate grades them on would make every comparison here
 * unfalsifiable, and two copies of the pool is how that happens by accident.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { buildDeckForPair, COLOR_PAIRS, colorPairKey } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import type { GameOutcome, GreedyBotConfig, MatchRun, SimPool } from '@mtg/sim';
import { gamesPerMatchupFor, greedySpec, roundRobinSpecs, withSimPool } from '@mtg/sim';

const SET_FIXTURE = fileURLToPath(
  new URL('../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

/** The 17lands-comparable length unit: one round is both players' turns. */
export function roundsOf(playerTurns: number): number {
  return Math.ceil(playerTurns / 2);
}

/** Rounds at or past which a game counts as long (`DEFAULT_LENGTH_BANDS.longGameRound`). */
export const LONG_GAME_ROUND = 15;

/** Round by which a game should be decided (`DEFAULT_DECISIVENESS_BANDS.decisiveRound`). */
export const DECISIVE_ROUND = 15;

/** The three waived gates, plus the context needed to read them honestly. */
export interface ClosureStats {
  readonly games: number;
  /** `length.longTail`: share of games at or past round 15. */
  readonly longTail: number;
  /** `decisiveness.stall`: share of games that hit the turn cap. */
  readonly stall: number;
  /** `decisiveness.decided`: share of games won by round 15. */
  readonly decided: number;
  readonly medianRounds: number;
  readonly meanRounds: number;
  /** Share of games nobody won, for any reason. */
  readonly drawRate: number;
  readonly deckOutRate: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The closure numbers for a pile of finished games. */
export function closureStats(outcomes: readonly GameOutcome[]): ClosureStats {
  const games = outcomes.length;
  if (games === 0) throw new Error('closureStats needs at least one game');
  const rounds: number[] = [];
  let long = 0;
  let stalls = 0;
  let decided = 0;
  let draws = 0;
  let deckOuts = 0;
  for (const outcome of outcomes) {
    const round = roundsOf(outcome.turns);
    rounds.push(round);
    if (round >= LONG_GAME_ROUND) long += 1;
    if (outcome.reason === 'turnLimit') stalls += 1;
    if (outcome.reason === 'emptyLibrary') deckOuts += 1;
    if (outcome.winner === null) draws += 1;
    else if (round <= DECISIVE_ROUND) decided += 1;
  }
  return {
    games,
    longTail: long / games,
    stall: stalls / games,
    decided: decided / games,
    medianRounds: median(rounds),
    meanRounds: rounds.reduce((sum, value) => sum + value, 0) / games,
    drawRate: draws / games,
    deckOutRate: deckOuts / games,
  };
}

export function formatClosure(label: string, stats: ClosureStats): string {
  const pct = (value: number): string => value.toFixed(3);
  return (
    `${label}: longTail=${pct(stats.longTail)} stall=${pct(stats.stall)} ` +
    `decided=${pct(stats.decided)} medianRounds=${stats.medianRounds} ` +
    `meanRounds=${stats.meanRounds.toFixed(2)} draws=${pct(stats.drawRate)} ` +
    `deckOut=${pct(stats.deckOutRate)} n=${stats.games}`
  );
}

let cachedDecks: readonly DeckList[] | null = null;

/** The ten color-pair decks the balance gate plays, built from the frozen set. */
export function balanceDecks(): readonly DeckList[] {
  if (cachedDecks !== null) return cachedDecks;
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
    throw new Error(`closure sweep: ${SET_FIXTURE} has no "cards" array`);
  }
  const { cards } = raw as { cards: unknown };
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error(`closure sweep: ${SET_FIXTURE} has an empty "cards" array`);
  }
  const pool: readonly Card[] = cards.map((card) => parseCard(card));
  cachedDecks = COLOR_PAIRS.map((pair) => ({
    name: colorPairKey(pair),
    cards: buildDeckForPair(pool, pair).deck,
  }));
  return cachedDecks;
}

/** The balance gate's run seed, so a sweep here replays the gate's games exactly. */
export const SWEEP_SEED = 'mtg-balance/v0';

export interface SweepOptions {
  /** Games per matchup. Defaults to the pinned 10,035-game sweep. */
  readonly gamesPerMatchup?: number;
  /** An open pool to reuse across profiles; one is booted per call otherwise. */
  readonly pool?: SimPool | undefined;
}

export interface SweepResult {
  readonly runs: readonly MatchRun[];
  readonly matchups: number;
  readonly gamesPerMatchup: number;
  readonly games: number;
  readonly elapsedMillis: number;
}

function collect(runs: readonly MatchRun[], gamesPerMatchup: number, elapsedMillis: number): SweepResult {
  return {
    runs,
    matchups: runs.length,
    gamesPerMatchup,
    games: runs.reduce((total, run) => total + run.outcomes.length, 0),
    elapsedMillis,
  };
}

/** Plays the gate's round robin with both seats on the same profile. */
export async function sweep(config: GreedyBotConfig, options: SweepOptions = {}): Promise<SweepResult> {
  const decks = balanceDecks();
  const games = options.gamesPerMatchup ?? gamesPerMatchupFor(decks.length);
  const specs = roundRobinSpecs(decks, {
    runSeed: SWEEP_SEED,
    gamesPerMatchup: games,
    collectLogs: false,
    botFor: (deck) => greedySpec(`greedy:${deck.name}`, config),
  });
  const started = Date.now();
  const pool = options.pool;
  const runs =
    pool === undefined
      ? await withSimPool({}, (booted) => booted.runMatches(specs))
      : await pool.runMatches(specs);
  return collect(runs, games, Date.now() - started);
}

/** Every game of a sweep, flattened out of its matchups. */
export function sweepOutcomes(result: SweepResult): readonly GameOutcome[] {
  return result.runs.flatMap((run) => run.outcomes);
}
