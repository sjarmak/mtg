// @vitest-environment node
/**
 * The cube's page head, measured in a real browser.
 *
 * `mtg-bc2.154.4.30`. The head used to be a `mtg-kicker` paragraph in a bare
 * div *above* the `h1`, and `.mtg-page-head` is `display:flex` with
 * `align-items:baseline`, so the eyebrow was drawn to the *left* of the title
 * rather than over it -- the one thing a reader would have noticed and the one
 * thing jsdom cannot see, because jsdom performs no layout and reports a
 * sideways eyebrow and a stacked one as the same tree.
 *
 * So the questions here are the two a person answers with their eyes. At a desk
 * width the title comes first and the note sits beside it on the same row. At a
 * phone width the row wraps rather than pushing the note off the screen, and
 * neither box leaves the window.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect } from 'vitest';
import { livePage } from '../support/live-page';
import { browserIt, cleanupTarget, launchChrome, shutdownChrome } from '../support/chrome';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'live-page-head-entry.ts');

let pending: Promise<string> | null = null;
function builtPage(): Promise<string> {
  pending ??= livePage(ENTRY, 'Legacy Cube head');
  return pending;
}

const SETTLED = `new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const check = () => {
    if (document.readyState === 'complete' && document.querySelector('.mtg-page-title') !== null) {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      return;
    }
    if (Date.now() > deadline) { reject(new Error('the page never drew a title')); return; }
    setTimeout(check, 25);
  };
  check();
})`;

/** The two boxes, and the window they have to stay inside. */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const head = document.querySelector('.mtg-page-head');
  const title = document.querySelector('.mtg-page-title');
  const note = head === null ? null : head.querySelector('.mtg-page-note');
  if (head === null || title === null || note === null) return { error: 'the head is missing a part' };
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom) };
  };
  return {
    title: box(title),
    note: box(note),
    noteText: note.textContent,
    // Reading order as the document states it, which is what a screen reader
    // follows and what the flex row lays out from.
    titleFirst: (title.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    viewportWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  };
})()`;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Head {
  readonly title: Box;
  readonly note: Box;
  readonly noteText: string;
  readonly titleFirst: boolean;
  readonly viewportWidth: number;
  readonly documentScrollWidth: number;
  readonly error?: string;
}

async function openHead(width: number, height: number, mobile: boolean): Promise<Head> {
  const page = await builtPage();
  const directory = await mkdtemp(join(tmpdir(), 'mtg-cube-head-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-cube-head-chrome-'));
  const chrome = await launchChrome(userDataDir);
  const file = join(directory, 'head.html');
  await writeFile(file, page, 'utf8');
  try {
    const target = await chrome.client.call('Target.createTarget', { url: 'about:blank' });
    const targetId = String(target['targetId']);
    const attached = await chrome.client.call('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = String(attached['sessionId']);
    const evaluate = async (expression: string): Promise<unknown> => {
      const answer = await chrome.client.call(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
        30_000,
      );
      const thrown = answer['exceptionDetails'];
      if (thrown !== undefined) throw new Error(`the page threw: ${JSON.stringify(thrown)}`);
      return (answer['result'] as { readonly value?: unknown } | undefined)?.value;
    };
    await chrome.client.call('Page.enable', {}, sessionId);
    await chrome.client.call('Runtime.enable', {}, sessionId);
    await chrome.client.call(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile },
      sessionId,
    );
    const navigation = await chrome.client.call(
      'Page.navigate',
      { url: pathToFileURL(file).href },
      sessionId,
    );
    if (navigation['errorText'] !== undefined) {
      throw new Error(`Chrome could not load the tab: ${String(navigation['errorText'])}`);
    }
    await evaluate(SETTLED);
    const read = (await evaluate(MEASURE)) as Head;
    if (read.error !== undefined) throw new Error(read.error);
    await cleanupTarget(chrome.client, targetId, sessionId).catch(() => undefined);
    return read;
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function assertInsideTheWindow(head: Head): void {
  expect(head.noteText, 'the head no longer says what list this is').toBe('Complete official MTGO list');
  expect(head.titleFirst, 'the note is written before the title again').toBe(true);
  expect(head.title.left, 'the title starts off the left of the window').toBeGreaterThanOrEqual(0);
  expect(head.note.right, 'the note ends past the right of the window').toBeLessThanOrEqual(
    head.viewportWidth,
  );
  expect(head.documentScrollWidth, 'the head gave the page a horizontal scroll').toBeLessThanOrEqual(
    head.viewportWidth,
  );
}

describe('the cube page head, on a live tab', () => {
  browserIt(
    'draws the note beside the title rather than before it, at 1280x800',
    async () => {
      const head = await openHead(1280, 800, false);
      assertInsideTheWindow(head);
      // One row: the note starts after the title ends, and the two overlap
      // vertically. The old markup failed the first half of that -- an eyebrow
      // written first is an eyebrow drawn left of the heading.
      expect(head.note.left, 'the note is drawn to the left of the title').toBeGreaterThanOrEqual(
        head.title.right,
      );
      expect(head.note.top, 'the note is not on the title row').toBeLessThan(head.title.bottom);
      expect(head.note.bottom).toBeGreaterThan(head.title.top);
    },
    180_000,
  );

  browserIt(
    'wraps the note under the title on a phone-sized viewport instead of pushing it off',
    async () => {
      const head = await openHead(390, 844, true);
      assertInsideTheWindow(head);
      // Wrapped or not, the two never overlap: `.mtg-page-head` is one flex row
      // and a note drawn over the heading is the failure this width finds.
      const sameRow = head.note.top < head.title.bottom && head.note.bottom > head.title.top;
      if (sameRow) {
        expect(head.note.left, 'the note overlaps the title').toBeGreaterThanOrEqual(head.title.right);
      } else {
        expect(head.note.top, 'the note is drawn above the title').toBeGreaterThanOrEqual(head.title.bottom);
      }
    },
    180_000,
  );
});
