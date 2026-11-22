// @vitest-environment node
/** A mapped backend spell opens the ordinary card reader from the shared stack. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-stack-inspect-entry.ts');

let pending: Promise<string> | null = null;
function builtPage(): Promise<string> {
  pending ??= livePage(ENTRY, 'Stack inspection');
  return pending;
}

describe('a mapped backend spell on the shared stack', () => {
  browserIt(
    'opens its exact printed face in the ordinary Info rail when its name is clicked',
    async () => {
      const page = await builtPage();
      const directory = await mkdtemp(join(tmpdir(), 'mtg-stack-inspect-'));
      const chromeDirectory = await mkdtemp(join(tmpdir(), 'mtg-stack-inspect-chrome-'));
      const file = join(directory, 'stack.html');
      await writeFile(file, page, 'utf8');
      const chrome = await launchChrome(chromeDirectory);
      let targetId = '';
      let sessionId: string | null = null;
      try {
        const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
        targetId = String(target['targetId']);
        const attached = await chrome.client.call('Target.attachToTarget', {
          targetId,
          flatten: true,
        });
        sessionId = String(attached['sessionId']);
        await chrome.client.call('Page.enable', {}, sessionId);
        await chrome.client.call(
          'Emulation.setDeviceMetricsOverride',
          { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
          sessionId,
        );
        await chrome.client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
        const settled = await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `new Promise((resolve, reject) => {
              const deadline = Date.now() + 10000;
              const check = () => {
                const entry = document.querySelector('[data-permanent-key="foreign:stack:printed:10"]');
                if (entry !== null) { resolve(true); return; }
                if (Date.now() > deadline) { reject(new Error('the mapped stack spell never mounted')); return; }
                requestAnimationFrame(check);
              };
              check();
            })`,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
          12_000,
        );
        expect(settled['exceptionDetails']).toBeUndefined();

        // Reproduce the persisted state from the live report. The stack's
        // inspect button was present (and therefore showed a hand cursor), but
        // its destination was hidden inside the player's shut side panel.
        await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `(() => {
              window.localStorage.setItem('mtg.play.side-panel', 'shut');
              window.location.reload();
            })()`,
          },
          sessionId,
        );
        const collapsed = await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `new Promise((resolve, reject) => {
              const deadline = Date.now() + 10000;
              const check = () => {
                const entry = document.querySelector('[data-permanent-key="foreign:stack:printed:10"]');
                const toggle = document.querySelector('[aria-label="Side panel"]');
                if (entry !== null && toggle?.getAttribute('aria-expanded') === 'false') {
                  resolve(true);
                  return;
                }
                if (Date.now() > deadline) { reject(new Error('the persisted shut side panel never mounted')); return; }
                requestAnimationFrame(check);
              };
              check();
            })`,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
          12_000,
        );
        expect(collapsed['exceptionDetails']).toBeUndefined();

        const inspect = await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `(() => {
              const button = document.querySelector(
                '[data-permanent-key="foreign:stack:printed:10"] [data-inspect-card]',
              );
              if (!(button instanceof HTMLElement)) return false;
              button.click();
              return true;
            })()`,
            returnByValue: true,
          },
          sessionId,
        );
        expect((inspect['result'] as { readonly value: boolean }).value).toBe(true);

        const reading = await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `new Promise((resolve, reject) => {
              const deadline = Date.now() + 5000;
              const check = () => {
                const toggle = document.querySelector('[aria-label="Side panel"]');
                const info = document.querySelector('[role="group"][aria-label="Info"]');
                const face = info?.querySelector('.mtg-card[data-presentation="printed-card"]');
                if (toggle?.getAttribute('aria-expanded') === 'true' && face !== null && face !== undefined) {
                  resolve({
                    name: face.querySelector('.mtg-card__name')?.textContent ?? '',
                    rules: face.querySelector('.mtg-card__text')?.textContent ?? '',
                    art: face.querySelector('[data-region="art"] img')?.getAttribute('src') ?? '',
                  });
                  return;
                }
                if (Date.now() > deadline) { reject(new Error('the Info rail never opened the printed face')); return; }
                requestAnimationFrame(check);
              };
              check();
            })`,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
          7_000,
        );
        expect(reading['exceptionDetails']).toBeUndefined();
        expect((reading['result'] as { readonly value: unknown }).value).toMatchObject({
          name: 'Stack Sentinel',
          rules: 'Vigilance',
        });
        expect((reading['result'] as { readonly value: { readonly art: string } }).value.art).toContain(
          'data:image/svg+xml',
        );
      } finally {
        if (targetId.length > 0) await cleanupTarget(chrome.client, targetId, sessionId);
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(chromeDirectory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
