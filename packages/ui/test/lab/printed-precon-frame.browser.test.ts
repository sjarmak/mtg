// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ROUTE = '#/play/commander?against=first-flight&deck=token-triumph&source=printed%3Aktk';

browserIt(
  'keeps all 99 main-deck cards reachable and opens a selected card above the frame',
  async () => {
    const page = await livePage(
      fileURLToPath(new URL('./live-printed-precon-entry.ts', import.meta.url)),
      'Printed Commander deck',
    );
    const directory = await mkdtemp(join(tmpdir(), 'mtg-printed-precon-'));
    const userData = await mkdtemp(join(tmpdir(), 'mtg-printed-precon-chrome-'));
    const chrome = await launchChrome(userData);
    const loaded = chrome.client.record('Page.domContentEventFired');
    let targetId = '';
    let sessionId = '';
    const evaluate = async (expression: string): Promise<unknown> => {
      const response = await chrome.client.call(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
        30_000,
      );
      if (response['exceptionDetails'] !== undefined)
        throw new Error(JSON.stringify(response['exceptionDetails']));
      return (response['result'] as { readonly value?: unknown }).value;
    };
    const waitFor = (expression: string) =>
      evaluate(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const check = () => {
          if (${expression}) return resolve(true);
          if (Date.now() > deadline) return reject(new Error(document.body.innerText));
          setTimeout(check, 25);
        }; check();
      })`);
    try {
      const file = join(directory, 'commander.html');
      await writeFile(file, page);
      targetId = String(
        (await chrome.client.call('Target.createTarget', { url: 'about:blank' }))['targetId'],
      );
      sessionId = String(
        (await chrome.client.call('Target.attachToTarget', { targetId, flatten: true }))['sessionId'],
      );
      await chrome.client.call('Page.enable', {}, sessionId);
      await chrome.client.call(
        'Emulation.setDeviceMetricsOverride',
        { width: 1390, height: 831, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await Promise.all([
        loaded.next(),
        chrome.client.call('Page.navigate', { url: `${pathToFileURL(file).href}${ROUTE}` }, sessionId),
      ]);
      await waitFor(
        "[...document.querySelectorAll('button')].some(button => button.textContent === 'View Token Triumph')",
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(button => button.textContent === 'View Token Triumph').click()",
      );
      await waitFor("document.querySelector('[data-pane=deck] .mtg-deck__pane-scroll') !== null");
      expect(
        await evaluate(
          "[...document.querySelectorAll('button')].some(button => button.textContent === 'Hide commander')",
        ),
      ).toBe(true);
      await evaluate(
        "[...document.querySelectorAll('button')].find(button => button.textContent === 'Hide commander').click()",
      );
      await waitFor(
        "[...document.querySelectorAll('button')].some(button => button.textContent === 'Show commander')",
      );
      expect(await evaluate("localStorage.getItem('mtg.play.commander-card')")).toBe('shut');
      expect(
        await evaluate(`(() => {
          const pane = document.querySelector('[data-pane=deck] .mtg-deck__pane-scroll');
          const cards = [...pane.querySelectorAll('.mtg-card')];
          pane.scrollTop = pane.scrollHeight;
          void document.documentElement.offsetHeight;
          const port = pane.getBoundingClientRect();
          const last = cards.at(-1).getBoundingClientRect();
          return {
            cards: cards.length,
            scrolled: pane.scrollTop,
            lastVisible: last.top < port.bottom && last.bottom <= port.bottom + 1,
          };
        })()`),
      ).toEqual({ cards: 99, scrolled: expect.any(Number), lastVisible: true });
      await evaluate("document.querySelector('[data-pane=deck] .mtg-card').click()");
      await waitFor("document.querySelector('[role=dialog][aria-label^=Selected]') !== null");
      expect(
        await evaluate(`(() => {
          const dialog = document.querySelector('[role=dialog][aria-label^=Selected]');
          const face = dialog.querySelector('.mtg-card[data-size=full]');
          const box = face.getBoundingClientRect();
          return box.top >= 0 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
        })()`),
      ).toBe(true);
      for (const type of ['keyDown', 'keyUp']) {
        await chrome.client.call(
          'Input.dispatchKeyEvent',
          { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
          sessionId,
        );
      }
      await waitFor("document.querySelector('[role=dialog][aria-label^=Selected]') === null");
      await evaluate("document.querySelector('[data-pane=deck] .mtg-card').click()");
      await waitFor("document.querySelector('[role=dialog][aria-label^=Selected]') !== null");
      await evaluate(
        "[...document.querySelectorAll('button')].find(button => button.textContent === 'Clear selection').click()",
      );
      await waitFor("document.querySelector('[role=dialog][aria-label^=Selected]') === null");
      await Promise.all([loaded.next(), chrome.client.call('Page.reload', {}, sessionId)]);
      await waitFor(
        "[...document.querySelectorAll('button')].some(button => button.textContent === 'View Token Triumph')",
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(button => button.textContent === 'View Token Triumph').click()",
      );
      await waitFor(
        "[...document.querySelectorAll('button')].some(button => button.textContent === 'Show commander')",
      );
      expect(await evaluate("document.querySelector('.mtg-printed-precon-commanders') === null")).toBe(true);
    } finally {
      loaded.stop();
      if (targetId !== '' && sessionId !== '') await cleanupTarget(chrome.client, targetId, sessionId);
      await shutdownChrome(chrome);
      await rm(directory, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
    }
  },
  180_000,
);
