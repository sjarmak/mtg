/** Explicit bounded discovery runner; results remain non-admission evidence. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { withForgeLock } from '../../slice/tools/test-load/host-lock';
import { observedSeedsFromPlan } from './printed-observed-seed-plan';
import { runPrintedObservedSweep } from './printed-observed-sweep';

const { values } = parseArgs({
  options: {
    format: { type: 'string' },
    catalog: { type: 'string', multiple: true },
    mode: { type: 'string' },
    'deck-strategy': { type: 'string' },
    'catalog-targets-per-deck': { type: 'string' },
    'seed-start': { type: 'string' },
    'seed-plan': { type: 'string' },
    count: { type: 'string' },
    output: { type: 'string' },
    'timeout-ms': { type: 'string' },
    'maximum-turns': { type: 'string' },
    'decision-budget': { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (
  !values.format ||
  !values.catalog?.length ||
  !values.mode ||
  !values.output ||
  !values['timeout-ms'] ||
  !values['maximum-turns'] ||
  !values['decision-budget']
) {
  throw new Error(
    'Usage: printed-observed-sweep --format <format.json> --catalog <catalog.json> [--catalog <catalog.json>] --mode <draft|sealed> [--deck-strategy <limited|catalog-coverage>] [--catalog-targets-per-deck <1-16>] (--seed-plan <plan.json> | --seed-start <n> --count <1-100>) --output <directory> --timeout-ms <n> --maximum-turns <n> --decision-budget <n>',
  );
}
if (values.mode !== 'draft' && values.mode !== 'sealed')
  throw new Error('Sweep mode must be draft or sealed');
// Read once into locals narrowed by the checks above: the property accesses
// below cross into withForgeLock's callback, a separate function scope where
// TypeScript cannot see back to these guards.
const format = values.format;
const catalogs = values.catalog;
const mode = values.mode;
const output = values.output;
if (
  values['deck-strategy'] !== undefined &&
  values['deck-strategy'] !== 'limited' &&
  values['deck-strategy'] !== 'catalog-coverage'
)
  throw new Error('Sweep deck-strategy must be limited or catalog-coverage');
const deckStrategy = values['deck-strategy'];
const catalogTargetsPerDeck =
  values['catalog-targets-per-deck'] === undefined ? undefined : Number(values['catalog-targets-per-deck']);
if (
  catalogTargetsPerDeck !== undefined &&
  (values['deck-strategy'] !== 'catalog-coverage' ||
    !Number.isInteger(catalogTargetsPerDeck) ||
    catalogTargetsPerDeck < 1 ||
    catalogTargetsPerDeck > 16)
)
  throw new Error('catalog-targets-per-deck requires catalog-coverage and an integer from 1 to 16');
const hasSeedPlan = values['seed-plan'] !== undefined;
const hasSeedRange = values['seed-start'] !== undefined || values.count !== undefined;
if (hasSeedPlan === hasSeedRange || (hasSeedRange && (!values['seed-start'] || !values.count)))
  throw new Error('Provide exactly one complete seed source: --seed-plan or --seed-start with --count');

let seeds: number[];
if (values['seed-plan']) {
  seeds = [
    ...observedSeedsFromPlan(JSON.parse(readFileSync(resolve(values['seed-plan']), 'utf8')) as unknown, mode),
  ];
} else {
  const start = Number(values['seed-start']);
  const count = Number(values.count);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isInteger(count) || count < 1 || count > 100)
    throw new Error('Sweep seed-start/count must be nonnegative and count must be from 1 to 100');
  seeds = Array.from({ length: count }, (_, index) => start + index);
}
// runPrintedObservedSweep drives the installed Forge diagnostic backend; take the
// host-wide Forge lock (mtg-b9eom) so this never overlaps another lane's JVMs.
await withForgeLock(`printed-observed-sweep-cli pid ${process.pid}`, async () =>
  runPrintedObservedSweep({
    format: JSON.parse(readFileSync(resolve(format), 'utf8')) as unknown,
    catalogs: catalogs.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown),
    mode,
    ...(deckStrategy === undefined ? {} : { deckStrategy }),
    ...(catalogTargetsPerDeck === undefined ? {} : { catalogTargetsPerDeck }),
    seeds,
    outputDirectory: resolve(output),
    timeoutMs: Number(values['timeout-ms']),
    maximumTurns: Number(values['maximum-turns']),
    decisionBudget: Number(values['decision-budget']),
  }),
);
