// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect } from 'vitest';
import { UI_SUBS } from '../../src/app/router';
import { Shell } from '../../src/app/Shell';
import type { ShellAt } from '../../src/app/Shell';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const ROUTES: readonly ShellAt[] = [
  { mode: 'play', sub: 'commander' },
  { mode: 'customize', sub: 'sets' },
  { mode: 'cards', sub: 'gallery' },
];

const SIZES = [
  { width: 1390, height: 831 },
  { width: 768, height: 1024 },
] as const;

function page(route: ShellAt, content: ReactElement = h('main', null, 'Content')): string {
  const markup = renderToStaticMarkup(
    h(Shell, { ...route, onSelectMode: () => undefined, children: content }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const mode = document.querySelector('.mtg-modes__item');
  const sub = document.querySelector('.mtg-subs__item');
  const row = document.querySelector('.mtg-subs');
  if (mode === null || sub === null || row === null) return null;
  const read = (element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      height: Math.round(element.getBoundingClientRect().height * 100) / 100,
    };
  };
  return {
    mode: read(mode),
    sub: read(sub),
    rowOverflow: row.scrollWidth - row.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

interface ElementReading {
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly paddingTop: string;
  readonly paddingBottom: string;
  readonly height: number;
}

const PHONE = { width: 390, height: 844 } as const;

const PHONE_ROUTE: ShellAt = { mode: 'play', sub: 'commander' };

const PHONE_MEASURE = `(() => {
  const row = document.querySelector('.mtg-subs');
  if (row === null) return null;
  return {
    display: getComputedStyle(row).display,
    items: Array.from(row.querySelectorAll('.mtg-subs__item')).map((item) => {
      const box = item.getBoundingClientRect();
      return { left: box.left, right: box.right, height: box.height };
    }),
    rowOverflow: row.scrollWidth - row.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

interface PhoneReading {
  readonly display: string;
  readonly items: readonly { readonly left: number; readonly right: number; readonly height: number }[];
  readonly rowOverflow: number;
  readonly pageOverflow: number;
}

interface Reading {
  readonly mode: ElementReading;
  readonly sub: ElementReading;
  readonly rowOverflow: number;
  readonly pageOverflow: number;
}

describe('section tabs', () => {
  browserIt(
    'match the mode tabs without wrapping or overflowing',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-section-tabs-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-section-tabs-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        for (const route of ROUTES) {
          const file = join(directory, `${route.mode}.html`);
          await writeFile(file, page(route), 'utf8');
          for (const size of SIZES) {
            const at = `${route.mode} at ${String(size.width)}x${String(size.height)}`;
            const seen = (await measurePage(
              chrome.client,
              file,
              size.width,
              size.height,
              MEASURE,
              at,
              '.mtg-subs__item',
            )) as unknown as Reading | null;
            if (seen === null) throw new Error(`${at}: the shell did not draw both tab rows`);
            expect(seen.sub.fontSize, `${at}: section label size`).toBe(seen.mode.fontSize);
            expect(seen.sub.lineHeight, `${at}: section label line height`).toBe(seen.mode.lineHeight);
            expect(seen.sub.paddingTop, `${at}: section top padding`).toBe(seen.mode.paddingTop);
            expect(seen.sub.paddingBottom, `${at}: section bottom padding`).toBe(seen.mode.paddingBottom);
            expect(seen.sub.height, `${at}: section tab height`).toBe(seen.mode.height);
            expect(seen.rowOverflow, `${at}: section row overflow`).toBeLessThanOrEqual(1);
            expect(seen.pageOverflow, `${at}: page overflow`).toBeLessThanOrEqual(1);
          }
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  browserIt(
    'stay within reach on a phone held upright until a table or a draft screen is drawn',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-section-tabs-phone-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-section-tabs-phone-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const read = async (name: string, content?: ReactElement): Promise<PhoneReading> => {
        const file = join(directory, `${name}.html`);
        await writeFile(file, page(PHONE_ROUTE, content), 'utf8');
        const seen = (await measurePage(
          chrome.client,
          file,
          PHONE.width,
          PHONE.height,
          PHONE_MEASURE,
          `${name} at ${String(PHONE.width)}x${String(PHONE.height)}`,
          '.mtg-subs__item',
          true,
          { mobile: true, pointer: 'coarse' },
        )) as unknown as PhoneReading | null;
        if (seen === null) throw new Error(`${name}: the shell did not draw a section row`);
        return seen;
      };
      try {
        const landing = await read('landing');
        expect(landing.display, 'the row on a page with no table').toBe('flex');
        expect(landing.items, 'one tab per Play section').toHaveLength(UI_SUBS.play.length);
        for (const item of landing.items) {
          expect(item.left, 'tab left edge').toBeGreaterThanOrEqual(0);
          expect(item.right, 'tab right edge').toBeLessThanOrEqual(PHONE.width);
          expect(item.height, 'tab height').toBeGreaterThan(0);
        }
        expect(landing.rowOverflow, 'section row overflow').toBeLessThanOrEqual(1);
        expect(landing.pageOverflow, 'page overflow').toBeLessThanOrEqual(1);

        const table = await read('table', h('div', { className: 'mtg-board' }, 'Content'));
        expect(table.display, 'the row beside a table').toBe('none');

        const draft = await read('draft', h('div', { className: 'mtg-screen' }, 'Content'));
        expect(draft.display, 'the row beside a draft screen').toBe('none');
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
