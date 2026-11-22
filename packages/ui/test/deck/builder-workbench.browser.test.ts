// @vitest-environment node
/**
 * A framed deckbuilder is a workbench, and the two builders share out different
 * axes of it.
 *
 * The sealed screen stacks: the pool across the top, the deck full width under
 * it. `mtg-8osf` measured why -- side by side the deck pane had two fifths of
 * the window, 560px at 1440x900, which is three of seven mana-value columns with
 * the rest behind a horizontal scrollbar, on the screen whose one question is
 * what the curve looks like.
 *
 * The Constructed screen divides the width instead (`mtg-x6xq`): the collection
 * down the left at about five eighths, the deck down the right, both the full
 * height of the frame. What lets it is `mtg-umro` -- that deck pane opens on a
 * decklist rather than on columns, and a decklist is what a narrow column is
 * for. The columns are still one press away and still get the whole width when
 * the pool pane is dragged out of the way.
 *
 * Every claim here is a relation rather than a size, the way
 * `./builder-landscape.browser.test.ts` states its own, except the collection's
 * share of the width, which is a band because the playtester asked for one.
 *
 * The unframed row is the other half and is asserted rather than skipped. The
 * split query and the frame query are two constants on purpose -- a screen can
 * be wide enough for two columns and too short to divide -- so a workbench that
 * leaked below the frame gate would put one pane a scroll away from the other on
 * a page that scrolls, which is the arrangement `mtg-aqxi.4` removed.
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
import { DeckRoute } from '../../src/routes/DeckRoute';
import { deckOpenParam } from '../../src/routes/deck/open';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { deckFor as sealedDeckFor, openSealed } from '../../src/routes/play/sealed';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
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

/**
 * Compact by default, which is the density the arrangement is about: both panes
 * draw mana-value columns at it and a deck's columns are what the stacking buys.
 *
 * `mtg-x3yb` reads the other density too. Since `mtg-rgc.21` full draws the same
 * columns at face size, so it is the density where a pool too short for a whole
 * card is visible as a band of title bars, and that is the case the last test
 * here measures.
 */
function stubStorage(density: 'compact' | 'full' = 'compact'): void {
  const prefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(prefix) ? density : null),
    setItem: (): void => undefined,
  };
}

function document(markup: string, title: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`
  );
}

/**
 * The route rather than `ConstructedBuilder` on its own, for the reason
 * `./builder-frame.browser.test.ts` gives: `DeckRoute` is what puts the builder
 * inside `.mtg-builder-screen`, and every rule this file is about is keyed to
 * that class. A test that mounted the builder alone would be green on a sheet
 * with the frame deleted.
 */
function constructedPage(density: 'compact' | 'full' = 'compact'): string {
  stubStorage(density);
  return document(
    renderToStaticMarkup(
      h(Shell, {
        mode: 'customize',
        sub: 'decks',
        onSelectMode: (): void => undefined,
        title: 'MTG Lab',
        children: h(DeckRoute, {
          state: { status: 'absent' },
          cards: loadSet(),
          open: deckOpenParam({ kind: 'build' }),
        }),
      }),
    ),
    'Builder',
  );
}

/**
 * The three states the deck row is sized against, all on the shipped fixture.
 *
 * `suggested` is what the screen opens on -- `openSealed`'s own suggestion, 23
 * cards -- and the other two are its ends: nothing chosen, and the whole pool
 * chosen, which is the state where the deck wants more than its share.
 */
type Chosen = 'empty' | 'suggested' | 'whole pool';

function sealedPage(chosen: Chosen = 'suggested'): string {
  stubStorage();
  const opened = openSealed(loadSet(), 'lab/test/sealed-workbench');
  const build =
    chosen === 'suggested'
      ? opened
      : { ...opened, chosen: chosen === 'empty' ? [] : opened.pool.map((_card, at) => at) };
  return document(
    renderToStaticMarkup(
      h(Shell, {
        mode: 'play',
        onSelectMode: (): void => undefined,
        title: 'MTG Lab',
        children: h(SealedBuilder, {
          build,
          deck: sealedDeckFor(build),
          onToggle: (): void => undefined,
          onSuggest: (): void => undefined,
          onClear: (): void => undefined,
          onAdjustBasics: (): void => undefined,
          onSuggestBasics: (): void => undefined,
          onPlay: (): void => undefined,
          contextNote: 'A sealed pool, mounted directly by a test.',
          seed: 'lab/test/sealed-workbench',
          source: 'sealed' as const,
        }),
      }),
    ),
    'Sealed',
  );
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: round(rect.left), right: round(rect.right),
      top: round(rect.top), bottom: round(rect.bottom),
      width: round(rect.width), height: round(rect.height),
    };
  };
  const content = (selector) => {
    const el = document.querySelector(selector);
    return el === null ? null : round(el.scrollHeight);
  };
  const panes = document.querySelector('.mtg-builder__panes');
  return {
    inlineStyle: panes === null ? null : panes.getAttribute('style'),
    poolScroll: box('.mtg-deck__pane[data-pane="pool"] .mtg-deck__pane-scroll'),
    poolFace: box('.mtg-deck__pane[data-pane="pool"] .mtg-card'),
    deckScroll: box('.mtg-deck__pane[data-pane="deck"] .mtg-deck__pane-scroll'),
    deckContent: content('.mtg-deck__pane[data-pane="deck"] .mtg-deck__pane-scroll'),
    deck: box('.mtg-deck__pane[data-pane="deck"]'),
    pool: box('.mtg-deck__pane[data-pane="pool"]'),
    panes: box('.mtg-builder__panes'),
    screen: box('.mtg-builder-screen'),
    above: box('.mtg-builder__above'),
    bar: box('.mtg-builder__bar'),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
})()`;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface Reading {
  readonly inlineStyle: string | null;
  readonly poolScroll: Box | null;
  readonly poolFace: Box | null;
  readonly deckScroll: Box | null;
  readonly deckContent: number | null;
  readonly deck: Box | null;
  readonly pool: Box | null;
  readonly panes: Box | null;
  readonly screen: Box | null;
  readonly above: Box | null;
  readonly bar: Box | null;
  readonly pageOverflowX: number;
}

/**
 * What the panes must keep of the screen they are framed in.
 *
 * `mtg-i195`. Above them sits one box: the counts bar, plus whatever the deck
 * is failing (a shortfall, an oversize deck), and those notes are the screen
 * telling a player why the deck is not legal, so the share is a floor rather
 * than an equality. What it forbids is a second row of prose growing back --
 * the pool note and the gesture line together were another 70px of a 900px
 * window, on top of the 46px the bar takes.
 */
const PANE_SHARE = 0.85;

/**
 * What the collection may take of the workbench's width, either end inclusive.
 *
 * The playtester asked for "~60-65%" of the viewport for the browser against
 * "~35-40%" for the deck (`mtg-3ggp`); the stylesheet says five fifths to three,
 * which is 62.5%, and the gutter between them puts the measured share a little
 * under that. The band is what the screen has to stay inside, not the number.
 */
const COLLECTION_SHARE: readonly [number, number] = [0.55, 0.7];

/**
 * The least of the workbench the pool row may be left holding.
 *
 * The stylesheet writes the floor as two fifths of the workbench less its
 * gutters and its divider, so as a share of the whole grid it lands a little
 * under 0.4 -- 0.381 at 1440x900 with the whole pool chosen, 0.383 at the
 * suggested deck. This is the bound under both, not either number.
 */
const POOL_FLOOR_SHARE = 0.375;

/** The most of the workbench the deck row may take: `mtg-8osf`'s three fifths. */
const DECK_SHARE = 0.6;

/** What the pool may hold over its floor before it is hoarding. */
const SHARE_SLACK = 0.02;

/**
 * The pool scrollport the suggested deck used to leave, which this rule beats.
 *
 * 214.7px measured at 1440x900 before the change, against 246.6 after it. The
 * assertion is the old number rather than the new one: what is being claimed is
 * that the pool got height back, not that it got exactly 32px of it.
 */
const POOL_PORT_BEFORE_PX = 215;

const SLACK_PX = 0.5;

/** The frame gate restated as a table, the way the other builder rigs read it. */
const FRAMED = [
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1024, height: 768 },
] as const;

/** Wide enough for two columns, too short to divide: the split without the frame. */
const UNFRAMED = { width: 1024, height: 640 } as const;

async function read(width: number, height: number, html: string): Promise<Reading> {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-workbench-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-workbench-chrome-'));
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
    )) as unknown as Reading | null;
    if (seen === null) throw new Error('the page drew no builder');
    return seen;
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function panesOf(seen: Reading): { readonly deck: Box; readonly pool: Box; readonly grid: Box } {
  const { deck, pool, panes } = seen;
  if (deck === null || pool === null || panes === null) throw new Error('a builder pane is missing');
  return { deck, pool, grid: panes };
}

/**
 * The sealed arrangement: pool over deck, both the full width, nothing sideways.
 *
 * Which of the two is taller is not here, because it depends on what the deck
 * holds -- `expectShare` below.
 *
 * The Constructed builder left this arrangement in `mtg-x6xq` and `expectDesk`
 * is its claim. What made the two screens able to differ is `mtg-umro`: the
 * reason to stack was that a deck of mana-value columns cannot be read in two
 * fifths of the width, and the Constructed deck pane now opens on a decklist,
 * which can. The sealed pane has no list and so keeps the width.
 */
function expectWorkbench(seen: Reading, at: string): void {
  const { deck, pool, grid } = panesOf(seen);
  expect(seen.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
  expect(pool.bottom, `${at}: the pool is beside the deck rather than above it`).toBeLessThanOrEqual(
    deck.top + SLACK_PX,
  );
  expect(deck.width, `${at}: the deck pane is not the full width of the workbench`).toBeCloseTo(
    grid.width,
    0,
  );
  expect(pool.width, `${at}: the pool pane is not the full width of the workbench`).toBeCloseTo(
    grid.width,
    0,
  );
}

/**
 * The Constructed arrangement: collection left, deck right, both full height.
 *
 * `mtg-x6xq`. The share is a constant rather than a function of what the deck
 * holds, which is the other thing that changed: a *row* that grows when the
 * first card is played costs the pool height it was not using, and a *column*
 * that narrows on the same event moves every card in the pool sideways while
 * somebody is aiming at one. So the tracks are five to three at every state, and
 * what is asserted is the band rather than the number, because the number is the
 * stylesheet's.
 */
function expectDesk(seen: Reading, at: string): void {
  const { deck, pool, grid } = panesOf(seen);
  expect(seen.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
  expect(pool.right, `${at}: the collection is not left of the deck`).toBeLessThanOrEqual(
    deck.left + SLACK_PX,
  );
  expect(deck.top, `${at}: the two panes are on different rows`).toBeCloseTo(pool.top, 0);
  expect(deck.height, `${at}: the deck pane is not the full height of the workbench`).toBeCloseTo(
    grid.height,
    0,
  );
  expect(pool.height, `${at}: the collection is not the full height of the workbench`).toBeCloseTo(
    grid.height,
    0,
  );
  const share = pool.width / grid.width;
  expect(share, `${at}: the collection is narrower than the deck`).toBeGreaterThanOrEqual(
    COLLECTION_SHARE[0],
  );
  expect(share, `${at}: the deck pane is a sliver`).toBeLessThanOrEqual(COLLECTION_SHARE[1]);
}

/**
 * How the workbench divides its height, which is `mtg-d9f4`'s rule.
 *
 * `mtg-8osf` gave the deck three fifths of the height and the pool two, and a
 * deck being cut is what that was argued for. It is wrong for a deck that is not
 * using its share, and every sealed deck short of about forty cards is one:
 * measured here at 1440x900, the screen's own 23-card suggestion drew 320px of
 * decklist into a 441.8px pane while the pool it is cut from held 1379px of
 * cards behind a 214.7px scrollport. So the deck row is `minmax(0, max-content)`
 * -- it returns the height it is not using -- and the two fifths moved onto the
 * pool row as a *floor* rather than a share, which is what stops a deck longer
 * than the workbench from taking the whole of it.
 *
 * `deckFits` is which end of that the caller is measuring, and both ends are
 * asserted rather than one: a rule that only ever gives height away is a pool
 * that swallows a 60-card deck.
 */
function expectShare(seen: Reading, at: string, deckFits: boolean): void {
  const { deck, pool, grid } = panesOf(seen);
  const { deckScroll, deckContent } = seen;
  if (deckScroll === null || deckContent === null) throw new Error('the deck pane drew no list');
  expect(pool.height / grid.height, `${at}: the pool fell under its floor`).toBeGreaterThanOrEqual(
    POOL_FLOOR_SHARE,
  );
  if (deckFits) {
    expect(
      deckContent,
      `${at}: the deck pane put a list it had room for behind a scrollbar`,
    ).toBeLessThanOrEqual(deckScroll.height + SLACK_PX);
    expect(
      deck.height / grid.height,
      `${at}: the deck took its whole share of a workbench it does not need`,
    ).toBeLessThan(DECK_SHARE);
    return;
  }
  expect(deckContent, `${at}: the deck fits its pane, so this is not the state under test`).toBeGreaterThan(
    deckScroll.height + SLACK_PX,
  );
  expect(deck.height / grid.height, `${at}: the deck took more than its share`).toBeLessThanOrEqual(
    DECK_SHARE,
  );
  expect(
    pool.height / grid.height,
    `${at}: the pool kept height a deck short of room was asking for`,
  ).toBeLessThanOrEqual(POOL_FLOOR_SHARE + SHARE_SLACK);
}

describe('a framed deckbuilder is a workbench', () => {
  browserIt(
    'spends one row above the panes and gives them the rest',
    async () => {
      for (const size of [FRAMED[0], FRAMED[1]] as const) {
        const at = `${String(size.width)}x${String(size.height)} sealed`;
        const seen = await read(size.width, size.height, sealedPage());
        const { grid } = panesOf(seen);
        const { screen, above } = seen;
        if (screen === null || above === null) throw new Error('the builder drew no frame');
        expect(above.height, `${at}: the box above the panes grew past one toolbar row`).toBeLessThan(64);
        expect(
          grid.height / screen.height,
          `${at}: the panes lost the screen to the chrome above them`,
        ).toBeGreaterThanOrEqual(PANE_SHARE);
      }
    },
    240_000,
  );

  browserIt(
    'puts the collection down the left and the deck down the right',
    async () => {
      for (const size of FRAMED) {
        const at = `${String(size.width)}x${String(size.height)}`;
        const seen = await read(size.width, size.height, constructedPage());
        expectDesk(seen, at);
      }
    },
    240_000,
  );

  /**
   * The Constructed screen's own chrome budget, which is `mtg-i8xl`'s claim.
   *
   * It has no `.mtg-builder__above`: its title, counts, saved decks, actions and
   * legality notes are one bar. Measured at 1600x1000 before that change, this
   * screen spent 368 of 1000 pixels above its panes and left the pool a 152px
   * scrollport holding 26,769px of cards.
   */
  browserIt(
    'spends one bar above the panes and gives them the rest',
    async () => {
      for (const size of [FRAMED[0], FRAMED[1]] as const) {
        const at = `${String(size.width)}x${String(size.height)} constructed`;
        const seen = await read(size.width, size.height, constructedPage());
        const { grid } = panesOf(seen);
        const { screen, above, bar } = seen;
        if (screen === null || bar === null) throw new Error('the builder drew no toolbar');
        expect(above, `${at}: the Constructed builder grew a box above its panes again`).toBeNull();
        expect(bar.height, `${at}: the toolbar grew past two rows`).toBeLessThan(96);
        expect(
          grid.height / screen.height,
          `${at}: the panes lost the screen to the chrome above them`,
        ).toBeGreaterThanOrEqual(PANE_SHARE);
      }
    },
    240_000,
  );

  /**
   * All three deck states in one browser lane, because that is what the rule is
   * about: the same stylesheet has to hand the height over on an empty deck and
   * take it back on one longer than the workbench. Measuring only the state the
   * screen opens in is how the three-fifths split survived as long as it did.
   */
  browserIt(
    'gives the sealed screen the same workbench at every deck it holds',
    async () => {
      const empty = '1440x900 sealed, nothing chosen';
      const seen = await read(1440, 900, sealedPage('empty'));
      expectWorkbench(seen, empty);
      expectShare(seen, empty, true);

      const suggested = '1440x900 sealed, the suggested deck';
      const opened = await read(1440, 900, sealedPage());
      expectWorkbench(opened, suggested);
      expectShare(opened, suggested, true);
      const { poolScroll } = opened;
      if (poolScroll === null) throw new Error('the pool drew no scrollport');
      expect(
        poolScroll.height,
        `${suggested}: the pool kept no more room than the three-fifths split left it`,
      ).toBeGreaterThan(POOL_PORT_BEFORE_PX);

      const whole = '1440x900 sealed, the whole pool chosen';
      const full = await read(1440, 900, sealedPage('whole pool'));
      expectWorkbench(full, whole);
      expectShare(full, whole, false);

      // Both tracks are the stylesheet's until somebody drags the divider, which
      // writes both inline and outranks them. `../deck/builder-split.test.ts`
      // holds the dragged half; this is the other half of the same claim, and it
      // is what makes the three readings above readings of the rule.
      for (const [at, reading] of [
        [empty, seen],
        [suggested, opened],
        [whole, full],
      ] as const) {
        expect(reading.inlineStyle, `${at}: the undragged workbench wrote a track inline`).toBeNull();
      }
    },
    360_000,
  );

  browserIt(
    'leaves the panes side by side where there is no room to divide the height',
    async () => {
      const at = `${String(UNFRAMED.width)}x${String(UNFRAMED.height)}`;
      const seen = await read(UNFRAMED.width, UNFRAMED.height, constructedPage());
      const { deck, pool } = panesOf(seen);
      expect(seen.pageOverflowX, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(SLACK_PX);
      // Same order as inside the frame, and that is the point of asserting it:
      // the split query and the frame query are two constants, so a screen can
      // be wide enough for two columns and too short to divide. What changes
      // below the gate is that the page is a document again, not which column
      // the collection is in.
      expect(pool.right, `${at}: the columns swapped below the frame gate`).toBeLessThanOrEqual(
        deck.left + SLACK_PX,
      );
      expect(deck.top, `${at}: the two panes are on different rows`).toBeCloseTo(pool.top, 0);
    },
    120_000,
  );

  browserIt(
    'opens a new deck with room in the pool for a whole card',
    async () => {
      const at = '1440x900 constructed, full cards';
      const seen = await read(1440, 900, constructedPage('full'));
      const { poolScroll, poolFace } = seen;
      if (poolScroll === null || poolFace === null) throw new Error('the pool drew no cards');
      expect(
        poolScroll.height,
        `${at}: the pool is shorter than the card it is drawing, so it shows a band of title bars`,
      ).toBeGreaterThanOrEqual(poolFace.height);
    },
    120_000,
  );
});
