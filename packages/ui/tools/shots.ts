/**
 * Screenshots of the real app, at the viewports the redesign is argued at.
 *
 * `mtg-aqxi.5`. A layout claim about a phone is a claim about pixels, and this
 * checkout could measure them (`../test/support/chrome.ts`) but could not show
 * them: every rig reads boxes over CDP and none of them ever captured a frame.
 * A redesign reviewed from numbers alone is a redesign nobody has looked at.
 *
 * It drives the *shipped* page rather than a mock. Vite serves this package
 * exactly as `npm run play` does, chrome-headless-shell opens the hash route,
 * an in-page journey clicks the surface to the state being captured by
 * accessible name, and `Page.captureScreenshot` writes the frame. So a shot is
 * evidence about the app; a shot of hand-written HTML would be evidence about
 * the HTML.
 *
 * The device is stated rather than inferred, for `measurePage`'s reason: a
 * landscape phone is 844 CSS px wide, which is a desktop width by every media
 * query on this surface, and a rig on a fine pointer measures controls 44px
 * shorter than the device draws them.
 *
 *   npx tsx packages/ui/tools/shots.ts --out out/shots
 *   npx tsx packages/ui/tools/shots.ts --out out/shots --only play-dense
 *
 * Node-only, like everything under `tools/`. It starts a server on an ephemeral
 * port, captures, and shuts both down; nothing is left running.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createServer } from 'vite';
import {
  browserPresent,
  chromePath,
  cleanupTarget,
  launchChrome,
  shutdownChrome,
} from '../test/support/chrome-driver';
import type { CdpClient } from '../test/support/chrome-driver';
import { resolveOutDir } from './out-path';
import { shotsFor } from './shots-plan';
import type { Shot, Viewport } from './shots-plan';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** How long an in-page journey may run before the socket is called dead. */
const JOURNEY_TIMEOUT_MS = 40_000;

/** How long the DOM must hold still before the page counts as finished. */
const QUIET_MS = 400;

/** How long to wait for that, before photographing whatever is there. */
const QUIET_CAP_MS = 8_000;

function readArgs(argv: readonly string[]): { out: string; only: readonly string[] } | string {
  let out: string | undefined;
  const only: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--out') {
      if (value === undefined) return 'usage: --out <directory>';
      out = value;
      index += 1;
      continue;
    }
    if (flag === '--only') {
      if (value === undefined) return 'usage: --only <shot name>';
      only.push(value);
      index += 1;
      continue;
    }
    return `unknown flag ${String(flag)}; usage: --out <directory> [--only <name>]`;
  }
  if (out === undefined) return 'usage: --out <directory> [--only <name>]';
  return { out, only };
}

/**
 * The in-page journey, run as one awaited promise.
 *
 * Every step is "find a control by its accessible name and press it", polled
 * rather than assumed, because the page is a live app and a route that has just
 * mounted has not necessarily dealt a game yet. A step that never resolves
 * throws with the step's own name and the buttons that *were* on the page,
 * which is the failure a reader can act on.
 *
 * The settle selector is where the shot *starts* waiting, not where it stops.
 * Every route wrapper on this surface is drawn on the first paint and filled in
 * when three or four fetches land, so a settle plus two frames photographs the
 * page before it has read anything: the Play landing came back saying "No set
 * is staged" under a heading naming the flagship set, and the Decks landing
 * came back as a panel reading `deck.json` as broken. Both were true of the
 * frame and false of the app, which is the one thing a screenshot rig must not
 * do. So the wait continues until the DOM has stopped changing for
 * `QUIET_MS` — a document that is still being filled in is still mutating, and
 * a document that is finished is not. The cap is a bound rather than a
 * condition: a page that never goes quiet is photographed anyway, because a
 * late frame is better evidence than no frame.
 */
function journeyExpression(steps: readonly string[], settle: string): string {
  return `(async () => {
    const deadline = 20000;
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    const named = () => Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"]'));
    const label = (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim();
    const find = (want) => named().find((node) => label(node) === want || label(node).startsWith(want));
    for (const step of ${JSON.stringify(steps)}) {
      const started = Date.now();
      let target = find(step);
      while (target === undefined && Date.now() - started < deadline) {
        await pause(80);
        target = find(step);
      }
      if (target === undefined) {
        throw new Error('no control named ' + JSON.stringify(step) + '; on the page: ' +
          JSON.stringify(named().map(label).filter((one) => one.length > 0).slice(0, 40)));
      }
      target.click();
      await pause(120);
    }
    const started = Date.now();
    while (document.querySelector(${JSON.stringify(settle)}) === null && Date.now() - started < deadline) {
      await pause(80);
    }
    if (document.querySelector(${JSON.stringify(settle)}) === null) {
      throw new Error('the page never drew ' + ${JSON.stringify(JSON.stringify(settle))});
    }
    let lastMutation = Date.now();
    const observer = new MutationObserver(() => { lastMutation = Date.now(); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const quietBy = Date.now() + ${String(QUIET_CAP_MS)};
    while (Date.now() - lastMutation < ${String(QUIET_MS)} && Date.now() < quietBy) {
      await pause(40);
    }
    observer.disconnect();
    const quiet = Date.now() - lastMutation >= ${String(QUIET_MS)};
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return { ok: true, quiet };
  })()`;
}

async function capture(
  client: CdpClient,
  origin: string,
  shot: Shot,
  viewport: Viewport,
  out: string,
): Promise<string> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 2,
        mobile: viewport.pointer === 'coarse',
      },
      sessionId,
    );
    await client.call(
      'Emulation.setEmulatedMedia',
      {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'pointer', value: viewport.pointer },
          { name: 'any-pointer', value: viewport.pointer },
        ],
      },
      sessionId,
    );
    if (viewport.pointer === 'coarse') {
      await client.call('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
    }
    const url = `${origin}/${shot.hash}`;
    const navigation = await client.call('Page.navigate', { url }, sessionId);
    if (navigation['errorText'] !== undefined) {
      throw new Error(`could not load ${url}: ${String(navigation['errorText'])}`);
    }
    const journey = await client.call(
      'Runtime.evaluate',
      {
        expression: journeyExpression(shot.steps, shot.settle),
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      JOURNEY_TIMEOUT_MS,
    );
    if (journey['exceptionDetails'] !== undefined) {
      const details = journey['exceptionDetails'] as { exception?: { description?: string } };
      throw new Error(
        `${shot.name} at ${viewport.name}: ${details.exception?.description ?? 'journey failed'}`,
      );
    }
    const settled = journey['result'] as { value?: { quiet?: boolean } } | undefined;
    if (settled?.value?.quiet === false) {
      console.warn(
        `busy     ${shot.name}.${viewport.name}: the page was still changing when it was captured`,
      );
    }
    const frame = await client.call('Page.captureScreenshot', { format: 'png' }, sessionId, 15_000);
    const file = join(out, `${shot.name}.${viewport.name}.png`);
    await writeFile(file, Buffer.from(String(frame['data']), 'base64'));
    return file;
  } finally {
    await cleanupTarget(client, targetId, sessionId).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    process.exit(1);
  }
  if (!browserPresent) {
    console.error(`no chrome-headless-shell at ${chromePath}`);
    console.error('set MTG_CHROME_HEADLESS_SHELL, or run: npx playwright install chromium-headless-shell');
    process.exit(1);
  }
  const plan = shotsFor(args.only);
  if (plan.length === 0) {
    console.error(
      `no shot matched ${args.only.join(', ')}; known: ${shotsFor([])
        .map((one) => one.name)
        .join(', ')}`,
    );
    process.exit(1);
  }
  // Refused before the server starts and the browser opens, because the frame
  // this run would otherwise leave in the working tree is the expensive half of
  // the mistake (`mtg-6e0`).
  const out = resolveOutDir(args.out, resolve(packageDir, '..', '..'));
  await mkdir(out, { recursive: true });

  const server = await createServer({
    root: packageDir,
    configFile: join(packageDir, 'vite.config.ts'),
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo | null;
  if (address === null || address === undefined) throw new Error('Vite published no address');
  const origin = `http://127.0.0.1:${String(address.port)}`;
  console.log(`serving  ${packageDir}`);
  console.log(`origin   ${origin}`);
  console.log(`out      ${out}`);

  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-shots-'));
  const chrome = await launchChrome(userDataDir);
  const failures: string[] = [];
  try {
    for (const shot of plan) {
      for (const viewport of shot.viewports) {
        try {
          const file = await capture(chrome.client, origin, shot, viewport, out);
          console.log(`ok       ${file}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`failed   ${shot.name}.${viewport.name}: ${message}`);
          failures.push(`${shot.name}.${viewport.name}`);
        }
      }
    }
  } finally {
    await shutdownChrome(chrome).catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true });
    await server.close();
  }
  if (failures.length > 0) {
    console.error(`${String(failures.length)} shot(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

await main();
