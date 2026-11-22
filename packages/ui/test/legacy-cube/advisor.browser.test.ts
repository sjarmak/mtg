// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { browserIt, launchChrome, shutdownChrome } from '../support/chrome';
import { livePage } from '../support/live-page';

browserIt(
  'explores, inspects with keyboard, and commits picks at desktop and phone widths',
  async () => {
    const page = await livePage(
      fileURLToPath(new URL('./live-advisor-entry.ts', import.meta.url)),
      'Draft advisor',
    );
    const directory = await mkdtemp(join(tmpdir(), 'mtg-advisor-browser-'));
    const chrome = await launchChrome(join(directory, 'chrome'));
    const file = join(directory, 'advisor.html');
    await writeFile(file, page);
    try {
      const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
      const attached = await chrome.client.call('Target.attachToTarget', {
        targetId: target['targetId'],
        flatten: true,
      });
      const session = String(attached['sessionId']);
      const evaluate = async (expression: string): Promise<unknown> => {
        const reply = await chrome.client.call(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          session,
          30_000,
        );
        if (reply['exceptionDetails'] !== undefined)
          throw new Error(JSON.stringify(reply['exceptionDetails']));
        return (reply['result'] as { value?: unknown }).value;
      };
      const settle = async (condition: string): Promise<void> => {
        await evaluate(
          `new Promise((resolve, reject) => { const start = Date.now(); const check = () => { if (${condition}) { requestAnimationFrame(() => requestAnimationFrame(resolve)); } else if (Date.now() - start > 10000) { reject(new Error('Advisor did not reach: ' + ${JSON.stringify(condition)})); } else { setTimeout(check, 20); } }; check(); })`,
        );
      };
      await chrome.client.call('Page.enable', {}, session);
      for (const width of [1440, 768, 375]) {
        await chrome.client.call(
          'Emulation.setDeviceMetricsOverride',
          { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 },
          session,
        );
        await chrome.client.call('Page.navigate', { url: pathToFileURL(file).href }, session);
        await settle(`document.querySelector('[aria-label="Draft recommendations"]') !== null`);
        expect(
          await evaluate(
            `document.querySelector('[data-weight-revision]').getAttribute('data-weight-revision')`,
          ),
        ).toBe('browser-trial/v1');
        expect(
          await evaluate(
            `document.body.textContent.includes('Provisional local calibration') && document.body.textContent.includes('Not yet bot-validated')`,
          ),
        ).toBe(true);
        expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Review advice').click()`,
        );
        expect(
          await evaluate(
            `(() => { const r = document.querySelector('.mtg-rail__tabs').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 100; })()`,
          ),
        ).toBe(true);
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Paths').click()`,
        );
        await settle(`document.querySelector('[aria-label="Archetype paths"]') !== null`);
        await evaluate(
          `(() => { const select = document.querySelector('[aria-label="Archetype paths"] select'); select.value = 'reanimator'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
        );
        await settle(
          `document.querySelector('[aria-label="Archetype paths"] select').value === 'reanimator'`,
        );
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Card').click()`,
        );
        await evaluate(`document.querySelector('[aria-label="Draft pack 1, pick 1"] button').focus()`);
        await settle(`document.querySelector('[aria-label^="Advice for "]') !== null`);
        await chrome.client.call(
          'Input.dispatchKeyEvent',
          { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
          session,
        );
        await chrome.client.call(
          'Input.dispatchKeyEvent',
          { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
          session,
        );
        await settle(
          `Array.from(document.querySelectorAll('button')).some(b => b.textContent.startsWith('Pick ') && !b.disabled)`,
        );
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent.startsWith('Pick ') && !b.disabled).click()`,
        );
        await settle(`document.querySelector('[aria-label="Draft pack 1, pick 2"]') !== null`);
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Paths').click()`,
        );
        await settle(`document.querySelector('[aria-label="Archetype paths"] select') !== null`);
        expect(await evaluate(`document.querySelector('[aria-label="Archetype paths"] select').value`)).toBe(
          'reanimator',
        );
        expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
        if (width < 500) {
          const point = (await evaluate(
            `(() => { const r = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Review advice').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          )) as { x: number; y: number };
          await chrome.client.call(
            'Input.dispatchTouchEvent',
            { type: 'touchStart', touchPoints: [point] },
            session,
          );
          await chrome.client.call(
            'Input.dispatchTouchEvent',
            { type: 'touchEnd', touchPoints: [] },
            session,
          );
          await settle(`document.querySelector('.mtg-rail__tabs').getBoundingClientRect().top < 100`);
        }
        const screenshot = await chrome.client.call('Page.captureScreenshot', { format: 'png' }, session);
        await writeFile(
          `/tmp/mtg-advisor-${String(width)}.png`,
          Buffer.from(String(screenshot['data']), 'base64'),
        );
      }
    } finally {
      await shutdownChrome(chrome);
      await rm(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
