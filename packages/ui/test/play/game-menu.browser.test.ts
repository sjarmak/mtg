// @vitest-environment node
/**
 * The `Game` menu's sheet, measured in a real browser.
 *
 * `../../src/routes/play/precon-strip.ts` puts one word on the strip above a
 * dealt table and a small sheet under it, and the first line of that sheet is
 * the game's name: `Game ID` beside a seed like `lab/precon/qhx7m2vkspwd`. A
 * seed is one token with no space in it, so nothing about it wraps, and the
 * sheet it sits in is positioned against the end of a strip that is itself at
 * the end of the viewport.
 *
 * Neither half can be asked of server-rendered markup. The sheet is not in the
 * document until the button is pressed, and where it lands is a fact about the
 * cascade rather than about the element. So this rig presses the real control
 * on a live table and reads the boxes back: `../support/live-page.ts` is the
 * machinery, `./live-gamemenu-entry.ts` is the page.
 *
 * What it asserts is two things a person sees as one, and the second is the
 * reason the first is not enough. The seed must not overflow the sheet drawn
 * around it, and the sheet must not overflow the window: a panel anchored to
 * `inset-inline-end: 0` on a control at the right edge of the screen spills
 * *off* the screen, so a line that is merely too long inside its panel is a
 * line with characters that cannot be read at all.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import type { CdpClient, EmulatedDevice } from '../support/chrome';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-gamemenu-entry.ts');

let pending: Promise<string> | null = null;
function builtPage(): Promise<string> {
  pending ??= livePage(ENTRY, 'Game menu');
  return pending;
}

interface Session {
  readonly client: CdpClient;
  readonly sessionId: string;
  readonly targetId: string;
}

async function evaluate(session: Session, expression: string): Promise<unknown> {
  const answer = await session.client.call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    session.sessionId,
    30_000,
  );
  const thrown = answer['exceptionDetails'];
  if (thrown !== undefined) throw new Error(`the page threw: ${JSON.stringify(thrown)}`);
  const result = answer['result'] as { readonly value?: unknown } | undefined;
  return result?.value;
}

const SETTLED = `new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const check = () => {
    const head = document.querySelector('.mtg-gamemenu__head');
    if (document.readyState === 'complete' && head !== null) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      return;
    }
    if (Date.now() > deadline) { reject(new Error('the page mounted no game menu')); return; }
    setTimeout(check, 25);
  };
  check();
})`;

async function openTable(
  client: CdpClient,
  file: string,
  width: number,
  height: number,
  device: EmulatedDevice,
): Promise<Session> {
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = String(attached['sessionId']);
  const session: Session = { client, sessionId, targetId };
  await client.call('Page.enable', {}, sessionId);
  await client.call('Runtime.enable', {}, sessionId);
  await client.call(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: device.mobile ?? width < 500 },
    sessionId,
  );
  const pointer =
    device.pointer === undefined
      ? []
      : [
          { name: 'pointer', value: device.pointer },
          { name: 'any-pointer', value: device.pointer },
        ];
  await client.call(
    'Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, ...pointer] },
    sessionId,
  );
  const navigation = await client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
  if (navigation['errorText'] !== undefined) {
    throw new Error(`Chrome could not load the table: ${String(navigation['errorText'])}`);
  }
  await evaluate(session, SETTLED);
  return session;
}

/**
 * What the open sheet looks like, in the numbers that decide whether it can be
 * read: the seed line against the box drawn around it, and that box against the
 * window.
 */
interface Sheet {
  readonly seed: string;
  /** The seed line's own overflow: laid-out width against the width on offer. */
  readonly factScrollWidth: number;
  readonly factClientWidth: number;
  /** The value's box, and the sheet's, in viewport coordinates. */
  readonly valueRight: number;
  readonly sheetLeft: number;
  readonly sheetRight: number;
  readonly sheetWidth: number;
  readonly viewportWidth: number;
  /** A page that grew a horizontal scrollbar to hold the sheet. */
  readonly documentScrollWidth: number;
}

const READ_SHEET = `(() => {
  const sheet = document.querySelector('.mtg-gamemenu__sheet');
  if (sheet === null) return { error: 'the press opened no sheet' };
  const fact = sheet.querySelector('.mtg-fact');
  const value = sheet.querySelector('.mtg-fact__value');
  if (fact === null || value === null) return { error: 'the sheet has no game id in it' };
  const sheetBox = sheet.getBoundingClientRect();
  const valueBox = value.getBoundingClientRect();
  return {
    seed: value.textContent,
    factScrollWidth: fact.scrollWidth,
    factClientWidth: fact.clientWidth,
    valueRight: valueBox.right,
    sheetLeft: sheetBox.left,
    sheetRight: sheetBox.right,
    sheetWidth: sheetBox.width,
    viewportWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  };
})()`;

/** Press the real control, the way a pointer does, and read the sheet back. */
async function openMenu(width: number, height: number, device: EmulatedDevice = {}): Promise<Sheet> {
  const page = await builtPage();
  const directory = await mkdtemp(join(tmpdir(), 'mtg-game-menu-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-game-menu-chrome-'));
  const chrome = await launchChrome(userDataDir);
  const file = join(directory, 'table.html');
  await writeFile(file, page, 'utf8');
  try {
    const session = await openTable(chrome.client, file, width, height, device);
    const at = (await evaluate(
      session,
      `(() => {
        const head = document.querySelector('.mtg-gamemenu__head');
        if (head === null) return { error: 'the table drew no Game button' };
        const box = head.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (hit === null || (!head.contains(hit) && hit !== head)) {
          return { error: 'the Game button is covered' };
        }
        return { x, y };
      })()`,
    )) as { readonly x?: number; readonly y?: number; readonly error?: string };
    if (at.error !== undefined) throw new Error(at.error);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await chrome.client.call(
        'Input.dispatchMouseEvent',
        {
          type,
          x: at.x,
          y: at.y,
          button: 'left',
          clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0,
        },
        session.sessionId,
      );
    }
    await evaluate(
      session,
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    );
    const read = (await evaluate(session, READ_SHEET)) as Sheet & { readonly error?: string };
    if (read.error !== undefined) throw new Error(read.error);
    await cleanupTarget(chrome.client, session.targetId, session.sessionId).catch(() => undefined);
    return read;
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function assertReadable(sheet: Sheet): void {
  // The premise: a real seed, one unbreakable token long enough to be the
  // subject. A rig that measured `seed-1` would pass on any sheet at all.
  expect(sheet.seed.length, 'the seed is no longer the shape a dealt table shows').toBeGreaterThan(20);

  expect(
    sheet.factScrollWidth,
    `the game id overflows its own line by ${String(sheet.factScrollWidth - sheet.factClientWidth)}px`,
  ).toBeLessThanOrEqual(sheet.factClientWidth);

  // Inside the panel that is drawn around it. `right` rather than a width
  // comparison, because the value is the second item on a row and what it runs
  // past is the panel's padded edge.
  expect(sheet.valueRight, 'the game id runs past the sheet drawn around it').toBeLessThanOrEqual(
    sheet.sheetRight,
  );

  // And the panel inside the window. Anchored to the end of a strip at the
  // right edge of the screen, a sheet too wide leaves the screen rather than
  // the strip.
  expect(sheet.sheetLeft, 'the sheet starts off the left of the window').toBeGreaterThanOrEqual(0);
  expect(sheet.sheetRight, 'the sheet ends past the right of the window').toBeLessThanOrEqual(
    sheet.viewportWidth,
  );
  expect(sheet.documentScrollWidth, 'the open sheet gave the page a horizontal scroll').toBeLessThanOrEqual(
    sheet.viewportWidth,
  );
}

describe("the Game menu's sheet, opened on a live table", () => {
  browserIt(
    'draws the whole game id inside the sheet and the sheet inside the window, at 1280x800',
    async () => {
      assertReadable(await openMenu(1280, 800));
    },
    180_000,
  );

  browserIt(
    'does the same on a phone-sized coarse-pointer viewport',
    async () => {
      assertReadable(await openMenu(390, 844, { mobile: true, pointer: 'coarse' }));
    },
    180_000,
  );
});
