// @vitest-environment node
/**
 * The Play landing on a phone held sideways, where the sections stopped
 * clearing each other.
 *
 * Caught in a screenshot of the shipped page at 844x390: "SEALED / Open six
 * boosters and build a 40-card deck out of them." was painted straight through
 * two of the deck cards above it. The cause is one declaration.
 * `../../src/styles/views.ts` makes `.mtg-play-route` a flex column with the
 * viewport's height to spend, and `.mtg-playsection` carried `min-height: 0`,
 * which is the pair of properties that lets a flex child be given less height
 * than its own content and hand the difference back as overflow. On a desktop
 * there was always enough height for the deficit to be zero; on a 390px-tall
 * phone the decks section was 200px short and the five cards in it kept their
 * size and spilled over the section below.
 *
 * The budget was for the section that holds a *live table* — that one has to be
 * able to shrink, because the table inside it scrolls — so the fix moves it onto
 * that section alone and lets the chooser be as tall as its content, which
 * `.mtg-shell__main` already scrolls.
 *
 * `620b4d6f` ("one Play chooser per format, each choosing a bot or the
 * network") retired the shape this file originally caught the bug in: Decks
 * and Sealed no longer stack on one screen at all. `OpponentChoice` draws
 * exactly one open column's body under the bot/LAN cells, so there is only
 * ever one `.mtg-playsection` on this landing now, and this file's original
 * two-or-more-sections assertion is unreachable by construction rather than a
 * property the page happens to hold. What is still reachable is the failure
 * mode underneath that count: a section given less height than its content
 * spills that content past its own edges. Before `620b4d6f` the thing it
 * spilled into was always the next section, which is what made a boundary
 * check sufficient; now there may be nothing below it to collide with, so
 * this asserts the section's own cards stay inside its own box, and that the
 * section starts below the opponent cells drawn above it — the same "nothing
 * painted over" property, checked against the box that still exists.
 *
 * **The browser is told it is a phone**, for `./ask-column-phone.browser.test.ts`'s
 * reason: the touch floors are most of what this page spends its height on, so a
 * rig on a fine pointer measures a page that fits and reports a squeeze that is
 * not there.
 *
 * The neutral `@mtg/dsl` example set, so this file exports with the rest of the
 * lab (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS, isCreature } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** How many decks the page draws. The staged flagship offers five. */
const DECK_COUNT = 5;

/** The spells each fixture deck lists. Enough for a card with a real blurb. */
const SPELLS_PER_DECK = 12;

function fixturePrecons(): PreconFile {
  const spells = EXAMPLE_CARDS.filter((card: Card) => card.kind !== 'land').slice(0, SPELLS_PER_DECK);
  const payoff = spells.find((card: Card) => isCreature(card)) ?? spells[0];
  if (payoff === undefined) throw new Error('the example set listed no spell to build a fixture deck on');
  const decks = Array.from({ length: DECK_COUNT }, (_unused, index) => ({
    id: `fixture-${String(index)}`,
    name: `Fixture deck ${String(index + 1)}`,
    plan: 'Curve out with cheap creatures, answer whatever holds the ground, and finish from the air.',
    payoff: payoff.id,
    spells: spells.map((card: Card) => ({ id: card.id, count: 3 })),
    basics: { W: 12, U: 12 },
    deckSize: 60,
  }));
  return { formatVersion: 1, setCode: 'SLC', decks };
}

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayRoute, {
        set: { status: 'ready', cards: EXAMPLE_CARDS, collation: { kind: 'none' } },
        precons: { state: { status: 'ready', file: fixturePrecons() } },
        setName: 'The example set',
        setKind: 'Custom set',
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Play landing</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The top and bottom of every section of the chooser, the opponent cells drawn
 * above it, and how many deck cards were drawn — so a pass cannot be the pass
 * of a page that drew nothing to check.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const label = (node) => {
    const title = node.querySelector('.mtg-playsection__title');
    return (title === null ? '' : title.textContent ?? '').trim();
  };
  const box = (node) => {
    const rect = node.getBoundingClientRect();
    return { top: round(rect.top), bottom: round(rect.bottom) };
  };
  const sections = Array.from(document.querySelectorAll('.mtg-playsection')).map((node) => {
    return {
      title: label(node),
      ...box(node),
      cards: Array.from(node.querySelectorAll('.mtg-deckcard')).map((card) => box(card)),
    };
  });
  const cells = document.querySelector('.mtg-opponents');
  return {
    viewport: [document.documentElement.clientWidth, document.documentElement.clientHeight],
    sections,
    cells: cells === null ? null : box(cells),
    decks: document.querySelectorAll('.mtg-deckcard').length,
  };
})()`;

interface Box {
  readonly top: number;
  readonly bottom: number;
}

interface Section extends Box {
  readonly title: string;
  readonly cards: readonly Box[];
}

interface Reading {
  readonly viewport: readonly [number, number];
  readonly sections: readonly Section[];
  readonly cells: Box | null;
  readonly decks: number;
}

/** An iPhone 14 sideways, which is the narrowest, and a Pro Max, which is not. */
const LANDSCAPE = [
  [844, 390],
  [932, 430],
] as const;

/** Same width, room under it: the sections must clear each other there too. */
const TALL_CONTROL = [844, 900] as const;

/** Rounding slack, the same half pixel the other phone rigs compare on. */
const SLACK_PX = 0.5;

describe('the Play landing on a phone held sideways', () => {
  browserIt(
    'starts every section below the one before it, so nothing is painted over a deck',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-chooser-phone-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-chooser-phone-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'chooser.html');
      await writeFile(file, page(), 'utf8');
      let bodyError: unknown;
      try {
        for (const [width, height] of [...LANDSCAPE, TALL_CONTROL]) {
          const at = `${String(width)}x${String(height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            at,
            '.mtg-playsection',
            true,
            { mobile: true, pointer: 'coarse' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`the page drew no chooser at ${at}`);
          expect(seen.viewport, `${at} viewport`).toEqual([width, height]);
          expect(seen.decks, `${at}: the page drew no deck cards to collide with`).toBe(DECK_COUNT);
          // `620b4d6f`: exactly one section draws at a time now — the open
          // column's body — so there is no second section left to check a
          // boundary against.
          expect(seen.sections.length, `${at}: the page drew no open section`).toBe(1);
          const section = seen.sections[0];
          if (section === undefined) throw new Error('unreachable: length checked above');
          if (seen.cells !== null) {
            expect(
              section.top,
              `${at}: "${section.title}" starts above the bottom of the opponent cells, so it is painted over them`,
            ).toBeGreaterThanOrEqual(seen.cells.bottom - SLACK_PX);
          }
          // The box itself, and then everything drawn inside it. The original
          // defect was the second of those: the section was *given* a shorter
          // box than its content and the five cards in it kept their size, so
          // the section's own boundary stayed in place while the cards were
          // painted straight through whatever came after it. With only one
          // section now, "whatever came after it" can be nothing, so the check
          // is the card staying inside its own section rather than in front of
          // a neighbor.
          section.cards.forEach((card, card_index) => {
            expect(
              card.bottom,
              `${at}: deck card ${String(card_index + 1)} of "${section.title}" runs ${String(round(card.bottom - section.bottom))}px past its own section`,
            ).toBeLessThanOrEqual(section.bottom + SLACK_PX);
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
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `chooser phone Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
