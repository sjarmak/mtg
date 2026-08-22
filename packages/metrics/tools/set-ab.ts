/**
 * A/B two card pools through the balance gate's own sweep.
 *
 * The gate answers "is this set inside the bands". This answers a different
 * question: "did this content edit move anything, or is the move dice?" Both
 * arms run through `test/balance/round-robin.ts` — the same decks, bots, volume
 * and seeds the gate uses — so the only difference between the arms is the
 * files named on the command line.
 *
 *   npx tsx packages/metrics/tools/set-ab.ts <a.json> <b.json>
 *   MTG_AB_SEEDS=3 npx tsx packages/metrics/tools/set-ab.ts a.json b.json
 *
 * Every per-pair delta is printed against `seedDeviation('balance.pair.*')`,
 * the same noise floor `withinNoise` abstains on, scaled to the volume the run
 * actually bought. A delta under that floor is dice, and the tool says so
 * rather than leaving the reader to compare a number to a number.
 *
 * It also prints each pool's battlefield-inert commons, computed by the same
 * rule `@mtg/setgen`'s `cardContribution` uses (an instant or sorcery whose
 * every priced effect leaves the board alone), because the edits this tool is
 * used to judge are usually edits to that count.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { hasAbilityEffects, isPricedEffectKind } from '@mtg/dsl';
import { colorPairWinRates, scaledSeedDeviation } from '@mtg/metrics';
import type { ColorPairRecord } from '@mtg/metrics';
import { BALANCE_RUN_SEED, decksFor, gamesPerMatchup, runRoundRobin } from '../test/balance/round-robin';
import { loadSet } from '../test/balance/set';

const INERT_EFFECTS = new Set(['counterSpell', 'drawCards', 'gainLife', 'millCards']);

function effectKinds(card: Card): string[] {
  const own = card.kind === 'instant' || card.kind === 'sorcery' ? card.effects : [];
  const modal = (card as { modes?: readonly { readonly effects: readonly { readonly kind: string }[] }[] })
    .modes;
  return [
    ...own.map((effect) => effect.kind),
    ...(modal ?? []).flatMap((mode) => mode.effects.map((effect) => effect.kind)),
    ...card.abilities.flatMap((ability) =>
      hasAbilityEffects(ability) ? ability.effects.map((effect) => effect.kind) : [],
    ),
  ].filter((kind) => isPricedEffectKind(kind as never));
}

export function inertCards(pool: readonly Card[]): readonly Card[] {
  return pool.filter((card) => {
    if (card.kind !== 'instant' && card.kind !== 'sorcery') return false;
    const kinds = effectKinds(card);
    return kinds.length > 0 && kinds.every((kind) => INERT_EFFECTS.has(kind));
  });
}

function seedsFor(runs: number): readonly string[] {
  return Array.from({ length: runs }, (_v, index) =>
    index === 0 ? BALANCE_RUN_SEED : `${BALANCE_RUN_SEED}#${String(index)}`,
  );
}

function seedCount(env: NodeJS.ProcessEnv): number {
  const raw = env['MTG_AB_SEEDS'];
  if (raw === undefined) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`MTG_AB_SEEDS must be a positive integer, got ${raw}`);
  return parsed;
}

interface Arm {
  readonly label: string;
  readonly path: string;
  /** Mean win rate per pair over the seeds, plus the first seed's Wilson interval. */
  readonly rates: ReadonlyMap<string, number>;
  readonly records: readonly ColorPairRecord[];
  readonly spread: number | null;
  readonly inert: readonly Card[];
}

async function measure(path: string, seeds: readonly string[], games: number): Promise<Arm> {
  const subject = loadSet(path);
  const decks = decksFor(subject.pool, subject.label);
  const sums = new Map<string, number[]>();
  let first: readonly ColorPairRecord[] = [];
  let spread: number | null = null;
  for (const [index, seed] of seeds.entries()) {
    const run = await runRoundRobin(decks, games, seed);
    const report = colorPairWinRates(run.logs);
    if (index === 0) {
      first = report.records;
      spread = report.spread;
    }
    for (const record of report.records) {
      if (record.winRate.value === null) continue;
      const bucket = sums.get(record.pair) ?? [];
      bucket.push(record.winRate.value);
      sums.set(record.pair, bucket);
    }
  }
  const rates = new Map(
    [...sums].map(([pair, values]) => [pair, values.reduce((sum, v) => sum + v, 0) / values.length]),
  );
  return { label: subject.label, path, rates, records: first, spread, inert: inertCards(subject.pool) };
}

function table(arm: Arm): string {
  const rows = arm.records.map((record) => {
    const rate = record.winRate.value;
    const interval = record.interval.value;
    const ci =
      interval === null ? 'n/a' : `[${(interval.low * 100).toFixed(1)}, ${(interval.high * 100).toFixed(1)}]`;
    return `  ${record.pair}  ${rate === null ? '  n/a' : (rate * 100).toFixed(1).padStart(5)}%  ${ci.padEnd(16)} ${String(record.games).padStart(5)} games`;
  });
  return rows.join('\n');
}

async function main(): Promise<void> {
  const [a, b] = process.argv.slice(2);
  if (a === undefined || b === undefined) throw new Error('set-ab: give it two paths to DSL set files');
  const seeds = seedsFor(seedCount(process.env));
  const games = gamesPerMatchup();
  const floor = scaledSeedDeviation('balance.pair.WU', games * 45) ?? 0.02;
  const arms = [await measure(a, seeds, games), await measure(b, seeds, games)];
  for (const [index, arm] of arms.entries()) {
    console.log(`\nARM ${'AB'[index] ?? '?'}: ${arm.label}\n  ${arm.path}`);
    console.log(
      `  battlefield-inert spells: ${arm.inert.map((card) => `${card.name} (${card.colors.join('') || 'C'})`).join(', ') || 'none'}`,
    );
    console.log(`  pair       rate  95% Wilson       volume`);
    console.log(table(arm));
    console.log(`  spread (seed 1): ${arm.spread?.toFixed(4) ?? 'n/a'}`);
  }
  const [armA, armB] = arms;
  if (armA === undefined || armB === undefined) return;
  console.log(
    `\nDELTA B - A, mean over ${String(seeds.length)} seed(s); noise floor ${floor.toFixed(3)} (seedDeviation for a pair, scaled to this volume)`,
  );
  for (const pair of [...armA.rates.keys()].sort()) {
    const before = armA.rates.get(pair);
    const after = armB.rates.get(pair);
    if (before === undefined || after === undefined) continue;
    const delta = after - before;
    const verdict = Math.abs(delta) >= floor ? 'OUTSIDE the noise' : 'inside the noise';
    console.log(
      `  ${pair}  ${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%  ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts  ${verdict}`,
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main();
