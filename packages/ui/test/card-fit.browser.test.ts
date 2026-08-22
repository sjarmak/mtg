// @vitest-environment node
/**
 * The rules-box fit ladder against a real layout: no full face clips its rules
 * text, and the estimate never promises more room than the browser gives.
 *
 * `mtg-krku`. `src/card/anatomy.ts`'s ladder is arithmetic because jsdom lays
 * nothing out, and arithmetic about a layout drifts from the layout silently:
 * `../test/card-fit.test.ts` can hold the estimate to cases written out by hand
 * but every one of those cases is another number in the same model, so a model
 * that is wrong in *shape* passes all of them. It was wrong twice — a column of
 * 42 characters, then 38 — and both times the unit suite stayed green while the
 * set's wordiest face lost its last line off the bottom of the box. The only
 * coverage that could have caught either is a browser, and until this file there
 * was none: `../tools/face-census.ts` renders the same page and prints the same
 * numbers, but it is a tool a person runs, not a gate CI fails.
 *
 * **What is measured.** The flagship gallery at two viewports: once as it ships,
 * and once per rung of `RULES_FIT_STEPS` with every rules box forced to that
 * rung. Per box: the rung on it, the number of drawn blocks, the client and
 * scroll heights, and the rendered content height as the distance from the first
 * block's top to the last block's bottom, which includes the sheet's own
 * paragraph margins exactly.
 *
 * **A rung is forced in the markup, not by a script setting `data-fit`,** and
 * that is not a style preference. `measurePage` emulates
 * `prefers-reduced-motion` so a transition can never decide a box, and under
 * emulated media this chrome-headless-shell does not invalidate an attribute
 * selector when the attribute changes: the initial render is correct at every
 * rung, and a box moved from `data-fit="0"` to `data-fit="1"` afterwards keeps
 * its 13px font through a forced reflow, a class toggle and a `getComputedStyle`
 * — only replacing the node picks the new rule up. A script-driven rung would
 * therefore have measured the same layout four times and called the agreement a
 * pass. The page is rendered at the rung instead, which is also the page as it
 * would ship at that rung.
 *
 * **What is asserted.**
 *
 * 1. Nothing clips on the page as it ships. `.mtg-card__text` is
 *    `overflow-y: clip`, so `scrollHeight` over `clientHeight` is a glyph sliced
 *    off the bottom, and there must be none. The rung each face is drawn at is
 *    read back off the box and held to `rulesFitStep`, so a green run cannot be
 *    a run in which the renderer and the ladder had stopped agreeing.
 * 2. The estimate is never under the browser, at *any* rung. `textBoxCost` is
 *    an upper bound on the height of what a face draws; a run where it comes in
 *    under a rendered height is a run where the bound is not a bound, and that
 *    is the defect itself rather than a symptom of it.
 * 3. The box is one box. Every full face's rules box reads back the same client
 *    width and the same client height, at both viewports. The whole ladder is
 *    arithmetic against a single box, and a face whose box is a different size
 *    is a face the arithmetic is not about.
 * 4. Floors, so a green run is a run that measured something: every face is
 *    found at every rung, blocks are drawn in quantity, every rung of the
 *    ladder is seen in a browser, and both paragraph margins are exercised — a
 *    multi-block box and a flavor block. The rung floor is met by the forced
 *    pages rather than by the set, so it stays a statement about the run.
 *
 * **No literal constant is asserted anywhere here.** A test that pinned the
 * column or the budget to a number would go red on the fix and green on the
 * bug, which is backwards. What is held is the property the numbers exist to
 * produce.
 *
 * The flagship rather than the example set, because the property is about the
 * wordiest card a generator produced and no hand-written fixture is that card.
 * Its faces are named only by what the page reports: no card name or id is
 * written in this file, so `@mtg/ui` stays a package whose tests name no
 * private card while its failures still say which face failed.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASIC_LANDS, parseCards } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../src/app/Shell';
import { RULES_FIT_STEPS, rulesFitStep, textBoxBlocks, textBoxCost } from '../src/card/anatomy';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from './support/chrome';

const FLAGSHIP = new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url);

function flagship(): readonly DslCard[] {
  const document: unknown = JSON.parse(readFileSync(FLAGSHIP, 'utf8'));
  if (typeof document !== 'object' || document === null || !('cards' in document)) {
    throw new Error('the flagship fixture is not a set document');
  }
  const { cards } = document as { readonly cards: unknown };
  if (!Array.isArray(cards)) throw new Error('the flagship fixture has no cards array');
  return parseCards(cards);
}

/** Every face the lab draws for the flagship: its cards, and the basics it is played with. */
const FACES: readonly DslCard[] = [...flagship(), ...BASIC_LANDS];
const BY_ID: ReadonlyMap<string, DslCard> = new Map(FACES.map((card) => [card.id, card]));

const GALLERY_FACE = ".mtg-gallery > .mtg-card[data-size='full']";

/**
 * The one attribute a rules box publishes its rung on, as the renderer writes
 * it. `Card.ts` sets `data-region` and then `data-fit` on `.mtg-card__text` and
 * nothing else on a face carries that pair, so this matches every rules box and
 * no type line or name — both of which have a `data-fit` of their own.
 */
const RULES_FIT_ATTRIBUTE = /(data-region="rules" data-fit=")\d+(")/g;

/**
 * The gallery, either as it ships or with every rules box forced to one rung.
 *
 * The rewrite is counted and the count is checked against the faces, because a
 * regular expression that silently matched nothing would hand every rung the
 * same page and the run would agree with itself.
 */
function pageHtml(step: number | null): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      children: h(CardsRoute, {
        cards: FACES,
        route: { mode: 'cards', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  let body = markup;
  if (step !== null) {
    let forced = 0;
    body = markup.replace(RULES_FIT_ATTRIBUTE, (_match, head: string, tail: string) => {
      forced += 1;
      return `${head}${String(step)}${tail}`;
    });
    if (forced < FACES.length) {
      throw new Error(
        `the gallery published ${String(forced)} rules boxes, fewer than its ${String(FACES.length)} faces`,
      );
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rules box fit</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${body}</body></html>`;
}

/**
 * Half a pixel, and it is rounding rather than tolerance. `clientHeight` and
 * `scrollHeight` are integers rounded from a fractional layout, and the
 * estimate's line box is a rounded copy of the sheet's `13px * 1.45`, so a
 * six-line paragraph can read a hundredth of a pixel either way. Every error
 * this file exists to catch is a whole wrapped line, which is fourteen pixels
 * at the smallest rung.
 */
const EPS = 0.5;

/**
 * One read of every full face's rules box. It mutates nothing — the rung the
 * box is at is the rung the page was written at.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const faces = [];
  for (const card of document.querySelectorAll(${JSON.stringify(GALLERY_FACE)})) {
    const box = card.querySelector('.mtg-card__text');
    if (box === null) continue;
    const published = box.getAttribute('data-fit');
    const rects = [...box.querySelectorAll('.mtg-card__line')].map((line) => line.getBoundingClientRect());
    const first = rects[0];
    const last = rects[rects.length - 1];
    faces.push({
      id: card.getAttribute('data-card-id'),
      published: published === null ? -1 : Number(published),
      blocks: rects.length,
      lineHeight: round(parseFloat(getComputedStyle(box).lineHeight)),
      clientWidth: box.clientWidth,
      clientHeight: box.clientHeight,
      scrollHeight: box.scrollHeight,
      content: first === undefined || last === undefined ? 0 : round(last.bottom - first.top),
    });
  }
  return {
    viewport: [window.innerWidth, window.innerHeight],
    gallery: document.querySelectorAll('.mtg-gallery > .mtg-card').length,
    faces: faces,
  };
})()`;

interface FaceReading {
  readonly id: string | null;
  readonly published: number;
  readonly blocks: number;
  readonly lineHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly content: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly gallery: number;
  readonly faces: readonly FaceReading[];
}

const VIEWPORTS = [
  [1280, 800],
  [1440, 900],
] as const;

/** Blocks drawn over the whole run, under which the run measured nothing worth measuring. */
const MIN_BLOCKS = 400;

describe('the rules box a browser draws', () => {
  browserIt(
    'clips no face, and is never taller than the estimate said, at every rung',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-card-fit-'));
      // The page as it ships, then one page per rung with every rules box
      // written at that rung. `null` is the shipped one and is the only page the
      // clip assertion is made on, because it is the only one whose rungs are
      // the ladder's own.
      const rungs: readonly (number | null)[] = [null, ...RULES_FIT_STEPS.keys()];
      const pages: { readonly rung: number | null; readonly file: string }[] = [];
      for (const rung of rungs) {
        const file = join(directory, `${rung === null ? 'shipped' : `rung-${String(rung)}`}.html`);
        await writeFile(file, pageHtml(rung), 'utf8');
        pages.push({ rung, file });
      }

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      let blocksDrawn = 0;
      const rungsMeasured = new Set<number>();
      let multiBlock = 0;
      let flavored = 0;
      const geometry = new Set<string>();
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          for (const { rung, file } of pages) {
            const at = rung === null ? 'the shipped page' : `rung ${String(rung)}`;
            const where = `${at} at ${String(width)}x${String(height)}`;
            const reading = (await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              where,
              GALLERY_FACE,
            )) as unknown as Reading;
            expect(reading.viewport, where).toEqual([width, height]);
            expect(reading.faces.length, `${where}: full faces measured`).toBe(FACES.length);

            const clipped: string[] = [];
            const under: string[] = [];
            for (const face of reading.faces) {
              const card = BY_ID.get(face.id ?? '');
              if (card === undefined)
                throw new Error(`${where}: the gallery drew an unknown face ${String(face.id)}`);
              // On the shipped page this is the renderer and the ladder being
              // the same decision; on a forced page it is the rewrite having
              // taken, so neither run can measure a box nothing sized.
              const step = rung ?? rulesFitStep(card);
              expect(face.published, `${where}: the box is at a rung nothing in this run chose`).toBe(step);
              expect(face.blocks, `${where}: the box drew a block count the composition did not`).toBe(
                textBoxBlocks(card).length,
              );
              geometry.add(`${String(face.clientWidth)}x${String(face.clientHeight)}`);
              blocksDrawn += face.blocks;
              if (face.blocks === 0) continue;
              if (face.blocks > 1) multiBlock += 1;
              if (textBoxBlocks(card).some((block) => block.kind === 'flavor')) flavored += 1;
              rungsMeasured.add(face.published);

              const estimate = textBoxCost(card, step);
              if (estimate < face.content - EPS) {
                under.push(
                  `${String(face.id)}: estimated ${estimate.toFixed(2)}px, rendered ${face.content.toFixed(2)}px over ${String(face.blocks)} blocks at a ${String(face.lineHeight)}px line`,
                );
              }
              if (rung === null && face.scrollHeight > face.clientHeight + EPS) {
                clipped.push(
                  `${String(face.id)}: ${String(face.scrollHeight)}px of content in a ${String(face.clientHeight)}px box`,
                );
              }
            }
            // The cut faces first, because that is the failure a reader sees
            // and the under-estimates are why it happened: a run that has both
            // should say which cards lost a line before it says which numbers
            // were wrong.
            expect(
              clipped,
              `${where}: ${String(clipped.length)} rules boxes were cut at the rung the ladder set them at: ${clipped.slice(0, 5).join(' | ')}`,
            ).toEqual([]);
            expect(
              under,
              `${where}: the estimate came in under the browser on ${String(under.length)} faces: ${under.slice(0, 5).join(' | ')}`,
            ).toEqual([]);
            console.log(
              `${where}: ${String(reading.faces.length)} faces, ${String(reading.gallery)} in the gallery, no clip, no under-estimate`,
            );
          }
        }
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove Chrome fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        // The reasons go in the message as well as in `errors`, because the
        // runner prints an AggregateError's own message and not its parts, and
        // a gate whose failure says only that it failed is half a gate.
        //
        // The headline counts rather than diagnoses. Three different things
        // land in this list — an assertion that measured the box and found it
        // wrong, a rig failure that never reached one, and a Chrome that would
        // not shut down afterwards — and a headline that picks one of them is
        // wrong two ways out of three. It said "the rules box was not measured"
        // and printed an under-estimate on two named faces underneath it.
        throw new AggregateError(
          cleanupErrors,
          `the rules box gate failed on ${String(cleanupErrors.length)} count(s):\n${cleanupErrors.map((error) => error.message).join('\n')}`,
        );
      }

      // One box, or the arithmetic is not about the box that was drawn.
      expect([...geometry], 'full faces drew rules boxes of more than one size').toHaveLength(1);
      expect(blocksDrawn, 'the run drew almost no rules text').toBeGreaterThanOrEqual(MIN_BLOCKS);
      // Every rung and both paragraph margins, so a green run cannot be a run
      // in which nothing shrank and every box held one line. The rungs are a
      // property of the run rather than of the set: the forced pages measure
      // all four whether or not the committed set happens to use them, which
      // is what keeps this floor from being a statement about a fixture.
      expect(
        [...rungsMeasured].sort((left, right) => left - right),
        'a rung of the ladder was never drawn in a browser',
      ).toEqual(RULES_FIT_STEPS.map((_, step) => step));
      expect(multiBlock, 'no box drew a second block, so no paragraph margin was measured').toBeGreaterThan(
        0,
      );
      expect(
        flavored,
        'no box drew a flavor block, so the wider flavor margin was never measured',
      ).toBeGreaterThan(0);
    },
    120_000,
  );
});
