/**
 * `mtg-jiusn`'s $0 half of the acceptance criterion: prove the armed path
 * reaches `localBrowser.connect()` on a real, unpaid Chromium, extension and
 * all. It never calls `observe()` or touches Jev/`@mtg/llm`, so it spends
 * nothing; only the lead's `npm run verify:live` run pays for the journey
 * itself. `chromiumPresent` is `stagehand-chromium.ts`'s own check (a second,
 * separate Playwright cache entry from chrome-headless-shell's), so this
 * skips cleanly on a checkout that has never run
 * `npx playwright install chromium`.
 *
 * The second test (`mtg-ex4go`) carries the smoke test through
 * `Stagehand.create()`, the same call `stagehand-runner.ts`'s armed path
 * makes right after `localBrowser.connect`. `connect()` alone doesn't open
 * the extension's own CDP websocket — that happens inside `create()`'s
 * `initialize()`, which sends the RPC init over the extension's
 * service-worker connection (`rpcClient.sendStagehandInit`) — so a test that
 * stops at `connect()` cannot see `--remote-allow-origins`/
 * `--enable-unsafe-extension-debugging` missing: it passed against
 * origin/main 29bda866d (pre-fix) exactly as it does now, `connect()` never
 * touching that websocket at all. `create()` is also the earliest point that
 * does, which is why this stops there rather than one step further at
 * `observe()`/`act()`: the model callback Stagehand wires through
 * `model.generate` is never invoked by `create()` itself (confirmed by
 * reading `initialize()` in `dist/index.mjs`: it only registers the handler),
 * so the stub below asserts it is never called rather than merely being
 * unreachable, and no `observe()`/`act()` runs, so nothing here touches Jev
 * or `@mtg/llm` or the network beyond loopback CDP.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localBrowser, Stagehand } from '@browserbasehq/stagehand';
import { shutdownChrome } from '../support/chrome-driver';
import {
  chromiumPresent,
  discoverStagehandExtensionId,
  launchStagehandChromium,
} from '../../tools/stagehand-chromium';

// Deliberately not `browserIt` from `../support/chrome`: that honors
// `MTG_REQUIRE_BROWSER=1` by failing instead of skipping, which CI sets, and
// `mtg-onjme.2` binds this lane to spending nothing and to CI never taking the
// Stagehand path at all. A skip here must stay a skip everywhere.
const maybeIt = chromiumPresent ? it : it.skip;
const EXTENSION_DEADLINE_MS = 10_000;

describe('launchStagehandChromium against a real Chromium', () => {
  maybeIt(
    'loads the bundled extension and connects, without calling observe()',
    async () => {
      const profile = await mkdtemp(join(tmpdir(), 'stagehand-chromium-smoke-'));
      const chrome = await launchStagehandChromium(profile);
      try {
        const extensionId = await discoverStagehandExtensionId(chrome.client, EXTENSION_DEADLINE_MS);
        const browser = await localBrowser.connect({ cdpUrl: chrome.debuggerUrl, extensionId });
        try {
          if (browser.closed) throw new Error('localBrowser.connect returned an already-closed browser');
        } finally {
          await browser.close();
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(profile, { recursive: true, force: true });
      }
    },
    30_000,
  );

  maybeIt(
    'creates a Stagehand instance over the extension, without calling observe() or the model',
    async () => {
      const profile = await mkdtemp(join(tmpdir(), 'stagehand-chromium-create-smoke-'));
      const chrome = await launchStagehandChromium(profile);
      let generateCalled = false;
      try {
        const extensionId = await discoverStagehandExtensionId(chrome.client, EXTENSION_DEADLINE_MS);
        const browser = await localBrowser.connect({ cdpUrl: chrome.debuggerUrl, extensionId });
        // Never invoked by create()/initialize() itself: it only registers
        // this as the handler for a future llmGenerate RPC, which only an
        // observe()/act() call would trigger. Asserted below so a future
        // Stagehand version that DID call it during create() would fail
        // this test loudly instead of silently reaching the network.
        const stagehand = await Stagehand.create({
          browser,
          model: {
            generate: () => {
              generateCalled = true;
              throw new Error('model.generate must not be called by Stagehand.create()');
            },
          },
        });
        try {
          expect(stagehand.initialized).toBe(true);
        } finally {
          // Closes the claimed browser too; a separate browser.close() here
          // would double-close it.
          await stagehand.close();
        }
      } finally {
        expect(generateCalled).toBe(false);
        await shutdownChrome(chrome);
        await rm(profile, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
