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
  'builds and restores an actual AKH/HOU sealed pool with admitted play in Chrome',
  async () => {
    const page = await livePage(
      fileURLToPath(new URL('./live-printed-sealed-entry.ts', import.meta.url)),
      'Printed sealed',
    );
    const directory = await mkdtemp(join(tmpdir(), 'mtg-printed-sealed-'));
    const userData = await mkdtemp(join(tmpdir(), 'mtg-printed-sealed-chrome-'));
    const chrome = await launchChrome(userData);
    const loaded = chrome.client.record('Page.domContentEventFired');
    let targetId = '';
    let sessionId = '';
    const evaluate = async (expression: string): Promise<unknown> => {
      const response = await chrome.client.call(
        'Runtime.evaluate',
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
        30_000,
      );
      if (response['exceptionDetails'] !== undefined)
        throw new Error(JSON.stringify(response['exceptionDetails']));
      return (response['result'] as { readonly value?: unknown }).value;
    };
    const waitForCount = (count: number) =>
      evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const check = () => {
      if (document.documentElement !== null && !document.documentElement.hasAttribute('data-before-reload') && ${DECK_COUNT_IS}(${count})) return resolve(true);
      if (Date.now() > deadline) return reject(new Error(document.body.innerText));
      setTimeout(check, 25);
    }; check();
  })`);
    try {
      const file = join(directory, 'sealed.html');
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
        chrome.client.call(
          'Page.navigate',
          {
            // ce464526 gave Play its own sections and `?seed=`/`?source=` are not
            // among the params `router.ts`'s tokenSub infers a section from, so a
            // bare `#/play` now lands on the Constructed default instead of Sealed.
            url: `${pathToFileURL(file).href}#/play/sealed?seed=browser-sealed&source=printed%3Aakh-hou`,
          },
          sessionId,
        ),
      ]);
      await waitForCount(0);
      await chrome.client.call(
        'Emulation.setDeviceMetricsOverride',
        {
          width: 1440,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );
      expect(
        await evaluate(
          `document.querySelector('[data-pane="pool"] .mtg-deck__pane-scroll').getBoundingClientRect().top`,
        ),
        'The pool should start in the upper third of the desktop, not halfway down',
      ).toBeLessThan(300);
      await evaluate("document.querySelector('.mtg-gamedetails summary').click()");
      expect(await evaluate("document.body.innerText.includes('84 physical cards')")).toBe(true);
      await evaluate(
        "[...document.querySelectorAll('button')].find(b => b.textContent === 'Suggest a build').focus()",
      );
      expect(await evaluate('document.activeElement.textContent')).toBe('Suggest a build');
      for (const type of ['keyDown', 'keyUp']) {
        await chrome.client.call(
          'Input.dispatchKeyEvent',
          { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
          sessionId,
        );
      }
      await waitForCount(40);
      const selected = await evaluate(`JSON.parse(localStorage.getItem(
        Object.keys(localStorage).find(key => key.startsWith('mtg.printed.sealed:'))
      )).deck.selectedPhysicalIds`);
      await evaluate(
        "[...document.querySelectorAll('a')].find(a => a.textContent === 'Saved decks').click()",
      );
      await evaluate(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const check = () => {
          const link = [...document.querySelectorAll('a')].find(a => a.textContent === 'Open sealed pool browser-sealed');
          if (link) { link.focus(); return resolve(true); }
          if (Date.now() > deadline) return reject(new Error(document.body.innerText));
          setTimeout(check, 25);
        }; check();
      })`);
      expect(await evaluate('document.activeElement.textContent')).toBe('Open sealed pool browser-sealed');
      for (const type of ['keyDown', 'keyUp']) {
        await chrome.client.call(
          'Input.dispatchKeyEvent',
          {
            type,
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
          },
          sessionId,
        );
      }
      await waitForCount(40);
      expect(
        await evaluate(`JSON.parse(localStorage.getItem(
        Object.keys(localStorage).find(key => key.startsWith('mtg.printed.sealed:'))
      )).deck.selectedPhysicalIds`),
      ).toEqual(selected);
      expect(
        await evaluate(
          `[...document.querySelectorAll('[role="group"][aria-label="Cards in your deck"] [data-physical-id]')].map(card => card.getAttribute('data-physical-id')).sort()`,
        ),
      ).toEqual([...(selected as string[])].sort());
      expect(
        await evaluate(
          "[...document.querySelectorAll('button')].find(b => b.textContent === 'Play Forge match').disabled",
        ),
      ).toBe(false);
      await evaluate("document.documentElement.setAttribute('data-before-reload', 'true')");
      await Promise.all([loaded.next(), chrome.client.call('Page.reload', {}, sessionId)]);
      await waitForCount(40);
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
