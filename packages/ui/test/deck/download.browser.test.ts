// @vitest-environment node
/**
 * What actually happens when this app hands somebody a file, measured.
 *
 * `mtg-l191`. `../../src/routes/deck/browser-file.ts` is built around a claim it
 * could not check: a page-initiated download reports nothing, so `saveTextFile`
 * returns whether the browser was *asked* and never that a file arrived. The
 * measurement was out of reach because the CDP harness dropped every event, and
 * the browser's own account of a download is the only account there is. The
 * harness records events now (`../support/cdp-events.test.ts`), and this is the
 * rig that spends them.
 *
 * The page here is not the React app. These rigs render static markup and run no
 * client bundle, so what is opened is a page performing `saveTextFile`'s exact
 * DOM sequence — `createElement('a')`, a `download` name, a `data:` href, a
 * page-dispatched `click` — and reporting what that call expression evaluated
 * to. Copying six lines is the point rather than a shortcut: the subject is the
 * browser's behavior in the face of that sequence, and the assertion that the
 * app performs this sequence belongs to `./deck-file.test.ts`, which reads the
 * module.
 *
 * ## What is measured, and the one thing that is not
 *
 * The page is opened from `file://`, because that is where these pages get
 * opened from: `../../src/app/router.ts` records that the app is a hash router
 * so a built page works out of an `out/` run directory.
 *
 *  - **Allowed.** The browser accepts the download and a file lands on disk with
 *    the name the anchor asked for. `Browser.downloadWillBegin` fires and the
 *    page is told nothing.
 *  - **Denied.** `Browser.downloadWillBegin` still fires, the download is
 *    canceled, no file lands, and the page is told nothing — the same
 *    `undefined` from the same click, and `saveTextFile` returns the same
 *    `true`. That is the silence the seam is built around, shown rather than
 *    argued.
 *
 * What this rig cannot measure is Chrome's untouched default from `file://`,
 * because CDP only emits download events once `Browser.setDownloadBehavior` has
 * been called with `eventsEnabled`, and that call is itself a download-behavior
 * setting. So the bead's "which browsers refuse it here" stays open for the
 * default; what is settled is that refusal and acceptance are indistinguishable
 * to the page, which is the fact the seam depends on.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import type { CdpClient } from '../support/chrome';
import { browserIt, launchChrome, shutdownChrome } from '../support/chrome';

const FILE_NAME = 'lantern-fen-sealed.txt';
const CONTENT = '4 Forest\n4 Mountain\n2 Lantern Bearer\n';

/** `saveTextFile`'s sequence, inlined, reporting what the page can see of it. */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>download seam</title>
<script>
  globalThis.__saved = (() => {
    try {
      const anchor = document.createElement('a');
      anchor.download = ${JSON.stringify(FILE_NAME)};
      anchor.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(${JSON.stringify(CONTENT)});
      const returned = anchor.click();
      return { asked: true, clickReturned: typeof returned };
    } catch (error) {
      return { asked: false, clickReturned: String(error) };
    }
  })();
</script>
<body>the page above asked for a file and was told nothing</body>
`;

interface Chrome {
  readonly child: Awaited<ReturnType<typeof launchChrome>>['child'];
  readonly client: CdpClient;
}

let chrome: Chrome | null = null;
let profile = '';
let workspace = '';

beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'mtg-download-profile-'));
  workspace = await mkdtemp(join(tmpdir(), 'mtg-download-'));
  await writeFile(join(workspace, 'download.html'), PAGE, 'utf8');
  chrome = await launchChrome(profile);
}, 30_000);

afterAll(async () => {
  if (chrome !== null) await shutdownChrome(chrome);
  chrome = null;
  if (profile !== '') await rm(profile, { recursive: true, force: true });
  if (workspace !== '') await rm(workspace, { recursive: true, force: true });
});

const SETTLED = new Set(['completed', 'canceled']);

/**
 * Waits until the browser has said how the download ended, or until it is clear
 * it is not going to say anything.
 *
 * A refusal that fires no event at all is one of the outcomes this rig has to be
 * able to record, so every wait here is bounded and a timeout is a result rather
 * than a failure.
 */
async function waitForSettled(recording: {
  next: (ms?: number) => Promise<{ readonly params: Record<string, unknown> }>;
}): Promise<void> {
  for (let seen = 0; seen < 8; seen += 1) {
    const event = await recording.next(3_000).catch(() => null);
    if (event === null) return;
    const state = event.params['state'];
    if (typeof state === 'string' && SETTLED.has(state)) return;
  }
}

/**
 * Opens the page under one download behavior and reports both sides of it: what
 * the page saw, and what the browser said.
 */
async function askForTheFile(behavior: 'allow' | 'deny'): Promise<{
  readonly page: Record<string, unknown>;
  readonly began: readonly Record<string, unknown>[];
  readonly progress: readonly string[];
  readonly landed: readonly string[];
  readonly downloads: string;
}> {
  const client = chrome?.client;
  if (client === undefined) throw new Error('Chrome did not start');
  const downloads = await mkdtemp(join(workspace, `${behavior}-`));
  const target = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(target['targetId']);
  const recording = client.record('Browser.downloadWillBegin', 'Browser.downloadProgress');
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call('Browser.setDownloadBehavior', {
      behavior,
      downloadPath: downloads,
      eventsEnabled: true,
    });
    const navigation = await client.call(
      'Page.navigate',
      {
        url: pathToFileURL(join(workspace, 'download.html')).href,
      },
      sessionId,
    );
    if (navigation['errorText'] !== undefined) {
      throw new Error(`could not open the download page: ${String(navigation['errorText'])}`);
    }
    // The browser is allowed to say nothing; a refusal that fires no event is
    // one of the outcomes this rig exists to be able to record. A download that
    // does begin is written asynchronously, so the wait runs on to the progress
    // event that says how it ended rather than stopping at "will begin" and
    // reading a directory the browser has not finished with.
    await waitForSettled(recording);
    const evaluated = await client.call(
      'Runtime.evaluate',
      { expression: 'globalThis.__saved', returnByValue: true },
      sessionId,
    );
    const page = (evaluated['result'] as { readonly value?: Record<string, unknown> } | undefined)?.value;
    return {
      page: page ?? {},
      began: recording.of('Browser.downloadWillBegin').map((event) => event.params),
      progress: recording.of('Browser.downloadProgress').map((event) => String(event.params['state'])),
      landed: await readdir(downloads),
      downloads,
    };
  } finally {
    recording.stop();
    await client.call('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => undefined);
    await client.call('Target.closeTarget', { targetId }).catch(() => undefined);
  }
}

describe('a page-initiated download from file://', () => {
  browserIt(
    'lands the file when the browser allows it, and tells the page nothing',
    async () => {
      const { page, began, progress, landed, downloads } = await askForTheFile('allow');

      expect(page['asked']).toBe(true);
      expect(page['clickReturned']).toBe('undefined');
      expect(began).toHaveLength(1);
      expect(began[0]?.['suggestedFilename']).toBe(FILE_NAME);
      expect(progress).toContain('completed');
      expect(landed).toContain(FILE_NAME);
      // The bytes the anchor asked for, so "landed" means the file and not a
      // part-written placeholder beside it.
      expect(await readFile(join(downloads, FILE_NAME), 'utf8')).toBe(CONTENT);
    },
    20_000,
  );

  browserIt(
    'lands nothing when the browser denies it, and tells the page exactly the same nothing',
    async () => {
      const { page, began, progress, landed } = await askForTheFile('deny');

      expect(page['asked']).toBe(true);
      expect(page['clickReturned']).toBe('undefined');
      expect(landed).toStrictEqual([]);
      // Whatever the browser said to CDP, it said nothing to the page: this is
      // the whole reason saveTextFile reports "asked" and never "saved". What it
      // said to CDP, measured, is a download that began and was then canceled.
      expect(began).toHaveLength(1);
      expect(began[0]?.['suggestedFilename']).toBe(FILE_NAME);
      expect(progress).toStrictEqual(['inProgress', 'canceled']);
    },
    20_000,
  );
});
