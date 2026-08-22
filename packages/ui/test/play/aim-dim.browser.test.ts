// @vitest-environment node
/**
 * What a card that is not a legal target looks like, measured rather than argued.
 *
 * `mtg-bz2.6` asks for two things about the same moment and only one of them is
 * a fact about the DOM. That a card the spell cannot be aimed at carries no
 * control is asserted in jsdom by `./targeting.test.ts`, which is where legality
 * belongs. That the player can *see* which cards those are is a fact about paint,
 * and the bead is specific about it: *rather than hiding unavailable commands,
 * the interface clearly distinguishes currently legal cards and actions from
 * inactive ones*. So there are three claims here and each one is a comparison
 * rather than a number:
 *
 *  1. **Inside a target choice the inert faces are quieter than the lit ones.**
 *     A rule that failed to match — one combinator wrong, one attribute wrong —
 *     leaves both faces identical, which is exactly the failure a test written
 *     against a threshold would miss on a machine with a different default.
 *  2. **They are quieter and still there.** Zero opacity, `display:none` and a
 *     zero box are all ways of hiding, and hiding is the thing this bead rules
 *     out. Measured as a painted box with something left to paint.
 *  3. **Outside a target choice nothing is dimmed.** The same tree, the same
 *     faces, `aiming` off: the two faces come back to the same opacity. Without
 *     this one a sheet that dimmed every unplayable permanent all the time would
 *     pass the first two, and most of a board is unplayable most of the game.
 *
 * jsdom answers none of it. It performs no layout, so a painted box is zeros
 * there, and its cascade is a weak instrument for a rule three combinators deep
 * — a false green from a selector jsdom silently declines to match is worse than
 * no test. The harness is `../support/chrome.ts`.
 *
 * `Board` directly rather than `PlayView`, because the state being measured is
 * reached by clicking and a statically rendered page has no handlers to click.
 * The component takes `aiming` as a prop and writes it to the mat, so the two
 * pages below are the two states of the real element with the real sheet over
 * them; which permanents `playable` is true of is the wiring that
 * `./targeting.test.ts` measures against a real session.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import type { BoardPermanent } from '../../src/board/Battlefield';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const LIT = 'lit';
const INERT = 'inert';

/**
 * Two creatures across the seam, one of them an answer to the open slot.
 *
 * Two cards rather than one, because every claim here is a comparison: a lone
 * dimmed face proves nothing without the undimmed one beside it under the same
 * sheet, the same viewport and the same row.
 */
const PERMANENTS: readonly BoardPermanent[] = [
  { key: LIT, card: exampleCard('slc-windrider-drake'), playable: true },
  { key: INERT, card: exampleCard('slc-skywatch-sentinel'), playable: false },
];

function page(aiming: boolean): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(Board, {
        aiming,
        opponent: {
          status: { name: 'Bot', life: 20, handCount: 3, libraryCount: null, graveyardCount: null },
          battlefield: {
            label: 'Bot battlefield',
            permanents: PERMANENTS,
            // Present at the zone, so a permanent's own flag is the only thing
            // that decides whether its face becomes a control.
            onSelect: () => undefined,
          },
        },
        you: {
          status: { name: 'You', life: 20, handCount: 3, libraryCount: 30, graveyardCount: 0 },
          battlefield: { label: 'Your battlefield', permanents: [] },
        },
        stack: { entries: [] },
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aim dim</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 1000) / 1000;
  const read = (key) => {
    const face = document.querySelector('[data-permanent-key="' + key + '"] > .mtg-card');
    if (face === null) return null;
    const box = face.getBoundingClientRect();
    const style = getComputedStyle(face);
    return {
      opacity: round(Number(style.opacity)),
      display: style.display,
      visibility: style.visibility,
      area: round(box.width * box.height),
      interactive: face.getAttribute('data-interactive'),
      tag: face.tagName.toLowerCase(),
    };
  };
  return {
    aiming: document.querySelector('.mtg-board').getAttribute('data-aiming'),
    lit: read('${LIT}'),
    inert: read('${INERT}'),
  };
})()`;

interface FaceReading {
  readonly opacity: number;
  readonly display: string;
  readonly visibility: string;
  readonly area: number;
  readonly interactive: string | null;
  readonly tag: string;
}

interface Reading {
  readonly aiming: string;
  readonly lit: FaceReading | null;
  readonly inert: FaceReading | null;
}

function faces(result: Record<string, unknown>): { readonly lit: FaceReading; readonly inert: FaceReading } {
  const reading = result as unknown as Reading;
  if (reading.lit === null || reading.inert === null) {
    throw new Error(`the board drew ${reading.lit === null ? 'no lit face' : 'no inert face'}`);
  }
  return { lit: reading.lit, inert: reading.inert };
}

/** One viewport, because nothing here is a size; the sheet's rule is width-blind. */
const VIEWPORT = [1280, 800] as const;

describe('an illegal target is drawn unavailable rather than drawn away', () => {
  browserIt(
    'dims the faces the spell cannot be aimed at, only while it is being aimed',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-aim-dim-'));
      const aimingFile = join(directory, 'aiming.html');
      const restingFile = join(directory, 'resting.html');
      await writeFile(aimingFile, page(true), 'utf8');
      await writeFile(restingFile, page(false), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const [width, height] = VIEWPORT;
        const aimed = await measurePage(chrome.client, aimingFile, width, height, MEASURE, 'aiming board');
        const resting = await measurePage(
          chrome.client,
          restingFile,
          width,
          height,
          MEASURE,
          'resting board',
        );

        expect(aimed['aiming']).toBe('true');
        expect(resting['aiming']).toBe('false');

        const aiming = faces(aimed);
        const rest = faces(resting);

        // The premise the whole file rests on: the two faces differ in exactly
        // one thing, whether the caller gave them a handler. If they stopped
        // differing there, every comparison below would be comparing a face with
        // itself.
        expect(aiming.lit.interactive, 'the lit face is a control').toBe('true');
        expect(aiming.inert.interactive, 'the inert face is not').not.toBe('true');
        expect(aiming.lit.tag, 'a control is a button').toBe('button');

        // 1. Quieter than the card beside it.
        expect(
          aiming.inert.opacity,
          `inert ${String(aiming.inert.opacity)} against lit ${String(aiming.lit.opacity)}`,
        ).toBeLessThan(aiming.lit.opacity);
        // And the lit one gave up nothing, so the state reads as the rest of the
        // table going quiet rather than the whole table fading.
        expect(aiming.lit.opacity, 'the answer is drawn at full strength').toBe(rest.lit.opacity);

        // 2. Quieter and still on the table.
        expect(aiming.inert.opacity, 'the inert face is still painted').toBeGreaterThan(0);
        expect(aiming.inert.display).not.toBe('none');
        expect(aiming.inert.visibility).toBe('visible');
        expect(aiming.inert.area, 'the inert face still occupies its slot').toBeGreaterThan(0);

        // 3. Nothing is dimmed outside the targeting state, which is what keeps
        // the channel meaning "not a legal target" rather than "not playable".
        expect(rest.inert.opacity, 'an unplayable permanent at rest').toBe(rest.lit.opacity);
      } catch (error) {
        bodyError = error;
      }

      // Cleanup collects rather than throws, and the failure that started it
      // goes first in the list: `./table-allocation.browser.test.ts` settled
      // this shape, and a `finally` that throws would replace the assertion the
      // reader needs with a browser that would not shut down.
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
        throw new AggregateError(
          cleanupErrors,
          `aim dim Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
