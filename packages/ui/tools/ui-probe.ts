import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import {
  browserPresent,
  cleanupTarget,
  launchChrome,
  missingBrowserMessage,
  shutdownChrome,
} from '../test/support/chrome-driver';
import type { CdpClient } from '../test/support/chrome-driver';
import { resolveSet } from './resolve-set';
import { resolveOutDir } from './out-path';
import { installedPrintedAdmissions } from './printed-format-registry';
import { stagePrintedFormats } from './stage-printed-formats';
import { storeReleaseDates } from './printed-release-dates';
import { readUiProbeArgs } from './ui-probe-args';
import type { UiProbeArgs, UiProbeStep } from './ui-probe-args';

const UI_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const ACTION_TIMEOUT_MS = 25_000;

interface ProbeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ProbeMeasure {
  readonly selector: string;
  readonly boxes: readonly ProbeBox[];
}

export interface UiProbeResult {
  readonly screenshots: readonly string[];
  readonly page: string;
  readonly controls: string;
  readonly measures: string;
}

function routeWithSource(route: string, source: string | undefined): string {
  if (source === undefined) return route;
  const question = route.indexOf('?');
  const path = question < 0 ? route : route.slice(0, question);
  const params = new URLSearchParams(question < 0 ? '' : route.slice(question + 1));
  params.set('source', `printed:${source}`);
  return `${path}?${params.toString()}`;
}

function pageHelpers(body: string): string {
  return `(async () => {
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    const visible = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const nameOf = (node) => {
      const aria = node.getAttribute('aria-label');
      if (aria !== null) return aria.trim();
      const labeledBy = node.getAttribute('aria-label' + String.fromCharCode(108, 101, 100, 98, 121));
      if (labeledBy !== null) return labeledBy.split(/\\s+/u).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      if (node.id !== '') {
        const label = document.querySelector('label[for="' + CSS.escape(node.id) + '"]');
        if (label !== null) return (label.textContent ?? '').trim();
      }
      const parent = node.closest('label');
      if (parent !== null) return (parent.textContent ?? '').trim();
      return (node.getAttribute('alt') ?? node.getAttribute('title') ?? node.getAttribute('placeholder') ?? node.textContent ?? '').trim();
    };
    const controls = () => Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"]')).filter(visible);
    const named = (want) => controls().filter((node) => nameOf(node) === want);
    const near = (want) => {
      const names = [...new Set(controls().map(nameOf).filter((name) => name.length > 0))];
      const folded = want.toLocaleLowerCase();
      const close = names.filter((name) => name.toLocaleLowerCase().includes(folded) || folded.includes(name.toLocaleLowerCase()));
      return (close.length > 0 ? close : names).slice(0, 30);
    };
    ${body}
  })()`;
}

function stepExpression(step: UiProbeStep): string {
  if (step.kind === 'wait-text') {
    return pageHelpers(`
      const want = ${JSON.stringify(step.text)};
      const started = Date.now();
      while (!(document.body?.innerText ?? '').includes(want) && Date.now() - started < 20000) await pause(80);
      if (!(document.body?.innerText ?? '').includes(want)) throw new Error('page never contained ' + JSON.stringify(want));
      return true;
    `);
  }
  if (step.kind === 'measure') {
    return pageHelpers(`
      const selector = ${JSON.stringify(step.selector)};
      return Array.from(document.querySelectorAll(selector)).filter(visible).map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
    `);
  }
  const name = JSON.stringify(step.name);
  const action =
    step.kind === 'click'
      ? 'target.click();'
      : `
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) throw new Error('control named ' + JSON.stringify(want) + ' does not accept text');
        target.focus();
        const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
        if (valueSetter === undefined) throw new Error('control named ' + JSON.stringify(want) + ' has no native value setter');
        valueSetter.call(target, ${JSON.stringify(step.text)});
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      `;
  return pageHelpers(`
    const want = ${name};
    const started = Date.now();
    let matches = named(want);
    while (matches.length === 0 && Date.now() - started < 20000) {
      await pause(80);
      matches = named(want);
    }
    if (matches.length !== 1) throw new Error('control named ' + JSON.stringify(want) + ' matched ' + String(matches.length) + '; near matches: ' + JSON.stringify(near(want)));
    const target = matches[0];
    ${action}
    await pause(120);
    return true;
  `);
}

async function evaluate<T>(
  client: CdpClient,
  sessionId: string,
  expression: string,
  timeoutMs = ACTION_TIMEOUT_MS,
): Promise<T> {
  const evaluated = await client.call(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
    timeoutMs,
  );
  if (evaluated['exceptionDetails'] !== undefined) {
    const details = evaluated['exceptionDetails'] as { exception?: { description?: string }; text?: string };
    throw new Error(details.exception?.description ?? details.text ?? 'page evaluation failed');
  }
  const result = evaluated['result'] as { value?: T } | undefined;
  return result?.value as T;
}

async function capture(client: CdpClient, sessionId: string, path: string): Promise<void> {
  const frame = await client.call('Page.captureScreenshot', { format: 'png' }, sessionId, 15_000);
  await writeFile(path, Buffer.from(String(frame['data']), 'base64'));
}

async function stage(args: UiProbeArgs, publicDir: string): Promise<void> {
  if (args.set !== undefined) {
    const resolved = resolveSet([], args.set);
    if (!resolved.ok) throw new Error(resolved.message);
    await writeFile(join(publicDir, 'set.json'), resolved.json);
  }
  if (args.source !== undefined) {
    const installed = installedPrintedAdmissions(REPO_ROOT).formats;
    const source = installed.find((candidate) => basename(candidate.directory) === args.source);
    if (source === undefined) {
      throw new Error(`no installed printed format named ${args.source}`);
    }
    const { presentationCatalog, ...staged } = source;
    void presentationCatalog;
    await stagePrintedFormats([staged], publicDir, {
      releaseDateOf: storeReleaseDates(
        REPO_ROOT,
        staged.catalogs.map((catalog) => catalog.code),
      ).releaseDateOf,
    });
  }
}

async function startServer(
  args: UiProbeArgs,
  publicDir: string,
): Promise<{ server: ViteDevServer; origin: string }> {
  await stage(args, publicDir);
  const server = await createServer({
    root: UI_ROOT,
    publicDir,
    configFile: join(UI_ROOT, 'vite.config.ts'),
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo | null;
  if (address === null || address === undefined) {
    await server.close();
    throw new Error('Vite published no address');
  }
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

async function openPage(
  client: CdpClient,
  sessionId: string,
  args: UiProbeArgs,
  origin: string,
): Promise<void> {
  await client.call('Page.enable', {}, sessionId);
  await client.call(
    'Emulation.setDeviceMetricsOverride',
    {
      width: args.viewport.width,
      height: args.viewport.height,
      deviceScaleFactor: 2,
      mobile: args.viewport.pointer === 'coarse',
    },
    sessionId,
  );
  await client.call(
    'Emulation.setEmulatedMedia',
    {
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'pointer', value: args.viewport.pointer },
        { name: 'any-pointer', value: args.viewport.pointer },
      ],
    },
    sessionId,
  );
  if (args.viewport.pointer === 'coarse') {
    await client.call('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  }
  const route = routeWithSource(args.route, args.source);
  const navigation = await client.call('Page.navigate', { url: `${origin}/${route}` }, sessionId);
  if (navigation['errorText'] !== undefined) {
    throw new Error(`could not load ${origin}/${route}: ${String(navigation['errorText'])}`);
  }
  await evaluate(
    client,
    sessionId,
    pageHelpers(`
      const started = Date.now();
      while ((document.readyState !== 'complete' || document.body === null) && Date.now() - started < 20000) await pause(80);
      if (document.body === null) throw new Error('page never drew a body');
      await pause(400);
      return true;
    `),
  );
}

async function captureEvidence(
  client: CdpClient,
  sessionId: string,
  args: UiProbeArgs,
  out: string,
): Promise<UiProbeResult> {
  const screenshots: string[] = [];
  const measures: ProbeMeasure[] = [];
  const initial = join(out, 'step-00.png');
  await capture(client, sessionId, initial);
  screenshots.push(initial);
  for (const [index, step] of args.steps.entries()) {
    const value = await evaluate<readonly ProbeBox[]>(client, sessionId, stepExpression(step));
    if (step.kind === 'measure') measures.push({ selector: step.selector, boxes: value });
    const path = join(out, `step-${String(index + 1).padStart(2, '0')}.png`);
    await capture(client, sessionId, path);
    screenshots.push(path);
  }
  const page = join(out, 'page.txt');
  const controls = join(out, 'controls.json');
  const measuresPath = join(out, 'measures.json');
  const pageText = await evaluate<string>(client, sessionId, 'document.body.innerText');
  const controlRows = await evaluate<readonly unknown[]>(
    client,
    sessionId,
    pageHelpers(`
      return controls().map((node) => ({
        role: node.getAttribute('role') ?? node.tagName.toLocaleLowerCase(),
        name: nameOf(node),
        enabled: !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true'
      }));
    `),
  );
  await Promise.all([
    writeFile(page, `${pageText.trim()}\n`),
    writeFile(controls, `${JSON.stringify(controlRows, null, 2)}\n`),
    writeFile(measuresPath, `${JSON.stringify(measures, null, 2)}\n`),
  ]);
  return { screenshots, page, controls, measures: measuresPath };
}

export async function runUiProbe(args: UiProbeArgs): Promise<UiProbeResult> {
  if (!browserPresent) throw new Error(missingBrowserMessage());
  const out = resolveOutDir(args.out, REPO_ROOT);
  await mkdir(out, { recursive: true });
  const stagingDir = await mkdtemp(join(tmpdir(), 'mtg-ui-probe-public-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-ui-probe-chrome-'));
  let server: ViteDevServer | null = null;
  let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
  let targetId: string | null = null;
  let sessionId: string | null = null;
  try {
    const running = args.url === undefined ? await startServer(args, stagingDir) : null;
    server = running?.server ?? null;
    const origin = (running?.origin ?? args.url!).replace(/\/$/u, '');
    chrome = await launchChrome(userDataDir);
    const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
    targetId = String(target['targetId']);
    const attached = await chrome.client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await openPage(chrome.client, sessionId, args, origin);
    return await captureEvidence(chrome.client, sessionId, args, out);
  } finally {
    if (chrome !== null && targetId !== null) {
      await cleanupTarget(chrome.client, targetId, sessionId).catch(() => undefined);
    }
    if (chrome !== null) await shutdownChrome(chrome).catch(() => undefined);
    if (server !== null) await server.close().catch(() => undefined);
    await Promise.all([
      rm(userDataDir, { recursive: true, force: true }),
      rm(stagingDir, { recursive: true, force: true }),
    ]);
  }
}

async function main(): Promise<void> {
  const args = readUiProbeArgs(process.argv.slice(2));
  if (typeof args === 'string') throw new Error(args);
  const result = await runUiProbe(args);
  for (const path of [...result.screenshots, result.page, result.controls, result.measures]) {
    process.stdout.write(`${path}\n`);
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
