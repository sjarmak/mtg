/**
 * `decklab` — build a deck from stated criteria, over the card store or a
 * staged set's own cards.
 *
 * ```
 * npx tsx packages/decklab/src/cli.ts \
 *   --prompt "aggressive red burn" --format modern --colors R \
 *   --archetype aggro --max-card-usd 5
 *
 * npx tsx packages/decklab/src/cli.ts \
 *   --prompt "a fast white weenie deck" --colors W --archetype aggro \
 *   --set packages/setgen/fixtures/sets/tideglass-reach.set.json
 * ```
 *
 * The two pools are `--format` and `--set`, exactly one of them, and `pool.ts`
 * is what refuses the other three combinations. The difference that matters to
 * a person is what they can do with the answer: a store deck is real printings
 * this kernel cannot run, and a `--set` deck is DSL cards it can, so only the
 * second one can be dealt a game.
 *
 * The set file is read here rather than by `@mtg/setgen`, which owns its
 * schema: that package reaches `@mtg/design-data`, which reads its canon off
 * disk at import time, and this package has no reason to carry it. What is
 * needed is the set's code, its name and its cards, and `@mtg/dsl` validates
 * the cards, which is the half that has to be right.
 *
 * The provider is resolved from the environment by `@mtg/llm`: the
 * authenticated `claude` binary locally, a recorded fixture under test. No
 * API key is read here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { closeStore, openStore, DEFAULT_DB_PATH } from '@mtg/data';
import { parseCards } from '@mtg/dsl';
import { resolveProvider } from '@mtg/llm';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { toDeckArtifact } from './artifact';
import type { BuiltDeck } from './build';
import { buildInformedDeck, EmptyUniverseError } from './build';
import {
  DECK_FORMATS,
  DeckCriteriaSchema,
  OpponentPopulationSchema,
  type DeckCriteriaInput,
  type DeckFormat,
} from './criteria';
import type { PoolSet } from './pool';
import { setDeckPool, storeDeckPool } from './pool';
import {
  printedFormatDeckPool,
  toPrintedConstructedDeck,
  type PrintedPoolCatalog,
} from './printed-format-pool';
import { DEFAULT_MAX_ROUNDS, defaultMaxSpendUsd } from './select';

/**
 * The two fields a pool needs off a set file, and nothing else it happens to
 * carry. `cards` is validated by `@mtg/dsl` rather than trusted: the file is
 * external input, and a card that fails the DSL schema is a card the kernel
 * could not run anyway.
 */
const SetFileHeadSchema = z.object({
  set: z.object({ code: z.string().min(1), name: z.string().min(1) }),
  cards: z.array(z.unknown()),
});

const PrintedFormatRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  formats: z.array(
    z.object({
      id: z.string().min(1),
      catalogs: z
        .array(
          z.object({
            code: z.string().min(1),
            file: z.string().min(1),
          }),
        )
        .min(1),
    }),
  ),
});

const DEFAULT_PRINTED_FORMAT_REGISTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/data/printed-formats-v1.json',
);

export function loadPrintedFormatCatalogs(
  formatId: string,
  registryPath = DEFAULT_PRINTED_FORMAT_REGISTRY,
): readonly PrintedPoolCatalog[] {
  const resolvedRegistryPath = resolve(registryPath);
  const registry = PrintedFormatRegistrySchema.parse(JSON.parse(readFileSync(resolvedRegistryPath, 'utf8')));
  const format = registry.formats.find((entry) => entry.id === formatId);
  if (format === undefined) throw new Error(`printed format ${formatId} is not registered`);
  const dataDirectory = dirname(resolvedRegistryPath);
  return format.catalogs.map((entry) => ({
    code: entry.code,
    catalog: parsePrintedCardCatalog(
      JSON.parse(readFileSync(resolve(dataDirectory, format.id, entry.file), 'utf8')),
    ),
  }));
}

function readPoolSet(path: string): PoolSet {
  const parsed = SetFileHeadSchema.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
  return { code: parsed.set.code, name: parsed.set.name, cards: parseCards(parsed.cards) };
}

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
 * The two bounds on the build that are checked here rather than downstream.
 *
 * Everything else a flag carries is checked by `DeckCriteriaSchema` on the first
 * line of the build, which costs nothing. These two are read by the selection
 * loop, which starts *after* the land plan has been asked for and paid for, so a
 * `--max-spend-usd 0` used to buy a live model call before it was told the
 * number was not a number of dollars.
 */
function optionalPositiveNumber(args: ParsedArgs, key: string): number | undefined {
  const value = optionalNumber(args, key);
  if (value === undefined) return undefined;
  if (value <= 0) throw new Error(`--${key} must be a positive number of dollars, got ${value}`);
  return value;
}

function optionalRoundBudget(args: ParsedArgs, key: string): number | undefined {
  const value = optionalNumber(args, key);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${key} must be a whole number of rounds, zero or more, got ${value}`);
  }
  return value;
}

function parseFormat(raw: string): DeckFormat {
  const match = DECK_FORMATS.find((format) => format === raw);
  if (match === undefined) {
    throw new Error(`--format must be one of: ${DECK_FORMATS.join(', ')}`);
  }
  return match;
}

function buildCriteria(args: ParsedArgs, setCodes?: readonly string[]): DeckCriteriaInput {
  const colors = (args.values.get('colors') ?? '')
    .split(/[,\s]+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.toUpperCase());

  const maxDeckUsd = optionalNumber(args, 'max-deck-usd');
  const maxCardUsd = optionalNumber(args, 'max-card-usd');
  const budget =
    maxDeckUsd === undefined && maxCardUsd === undefined
      ? undefined
      : {
          ...(maxDeckUsd === undefined ? {} : { maxDeckUsd }),
          ...(maxCardUsd === undefined ? {} : { maxCardUsd }),
        };

  const themes = (args.values.get('themes') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const size = optionalNumber(args, 'size');
  const landCount = optionalNumber(args, 'lands');
  const maxManaValue = optionalNumber(args, 'max-mv');
  const archetype = args.values.get('archetype');
  const powerBand = args.values.get('power');
  const opponentsPath = args.values.get('opponents');
  const opponentPopulation =
    opponentsPath === undefined
      ? undefined
      : OpponentPopulationSchema.parse(JSON.parse(readFileSync(resolve(opponentsPath), 'utf8')));

  const setPaths = parseSetPaths(args);
  const usesSetPool = setCodes !== undefined || setPaths.length > 0;
  const format = usesSetPool ? undefined : parseFormat(requireValue(args, 'format'));

  return {
    prompt: requireValue(args, 'prompt'),
    ...(format === undefined ? {} : { format }),
    ...(setCodes === undefined ? {} : { sets: [...setCodes] }),
    colors: colors as DeckCriteriaInput['colors'],
    themes,
    ...(size === undefined ? {} : { size }),
    ...(landCount === undefined ? {} : { landCount }),
    ...(maxManaValue === undefined ? {} : { maxManaValue }),
    ...(archetype === undefined ? {} : { archetype }),
    ...(powerBand === undefined ? {} : { powerBand }),
    ...(opponentPopulation === undefined ? {} : { opponentPopulation }),
    ...(budget === undefined ? {} : { budget }),
  };
}

/** Parse the CLI's construction criteria without opening a store or resolving a provider. */
export function deckCriteriaInputFromArgs(argv: readonly string[]): DeckCriteriaInput {
  return buildCriteria(parseArgs(argv));
}

/** The set files `--set` names, comma-separated; empty when the flag is absent. */
function parseSetPaths(args: ParsedArgs): readonly string[] {
  return (args.values.get('set') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * A deck built out of staged sets, which reaches neither the store nor a price.
 *
 * No store handle is opened at all, which is the point rather than an economy:
 * this path must work on a checkout that has never ingested the 656 MB card
 * database, the way `npm run play` works without one.
 */
async function buildFromSets(
  args: ParsedArgs,
  paths: readonly string[],
  options: { readonly maxRounds?: number; readonly maxSpendUsd?: number },
): Promise<BuiltDeck> {
  const criteria = DeckCriteriaSchema.parse(
    buildCriteria(
      args,
      paths.map((path) => readPoolSet(path).code),
    ),
  );
  // Built before the provider is resolved, so criteria a staged set cannot
  // carry are refused before anything is spent on a model call.
  const pool = setDeckPool(
    paths.map((path) => readPoolSet(path)),
    criteria,
  );
  return buildInformedDeck({ pool, provider: resolveProvider(), criteria, ...options });
}

function deckId(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (id.length === 0) throw new Error('--archetype must contain a letter or number');
  return id;
}

async function buildFromPrintedFormat(
  args: ParsedArgs,
  formatId: string,
  maxSpendUsd: number,
): Promise<BuiltDeck> {
  const catalogs = loadPrintedFormatCatalogs(formatId);
  const criteria = DeckCriteriaSchema.parse(
    buildCriteria(
      args,
      catalogs.map((entry) => entry.code),
    ),
  );
  if (criteria.size !== 60) throw new Error('a printed format workbench deck must contain 60 cards');
  const pool = printedFormatDeckPool(formatId, catalogs, criteria);
  const built = await buildInformedDeck({
    pool,
    provider: resolveProvider(),
    criteria,
    maxSpendUsd,
  });
  process.stdout.write(`${built.report}\n`);
  process.stderr.write(`Model spend: $${built.spend.spentUsd.toFixed(4)}\n`);
  if (built.deck.totalCards !== 60 || built.deck.shortfalls.length > 0) return built;
  const archetype = requireValue(args, 'archetype');
  const outputPath = requireValue(args, 'output');
  const deck = toPrintedConstructedDeck(
    deckId(archetype),
    archetype,
    [...built.deck.spells, ...built.deck.lands],
    built.deck.manaBase.basics,
    pool,
  );
  const artifact = {
    schemaVersion: 1,
    kind: 'printed-constructed-deck',
    formatId,
    sourceCodes: pool.sourceCodes,
    archetype: { name: archetype, colors: criteria.colors, plan: criteria.prompt },
    spend: built.spend,
    deck,
  };
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), `${JSON.stringify(artifact, null, 2)}\n`);
  process.stderr.write(`Wrote ${outputPath}\n`);
  return built;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags.has('help') || argv.length === 0) {
    process.stdout.write(USAGE);
    return 0;
  }

  const dbPath = args.values.get('db') ?? DEFAULT_DB_PATH;
  const maxRounds = optionalRoundBudget(args, 'rounds');
  const maxSpendUsd = optionalPositiveNumber(args, 'max-spend-usd');
  const options = {
    ...(maxRounds === undefined ? {} : { maxRounds }),
    ...(maxSpendUsd === undefined ? {} : { maxSpendUsd }),
  };

  const printedFormatId = args.values.get('printed-format');
  if (printedFormatId !== undefined) {
    if (parseSetPaths(args).length > 0 || args.values.get('format') !== undefined) {
      throw new Error('--printed-format cannot be combined with --set or --format');
    }
    if (args.values.get('colors') === undefined) throw new Error('--colors is required');
    requireValue(args, 'archetype');
    requireValue(args, 'output');
    const printedMaxSpendUsd = optionalPositiveNumber(args, 'max-usd');
    if (printedMaxSpendUsd === undefined) throw new Error('--max-usd is required');
    const built = await buildFromPrintedFormat(args, printedFormatId, printedMaxSpendUsd);
    return built.deck.totalCards === 60 && built.deck.shortfalls.length === 0 ? 0 : 1;
  }

  const setPaths = parseSetPaths(args);
  if (setPaths.length > 0) {
    if (args.values.get('artifact') !== undefined) {
      // The artifact carries Scryfall art URLs and a price, read off the store
      // per card. A staged set has its own art manifest and no prices at all, so
      // writing one here would mean inventing both. Refused rather than written
      // half-empty; the workbench lane is where the set-backed artifact lands.
      process.stderr.write(
        '--artifact is not available with --set yet: the deck artifact carries store art\n',
      );
      process.stderr.write('and prices, and a staged set has neither. Drop --artifact.\n');
      return 2;
    }
    const built = await buildFromSets(args, setPaths, options);
    process.stdout.write(`${built.report}\n`);
    return built.deck.shortfalls.length > 0 ? 1 : 0;
  }

  const store = openStore(dbPath, { readonly: true });
  try {
    const criteria = DeckCriteriaSchema.parse(buildCriteria(args));
    const built = await buildInformedDeck({
      pool: storeDeckPool(store, criteria),
      provider: resolveProvider(),
      criteria,
      ...options,
    });
    process.stdout.write(`${built.report}\n`);
    const artifactPath = args.values.get('artifact');
    if (artifactPath !== undefined) {
      // Written while the store is still open: the artifact carries the art
      // URLs, and those are the one thing that cannot be recovered from the
      // report after the handle closes.
      mkdirSync(dirname(resolve(artifactPath)), { recursive: true });
      writeFileSync(artifactPath, `${JSON.stringify(toDeckArtifact(built, store), null, 2)}\n`);
      process.stderr.write(`Wrote ${artifactPath}\n`);
    }
    return built.deck.shortfalls.length > 0 ? 1 : 0;
  } finally {
    closeStore(store);
  }
}

const USAGE = `decklab — build a deck from stated criteria

Required:
  --prompt <text>        what the player asked for, in their words

Exactly one pool:
  --format <name>        ${DECK_FORMATS.join(' | ')} — the card store,
                         real printings this kernel cannot run
  --set <path[,path]>    a staged set's own cards, which it can. No format and
                         no dollar budget applies: a generated set is neither
                         legal nor illegal anywhere, and was never priced
  --printed-format <id>  every catalog registered for a printed draft format

Required with --printed-format:
  --archetype <text>     the deck's archetype name
  --colors W,U           the deck's color identity
  --max-usd <n>          maximum model spend, with no default
  --output <path>        JSON deck entry with exact physical card ids

Optional:
  --colors W,U           deck color identity (default: model chooses)
  --archetype <text>     e.g. aggro, control, reanimator
  --themes a,b           synergy themes
  --power <text>         power band, e.g. "casual", "competitive"
  --opponents <path>     JSON opponent population: stable id plus members with
                         id, share (summing to 1), and strategy
  --size <n>             deck size (default 60)
  --lands <n>            lands in that size (default: the model decides, from
                         the deck's curve and plan; a stated count always wins)
  --max-mv <n>           mana value ceiling
  --max-card-usd <n>     per-card budget
  --max-deck-usd <n>     whole-deck budget
  --rounds <n>           model repair rounds the build is guaranteed, spent on
                         any round that adds a card or names a new problem
                         (default ${DEFAULT_MAX_ROUNDS}); past them the loop keeps asking only
                         while each round still adds spells, up to a ceiling
                         that scales with how many spells the deck needs
  --max-spend-usd <n>    dollars of model spend card selection may reach before
                         it stops asking. The default is what this deck's round
                         ceiling costs — $${defaultMaxSpendUsd(36).toFixed(2)} for an ordinary 60-card
                         build, $${defaultMaxSpendUsd(62).toFixed(2)} for a 100-card one — so no deck size
                         is foreclosed by a figure sized for another. It bounds
                         card selection alone: the land-plan call is made before
                         selection starts and is not counted against it. Not the
                         deck's price either — that is --max-deck-usd
  --db <path>            store path, --format only (default ${DEFAULT_DB_PATH})
  --artifact <path>      also write the deck as a renderable JSON document,
                         art URLs included, for \`npm run lab\` to stage.
                         --format only: the document carries store art and
                         prices, and a staged set has neither

Exits 1 when the deck has shortfalls, so a script can tell.
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
      if (error instanceof EmptyUniverseError) {
        process.stderr.write('Loosen a structural criterion: format, colors, mana value, or budget.\n');
      }
      process.exitCode = 2;
    });
}
