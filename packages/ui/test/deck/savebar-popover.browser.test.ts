// @vitest-environment node
/**
 * The saved-decks panel drops over the workspace, and never over the bar it
 * drops out of.
 *
 * `mtg-3ggp.1`. `mtg-i8xl` took the panel out of the flow so a shut disclosure
 * would stop spending a permanent 38px band above a 152px pool scrollport, and
 * anchored it to the savebar -- a flex item of a bar that is already
 * positioned. On a desk that reads correctly, because the savebar is on the
 * bar's only line and `calc(100% + space)` of it is the bottom of the bar.
 *
 * On a phone the bar has wrapped to several lines and the savebar is no longer
 * the last of them, so the same offset lands the panel *inside* the bar.
 * Measured at 390x844 on the Constructed builder with sixty cards in the deck,
 * where the disclosure starts open because the build is worth keeping: the bar
 * ran 414px, the panel opened 133px down inside it, and all five of the bar's
 * controls -- Clear the deck, the two-player button the bar had then, Play this
 * deck, and both halves of the pane switch -- answered `elementFromPoint` with
 * the panel. One press on SAVED DECKS dismissed it, so nothing was unreachable,
 * but the first paint of a phone builder holding a deck was a screen of
 * controls behind a panel nobody had asked for.
 *
 * The anchor is what was wrong, not the positioning: the panel belongs to the
 * bar, so the bar is the containing block. `elementFromPoint` rather than an
 * intersection of rectangles, because what the bead is about is whether a press
 * lands on the control.
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
 * Sixty cards, because that is the state the disclosure opens itself in:
 * `SavedDecksPanel`'s `barOpen` starts true when the build has spells in it.
 * An empty builder never draws the panel at all and cannot fail this.
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Builder</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * What each control on the bar answers when it is pressed in the middle, plus
 * where the panes start with the panel open and with it hidden. The second
 * reading is what keeps the fix from being "put it back in the flow": a panel
 * that pushed the workspace down would move the panes between the two.
 */
const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const bar = document.querySelector('.mtg-builder__bar');
  const panel = document.querySelector('.mtg-savebar__body');
  const panes = document.querySelector('.mtg-builder__panes');
  if (bar === null || panel === null || panes === null) return null;
  const box = (el) => {
    const rect = el.getBoundingClientRect();
    return { top: round(rect.top), bottom: round(rect.bottom), left: round(rect.left), right: round(rect.right), height: round(rect.height) };
  };
  const controls = [];
  for (const el of bar.querySelectorAll('button')) {
    if (panel.contains(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    controls.push({
      label: (el.textContent ?? '').trim().slice(0, 40),
      behindPanel: hit !== null && panel.contains(hit),
    });
  }
  const openTop = round(panes.getBoundingClientRect().top);
  panel.style.display = 'none';
  void document.documentElement.offsetHeight;
  const shutTop = round(panes.getBoundingClientRect().top);
  panel.style.display = '';
  return { bar: box(bar), panel: box(panel), controls, openTop, shutTop };
})()`);

interface Reading {
  readonly bar: { readonly top: number; readonly bottom: number; readonly height: number };
  readonly panel: { readonly top: number; readonly bottom: number; readonly height: number };
  readonly controls: readonly { readonly label: string; readonly behindPanel: boolean }[];
  readonly openTop: number;
  readonly shutTop: number;
}

const SLACK_PX = 0.5;

async function read(width: number, height: number): Promise<Reading> {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-savebar-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-savebar-chrome-'));
  const chrome = await launchChrome(userDataDir);
  const file = join(directory, 'builder.html');
  await writeFile(file, page(), 'utf8');
  try {
    const seen = (await measurePage(
      chrome.client,
      file,
      width,
      height,
      MEASURE,
      `${String(width)}x${String(height)}`,
      '.mtg-builder__bar',
      true,
      { mobile: width < 500, pointer: width < 500 ? 'coarse' : 'fine' },
    )) as unknown as Reading | null;
    if (seen === null) throw new Error('the page drew no builder, or no open saved-decks panel');
    return seen;
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

function covered(seen: Reading): readonly string[] {
  return seen.controls.filter((control) => control.behindPanel).map((control) => control.label);
}

describe('the saved-decks panel and the bar it drops out of', () => {
  browserIt(
    'covers none of the bar at 390x844, where the bar has wrapped to several lines',
    async () => {
      const seen = await read(390, 844);
      expect(seen.controls.length, 'the bar drew no controls to measure').toBeGreaterThan(0);
      expect(covered(seen), 'these controls are behind the saved-decks panel').toEqual([]);
      expect(seen.panel.top, 'the panel opens inside the bar rather than under it').toBeGreaterThanOrEqual(
        seen.bar.bottom - SLACK_PX,
      );
      expect(seen.openTop, 'the panel pushes the workspace down instead of dropping over it').toBeCloseTo(
        seen.shutTop,
        0,
      );
    },
    120_000,
  );

  browserIt(
    'still drops over the workspace at 1440x900, where it always did',
    async () => {
      const seen = await read(1440, 900);
      expect(covered(seen), 'these controls are behind the saved-decks panel').toEqual([]);
      expect(seen.panel.top, 'the panel opens inside the bar rather than under it').toBeGreaterThanOrEqual(
        seen.bar.bottom - SLACK_PX,
      );
      expect(seen.openTop, 'the panel pushes the workspace down instead of dropping over it').toBeCloseTo(
        seen.shutTop,
        0,
      );
    },
    120_000,
  );
});
