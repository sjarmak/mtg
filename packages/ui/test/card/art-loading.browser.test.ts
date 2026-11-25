// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { encodePng } from '@mtg/raster';
import { describe, expect } from 'vitest';
import { ArtSlot } from '../../src/card/ArtSlot';
import { Card } from '../../src/card/Card';
import type { CardSize } from '../../src/card/Card';
import { ART_LOADING_LABEL } from '../../src/styles/card';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const CARD = exampleCard('slc-skywatch-sentinel');

const LOADED_SRC = `data:image/png;base64,${Buffer.from(
  encodePng({ width: 1, height: 1, data: new Uint8Array([40, 90, 160, 255]) }),
).toString('base64')}`;

const SIZES = ['full', 'board', 'art'] as const satisfies readonly CardSize[];

const WIDTH_BY_SIZE: Readonly<Record<(typeof SIZES)[number], number>> = {
  full: 280,
  board: 120,
  art: 80,
};

const LABELED_SIZES: ReadonlySet<string> = new Set(['full', 'bare']);

const BORDER_PX = 1.01;

function probe(name: string, width: number, child: ReturnType<typeof h>): ReturnType<typeof h> {
  return h('div', { 'data-probe': name, style: { width: `${String(width)}px` } }, child);
}

function page(heldSrc: string): string {
  const waiting = { src: heldSrc, alt: 'an illustration that has not arrived' };
  const arrived = { src: LOADED_SRC, alt: 'an illustration that has arrived' };
  const markup = renderToStaticMarkup(
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' } },
      ...SIZES.map((size) =>
        probe(
          `loading-${size}`,
          WIDTH_BY_SIZE[size],
          h(Card, { card: CARD, size, art: waiting, deferArt: true }),
        ),
      ),
      probe('loading-bare', 200, h(ArtSlot, { art: waiting, subject: CARD.id, defer: true })),
      ...SIZES.map((size) =>
        probe(`loaded-${size}`, WIDTH_BY_SIZE[size], h(Card, { card: CARD, size, art: arrived })),
      ),
      probe('loaded-bare', 200, h(ArtSlot, { art: arrived, subject: CARD.id })),
    ),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Art loading</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  return Array.from(document.querySelectorAll('[data-probe]')).map((wrapper) => {
    const slot = wrapper.querySelector('.mtg-art');
    const image = slot === null ? null : slot.querySelector('img.mtg-art__image');
    if (slot === null || image === null) return { probe: wrapper.dataset.probe, drawn: false };
    const label = getComputedStyle(slot, '::before');
    const box = slot.getBoundingClientRect();
    const picture = image.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      probe: wrapper.dataset.probe,
      drawn: true,
      state: slot.getAttribute('data-art-state'),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      labelContent: label.content,
      labelWidth: round(parseFloat(label.width)),
      labelHeight: round(parseFloat(label.height)),
      slot: [round(box.left), round(box.top), round(box.width), round(box.height)],
      picture: [round(picture.left), round(picture.top), round(picture.width), round(picture.height)],
      inView: box.top >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth,
      hatched: getComputedStyle(slot).backgroundImage.includes('repeating-linear-gradient'),
      hit: hit === image ? 'picture' : hit === slot ? 'window' : hit === null ? 'nothing' : String(hit.className),
    };
  });
})()`;

interface Reading {
  readonly probe: string;
  readonly drawn: boolean;
  readonly state: string | null;
  readonly complete: boolean;
  readonly naturalWidth: number;
  readonly labelContent: string;
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly slot: readonly [number, number, number, number];
  readonly picture: readonly [number, number, number, number];
  readonly inView: boolean;
  readonly hatched: boolean;
  readonly hit: string;
}

function holdEveryRequest(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(() => undefined);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function sizeOf(name: string): string {
  return name.slice(name.indexOf('-') + 1);
}

describe('an art window whose picture has not arrived', () => {
  browserIt(
    'says it is loading at the reading sizes and is covered once the picture arrives',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-art-loading-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-art-loading-chrome-'));
      const server = await holdEveryRequest();
      const { port } = server.address() as AddressInfo;
      const file = join(directory, 'loading.html');
      await writeFile(file, page(`http://127.0.0.1:${String(port)}/held.png`), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const readings = (await measurePage(
          chrome.client,
          file,
          1440,
          1100,
          MEASURE,
          'art loading',
          '.mtg-art',
        )) as unknown as readonly Reading[];
        expect(readings.map((reading) => reading.probe)).toEqual([
          ...SIZES.map((size) => `loading-${size}`),
          'loading-bare',
          ...SIZES.map((size) => `loaded-${size}`),
          'loaded-bare',
        ]);
        for (const seen of readings) {
          const at = seen.probe;
          expect(seen.drawn, `${at}: the art window was drawn with an image`).toBe(true);
          console.log(
            `${at}: state ${String(seen.state)}, complete ${String(seen.complete)}, natural ${String(seen.naturalWidth)}, label ${seen.labelContent} ${String(seen.labelWidth)}x${String(seen.labelHeight)}, window ${seen.slot.join(',')}, hit ${seen.hit}`,
          );
          expect(seen.state, `${at}: the server-rendered state is unchanged`).toBe('ready');
          expect(seen.hatched, `${at}: the window carries the hatch behind the picture`).toBe(true);

          const loading = at.startsWith('loading-');
          expect(seen.complete, `${at}: the picture has ${loading ? 'not ' : ''}arrived`).toBe(!loading);
          expect(seen.naturalWidth > 0, `${at}: the picture has pixels`).toBe(!loading);

          if (LABELED_SIZES.has(sizeOf(at))) {
            expect(seen.inView, `${at}: the window is on screen`).toBe(true);
            const [left, top, width, height] = seen.slot;
            const [pictureLeft, pictureTop, pictureWidth, pictureHeight] = seen.picture;
            expect(pictureLeft - left, `${at}: the picture reaches the left edge`).toBeLessThanOrEqual(
              BORDER_PX,
            );
            expect(pictureTop - top, `${at}: the picture reaches the top edge`).toBeLessThanOrEqual(
              BORDER_PX,
            );
            expect(
              left + width - (pictureLeft + pictureWidth),
              `${at}: the picture reaches the right edge`,
            ).toBeLessThanOrEqual(BORDER_PX);
            expect(
              top + height - (pictureTop + pictureHeight),
              `${at}: the picture reaches the bottom edge`,
            ).toBeLessThanOrEqual(BORDER_PX);
            expect(seen.labelContent, `${at}: the label reads "${ART_LOADING_LABEL}"`).toContain(
              `"${ART_LOADING_LABEL}"`,
            );
            expect(seen.labelWidth, `${at}: the label has width`).toBeGreaterThan(0);
            expect(seen.labelWidth, `${at}: the label fits the window`).toBeLessThan(seen.slot[2] - 2);
            expect(seen.labelHeight, `${at}: the label fits the window`).toBeLessThan(seen.slot[3] - 2);
            expect(seen.hit, `${at}: the picture is the top layer over the label`).toBe('picture');
          } else {
            expect(seen.labelContent, `${at}: no label at a size too small to read one`).toBe('none');
          }
        }
      } catch (error) {
        throw new Error(reason(error));
      } finally {
        await shutdownChrome(chrome);
        server.closeAllConnections();
        server.close();
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
