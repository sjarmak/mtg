// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';
import display from '../../../data/data/akh-hou/akh-hou-display-metadata-v1.json';

browserIt(
  'sorts and filters printed rarity through the live gallery controls',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'printed-gallery-'));
    const profile = await mkdtemp(join(tmpdir(), 'printed-gallery-chrome-'));
    const chrome = await launchChrome(profile);
    let targetId = '';
    let sessionId = '';
    const evaluate = async (expression: string) => {
      const result = await chrome.client.call(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      if (result['exceptionDetails']) throw new Error(JSON.stringify(result['exceptionDetails']));
      return (result['result'] as { value: unknown }).value;
    };
    try {
      const page = await livePage(
        fileURLToPath(new URL('./live-printed-gallery-entry.ts', import.meta.url)),
        'Printed gallery',
      );
      const path = join(directory, 'gallery.html');
      await writeFile(path, page);
      targetId = String(
        (await chrome.client.call('Target.createTarget', { url: 'about:blank' }))['targetId'],
      );
      sessionId = String(
        (await chrome.client.call('Target.attachToTarget', { targetId, flatten: true }))['sessionId'],
      );
      await chrome.client.call('Page.enable', {}, sessionId);
      await chrome.client.call(
        'Emulation.setDeviceMetricsOverride',
        { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await chrome.client.call('Page.navigate', { url: pathToFileURL(path).href }, sessionId);
      await evaluate(`new Promise((resolve, reject) => { let n=0; const check=()=> {
      if(document.querySelectorAll('[data-physical-id]').length===550)return resolve(true);
      if(n++>200)return reject(Error('gallery did not load'));setTimeout(check,25);
    };check();})`);
      const change = async (label: string, value: string) => {
        await evaluate(`(() => {
        const control=[...document.querySelectorAll('label')].find(e=>e.firstChild.textContent===${JSON.stringify(label)}).querySelector('select');
        control.value=${JSON.stringify(value)};control.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
        await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
      };
      const ids = () =>
        evaluate(
          `[...document.querySelectorAll('[data-physical-id]')].map(e=>e.getAttribute('data-physical-id'))`,
        ) as Promise<string[]>;
      const rarities = Object.fromEntries(display.catalogs.flatMap((row) => Object.entries(row.rarities)));
      await change('Sort', 'Rarity');
      const ranks = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'];
      const ordered = (await ids()).map((id) => ranks.indexOf(rarities[id]!));
      expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
      await change('Rarity', 'mythic');
      const mythics = await ids();
      expect(mythics.length).toBeGreaterThan(0);
      expect(mythics.every((id) => rarities[id] === 'mythic')).toBe(true);
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Clear filters').click()`,
      );
      await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
      expect(await ids()).toHaveLength(550);
    } finally {
      if (targetId && sessionId) await cleanupTarget(chrome.client, targetId, sessionId);
      await shutdownChrome(chrome);
      await rm(directory, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
    }
  },
  60_000,
);
