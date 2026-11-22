/**
 * The deck API with no build route: what `npm run play` starts behind the lab.
 *
 * `mtg-j1rg`. The decks a person builds, seals or drafts have to survive the
 * browser they were made in, and the process that can keep them is this one.
 * `npm run deckbench` already serves the same routes, but it is a second command
 * in a second terminal, and a deck saved from the Play tab must not depend on
 * somebody having typed it.
 *
 *   npx tsx packages/decklab/tools/deck-library.ts
 *   npx tsx packages/decklab/tools/deck-library.ts --port 6100 --library out/decks
 *
 * # Why it is a separate launcher rather than a flag on `./deckbench.ts`
 *
 * `@mtg/ui` may not import `@mtg/decklab` — that package reaches `@mtg/data` and
 * therefore `better-sqlite3`, which a browser bundle cannot have — so
 * `packages/ui/tools/play.ts` reaches this server the only way left to it, by
 * spawning a process. What it spawns has to be a launcher that starts a server
 * and nothing else: `deckbench.ts` also spawns the page, so play spawning it
 * would have play start a process whose job is to start play.
 *
 * # It cannot build, and not by forgetting to pass a ceiling
 *
 * There is no `--max-usd` here and no builder to arm with one. A build spends
 * model budget and `deckbench.ts` argues at length why that takes a number typed
 * each time; this launcher is started *for* somebody by another launcher, which
 * is exactly the position from which nobody types anything. So the build route
 * is absent by construction rather than by a flag left off, `GET /deck-api/sets`
 * answers `builds: false`, and the page draws the disabled button and the
 * command that arms it.
 *
 * What it does serve is the deck library, the variation shelf as a reader, and
 * every refusal the pool can state — none of which needs a provider, a network,
 * or a cent.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWorkbenchPool } from '../src/workbench/pool-check';
import { serveDeckWorkbench } from '../src/workbench/server';
import type { RunningWorkbenchServer } from '../src/workbench/server';
import { VariationStore } from '../src/workbench/store';
import { DeckLibraryStore } from '../src/workbench/library-store';
import { loadStagedSets, workbenchSetsOf } from './staged-sets';
import { DEFAULT_DECK_LIBRARY_DIR, DEFAULT_DECK_PORT, DEFAULT_VARIATION_DIR } from './deck-api-defaults';

const DECKLAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(DECKLAB_ROOT, '..', '..');

export interface DeckLibraryArgs {
  readonly port: number;
  readonly libraryDir: string;
  readonly variationDir: string;
}

export function readDeckLibraryArgs(argv: readonly string[]): DeckLibraryArgs {
  let port = DEFAULT_DECK_PORT;
  let libraryDir = DEFAULT_DECK_LIBRARY_DIR;
  let variationDir = DEFAULT_VARIATION_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const raw = argv[index + 1];

    if (arg === '--port') {
      const value = Number(raw);
      if (raw === undefined || !Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error(`--port must be a port number, got ${String(raw)}`);
      }
      port = value;
      index += 1;
      continue;
    }

    if (arg === '--library') {
      if (raw === undefined || raw.startsWith('--')) throw new Error('--library needs a directory');
      libraryDir = raw;
      index += 1;
      continue;
    }

    if (arg === '--variations') {
      if (raw === undefined || raw.startsWith('--')) throw new Error('--variations needs a directory');
      variationDir = raw;
      index += 1;
      continue;
    }

    // A build ceiling is not a flag this launcher has. Named rather than
    // reported as an unknown word, because typing it is a reasonable thing to
    // try and the answer is a different command rather than a different spelling.
    if (arg === '--max-usd') {
      throw new Error(
        'this launcher cannot build decks at any price. Run `npm run deckbench -- --max-usd <dollars>` for that.',
      );
    }

    if (arg !== undefined && arg.startsWith('--')) throw new Error(`no such flag: ${arg}`);
  }

  return { port, libraryDir, variationDir };
}

function fail(message: string): never {
  console.error(`deck-library: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = readDeckLibraryArgs(process.argv.slice(2));
  const { pools, refused } = loadStagedSets(REPO_ROOT);
  // Said only when there is nothing left to offer. This process runs under
  // another launcher's output, and `npm run play` already skips a candidate it
  // has decided against — printing that decision again as an error under the
  // line announcing the set it did open reads as a failure of the run somebody
  // is watching. With no pool at all the reason is the whole message.
  if (pools.length === 0) for (const message of refused) console.error(message);

  const library = new DeckLibraryStore(resolve(REPO_ROOT, args.libraryDir));
  const store = new VariationStore(resolve(REPO_ROOT, args.variationDir));

  let server: RunningWorkbenchServer;
  try {
    server = await serveDeckWorkbench({
      port: args.port,
      host: '127.0.0.1',
      sets: workbenchSetsOf(pools),
      store,
      library,
      checkPool: (criteria) => checkWorkbenchPool(pools, criteria),
    });
  } catch (cause: unknown) {
    fail(
      `could not listen on 127.0.0.1:${String(args.port)} ` +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }

  // One line, because this process usually runs under another launcher's output
  // and the interesting fact is where the decks are being kept.
  console.log(`Saved decks are kept in ${library.directory} (deck API on 127.0.0.1:${String(server.port)}).`);
}

// Guarded the way `./deckbench.ts` is: importing this file for its argument
// reader must not start a server.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((cause: unknown) => {
    fail(cause instanceof Error ? cause.message : String(cause));
  });
}
