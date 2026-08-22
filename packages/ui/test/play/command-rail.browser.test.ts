// @vitest-environment node
/**
 * Every legal move is a button a person can press, measured rather than argued.
 *
 * `mtg-bc2.130`. The play route's layout constants are chosen from a chromium
 * measurement, recorded in a commit message, and guarded by nothing: the
 * verifier on that bead changed four of them one at a time and all 431 `@mtg/ui`
 * tests stayed green, including putting `styles/board/fit.ts`'s `MIN_SLOT_REM`
 * back to the 7rem that shipped the unusable table its parent bead fixed. jsdom
 * performs no layout, so no test in this repository could have caught any of it.
 *
 * The bead's own answer is to guard the constants **through the properties they
 * exist for rather than by value**, and it says why the other option is worse
 * than useless: a unit test that pins `MIN_SLOT_REM === 5` fails a legitimate
 * retune and passes an illegitimate one that keeps the number. That distinction
 * is not academic here — `COMMAND_BAR_SHARE`, one of the four the bead names,
 * no longer exists under that name, while every property below is still exactly
 * the promise the route makes.
 *
 * Three claims, at the three supported desktop viewports and at an uncrowded and
 * a crowded board:
 *
 *  1. **The first legal move is pressable where a person would press it.** Its
 *     center hit-tests to itself, and it is at least 24 x 24 CSS px, which is
 *     WCAG 2.5.8 and the floor `styles/board/fit.ts` already states for a board
 *     face. A move list that has to be scrolled before anything in it can be
 *     pressed is the interface `mtg-bc2.137` moved the option count off the
 *     height axis to prevent, and `styles/views.ts`'s `COMMAND_ROW_FLOOR_REM` is
 *     the floor under that promise.
 *  2. **Every card row shows one whole card.** A row that shrinks its faces past
 *     its own floor draws a column of slivers, and a row that clips them draws a
 *     card with an edge cut off; a complete face inside the row's box is the one
 *     reading that excludes both.
 *  3. **The document does not scroll.** The play route is a screen, and the
 *     failure it was built out of is the command bar falling below the fold at
 *     an ordinary window height. Every constant that makes something taller can
 *     put it back, which is what makes this the cheapest of the three to check
 *     and the widest in what it catches.
 *
 * **What it bites, measured by mutation on 2026-08-16 rather than reasoned
 * about.** Each edit applied alone, this file run at all six positions, the
 * edit reverted:
 *
 *     styles/views.ts  .mtg-shell height:100dvh -> min-height  FAILS claim 3
 *     styles/views.ts  .mtg-shell__main min-height 0 -> auto   passes
 *     styles/views.ts  COMMAND_ROW_FLOOR_REM  5   -> 0.1       passes
 *     styles/board/fit.ts   MIN_SLOT_REM       5  -> 7         passes
 *     styles/board/fit.ts   MIN_SLOT_WIDTH_REM 3  -> 12        passes
 *     styles/board/hand.ts  BOARD_FACE_MIN_REM 4.5 -> 14       passes
 *     styles/board/hand.ts  BOARD_FACE_MAX_SHARE 96 -> 400     passes
 *     styles/board/rail.ts  PLAY_RAIL_REM     17  -> 1         passes
 *     styles/board/rail.ts  PLAY_ASK_REM      11  -> 1         passes
 *     styles/card.ts        SMALL_FACE_MAX_REM 7  -> 0.1       passes
 *
 * One red out of ten, and the shape of the nine is the finding rather than a
 * gap to apologize for: **this layout is elastic by construction, so a constant
 * moved to a wrong value is absorbed rather than shown.** Every number above is
 * a floor or a share on a chain that ends at the window, and the chain spends
 * what it is given whatever the floor says. Three of them are worth naming
 * because the bead names them: `MIN_SLOT_REM` is overridden to `min-height: 0`
 * on the battlefield slot by `styles/board/hand.ts` (a slot whose height comes
 * from its width has no use for a height floor), so 5 -> 7 moves no measurement
 * at all at 4, 12, 16 or 20 a side across four viewports; `COMMAND_ROW_FLOOR_REM`
 * is a `min-height` on a body that `flex: 1` already fills to 144px at the
 * shortest window a game is played at, against an 80px floor; and
 * `SMALL_FACE_MAX_REM` gates a container query that changes what a small face
 * *draws* rather than how large it is, which is `./table-allocation.browser.test.ts`'s
 * claim 1 and `./hand-allocation.browser.test.ts`'s, both of which do go red
 * when the rules box stops being drawn. The fourth constant the bead lists,
 * `COMMAND_BAR_SHARE`, no longer exists under that name in `packages/ui/src`.
 *
 * So the three claims here are **floors, and the slack under them is measured**:
 * the first move is 86 to 176 CSS px wide against a 24px floor, and 4 of 4
 * faces are whole at four a side and 5 to 7 of 12 at twelve. A floor that far
 * from the value is not a tuning guard and is not written as one. It is the
 * guard against the class of change that takes the surface out entirely, and
 * the fold is where that class lands: dropping the shell's `height: 100dvh`
 * put 663px of document below the window at 1024x768 with every other rule in
 * the sheet untouched, which is the failure `mtg-bc2.137` moved the option
 * count off the height axis to prevent, arriving by a different door.
 *
 * Two things this file is measured *not* to catch, recorded so nobody reads
 * more into a green than is there. `PLAY_ASK_REM` 11 -> 1 narrows the command
 * body from 125.7px to 86px and wraps every move label from 36.8px to 55.7px
 * tall without failing anything in this repository. And `views.ts`'s
 * `.mtg-choice__label { overflow-wrap: break-word }` is a fix that shipped from
 * a measurement ("three labels at 1024x768 spilled a card name past their own
 * edge") and is guarded by nothing: the check is one line, but the neutral
 * example set this file is required to use has no card name with a word long
 * enough to spill an ask column, so asserting it here would assert something
 * that cannot fail. It wants a fixture, not an assertion.
 *
 * The page draws the labeled pending frame on every card, because it stages no
 * art. A gate's exit code has to be a function of tracked state, and the only
 * manifests that cover a set on this machine are under the gitignored `out/art/`
 * — a verdict that reads them is a fact about the hard drive. Nothing measured
 * here moves when a raster loads: the art window is a ratio of the face
 * (`card/anatomy.ts`), so the frame and the picture occupy the same box.
 *
 * The neutral `@mtg/dsl` example set, so the file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

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

/** WCAG 2.5.8, and the floor `styles/board/fit.ts` already states for a face. */
const TARGET_MIN_PX = 24;

function board(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
    ...Array.from({ length: 5 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller,
      tapped: false,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/command-rail-${String(perSide)}`,
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Command rail</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * A hit test rather than a declaration. `elementFromPoint` answers the question
 * a person asks — press here, does this button receive it — and it is the one
 * question a stylesheet read by eye cannot answer, since anything drawn over the
 * rail covers it without appearing in its own rules.
 */
const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const doc = document.scrollingElement;
  const main = document.querySelector('.mtg-shell__main');
  const group = document.querySelector(".mtg-choices[role='group']");
  const body = document.querySelector('.mtg-prompt .mtg-panel__body');
  const bodyBox = body === null ? null : body.getBoundingClientRect();
  const options = group === null ? [] : [...group.querySelectorAll('button.mtg-choice')];
  const read = (button) => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = hit === null ? 'nothing is drawn there' : (hit === button || button.contains(hit) ? '' : (hit.getAttribute('class') || hit.tagName));
    return {
      name: button.getAttribute('aria-label') || button.textContent,
      w: round(r.width), h: round(r.height),
      hits: covered === '',
      covered,
      insideBody: bodyBox === null ? false : (r.top >= bodyBox.top - 1 && r.bottom <= bodyBox.bottom + 1),
    };
  };
  const rows = [...document.querySelectorAll('.mtg-board__spells')].map((row) => {
    const rr = row.getBoundingClientRect();
    const faces = [...row.querySelectorAll(".mtg-slot[data-slot='play'] > .mtg-card")];
    const whole = faces.filter((face) => {
      const b = face.getBoundingClientRect();
      return b.left >= rr.left - 1 && b.right <= rr.right + 1 && b.top >= rr.top - 1 && b.bottom <= rr.bottom + 1;
    });
    return { faces: faces.length, whole: whole.length, narrowest: round(Math.min(...faces.map((f) => f.getBoundingClientRect().width))) };
  });
  return {
    viewport: [window.innerWidth, window.innerHeight],
    group: group !== null,
    body: bodyBox === null ? null : [round(bodyBox.width), round(bodyBox.height)],
    options: options.map(read),
    rows,
    documentScroll: doc === null ? -1 : round(doc.scrollHeight - doc.clientHeight),
    mainScroll: main === null ? -1 : round(main.scrollHeight - main.clientHeight),
  };
})()`;

interface Option {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly hits: boolean;
  readonly covered: string;
  readonly insideBody: boolean;
}

interface Row {
  readonly faces: number;
  readonly whole: number;
  readonly narrowest: number;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const CROWDINGS = [4, 12];

describe('the play route hands a person a move they can press', () => {
  browserIt(
    'keeps the first legal move hit-testable, one whole card in every row, and the document unscrolled',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-command-rail-'));
      const pages = new Map<number, string>();
      for (const perSide of CROWDINGS) {
        const file = join(directory, `board-${String(perSide)}.html`);
        await writeFile(file, page(board(perSide)), 'utf8');
        pages.set(perSide, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [perSide, file] of pages) {
          for (const [width, height] of VIEWPORTS) {
            const where = `${String(width)}x${String(height)} at ${String(perSide)} a side`;
            const result = await measurePage(chrome.client, file, width, height, MEASURE, 'command rail');
            expect(result['viewport']).toEqual([width, height]);
            expect(result['group'], `${where}: no legal-move group`).toBe(true);
            expect(result['body'], `${where}: no command body`).not.toBeNull();

            const options = result['options'] as readonly Option[];
            expect(options.length, `${where}: legal moves offered`).toBeGreaterThan(0);

            // Claim 1. The first option is the one a person reaches for and the
            // one that must never need a scroll first, so it is asserted whole
            // rather than in aggregate.
            const first = options[0];
            expect(first, `${where}: no first option`).toBeDefined();
            if (first !== undefined) {
              expect(first.w, `${where}: first move "${first.name}" width`).toBeGreaterThanOrEqual(
                TARGET_MIN_PX,
              );
              expect(first.h, `${where}: first move "${first.name}" height`).toBeGreaterThanOrEqual(
                TARGET_MIN_PX,
              );
              expect(
                first.hits,
                `${where}: pressing the center of "${first.name}" reaches ${first.covered}`,
              ).toBe(true);
              expect(first.insideBody, `${where}: "${first.name}" needs a scroll to be seen`).toBe(true);
            }
            // And nothing anywhere in the list is drawn under the target floor,
            // which is where a squeezed rail goes before it goes anywhere else.
            for (const option of options) {
              expect(option.h, `${where}: move "${option.name}" height`).toBeGreaterThanOrEqual(
                TARGET_MIN_PX,
              );
            }

            // Claim 2. One whole card per row, both seats.
            const rows = result['rows'] as readonly Row[];
            expect(rows.length, `${where}: spell rows`).toBe(2);
            for (const row of rows) {
              expect(row.faces, `${where}: a spell row drew nothing`).toBe(perSide);
              expect(
                row.whole,
                `${where}: no complete card in a row of ${String(row.faces)}, narrowest ${String(row.narrowest)}px`,
              ).toBeGreaterThan(0);
            }

            // Claim 3. The screen is a screen. Both scrollers are asked,
            // because on this route it is the shell's main region rather than
            // the document that would give first: `styles/views.ts` leaves that
            // one scrollable on purpose for the sealed builder's gallery, so a
            // play table that reaches it has already lost the fold.
            expect(result['documentScroll'], `${where}: the document scrolled`).toBeLessThanOrEqual(1);
            expect(result['mainScroll'], `${where}: the table did not fit its window`).toBeLessThanOrEqual(1);
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    120_000,
  );
});
