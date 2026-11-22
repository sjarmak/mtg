// @vitest-environment node
/**
 * The deck and the pool sit side by side on a phone held sideways.
 *
 * `mtg-aqxi.4`. The two panes split at `min-width: 64rem`, which is a desk. A
 * landscape phone is 844x390: wide enough for two columns twice over, and the
 * shortest viewport this lab draws anything on. Under the width-only rule it got
 * the phone-portrait arrangement — the deck full width, the pool under it — so
 * the pool was a scroll away on the screen whose entire activity is moving cards
 * between the two, and 390px of height meant that scroll was most of a page.
 *
 * Measured rather than described, and the measurement is the relation rather
 * than a size: the two panes are on one row, neither is a sliver, and the page
 * does not scroll sideways. Which one is on the left is the screen's own
 * decision -- the Constructed builder puts the collection there (`mtg-x6xq`) and
 * the sealed one puts the deck there -- and each case reads its own order.
 *
 * The portrait phone does not split, which is the other half of the same claim
 * and is why the second case is here: 390px of width has room for one column of
 * cards, and `../../src/styles/deck-mobile.ts` is written for that arrangement.
 * It used to stack the two panes down the page; since `mtg-nqms` it draws one of
 * them and puts the other a press away, which is a change to what happens below
 * the query rather than to where the query sits.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { Shell } from '../../src/app/Shell';
import { ConstructedBuilder } from '../../src/routes/deck/ConstructedBuilder';
import { deckFor, emptyBuild } from '../../src/routes/deck/build';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor as sealedDeckFor, openSealed } from '../../src/routes/play/sealed';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

function page(): string {
  const build = emptyBuild(loadSet());
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'customize',
      sub: 'decks',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(ConstructedBuilder, {
        build,
        deck: deckFor(build),
        onAdd: () => undefined,
        onCut: () => undefined,
        onClear: () => undefined,
        onAdjustBasics: () => undefined,
        onSuggestBasics: () => undefined,
        onLoad: () => undefined,
        onPlay: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Builder</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The sealed screen, which is the same two piles under different names.
 *
 * It stacked a toolbar, a deck panel and a pool panel down the page at every
 * width, so it is the surface mtg-aqxi.4 was actually filed about. What it takes
 * here is the builder vocabulary the Constructed screen already draws, not a
 * second grid of its own.
 */
function sealedPage(): string {
  const build = openSealed(loadSet(), 'lab/test/sealed-landscape');
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(SealedBuilder, {
        build,
        deck: sealedDeckFor(build),
        onToggle: () => undefined,
        onSuggest: () => undefined,
        onClear: () => undefined,
        onAdjustBasics: () => undefined,
        onSuggestBasics: () => undefined,
        onPlay: () => undefined,
        contextNote: 'A sealed pool, mounted directly by a test.',
        seed: 'lab/test/sealed-landscape',
        source: 'sealed' as const,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sealed</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  // \`null\` for a pane with no box, which since \`mtg-nqms\` is what the pane a
  // narrow screen is not showing has. \`getBoundingClientRect\` answers zeros for
  // a \`display: none\` element and zeros for a missing one; \`getClientRects\` is
  // the question being asked -- is this laid out.
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (el === null || el.getClientRects().length === 0) return null;
    const rect = el.getBoundingClientRect();
    return { left: round(rect.left), right: round(rect.right), top: round(rect.top), width: round(rect.width) };
  };
  return {
    deck: box('.mtg-deck__pane[data-pane="deck"]'),
    pool: box('.mtg-deck__pane[data-pane="pool"]'),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
})()`;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
}

interface Reading {
  readonly deck: Box | null;
  readonly pool: Box | null;
  readonly pageOverflowX: number;
}

const SLACK_PX = 0.5;

async function read(width: number, height: number, html: string = page()): Promise<Reading> {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-landscape-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-landscape-chrome-'));
  const chrome = await launchChrome(userDataDir);
  const file = join(directory, 'builder.html');
  await writeFile(file, html, 'utf8');
  try {
    const seen = (await measurePage(
      chrome.client,
      file,
      width,
      height,
      MEASURE,
      `${String(width)}x${String(height)}`,
      '.mtg-builder__panes',
      true,
      { mobile: true, pointer: 'coarse' },
    )) as unknown as Reading | null;
    if (seen === null) throw new Error('the page drew no builder');
    return seen;
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function panes(seen: Reading): { readonly deck: Box; readonly pool: Box } {
  const { deck, pool } = seen;
  if (deck === null || pool === null) throw new Error('a builder pane is missing');
  return { deck, pool };
}

describe('the deck editor on a phone held sideways', () => {
  browserIt(
    'puts the deck and the pool side by side at 844x390',
    async () => {
      const seen = await read(844, 390);
      const { deck, pool } = panes(seen);
      expect(seen.pageOverflowX, 'the page scrolls sideways').toBeLessThanOrEqual(SLACK_PX);
      // The collection on the left since `mtg-x6xq`, which reverses the order
      // this file measured and not the claim: two columns on one row, neither a
      // sliver. The sealed case below still reads deck-then-pool, because that
      // screen keeps the arrangement `mtg-8osf` argued for.
      expect(pool.right, 'the pool pane runs into the deck pane').toBeLessThanOrEqual(deck.left + SLACK_PX);
      expect(deck.top, 'the two panes are on different rows').toBeCloseTo(pool.top, 0);
      // Neither column is a sliver: the narrower of the two is at least a third
      // of the page, which is the shape the desk grid already commits to.
      expect(Math.min(deck.width, pool.width), 'one pane is a sliver').toBeGreaterThanOrEqual(844 / 4);
    },
    120_000,
  );

  browserIt(
    'draws one of them at 390x844, where there is room for one column of cards',
    async () => {
      const seen = await read(390, 844);
      expect(seen.pageOverflowX, 'the page scrolls sideways').toBeLessThanOrEqual(SLACK_PX);
      // The split query still says no here, which is this file's claim. What
      // the screen does instead of stacking them changed in `mtg-nqms`: the
      // deck is drawn and the pool is a press away, and `./builder-drawer.browser.test.ts`
      // is where that arrangement is measured. Both halves are read, because
      // "the pool is not beside the deck" is also true of a pool that failed to
      // render at all.
      expect(seen.deck, 'the deck pane is not on a portrait phone at all').not.toBeNull();
      expect(seen.pool, 'the pool is laid out beside or under the deck on a narrow screen').toBeNull();
    },
    120_000,
  );

  browserIt(
    'gives the sealed screen the same two panes',
    async () => {
      const seen = await read(844, 390, sealedPage());
      const { deck, pool } = panes(seen);
      expect(seen.pageOverflowX, 'the page scrolls sideways').toBeLessThanOrEqual(SLACK_PX);
      expect(deck.right, 'the deck pane runs into the pool pane').toBeLessThanOrEqual(pool.left + SLACK_PX);
      expect(deck.top, 'the two panes are on different rows').toBeCloseTo(pool.top, 0);
    },
    120_000,
  );
});
