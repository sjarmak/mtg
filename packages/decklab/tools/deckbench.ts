/**
 * `npm run deckbench` — the lab with the deck workbench's server behind it.
 *
 * Two processes, the arrangement `npm run design` and `npm run netplay` both
 * use: a loopback server that holds what a browser cannot, and Vite serving the
 * page and proxying `/deck-api` to it.
 *
 *   npm run deckbench                       — the workbench, read-only
 *   npm run deckbench -- --max-usd 7        — and it can build, up to $7 a deck
 *   npm run deckbench -- --api-port 6100    — the loopback listener elsewhere
 *
 * # Why `--max-usd` is required to build at all
 *
 * The design server may not reach a paid provider under any flag, because a
 * design surface whose button spends money is one misclick from a bill. A deck
 * build cannot be fixture-only — the model choosing the cards is the feature —
 * so the same rule is kept the only other way it can be. Without `--max-usd`
 * this launcher passes no builder, `POST /deck-api/build` answers 404, and the
 * page draws the button disabled beside the command that arms it. There is no
 * default, no environment variable, and no way to spend a cent by forgetting
 * something. A person types a number each time, exactly as `--backend fal`
 * requires `--budget`.
 *
 * The number is a ceiling **per build**, not for the session, and it bounds card
 * selection: the land-plan call is made before selection starts and is not
 * counted against it, which is `../src/select.ts`'s own arrangement.
 *
 * # Why it lives here rather than beside the other launchers
 *
 * `@mtg/ui` may not import `@mtg/decklab` — that package reaches `@mtg/data` and
 * therefore `better-sqlite3`, which a browser bundle cannot have. This
 * launcher's whole job is to start that package's server, so it sits in the
 * package that owns it, the way the design launcher sits beside `@mtg/setgen`'s.
 * What it reaches back into `@mtg/ui` for is the set search and Vite's
 * arguments, which are launcher facts and stay there.
 *
 * # Which sets it offers
 *
 * `./staged-sets.ts` reads them, and says which list and why. `./deck-library.ts`
 * reads the same one, so the pools this picker offers are the pools the library
 * server beside `npm run play` offers.
 *
 * # Beside a lab that is already running
 *
 * Only one of the two processes collides. `packages/ui/public/` has one owner at
 * a time and `../../ui/tools/launcher-lock.ts` is right to refuse a second, but
 * the `/deck-api` server stages nothing and is reached through a proxy whose
 * target is only a port. So a held directory means this run serves the API alone
 * and says which page to open, rather than refusing to start. `planWeb` below is
 * that decision and the one case it cannot serve.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProvider } from '@mtg/llm';
import { buildVariation } from '../src/workbench/build';
import { checkWorkbenchPool, poolsFor } from '../src/workbench/pool-check';
import { defaultMaxSpendUsd, ROUND_COST_USD, roundsCeiling } from '../src/select';
import type { WorkbenchSet } from '../src/workbench/server';
import { serveDeckWorkbench } from '../src/workbench/server';
import type { RunningWorkbenchServer } from '../src/workbench/server';
import { VariationStore } from '../src/workbench/store';
import { DeckLibraryStore } from '../src/workbench/library-store';
import { WorkbenchCriteriaSchema } from '../src/workbench/variation';
import { readLauncherClaim } from '../../ui/tools/launcher-lock';
import type { LauncherClaim } from '../../ui/tools/launcher-lock';
import { loadStagedSets, workbenchSetsOf } from './staged-sets';
import { DEFAULT_DECK_LIBRARY_DIR, DEFAULT_DECK_PORT, DEFAULT_VARIATION_DIR } from './deck-api-defaults';

const DECKLAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(DECKLAB_ROOT, '..', '..');
const UI_ROOT = resolve(REPO_ROOT, 'packages', 'ui');

// The port and the two directories, so the library-only launcher can name them
// without importing this one. Re-exported because they are documented here and
// `../test/deckbench-args.test.ts` reads them off this module.
export { DEFAULT_DECK_LIBRARY_DIR, DEFAULT_DECK_PORT, DEFAULT_VARIATION_DIR } from './deck-api-defaults';

export interface DeckbenchArgs {
  readonly apiPort: number;
  /** Dollars a single build may spend. `undefined` means the build route is off. */
  readonly maxUsd: number | undefined;
  readonly variationDir: string;
}

export function readDeckbenchArgs(argv: readonly string[]): DeckbenchArgs {
  let apiPort = DEFAULT_DECK_PORT;
  let maxUsd: number | undefined;
  let variationDir = DEFAULT_VARIATION_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const raw = argv[index + 1];

    if (arg === '--api-port') {
      const port = Number(raw);
      if (raw === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--api-port must be a port number, got ${String(raw)}`);
      }
      apiPort = port;
      index += 1;
      continue;
    }

    if (arg === '--max-usd') {
      const dollars = Number(raw);
      // Zero is refused rather than treated as "no builds": a person who typed
      // a ceiling meant to arm the button, and silently disarming it would be
      // the confusing half of both behaviors.
      if (raw === undefined || !Number.isFinite(dollars) || dollars <= 0) {
        throw new Error(`--max-usd must be a positive number of dollars, got ${String(raw)}`);
      }
      maxUsd = dollars;
      index += 1;
      continue;
    }

    if (arg === '--variations') {
      if (raw === undefined || raw.startsWith('--')) throw new Error('--variations needs a directory');
      variationDir = raw;
      index += 1;
      continue;
    }

    if (arg !== undefined && arg.startsWith('--')) throw new Error(`no such flag: ${arg}`);
  }

  return { apiPort, maxUsd, variationDir };
}

/**
 * The deck the suggested ceiling is sized for: sixty cards, twenty-four lands.
 *
 * `mtg-yp33.6`. The suggestion used to be $0.50, and `select.ts` records two live
 * rounds at $0.4735 and $0.4980 — so the number this launcher told people to
 * type bought exactly one round of a selection that a 60-card deck is sized at
 * twelve of. Every build made under it stopped part-way by construction. The
 * figure is derived rather than typed, so it follows the loop's own sizing if
 * that changes.
 */
export const SIZED_FOR_SPELLS = 60 - 24;
export const SUGGESTED_MAX_USD = Math.ceil(defaultMaxSpendUsd(SIZED_FOR_SPELLS));

/**
 * What a stated ceiling buys, said in the units the person chose it in.
 *
 * States rather than refuses. A small ceiling is a legitimate thing to want —
 * it is how you spend a dollar to see whether the surface works at all — and
 * the only failure is not knowing what it buys until a deck comes back short.
 */
function buysNote(maxUsd: number): string {
  const rounds = Math.floor(maxUsd / ROUND_COST_USD);
  const sized = defaultMaxSpendUsd(SIZED_FOR_SPELLS);
  const buys =
    rounds < 1
      ? `That is under one round at about $${ROUND_COST_USD.toFixed(2)} a round, so a build gets a single round and stops`
      : `That is about ${String(rounds)} round${rounds === 1 ? '' : 's'} at $${ROUND_COST_USD.toFixed(2)} each`;
  return (
    `${buys}; a ${String(SIZED_FOR_SPELLS + 24)}-card deck is sized at ` +
    `${String(roundsCeiling(SIZED_FOR_SPELLS))} rounds ($${sized.toFixed(2)}). ` +
    'A build that runs out says so in its shortfalls rather than failing.'
  );
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * What to do about the page, given whoever already owns the staged directory.
 *
 * `mtg-yp33.3`. This launcher starts two things and only one of them collides.
 * `packages/ui/public/` is staged by `npm run play` and `npm run lab` under one
 * set of filenames, and `../../ui/tools/launcher-lock.ts` correctly refuses a
 * second writer — two launchers staging into one directory would delete the
 * set, deck and art the first is serving while it kept serving them. But the
 * `/deck-api` server collides with nothing: it writes no staged file, and the
 * page reaches it through a Vite proxy whose target is only a port.
 *
 * So a lab that is already up is not a reason to refuse; it is a page that can
 * be told. This run serves the API alone and says which port to open. The one
 * case it cannot serve is a moved API port: the running page's proxy target was
 * fixed when that process booted (`MTG_DECK_PORT`, defaulted to
 * `DEFAULT_DECK_PORT`), and nothing here can reach in and change it, so
 * `--api-port` against a held directory is refused rather than started on a port
 * the page will never ask.
 */
export type WebPlan =
  | { readonly kind: 'start' }
  | { readonly kind: 'attach'; readonly message: string }
  | { readonly kind: 'refuse'; readonly message: string };

export function planWeb(held: LauncherClaim | null, apiPort: number): WebPlan {
  if (held === null) return { kind: 'start' };
  if (apiPort !== DEFAULT_DECK_PORT) {
    return {
      kind: 'refuse',
      message:
        `\`${held.command}\` is already serving the lab on port ${String(held.port)}, and its page ` +
        `proxies /deck-api to ${String(DEFAULT_DECK_PORT)}: that target was fixed when it started ` +
        'and this run cannot change it.\n' +
        `Drop --api-port to serve the deck API where that page is already looking, or stop that ` +
        'terminal and run this again to start a lab of this run\u2019s own.',
    };
  }
  return {
    kind: 'attach',
    message:
      `\`${held.command}\` is already serving the lab on port ${String(held.port)} (pid ` +
      `${String(held.pid)}, since ${held.at}), so this run serves the deck API alone rather than ` +
      'staging over it.\n' +
      `Open http://localhost:${String(held.port)} and press \u201cDescribe a deck\u201d on the Decks ` +
      'tab. Stop this terminal with Ctrl-C when you are done with it.',
  };
}

function startWeb(deckPort: number): ChildProcess {
  const env = { ...process.env, MTG_DECK_PORT: String(deckPort) };
  // `play.ts` with no set argument: it resolves the flagship, stages every set
  // it found as bundles, and starts Vite. The workbench reads the same candidate
  // list, so its picker and the page's staged sets are the same sets.
  return spawn('npx', ['tsx', join(UI_ROOT, 'tools', 'play.ts')], {
    cwd: UI_ROOT,
    stdio: 'inherit',
    env,
  });
}

async function main(): Promise<void> {
  const args = readDeckbenchArgs(process.argv.slice(2));
  // Decided before anything is bound or read, so a refusal is the first thing on
  // stdout rather than the last line under a banner describing a server that is
  // about to close.
  const plan = planWeb(readLauncherClaim(join(UI_ROOT, 'public')), args.apiPort);
  if (plan.kind === 'refuse') fail(plan.message);

  const { pools, refused } = loadStagedSets(REPO_ROOT);
  for (const message of refused) console.error(message);
  if (pools.length === 0) {
    fail(
      'npm run deckbench: no staged set to build a deck out of. The workbench builds decks from cards ' +
        'this kernel can run, which means a generated set or a reduced reference build.\n' +
        'Produce one with `npm run slice`, or `npm run reference:reduced -- --out out/reference`.',
    );
  }

  const store = new VariationStore(resolve(REPO_ROOT, args.variationDir));
  const library = new DeckLibraryStore(resolve(REPO_ROOT, DEFAULT_DECK_LIBRARY_DIR));
  const sets: readonly WorkbenchSet[] = workbenchSetsOf(pools);

  const maxUsd = args.maxUsd;
  let server: RunningWorkbenchServer;
  try {
    server = await serveDeckWorkbench({
      port: args.apiPort,
      host: '127.0.0.1',
      sets,
      store,
      library,
      // Every refusal the pool itself can state, said while somebody is still
      // choosing sets. It needs no provider and no network — the cards are the
      // ones already in memory above — so it runs on every edit, unarmed server
      // included.
      checkPool: (criteria) => checkWorkbenchPool(pools, criteria),
      ...(maxUsd === undefined
        ? {}
        : {
            builder: async (request) => {
              const criteria = WorkbenchCriteriaSchema.parse(request.criteria);
              return buildVariation({
                // Resolved per build rather than once at startup, so a build
                // refused for want of a provider says so at the moment somebody
                // asked for one instead of at launch.
                provider: resolveProvider(),
                sets: poolsFor(pools, criteria.sets),
                criteria,
                name: request.name,
                parentId: request.parentId,
                maxSpendUsd: maxUsd,
              });
            },
          }),
    });
  } catch (cause: unknown) {
    fail(
      `could not start the deck server on 127.0.0.1:${String(args.apiPort)} ` +
        `(${cause instanceof Error ? cause.message : String(cause)}). ` +
        'Move it with --api-port, and the page follows through MTG_DECK_PORT.',
    );
  }

  console.log(
    `The deck server is on 127.0.0.1:${String(server.port)} and is reachable from this machine only.\n` +
      `Pools: ${sets.map((set) => `${set.code} (${String(set.cardCount)} cards)`).join(', ')}.\n` +
      `Variations are kept in ${store.directory}.\n` +
      (maxUsd === undefined
        ? 'Started with no --max-usd, so the workbench reads and compares but builds nothing. ' +
          `Restart with \`npm run deckbench -- --max-usd ${String(SUGGESTED_MAX_USD)}\` to arm the build button.`
        : `Each build may spend up to $${maxUsd.toFixed(2)} on card selection. ${buysNote(maxUsd)}`),
  );

  if (plan.kind === 'attach') {
    console.log(`\n${plan.message}`);
    // No child to wait on, so this process is what keeps the API up. Ctrl-C is
    // the way out and it needs no handler: the signal ends this process and the
    // listener with it, and nothing here holds a staged file to release.
    return;
  }

  const web = startWeb(server.port);
  web.on('error', (cause: Error) => {
    fail(`could not start the lab (${cause.message})`);
  });
  web.on('exit', (code) => {
    void server.close().then(() => {
      process.exit(code ?? 0);
    });
  });
}

// Guarded the way `design.ts` is: importing this file for its argument reader
// must not start a server.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((cause: unknown) => {
    fail(cause instanceof Error ? cause.message : String(cause));
  });
}
