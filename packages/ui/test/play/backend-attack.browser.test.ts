// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';
import { livePage } from '../support/live-page';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'backend-attack-live-entry.ts');

interface AttackOutcome {
  readonly moves: readonly string[];
  readonly initialButton: string;
  readonly stagedButton: string;
  readonly currentAskVisible: boolean;
  readonly stagedCard: boolean;
  readonly declaredCard: boolean;
  readonly declaredCardTapped: boolean;
}

describe('the shared observed-backend attacker gesture in a real browser', () => {
  browserIt(
    'stages a battlefield card and commits through the combat-band confirmation',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-backend-attack-'));
      const chromeDirectory = await mkdtemp(join(tmpdir(), 'mtg-backend-attack-chrome-'));
      const file = join(directory, 'attack.html');
      await writeFile(file, await livePage(ENTRY, 'Backend attacker gesture'), 'utf8');
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
        const evaluated = await chrome.client.call(
          'Runtime.evaluate',
          {
            expression: `(async () => {
              const waitFor = async (description, predicate) => {
                const deadline = Date.now() + 10000;
                while (Date.now() < deadline) {
                  const value = predicate();
                  if (value) return value;
                  await new Promise((resolve) => requestAnimationFrame(resolve));
                }
                throw new Error('timed out waiting for ' + description);
              };
              const namedButton = (name) => Array.from(document.querySelectorAll('button')).find(
                (button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name,
              );
              const card = await waitFor('Savannah Lions card', () => Array.from(
                document.querySelectorAll('button.mtg-card'),
              ).find((button) => (button.getAttribute('aria-label') ?? '').startsWith('Savannah Lions.')));
              const initial = await waitFor('No attacks confirmation', () => namedButton('No attacks'));
              const initialButton = (initial.textContent ?? '').trim();
              card.click();
              const staged = await waitFor('Attack with 1 confirmation', () => namedButton('Attack with 1'));
              const beforeCommit = {
                initialButton,
                stagedButton: (staged.textContent ?? '').trim(),
                currentAskVisible: document.querySelector('[role="region"][aria-label="Current ask"]') !== null,
                stagedCard: document.querySelector('[data-state="staged"]') !== null,
              };
              staged.click();
              await waitFor('both opaque combat submissions', () => window.mtgAttack?.moves?.length === 2);
              const declared = await waitFor('declared attacker in combat band', () =>
                document.querySelector('[data-state="declared"]'));
              return {
                ...beforeCommit,
                declaredCard: declared.closest('[aria-label="Combat"]') !== null,
                declaredCardTapped: declared.querySelector('[data-tapped="true"]') !== null,
                moves: window.mtgAttack.moves,
              };
            })()`,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
          15_000,
        );
        expect(evaluated['exceptionDetails']).toBeUndefined();
        expect((evaluated['result'] as { readonly value: AttackOutcome }).value).toEqual({
          initialButton: 'No attacks',
          stagedButton: 'Attack with 1',
          currentAskVisible: false,
          stagedCard: true,
          declaredCard: true,
          declaredCardTapped: true,
          moves: ['opaque-add-lion', 'opaque-finish-attackers'],
        });
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
