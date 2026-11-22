// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';
import { livePage } from '../support/live-page';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'backend-auto-payment-live-entry.ts');

interface Outcome {
  readonly moves: readonly string[];
  readonly birdsTapped: string | null;
  readonly islandTapped: string | null;
}

describe('backend automatic mana payment in a real browser', () => {
  browserIt(
    'casts from the shared hand while preserving Birds of Paradise for a later spell',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-backend-auto-payment-'));
      const file = join(directory, 'payment.html');
      await writeFile(file, await livePage(ENTRY, 'Backend automatic payment'), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const measured = await measurePage(
          chrome.client,
          file,
          1440,
          900,
          `(() => ({
            moves: globalThis.mtgAutoPayment?.moves ?? [],
            birdsTapped: document.querySelector('[data-permanent-key="browser:birds:54"]')?.getAttribute('data-tapped') ?? null,
            islandTapped: document.querySelector('[data-permanent-key="browser:island:61"]')?.getAttribute('data-tapped') ?? null,
          }))()`,
          'backend automatic payment',
          '[data-permanent-key="browser:florahedron:59"]',
        );
        const outcome = measured as unknown as Outcome;
        expect(outcome.moves).toEqual(['opaque-cast-florahedron', 'opaque-use-island']);
        expect(outcome.birdsTapped).toBe('false');
        expect(outcome.islandTapped).toBe('true');
      } catch (error) {
        bodyError = error;
      }
      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(reason(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(reason(error)));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(reason(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `browser automatic-payment proof or cleanup failed: ${cleanupErrors
            .map((error) => error.message)
            .join('; ')}`,
        );
      }
    },
    180_000,
  );
});
