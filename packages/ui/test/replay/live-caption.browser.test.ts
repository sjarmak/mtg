// @vitest-environment node
/**
 * The one page title a landscape table keeps drawing, and why it is the one.
 *
 * `mtg-aqxi.21`. `../../src/styles/mobile.ts` stops drawing the page title on
 * every route that draws a table, and the argument is sound wherever it applies:
 * the title is the word over the tab you pressed to get here, the tab is on
 * screen saying it already, and the heading plus its gap is 27px of a 194px mat.
 *
 * The replay caption wears the same class and is not that. It is the frame you
 * are looking at — `Turn 7 · main 1 · Wield the Obliterator` — different every
 * step and printed on no tab anywhere. Hidden, the band it shares drew the note
 * beside it alone, and an opening frame's note is an em dash: measured at
 * 844x390, 19px of table spent on one character. So the band's height was being
 * paid either way and bought nothing.
 *
 * The exemption is marked at the element rather than scoped to the replay route,
 * because what earns it is what the text *is*. This file measures that: the
 * caption is drawn on a landscape phone, the same element with the marker taken
 * off is not, and neither arm is true because the route happens to be replay.
 *
 * jsdom performs no layout, so none of this is measurable there; the harness is
 * `../support/chrome.ts`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';
import { fixtureLog } from './support/log-fixture';

/** A frame with permanents, a hand a side and more game after it. */
const SEQ = '120';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'analysis',
      sub: 'replay',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(ReplayViewer, {
        state: { status: 'ready', log: fixtureLog() },
        route: { mode: 'analysis', sub: 'replay', params: { seq: SEQ } },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Replay caption</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The caption as it ships, then the same element with the marker taken off.
 *
 * Taking the attribute off rather than rendering a second page is what makes
 * this a reading of the rule: one element, one layout, the marker the only thing
 * that changed between the two numbers.
 */
const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const title = document.querySelector('.mtg-page-title');
  const head = document.querySelector('.mtg-page-head');
  const note = document.querySelector('.mtg-page-note');
  const read = () => ({
    live: title === null ? null : title.getAttribute('data-live'),
    title: title === null ? null : round(title.getBoundingClientRect().height),
    titleWidth: title === null ? null : round(title.getBoundingClientRect().width),
    head: head === null ? null : round(head.getBoundingClientRect().height),
    note: note === null ? null : round(note.getBoundingClientRect().height),
  });
  const marked = read();
  title?.removeAttribute('data-live');
  void document.body.getBoundingClientRect();
  const bare = read();
  return {
    text: (title?.textContent ?? '').trim(),
    noteText: (note?.textContent ?? '').trim(),
    marked,
    bare,
  };
})()`);

interface Arm {
  readonly live: string | null;
  readonly title: number | null;
  readonly titleWidth: number | null;
  readonly head: number | null;
  readonly note: number | null;
}

interface Reading {
  readonly text: string;
  readonly noteText: string;
  readonly marked: Arm;
  readonly bare: Arm;
}

/** What `SPOKEN_NOT_DRAWN` leaves in the layout: a 1px box, not nothing. */
const SPOKEN_PX = 1;

/** A phone held sideways, and a laptop window for the arm that is not compacted. */
const SIZES = [
  { width: 844, height: 390, coarse: true, table: true },
  { width: 1440, height: 900, coarse: false, table: false },
] as const;

describe('the replay caption', () => {
  browserIt(
    'is drawn on a landscape phone, and is drawn because it is live',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-live-caption-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-live-caption-chrome-'));
      const file = join(directory, 'replay.html');
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
            '.mtg-replay',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no replay`);

          // It is the frame, said in words: the turn, the step and whose turn it
          // is. A caption that had gone back to being a route name would pass
          // every height assertion below.
          expect(seen.marked.live, `${at}: the caption carries no marker`).toBe('true');
          expect(seen.text, `${at}: the caption does not name the frame`).toMatch(/^Turn \d+ · .+ · .+$/);

          // Drawn, at both sizes, with real width behind it.
          expect(seen.marked.title ?? 0, `${at}: the caption is not drawn`).toBeGreaterThan(0);
          expect(seen.marked.titleWidth ?? 0, `${at}: the caption is drawn as a sliver`).toBeGreaterThan(100);

          if (size.table) {
            // And drawn because of the marker: the same element without it is
            // hidden the way every other page title on a table is. That is
            // `SPOKEN_NOT_DRAWN` and not `display: none`, so what it leaves
            // behind is the 1px box a screen reader still reads.
            expect(
              seen.bare.title ?? -1,
              `${at}: the marker is not what draws the caption`,
            ).toBeLessThanOrEqual(SPOKEN_PX);
            expect(
              seen.bare.titleWidth ?? -1,
              `${at}: the unmarked caption still takes the row's width`,
            ).toBeLessThanOrEqual(SPOKEN_PX);
            // The band it shares is what the rule was spending. Unmarked, the
            // note is all that is left in it, and the note on an opening frame
            // is one character.
            expect(seen.bare.head ?? 0, `${at}: the band went with the caption`).toBeLessThan(
              seen.marked.head ?? 0,
            );
          } else {
            // Off a table nothing is hidden, marker or no marker: the rule is
            // scoped to the routes that draw one.
            expect(seen.bare.title ?? 0, `${at}: a page title is hidden off a table`).toBeGreaterThan(0);
          }
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
