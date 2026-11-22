// @vitest-environment node
/**
 * On a phone the builder shows one pane at a time, and the other is a tap away.
 *
 * `mtg-nqms`, and the half of `mtg-3ggp` that did not ship: "for narrower
 * screens, allow the right deck pane to become a drawer or switchable tab
 * rather than shrinking both panes until they are unusable". What shipped was
 * the second clause -- below `BUILDER_SPLIT_QUERY` the two panes stack full
 * width, so neither is a sliver -- and that turns the screen back into a
 * document. Measured at 390x844 on the Constructed builder with sixty cards in
 * the deck: the deck pane started 447px down and ran 1,057px, the collection
 * started at 1,528px and ran 6,562px, and the document was 8,138px, nine and a
 * half screens. Reaching the collection meant scrolling past the whole deck, and
 * getting back to the deck from inside the collection meant scrolling back up
 * through all of it.
 *
 * So below the split query exactly one pane is laid out, and the switch that
 * chooses which one rides the builder's own sticky bar -- the one already
 * pinned to the top of the page -- so it is on screen from anywhere in either
 * pane. That is the assertion that carries the bead: not that a control exists,
 * but that it is still on the screen after the collection has been scrolled to
 * its end.
 *
 * The markup is static, so what is measured here is the *arrangement* the
 * attribute produces, with `data-showing` set on the panes the way the switch
 * sets it. Which button writes which value is `./builder-panes.test.ts`, where
 * it can be read without a browser.
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
import { addCopy, deckFor, emptyBuild, selectable } from '../../src/routes/deck/build';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor as sealedDeckFor, openSealed } from '../../src/routes/play/sealed';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';

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

/**
 * A deck with sixty cards in it, because an empty deck pane is the one state
 * where the old arrangement was tolerable: it drew 413px and the collection
 * began half a screen down. The complaint is about a deck being built.
 */
function page(): string {
  const pool = loadSet();
  let build = emptyBuild(pool);
  for (const card of selectable(pool).slice(0, 15)) {
    for (let copy = 0; copy < 4; copy += 1) build = addCopy(build, card.id);
  }
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
  return html('Builder', markup);
}

/** The sealed screen, which draws the same workbench under different names. */
function sealedPage(): string {
  const build = openSealed(loadSet(), 'lab/test/sealed-drawer');
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
        seed: 'lab/test/sealed-drawer',
        source: 'sealed' as const,
      }),
    }),
  );
  return html('Sealed', markup);
}

function html(title: string, markup: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * `null` for an element with no box at all, which is what a pane the switch is
 * not showing has: `getBoundingClientRect` answers zeros for a `display: none`
 * element and zeros for a genuinely empty one, and `getClientRects` is the
 * question actually being asked -- is this laid out.
 */
const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const box = (el) => {
    if (el === null || el.getClientRects().length === 0) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: round(rect.left), right: round(rect.right), top: round(rect.top),
      bottom: round(rect.bottom), width: round(rect.width), height: round(rect.height),
    };
  };
  const panes = document.querySelector('.mtg-builder__panes');
  if (panes === null) return null;
  const read = () => ({
    deck: box(panes.querySelector(':scope > [data-pane="deck"]')),
    pool: box(panes.querySelector(':scope > [data-pane="pool"]')),
  });
  const divider = () => box(panes.querySelector(':scope > .mtg-split'));
  const showing = panes.getAttribute('data-showing');
  const opened = read();
  const control = () => box(document.querySelector('.mtg-builder__switch'));
  const switchAtTop = control();
  window.scrollTo(0, document.documentElement.scrollHeight);
  void document.documentElement.offsetHeight;
  const switchAtEnd = control();
  window.scrollTo(0, 0);
  panes.setAttribute('data-showing', showing === 'pool' ? 'deck' : 'pool');
  void document.documentElement.offsetHeight;
  const flipped = read();
  panes.setAttribute('data-showing', showing ?? '');
  panes.setAttribute('data-expanded', 'deck');
  panes.setAttribute('data-showing', 'deck');
  void document.documentElement.offsetHeight;
  const expandedDeck = read();
  const deckDivider = divider();
  panes.setAttribute('data-expanded', 'pool');
  panes.setAttribute('data-showing', 'pool');
  void document.documentElement.offsetHeight;
  const expandedPool = read();
  const poolDivider = divider();
  panes.setAttribute('data-expanded', 'split');
  panes.setAttribute('data-showing', showing ?? '');
  return {
    showing, opened, flipped, expandedDeck, expandedPool, deckDivider, poolDivider,
    workbench: box(panes), switchAtTop, switchAtEnd,
    docHeight: round(document.documentElement.scrollHeight),
    viewport: round(document.documentElement.clientHeight),
    overflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
})()`);

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface Panes {
  readonly deck: Box | null;
  readonly pool: Box | null;
}

interface Reading {
  readonly showing: string | null;
  readonly opened: Panes;
  readonly flipped: Panes;
  readonly expandedDeck: Panes;
  readonly expandedPool: Panes;
  readonly deckDivider: Box | null;
  readonly poolDivider: Box | null;
  readonly workbench: Box | null;
  readonly switchAtTop: Box | null;
  readonly switchAtEnd: Box | null;
  readonly docHeight: number;
  readonly viewport: number;
  readonly overflowX: number;
}

const SLACK_PX = 0.5;

async function read(width: number, height: number, markup: string = page()): Promise<Reading> {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-drawer-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-drawer-chrome-'));
  const chrome = await launchChrome(userDataDir);
  const file = join(directory, 'builder.html');
  await writeFile(file, markup, 'utf8');
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
      { mobile: width < 500, pointer: width < 500 ? 'coarse' : 'fine' },
    )) as unknown as Reading | null;
    if (seen === null) throw new Error('the page drew no builder');
    return seen;
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function shown(box: Box | null, what: string): Box {
  if (box === null) throw new Error(`${what} is not on the screen`);
  return box;
}

describe('the deck editor on a phone shows one pane at a time', () => {
  browserIt(
    'draws the deck alone at 390x844 and keeps the collection a tap away',
    async () => {
      const seen = await read(390, 844);
      expect(seen.overflowX, 'the page scrolls sideways').toBeLessThanOrEqual(SLACK_PX);
      expect(seen.showing, 'the panes do not say which one they are showing').toBe('deck');

      const deck = shown(seen.opened.deck, 'the deck pane');
      expect(
        seen.opened.pool,
        'the collection is laid out under the deck, so this is still a document',
      ).toBeNull();

      // The other pane, without a page load: the switch writes this attribute
      // and `./builder-panes.test.ts` is where that is read.
      const pool = shown(seen.flipped.pool, 'the collection');
      expect(seen.flipped.deck, 'the deck stays laid out beside the collection').toBeNull();
      expect(pool.width, 'the collection is not the full width of the column').toBeCloseTo(deck.width, 0);
      expect(
        pool.width,
        'the collection is narrower than the screen it is browsed on',
      ).toBeGreaterThanOrEqual(390 * 0.9);

      // The bead's own sentence, measured: the deck is reachable from the end of
      // the collection. The switch rides the sticky bar, so scrolling to the
      // bottom of the document leaves it on the screen.
      const control = shown(seen.switchAtEnd, 'the pane switch, at the end of the page');
      expect(control.top, 'the pane switch scrolls off the bottom of the screen').toBeLessThan(seen.viewport);
      expect(control.bottom, 'the pane switch scrolls off the top of the screen').toBeGreaterThan(0);

      // A document holding one pane rather than both. The collection is 6,562px
      // of cards on this set; the page that is not showing it must be shorter
      // than that on its own.
      expect(seen.docHeight, 'the page is as long as both panes stacked').toBeLessThan(pool.height);
    },
    120_000,
  );

  browserIt(
    'lets either pane take the whole workbench and restores cleanly at phone and desk sizes',
    async () => {
      for (const [width, height] of [
        [390, 844],
        [1440, 900],
      ] as const) {
        const at = `${String(width)}x${String(height)}`;
        const seen = await read(width, height, sealedPage());
        const workbench = shown(seen.workbench, `${at}: the workbench`);
        const deck = shown(seen.expandedDeck.deck, `${at}: the expanded deck`);
        const pool = shown(seen.expandedPool.pool, `${at}: the expanded pool`);

        expect(seen.expandedDeck.pool, `${at}: the pool remains beside the expanded deck`).toBeNull();
        expect(seen.expandedPool.deck, `${at}: the deck remains beside the expanded pool`).toBeNull();
        expect(seen.deckDivider, `${at}: the divider remains beside the expanded deck`).toBeNull();
        expect(seen.poolDivider, `${at}: the divider remains beside the expanded pool`).toBeNull();
        expect(deck.width, `${at}: the deck does not fill the workbench width`).toBeCloseTo(
          workbench.width,
          0,
        );
        expect(pool.width, `${at}: the pool does not fill the workbench width`).toBeCloseTo(
          workbench.width,
          0,
        );
        if (width >= 1024) {
          expect(deck.height, `${at}: the deck does not fill the framed workbench`).toBeCloseTo(
            workbench.height,
            0,
          );
          expect(pool.height, `${at}: the pool does not fill the framed workbench`).toBeCloseTo(
            workbench.height,
            0,
          );
        }
      }
    },
    120_000,
  );

  browserIt(
    'gives the sealed screen the same switch',
    async () => {
      const seen = await read(390, 844, sealedPage());
      expect(seen.showing, 'the sealed panes do not say which one they are showing').toBe('deck');
      shown(seen.opened.deck, 'the sealed deck pane');
      expect(seen.opened.pool, 'the sealed pool is laid out under the deck').toBeNull();
      shown(seen.flipped.pool, 'the sealed pool');
      shown(seen.switchAtEnd, 'the pane switch, at the end of the sealed page');
    },
    120_000,
  );

  browserIt(
    'leaves the desk arrangement alone at 1440x900',
    async () => {
      const seen = await read(1440, 900);
      const deck = shown(seen.opened.deck, 'the deck pane');
      const pool = shown(seen.opened.pool, 'the collection');
      expect(pool.right, 'the collection runs into the deck').toBeLessThanOrEqual(deck.left + SLACK_PX);
      expect(deck.top, 'the two panes are on different rows').toBeCloseTo(pool.top, 0);
      // Both panes stay laid out whatever the attribute says, which is what
      // makes the switch below the split query rather than a mode of the screen.
      shown(seen.flipped.deck, 'the deck pane, after the switch was written');
      shown(seen.flipped.pool, 'the collection, after the switch was written');
      expect(seen.switchAtTop, 'the pane switch is drawn on a desk, where both panes are').toBeNull();
    },
    120_000,
  );
});
