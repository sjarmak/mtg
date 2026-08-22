// @vitest-environment node
/**
 * The beat's Continue, measured on a real board.
 *
 * `mtg-gt4q` moved a paused game's one control out of a panel in a column and
 * onto the table, so that it can be pressed *while* the animation it is about is
 * playing. Every claim in that sentence that matters is positional, and jsdom
 * lays nothing out: `getBoundingClientRect` there returns zeros, so
 * `beat-motion.test.ts` can prove which element the button is inside and nothing
 * about where that puts it. This file is the other half.
 *
 * Four things are asked, in chrome-headless-shell, against the shipped markup
 * and the shipped sheet, on a table paused on a death beat:
 *
 * **It is on screen.** A box with area, inside the viewport, inside the seam it
 * hangs from. An absolutely positioned box in a containing block that turned out
 * not to be one lands at the top of the page, and that failure is invisible to
 * every structural test.
 *
 * **It is on the seam, and over no card.** Its center sits in the band between
 * the two battlefields, and its box meets no slot anywhere on the table. The
 * first version of this control was centered in `.mtg-board__lanes` and passed
 * every structural test while being drawn 99px inside the near battlefield, over
 * the player's own cards — the lanes' midline is not the seam, because the
 * viewer's band also carries the step bar and the hand. The slot sweep is the
 * assertion that would have caught it without anyone knowing which element to
 * suspect.
 *
 * **It fits the column the sheet reserves for it.** `BEAT_SEAM_CLEARANCE_REM` is
 * what holds the two other residents of this seam off the control — the stack
 * strip's end edge and an open combat band's padding — so a control that had
 * outgrown it would hang over a stack entry with nothing failing. The stack strip
 * is put on the seam here the way `../../src/board/StackZone.ts` puts it there,
 * and the end of its *ink* is measured against the button's start. The ink and
 * not the box, because the reservation is padding: the strip spans the seam on
 * both arms and it is the entries inside it that must stop short.
 *
 * **On a phone too**, which is the second case here and the reason the
 * reservation is padding at all. `styles/board/stack.ts` puts the seam back in
 * flow under `(pointer: coarse)`, an inset does nothing to a box in flow, and
 * the strip ran 89.56px under the Continue at both 932x430 and 844x390 while
 * this file, measuring only at 1440x900 with a mouse, read -22.44 and passed.
 * The playtester found it on her own phone: "when resolving an ability option shows
 * up in the middle I can't click it like I can on the desktop version to let it
 * resolve."
 *
 * **It is pressable, with the motion layer live.** The plane a departing card is
 * flown on is `position: fixed` across the whole viewport at z-index 40
 * (`styles/board/motion.ts`), which is exactly the thing that could have been
 * over this button while the animation the player is watching runs. The plane is
 * inserted here the way the runner inserts it, and the button's own center is
 * hit-tested: it must resolve to the button. It also must not overlap the
 * viewer's hand or the step bar, which are the two regions the playtester named as
 * unusable when the flyout covered them (`styles/board/ask-flyout.ts`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, ObjectId, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { BEAT_SEAM_CLEARANCE_REM } from '../../src/styles/board/beat';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

/** A mid-game table with a board on both sides and cards in the viewer's hand. */
function board(): { readonly game: GameSession; readonly died: ObjectId } {
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
    seed: 'ui/beat-motion',
    battlefield: [...permanents(0, 6), ...permanents(1, 5)],
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[2], SPELLS[3]],
    ],
    step: 'precombatMain',
    active: 0,
    turn: 8,
  });
  const died = built.state.battlefield[0];
  if (died === undefined) throw new Error('the dealt board has no permanent to kill');
  return {
    game: {
      seats: [humanSeat('You'), humanSeat('Bot')],
      state: built.state,
      events: built.events,
      result: null,
      pending: pendingDecision(built.state),
      choices: [],
      decisions: 0,
      beat: null,
      committed: null,
    },
    died,
  };
}

function page(): string {
  const { game, died } = board();
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        beat: { kind: 'death', oids: [died] },
        onContinue: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Beat</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Put the other two things that live on this seam there, then measure.
 *
 * The motion plane rather than a whole animation, and one stack strip rather
 * than a cast spell: what is being asked is whether the shipped sheet keeps the
 * control above a fixed full-viewport layer and clear of the strip that shares
 * its band, and those two elements are what decide it. Whether the runner puts
 * the plane there at the right moment is `motion-runner.test.ts`, and what goes
 * in a stack entry is `../../src/board/StackZone.ts`; neither is this file's
 * question. The strip is given more text than can fit, because the collision
 * this rule prevents is the deep stack, not the empty one.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const boxOf = (selector) => {
    const node = document.querySelector(selector);
    if (node === null) return null;
    const box = node.getBoundingClientRect();
    return [round(box.x), round(box.y), round(box.width), round(box.height)];
  };
  const play = document.querySelector('.mtg-play');
  if (play !== null) {
    const layer = document.createElement('div');
    layer.setAttribute('data-motion', 'layer');
    layer.setAttribute('aria-hidden', 'true');
    play.appendChild(layer);
  }
  const divider = document.querySelector('.mtg-board__divider');
  if (divider !== null) {
    const strip = document.createElement('div');
    strip.className = 'mtg-stack-seam';
    const count = document.createElement('span');
    count.className = 'mtg-stack-seam__count';
    count.textContent = 'Stack 3';
    strip.appendChild(count);
    const list = document.createElement('ul');
    list.className = 'mtg-stack';
    // Sentences rather than the four cards this board is dealt from: what the
    // entries say decides nothing here and every card name a public test types
    // has to be recorded in the export census. These are wider than the names
    // would have been, which is the direction that makes the probe harder.
    for (const name of ['a spell on the stack', 'another one under it', 'and a third one waiting']) {
      const entry = document.createElement('li');
      entry.className = 'mtg-stack__entry';
      const label = document.createElement('span');
      label.className = 'mtg-stack__name';
      label.textContent = name;
      entry.appendChild(label);
      list.appendChild(entry);
    }
    strip.appendChild(list);
    divider.appendChild(strip);
  }
  const seam = document.querySelector('.mtg-stack-seam');
  const inkEnd = seam === null
    ? Number.NEGATIVE_INFINITY
    : [...seam.children].reduce((end, child) => {
        const rect = child.getBoundingClientRect();
        return rect.width === 0 ? end : Math.max(end, rect.x + rect.width);
      }, Number.NEGATIVE_INFINITY);
  const button = document.querySelector('.mtg-beat__continue');
  const box = button === null ? null : button.getBoundingClientRect();
  const hit = box === null ? null : document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  return {
    button: boxOf('.mtg-beat__continue'),
    beat: boxOf('.mtg-beat'),
    divider: boxOf('.mtg-board__divider'),
    stackSeam: boxOf('.mtg-stack-seam'),
    stackInkEnd: inkEnd === Number.NEGATIVE_INFINITY ? null : round(inkEnd),
    seamPosition: seam === null ? null : getComputedStyle(seam).position,
    theirBoard: boxOf(".mtg-board__side[data-seat='opponent'] .mtg-zone__body[data-layout='board']"),
    yourBoard: boxOf(".mtg-board__side[data-seat='you'] .mtg-zone__body[data-layout='board']"),
    yourHand: boxOf(".mtg-board__side[data-seat='you'] .mtg-zone__body[data-layout='rail']"),
    steps: boxOf('.mtg-steps'),
    slots: [...document.querySelectorAll('.mtg-slot')].map((slot) => {
      const rect = slot.getBoundingClientRect();
      return [round(rect.x), round(rect.y), round(rect.width), round(rect.height)];
    }),
    rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
    viewport: [window.innerWidth, window.innerHeight],
    hitsButton: hit === null ? false : hit === button || button.contains(hit),
    layers: document.querySelectorAll("[data-motion='layer']").length,
  };
})()`;

const VIEWPORT = [1440, 900] as const;
/** The two landscape phones the table is measured on elsewhere: an iPhone 15 Pro
 *  Max and an iPhone 12, both turned sideways. */
const PHONE_VIEWPORTS = [
  [932, 430],
  [844, 390],
] as const;

type Box = readonly [x: number, y: number, width: number, height: number];

interface Reading {
  readonly button: Box | null;
  readonly beat: Box | null;
  readonly divider: Box | null;
  readonly stackSeam: Box | null;
  readonly stackInkEnd: number | null;
  readonly seamPosition: string | null;
  readonly theirBoard: Box | null;
  readonly yourBoard: Box | null;
  readonly yourHand: Box | null;
  readonly steps: Box | null;
  readonly slots: readonly Box[];
  readonly rootFontSize: number;
  readonly viewport: readonly [number, number];
  readonly hitsButton: boolean;
  readonly layers: number;
}

function readingOf(result: Record<string, unknown>): Reading {
  return result as unknown as Reading;
}

/** A box that is definitely there, named so a null reads as the missing element. */
function present(box: Box | null, what: string): Box {
  if (box === null) throw new Error(`the page drew no ${what}`);
  return box;
}

function overlaps(one: Box, two: Box): boolean {
  const [ax, ay, aw, ah] = one;
  const [bx, by, bw, bh] = two;
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

describe('a paused game whose report is the motion', () => {
  browserIt(
    'draws its Continue on the seam, over no card, inside the column the sheet reserves',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-beat-'));
      const file = join(directory, 'beat.html');
      await writeFile(file, page(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        const [width, height] = VIEWPORT;
        const read = readingOf(await measurePage(chrome.client, file, width, height, MEASURE, 'beat motion'));

        const button = present(read.button, 'beat Continue');
        const beat = present(read.beat, 'beat box');
        const divider = present(read.divider, 'combat seam');
        const strip = present(read.stackSeam, 'stack strip');
        const theirBoard = present(read.theirBoard, "opponent's battlefield");
        const yourBoard = present(read.yourBoard, 'your battlefield');
        const hand = present(read.yourHand, 'your hand');

        // On screen, with area, inside the viewport it was measured at.
        expect(button[2], 'the Continue has no width').toBeGreaterThan(40);
        expect(button[3], 'the Continue has no height').toBeGreaterThan(10);
        expect(button[0]).toBeGreaterThanOrEqual(0);
        expect(button[1]).toBeGreaterThanOrEqual(0);
        expect(button[0] + button[2]).toBeLessThanOrEqual(read.viewport[0]);
        expect(button[1] + button[3]).toBeLessThanOrEqual(read.viewport[1]);

        // Inside the containing block the sheet hangs it off, on the axis the
        // seam has one. An absolute box whose ancestor never became a containing
        // block lands at the top of the page instead.
        expect(button[0], 'the Continue escaped the seam').toBeGreaterThanOrEqual(divider[0]);
        expect(button[0] + button[2]).toBeLessThanOrEqual(divider[0] + divider[2]);

        // On the seam: below the opponent's cards and above the viewer's own.
        const middle = button[1] + button[3] / 2;
        expect(middle, 'the Continue is over the far battlefield').toBeGreaterThan(
          theirBoard[1] + theirBoard[3],
        );
        expect(middle, 'the Continue is over the near battlefield').toBeLessThan(yourBoard[1]);

        // And over no card anywhere on the table, which is the claim the seam is
        // chosen for and the one a wrong anchor breaks first.
        expect(read.slots.length, 'the page drew no slots to be clear of').toBeGreaterThan(8);
        const covered = read.slots.filter((slot) => overlaps(button, slot));
        expect(covered, 'the Continue is over a card').toEqual([]);

        // And clear of the two regions a box over this table may never take.
        expect(overlaps(button, hand), 'the Continue covers the hand').toBe(false);
        if (read.steps !== null) {
          expect(overlaps(button, read.steps), 'the Continue covers the step bar').toBe(false);
        }

        // Inside the column the sheet reserves, which is what the stack strip and
        // an open combat band are held off by. Measured on the drawn box rather
        // than assumed from the label, and then read back off the strip: with a
        // beat up, the strip ends before the control starts however deep the
        // stack is.
        const clearance = BEAT_SEAM_CLEARANCE_REM * read.rootFontSize;
        expect(beat[0], 'the Continue is wider than the column reserved for it').toBeGreaterThanOrEqual(
          divider[0] + divider[2] - clearance,
        );
        expect(strip[2], 'the stack strip was not drawn across the seam').toBeGreaterThan(100);
        const inkEnd = read.stackInkEnd;
        if (inkEnd === null) throw new Error('the strip drew no entries to measure');
        expect(inkEnd, 'the stack reaches under the Continue').toBeLessThanOrEqual(beat[0]);

        // Pressable with the plane in the document, which is what it is for: the
        // acknowledgment is offered during the motion, and the motion's own
        // surface is fixed over the whole viewport.
        expect(read.layers, 'the measurement never inserted the motion plane').toBe(1);
        expect(read.hitsButton, 'something is over the Continue').toBe(true);
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
          `beat motion Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    90_000,
  );

  browserIt(
    'keeps the stack clear of the Continue for a finger, which an inset never did',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-beat-touch-'));
      const file = join(directory, 'beat.html');
      await writeFile(file, page(), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of PHONE_VIEWPORTS) {
          const read = readingOf(
            await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              `beat motion ${String(width)}x${String(height)}`,
              undefined,
              true,
              { mobile: true, pointer: 'coarse' },
            ),
          );
          const at = `${String(width)}x${String(height)}`;
          const beat = present(read.beat, `beat box at ${at}`);
          const inkEnd = read.stackInkEnd;
          if (inkEnd === null) throw new Error(`the strip drew no entries at ${at}`);

          // The mechanism, stated so a revert reads as a change of mind rather
          // than a typo: a finger gets the seam back in flow, and a box in flow
          // ignores an inset.
          expect(read.seamPosition, `the seam is not in flow at ${at}`).toBe('static');
          expect(inkEnd, `the stack reaches under the Continue at ${at}`).toBeLessThanOrEqual(beat[0]);
          expect(read.hitsButton, `something is over the Continue at ${at}`).toBe(true);
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
          `beat touch Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    90_000,
  );
});
