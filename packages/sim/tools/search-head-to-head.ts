/**
 * `npx tsx packages/sim/tools/search-head-to-head.ts --set <path> [--games N] [--seed S]`
 *
 * The tier-1.5 search bot against the tier-1 greedy bot, and what it costs
 * (`mtg-y4gw`'s last acceptance criterion).
 *
 * Both seatings are played. A bot that only ever sat in seat 0 would be
 * measured together with the play/draw advantage, and this comparison is small
 * enough that a few points of seat bias would swamp it: each color-pair deck
 * plays a mirror against itself with search in seat 0, then the same games again
 * with search in seat 1, and the reported win rate is the search bot's share of
 * decided games across both. A mirror match on purpose — two different decks
 * would measure the decks.
 *
 * A greedy-against-greedy arm runs beside it, over the identical seeds and
 * decks, as the wall-clock control. The cost of the search is the ratio of the
 * two, and it is the number that decides whether the pinned 10,035-game sweep
 * could ever afford this bot.
 *
 * `--set` has no default, for `mulligan-report.ts`'s reason: a bot comparison
 * has to be argued against a stated pool, and a tool that picks one silently
 * invites a number quoted against the wrong set.
 *
 * Nothing here reads a clock except to time the runs, and the timing is
 * reported rather than asserted, so this is a report and not a gate.
 */
import { readFileSync } from 'node:fs';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { buildDeckForPair, COLOR_PAIRS, colorPairKey } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import type { BotSpec } from '../src/bots';
import { greedySpec, searchSpec } from '../src/bots';
import { runMatchSerial } from '../src/runner';

interface Arm {
  readonly label: string;
  /** Wins by the bot under test, over decided games. */
  wins: number;
  decided: number;
  millis: number;
  games: number;
}

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value ?? fallback;
}

function requiredFlag(name: string): string {
  const value = flag(name, '');
  if (value === '') throw new Error(`--${name} is required`);
  return value;
}

function loadPool(path: string): readonly Card[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const cards = Array.isArray(parsed) ? parsed : (parsed as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) throw new Error(`${path} holds no card list`);
  return cards.map((card) => parseCard(card));
}

/** One mirror match, timed, with the bot under test in the named seat. */
function play(
  arm: Arm,
  deck: DeckList,
  bots: readonly [BotSpec, BotSpec],
  underTest: 0 | 1,
  seed: string,
  games: number,
): void {
  const started = Date.now();
  const run = runMatchSerial({ runSeed: seed, games, decks: [deck, deck], bots, collectLogs: false });
  arm.millis += Date.now() - started;
  arm.games += run.aggregate.games;
  arm.wins += run.aggregate.wins[underTest];
  arm.decided += run.aggregate.wins[0] + run.aggregate.wins[1];
}

function report(arm: Arm): string {
  const rate = arm.decided === 0 ? 0 : (100 * arm.wins) / arm.decided;
  const perGame = arm.games === 0 ? 0 : arm.millis / arm.games;
  return [
    arm.label.padEnd(24),
    `${rate.toFixed(1)}%`.padStart(7),
    `${arm.wins}/${arm.decided}`.padStart(11),
    `${(arm.millis / 1000).toFixed(1)}s`.padStart(9),
    `${perGame.toFixed(1)} ms/game`.padStart(16),
  ].join(' ');
}

function main(): void {
  const pool = loadPool(requiredFlag('set'));
  const games = Number.parseInt(flag('games', '20'), 10);
  const seed = flag('seed', 'sim/search/head-to-head');

  const search: Arm = { label: 'search vs greedy', wins: 0, decided: 0, millis: 0, games: 0 };
  const control: Arm = { label: 'greedy vs greedy', wins: 0, decided: 0, millis: 0, games: 0 };

  for (const pair of COLOR_PAIRS) {
    const key = colorPairKey(pair);
    const deck: DeckList = { name: key, cards: buildDeckForPair(pool, pair).deck };
    const perSeating = Math.max(1, Math.floor(games / 2));
    play(search, deck, [searchSpec('search'), greedySpec('greedy')], 0, `${seed}/${key}/a`, perSeating);
    play(search, deck, [greedySpec('greedy'), searchSpec('search')], 1, `${seed}/${key}/b`, perSeating);
    play(control, deck, [greedySpec('greedy'), greedySpec('greedy')], 0, `${seed}/${key}/a`, perSeating);
    play(control, deck, [greedySpec('greedy'), greedySpec('greedy')], 1, `${seed}/${key}/b`, perSeating);
  }

  const ratio = control.millis === 0 ? 0 : search.millis / control.millis;
  process.stdout.write(`seed ${seed}, ${games} games per color pair, ${COLOR_PAIRS.length} pairs\n\n`);
  process.stdout.write(
    `${'arm'.padEnd(24)} ${'win'.padStart(7)} ${'decided'.padStart(11)} ${'wall'.padStart(9)} ${'per game'.padStart(16)}\n`,
  );
  process.stdout.write(`${report(search)}\n`);
  process.stdout.write(`${report(control)}\n\n`);
  process.stdout.write(`the search costs ${ratio.toFixed(2)}x the greedy run's wall clock\n`);
  process.stdout.write('the control is greedy in both seats, so its 50% is the mirror-match sanity check\n');
}

main();
