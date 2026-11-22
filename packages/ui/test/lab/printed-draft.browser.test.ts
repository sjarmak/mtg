// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

/**
 * Whether the editor is holding exactly this many cards, asked of the page.
 *
 * `mtg-84703`. The status banner over the editor said `40 cards in deck` and it
 * is gone -- the count was already on the deck pane's own note a pane away, and
 * the banner's row was the space the playtester asked back. So the probe reads the
 * note, the same way `packages/ui/tools/live-journey.ts` does through a running
 * launcher.
 */
const DECK_COUNT_IS = `((want) => {
  const note = document.querySelector('[data-pane="deck"] .mtg-deck__pane-note')?.textContent ?? '';
  const found = /^(\\d+) of \\d+ cards\\b/.exec(note);
  return found !== null && Number(found[1]) === want;
})`;

browserIt(
  'completes 42 printed draft picks in Chrome across reload and preserves the physical deck',
  async () => {
    const page = await livePage(
      fileURLToPath(new URL('./live-printed-draft-entry.ts', import.meta.url)),
      'Printed draft',
    );
    const directory = await mkdtemp(join(tmpdir(), 'mtg-printed-draft-'));
    const userData = await mkdtemp(join(tmpdir(), 'mtg-printed-draft-chrome-'));
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
    const waitFor = (condition: string) =>
      evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const check = () => {
      if (!document.documentElement.hasAttribute('data-before-reload') && (${condition})) return resolve(true);
      if (Date.now() > deadline) return reject(new Error(document.body.innerText));
      setTimeout(check, 25);
    }; check();
  })`);
    const reload = async () => {
      await evaluate("document.documentElement.setAttribute('data-before-reload', 'true')");
      await Promise.all([loaded.next(), chrome.client.call('Page.reload', {}, sessionId)]);
    };
    const storage = "JSON.parse(localStorage.getItem('mtg.printed.draft:akh-hou:browser-draft'))";
    try {
      const file = join(directory, 'draft.html');
      await writeFile(file, page);
      targetId = String(
        (await chrome.client.call('Target.createTarget', { url: 'about:blank' }))['targetId'],
      );
      sessionId = String(
        (await chrome.client.call('Target.attachToTarget', { targetId, flatten: true }))['sessionId'],
      );
      await chrome.client.call('Page.enable', {}, sessionId);
      await Promise.all([
        loaded.next(),
        chrome.client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId),
      ]);
      for (let index = 0; index < 42; index += 1) {
        const label = `Pack ${Math.floor(index / 14) + 1} · Pick ${(index % 14) + 1}`;
        await waitFor(`document.body.innerText.includes(${JSON.stringify(label)})`);
        if (index === 0) {
          await chrome.client.call(
            'Emulation.setDeviceMetricsOverride',
            { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
            sessionId,
          );
          await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
          expect(
            await evaluate(`(() => {
              const pane = document.querySelector('.mtg-work__scroll');
              return pane.clientHeight < pane.scrollHeight &&
                pane.getBoundingClientRect().bottom <= innerHeight;
            })()`),
            'the pack must scroll inside the viewport',
          ).toBe(true);
          await chrome.client.call(
            'Input.dispatchMouseEvent',
            { type: 'mouseWheel', x: 400, y: 600, deltaX: 0, deltaY: 600 },
            sessionId,
          );
          await waitFor("document.querySelector('.mtg-work__scroll').scrollTop > 0");
          await chrome.client.call(
            'Emulation.setDeviceMetricsOverride',
            { width: 375, height: 812, deviceScaleFactor: 1, mobile: true },
            sessionId,
          );
          await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
          await chrome.client.call(
            'Input.dispatchMouseEvent',
            { type: 'mouseWheel', x: 180, y: 400, deltaX: 0, deltaY: 600 },
            sessionId,
          );
          await waitFor("document.querySelector('.mtg-shell__main').scrollTop > 0");
          await chrome.client.call(
            'Emulation.setDeviceMetricsOverride',
            { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
            sessionId,
          );
        }
        if (index === 8) {
          const before = await evaluate(storage);
          await reload();
          await waitFor(`document.body.innerText.includes(${JSON.stringify(label)})`);
          expect(await evaluate(storage)).toEqual(before);
        }
        await evaluate(`document.querySelector('[role="group"][aria-label^="Draft pack"] button').click()`);
        await waitFor(
          `[...document.querySelectorAll('button')].some(b => b.textContent.startsWith('Pick '))`,
        );
        // Selecting a card must not itself commit the pick.
        expect(await evaluate(`document.body.innerText.includes(${JSON.stringify(label)})`)).toBe(true);
        if (index === 0) {
          await evaluate(
            `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Pick ')).focus()`,
          );
          for (const type of ['keyDown', 'keyUp'])
            await chrome.client.call(
              'Input.dispatchKeyEvent',
              { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
              sessionId,
            );
        } else
          await evaluate(
            `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Pick ')).click()`,
          );
      }
      await waitFor("document.body.innerText.includes('Draft complete')");
      const picks = await evaluate(`Object.values(${storage}.transcript.picks).flat()`);
      expect(Array.isArray(picks)).toBe(true);
      expect(picks).toHaveLength(42);
      expect(new Set(picks as string[]).size).toBe(42);
      await evaluate(
        `[...document.querySelectorAll('button')].find(b => b.textContent === 'Suggest a build').click()`,
      );
      await waitFor(`${DECK_COUNT_IS}(40)`);
      await waitFor(`${storage}.deck.selectedPhysicalIds.length > 0`);
      const saved = await evaluate(`${storage}.deck`);
      await reload();
      await waitFor(`${DECK_COUNT_IS}(40)`);
      expect(await evaluate(`${storage}.deck`)).toEqual(saved);
      const renderedIds = await evaluate(
        `[...document.querySelectorAll('[role="group"][aria-label="Cards in your deck"] [data-physical-id]')].map(card => card.getAttribute('data-physical-id')).sort()`,
      );
      expect(renderedIds).toEqual(await evaluate(`${storage}.deck.selectedPhysicalIds.slice().sort()`));
      expect(
        await evaluate(
          `[...document.querySelectorAll('button')].find(b => b.textContent === 'Play Forge match').disabled`,
        ),
      ).toBe(false);
      expect(
        await evaluate(
          "document.querySelector('.mtg-gamedetails__list')?.textContent.includes('Plays against Forge.')",
        ),
      ).toBe(true);
      expect(
        await evaluate(
          "document.querySelector('.mtg-gamedetails__list')?.textContent.includes('Verified full-card and match interaction admission is installed.')",
        ),
      ).toBe(false);
      expect(await evaluate("document.querySelector('[role=alert]')?.textContent ?? null")).toBeNull();
      for (const width of [375, 768, 1440]) {
        await chrome.client.call(
          'Emulation.setDeviceMetricsOverride',
          {
            width,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: width === 375,
          },
          sessionId,
        );
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        expect(
          await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
          `overflow at ${width}px`,
        ).toBe(true);
      }
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
