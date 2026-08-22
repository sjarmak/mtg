/**
 * `decklab` — build a deck from stated criteria against the real card store.
 *
 * ```
 * npx tsx packages/decklab/src/cli.ts \
 *   --prompt "aggressive red burn" --format modern --colors R \
 *   --archetype aggro --max-card-usd 5
 * ```
 *
 * The provider is resolved from the environment by `@mtg/llm`: the
 * authenticated `claude` binary locally, a recorded fixture under test. No
 * API key is read here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeStore, openStore, DEFAULT_DB_PATH } from '@mtg/data';
import { resolveProvider } from '@mtg/llm';
import { toDeckArtifact } from './artifact';
import { buildInformedDeck, EmptyUniverseError } from './build';
import { DECK_FORMATS, type DeckCriteriaInput, type DeckFormat } from './criteria';
import { DEFAULT_MAX_ROUNDS, defaultMaxSpendUsd } from './select';

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

function buildCriteria(args: ParsedArgs): DeckCriteriaInput {
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

  return {
    prompt: requireValue(args, 'prompt'),
    format: parseFormat(requireValue(args, 'format')),
    colors: colors as DeckCriteriaInput['colors'],
    themes,
    ...(size === undefined ? {} : { size }),
    ...(landCount === undefined ? {} : { landCount }),
    ...(maxManaValue === undefined ? {} : { maxManaValue }),
    ...(archetype === undefined ? {} : { archetype }),
    ...(powerBand === undefined ? {} : { powerBand }),
    ...(budget === undefined ? {} : { budget }),
  };
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
  const store = openStore(dbPath, { readonly: true });
  try {
    const built = await buildInformedDeck({
      store,
      provider: resolveProvider(),
      criteria: buildCriteria(args),
      ...(maxRounds === undefined ? {} : { maxRounds }),
      ...(maxSpendUsd === undefined ? {} : { maxSpendUsd }),
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

const USAGE = `decklab — build a deck from stated criteria against the card store

Required:
  --prompt <text>        what the player asked for, in their words
  --format <name>        ${DECK_FORMATS.join(' | ')}

Optional:
  --colors W,U           deck color identity (default: model chooses)
  --archetype <text>     e.g. aggro, control, reanimator
  --themes a,b           synergy themes
  --power <text>         power band, e.g. "casual", "competitive"
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
  --db <path>            store path (default ${DEFAULT_DB_PATH})
  --artifact <path>      also write the deck as a renderable JSON document,
                         art URLs included, for \`npm run lab\` to stage

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
