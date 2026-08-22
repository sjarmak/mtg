/**
 * `npx tsx packages/sim/tools/mulligan-report.ts --set <path> [--games N] [--arm ...]`
 *
 * The opening-hand census, printed. One seeded round robin per arm over the ten
 * color-pair decks `@mtg/deckbuild` builds from a set, then the same table for
 * each arm so a policy change is read as a delta rather than as a number.
 *
 * Rerunnable and deterministic: the seed, the schedule and the arms are all
 * arguments, and nothing here reads a clock. `--set` has no default and is not
 * optional, because the pool is the whole subject of the reading: a mulligan
 * change has to be argued against the pool whose balance gate it will move, and
 * a tool that picks one silently invites a number quoted against the wrong set.
 */
import { readFileSync } from 'node:fs';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { buildDeckForPair, COLOR_PAIRS, colorPairKey } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import type { CensusArm, SeatRecord } from '../src/opening-hand-census';
import { censusRoundRobin, decidedRate, pairWinRates } from '../src/opening-hand-census';

/** The arms this report exists to compare: the shipped policy before and after. */
const ARMS: readonly CensusArm[] = [
  { label: 'before: land band only', mulligan: { minimumLandsFloor: 0, castableByTurn: 0 } },
  { label: 'castable by turn 3', mulligan: { minimumLandsFloor: 0, castableByTurn: 3 } },
  { label: 'castable by turn 2', mulligan: { minimumLandsFloor: 0, castableByTurn: 2 } },
  { label: 'castable by 3 + two-land floor', mulligan: { minimumLandsFloor: 2, castableByTurn: 3 } },
];

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  return value;
}

function requiredFlag(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) throw new Error(`--${name} <path> is required: name the pool this reading is about`);
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  return value;
}

function loadPool(path: string): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('cards' in raw)) {
    throw new Error(`${path} has no "cards" array`);
  }
  const cards = (raw as { readonly cards: unknown }).cards;
  if (!Array.isArray(cards) || cards.length === 0) throw new Error(`${path} has an empty pool`);
  return cards.map((card) => parseCard(card));
}

function decksFor(pool: readonly Card[]): readonly DeckList[] {
  return COLOR_PAIRS.map((pair) => ({
    name: colorPairKey(pair),
    cards: buildDeckForPair(pool, pair).deck,
  }));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function share(records: readonly SeatRecord[], predicate: (record: SeatRecord) => boolean): string {
  if (records.length === 0) return 'n/a';
  return percent(records.filter(predicate).length / records.length);
}

function distribution(values: readonly number[]): string {
  if (values.length === 0) return '(none)';
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .toSorted((a, b) => a[0] - b[0])
    .map(([value, count]) => `${value}:${percent(count / values.length)}`)
    .join('  ');
}

function conditionalWinRate(records: readonly SeatRecord[], label: string): string {
  const { rate, n } = decidedRate(records);
  return `${label}: ${n === 0 ? 'n/a' : percent(rate)} (n=${n})`;
}

function report(arm: CensusArm, records: readonly SeatRecord[]): void {
  const lines: string[] = [`\n=== ${arm.label} — ${records.length} seat-games ===`];

  lines.push('\n(a) lands in the seven dealt, by mulligan round');
  const rounds = Math.max(...records.map((record) => record.dealtLands.length));
  for (let round = 0; round < rounds; round += 1) {
    const dealt = records.flatMap((record) =>
      record.dealtLands[round] === undefined ? [] : [record.dealtLands[round] as number],
    );
    lines.push(`  hand ${round + 1} (n=${dealt.length}): ${distribution(dealt)}`);
  }

  lines.push('\n(b) mulligans taken');
  lines.push(`  ${distribution(records.map((record) => record.mulligans))}`);

  lines.push('\n(c) lands in the KEPT hand, by kept size');
  for (const size of [7, 6, 5]) {
    const kept = records.filter((record) => record.keptSize === size);
    const zeroOne = kept.filter((record) => record.keptLands <= 1).length;
    lines.push(
      `  kept ${size} (n=${kept.length}): ${distribution(kept.map((r) => r.keptLands))}` +
        `   <=1 land: ${kept.length === 0 ? 'n/a' : percent(zeroOne / kept.length)}`,
    );
  }

  lines.push("\n(d) lands in play at the end of a seat's own Nth turn, and stuck");
  for (const turn of [3, 5, 7]) {
    const seen = records.flatMap((record) => {
      const lands = record.landsByTurn.get(turn);
      return lands === undefined ? [] : [lands];
    });
    lines.push(`  own turn ${turn} (n=${seen.length}): ${distribution(seen)}`);
  }
  const reachedFour = records.filter((record) => record.landsByTurn.has(4));
  lines.push(
    `  stuck (<=1 land in play at the end of own turn 4, of ${reachedFour.length} seats that saw it): ` +
      share(reachedFour, (record) => (record.landsByTurn.get(4) ?? 0) <= 1),
  );

  lines.push('\n(e) win rate by what was kept');
  for (const lands of [0, 1, 2, 3, 4]) {
    lines.push(
      `  ${conditionalWinRate(
        records.filter((record) => record.keptLands === lands),
        `${lands}-land keep`,
      )}`,
    );
  }
  lines.push(
    `  ${conditionalWinRate(
      records.filter((r) => r.mulligans === 0),
      'kept a seven',
    )}`,
  );
  lines.push(
    `  ${conditionalWinRate(
      records.filter((r) => r.mulligans >= 1),
      'mulliganed',
    )}`,
  );

  lines.push('\n(f) castability of the kept hand, by turn 3');
  lines.push(`  cannot cast anything: ${share(records, (record) => !record.castableByThree)}`);
  lines.push(`  of which colors, not land count: ${share(records, (record) => record.colorBlocked)}`);
  lines.push(
    `  ${conditionalWinRate(
      records.filter((r) => !r.castableByThree),
      'uncastable keep',
    )}` +
      `   ${conditionalWinRate(
        records.filter((r) => r.castableByThree),
        'castable keep',
      )}`,
  );
  lines.push(
    `  ${conditionalWinRate(
      records.filter((r) => r.colorBlocked),
      'color-blocked keep',
    )}`,
  );

  lines.push('\n(g) the paired cohort: dealt sevens inside the land band that cast nothing by turn 3');
  const cohort = records.filter((record) => record.firstHandInBand && !record.firstHandCastable);
  lines.push(`  ${percent(cohort.length / records.length)} of deals (n=${cohort.length})`);
  lines.push(`  ${conditionalWinRate(cohort, 'this cohort')}`);
  lines.push(
    `  ${conditionalWinRate(
      records.filter((record) => record.firstHandInBand && record.firstHandCastable),
      'in band and castable',
    )}`,
  );

  lines.push('\n(h) game length and pair win rates');
  const turns = records.map((record) => record.turns);
  lines.push(`  mean turns: ${(turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(2)}`);
  const pairs = pairWinRates(records);
  lines.push(`  ${[...pairs].map(([deck, rate]) => `${deck} ${percent(rate)}`).join('  ')}`);
  const values = [...pairs.values()];
  lines.push(`  spread: ${percent(Math.max(...values) - Math.min(...values))}`);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function main(): void {
  const setPath = requiredFlag('set');
  const games = Number(flag('games', '30'));
  if (!Number.isInteger(games) || games <= 0) throw new Error('--games needs a positive integer');
  const seed = flag('seed', 'mtg-mulligan-census/v0');
  const decks = decksFor(loadPool(setPath));
  process.stdout.write(`set: ${setPath}\ngames per matchup: ${games}  seed: ${seed}\n`);
  const armed: { arm: CensusArm; records: readonly SeatRecord[] }[] = [];
  for (const arm of ARMS) {
    const started = Date.now();
    const records = censusRoundRobin(decks, arm, { runSeed: seed, gamesPerMatchup: games });
    process.stdout.write(`\n[${arm.label}] swept in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    armed.push({ arm, records });
    report(arm, records);
  }
  const first = armed[0];
  if (first === undefined) return;
  const before = pairWinRates(first.records);
  for (const { arm, records } of armed.slice(1)) {
    process.stdout.write(`\n=== pair win-rate movement: ${first.arm.label} -> ${arm.label} ===\n`);
    const after = pairWinRates(records);
    for (const [deck, rate] of after) {
      const was = before.get(deck) ?? 0;
      process.stdout.write(
        `  ${deck}: ${percent(was)} -> ${percent(rate)}  (${rate - was >= 0 ? '+' : ''}${((rate - was) * 100).toFixed(1)}pp)\n`,
      );
    }
  }
}

main();
