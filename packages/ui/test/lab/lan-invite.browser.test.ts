// @vitest-environment node
/**
 * The invite panel on a phone, measured rather than assumed.
 *
 * Everything in this panel is a length a stylesheet cannot shorten: a join link
 * is `http://192.168.1.42:5273/#/play/constructed?table=` and a 36-digit
 * UUID, and the code beside it is square and has to stay big enough to scan.
 * On a 390px screen
 * that is the exact shape of a page that scrolls sideways, and a sideways scroll
 * on a phone is not a cosmetic fault — it moves the board out from under a
 * finger for the rest of the game.
 *
 * So: the panel is drawn, the link is inside it rather than through the edge of
 * the screen, the code has real area, and the document does not overflow its own
 * viewport. jsdom performs no layout, so none of that is measurable there; the
 * harness is `../support/chrome.ts`.
 *
 * `LanPanel` rather than `LanInvite`, because a hook's effect does not run under
 * `renderToStaticMarkup`: the component that fetches would measure as an empty
 * page. What is under test is the layout, and the layout is this element.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import type { InviteSeat } from '@mtg/netplay';
import { Shell } from '../../src/app/Shell';
import { LanPanel } from '../../src/routes/play/LanInvite';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';

/** A real link: the longest thing this panel ever has to hold. */
const GUEST: InviteSeat = {
  name: 'Seat two',
  links: [
    {
      label: 'Tailscale (100.101.102.103)',
      url: 'http://100.101.102.103:5273/#/play/constructed?table=9c1b7d55-2e60-4a83-8f47-11de3a904bb2',
    },
    {
      label: 'LAN (192.168.1.42)',
      url: 'http://192.168.1.42:5273/#/play/constructed?table=9c1b7d55-2e60-4a83-8f47-11de3a904bb2',
    },
  ],
  joined: false,
};

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(LanPanel, { guests: [GUEST] }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LAN invite</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const box = (node) => {
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    return { left: round(rect.left), right: round(rect.right), width: round(rect.width), height: round(rect.height) };
  };
  const panel = document.querySelector('.mtg-lan');
  const url = document.querySelector('.mtg-lan__url');
  const qr = document.querySelector('.mtg-lan__qr');
  return {
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panel: box(panel),
    url: box(url),
    qr: box(qr),
    urlText: (url?.textContent ?? '').trim(),
  };
})()`);

interface Box {
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

interface Reading {
  readonly viewport: number;
  readonly scrollWidth: number;
  readonly panel: Box | null;
  readonly url: Box | null;
  readonly qr: Box | null;
  readonly urlText: string;
}

/** A phone held upright, a phone on its side, and a laptop window. */
const SIZES = [
  { width: 390, height: 844, coarse: true },
  { width: 844, height: 390, coarse: true },
  { width: 1440, height: 900, coarse: false },
] as const;

/** Small enough to be a rendering accident, large enough to still be scanned. */
const MIN_QR_PX = 96;

describe('the invite panel', () => {
  browserIt(
    'holds a full join link and a scannable code without pushing the page sideways',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-lan-invite-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-lan-invite-chrome-'));
      const file = join(directory, 'invite.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-lan',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no invite panel`);
          const panel = seen.panel;
          const url = seen.url;
          const qr = seen.qr;
          if (panel === null || url === null || qr === null) {
            throw new Error(`${at}: the panel is missing its link or its code`);
          }

          // The link is the content, so it is the whole link.
          expect(seen.urlText, `${at}: the link is not drawn in full`).toBe(GUEST.links[0]?.url);

          // Nothing reaches past the right edge of the screen, and the document
          // does not scroll sideways to hold it.
          expect(seen.scrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(seen.viewport + 1);
          expect(url.right, `${at}: the link runs off the screen`).toBeLessThanOrEqual(seen.viewport + 1);
          expect(url.left, `${at}: the link starts off the screen`).toBeGreaterThanOrEqual(-1);
          expect(url.right, `${at}: the link runs out of its own panel`).toBeLessThanOrEqual(panel.right + 1);

          // And the code is a square with area, not a collapsed flex item.
          expect(qr.width, `${at}: the code is too small to scan`).toBeGreaterThanOrEqual(MIN_QR_PX);
          expect(qr.height - qr.width, `${at}: the code is not square`).toBeLessThanOrEqual(1);
          expect(qr.right, `${at}: the code runs off the screen`).toBeLessThanOrEqual(seen.viewport + 1);
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
