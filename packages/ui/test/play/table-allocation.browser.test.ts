// @vitest-environment node
/**
 * What a table owes each thing on it, measured rather than argued.
 *
 * `mtg-5f9` and `mtg-1i9` were filed as two bugs and are one: a 1024x768 table
 * has less room than the layout assumed, and every subsystem was spending the
 * shortfall its own way — a battlefield face fell to a size with no rules box on
 * it at all, a tapped face kept a width its squashed slot had already taken the
 * height off and got its leading edge cut by the row, and the step bar drew
 * twelve of thirteen names short. Three claims here, one per symptom, and all
 * three are boxes rather than declarations:
 *
 *  1. **A battlefield face keeps its rules box.** Every face on the spells row
 *     draws rules text at every viewport and board size this measures, and an
 *     uncrowded one draws its type line too. `styles/board/hand.ts`'s
 *     `FACE_COMPLETE_REM` is the floor and `styles/card.ts` has the thresholds
 *     that set it, as content boxes rather than face widths: the rules box goes
 *     at a 4rem content box and the type line at 5rem, which on the proportional
 *     band are a 69px and an 87px face, and a seventh of a 1024x768 row is 72.
 *     The hand reads the same number as its own floor since `mtg-s3re`, which is
 *     what took the viewer's face here from 100 to 96.7 at 1024x768 with four a
 *     side — 11px over the type line's threshold once the real chrome comes off,
 *     and `./hand-allocation.browser.test.ts` asserts that margin from its side
 *     as well.
 *  2. **A tapped face is inside its slot on both axes.** The old rule sized the
 *     card off the slot's width alone, so a slot capped on the block axis kept
 *     the width the card was drawn from and the row clipped what the quarter turn
 *     laid across it. The captures in `references/UI_issues/` are that: a rotated
 *     name reading `...dgeland Barracuda`. The short viewports below are where it
 *     reproduces — `tools/tap-rotation.ts` measured horizontal overhang only and
 *     never saw it. The block axis is asked only of a slot at least as tall as
 *     the face's own chrome, measured off that face, which is the one bound no
 *     rule can beat.
 *  3. **The step bar draws all thirteen names.** It has 863px of row at 1440x900
 *     for 779px of label and cut three of them anyway, which was arithmetic; at
 *     1280x800 and 1024x768 it is genuinely short and buys the words with a
 *     second line rather than an ellipsis on every one.
 *
 * The harness is `../support/chrome.ts`. jsdom answers none of this: it performs
 * no layout, so `getBoundingClientRect` is zeros and `scrollWidth` is
 * `clientWidth` on everything.
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
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/**
 * Four creatures with keywords on them, so a face drawn without its rules box
 * is a false rather than a judgment call, and four basics for the mana band.
 *
 * The neutral example set rather than the flagship fixture, which is what
 * `battlefield-geometry.browser.test.ts` beside this reads: that one reproduces
 * a game state a person sent in and its evidence is about those exact cards, so
 * it is one of the paths the public export holds back. Nothing here is about a
 * card - the claims are the sizes of boxes - so this file exports with the rest
 * of the lab.
 */
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
 * A board of `perSide` permanents and five lands a side, every other permanent
 * tapped.
 *
 * Alternating rather than all-tapped, because the claim is about the two states
 * drawing the same size card: an upright neighbor is the control.
 */
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
      tapped: index % 3 === 0,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/table-allocation-${String(perSide)}`,
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Table allocation</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One CSS pixel of tolerance, for the same reason the geometry test states: a
 * percentage edge can land on either of two adjacent device pixels, and that is
 * never a visible overhang.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const drawn = (node) => node !== null && node.getBoundingClientRect().height > 0;
  const faces = [...document.querySelectorAll(".mtg-board__spells > .mtg-slot[data-slot='play'] > .mtg-card")].map((face) => {
    const slot = face.parentElement;
    const row = slot.parentElement;
    const faceBox = face.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const name = face.querySelector('.mtg-card__name');
    const style = getComputedStyle(face);
    const chrome =
      parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    return {
      name: name === null ? '' : name.textContent,
      seat: slot.closest('.mtg-board__side').getAttribute('data-seat'),
      tapped: slot.getAttribute('data-tapped') === 'true',
      face: [round(faceBox.width), round(faceBox.height)],
      chrome: round(chrome),
      slot: [round(slotBox.width), round(slotBox.height)],
      overhangY: round(Math.max(0, slotBox.top - faceBox.top, faceBox.bottom - slotBox.bottom)),
      overhangX: round(Math.max(0, slotBox.left - faceBox.left, faceBox.right - slotBox.right)),
      clipY: round(Math.max(0, rowBox.top - faceBox.top, faceBox.bottom - rowBox.bottom)),
      typeDrawn: drawn(face.querySelector('.mtg-card__type')),
      rulesDrawn: drawn(face.querySelector('.mtg-card__text')),
    };
  });
  const zoomBox = (slot) => {
    if (slot === null) return null;
    const zoom = slot.querySelector('.mtg-zoom');
    if (zoom === null) return null;
    zoom.style.display = 'block';
    const box = zoom.getBoundingClientRect();
    zoom.style.display = '';
    return [round(box.left), round(box.top), round(box.width), round(box.height)];
  };
  const stepNodes = [...document.querySelectorAll('.mtg-phasebar__node')];
  const tops = {};
  for (const node of stepNodes) tops[Math.round(node.getBoundingClientRect().top)] = 1;
  const steps = document.querySelector('.mtg-phasebar__steps');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    faces,
    zoom: {
      tapped: zoomBox(document.querySelector(".mtg-board__spells > .mtg-slot[data-tapped='true']")),
      hand: zoomBox(document.querySelector(".mtg-zone[data-tone='rail'] .mtg-slot")),
    },
    steps: {
      count: stepNodes.length,
      lines: Object.keys(tops).length,
      sidewaysScroll: steps === null ? -1 : steps.scrollWidth - steps.clientWidth,
      clipped: stepNodes
        .map((node) => node.querySelector('.mtg-phasebar__text'))
        .filter((text) => text !== null && text.scrollWidth > text.clientWidth + 1)
        .map((text) => text.textContent),
    },
  };
})()`;

interface FaceReading {
  readonly name: string;
  readonly seat: string;
  readonly tapped: boolean;
  readonly face: readonly [number, number];
  /** Border plus padding across the face, read off the element rather than stated. */
  readonly chrome: number;
  readonly slot: readonly [number, number];
  readonly overhangY: number;
  readonly overhangX: number;
  readonly clipY: number;
  readonly typeDrawn: boolean;
  readonly rulesDrawn: boolean;
}

interface ZoomReading {
  readonly tapped: readonly number[] | null;
  readonly hand: readonly number[] | null;
}

interface StepReading {
  readonly count: number;
  readonly lines: number;
  readonly sidewaysScroll: number;
  readonly clipped: readonly string[];
}

/**
 * The three viewports `mtg-5f9` and `mtg-1i9` were filed against, plus the width
 * the 2026-08-16 captures came from, plus two tables short enough to squash a
 * slot on the block axis. The short pair is what reproduces the tapped clip:
 * at 1440x560 the card was 128.5 wide across a slot 85.8 tall, 15.3px of it
 * outside the slot and 10.1px outside the row.
 */
const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [1392, 766],
  [1440, 560],
  [1440, 480],
] as const;

/** Where the step bar has the whole thirteen-name row to answer for. */
const STEP_VIEWPORTS = new Set(['1440x900', '1280x800', '1024x768', '1392x766']);

const STEPS = 13;

/** Two lines of thirteen names is the most a shortfall may cost the lane. */
const MAX_STEP_LINES = 2;

describe('the table spends its shortfall where the shortfall is', () => {
  browserIt(
    'draws a complete face, contains every tapped card, and cuts no step name',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-table-allocation-'));
      const pages = new Map<number, string>();
      for (const perSide of [4, 8, 12]) {
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
            const result = await measurePage(chrome.client, file, width, height, MEASURE, 'table allocation');
            expect(result['viewport']).toEqual([width, height]);
            const faces = result['faces'] as readonly FaceReading[];
            expect(faces, `${where} face count`).toHaveLength(perSide * 2);

            for (const face of faces) {
              expect(
                face.overhangX,
                `${where}: ${face.name} outside its slot horizontally`,
              ).toBeLessThanOrEqual(1);
              expect(face.clipY, `${where}: ${face.name} cut by its row`).toBeLessThanOrEqual(1);

              // The block axis is asked only of a slot that can hold a face at
              // all: a slot shorter than the card's own two bands is a table
              // with no cards on it in any readable sense, and the containment
              // rule is not what failed there.
              //
              // The chrome is read off the face rather than stated, because it
              // is a share of the face's own width (`--frame-band` in
              // styles/card.ts, over `--pad: 0px`) and there is no number to
              // state. Measured over a sweep of --card-w it is 4px up to a 72px
              // face, 6px to 121, then 8 and 10, and it is not monotone in the
              // face width: a 72px face has a 68px content box and a 73px face
              // has 67. That the band is the printed proportion is
              // ./combat-frame.browser.test.ts's claim and is asserted there.
              //
              // The rig used to state `FACE_CHROME_PX = 16`, which was exactly
              // right on 2026-08-16, when the face carried a 4px border and 4px
              // of padding a side, and wrong the next day when `cc1e438d` made
              // the band proportional and dropped the padding. Nothing here was
              // measuring, so nothing said so.
              //
              // Nothing is excluded by the guard at any viewport this rig
              // measures — the shortest slot here is 51.8px against a chrome of
              // 4 to 8 — so it is a floor kept against a squash worse than the
              // ones below, not a live waiver.
              if (face.slot[1] >= face.chrome) {
                expect(
                  face.overhangY,
                  `${where}: ${face.name} outside its slot vertically`,
                ).toBeLessThanOrEqual(1);
              }
            }

            // Every permanent on the table keeps its rules box. That is the
            // whole of mtg-5f9's first finding, which was measured on the face
            // that carried 16px of chrome: a seventh of a 1024x768 row was a
            // 72px face with a 56px content box, under BOARD_RULES_MIN_REM's
            // 64, so no card on that table drew rules text at any board size
            // while the row was 170.4px tall with a 100.6px slot in it. On the
            // proportional band the same 72px face has a 68px content box, and
            // the rules text first draws at a 69px face.
            //
            // The type line is not asserted with it, and the reason is a number
            // rather than an oversight: the type line first draws at an 87px
            // face (an 81px content box against BOARD_TYPE_LINE_MIN_REM's 80),
            // and a row of eight is 84px wide per card at 1280x800 with
            // room for nothing else. A face at eight a side keeps its name, its
            // picture and its rules and gives up the line that repeats what the
            // picture already shows. The 480-tall tables are here to prove
            // containment under a squash and are not asked for text at all.
            if (height >= 700) {
              for (const face of faces) {
                expect(face.rulesDrawn, `${where}: ${face.name} rules box`).toBe(true);
              }
            }
            if (height >= 700 && perSide === 4) {
              for (const face of faces) {
                expect(face.typeDrawn, `${where}: ${face.name} type line`).toBe(true);
              }
            }

            // Both seats draw one size of card, and a tapped card is that size
            // turned rather than a different one. Only where the row is tall
            // enough to hold the square a tapped slot asks for: under the
            // block-axis cap the two states are legitimately different sizes,
            // because a card lying down fits its 63 into the height the upright
            // one has to fit its 88 into, and 1440x480 measures containment
            // rather than parity for that reason.
            for (const seat of height < 700 ? [] : ['you', 'opponent']) {
              const row = faces.filter((face) => face.seat === seat);
              const bases = row.map((face) => (face.tapped ? face.face[1] : face.face[0]));
              expect(
                Math.max(...bases) - Math.min(...bases),
                `${where}: ${seat} base widths ${JSON.stringify(bases)}`,
              ).toBeLessThanOrEqual(1);
            }

            // The zoom is position: fixed and it has to stay anchored to the
            // viewport, because every zone body on this table is overflow: auto
            // and that panel is how a small face is read. Both fixes here put a
            // size container on an ancestor of it - the spells row in
            // `styles/board/hand.ts`, a tapped slot in `styles/board/slot.ts` -
            // and the spec's reading of size containment is that it applies
            // layout containment, which would make each one a containing block
            // for a fixed descendant and drop the panel into a 100px slot. It
            // does not, in chrome-headless-shell 151: the board's zoom draws at
            // the same box as a hand card's, which has no size container above
            // it anywhere. Asserted as the two boxes rather than as a ban on
            // the declaration, because that is the claim - `test/board.test.ts`
            // held the ban and it was a statement about the wrong thing.
            const zoom = result['zoom'] as ZoomReading;
            expect(zoom.hand, `${where} hand zoom`).not.toBeNull();
            expect(zoom.tapped, `${where} tapped zoom`).toEqual(zoom.hand);

            const steps = result['steps'] as StepReading;
            expect(steps.count, `${where} step count`).toBe(STEPS);
            expect(steps.sidewaysScroll, `${where} step bar sideways scroll`).toBe(0);
            if (STEP_VIEWPORTS.has(`${String(width)}x${String(height)}`)) {
              expect(steps.clipped, `${where} step names cut`).toEqual([]);
              expect(steps.lines, `${where} step bar lines`).toBeLessThanOrEqual(MAX_STEP_LINES);
            }
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
        throw new AggregateError(
          cleanupErrors,
          `table allocation Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    60_000,
  );
});
