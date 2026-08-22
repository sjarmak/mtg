// @vitest-environment node
/**
 * The left column of a landscape phone, which is where both life totals are.
 *
 * The playtester, 2026-08-22, playing a reduced M11 sideways: "the life totals seem
 * cut off and you shouldn't have to scroll on the left side to see available
 * life totals and actions. And just want to make sure we still will be showing
 * the full game board state and not needing scrolling there either."
 *
 * Measured at 844x390 before the fix, with the column open: 550px of content in
 * 372, so 178px of scroll, with your own life number 47.63px under the bottom
 * edge and the prompt clipped to 50px of the 123 it wanted. Shut, the column
 * overflowed 32px down and clipped 6px sideways, because a 59.22px-wide
 * "Priority" tag was being drawn into a 48px strip.
 *
 * `../../src/styles/board/rail.ts` makes the prompt this column's one flexible
 * block and every other block `flex: none`, which is why the deficit landed
 * where it did: the fixed blocks came to 470px on their own, so there was
 * nothing for the flexible one to give and the column scrolled for the rest.
 * The fix is `../../src/styles/mobile.ts`'s, and it is made against the fixed
 * blocks: the facts this column was printing twice stop being drawn on a short
 * table, and the room goes to the moves.
 *
 * What this file holds is her three sentences as properties rather than as the
 * numbers above, at both phone sizes and in both column states: the column does
 * not scroll on either axis, your own life total is inside it, the prompt is not
 * cut off, and the page under all of it does not scroll either. The numbers move
 * when a gap or a type size does; the four sentences do not.
 *
 * **And a tall control at the same width**, because every rule this lane added
 * is inside one `max-height` query and a rig that only visited short viewports
 * could not tell a tier that fires there from one that fires everywhere. Firing
 * everywhere would be a desktop board that has stopped naming its seats.
 *
 * **The browser is told it is a phone.** Under `pointer: coarse` the disclosure
 * and the graveyard heads take `../../src/styles/touch.ts`'s floor, which is
 * most of what this column spends its height on, so a rig on a fine pointer
 * measures a column that fits and reports a squeeze that is not there.
 *
 * The shut state is written onto the markup, for the reason
 * `./landscape-phone.browser.test.ts` gives: it is a preference read at render
 * time and this page is static markup.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h, Fragment } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { TOUCH_TARGET_PX } from '../../src/styles/touch';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** The neutral example set, so this file exports with the rest of the lab. */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
] as const;

/**
 * A mid-game turn with priority parked on the viewer, which is the state the
 * column is fullest in: ten legal moves in the prompt, both graveyards drawn,
 * and the active seat's pod carrying its Active and Priority tags.
 */
function board(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: 4 }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
    ...Array.from({ length: 5 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller,
      tapped: index % 3 === 0,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: 'ui/ask-column-phone',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1], SPELLS[2], LANDS[0], SPELLS[3], LANDS[1], SPELLS[0]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3], LANDS[3], SPELLS[0], SPELLS[1]],
    ],
    active: 0,
    turn: 7,
  });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * The bands the real route draws above the mat, so the column is measured with
 * the leftover of a viewport rather than the whole of one. The same two
 * `./landscape-phone.browser.test.ts` argues for, and for the same reason.
 */
function routeFurniture(): ReactElement {
  return h(
    Fragment,
    null,
    h('h1', { className: 'mtg-page-title' }, 'Play'),
    h(
      'div',
      { className: 'mtg-toolbar', role: 'group', 'aria-label': 'How to play' },
      h(
        'button',
        { type: 'button', className: 'mtg-btn', 'aria-pressed': true, 'data-variant': 'primary' },
        'Preconstructed decks',
      ),
      h('button', { type: 'button', className: 'mtg-btn', 'aria-pressed': false }, 'Open a sealed pool'),
    ),
  );
}

function page(game: GameSession, shut: boolean): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      notice: 'Reduced build: 162 of 249 positions kept.',
      children: h(
        'div',
        { className: 'mtg-play-route' },
        routeFurniture(),
        h(PlayView, {
          session: game,
          viewer: 0,
          names: ['You', 'Bot'],
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      ),
    }),
  );
  if (!shut) return wrap(markup);
  const staged = markup.replace('data-ask="open"', 'data-ask="shut"');
  if (staged === markup) {
    throw new Error('the mat did not carry the ask column open, so the shut state cannot be written onto it');
  }
  return wrap(staged);
}

function wrap(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ask column</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${body}</body></html>`;
}

/**
 * Everything her three sentences are about, read off one layout.
 *
 * `lifeBelow` is signed against the column's own bottom rather than the
 * viewport's, because the column is the scroller: a life total pushed out of it
 * is out of sight whatever the page under it does.
 *
 * The prompt is reported as the pair `[clientHeight, scrollHeight]`, which is
 * the only way to tell a short panel from a cut-off one. It was 50 of 123.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const pods = document.querySelector('.mtg-board__pods');
  if (pods === null) return null;
  const box = pods.getBoundingClientRect();
  const prompt = pods.querySelector('.mtg-prompt');
  const body = pods.querySelector('.mtg-prompt > .mtg-panel__body');
  const lives = [...pods.querySelectorAll('.mtg-pod__life')];
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    overflowY: round(pods.scrollHeight - pods.clientHeight),
    overflowX: round(pods.scrollWidth - pods.clientWidth),
    lifeCount: lives.length,
    lifeBelow: lives.reduce(
      (worst, life) => Math.max(worst, round(life.getBoundingClientRect().bottom - box.bottom)),
      0,
    ),
    lifeAbove: lives.reduce(
      (worst, life) => Math.max(worst, round(box.top - life.getBoundingClientRect().top)),
      0,
    ),
    prompt: prompt === null ? null : [round(prompt.clientHeight), round(prompt.scrollHeight)],
    promptBody: body === null ? null : round(body.getBoundingClientRect().height),
    namesDrawn: [...pods.querySelectorAll('.mtg-pod__name')].filter(
      (name) => name.getBoundingClientRect().height > 0,
    ).length,
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
  };
})()`;

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly overflowY: number;
  readonly overflowX: number;
  readonly lifeCount: number;
  readonly lifeBelow: number;
  readonly lifeAbove: number;
  readonly prompt: readonly number[] | null;
  readonly promptBody: number | null;
  readonly namesDrawn: number;
  readonly pageOverflowY: number;
}

/** An iPhone 14 sideways, which is the narrowest, and a Pro Max, which is not. */
const LANDSCAPE = [
  [844, 390],
  [932, 430],
] as const;

/** Same width, room under it: nothing this lane added may fire here. */
const TALL_CONTROL = [844, 900] as const;

/** Rounding slack, the same half pixel the other board rigs compare on. */
const SLACK_PX = 0.5;

describe('the ask column on a phone held sideways', () => {
  browserIt(
    'holds both life totals and the moves without scrolling, open or shut',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-column-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-ask-column-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const files = new Map<boolean, string>();
      for (const shut of [true, false]) {
        const file = join(directory, shut ? 'shut.html' : 'open.html');
        await writeFile(file, page(board(), shut), 'utf8');
        files.set(shut, file);
      }
      const read = async (shut: boolean, width: number, height: number): Promise<Reading> => {
        const file = files.get(shut);
        if (file === undefined) throw new Error('the page for that state was never written');
        const seen = await measurePage(
          chrome.client,
          file,
          width,
          height,
          MEASURE,
          `${shut ? 'shut' : 'open'} ${String(width)}x${String(height)}`,
          '.mtg-board__pods',
          true,
          { mobile: true, pointer: 'coarse' },
        );
        if (seen === null) throw new Error('the page drew no ask column');
        return seen as unknown as Reading;
      };
      try {
        for (const [width, height] of LANDSCAPE) {
          const at = `${String(width)}x${String(height)}`;
          for (const shut of [true, false]) {
            const seen = await read(shut, width, height);
            const state = `${shut ? 'shut' : 'open'} at ${at}`;
            expect(seen.coarse, `${state}: the rig is emulating a finger`).toBe(true);

            // "you shouldn't have to scroll on the left side". Both axes: the
            // shut strip clipped 6px sideways, which is a different defect from
            // the 178 it scrolled down and had a different cause.
            expect(seen.overflowY, `${state}: the column scrolls down`).toBeLessThanOrEqual(SLACK_PX);
            expect(seen.overflowX, `${state}: the column clips sideways`).toBeLessThanOrEqual(SLACK_PX);

            // "the life totals seem cut off". Both of them, both edges: this
            // column scrolls, so a total pushed off the top is as gone as one
            // pushed off the bottom.
            expect(seen.lifeCount, `${state}: both seats print a life total`).toBe(2);
            expect(seen.lifeBelow, `${state}: a life total is under the column`).toBeLessThanOrEqual(
              SLACK_PX,
            );
            expect(seen.lifeAbove, `${state}: a life total is above the column`).toBeLessThanOrEqual(
              SLACK_PX,
            );

            // "and not needing scrolling there either" — the page carrying the
            // mat, which is what the column was stealing height from.
            expect(seen.pageOverflowY, `${state}: the page scrolls`).toBeLessThanOrEqual(SLACK_PX);
          }

          // "to see available ... actions". Shut, the prompt is not drawn and
          // Pass is the whole of the column's actions; open, the panel has to
          // hold what it says it holds and leave a fingertip of moves under it.
          const open = await read(false, width, height);
          const prompt = open.prompt;
          const body = open.promptBody;
          if (prompt === null || body === null) throw new Error('the open column drew no prompt');
          expect(prompt[1] ?? 0, `open at ${at}: the prompt is cut off`).toBeLessThanOrEqual(
            (prompt[0] ?? 0) + SLACK_PX,
          );
          expect(body, `open at ${at}: no whole move fits in the panel`).toBeGreaterThanOrEqual(
            TOUCH_TARGET_PX,
          );
        }

        // And the height gate. Every rule above is inside one `max-height`
        // query; the seat name is the cheapest witness that it stayed there,
        // because a desktop board that has stopped naming its seats is what
        // these rules escaping would look like.
        const tall = await read(false, TALL_CONTROL[0], TALL_CONTROL[1]);
        expect(tall.namesDrawn, 'a tall table still names both seats').toBe(2);
        const short = await read(false, LANDSCAPE[0][0], LANDSCAPE[0][1]);
        expect(short.namesDrawn, 'a short table names neither, and the graveyard heads do').toBe(0);
      } catch (error) {
        throw new Error(reason(error));
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
