// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect } from 'vitest';
import { CubeCardsRoute } from '../../src/routes/legacy-cube/CubeCardsRoute';
import { readLegacyCubeCatalog } from '../../src/routes/legacy-cube/model';
import { Shell } from '../../src/app/Shell';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

browserIt(
  'fits printed gallery cards and controls at phone, tablet and desktop widths',
  async () => {
    const catalog = await readLegacyCubeCatalog(
      JSON.parse(
        await readFile('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8'),
      ) as unknown,
    );
    const directory = await mkdtemp(join(tmpdir(), 'mtg-cube-cards-'));
    const chrome = await launchChrome(directory);
    try {
      const markup = renderToStaticMarkup(
        h(Shell, {
          mode: 'cards',
          onSelectMode: () => undefined,
          children: h(CubeCardsRoute, {
            catalog: { status: 'ready', catalog: { ...catalog, cards: catalog.cards.slice(0, 3) } },
            route: { mode: 'cards', sub: 'gallery', params: {} },
            onSetParams: () => undefined,
          }),
        }),
      );
      const file = join(directory, 'cards.html');
      await writeFile(
        file,
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${uiStyleSheet()}</style></head><body>${markup}</body></html>`,
      );
      for (const width of [375, 768, 1440]) {
        const reading = await measurePage(
          chrome.client,
          file,
          width,
          900,
          `(() => {
        const gallery = document.querySelector('.mtg-gallery');
        const card = gallery.querySelector('.mtg-card');
        return { overflow: document.documentElement.scrollWidth - innerWidth,
          cardWidth: card.getBoundingClientRect().width, galleryWidth: gallery.getBoundingClientRect().width,
          search: !!document.querySelector('input[aria-label="Search cards"]') };
      })()`,
          'cube cards',
          '.mtg-gallery .mtg-card',
        );
        expect(reading['overflow']).toBeLessThanOrEqual(1);
        expect(reading['search']).toBe(true);
        if (width === 375)
          expect(
            Math.abs(Number(reading['cardWidth']) - Number(reading['galleryWidth'])),
          ).toBeLessThanOrEqual(1);
      }
    } finally {
      await shutdownChrome(chrome);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
