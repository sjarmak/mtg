// @vitest-environment node
/** Fresh saved-deck launches are distinct in a real browser and remain replayable. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-fresh-game-entry.ts');

let pending: Promise<string> | null = null;
function builtPage(): Promise<string> {
  pending ??= livePage(ENTRY, 'Legacy Cube fresh game');
  return pending;
}

describe('fresh games from one completed Legacy Cube draft', () => {
  browserIt(
    'changes only the match seed twice and replays the newest exact seed',
    async () => {
      const page = await builtPage();
      const directory = await mkdtemp(join(tmpdir(), 'mtg-fresh-game-'));
      const chromeDirectory = await mkdtemp(join(tmpdir(), 'mtg-fresh-game-chrome-'));
      const file = join(directory, 'fresh-game.html');
      await writeFile(file, page, 'utf8');
      const chrome = await launchChrome(chromeDirectory);
      let targetId = '';
      let sessionId: string | null = null;
      try {
        const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
        targetId = String(target['targetId']);
        const attached = await chrome.client.call('Target.attachToTarget', { targetId, flatten: true });
        sessionId = String(attached['sessionId']);
        await chrome.client.call('Page.enable', {}, sessionId);
        await chrome.client.call('Page.navigate', { url: pathToFileURL(file).href }, sessionId);

        const result = await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `new Promise((resolve, reject) => {
              const deadline = Date.now() + 30000;
              const named = (label) => [...document.querySelectorAll('button')].find(
                (button) => button.textContent?.trim() === label && !button.disabled
              );
              const waitFor = (test, message) => new Promise((innerResolve, innerReject) => {
                const check = () => {
                  const value = test();
                  if (value) { innerResolve(value); return; }
                  if (Date.now() > deadline) { innerReject(new Error(message)); return; }
                  requestAnimationFrame(check);
                };
                check();
              });
              (async () => {
                await waitFor(
                  () => localStorage.getItem('mtg.legacy-cube.session'),
                  'the completed drafted deck was not persisted'
                );
                const initialSession = localStorage.getItem('mtg.legacy-cube.session');
                for (let index = 0; index < 2; index += 1) {
                  const button = await waitFor(() => named('Play a new game'), 'fresh-game button missing');
                  button.click();
                  await waitFor(
                    () => globalThis.__legacyCubeOpenedSeeds?.length === index + 1,
                    'backend did not receive a fresh seed'
                  );
                }
                const replay = await waitFor(() => named('Replay last game'), 'replay button missing');
                replay.click();
                await waitFor(
                  () => globalThis.__legacyCubeOpenedSeeds?.length === 3,
                  'backend did not receive the replay seed'
                );
                resolve({
                  seeds: globalThis.__legacyCubeOpenedSeeds,
                  initialSession,
                  finalSession: localStorage.getItem('mtg.legacy-cube.session'),
                  match: JSON.parse(localStorage.getItem('mtg.legacy-cube.match') ?? 'null'),
                  forgeSurface: document.querySelector('[aria-label="Forge match"]') !== null,
                });
              })().catch(reject);
            })`,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
          35_000,
        );
        expect(result['exceptionDetails']).toBeUndefined();
        const value = (result['result'] as { readonly value: Record<string, unknown> }).value;
        const seeds = value['seeds'] as readonly string[];
        expect(seeds).toHaveLength(3);
        expect(seeds[0]).not.toBe(seeds[1]);
        expect(seeds[2]).toBe(seeds[1]);
        expect((value['match'] as { readonly matchSeed: string }).matchSeed).toBe(seeds[1]);
        expect(value['finalSession']).toBe(value['initialSession']);
        expect(value['forgeSurface']).toBe(false);
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
