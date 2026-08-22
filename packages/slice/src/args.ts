/**
 * Argument parsing for `npm run slice`.
 *
 * Boolean and value flags are declared rather than guessed: `--games` with no
 * argument is an error, not a silently-set boolean. An unknown flag is an error
 * too — a typo in a CI invocation that quietly ran the default game count would
 * publish throughput numbers for a run nobody asked for.
 */
import { PROVIDER_NAMES, isProviderName } from '@mtg/llm';
import type { SliceOptions, SliceOptionsInput } from './options';
import {
  DEFAULT_BENCH_GAMES,
  DEFAULT_GAMES_PER_MATCHUP,
  DEFAULT_RUN_SEED,
  isMetricsGate,
  METRICS_GATES,
  resolveSliceOptions,
} from './options';

const BOOLEAN_FLAGS = new Set(['skip-forge', 'no-critique', 'help', 'h']);

const VALUE_FLAGS = new Set([
  'seed',
  'games',
  'workers',
  'provider',
  'brief',
  'fixtures',
  'out',
  'forge-home',
  'store',
  'max-usd',
  'metrics-gate',
  'bench-games',
]);

export const USAGE = `usage: npm run slice -- [options]

  --seed <string>          run seed for every simulation (default ${DEFAULT_RUN_SEED})
  --games <n>              games per color-pair matchup (default ${DEFAULT_GAMES_PER_MATCHUP})
  --workers <n>            simulation worker threads; 0 runs in-process (default 0)
  --provider <name>        LLM provider: ${PROVIDER_NAMES.join(' | ')} (default fixture)
  --brief <path>           set brief JSON (default packages/setgen/briefs/tideglass-reach.json)
  --fixtures <dir>         recorded LLM responses (default packages/setgen/fixtures/llm)
  --out <dir>              run artifacts (default out/slice)
  --metrics-gate <mode>    ${METRICS_GATES.join(' | ')} (default strict)
  --skip-forge             do not run the Forge boot gate at all
  --forge-home <dir>       Forge distribution directory (default tools/forge/dist or FORGE_HOME)
  --store <path>           also write the generated set into a SQLite lab store
  --max-usd <n>            spend ceiling for live providers
  --no-critique            skip the semantic critique pass in set generation
  --bench-games <n>        games for the raw kernel throughput number (default ${DEFAULT_BENCH_GAMES})
  --help                   print this message`;

export interface ParsedArgs {
  readonly help: boolean;
  readonly options: SliceOptions;
}

function positiveInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function nonNegativeInteger(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${flag} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function collect(argv: readonly string[]): {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith('-')) throw new Error(`unexpected argument ${JSON.stringify(arg)}\n\n${USAGE}`);
    const key = arg.replace(/^-+/, '');
    if (BOOLEAN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`unknown flag ${JSON.stringify(arg)}\n\n${USAGE}`);
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`--${key} needs a value\n\n${USAGE}`);
    values.set(key, next);
    index += 1;
  }
  return { values, flags };
}

export function parseSliceArgs(argv: readonly string[]): ParsedArgs {
  const { values, flags } = collect(argv);
  if (flags.has('help') || flags.has('h')) {
    return { help: true, options: resolveSliceOptions() };
  }

  const input: Record<string, unknown> = {};

  const seed = values.get('seed');
  if (seed !== undefined) {
    if (seed.trim().length === 0) throw new Error('--seed must not be empty');
    input['runSeed'] = seed;
  }

  const games = values.get('games');
  if (games !== undefined) input['gamesPerMatchup'] = positiveInteger('games', games);

  const workers = values.get('workers');
  if (workers !== undefined) input['workers'] = nonNegativeInteger('workers', workers);

  const benchGames = values.get('bench-games');
  if (benchGames !== undefined) input['benchGames'] = positiveInteger('bench-games', benchGames);

  const provider = values.get('provider');
  if (provider !== undefined) {
    if (!isProviderName(provider)) {
      throw new Error(
        `--provider must be one of ${PROVIDER_NAMES.join(', ')}, got ${JSON.stringify(provider)}`,
      );
    }
    input['provider'] = provider;
  }

  const gate = values.get('metrics-gate');
  if (gate !== undefined) {
    if (!isMetricsGate(gate)) {
      throw new Error(
        `--metrics-gate must be one of ${METRICS_GATES.join(', ')}, got ${JSON.stringify(gate)}`,
      );
    }
    input['metricsGate'] = gate;
  }

  const maxUsd = values.get('max-usd');
  if (maxUsd !== undefined) {
    const value = Number(maxUsd);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--max-usd must be a positive number, got ${JSON.stringify(maxUsd)}`);
    }
    input['maxUsd'] = value;
  }

  for (const [flag, field] of [
    ['brief', 'briefPath'],
    ['fixtures', 'fixtureDir'],
    ['out', 'outDir'],
    ['forge-home', 'forgeHome'],
    ['store', 'storePath'],
  ] as const) {
    const value = values.get(flag);
    if (value !== undefined) input[field] = value;
  }

  if (flags.has('skip-forge')) input['skipForge'] = true;
  if (flags.has('no-critique')) input['critique'] = false;

  return { help: false, options: resolveSliceOptions(input as SliceOptionsInput) };
}
