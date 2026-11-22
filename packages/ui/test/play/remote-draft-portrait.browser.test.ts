// @vitest-environment node
/**
 * The LAN draft on a phone held upright, which is the draft two people do.
 *
 * `mtg-dcxg.12`, 2026-08-23. `../draft/pack-portrait.browser.test.ts` measures
 * the same screen on the draft route and holds the same sentences; this rig
 * exists because the sheet that makes them true was scoped to that route and
 * this screen is not on it. `../../src/routes/play/RemoteDraft.ts` builds the
 * same `.mtg-draft.mtg-screen` inside the play route, so before the fix a
 * remote draft at 390x844 drew the desktop screen: one card per row, the pack
 * scrolling inside its own pane inside a main region that scrolls too, and the
 * commit — the one control on the route that cannot be taken back — under the
 * bottom navigation.
 *
 * Three sentences, at 390x844 and no others: the desktop reading is
 * `../draft/pack-portrait.browser.test.ts`'s, over the same rules, and a second
 * copy of it would fail in the same place for the same reason.
 *
 * 1. **The pack is a grid**, and the whole pack is a couple of screens.
 * 2. **One scroller**, and it is the shell's main region rather than the pack's
 *    own pane.
 * 3. **The commit is clear of the tab row**, whole, and finger-sized.
 *
 * The browser is told it is a phone: `../../src/styles/touch.ts`'s 44px floor
 * is a pointer query, and it is what sizes the control measured against the bar.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { RoomView } from '@mtg/netplay';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { RemoteDraft } from '../../src/routes/play/RemoteDraft';
import { uiStyleSheet } from '../../src/styles/index';
import { WCAG_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/**
 * A pack of thirteen and a pool of three, which is the shape the draft-route rig
 * measures. The count is the subject — thirteen faces is what will not fit in
 * one column — so the two rigs deal the same number out of the same examples.
 */
const SPELLS: readonly Card[] = EXAMPLE_CARDS.filter((card) => card.kind !== 'land');
const PACK: readonly Card[] = SPELLS.slice(0, 13);
const POOL: readonly Card[] = SPELLS.slice(13, 16);

const VIEW: RoomView = {
  protocol: 3,
  room: 'room-1',
  phase: 'draft',
  seat: 0,
  seats: [
    { name: 'You', ready: false },
    { name: 'Sam', ready: false },
  ],
  revision: 0,
  pool: POOL.map((card) => card.id),
  deckSize: 40,
  rounds: 3,
  draftBotPolicy: 'native-deck-conditioned/v1',
  pack: { cards: PACK.map((card) => card.id), round: 1, pickNumber: 4 },
};

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(RemoteDraft, {
        base: '/api',
        token: 'token-one',
        view: VIEW,
        pool: POOL,
        pack: PACK,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Remote draft</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/** The same reading `../draft/pack-portrait.browser.test.ts` takes, on this screen. */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const scroll = document.querySelector('.mtg-draft .mtg-work__scroll');
  const grid = document.querySelector('.mtg-draft .mtg-work__scroll .mtg-thumbs');
  const main = document.querySelector('.mtg-shell__main');
  const commit = document.querySelector('.mtg-rail__foot button');
  const nav = document.querySelector('.mtg-modes');
  if (scroll === null || grid === null || main === null || commit === null) return null;
  const scrolls = (element) => element.scrollHeight - element.clientHeight > 0.5;
  const rects = [...grid.querySelectorAll('.mtg-card')].map((face) => face.getBoundingClientRect());
  const first = rects[0];
  const commitBox = commit.getBoundingClientRect();
  const navBox = nav === null ? null : nav.getBoundingClientRect();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    packCount: rects.length,
    columns: first === undefined ? 0 : rects.filter((rect) => Math.abs(rect.top - first.top) < 1).length,
    packRun: round(grid.getBoundingClientRect().height / window.innerHeight),
    packScrolls: scrolls(scroll),
    mainScrolls: scrolls(main),
    commitHeight: round(commitBox.height),
    commitLabel: commit.textContent,
    commitPastNav: navBox === null ? null : round(commitBox.bottom - navBox.top),
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly packCount: number;
  readonly columns: number;
  readonly packRun: number;
  readonly packScrolls: boolean;
  readonly mainScrolls: boolean;
  readonly commitHeight: number;
  readonly commitLabel: string;
  readonly commitPastNav: number | null;
}

/**
 * The most of the pack a thumb may be asked to travel, in screens. The
 * draft-route rig measured 0.78 after its fix over the same thirteen faces and
 * states the same ceiling; this one holds the number rather than re-deriving it.
 */
const PACK_RUN_MAX = 1.5;

const SLACK_PX = 0.5;

const PHONE = { width: 390, height: 844 } as const;

describe('the LAN draft on a phone held upright', () => {
  browserIt(
    'draws the pack as a grid, scrolls once, and keeps the pick clear of the tab row',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-remote-draft-portrait-'));
      const chrome = await launchChrome(join(directory, 'chrome'));
      const file = join(directory, 'remote-draft.html');
      await writeFile(file, page(), 'utf8');
      try {
        const at = `${String(PHONE.width)}x${String(PHONE.height)}`;
        const seen = (await measurePage(
          chrome.client,
          file,
          PHONE.width,
          PHONE.height,
          MEASURE,
          at,
          '.mtg-draft .mtg-work__scroll',
          true,
          { mobile: true, pointer: 'coarse' },
        )) as unknown as Reading | null;
        if (seen === null) throw new Error(`${at}: the page drew no remote draft`);
        expect(seen.coarse, `${at}: the rig emulates the right pointer`).toBe(true);
        expect(seen.packCount, `${at}: the pack is not whole`).toBe(PACK.length);

        // 1. A grid, and a pack a thumb can cross.
        expect(seen.columns, `${at}: the pack draws ${String(seen.columns)} card per row`).toBeGreaterThan(1);
        expect(
          seen.packRun,
          `${at}: the pack is ${String(seen.packRun)} screens of scrolling`,
        ).toBeLessThanOrEqual(PACK_RUN_MAX);

        // 2. One scroller, and it is the one the rest of this phone scrolls.
        expect(seen.packScrolls, `${at}: the pack scrolls inside its own pane`).toBe(false);
        expect(seen.mainScrolls, `${at}: nothing scrolls, so the pack is cut off`).toBe(true);

        // 3. The commit is above the tab row and finger-sized.
        expect(seen.commitLabel, `${at}: the commit says what it will do`).toBe('Pick a card');
        expect(seen.commitPastNav, `${at}: the page draws no bottom navigation`).not.toBeNull();
        expect(
          seen.commitPastNav ?? 0,
          `${at}: the commit button is under the bottom navigation`,
        ).toBeLessThanOrEqual(SLACK_PX);
        expect(seen.commitHeight, `${at}: the commit button is too small to hit`).toBeGreaterThanOrEqual(
          WCAG_TARGET_PX,
        );
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
