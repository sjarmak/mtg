/**
 * `cube` — construct a cube from stated criteria against the real card store.
 *
 * ```
 * npx tsx packages/cube/src/cli.ts \
 *   --prompt "a low-power singleton cube for eight drafters" --format modern \
 *   --max-card-usd 5 --archetypes "boros aggro:WR:24, dimir control:UB:24"
 * ```
 *
 * The provider is resolved from the environment by `@mtg/llm`: the
 * authenticated `claude` binary locally, a recorded fixture under test. No API
 * key is read here.
 *
 * Exits 1 when the finished cube has findings, so a script can tell a cube that
 * met its criteria from one that came back short or lopsided.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeStore, openStore, DEFAULT_DB_PATH } from '@mtg/data';
import { resolveProvider } from '@mtg/llm';
import { parseSetFile } from '@mtg/setgen';
import type { AvailabilityOptions } from './availability';
import { DEFAULT_AVAILABILITY_DRAFTS, DEFAULT_AVAILABILITY_SEED } from './availability';
import type { AssembleCubeInput, ConstructedCube } from './construct';
import {
  assembleCube,
  constructCube,
  DEFAULT_CUBE_ROUNDS,
  defaultMaxCubeSpendUsd,
  EmptyCubePoolError,
} from './construct';
import {
  CUBE_DEFAULT_CARDS_PER_SEAT,
  CUBE_DEFAULT_SEATS,
  CUBE_DEFAULT_SIZE,
  CubeCriteriaSchema,
  parseArchetypeSpecs,
  type CubeCriteriaInput,
} from './criteria';
import { DECK_FORMATS, type DeckFormat } from '@mtg/decklab';
import { formatCubeReport } from './report';
import { setCubePool, UnpriceableCubePoolError } from './set-pool';

interface ParsedArgs {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
    } else {
      values.set(key, next);
      index += 1;
    }
  }
  return { values, flags };
}

function requireValue(args: ParsedArgs, key: string): string {
  const value = args.values.get(key);
  if (value === undefined) throw new Error(`--${key} is required`);
  return value;
}

function optionalNumber(args: ParsedArgs, key: string): number | undefined {
  const raw = args.values.get(key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number, got ${raw}`);
  return value;
}

/**
 * A dollar bound, refused here rather than inside the construction.
 *
 * Everything else the CLI accepts is checked by `CubeCriteriaSchema` before a
 * model call is made; the spend bound is read by the loop, which is past the
 * point where the store is open. A typo must cost neither a live call nor a
 * 626 MB file handle.
 */
function optionalSpendUsd(args: ParsedArgs, key: string): number | undefined {
  const value = optionalNumber(args, key);
  if (value === undefined) return undefined;
  if (value <= 0) throw new Error(`--${key} must be a positive number of dollars, got ${String(value)}`);
  return value;
}

function parseFormat(raw: string): DeckFormat {
  const match = DECK_FORMATS.find((format) => format === raw);
  if (match === undefined) throw new Error(`--format must be one of: ${DECK_FORMATS.join(', ')}`);
  return match;
}

function buildCriteria(args: ParsedArgs): CubeCriteriaInput {
  const size = optionalNumber(args, 'size');
  const seats = optionalNumber(args, 'seats');
  const cardsPerSeat = optionalNumber(args, 'cards-per-seat');
  const maxCardUsd = optionalNumber(args, 'max-card-usd');
  const tolerance = optionalNumber(args, 'color-tolerance');
  const archetypes = args.values.get('archetypes');

  return {
    prompt: requireValue(args, 'prompt'),
    format: parseFormat(requireValue(args, 'format')),
    singleton: !args.flags.has('allow-multiples'),
    ...(size === undefined ? {} : { size }),
    ...(seats === undefined ? {} : { seats }),
    ...(cardsPerSeat === undefined ? {} : { cardsPerSeat }),
    ...(maxCardUsd === undefined ? {} : { maxCardUsd }),
    ...(tolerance === undefined ? {} : { colorBalanceTolerance: tolerance }),
    ...(archetypes === undefined ? {} : { archetypes: [...parseArchetypeSpecs(archetypes)] }),
  };
}

/** The bounds the loop runs under, in the shape both entry points take. */
function buildBounds(
  args: ParsedArgs,
): Pick<AssembleCubeInput, 'maxRounds' | 'maxSpendUsd' | 'availability'> {
  const rounds = optionalNumber(args, 'rounds');
  const maxSpendUsd = optionalSpendUsd(args, 'max-spend-usd');
  return {
    ...(rounds === undefined ? {} : { maxRounds: rounds }),
    ...(maxSpendUsd === undefined ? {} : { maxSpendUsd }),
    availability: buildAvailabilityOptions(args),
  };
}

/**
 * The measurement bounds a command line states, as the measurement takes them.
 *
 * Exported because the only other path from `--draft-seed` to a share is a whole
 * construction, which needs a store and a paid provider; a seed that reaches the
 * report but not the drafts is the failure this makes visible, and it is the
 * whole of what makes a published share reproducible.
 */
export function availabilityOptions(argv: readonly string[]): AvailabilityOptions {
  return buildAvailabilityOptions(parseArgs(argv));
}

/**
 * How many drafts the finished list is measured over, and under which seed.
 *
 * Refused here rather than inside the measurement for the reason `--max-spend-usd`
 * is: the drafts run after the store is open and the model has been paid, so a
 * typo must not cost a construction.
 */
function buildAvailabilityOptions(args: ParsedArgs): AvailabilityOptions {
  const drafts = optionalNumber(args, 'drafts');
  if (drafts !== undefined && (!Number.isInteger(drafts) || drafts < 1)) {
    throw new Error(`--drafts must be a positive whole number of drafts, got ${String(drafts)}`);
  }
  const seed = args.values.get('draft-seed');
  return {
    ...(drafts === undefined ? {} : { drafts }),
    ...(seed === undefined ? {} : { seed }),
  };
}

/**
 * A cube cut from a generated set, which reaches neither the store nor a price.
 *
 * The set file is read and validated by `@mtg/setgen`, which owns its schema;
 * this is only the wiring from a path to a pool.
 */
async function constructFromSet(args: ParsedArgs, path: string): Promise<ConstructedCube> {
  const file = parseSetFile(JSON.parse(readFileSync(resolve(path), 'utf8')));
  const criteria = CubeCriteriaSchema.parse(buildCriteria(args));
  // Built before the provider is resolved, so criteria a generated set cannot
  // carry are refused without a backend being reached for.
  const pool = setCubePool({ code: file.set.code, name: file.set.name, cards: file.cards }, criteria);
  return assembleCube({ pool, provider: resolveProvider(), criteria, ...buildBounds(args) });
}

async function constructFromStore(args: ParsedArgs): Promise<ConstructedCube> {
  const store = openStore(args.values.get('db') ?? DEFAULT_DB_PATH, { readonly: true });
  try {
    return await constructCube({
      store,
      provider: resolveProvider(),
      criteria: buildCriteria(args),
      ...buildBounds(args),
    });
  } finally {
    closeStore(store);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags.has('help') || argv.length === 0) {
    process.stdout.write(USAGE);
    return 0;
  }

  // Read before either pool is built, so a bad bound costs neither a model call
  // nor a handle on a 626 MB file.
  buildBounds(args);

  const set = args.values.get('set');
  const cube = set === undefined ? await constructFromStore(args) : await constructFromSet(args, set);
  process.stdout.write(formatCubeReport(cube));
  return cube.validation.ok ? 0 : 1;
}

const USAGE = `cube — construct a cube from stated criteria, over the card store or a generated set

Required:
  --prompt <text>          what the designer asked for, in their words
  --format <name>          ${DECK_FORMATS.join(' | ')}

Optional:
  --set <path>             build the cube out of a generated set's own cards
                           instead of the card store: every card in the file is
                           the pool, no card outside it exists, and neither
                           format legality nor a price ceiling applies, because
                           a generated card has neither
  --archetypes <spec>      name:colors:minPlayable[:minAvailability], comma-
                           separated, e.g. "boros aggro:WR:24:0.25, dimir
                           control:UB:24". The model tags every card it proposes
                           with these names and the finished cube is measured
                           against the minimums. minAvailability is the share of
                           seats across the measured drafts that must be able to
                           assemble the archetype; state it to be failed on it,
                           omit it to have it measured and reported only. A miss
                           where this pod's own pack deals a seat fewer castable
                           spells than a deck needs abstains instead of failing —
                           the seat could not have assembled it however good the
                           list is, which is a fact about --cards-per-seat and
                           --seats rather than about the archetype. A cube that
                           states no archetypes is built and measured without
                           them.
  --size <n>               cards in the cube (default ${String(CUBE_DEFAULT_SIZE)})
  --seats <n>              drafters in the pod (default ${String(CUBE_DEFAULT_SEATS)})
  --cards-per-seat <n>     cards each drafter takes (default ${String(CUBE_DEFAULT_CARDS_PER_SEAT)}). It
                           bounds availability outright, and more tightly the
                           more colors the cube runs: a seat dealt fewer
                           castable spells than a deck needs assembles no
                           archetype however good the list is. The report prints
                           that deal beside every share for exactly that reason
  --max-card-usd <n>       per-card price ceiling; refused with --set, which has
                           no prices to hold to it
  --color-tolerance <n>    how far a color's share may sit from an even share of
                           the colors the cube's archetypes span — a fifth when
                           it states none — as a fraction (default 0.05)
  --allow-multiples        drop the singleton rule, up to the game's four copies.
                           Such a cube is measured but not drafted: the draft
                           runtime deals a list of distinct cards, so a list
                           holding one twice reports why instead of a share
  --rounds <n>             model repair rounds (default ${String(DEFAULT_CUBE_ROUNDS)})
  --max-spend-usd <n>      dollars of model spend the construction may reach
                           before it stops asking. The default is what this
                           cube's rounds cost — $${defaultMaxCubeSpendUsd(CUBE_DEFAULT_SIZE, DEFAULT_CUBE_ROUNDS).toFixed(2)} at the default ${String(CUBE_DEFAULT_SIZE)} cards,
                           $${defaultMaxCubeSpendUsd(45, DEFAULT_CUBE_ROUNDS).toFixed(2)} at 45 — so no cube size is foreclosed by a
                           figure sized for another
  --drafts <n>             seeded drafts the finished list is measured over
                           (default ${String(DEFAULT_AVAILABILITY_DRAFTS)}); more drafts narrow every
                           reported share and cost linear time
  --draft-seed <text>      seed those drafts run under (default ${DEFAULT_AVAILABILITY_SEED})
  --db <path>              store path (default ${DEFAULT_DB_PATH})

The finished list is drafted: --drafts seeded pods, each seat's pool built into
a deck in every stated archetype's colors, and the share of seats that could
assemble each one reported beside the census. Only a singleton cube built with
--set is drafted, because the draft runtime and the deck builder take DSL cards
and the runtime deals each of them once; a cube cut from the card store, or one
built with --allow-multiples, prints that as its reason instead of a number.

Exits 1 when the finished cube has findings, so a script can tell.
`;

const entry = process.argv[1];
const invokedDirectly = entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      if (error instanceof EmptyCubePoolError) {
        process.stderr.write('Loosen a structural criterion: format or price ceiling.\n');
      }
      if (error instanceof UnpriceableCubePoolError) {
        process.stderr.write('Drop --max-card-usd, or build this cube over the store instead of --set.\n');
      }
      process.exitCode = 2;
    });
}
