// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { playBlurb, playSection } from '../../src/routes/play/PlayLanding';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const VIEWS = ['Constructed', 'Draft', 'Sealed', 'Commander'] as const;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'ipad-portrait', width: 768, height: 1024 },
] as const;

function page(): string {
  const sections = VIEWS.map((label) =>
    playSection(
      { label, titled: true, boxed: true },
      playBlurb(`Choose how to play ${label.toLocaleLowerCase('en-US')} with this set.`),
    ),
  );
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h('div', { className: 'mtg-play-route' }, ...sections),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Play choices</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => ({
  viewport: [document.documentElement.clientWidth, document.documentElement.clientHeight],
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  views: Array.from(document.querySelectorAll('.mtg-playsection')).map((section) => {
    const title = section.querySelector('.mtg-playsection__title');
    const blurb = section.querySelector('.mtg-playsection__blurb');
    const box = section.getBoundingClientRect();
    return {
      label: title?.textContent?.trim() ?? '',
      titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
      blurbSize: Number.parseFloat(getComputedStyle(blurb).fontSize),
      width: Math.round(box.width * 100) / 100,
      clipped: section.scrollWidth > section.clientWidth || section.scrollHeight > section.clientHeight,
    };
  }),
}))()`;

interface ViewReading {
  readonly label: string;
  readonly titleSize: number;
  readonly blurbSize: number;
  readonly width: number;
  readonly clipped: boolean;
}

interface Reading {
  readonly viewport: readonly [number, number];
  readonly overflow: boolean;
  readonly views: readonly ViewReading[];
}

describe('Play choice reading size', () => {
  browserIt(
    'keeps all four views readable and unconstrained at desktop and iPad portrait sizes',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-chooser-reading-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-chooser-reading-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'chooser.html');
      await writeFile(file, page(), 'utf8');
      const readings: Record<string, Reading> = {};
      let bodyError: unknown;
      try {
        for (const viewport of VIEWPORTS) {
          const measured = (await measurePage(
            chrome.client,
            file,
            viewport.width,
            viewport.height,
            MEASURE,
            viewport.name,
            '.mtg-playsection__blurb',
          )) as unknown as Reading;
          readings[viewport.name] = measured;
        }
        const evidenceDir = process.env['MTG_CHOOSER_EVIDENCE_DIR'];
        if (evidenceDir !== undefined) {
          await mkdir(evidenceDir, { recursive: true });
          await writeFile(join(evidenceDir, 'chooser.html'), page(), 'utf8');
          await writeFile(
            join(evidenceDir, 'measurements.json'),
            `${JSON.stringify(readings, null, 2)}\n`,
            'utf8',
          );
        }
        for (const viewport of VIEWPORTS) {
          const measured = readings[viewport.name];
          if (measured === undefined) throw new Error(`no measurements for ${viewport.name}`);
          expect(measured.viewport).toEqual([viewport.width, viewport.height]);
          expect(measured.overflow).toBe(false);
          expect(measured.views.map(({ label }) => label)).toEqual(VIEWS);
          measured.views.forEach((view) => {
            expect(view.titleSize, `${viewport.name} ${view.label} title`).toBe(15);
            expect(view.blurbSize, `${viewport.name} ${view.label} body`).toBe(15);
            expect(view.width, `${viewport.name} ${view.label} width`).toBeGreaterThanOrEqual(600);
            expect(view.clipped, `${viewport.name} ${view.label} clips`).toBe(false);
          });
        }
      } catch (error) {
        bodyError = error;
      }
      const cleanupErrors: Error[] = [];
      try {
        await shutdownChrome(chrome);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
      for (const path of [directory, userDataDir]) {
        try {
          await rm(path, { recursive: true, force: true });
        } catch (error) {
          cleanupErrors.push(new Error(`could not remove ${path}: ${reason(error)}`));
        }
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0)
        throw new AggregateError(cleanupErrors, 'Play choice browser check failed');
    },
    120_000,
  );
});
