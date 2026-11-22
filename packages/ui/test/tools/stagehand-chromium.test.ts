/**
 * `mtg-jiusn`: the armed Stagehand path needs full Chromium with Stagehand's
 * extension preloaded, not chrome-headless-shell (which has no
 * `Extensions.loadUnpacked`). No network and no real browser here; the $0
 * smoke test that launches a real Chromium lives in
 * `stagehand-chromium.browser.test.ts` and skips cleanly when one is absent.
 */
import { describe, expect, it } from 'vitest';
import type { CdpClient } from '../../test/support/chrome-driver';
import {
  buildStagehandChromiumArgs,
  chromiumPath,
  discoverStagehandExtensionId,
  extensionIdFromTargets,
  resolveHighestChromiumRevision,
  resolveStagehandExtensionDirectory,
  StagehandChromiumMissingError,
  StagehandExtensionNotFoundError,
} from '../../tools/stagehand-chromium';

const USER_DATA_DIR = '/tmp/made-up-profile-dir';
const EXTENSION_DIR = '/made-up/path/to/dist/extension/';

describe('buildStagehandChromiumArgs', () => {
  it('carries the two extension flags pointing at the given directory, and headless', () => {
    const args = buildStagehandChromiumArgs(USER_DATA_DIR, EXTENSION_DIR);
    expect(args).toContain(`--disable-extensions-except=${EXTENSION_DIR}`);
    expect(args).toContain(`--load-extension=${EXTENSION_DIR}`);
    expect(args).toContain('--headless=new');
    expect(args).toContain(`--user-data-dir=${USER_DATA_DIR}`);
  });

  it('carries the two flags the extension needs to open its own CDP websocket', () => {
    const args = buildStagehandChromiumArgs(USER_DATA_DIR, EXTENSION_DIR);
    expect(args).toContain('--remote-allow-origins=*');
    expect(args).toContain('--enable-unsafe-extension-debugging');
  });

  it('appends caller switches ahead of the trailing about:blank target', () => {
    const args = buildStagehandChromiumArgs(USER_DATA_DIR, EXTENSION_DIR, ['--host-resolver-rules=MAP x y']);
    expect(args.at(-1)).toBe('about:blank');
    expect(args).toContain('--host-resolver-rules=MAP x y');
  });
});

describe('resolveStagehandExtensionDirectory', () => {
  it('resolves to a dist/extension directory beside the installed package', () => {
    const directory = resolveStagehandExtensionDirectory();
    expect(directory).toMatch(/@browserbasehq[/\\]stagehand[/\\]dist[/\\]extension[/\\]$/);
  });
});

describe('resolveHighestChromiumRevision', () => {
  it('picks the highest chromium-<n> revision over a stubbed cache listing', () => {
    const path = resolveHighestChromiumRevision('/cache', (dir) => {
      expect(dir).toBe('/cache');
      return [
        'chromium-1208',
        'chromium-1234',
        'chromium-1217',
        'chromium-1243',
        'chromium_headless_shell-1243',
      ];
    });
    expect(path).toBe('/cache/chromium-1243/chrome-linux64/chrome');
  });

  it('returns null when the cache has no chromium-<n> directory', () => {
    expect(resolveHighestChromiumRevision('/cache', () => ['chromium_headless_shell-1243'])).toBeNull();
  });

  it('returns null when the cache directory cannot be listed', () => {
    expect(
      resolveHighestChromiumRevision('/missing', () => {
        throw new Error('ENOENT');
      }),
    ).toBeNull();
  });
});

describe('StagehandChromiumMissingError', () => {
  it('names the path, the env override, and the install command', () => {
    const error = new StagehandChromiumMissingError();
    expect(error.message).toContain(chromiumPath);
    expect(error.message).toContain('MTG_CHROMIUM');
    expect(error.message).toContain('npx playwright install chromium');
  });
});

function fakeClient(
  pages: readonly (readonly { readonly type?: string; readonly url?: string }[])[],
): CdpClient {
  let call = 0;
  return {
    call: () => {
      const targetInfos = pages[Math.min(call, pages.length - 1)];
      call += 1;
      return Promise.resolve({ targetInfos });
    },
  } as unknown as CdpClient;
}

describe('extensionIdFromTargets', () => {
  it('finds the extension id from its service worker target (found)', () => {
    const id = extensionIdFromTargets([
      { type: 'page', url: 'about:blank' },
      { type: 'service_worker', url: 'chrome-extension://abcdefghij/service-worker.js' },
    ]);
    expect(id).toBe('abcdefghij');
  });

  it('returns null when no target is the extension service worker (absent)', () => {
    expect(
      extensionIdFromTargets([
        { type: 'page', url: 'chrome-extension://abcdefghij/service-worker.js' },
        { type: 'service_worker', url: 'https://example.com/sw.js' },
        {},
      ]),
    ).toBeNull();
  });
});

describe('discoverStagehandExtensionId', () => {
  it('resolves once the service worker appears on a later poll', async () => {
    const client = fakeClient([
      [{ type: 'page', url: 'about:blank' }],
      [{ type: 'page', url: 'about:blank' }],
      [{ type: 'service_worker', url: 'chrome-extension://zzz999yyy0/service-worker.js' }],
    ]);
    await expect(discoverStagehandExtensionId(client, 5_000)).resolves.toBe('zzz999yyy0');
  });

  it('refuses with a named error at the deadline (deadline)', async () => {
    const client = fakeClient([[{ type: 'page', url: 'about:blank' }]]);
    await expect(discoverStagehandExtensionId(client, 150)).rejects.toBeInstanceOf(
      StagehandExtensionNotFoundError,
    );
  });

  it('names the deadline it waited', async () => {
    const client = fakeClient([[]]);
    const error = await discoverStagehandExtensionId(client, 150).catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(StagehandExtensionNotFoundError);
    expect((error as Error).message).toContain('150ms');
  });
});
