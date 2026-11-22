// @vitest-environment node
/**
 * The Constructed builder's two rows of small controls, measured on a phone
 * held upright rather than described.
 *
 * `mtg-dcxg.7`, 2026-08-23. At 390x844 the shot showed the five *Start from*
 * buttons ragged over three rows — two, then two, then one, each as wide as the
 * deck name inside it — and the mana base's five stepper groups split across a
 * wrap with `Lands 24` and the word `suggested` inline among them. Both rows
 * are `flex-wrap: wrap` over items of unequal intrinsic width, which is the
 * right answer in a 900px pane and a ragged one in a 358px column.
 *
 * So the assertions are about alignment rather than about size: the written
 * decks are the width of the column they sit in and start at two edges rather
 * than five, and each color's controls sit on one line with the other four
 * aligned under the left edge of the mana base. Two columns for the decks and
 * three for the colors, because one column of five four-word deck names put the
 * deck being built two screens below the fold.
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
 * Five names of the length the written decks a person actually picks from carry:
 * 21, 15, 17, 19 and 18 characters, which is what makes five of them ragged in a
 * 358px column. The lengths are the subject, so the names themselves are written
 * here rather than read out of a set — a test that typed the flagship's deck
 * names would be naming the private world to measure a wrap.
 */
const STARTERS = [
  { id: 'a', name: 'Break the Stormwarden' },
  { id: 'b', name: 'The Reef Shoals' },
  { id: 'c', name: 'Down in the Silts' },
  { id: 'd', name: 'Wardens of Tidehold' },
  { id: 'e', name: 'Sunken Reach Trial' },
] as const;

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
        starters: STARTERS,
        onStart: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Builder</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const box = (el) => {
    const rect = el.getBoundingClientRect();
    return { left: round(rect.left), right: round(rect.right), top: round(rect.top), height: round(rect.height), width: round(rect.width) };
  };
  const starters = [...document.querySelectorAll('[aria-label="Start from a written deck"] .mtg-btn')].map(box);
  const groups = [...document.querySelectorAll('.mtg-manabar__color')].map(box);
  const symbols = [...document.querySelectorAll('.mtg-manabar__pip')].map((pip) => {
    const symbol = pip.querySelector('.mtg-symbol');
    return {
      label: pip.getAttribute('aria-label'),
      token: symbol?.getAttribute('data-symbol'),
      glyph: symbol?.getAttribute('data-glyph'),
      drawings: symbol?.querySelectorAll('svg').length ?? 0,
    };
  });
  const bar = document.querySelector('.mtg-manabar');
  if (bar === null) return null;
  return {
    starters,
    groups,
    symbols,
    barLeft: round(bar.getBoundingClientRect().left),
    pageOverflowX: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
})()`;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly height: number;
  readonly width: number;
}

interface Reading {
  readonly starters: readonly Box[];
  readonly groups: readonly Box[];
  readonly symbols: readonly {
    readonly label: string | null;
    readonly token: string | null;
    readonly glyph: string | null;
    readonly drawings: number;
  }[];
  readonly barLeft: number;
  readonly pageOverflowX: number;
}

const SLACK_PX = 0.5;

describe('the deck editor on a phone', () => {
  browserIt(
    'aligns the written decks in columns and keeps each mana stepper on one line',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-builder-phone-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-builder-phone-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'builder.html');
      await writeFile(file, page(), 'utf8');
      try {
        const seen = (await measurePage(
          chrome.client,
          file,
          390,
          844,
          MEASURE,
          '390x844',
          '.mtg-manabar',
          true,
          { mobile: true, pointer: 'coarse' },
        )) as unknown as Reading | null;
        if (seen === null) throw new Error('the page drew no builder');

        expect(seen.pageOverflowX, 'the page scrolls sideways').toBeLessThanOrEqual(SLACK_PX);

        expect(seen.starters.length, 'the written decks are not on screen').toBe(STARTERS.length);
        const first = seen.starters[0];
        if (first === undefined) throw new Error('no written deck drew');
        // Two equal columns rather than five ragged widths: every button is the
        // width of the column it is in, and there are two column edges, not five.
        const edges = [...new Set(seen.starters.map((button) => button.left))];
        expect(edges.length, 'the written decks start at more than two edges').toBeLessThanOrEqual(2);
        const starterRows = [...new Set(seen.starters.map((button) => button.top))];
        expect(starterRows.length, 'five written decks take more than three rows').toBeLessThanOrEqual(3);
        for (const [index, button] of seen.starters.entries()) {
          expect(
            button.width,
            `written deck ${String(index + 1)}: is a different width from the first`,
          ).toBeCloseTo(first.width, 0);
        }

        expect(seen.groups.length, 'the mana base drew no colors').toBe(5);
        expect(seen.symbols).toEqual([
          { label: 'Plains', token: '{W}', glyph: 'w', drawings: 1 },
          { label: 'Island', token: '{U}', glyph: 'u', drawings: 1 },
          { label: 'Swamp', token: '{B}', glyph: 'b', drawings: 1 },
          { label: 'Mountain', token: '{R}', glyph: 'r', drawings: 1 },
          { label: 'Forest', token: '{G}', glyph: 'g', drawings: 1 },
        ]);
        const rows = [...new Set(seen.groups.map((group) => group.top))];
        expect(rows.length, 'the five colors are spread over more than two rows').toBeLessThanOrEqual(2);
        for (const top of rows) {
          const leftmost = Math.min(...seen.groups.filter((group) => group.top === top).map((g) => g.left));
          expect(leftmost, 'a row of colors is indented past the edge of the mana base').toBeCloseTo(
            seen.barLeft,
            0,
          );
        }
        for (const [index, group] of seen.groups.entries()) {
          const at = `mana group ${String(index + 1)}`;
          expect(group.right, `${at}: runs past the right edge of the row`).toBeLessThanOrEqual(390);
          expect(group.left, `${at}: starts left of the row`).toBeGreaterThanOrEqual(seen.barLeft - SLACK_PX);
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
