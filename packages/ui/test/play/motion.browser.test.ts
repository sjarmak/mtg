// @vitest-environment node
/**
 * The mark, measured on a real board: it is seen, and it moves nothing.
 *
 * jsdom lays nothing out and runs no animation, so the two properties this lane
 * had to promise are both unaskable there. They are asked here, in
 * chrome-headless-shell, against the shipped markup and the shipped sheet, on a
 * played table with eleven permanents on it.
 *
 * **It moves nothing.** `styles/board/slot.ts` pairs `aspect-ratio` with
 * `min-height: 0` so every face on the board is one height, and
 * `styles/board/arrival.ts` records what happens to that pair the moment an
 * animation touches a length. The mark is a `box-shadow`, which paints outside
 * the border box and takes no space — so every card's box is the same number
 * before and after the whole board is marked, to the pixel.
 *
 * **It is seen, and only by a viewer who did not ask otherwise.** The same page
 * is measured twice, under `prefers-reduced-motion: no-preference` and under
 * `reduce`. The first must actually run the animation the sheet declares; the
 * second must run *nothing at all* — not a fast version, which is what
 * `styles/base.ts`'s 1ms clamp would leave, and one frame of a rising ring is a
 * flash rather than a reduction. That is the hard requirement of this lane, and
 * it is the reason `measurePage` grew a `reducedMotion` argument: a page always
 * measured under `reduce` can only ever report that nothing moved, which would
 * have made the passing half of this assertion worthless.
 *
 * The marks are applied here rather than by playing a turn, because what is
 * being measured is the sheet's response to the attribute. That the attribute
 * arrives on the right card at the right moment is `motion-runner.test.ts`, and
 * that the right cue exists at all is `motion-plan.test.ts`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

/** A quiet mid-game table: both seats have a board, nobody is being asked anything. */
function board(): GameSession {
  const permanents = (
    controller: PlayerId,
    count: number,
  ): readonly {
    card: (typeof SPELLS)[number];
    controller: PlayerId;
    tapped: boolean;
    summoningSick: boolean;
  }[] =>
    Array.from({ length: count }, (_unused, index) => ({
      card: (index % 3 === 2 ? LANDS[index % LANDS.length] : SPELLS[index % SPELLS.length]) ?? SPELLS[0],
      controller,
      tapped: index % 4 === 3,
      summoningSick: false,
    }));
  const built = scenario({
    seed: 'ui/motion',
    battlefield: [...permanents(0, 6), ...permanents(1, 5)],
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[2], SPELLS[3]],
    ],
    step: 'precombatMain',
    active: 0,
    turn: 8,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function page(game: GameSession): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Motion</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Measure every play face, mark the whole board, measure again, and report what
 * the browser is actually running.
 *
 * The second read happens after `getBoundingClientRect`, which flushes layout,
 * so a mark that reflowed anything would show up as a different number rather
 * than as a stale one.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const faces = () => [...document.querySelectorAll(".mtg-slot[data-slot='play']")];
  const boxes = () => faces().map((slot) => {
    const box = slot.getBoundingClientRect();
    return [round(box.x), round(box.y), round(box.width), round(box.height)];
  });
  const before = boxes();
  const mat = document.querySelector('.mtg-board');
  if (mat !== null) mat.setAttribute('data-motion', 'on');
  for (const slot of faces()) slot.setAttribute('data-motion-mark', 'damage');
  const after = boxes();
  // By name rather than by subject: a marked slot also holds the page's own
  // transitions, and every one of them is still an animation object under the
  // reduce query (base.ts clamps them to 1ms, it does not remove them). The
  // claim is about this keyframe set and no other.
  const running = document.getAnimations().filter(
    (animation) => animation.animationName === 'mtg-motion-mark',
  );
  const marked = faces()[0];
  const painted = marked === undefined ? null : marked.querySelector('.mtg-card');
  return {
    slots: before.length,
    before,
    after,
    running: running.length,
    durations: [...new Set(running.map((animation) => Math.round(animation.effect.getTiming().duration)))],
    animationName: painted === null ? null : getComputedStyle(painted).animationName,
    shadow: painted === null ? null : getComputedStyle(painted).boxShadow,
  };
})()`;

const VIEWPORT = [1440, 900] as const;

interface Reading {
  readonly slots: number;
  readonly before: readonly (readonly number[])[];
  readonly after: readonly (readonly number[])[];
  readonly running: number;
  readonly durations: readonly number[];
  readonly animationName: string | null;
}

function readingOf(result: Record<string, unknown>): Reading {
  return result as unknown as Reading;
}

describe('a permanent being marked in place', () => {
  browserIt(
    'is drawn for a viewer who wants motion, is not drawn for one who does not, and moves no card either way',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-motion-'));
      const file = join(directory, 'board.html');
      await writeFile(file, page(board()), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const [width, height] = VIEWPORT;
        const moving = readingOf(
          await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            'motion',
            ".mtg-slot[data-slot='play'] > .mtg-card",
            false,
          ),
        );
        const still = readingOf(
          await measurePage(chrome.client, file, width, height, MEASURE, 'motion (reduced)'),
        );

        expect(moving.slots, 'the table drew a board to mark').toBeGreaterThan(8);
        expect(still.slots).toBe(moving.slots);

        // Seen: every marked face is animating, and for the duration the timing
        // file names rather than the browser's own default.
        expect(moving.running, 'marked faces animating').toBe(moving.slots);
        expect(moving.durations).toEqual([180]);
        expect(moving.animationName).toBe('mtg-motion-mark');

        // Not seen, and not merely hurried: nothing is running at all.
        expect(still.running, 'animations under prefers-reduced-motion: reduce').toBe(0);
        expect(still.animationName).toBe('none');

        // And the table is the same table, marked or not, either way.
        expect(moving.after, 'boxes moved when the board was marked').toEqual(moving.before);
        expect(still.after).toEqual(still.before);
        expect(still.before, 'reduced motion changed the layout').toEqual(moving.before);
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
        throw new AggregateError(
          cleanupErrors,
          `motion Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    90_000,
  );
});
