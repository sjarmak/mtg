/**
 * Plays seeded random-vs-random games over the sets the kernel runs and counts
 * how every one of them ended, thrown games included (#302).
 *
 *   npx tsx packages/sim/tools/random-sweep.ts --out <dir> --set <set.json> [--set ...] [--example]
 *     [--games 200] [--seed random-sweep/v1] [--board-cap 500] [--agent sim|kernel|both]
 *
 * Greedy bots avoid the strange lines that break an engine, so this seats random
 * ones and plays each game in a match of its own: one game that throws is a
 * tallied outcome with its seed, not the end of the sweep. `runner.ts` keeps its
 * fail-loud rule for every other caller, because a balance run that silently
 * dropped games would report win rates over a set nobody chose; a sweep is the
 * one caller whose question is which games fail.
 *
 * Two random seats, because they test different things. `sim` is
 * `@mtg/sim`'s `randomBot`, which constructs its own declarations and so tests
 * `validateAction` against a self-built move. `kernel` is `@mtg/kernel`'s
 * `randomAgent`, which samples `decision.options` and so tests that what the
 * enumeration offers is what the reducer accepts.
 *
 * Decks are built per color pair, not drafted: the 23 spells of each pair's
 * colors (colorless included) in id order, cycled, over 17 basics split
 * evenly. That is enough to put every castable card of a set in front of a
 * random seat, and it keeps a game a function of (seed, set, index) alone.
 *
 * `--out` has no default, as every output path in this repository: `sweep.json`
 * lands only where somebody chose.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Card, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES, basicLand, EXAMPLE_SET, parseCardsDocumentJson } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import { randomAgent } from '@mtg/kernel';
import { createBot, DEFAULT_BOARD_CAP, randomSpec, runMatchSerial } from '@mtg/sim';
import type { AgentFactory } from '@mtg/sim';

type Seat = 'sim' | 'kernel';

interface SweepOptions {
  readonly out: string;
  readonly sets: readonly string[];
  readonly example: boolean;
  readonly games: number;
  readonly runSeed: string;
  readonly boardCap: number;
  readonly seats: readonly Seat[];
}

const USAGE =
  'usage: --out DIR (--set FILE ... | --example) [--games N] [--seed TEXT] [--board-cap N] [--agent sim|kernel|both]';

export function parseSweepArgs(args: readonly string[]): SweepOptions {
  const sets: string[] = [];
  const values = new Map<string, string>();
  let example = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--example') {
      example = true;
      continue;
    }
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(USAGE);
    }
    index += 1;
    if (flag === '--set') sets.push(value);
    else if (['--out', '--games', '--seed', '--board-cap', '--agent'].includes(flag)) values.set(flag, value);
    else throw new Error(`unknown flag ${flag}; ${USAGE}`);
  }
  const out = values.get('--out');
  if (out === undefined)
    throw new Error(`--out is required: name the directory sweep.json is written into; ${USAGE}`);
  if (sets.length === 0 && !example) throw new Error(`name at least one --set or --example; ${USAGE}`);
  const games = Number(values.get('--games') ?? '200');
  if (!Number.isInteger(games) || games < 1) throw new Error('--games needs a positive integer');
  const boardCap = Number(values.get('--board-cap') ?? String(DEFAULT_BOARD_CAP));
  if (!Number.isInteger(boardCap) || boardCap < 1) throw new Error('--board-cap needs a positive integer');
  const agent = values.get('--agent') ?? 'both';
  const seats: readonly Seat[] =
    agent === 'both' ? ['sim', 'kernel'] : agent === 'sim' || agent === 'kernel' ? [agent] : [];
  if (seats.length === 0) throw new Error('--agent must be sim, kernel or both');
  const runSeed = values.get('--seed') ?? 'random-sweep/v1';
  if (runSeed.length === 0) throw new Error('--seed must be non-empty');
  return { out, sets, example, games, runSeed, boardCap, seats };
}

const PAIRS: readonly (readonly [Color, Color])[] = [
  ['W', 'U'],
  ['U', 'B'],
  ['B', 'R'],
  ['R', 'G'],
  ['G', 'W'],
  ['W', 'B'],
  ['U', 'R'],
  ['B', 'G'],
  ['R', 'W'],
  ['G', 'U'],
];

function basicFor(color: Color): (typeof BASIC_LAND_TYPES)[number] {
  const found = BASIC_LAND_TYPES.find((type) => BASIC_LAND_COLOR[type] === color);
  if (found === undefined) throw new Error(`no basic land type produces ${color}`);
  return found;
}

/** A deterministic 40-card deck of one pair's spells, or `null` when the pool has none. */
function pairDeck(pool: readonly Card[], colors: readonly [Color, Color]): DeckList | null {
  const spells = pool
    .filter((card) => card.kind !== 'land' && card.colors.every((color) => colors.includes(color)))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  if (spells.length === 0) return null;
  const cards: Card[] = [];
  for (let slot = 0; slot < 23; slot += 1) {
    const card = spells[slot % spells.length];
    if (card !== undefined) cards.push(card);
  }
  for (let slot = 0; slot < 17; slot += 1) {
    cards.push(basicLand(basicFor(colors[slot % 2] ?? colors[0]), 'SWP', 900 + slot));
  }
  return { name: colors.join(''), cards };
}

interface Failure {
  readonly set: string;
  readonly seat: Seat;
  readonly game: number;
  readonly runSeed: string;
  readonly decks: readonly [string, string];
  readonly error: string;
  readonly message: string;
}

interface SetTally {
  readonly set: string;
  readonly seat: Seat;
  readonly games: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly slowestGameMillis: number;
  readonly wallMillis: number;
}

const kernelRandom: AgentFactory = (spec, seed) => randomAgent(spec.name, seed);

function sweepPool(
  set: string,
  pool: readonly Card[],
  seat: Seat,
  options: SweepOptions,
  failures: Failure[],
): SetTally {
  const decks = PAIRS.map((pair) => pairDeck(pool, pair)).filter((deck): deck is DeckList => deck !== null);
  if (decks.length === 0) throw new Error(`${set}: no color pair has a spell to build a deck from`);
  const outcomes: Record<string, number> = {};
  const count = (key: string): void => {
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  };
  const started = Date.now();
  let slowest = 0;
  for (let game = 0; game < options.games; game += 1) {
    const first = decks[game % decks.length];
    const second = decks[(game * 3 + 1) % decks.length];
    if (first === undefined || second === undefined) continue;
    const runSeed = `${options.runSeed}/${set}/${seat}/${String(game)}`;
    const gameStarted = Date.now();
    try {
      const run = runMatchSerial(
        {
          runSeed,
          games: 1,
          decks: [first, second],
          bots: [randomSpec('random-0'), randomSpec('random-1')],
          boardCap: options.boardCap,
        },
        { agentFactory: seat === 'kernel' ? kernelRandom : createBot },
      );
      count(run.outcomes[0]?.reason ?? 'noOutcome');
    } catch (error) {
      const name = error instanceof Error ? error.name : 'thrown';
      count(name);
      failures.push({
        set,
        seat,
        game,
        runSeed,
        decks: [first.name, second.name],
        error: name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    slowest = Math.max(slowest, Date.now() - gameStarted);
  }
  return {
    set,
    seat,
    games: options.games,
    outcomes,
    slowestGameMillis: slowest,
    wallMillis: Date.now() - started,
  };
}

function main(): void {
  const options = parseSweepArgs(process.argv.slice(2));
  const pools: (readonly [string, readonly Card[]])[] = options.sets.map((path) => [
    `${basename(resolve(path, '..'))}/${basename(path)}`,
    parseCardsDocumentJson(readFileSync(path, 'utf8')),
  ]);
  if (options.example) pools.push(['dsl-example-set', EXAMPLE_SET]);
  const failures: Failure[] = [];
  const tallies: SetTally[] = [];
  for (const [set, pool] of pools) {
    for (const seat of options.seats) {
      const tally = sweepPool(set, pool, seat, options, failures);
      tallies.push(tally);
      console.log(
        `${set} [${seat}] ${JSON.stringify(tally.outcomes)} slowest ${String(tally.slowestGameMillis)}ms`,
      );
    }
  }
  mkdirSync(options.out, { recursive: true });
  const report = {
    runSeed: options.runSeed,
    gamesPerSet: options.games,
    boardCap: options.boardCap,
    tallies,
    failures,
  };
  const path = join(options.out, 'sweep.json');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${String(failures.length)} thrown game(s); wrote ${path}`);
}

main();
