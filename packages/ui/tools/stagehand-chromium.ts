/**
 * Full Chromium for the armed Stagehand path only (`mtg-jiusn`).
 *
 * `live-journey.ts`'s armed branch used to reuse the same chrome-headless-shell
 * `launchChrome` starts for the printed/kernel journeys. That build has no
 * `Extensions.loadUnpacked` CDP method and loads no extension even with
 * `--load-extension` given by hand, and Stagehand's `localBrowser.connect`
 * automation lives entirely inside a preloaded extension, not CDP page
 * injection. The extension itself is the browser-side half of every
 * `observe()`/`act()` call, so a build that cannot load it cannot run the
 * armed path at all, not just less reliably.
 *
 * The fix (confirmed by reading `@browserbasehq/stagehand`'s compiled
 * `localBrowser.connect` directly, `dist/index.mjs`): pass it an
 * `extensionId` and it skips `Extensions.loadUnpacked` entirely, instead
 * matching the extension's own service-worker target. That only exists when
 * the extension actually loaded, which full Chromium does, headless, given
 * `--disable-extensions-except=<dir> --load-extension=<dir>`.
 *
 * This module owns exactly that: resolve full Chromium (a second, separate
 * Playwright cache entry from chrome-headless-shell's), launch it with the
 * extension flags, and find the extension's id once it is up. It reuses
 * `CdpClient` and the orphan guard from `../test/support/chrome-driver` but
 * duplicates that module's short DevTools-endpoint wait rather than importing
 * `launchChrome` itself: that function is hardcoded to chrome-headless-shell
 * and shared by 100+ `.browser.test.ts` call sites, and the unarmed and
 * fixture paths must keep using it completely unchanged.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpClient, terminateChild, trackLiveChild } from '../test/support/chrome-driver';

const PLAYWRIGHT_CACHE = join(homedir(), '.cache', 'ms-playwright');
const CHROMIUM_REVISION_DIR = /^chromium-(\d+)$/;

/**
 * The highest `chromium-<n>` revision directory Playwright's cache holds
 * (it keeps several across `npx playwright install chromium` runs, e.g.
 * 1208/1217/1234/1243), or `null` when the cache has none. A hardcoded
 * revision drifts the moment that command bumps the pin: `mtg-mbz0k` found
 * `chromiumPresent` going false under an installed, working Chromium because
 * the cache had moved on to a directory this file did not know the name of.
 */
export function resolveHighestChromiumRevision(
  cacheDir: string = PLAYWRIGHT_CACHE,
  listDir: (dir: string) => string[] = readdirSync,
): string | null {
  let entries: string[];
  try {
    entries = listDir(cacheDir);
  } catch {
    return null;
  }
  let highest: { revision: number; name: string } | null = null;
  for (const entry of entries) {
    const match = CHROMIUM_REVISION_DIR.exec(entry);
    if (!match) continue;
    const revision = Number(match[1]);
    if (highest === null || revision > highest.revision) highest = { revision, name: entry };
  }
  return highest === null ? null : join(cacheDir, highest.name, 'chrome-linux64', 'chrome');
}

/** Where full Chromium is, and the one environment variable that moves it. */
export const chromiumPath =
  process.env['MTG_CHROMIUM'] ??
  resolveHighestChromiumRevision() ??
  join(PLAYWRIGHT_CACHE, 'chromium', 'chrome-linux64', 'chrome');

/** Whether this machine can run the armed path at all. */
export const chromiumPresent = existsSync(chromiumPath);

export class StagehandChromiumMissingError extends Error {
  constructor() {
    super(
      `No Chromium at ${chromiumPath}. The armed Stagehand path (--max-usd) needs full Chromium, not ` +
        "chrome-headless-shell, because only Chromium's build loads Stagehand's bundled extension. " +
        'Install it with `npx playwright install chromium`, or point MTG_CHROMIUM at an existing Chromium binary.',
    );
    this.name = 'StagehandChromiumMissingError';
  }
}

const STAGEHAND_PACKAGE_SPECIFIER = '@browserbasehq/stagehand';

/**
 * `@browserbasehq/stagehand` publishes an ESM-only `exports` map with no
 * `require`/`./package.json` entry (checked directly against its
 * `package.json`), so `createRequire(...).resolve` cannot reach it at all;
 * `import.meta.resolve` is the only resolver that can. This is this file's own
 * one-off fallback for wherever this workspace's single root `node_modules`
 * actually sits, three directories up from `packages/ui/tools/`, the same
 * layout `REPO_ROOT` in `live-journey.ts` assumes.
 */
const ROOT_NODE_MODULES_EXTENSION_FALLBACK = '../../../node_modules/@browserbasehq/stagehand/dist/extension/';

/**
 * The SDK's `dist/extension/` directory, the same one its own unexported
 * `STAGEHAND_EXTENSION_DIRECTORY_PATH` resolves to (confirmed by reading
 * `dist/index.mjs`: it derives the directory from its own module URL). That
 * constant is not exported, so it is derived here the same way, from the
 * package's resolved entry point, rather than a hardcoded `node_modules` path
 * that would drift from wherever the workspace actually installed it.
 *
 * Vitest's SSR module runner does not implement `import.meta.resolve`
 * (confirmed: it throws "__vite_ssr_import_meta__.resolve is not a
 * function"), so `stagehand-chromium.test.ts` and the `.browser.test.ts`
 * smoke test both exercise the fallback below rather than the real resolver;
 * `npm run verify:live` under `tsx` (Node's own loader) always takes the first
 * branch.
 */
export function resolveStagehandExtensionDirectory(): string {
  if (typeof import.meta.resolve === 'function') {
    const entry = import.meta.resolve(STAGEHAND_PACKAGE_SPECIFIER);
    return fileURLToPath(new URL('extension/', entry));
  }
  return fileURLToPath(new URL(ROOT_NODE_MODULES_EXTENSION_FALLBACK, import.meta.url));
}

/**
 * The non-negotiable flags for the armed path's Chromium, plus the two that
 * chrome-headless-shell never needed: `--headless=new` (full Chromium runs
 * headed by default) and the extension pair. `switches` mirrors
 * `launchChrome`'s own escape hatch for a rig that needs one more flag this
 * function cannot guess.
 *
 * `--remote-allow-origins=*` and `--enable-unsafe-extension-debugging` are
 * both drawn from Stagehand's own local launcher (`DEFAULT_CHROME_FLAGS`,
 * `node_modules/@browserbasehq/stagehand/dist/index.mjs`, confirmed at
 * v4.1.0). Neither is optional for the extension path: the extension's
 * service worker opens its own CDP websocket to automate the page (not the
 * one `--remote-debugging-port=0` yields, whose consumer is our own
 * `CdpClient`), and Chrome 111+ rejects a DevTools websocket whose Origin
 * header (`chrome-extension://<id>`) is not in `--remote-allow-origins`.
 * `*` matches upstream's own choice, and is safe here because the debugging
 * port is loopback-only and random. Without `--enable-unsafe-extension-debugging`
 * the same websocket open is refused before the origin check even runs.
 * Missing both, Chromium loads the extension and prints
 * `[stagehand] INFO stagehand.init`, then the extension's service worker
 * throws `Error: CDP websocket failed to open` (code -32603) on its first
 * connect attempt, before any `observe()` call.
 *
 * The rest of upstream's `DEFAULT_CHROME_FLAGS` (feature-disable lists,
 * `--mute-audio`, `--disable-sync`, `--use-mock-keychain`,
 * `--force-fieldtrials=...`, `--enable-features=WebMCPTesting,DevToolsWebMCPSupport`,
 * etc.) are deliberately left out: they are upstream's own headless-Chrome
 * profile hygiene (telemetry, background networking, first-run prompts) with
 * no bearing on the extension's CDP websocket, and this function already has
 * its own equivalent baseline (`--no-sandbox`, `--disable-gpu`, headless).
 * Adding them would widen this fix's surface past the bug it's fixing.
 */
export function buildStagehandChromiumArgs(
  userDataDir: string,
  extensionDir: string,
  switches: readonly string[] = [],
): string[] {
  return [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--password-store=basic',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    ...switches,
    'about:blank',
  ];
}

const DEVTOOLS_ENDPOINT_TIMEOUT_MS = 8_000;

/** The same bounded stderr-scrape `launchChrome` uses; see the module doc for why this is duplicated rather than shared. */
function waitForDevToolsEndpoint(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = DEVTOOLS_ENDPOINT_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (url?: string, error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stderr.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (url !== undefined) resolve(url);
      else reject(error ?? new Error('Chromium endpoint wait failed'));
    };
    const onData = (chunk: string): void => {
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(chunk);
      if (match?.[1] !== undefined) finish(match[1]);
    };
    const onError = (error: Error): void =>
      finish(undefined, new Error(`Chromium failed to launch: ${error.message}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finish(
        undefined,
        new Error(
          `Chromium exited before publishing DevTools (code ${String(code)}, signal ${String(signal)})`,
        ),
      );
    const timeout = setTimeout(
      () =>
        finish(
          undefined,
          new Error(`Chromium did not publish a DevTools endpoint within ${String(timeoutMs)}ms`),
        ),
      timeoutMs,
    );
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/**
 * Starts full Chromium with Stagehand's extension loaded and hands back the
 * child and a client on it, the same shape `launchChrome` returns so
 * `shutdownChrome` from `../test/support/chrome-driver` works on either
 * unchanged.
 */
export async function launchStagehandChromium(
  userDataDir: string,
  switches: readonly string[] = [],
): Promise<{
  readonly child: ChildProcessWithoutNullStreams;
  readonly client: CdpClient;
  readonly debuggerUrl: string;
}> {
  if (!chromiumPresent) throw new StagehandChromiumMissingError();
  const extensionDir = resolveStagehandExtensionDirectory();
  const child = spawn(chromiumPath, buildStagehandChromiumArgs(userDataDir, extensionDir, switches), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  trackLiveChild(child);
  child.stderr.setEncoding('utf8');
  try {
    const debuggerUrl = await waitForDevToolsEndpoint(child);
    return { child, client: await CdpClient.connect(debuggerUrl), debuggerUrl };
  } catch (error) {
    try {
      await terminateChild(child);
    } catch (terminationError) {
      throw new AggregateError(
        [error, terminationError],
        'Stagehand Chromium launch failed and its child could not be terminated',
      );
    }
    throw error;
  }
}

export class StagehandExtensionNotFoundError extends Error {
  constructor(deadlineMs: number) {
    super(
      "Stagehand's extension never appeared as a service worker in this Chromium's targets within " +
        `${String(deadlineMs)}ms. Confirm --load-extension pointed at the SDK's dist/extension directory ` +
        'and that this Chromium build honors --load-extension headless.',
    );
    this.name = 'StagehandExtensionNotFoundError';
  }
}

interface DiscoveredTarget {
  readonly type?: string;
  readonly url?: string;
}

const EXTENSION_SERVICE_WORKER = /^chrome-extension:\/\/([^/]+)\/service-worker\.js$/u;

/** Exported so the polling loop below is testable against a stubbed target list without a real Chromium. */
export function extensionIdFromTargets(targets: readonly DiscoveredTarget[]): string | null {
  for (const target of targets) {
    if (target.type !== 'service_worker' || typeof target.url !== 'string') continue;
    const match = EXTENSION_SERVICE_WORKER.exec(target.url);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

const EXTENSION_POLL_INTERVAL_MS = 100;

/**
 * Polls `Target.getTargets` for the extension's service worker, since it
 * takes Chromium a moment after startup to finish loading an unpacked
 * extension. Refuses with a named error at the deadline rather than hanging,
 * per the bead's "poll with a bounded deadline" requirement.
 */
export async function discoverStagehandExtensionId(client: CdpClient, deadlineMs: number): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const result = await client.call('Target.getTargets');
    const found = extensionIdFromTargets(
      (result['targetInfos'] as readonly DiscoveredTarget[] | undefined) ?? [],
    );
    if (found !== null) return found;
    if (Date.now() >= deadline) throw new StagehandExtensionNotFoundError(deadlineMs);
    await new Promise((resolve) => setTimeout(resolve, EXTENSION_POLL_INTERVAL_MS));
  }
}
