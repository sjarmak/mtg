#!/usr/bin/env -S npx tsx
/**
 * `tsx packages/setgen/tools/shape-census.ts <set.json> [...]` — which card
 * shapes each named pool contains, and which it contains none of.
 *
 * The sibling of `pool-census.ts`, asking the other question. That one reads the
 * effect vocabulary: what a pool's cards *do*. This one reads
 * `@mtg/dsl`'s `CARD_SHAPES`: what a pool's cards *are*, in the terms a render
 * path or a kernel path cares about — a planeswalker has a second fit ladder, a
 * modal card keeps its own effect list empty, an Equipment carries its stat
 * change in an equip clause rather than a static ability.
 *
 * It exists because that question was answered by memory. A gate opens one
 * fixture and reports on that fixture; whether the fixture holds the shape the
 * gate's assertion is about is a separate fact, and until this file nothing
 * computed it. `packages/ui/test/card-fit.browser.test.ts` held the rules-box
 * ladder to a real browser for months while the build it opened printed no
 * planeswalker, so the loyalty ladder's arithmetic was never once measured; it
 * was under the browser on all three walkers the day it finally was.
 *
 * **It reads and never writes**, and every pool is an argument. The same two
 * rules `pool-census.ts` states, for the same two reasons: stdout is the whole
 * output, and a census with a path baked into it keeps answering about whichever
 * set was interesting the day it was written. Several paths are allowed because
 * the interesting reading is a comparison — a shape one pool has and another
 * does not is exactly the blind spot this is for — and the last column names it.
 *
 *   tsx packages/setgen/tools/shape-census.ts packages/setgen/fixtures/sets/*.set.json
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SHAPES, shapeCounts } from '@mtg/dsl';
import type { CardShape } from '@mtg/dsl';
import { parseSetFile } from '../src/index';

export interface PoolShapes {
  /** What the pool was named on the command line. */
  readonly subject: string;
  readonly cards: number;
  readonly counts: ReadonlyMap<CardShape, number>;
}

export function poolShapes(subject: string, document: unknown): PoolShapes {
  const set = parseSetFile(document);
  return { subject, cards: set.cards.length, counts: shapeCounts(set.cards) };
}

/**
 * One row per shape, one column per pool, and a last column naming the pools
 * that print none of it.
 *
 * The absence column is the reading worth having, so it is not left to the
 * reader to scan a row of zeros for it.
 */
export function formatShapeCensus(pools: readonly PoolShapes[]): string {
  const width = Math.max(12, ...pools.map((pool) => pool.subject.length + 1));
  const header = `${'shape'.padEnd(20)}${pools.map((pool) => pool.subject.padStart(width)).join('')}   absent from`;
  const counts = `${'cards'.padEnd(20)}${pools.map((pool) => String(pool.cards).padStart(width)).join('')}`;
  const rows = CARD_SHAPES.map((shape) => {
    const cells = pools.map((pool) => String(pool.counts.get(shape) ?? 0).padStart(width)).join('');
    const absent = pools.filter((pool) => (pool.counts.get(shape) ?? 0) === 0).map((pool) => pool.subject);
    const note = absent.length === pools.length ? 'every pool named' : absent.join(', ');
    return `${shape.padEnd(20)}${cells}   ${note}`;
  });
  return [header, counts, '', ...rows].join('\n');
}

export function main(argv: readonly string[]): number {
  if (argv.length === 0) throw new Error('usage: shape-census.ts <set.json> [<set.json> ...]');
  const pools = argv.map((argument) => {
    const path = resolve(process.cwd(), argument);
    return poolShapes(basename(path, '.set.json'), JSON.parse(readFileSync(path, 'utf8')) as unknown);
  });
  console.log(formatShapeCensus(pools));
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
