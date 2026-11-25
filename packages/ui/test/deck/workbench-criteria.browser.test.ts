// @vitest-environment node
/**
 * The workbench's shared criteria are said once, above the rows, and a row
 * keeps only the citations that tell it from its neighbors.
 *
 * Issue 106 (imported from `mtg-0r80`). Every row of a built variation printed
 * the same run of ids in monospace — `sets colors archetype … powerBand` — so
 * most of each row's chips said nothing about which card it was.
 * `../../src/routes/deck/OpenDeckScreen.ts`'s `sharedCriteria` already answered
 * this on the other deck surface; the workbench now asks the same function and
 * prints the shared ones as the person's own statements.
 *
 * The fixture is the shape of a real twelve-row build from the shelf: four
 * criteria every row cites, and two themes split between the rows. Card names
 * are invented.
 *
 * Measured with this file's fixture, before (`origin/main` at `ace9cb0776`) and
 * after. "Citation lines" is the height of one row's citation list in lines of
 * chips; "rows in view" is rows whose bottom is inside the right column.
 *
 * | viewport | chips on rows | citation lines | tallest row     | rows in view |
 * | -------- | ------------- | -------------- | --------------- | ------------ |
 * | 1024x768 | 62 -> 14      | 2-3 -> 1-2     | 172.8 -> 150px  | 4 -> 4       |
 * | 1280x800 | 62 -> 14      | 1-2 -> 1       | 123.1 -> 100.3px| 6 -> 6       |
 * | 1440x900 | 62 -> 14      | 2-3 -> 1       | 172.8 -> 127.1px| 6 -> 9       |
 *
 * The four shared statements now sit above the curve, which is why the deck's
 * own height falls by less than the rows do (902 -> 814.7px at 1440x900).
 * Nothing here asserts a height: the row count, the chips left on rows and the
 * shared line's content and position are the contract, and the table is the
 * evidence the change was worth making.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import type { Variation, VariationEntry } from '../../src/routes/deck/workbench/client';
import { VariationView } from '../../src/routes/deck/workbench/VariationView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SHARED = ['sets', 'colors', 'archetype', 'powerBand'] as const;
const WIDE = 'theme:going wide';
const CHEAP = 'theme:cheap creatures';

function row(index: number, themes: readonly string[]): VariationEntry {
  return {
    id: `row-${String(index)}`,
    name: `Lantern Squire ${String(index)}`,
    count: index % 3 === 0 ? 2 : 4,
    manaCost: index % 2 === 0 ? '{W}' : '{1}{W}',
    manaValue: index % 2 === 0 ? 1 : 2,
    typeLine: 'Creature — Human Soldier',
    criteria: [...SHARED.slice(0, 3), ...themes, 'powerBand'],
    reason: 'a cheap body that attacks on the second turn and makes the board wider',
  };
}

const THEMES: readonly (readonly string[])[] = [
  [WIDE],
  [CHEAP],
  [CHEAP],
  [CHEAP],
  [CHEAP, WIDE],
  [CHEAP],
  [CHEAP],
  [WIDE, CHEAP],
  [WIDE],
  [WIDE],
  [WIDE],
  [WIDE],
];
const ROWS = THEMES.map((themes, index) => row(index, themes));
const ROW_CITATIONS = ROWS.reduce((sum, entry) => sum + entry.criteria.length, 0);
const OWN_CITATIONS = THEMES.reduce((sum, themes) => sum + themes.length, 0);

const VARIATION: Variation = {
  version: 1,
  id: 'v1',
  name: 'white weenie',
  builtAt: '2026-11-22T12:00:00.000Z',
  parentId: null,
  criteria: { prompt: 'a fast white deck', sets: ['TGR'], colors: ['W'], size: 60, maxCopies: 4, themes: [] },
  statedCriteria: [
    { id: 'sets', kind: 'structural', statement: 'printed in TGR' },
    { id: 'colors', kind: 'structural', statement: 'color identity within {W}' },
    { id: 'archetype', kind: 'semantic', statement: 'supports the white weenie aggro, go wide archetype' },
    { id: WIDE, kind: 'semantic', statement: 'contributes to the going wide theme' },
    { id: CHEAP, kind: 'semantic', statement: 'contributes to the cheap creatures theme' },
    { id: 'powerBand', kind: 'semantic', statement: 'fits the powerful kitchen-table power band' },
  ],
  plan: 'curve out with cheap creatures and attack before the opponent stabilizes',
  spells: ROWS,
  lands: [],
  basics: [{ color: 'W', count: 22, id: 'tgr-plains' }],
  manaBase: {
    totalLands: 22,
    nonBasicLands: 0,
    castabilityTarget: 0.9,
    heavyCastabilityTarget: 0.8,
    colors: [
      { color: 'W', pipCount: 40, sources: 22, sourceFloor: 16, castability: 0.96, meetsTarget: true },
    ],
    landReason: 'a low curve wants few lands',
    landSource: 'model',
  },
  universeSize: 120,
  shortfalls: [],
};

function page(): string {
  const view = VariationView({ variation: VARIATION, onRebuild: () => undefined, onDelete: () => undefined });
  const markup = renderToStaticMarkup(view);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>workbench criteria</title>' +
    `<style>${uiStyleSheet()}html,body{margin:0;padding:0;height:100%}` +
    '.frame{height:100vh;display:flex;flex-direction:column}</style></head>' +
    '<body><div class="frame"><div class="mtg-workbench"><div class="mtg-workbench__panes">' +
    `<div class="mtg-workbench__left"></div><div class="mtg-workbench__right">${markup}</div>` +
    '</div></div></div></body></html>'
  );
}

/** Selectors are spelled out rather than imported so this reads the page the same way before and after. */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const rows = [...document.querySelectorAll('.mtg-workbench__entry')];
  if (rows.length === 0) return null;
  const right = document.querySelector('.mtg-workbench__right').getBoundingClientRect();
  const deck = document.querySelector('.mtg-workbench__deck').getBoundingClientRect();
  const shared = document.querySelector('.mtg-workbench__shared');
  const chip = document.querySelector('.mtg-workbench__entry .mtg-workbench__cite');
  return {
    rows: rows.length,
    rowChips: document.querySelectorAll('.mtg-workbench__entry .mtg-workbench__cite').length,
    sharedItems: shared === null ? null : [...shared.querySelectorAll('.mtg-workbench__cite')].map((node) => [
      node.getAttribute('data-resolved'), node.textContent,
    ]),
    sharedAboveRows: shared === null ? null : shared.getBoundingClientRect().bottom <= rows[0].getBoundingClientRect().top,
    chipHeight: chip === null ? null : round(chip.getBoundingClientRect().height),
    citeLists: [...document.querySelectorAll('.mtg-workbench__entry .mtg-workbench__cites')]
      .map((node) => round(node.getBoundingClientRect().height)),
    rowHeight: round(Math.max(...rows.map((node) => node.getBoundingClientRect().height))),
    deckHeight: round(deck.height),
    rowsInView: rows.filter((node) => node.getBoundingClientRect().bottom <= right.bottom).length,
  };
})()`;

interface Reading {
  readonly rows: number;
  readonly rowChips: number;
  readonly sharedItems: readonly (readonly [string | null, string | null])[] | null;
  readonly sharedAboveRows: boolean | null;
  readonly chipHeight: number | null;
  readonly citeLists: readonly number[];
  readonly rowHeight: number;
  readonly deckHeight: number;
  readonly rowsInView: number;
}

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

describe('the workbench states its shared criteria once', () => {
  browserIt(
    'leaves a row only its own citations, at every desktop width',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-workbench-criteria-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-workbench-criteria-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'workbench.html');
      await writeFile(file, page(), 'utf8');
      try {
        for (const { width, height } of VIEWPORTS) {
          const at = `${String(width)}x${String(height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            at,
            '.mtg-workbench__entry',
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no rows`);
          console.log(`${at} ${JSON.stringify({ ...seen, before: ROW_CITATIONS })}`);
          expect(seen.rows, at).toBe(ROWS.length);
          expect(seen.rowChips, at).toBe(OWN_CITATIONS);
          expect(seen.sharedItems, at).toStrictEqual([
            ['true', 'printed in TGR'],
            ['true', 'color identity within {W}'],
            ['true', 'supports the white weenie aggro, go wide archetype'],
            ['true', 'fits the powerful kitchen-table power band'],
          ]);
          expect(seen.sharedAboveRows, at).toBe(true);
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
