// @vitest-environment node
/**
 * A phone held sideways, measured at the four sizes phones are.
 *
 * `mtg-l4w0`. A landscape phone is about 844 CSS px wide and 390 tall with the
 * browser's own chrome off it, and 844 is a desktop width by every rule the
 * table had: `styles/board/mat.ts`'s two-column fallback stops at 900px and
 * `styles/board/fit.ts` out-specifies it on this route anyway, so the board drew
 * three columns and spent 272 of the 844 on the game log. What was left went
 * to a step bar that wrapped to two rows and a hand whose last 10.6px were under
 * the fold. Both battlefield rows sat on the 4.5rem floor `fit.ts` stops
 * donating at, and the equal split of a *deficit* is not an equal split: the
 * near band carries the step bar and the hand as blocks that cannot give, so its
 * whole shrink landed on the one row it plays out of. Measured before the fix,
 * yours against the opponent's: 59.6 to 104.8 at 844x390, and 30.7 to 102.7 at
 * 932x430. Your own board was 29% of theirs on the larger phone.
 *
 * What this file holds is the four properties that fix bought, at every size a
 * phone comes in, and it holds them as properties rather than as the numbers
 * above: the table fits in the viewport, the hand is on it, the viewer's own row
 * is not the smaller of the two, and none of that was paid for with a control
 * under the touch floor. The numbers move when a face or a gap does; the four
 * sentences do not.
 *
 * **The height gate is measured too**, at the same width with room under it.
 * Every rule this lane added is inside one `max-height` query, so a rig that
 * only visited short viewports could not tell a tier that fires there from one
 * that fires everywhere — and firing everywhere is a 3.5rem hand cap on a
 * 27-inch display.
 *
 * **The browser is told it is a phone**, not merely shown a phone-sized window.
 * Under `pointer: coarse` a step node is 44px tall because that is the touch
 * floor rather than because of its type, so a rig on a fine pointer measures a
 * bar 44px shorter than the device draws and reports a squeeze that is not
 * there. `../support/chrome.ts` takes the device as an argument for this file.
 *
 * **The shut column is written onto the markup**, which is what
 * `./rail-collapse-board.browser.test.ts` does and why: the state is a
 * preference read at render time and this page is static markup. That the
 * preference *defaults* to shut on a table this size is a different claim in a
 * different place, `./side-panel.test.ts`, where it can be made without a
 * browser.
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
import { SHORT_TABLE_SPELLS_MIN_REM } from '../../src/styles/board/fit';
import { COMBAT_HAND_FACE_MAX_REM } from '../../src/styles/board/hand';
import { PLAY_ASK_SHUT_REM } from '../../src/styles/board/rail';
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
 * The measured median board of a mid-game turn: four spells and five lands a
 * side, and on request a crowded one instead.
 *
 * Eight is the count `../../src/styles/board/hand.ts` reads. It lowers the hand
 * face there, and lowering it is a compound selector, which outranks the bare
 * one the landscape tier writes; a board that never reaches eight cannot tell
 * the difference.
 */
function board(spells = 4): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: spells }, (_unused, index) => ({
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
    seed: 'ui/landscape-phone',
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
 * The page furniture the real route draws above the mat: a bare `PlayView` gets
 * the whole viewport rather than the leftover of one, and on a 390px-tall window
 * the leftover is the entire subject.
 *
 * Two elements, and they are the two `mtg-my14` measured on the route rather
 * than on a reproduction of it. `packages/slice/test/ui-phone-scroll.browser.test.ts`
 * plays a real hotseat game through Vite at this size and reads a 57px shell bar
 * and a 44px dealer strip above a 273px mat, and it now asserts exactly that
 * list, so this reproduction has something to be wrong against.
 *
 * It used to draw a third: a standalone `.mtg-badge` carrying the turn, which
 * this route does not have. `../../src/routes/play/toolbar.ts` renders that badge
 * only when the step bar is absent, because the turn text otherwise lives in the
 * bar's head, and the bar is drawn here. The rig was spending 44px of a 390px
 * screen on furniture the player never sees, which made every mat measurement
 * below pessimistic by a fifth.
 *
 * The heading stays, and stays rendered rather than removed: the landscape tier
 * hides it with the recipe `../../src/styles/base.ts` uses for a live region, so
 * a rig that dropped the element could not tell that rule from a broken one.
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

function page(game: GameSession): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      // The third band, and the one she named. A reduced reference set draws it
      // (`src/lab/reduced-notice.ts`); the flagship does not, so the rig states
      // the worse of the two cases.
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
  const staged = markup
    .replace('data-rail="open"', 'data-rail="shut"')
    .replace('data-ask="open"', 'data-ask="shut"');
  if (staged === markup || staged.includes('="open"')) {
    throw new Error('the mat did not carry both columns open, so the shut state cannot be written onto it');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Landscape phone</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${staged}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const fold = document.documentElement.clientHeight;
  const rowHeight = (seat) => {
    const row = document.querySelector("[data-seat='" + seat + "'] .mtg-board__spells");
    return row === null ? null : round(row.getBoundingClientRect().height);
  };
  const faces = (seat) => [...document.querySelectorAll(
    "[data-seat='" + seat + "'] .mtg-board__spells .mtg-slot[data-slot='play'] > .mtg-card"
  )].map((face) => round(face.getBoundingClientRect().width));
  // The mana base, read against the lane it belongs to rather than against the
  // window: the page can fit and the band still be past the bottom of its own
  // scrolling body, which is exactly the shape the 2026-08-22 report had.
  const bandOf = (seat) => {
    const side = document.querySelector(".mtg-board__side[data-seat='" + seat + "']");
    const body = side === null ? null : side.querySelector(".mtg-zone__body[data-layout='board']");
    const band = side === null ? null : side.querySelector('.mtg-lands');
    if (body === null || band === null) return null;
    const box = band.getBoundingClientRect();
    return {
      belowBody: round(box.bottom - body.getBoundingClientRect().bottom),
      belowFold: round(Math.max(0, box.bottom - fold)),
      tiles: band.children.length,
      position: getComputedStyle(band).position,
    };
  };
  const hand = document.querySelector(".mtg-board__side[data-seat='you'] .mtg-zone[data-tone='rail']");
  const rail = document.querySelector('.mtg-board__rail');
  const steps = document.querySelector('.mtg-phasebar__steps');
  const nodes = [...document.querySelectorAll('.mtg-phasebar__node')].map((node) =>
    round(node.getBoundingClientRect().height),
  );
  const mat = document.querySelector('.mtg-board');
  // Sorted, then compared position by position: the two seats hold the same
  // cards in the same tapped states, so the deficit between the sorted lists is
  // the deficit between like and like. A min-against-max comparison would read
  // an untapped land against a tapped creature, whose rotated box is wider.
  const near = faces('you').sort((a, b) => b - a);
  const far = faces('opponent').sort((a, b) => b - a);
  const paired = Math.min(near.length, far.length);
  let deficit = 0;
  for (let index = 0; index < paired; index += 1) deficit = Math.max(deficit, far[index] - near[index]);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    handCap: mat === null ? null : getComputedStyle(mat).getPropertyValue('--hand-face-cap').trim(),
    railWidth: rail === null ? null : round(rail.getBoundingClientRect().width),
    stepsHeight: steps === null ? null : round(steps.getBoundingClientRect().height),
    nodeCount: nodes.length,
    tallestNode: nodes.length === 0 ? null : Math.max(...nodes),
    shortestNode: nodes.length === 0 ? null : Math.min(...nodes),
    nearRow: rowHeight('you'),
    farRow: rowHeight('opponent'),
    faceCount: [near.length, far.length],
    faceDeficit: paired === 0 ? null : round(deficit),
    matHeight: mat === null ? null : round(mat.getBoundingClientRect().height),
    askWidth: (() => {
      const pods = document.querySelector('.mtg-board__pods');
      return pods === null ? null : round(pods.getBoundingClientRect().width);
    })(),
    // Every band the shell and the route can draw above the mat, by the height
    // each one actually takes. A rule that stopped firing would read here as a
    // number, and a band the route stopped rendering would read as a missing
    // selector rather than as a pass.
    furniture: ['.mtg-shell__bar', '.mtg-shell__notice', '.mtg-toolbar'].map((selector) => {
      const found = document.querySelector(selector);
      return [selector, found === null ? null : round(found.getBoundingClientRect().height)];
    }),
    titleHeight: (() => {
      const title = document.querySelector('.mtg-page-title');
      return title === null ? null : round(title.getBoundingClientRect().height);
    })(),
    nearBand: bandOf('you'),
    farBand: bandOf('opponent'),
    spellsFloor: (() => {
      const row = document.querySelector('.mtg-board__spells');
      return row === null ? null : getComputedStyle(row).minHeight;
    })(),
    handBelowFold: hand === null ? null : round(Math.max(0, hand.getBoundingClientRect().bottom - fold)),
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
  };
})()`;

interface Band {
  readonly belowBody: number;
  readonly belowFold: number;
  readonly tiles: number;
  readonly position: string;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly handCap: string | null;
  readonly railWidth: number | null;
  readonly stepsHeight: number | null;
  readonly nodeCount: number;
  readonly tallestNode: number | null;
  readonly shortestNode: number | null;
  readonly nearRow: number | null;
  readonly farRow: number | null;
  readonly faceCount: readonly number[];
  readonly faceDeficit: number | null;
  readonly matHeight: number | null;
  readonly askWidth: number | null;
  readonly furniture: readonly (readonly [string, number | null])[];
  readonly titleHeight: number | null;
  readonly nearBand: Band | null;
  readonly farBand: Band | null;
  readonly spellsFloor: string | null;
  readonly handBelowFold: number | null;
  readonly pageOverflowY: number;
}

/**
 * The four sizes, and one control at the same width with room under it.
 *
 * 844x390 is an iPhone 14 sideways and the narrowest of them; 932x430 is a Pro
 * Max and is where the inversion was worst, because a wider mat spends more of
 * its extra width on the hand row that will not shrink. 844x900 is the control:
 * same width, so nothing width-gated can change, and 900px of height, so nothing
 * this lane added applies.
 */
const LANDSCAPE = [
  [844, 390],
  [852, 393],
  [892, 412],
  [932, 430],
] as const;
const TALL_CONTROL = [844, 900] as const;

/** Rounding slack, the same half pixel the other board rigs compare on. */
const SLACK_PX = 0.5;

describe('a phone held sideways draws a table that fits on it', () => {
  browserIt(
    'fits the mat, keeps the hand on screen, and never draws the viewer the smaller row',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-landscape-phone-'));
      const file = join(directory, 'board.html');
      await writeFile(file, page(board()), 'utf8');
      const crowded = join(directory, 'crowded.html');
      await writeFile(crowded, page(board(8)), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const at = async (width: number, height: number, of = file): Promise<Reading> =>
          (await measurePage(
            chrome!.client,
            of,
            width,
            height,
            MEASURE,
            'landscape phone',
            ".mtg-slot[data-slot='play'] > .mtg-card",
            true,
            { mobile: true, pointer: 'coarse' },
          )) as unknown as Reading;

        for (const [width, height] of LANDSCAPE) {
          const reading = await at(width, height);
          const where = `${String(width)}x${String(height)}`;
          console.log(
            `${where}: bands ${String(reading.nearBand?.belowBody)}/${String(reading.farBand?.belowBody)} floor ${String(reading.spellsFloor)}, rail ${String(reading.railWidth)}, steps ${String(reading.stepsHeight)} over ${String(reading.nodeCount)} nodes of ${String(reading.tallestNode)}, rows ${String(reading.nearRow)}/${String(reading.farRow)}, face deficit ${String(reading.faceDeficit)} over ${JSON.stringify(reading.faceCount)}, mat ${String(reading.matHeight)}, title ${String(reading.titleHeight)}, hand below fold ${String(reading.handBelowFold)}, cap ${String(reading.handCap)}`,
          );

          // The rig is measuring a phone, not a small desktop. Every claim below
          // is about a 44px control, and on a fine pointer there isn't one.
          expect(reading.coarse, `${where}: the browser was not told it was a touch device`).toBe(true);

          // 1. The table fits. It is one screen or it is a scroll on a device
          //    whose whole screen is one screen.
          expect(reading.pageOverflowY, `${where}: the page scrolls`).toBe(0);

          // 2. And the hand is on it. 10.6px of the row were under the fold at
          //    844x390, which is a held card you cannot read the bottom of.
          expect(reading.handBelowFold, `${where}: the hand row runs under the fold`).toBe(0);

          // 3. Neither seat's row, nor either seat's face, comes out smaller for
          //    the player deciding from it.
          expect(
            reading.nearRow ?? 0,
            `${where}: the viewer's battlefield row is shorter than the opponent's`,
          ).toBeGreaterThanOrEqual((reading.farRow ?? 0) - SLACK_PX);
          expect(reading.faceCount[0], `${where}: no near-seat faces measured`).toBeGreaterThan(0);
          expect(
            reading.faceCount[0],
            `${where}: the two seats drew a different number of permanents, so nothing pairs`,
          ).toBe(reading.faceCount[1]);
          expect(
            reading.faceDeficit ?? 0,
            `${where}: the viewer's own face is narrower than the opponent's`,
          ).toBeLessThanOrEqual(SLACK_PX);

          // 4. The step bar is one row of controls, and they are still controls:
          //    `nowrap` alone would have bought the row by ellipsizing all
          //    thirteen labels, and shrinking the node would have bought it off
          //    the touch floor. Both were refused, so both are asserted.
          expect(reading.nodeCount, `${where}: the step bar drew no nodes`).toBeGreaterThan(0);
          expect(
            reading.stepsHeight ?? 0,
            `${where}: the step bar wraps to more than one row`,
          ).toBeLessThanOrEqual((reading.tallestNode ?? 0) + SLACK_PX);
          expect(
            reading.shortestNode ?? 0,
            `${where}: a step control is under the touch floor`,
          ).toBeGreaterThanOrEqual(TOUCH_TARGET_PX - SLACK_PX);

          // 5. Both shut columns are strips the width of what is left in them:
          //    one control in the rail, and the life totals and the priority row
          //    in the ask column.
          expect(
            reading.railWidth ?? 0,
            `${where}: the shut log column is wider than its own control`,
          ).toBeLessThanOrEqual(TOUCH_TARGET_PX + SLACK_PX);
          expect(
            reading.askWidth ?? 0,
            `${where}: the shut ask column is wider than the strip it collapses to`,
          ).toBeLessThanOrEqual(PLAY_ASK_SHUT_REM * 16 + SLACK_PX);

          // 6. Nothing at all is drawn above the mat, and the mat is the screen.
          //    Before this lane the furniture was a nav bar, a heading and a
          //    control strip taking 196px of 390; after the first half of it,
          //    57 + 44 with a 35.84px set-completeness notice on a reduced build,
          //    over a mat of 227.16. the playtester asked for the rest of it by name:
          //    "I want the table to basically take up the full landscape screen".
          //    So each band is asserted at zero rather than the sum being small,
          //    and 844x390 now reads a 382px mat — the same number
          //    `packages/slice/test/ui-phone-scroll.browser.test.ts` reads by
          //    playing a real game at this size rather than reproducing one.
          expect(
            reading.titleHeight ?? 0,
            `${where}: the route heading is drawn over a table this short`,
          ).toBeLessThanOrEqual(1);
          for (const [selector, height_] of reading.furniture) {
            expect(height_, `${where}: ${selector} was not rendered, so nothing was measured`).not.toBeNull();
            expect(height_ ?? 0, `${where}: ${selector} is drawn over a table this short`).toBe(0);
          }
          expect(
            reading.matHeight ?? 0,
            `${where}: the table gets under 95% of the screen`,
          ).toBeGreaterThanOrEqual(height * 0.95);

          // 7. And the mana base is on the screen, which is a claim about the
          //    lane rather than about the window: claim 1 held the whole time
          //    the band was invisible. The battlefield body is a scroller
          //    holding a row of cards and the band under it, and until
          //    `../../src/styles/board/fit.ts`'s short-table floor the row could
          //    not shrink and the band was last, so the body's deficit came
          //    entirely out of the lands. Measured before the fix at 932x430
          //    with two spells and four lands a side: a 116px body holding 128px
          //    of content and the band 8.25px past its own bottom edge, 23.41 at
          //    932x400, 28.47 at 844x390. the playtester, 2026-08-22: "I'm still not
          //    seeing lands once I play them".
          for (const [seat, band] of [
            ['near', reading.nearBand],
            ['far', reading.farBand],
          ] as const) {
            expect(band, `${where}: the ${seat} seat drew no mana base`).not.toBeNull();
            expect(band?.tiles ?? 0, `${where}: the ${seat} mana base drew no tiles`).toBeGreaterThan(0);
            expect(
              band?.belowBody ?? 0,
              `${where}: the ${seat} mana base hangs below the lane that owns it`,
            ).toBeLessThanOrEqual(SLACK_PX);
            expect(band?.belowFold ?? 0, `${where}: the ${seat} mana base runs under the fold`).toBe(0);
            // Both halves of the fix, read off the page rather than inferred
            // from the pixels above, so a lane that happens to fit does not pass
            // for a lane that is pinned.
            expect(band?.position, `${where}: the ${seat} mana base is not pinned to its lane`).toBe(
              'sticky',
            );
          }
          expect(reading.spellsFloor, `${where}: the battlefield row keeps the desktop floor`).toBe(
            `${String(SHORT_TABLE_SPELLS_MIN_REM * 16)}px`,
          );

          // 8. And the tier that states 1 through 7 is the one that fired.
          expect(reading.handCap, `${where}: the short-viewport hand cap is not what the mat reads`).toBe(
            `${String(COMBAT_HAND_FACE_MAX_REM)}rem`,
          );
        }

        // The crowded board, at the smallest of the four. Its eighth permanent
        // used to raise the hand face to 7rem, which is twice what the same
        // phone drew with seven, so the cap has to survive the rule that was
        // written to lower it.
        const busy = await at(LANDSCAPE[0][0], LANDSCAPE[0][1], crowded);
        console.log(
          `${String(LANDSCAPE[0][0])}x${String(LANDSCAPE[0][1])} crowded: cap ${String(busy.handCap)}, rows ${String(busy.nearRow)}/${String(busy.farRow)}, hand below fold ${String(busy.handBelowFold)}`,
        );
        expect(busy.faceCount[0], 'the crowded board drew fewer than eight permanents').toBe(8);
        expect(busy.handCap, 'a crowded landscape board widens the hand face again').toBe(
          `${String(COMBAT_HAND_FACE_MAX_REM)}rem`,
        );
        expect(busy.handBelowFold, 'the crowded board runs the hand row under the fold').toBe(0);
        expect(
          busy.nearRow ?? 0,
          'the crowded board draws the viewer the shorter battlefield row',
        ).toBeGreaterThanOrEqual((busy.farRow ?? 0) - SLACK_PX);

        // The control. Same width, room under it, and the cap is not the short
        // one — which is the whole evidence that this lane is height-gated.
        const tall = await at(TALL_CONTROL[0], TALL_CONTROL[1]);
        console.log(
          `${String(TALL_CONTROL[0])}x${String(TALL_CONTROL[1])} control: cap ${String(tall.handCap)}`,
        );
        expect(tall.nearBand?.position, 'a tall window pins the mana base to its lane').toBe('static');
        expect(tall.spellsFloor, 'a tall window takes the short-table battlefield floor').not.toBe(
          `${String(SHORT_TABLE_SPELLS_MIN_REM * 16)}px`,
        );
        expect(tall.handCap, 'a tall window takes the short-viewport hand cap').not.toBe(
          `${String(COMBAT_HAND_FACE_MAX_REM)}rem`,
        );
        expect(tall.titleHeight ?? 0, 'a tall window stops drawing the route heading').toBeGreaterThan(1);
        expect(
          tall.nearRow ?? 0,
          'the tall control draws the viewer the shorter battlefield row',
        ).toBeGreaterThanOrEqual((tall.farRow ?? 0) - SLACK_PX);
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
          `landscape phone Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
