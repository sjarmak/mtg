/**
 * `npm run design` — the lab with the set designer's server behind it.
 *
 * `mtg-yddw.1`. Two processes, the same arrangement `npm run netplay` uses: a
 * loopback server that holds the judgment, and Vite serving the page and
 * proxying `/design-api` to it. The page cannot hold the judgment itself,
 * because the schema that decides what a legal brief is reaches
 * `@mtg/design-data`, which reads its canon off disk at import time.
 *
 *   npm run design                      — the lab, the designer, the flagship set
 *   npm run design -- --api-port 6000   — the loopback listener somewhere else
 *   npm run design -- --no-run          — validate and plan, but replay nothing
 *
 * # Why it lives here rather than beside the other launchers
 *
 * `@mtg/ui` may not import `@mtg/setgen` — `packages/ui/test/analysis/
 * calibration-boundary.test.ts` fails the whole package when it does, because
 * that package's canon is read off disk at import time and a browser bundle
 * cannot have it. This launcher's whole job is to start that server, so it sits
 * in the package that owns it, the way the curation writer sits beside the
 * pipeline it writes for. What it reaches back into `@mtg/ui` for is the set
 * search and Vite's arguments, which are launcher facts and stay there.
 *
 * # Why it does not stage a set, and does not refuse without one
 *
 * `play.ts` resolves a playable set and fails when it finds none, which is right
 * for a launcher whose whole purpose is a table. Designing a set is the one
 * thing in this lab that is about a set that does not exist yet, so a launcher
 * that refused to open without one would refuse exactly the person it is for. So
 * this one spawns `play.ts` when a set can be found and a bare Vite when it
 * cannot, and says which on stdout. The Design tab is the same either way; the
 * other five tabs are the ones that lose their content, and each already names
 * the command that stages it.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureRunner, serveDesign } from '../src/index';
import type { RunningDesignServer } from '../src/index';
import { resolveSet } from '../../ui/tools/resolve-set';
import { flagshipOnly, SET_CANDIDATES } from '../../ui/tools/set-candidates';
import { viteArgsFor } from '../../ui/tools/play-args';

const SETGEN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_ROOT = resolve(SETGEN_ROOT, '..', 'ui');
const SETGEN_FIXTURES = resolve(SETGEN_ROOT, 'fixtures', 'llm');
const SETGEN_RUN_MANIFEST = resolve(
  SETGEN_ROOT,
  'fixtures',
  'runs',
  'tideglass-reach-2026-08-09T22-30-10Z.json',
);

/** The loopback port `@mtg/ui`'s `vite.config.ts` proxies `/design-api` to by default. */
export const DEFAULT_DESIGN_PORT = 5276;

interface DesignArgs {
  readonly apiPort: number;
  /** Whether `POST /design-api/run` exists at all. */
  readonly withRunner: boolean;
}

/**
 * The flags, and one of them is a lock rather than a preference.
 *
 * `--no-run` leaves the server with no runner, which makes the run route answer
 * 404 and the page draw no run button. Nothing about it saves money — a replay
 * is free and cannot reach a provider — and it is here because a fixture replay
 * of a 250-card brief is a minute of one core, and a person editing a brief on a
 * laptop may want the surface without it.
 */
export function readDesignArgs(argv: readonly string[]): DesignArgs {
  let apiPort = DEFAULT_DESIGN_PORT;
  let withRunner = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-run') {
      withRunner = false;
      continue;
    }
    if (arg !== '--api-port') continue;
    const raw = argv[index + 1];
    const port = Number(raw);
    if (raw === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`--api-port must be a port number, got ${String(raw)}`);
    }
    apiPort = port;
    index += 1;
  }
  return { apiPort, withRunner };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * The lab over a staged set, or a bare Vite when there is no set to stage.
 *
 * `resolveSet` is asked for the flagship the way `play.ts` asks; a checkout with
 * nothing built comes back empty and that is a normal state here rather than a
 * failure, so the fallback is the second branch and not an error.
 */
function startWeb(designPort: number): ChildProcess {
  const document = resolveSet(flagshipOnly(SET_CANDIDATES), undefined);
  const env = { ...process.env, MTG_DESIGN_PORT: String(designPort) };
  if (!document.ok) {
    console.log(
      `No playable set was found, so the other five tabs open empty; the Design tab does not need one.\n${document.message}`,
    );
    return spawn('npx', viteArgsFor(undefined), { cwd: UI_ROOT, stdio: 'inherit', env });
  }
  console.log(`Staging ${document.path} for the tabs that read a set.`);
  return spawn('npx', ['tsx', join(UI_ROOT, 'tools', 'play.ts'), document.path], {
    cwd: UI_ROOT,
    stdio: 'inherit',
    env,
  });
}

async function main(): Promise<void> {
  const args = readDesignArgs(process.argv.slice(2));
  let server: RunningDesignServer;
  try {
    server = await serveDesign({
      port: args.apiPort,
      host: '127.0.0.1',
      ...(args.withRunner ? { runner: fixtureRunner(SETGEN_FIXTURES, SETGEN_RUN_MANIFEST) } : {}),
    });
  } catch (cause: unknown) {
    fail(
      `could not start the design server on 127.0.0.1:${String(args.apiPort)} ` +
        `(${cause instanceof Error ? cause.message : String(cause)}). ` +
        'Move it with --api-port, and the page follows through MTG_DESIGN_PORT.',
    );
  }
  console.log(
    `The design server is on 127.0.0.1:${String(server.port)} and is reachable from this machine only.\n` +
      (args.withRunner
        ? `Replays come out of ${SETGEN_FIXTURES}; a brief nobody has recorded says so rather than spending anything.`
        : 'Started with --no-run, so the page validates and plans and replays nothing.'),
  );
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

// Guarded the way `play.ts` is: importing this file for its argument reader must
// not start two servers.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((cause: unknown) => {
    fail(cause instanceof Error ? cause.message : String(cause));
  });
}
