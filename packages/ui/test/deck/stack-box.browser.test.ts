// @vitest-environment node
/**
 * Where a strip column's box height comes from, measured in a real engine.
 *
 * `mtg-47xi`. The box was a constant (`../../src/routes/deck/strips.ts`'s
 * `DECK_STACK_BOX`) and the pane around it has had a measured height since
 * `mtg-tz11`, so on a 1440x900 desk the columns stopped with 300px of empty
 * pane under them while a deep column beside them sat on the pitch floor and
 * lost its tail. `../../src/routes/deck/stack-box.ts` derives the box from the
 * pane instead, and splits the derivation in two so both halves are checkable:
 * `boxFromRoom` is arithmetic over four lengths (`./stack-box.test.ts`) and this
 * file is where the four lengths come from.
 *
 * # What is asserted here, and why it is the lengths rather than the box
 *
 * The rigs in this directory server-render the route and navigate Chrome to the
 * file; nothing mounts React, so the hook that applies the measured box never
 * runs and the markup carries the constant. Asserting on the drawn box would
 * therefore be asserting on the constant, green forever.
 *
 * So the reading is the inputs: the token the pane declares, and the lengths
 * `roomOf` reads off the DOM. They go through the same `boxFromRoom` the app
 * calls, which is the part that would silently be wrong -- a box that came out
 * plausible from a `regionTop` measured against the wrong ancestor is exactly
 * the failure a test of the number alone cannot see.
 *
 * `mtg-rgc.21` added the fifth length and the second derivation on top of it:
 * the full density divides the scrollport's *width* between the columns
 * (`fullColumnWidth`), so this file reads that width off the same scrollport and
 * checks what the app would draw from it.
 *
 * # Two screens, because the token is the whole gate
 *
 * The Decks route frames unconditionally and declares the token; the Constructed
 * builder frames only inside `BUILDER_FRAME_QUERY` and declares it only there.
 * Below that gate the pane is sized by its own cards, and a column that read its
 * height from a scrollport its height had produced would grow by one header
 * every frame. That is the runaway the token exists to prevent, so the unframed
 * size is asserted rather than skipped.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { Shell } from '../../src/app/Shell';
import { DeckRoute } from '../../src/routes/DeckRoute';
import { deckOpenParam } from '../../src/routes/deck/open';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { boxFromRoom } from '../../src/routes/deck/stack-box';
import type { StackRoom } from '../../src/routes/deck/stack-box';
import {
  DECK_STACK_BOX,
  FULL_COLUMN_MAX_PX,
  FULL_COLUMN_MIN_PX,
  STRIP_COLUMN_GAP_PX,
  fullColumnWidth,
  fullStackBox,
  stackMetrics,
} from '../../src/routes/deck/strips';
import { StripColumns } from '../../src/routes/deck/StripColumns';
import type { Group } from '../../src/routes/deck/grouping';
import { STACK_BOX_FROM_PANE } from '../../src/styles/stack-box';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const HERE = dirname(fileURLToPath(import.meta.url));

const DECK_PATH = join(HERE, '..', '..', '..', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');
const PARSED = readDeckArtifact(JSON.parse(readFileSync(DECK_PATH, 'utf8')), DECK_PATH);
if (!PARSED.ok) throw new Error(PARSED.message);

/** No illustrations: this harness hangs on a remote image. `./deck-frame.browser.test.ts` argues it. */
function unillustrated(entries: readonly DeckArtifactEntry[]): DeckArtifactEntry[] {
  return entries.map((entry) => ({ ...entry, art: null }));
}

const DECK: DeckArtifact = {
  ...PARSED.deck,
  spells: unillustrated(PARSED.deck.spells),
  lands: unillustrated(PARSED.deck.lands),
  basics: unillustrated(PARSED.deck.basics),
};

const SET_FIXTURE = join(HERE, '..', '..', '..', 'setgen', 'fixtures', 'sets', 'tideglass-reach.set.json');

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

function compactStore(): void {
  const prefix = deckViewStoreKey('');
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string): string | null => (key.startsWith(prefix) ? 'compact' : null),
    setItem: (): void => undefined,
  };
}

function html(markup: string, title: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`
  );
}

/** The open deck: the route that frames whatever the window is. */
function deckPage(): string {
  compactStore();
  return html(
    renderToStaticMarkup(
      h(Shell, {
        mode: 'customize',
        sub: 'decks',
        onSelectMode: (): void => undefined,
        children: h(DeckRoute, {
          state: { status: 'ready', deck: DECK },
          open: deckOpenParam({ kind: 'artifact' }),
        }),
      }),
    ),
    'Deck',
  );
}

/**
 * A column too deep for any box: sixty copies, which is a mono-color deck
 * grouped by color and is the case that used to lose its tail.
 */
function deepColumnPage(): string {
  const group: Group<string> = {
    key: 'white',
    label: 'White',
    manaValue: null,
    symbol: 'W',
    cards: 60,
    members: ['Ashen Rite'],
  };
  return html(
    renderToStaticMarkup(
      h(StripColumns<string>, {
        groups: [group],
        factsOf: () => ({
          key: 'ashen-rite',
          name: 'Ashen Rite',
          manaCost: '{1}{W}',
          colorIdentity: 'W',
          copies: 60,
        }),
        onSelect: (): void => undefined,
        label: 'Deck, cards',
      }),
    ),
    'Deep column',
  );
}

/** The Constructed builder, whose frame is gated and whose token therefore is. */
function builderPage(cards: readonly Card[]): string {
  compactStore();
  return html(
    renderToStaticMarkup(
      h(Shell, {
        mode: 'customize',
        sub: 'decks',
        onSelectMode: (): void => undefined,
        children: h(DeckRoute, {
          state: { status: 'absent' },
          cards,
          open: deckOpenParam({ kind: 'build' }),
        }),
      }),
    ),
    'Builder',
  );
}

/**
 * The token, and the three lengths under it.
 *
 * Deliberately the same reads `roomOf` makes, in the same order, rather than a
 * convenient approximation of them: this file's whole job is to say that those
 * reads land on the right boxes.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const pane = document.querySelector('.mtg-deck__pane-scroll');
  if (pane === null) return null;
  const token = getComputedStyle(pane).getPropertyValue('--strip-box-from').trim();
  const region = document.querySelector('.mtg-deck__pane-scroll .mtg-strips');
  const stack = region === null ? null : region.querySelector('.mtg-strips__stack');
  const scrollport = region === null ? null : region.parentElement;
  if (region === null || stack === null || scrollport === null) return { token, room: null };
  const regionTop = region.getBoundingClientRect().top;
  return {
    token,
    room: {
      scrollportHeight: round(scrollport.clientHeight),
      scrollportWidth: round(scrollport.clientWidth),
      regionTop: round(regionTop - scrollport.getBoundingClientRect().top + scrollport.scrollTop),
      stackTop: round(stack.getBoundingClientRect().top - regionTop),
      regionFoot: round((parseFloat(getComputedStyle(region).getPropertyValue('padding-block-end')) || 0)
        + Math.max(0, region.offsetHeight - region.clientHeight)),
    },
    columns: region.querySelectorAll('.mtg-strips__stack').length,
    drawnBox: round(parseFloat(getComputedStyle(stack).getPropertyValue('max-block-size')) || 0),
  };
})()`;

/**
 * The token is read off the pane and the lengths off the region, because the
 * builder opens with an empty deck: its deck pane draws a sentence rather than
 * columns, and its pool pane draws `.mtg-builder-curve`. A pane with no strip
 * region in it still declares -- or withholds -- the token, which is the claim
 * this file makes about that screen.
 */
interface Reading {
  readonly token: string;
  readonly room: StackRoom | null;
  /** How many mana values this pane drew, which is what the width is divided by. */
  readonly columns?: number;
  readonly drawnBox?: number;
}

/** The deep column, driven to the end of itself. */
const DEEP_MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const stack = document.querySelector('.mtg-strips__stack');
  if (stack === null) return null;
  stack.scrollTop = 4000;
  void document.documentElement.offsetHeight;
  const strips = stack.querySelectorAll('.mtg-strips__card');
  const last = strips[strips.length - 1];
  return {
    clipped: stack.getAttribute('data-clipped'),
    scrollable: round(stack.scrollHeight - stack.clientHeight),
    scrolled: round(stack.scrollTop),
    stackBottom: round(stack.getBoundingClientRect().bottom),
    lastBottom: round(last.getBoundingClientRect().bottom),
  };
})()`;

interface DeepReading {
  readonly clipped: string | null;
  readonly scrollable: number;
  readonly scrolled: number;
  readonly stackBottom: number;
  readonly lastBottom: number;
}

describe('the box a strip column is laid out inside', () => {
  browserIt('takes its height from the pane wherever the pane has one to give', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mtg-stack-box-'));
    const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-stack-box-chrome-'));
    const chrome = await launchChrome(userDataDir);
    try {
      const deck = join(directory, 'deck.html');
      await writeFile(deck, deckPage(), 'utf8');
      const builder = join(directory, 'builder.html');
      await writeFile(builder, builderPage(loadSet()), 'utf8');

      const read = async (file: string, width: number, height: number, at: string): Promise<Reading> => {
        const seen = (await measurePage(
          chrome.client,
          file,
          width,
          height,
          MEASURE,
          at,
          '.mtg-deck__pane-scroll',
        )) as unknown as Reading | null;
        if (seen === null) throw new Error(`${at}: the page drew no strip region`);
        return seen;
      };

      // The desk. The pane has room the constant could not see, and the box the
      // app would derive from it is most of the pane rather than 360px of it.
      const desk = await read(deck, 1440, 900, 'the open deck at 1440x900');
      expect(desk.token, 'the framed deck pane does not declare its height').toBe(STACK_BOX_FROM_PANE);
      if (desk.room === null) throw new Error('the open deck drew no strip region');
      expect(desk.drawnBox, 'the served markup already carries a measured box').toBe(
        DECK_STACK_BOX.boxHeight,
      );
      const grown = boxFromRoom(DECK_STACK_BOX, desk.room);
      expect(grown.boxHeight, 'the pane gave the columns no more room than the constant').toBeGreaterThan(
        DECK_STACK_BOX.boxHeight,
      );
      // Inside the pane, which is the half a wrong ancestor would break: a
      // `regionTop` read against the page rather than the scrollport comes out
      // plausible and puts the bottom of every column below the fold.
      expect(grown.boxHeight, 'the derived box is taller than the pane holding it').toBeLessThanOrEqual(
        desk.room.scrollportHeight,
      );
      expect(
        desk.room.regionTop,
        'the region is not at the top of its own scrollport',
      ).toBeGreaterThanOrEqual(0);
      expect(desk.room.stackTop, 'the column heads take no room at all').toBeGreaterThan(0);

      // And the point of it: a column that was clipped against the constant is
      // not clipped against the pane. Re-derived at mtg-mxkrk, when `faceHeight`
      // came down from a whole card to one name bar: the depth this yields moved
      // from 19 strips to 27 and the statement still holds, because the constant
      // box reaches the pitch floor either way.
      const deep = Math.ceil(
        (DECK_STACK_BOX.boxHeight - DECK_STACK_BOX.faceHeight) / DECK_STACK_BOX.minPitch,
      );
      expect(stackMetrics(deep + 1, DECK_STACK_BOX).clipped).toBe(true);
      expect(stackMetrics(deep + 1, grown).clipped).toBe(false);

      // The full density's width, from the same reading. `mtg-tdg4.48` made the
      // measured full-face width both its floor and ceiling: squeezing a face
      // to fit more columns made dense official cards unreadable. Compact mode
      // remains the overview when a player wants every column without scrolling.
      // This desk has room for the canonical columns, so they still fit here.
      const columns = desk.columns ?? 0;
      expect(columns, 'the open deck drew no columns to divide the pane between').toBeGreaterThan(1);
      const wide = fullColumnWidth(desk.room.scrollportWidth, columns);
      expect(wide, 'a full column departed from the measured readable width').toBe(FULL_COLUMN_MIN_PX);
      expect(wide, 'a column is drawn wider than a full face was ever measured at').toBeLessThanOrEqual(
        FULL_COLUMN_MAX_PX,
      );
      expect(
        wide * columns + STRIP_COLUMN_GAP_PX * (columns - 1),
        'the derived columns do not fit across the pane they were divided out of',
      ).toBeLessThanOrEqual(desk.room.scrollportWidth);
      // And the box under them is one whole card, which is the floor the pane's
      // own height is raised from.
      expect(fullStackBox(wide).faceHeight, 'a full column is not one card tall').toBe(
        fullStackBox(wide).boxHeight,
      );

      // Below the builder's frame gate the pane is sized by its cards, so it
      // says nothing and the constant stands. This is the runaway guard.
      const phone = await read(builder, 390, 844, 'the builder at 390x844');
      expect(phone.token, 'an unframed pane offers a height it does not have').not.toBe(STACK_BOX_FROM_PANE);

      // Inside the gate the same builder does declare it.
      const framed = await read(builder, 1440, 900, 'the builder at 1440x900');
      expect(framed.token, 'the framed builder pane does not declare its height').toBe(STACK_BOX_FROM_PANE);

      // And the column that is deeper than any box it could be given: it
      // scrolls rather than losing the strips past its bottom edge. Measured
      // rather than read off the sheet, because `overflow-y` on a box whose
      // children are all absolutely positioned is exactly the arrangement where
      // a declared scroll can turn out to have nothing to scroll.
      const deepFile = join(directory, 'deep.html');
      await writeFile(deepFile, deepColumnPage(), 'utf8');
      const seen = (await measurePage(
        chrome.client,
        deepFile,
        1440,
        900,
        DEEP_MEASURE,
        'a sixty-copy column',
        '.mtg-strips__stack',
      )) as unknown as DeepReading | null;
      if (seen === null) throw new Error('the page drew no column');
      expect(seen.clipped, 'a sixty-copy column fits its box').toBe('true');
      expect(seen.scrollable, 'the deep column has nothing to scroll').toBeGreaterThan(0);
      expect(seen.scrolled, 'the deep column refused to scroll').toBeGreaterThan(0);
      // The last strip is reachable: its bottom lands inside the box once the
      // column has been driven to the end of itself.
      expect(seen.lastBottom, 'the last copy is still below the box after scrolling').toBeLessThanOrEqual(
        seen.stackBottom + 1,
      );
    } finally {
      await shutdownChrome(chrome);
    }
  });
});
