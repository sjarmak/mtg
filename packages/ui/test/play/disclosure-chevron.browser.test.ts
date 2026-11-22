// @vitest-environment node
/**
 * The two disclosure buttons on the table, read as words rather than as boxes.
 *
 * `mtg-dcxg.10`, 2026-08-23. Both controls draw a chevron span and a label span
 * (`../../src/routes/play/rail-collapse.ts`, `../../src/routes/play/ask-collapse.ts`)
 * and `../../src/styles/board/rail.ts` has stated `gap: var(--mtg-space-1)` and
 * `justify-content: center` on them since they were written. Neither did
 * anything: `../../src/styles/base.ts`'s `.mtg-btn` sets no `display`, a
 * `<button>` is inline-block until something says otherwise, and both
 * declarations are flex properties. Every board shot in the 2026-08-23 sweep
 * therefore reads `‹Game details` and `›Side panel`, the arrow against the
 * first letter of the word it is about.
 *
 * A jsdom test cannot see this — the two spans are there either way, in the
 * right order, with the right accessible name on the button. What is wrong is
 * the distance between them in pixels, so it is measured off a real Chrome.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { FIXTURE_NAMES, stackedBoard, VIEWER } from '../../src/dev/fixtures/board';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: stackedBoard(),
        viewer: VIEWER,
        names: FIXTURE_NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Disclosures</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading per disclosure: the arrow's box, the word's box, and the space
 * between them.
 *
 * The label's box is the span's, not a range over the text: the label is left in
 * its own element precisely so the arrow has something to be separated from, and
 * the span is as wide as the word inside it.
 */
const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const read = (toggle, chevron, label) => {
    const button = document.querySelector(toggle);
    if (button === null) return null;
    const arrow = button.querySelector(chevron);
    const word = button.querySelector(label);
    if (arrow === null || word === null) return null;
    const a = arrow.getBoundingClientRect();
    const w = word.getBoundingClientRect();
    return {
      display: getComputedStyle(button).display,
      gap: round(w.left - a.right),
      arrowText: (arrow.textContent ?? '').trim(),
      labelText: (word.textContent ?? '').trim(),
      sameRow: Math.abs((a.top + a.bottom) / 2 - (w.top + w.bottom) / 2) < 4,
    };
  };
  return {
    fontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
    ask: read('.mtg-ask__toggle', '.mtg-ask__chevron', '.mtg-ask__toggle-label'),
    rail: read('.mtg-rail__toggle', '.mtg-rail__chevron', '.mtg-rail__toggle-label'),
  };
})()`);

interface Toggle {
  readonly display: string;
  readonly gap: number;
  readonly arrowText: string;
  readonly labelText: string;
  readonly sameRow: boolean;
}

interface Reading {
  readonly fontSize: number;
  readonly ask: Toggle | null;
  readonly rail: Toggle | null;
}

/**
 * `--mtg-space-1` is a quarter of the root font size, which is 4px at the
 * default 16. Two thirds of it is the floor asserted, so a re-tune of the token
 * is not a failure and a control with no separation at all still is.
 */
const GAP_SHARE = 0.25 * (2 / 3);

const DESK = { width: 1440, height: 900 } as const;

describe('the table’s disclosure buttons', () => {
  browserIt(
    'put a space between the arrow and the word it is about',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-chevron-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-chevron-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'play.html');
      await writeFile(file, page(), 'utf8');
      try {
        const seen = (await measurePage(
          chrome.client,
          file,
          DESK.width,
          DESK.height,
          MEASURE,
          `${String(DESK.width)}x${String(DESK.height)}`,
          '.mtg-board',
          true,
          { mobile: false, pointer: 'fine' },
        )) as unknown as Reading | null;
        if (seen === null) throw new Error('the page drew no board');

        const floor = seen.fontSize * GAP_SHARE;
        for (const [name, toggle] of [
          ['the ask column', seen.ask],
          ['the side rail', seen.rail],
        ] as const) {
          if (toggle === null) throw new Error(`${name} drew no disclosure`);
          expect(toggle.display, `${name}’s toggle is not a flex row`).toBe('flex');
          expect(toggle.sameRow, `${name}’s arrow and label are on different rows`).toBe(true);
          expect(
            toggle.gap,
            `${name} draws “${toggle.arrowText}${toggle.labelText}” with the arrow against the word`,
          ).toBeGreaterThanOrEqual(floor);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
