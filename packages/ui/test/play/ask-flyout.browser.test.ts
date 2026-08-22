// @vitest-environment node
/**
 * The flyout may not cover the hand or the step bar, and that is a pixel.
 *
 * `mtg-li0o`. The shut ask column could pass priority and nothing else, so the
 * panel the column would have drawn is now drawn over the board's left edge
 * (`src/routes/play/ask-flyout.ts`). the playtester's constraint on it was one
 * sentence: it must not cover her hand or the step bar. That is the whole of
 * why this file exists — every other claim the lane makes is about markup and
 * is asserted in `./ask-flyout.test.ts`, and this one is about boxes.
 *
 * # What the cap is, and what it is measured against
 *
 * `src/styles/board/ask-flyout.ts` anchors the box to `.mtg-board__lanes` at
 * the top-left corner and caps it at a share of that column's height. The
 * lanes column is the opponent's band, the combat seam, and the viewer's band;
 * the step bar and the hand are the last two blocks of the viewer's band, so
 * they sit at the foot of the column and the cap is what keeps the box off
 * them. A share rather than a length because the column's height is the
 * viewport's, and a length that cleared the hand at 900px would sit on it at
 * 768px.
 *
 * The assertion is the clearance itself and not the share: the box's bottom
 * edge is above the step bar's top edge, and the box's rectangle misses the
 * viewer's hand entirely. A re-tune that moves the number passes; a re-tune
 * that puts a pixel of the box on either block fails.
 *
 * Measured in chrome-headless-shell over the played table on the DSL example
 * set, at the narrowest cell in the matrix and the widest:
 *
 * | viewport | flyout       | step bar head | clearance |
 * | -------- | ------------ | ------------: | --------: |
 * | 1024x768 | 416 x 326.7  |         534.2 |     158.7 |
 * | 1440x900 | 416 x 387.4  |         667.5 |     231.3 |
 *
 * The box is 416px against the 80px strip it hangs off, which is the trade the
 * bead asked for: the panel is read at a width the column could never give it
 * without taking that width from the board for the whole game.
 *
 * # And it has to be worth opening
 *
 * A box that clears the hand by being 4px tall would pass the sentence above
 * and fail the bead, so the same reading takes a whole legal move inside the
 * box and hit-tests it: the move's own center has to answer with the move.
 * That is the pair `./ask-column.browser.test.ts` already uses on the column,
 * for the same reason — a control that is drawn is not a control that can be
 * pressed.
 *
 * # Reaching the state
 *
 * The shut column is a `useState` (`src/routes/play/ask-collapse.ts`), so a
 * statically rendered page is always open. The script below flips the board's
 * own `data-ask` attribute, mounts the flyout wrapper React would have emitted
 * — rendered here from `askFlyout` rather than typed out, so it cannot drift
 * from the component — and moves the already-rendered panel node into it. The
 * alert takes the panel's place in the column the same way. That is the same
 * trick `./ask-column.browser.test.ts` uses to open a graveyard, and it is
 * sound for the same reason: what is injected is the component's own output.
 *
 * # Proved able to fail
 *
 * Run against `src/styles/board/ask-flyout.ts` broken one line at a time and
 * then put back:
 *
 *  - Widening the cap to `200%` fails the clearance at the narrowest viewport:
 *    `shut-4 at 1024x768: the flyout's foot is 526.8px below the step bar's
 *    head`.
 *  - Making the anchor `position: static`, which hands the box to the table
 *    instead, fails on the containment: `shut-4 at 1024x768: the flyout is
 *    drawn outside the lanes column`.
 *
 * The harness is `../support/chrome.ts`: jsdom performs no layout, so every box
 * here would be zeros and a flyout that clears the hand and one that buries it
 * would read the same.
 *
 * The neutral `@mtg/dsl` example set, so the file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { askAlert, askFlyout } from '../../src/routes/play/ask-flyout';
import type { AskSlot } from '../../src/routes/play/ask-flyout';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-emberflow-raider'),
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
] as const;
const MOUNTAIN = exampleCard('slc-mountain');
const LASH = exampleCard('slc-lightning-lash');

function spellAt(index: number): Card {
  return SPELLS[index % SPELLS.length] ?? SPELLS[0];
}

/**
 * A crowded board with a full hand, which is the position the constraint is about.
 *
 * The hand is never empty: an empty zone draws a short block, and the whole
 * question is whether the box reaches the cards a player is holding.
 */
function board(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: spellAt(index),
      controller: controller as PlayerId,
      summoningSick: false,
    })),
    ...Array.from({ length: 7 }, () => ({
      card: MOUNTAIN,
      controller: controller as PlayerId,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/ask-flyout-${String(perSide)}`,
    battlefield,
    hands: [
      [LASH, LASH, spellAt(0), spellAt(1), spellAt(2), spellAt(3), MOUNTAIN],
      [LASH, spellAt(1), spellAt(2), spellAt(3), spellAt(0)],
    ],
    active: 0,
    turn: 6,
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

/** The slot a priority window puts the strip in. The count is the enumeration's. */
const SLOT: AskSlot = { kind: 'decision', count: 12 };

const SHUT_SCRIPT = `<script>(function(){
  var mat = document.querySelector('.mtg-board');
  var pods = document.querySelector('.mtg-board__pods');
  var lanes = document.querySelector('.mtg-board__lanes');
  var panel = document.querySelector('.mtg-board__pods > .mtg-prompt');
  if (mat === null || pods === null || lanes === null || panel === null) return;
  mat.setAttribute('data-ask', 'shut');
  panel.insertAdjacentHTML('beforebegin', ${JSON.stringify(renderToStaticMarkup(askAlert(SLOT, true, () => undefined)))});
  lanes.insertAdjacentHTML('beforeend', ${JSON.stringify(renderToStaticMarkup(askFlyout(true, SLOT, null)))});
  var box = lanes.querySelector('.mtg-ask-flyout');
  if (box !== null) box.appendChild(panel);
})();</script>`;

function page(game: GameSession, title: string, extra: string): string {
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}${extra}</body></html>`;
}

/**
 * One expression, so the driver is a navigate and one `Runtime.evaluate`.
 *
 * Clearance is asked as an intersection of rectangles rather than as a pair of
 * edges, because the box is positioned in two axes and a rule that moved it
 * sideways onto the hand would pass an edge test on the vertical alone.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const boxOf = (element) => {
    if (element === null || element === undefined) return null;
    const b = element.getBoundingClientRect();
    return { left: round(b.left), top: round(b.top), width: round(b.width), height: round(b.height), bottom: round(b.bottom), right: round(b.right) };
  };
  const hits = (element) => {
    if (element === null) return false;
    const b = element.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    if (x < 0 || y < 0 || x > document.documentElement.clientWidth || y > document.documentElement.clientHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return hit !== null && (hit === element || element.contains(hit));
  };
  // A pixel of slack, for the subpixel rounding a flex column does when it
  // distributes a remainder. Touching edges are not an overlap.
  const overlaps = (one, two) => one !== null && two !== null &&
    one.left < two.right - 1 && one.right > two.left + 1 &&
    one.top < two.bottom - 1 && one.bottom > two.top + 1;

  const flyout = document.querySelector('.mtg-board__lanes > .mtg-ask-flyout');
  const lanes = document.querySelector('.mtg-board__lanes');
  const pods = document.querySelector('.mtg-board__pods');
  const steps = document.querySelector('.mtg-phasebar');
  const mine = document.querySelector(".mtg-board__side[data-seat='you']");
  const zones = mine === null ? [] : [...mine.querySelectorAll('.mtg-zone')];
  const hand = zones.filter((zone) => (zone.getAttribute('aria-label') || '').toLowerCase().indexOf('hand') >= 0)[0] || null;

  const flyoutBox = boxOf(flyout);
  const panel = flyout === null ? null : flyout.querySelector('.mtg-prompt');
  const choices = flyout === null ? [] : [...flyout.querySelectorAll('button.mtg-choice')];
  const flyoutRect = flyout === null ? null : flyout.getBoundingClientRect();
  const whole = choices.filter((choice) => {
    if (flyoutRect === null) return false;
    const b = choice.getBoundingClientRect();
    return b.top >= flyoutRect.top - 0.5 && b.bottom <= flyoutRect.bottom + 0.5 && hits(choice);
  });

  const alert = document.querySelector('.mtg-board__pods .mtg-ask-alert button');
  const columnPanels = pods === null ? 0 : pods.querySelectorAll(':scope > .mtg-panel').length;

  return {
    viewport: [window.innerWidth, window.innerHeight],
    flyout: flyoutBox,
    lanes: boxOf(lanes),
    pods: boxOf(pods),
    steps: boxOf(steps),
    hand: boxOf(hand),
    handLabel: hand === null ? null : hand.getAttribute('aria-label'),
    panelDrawn: panel !== null,
    coversSteps: overlaps(flyoutBox, boxOf(steps)),
    coversHand: overlaps(flyoutBox, boxOf(hand)),
    insideLanes: flyoutBox === null || boxOf(lanes) === null ? false :
      (flyoutBox.top >= boxOf(lanes).top - 1 && flyoutBox.bottom <= boxOf(lanes).bottom + 1 &&
       flyoutBox.left >= boxOf(lanes).left - 1 && flyoutBox.right <= boxOf(lanes).right + 1),
    moves: choices.length,
    movesWhole: whole.length,
    alertReachable: hits(alert),
    alertName: alert === null ? null : alert.getAttribute('aria-label'),
    columnPanels: columnPanels,
  };
})()`;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly bottom: number;
  readonly right: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly flyout: Box | null;
  readonly lanes: Box | null;
  readonly pods: Box | null;
  readonly steps: Box | null;
  readonly hand: Box | null;
  readonly handLabel: string | null;
  readonly panelDrawn: boolean;
  readonly coversSteps: boolean;
  readonly coversHand: boolean;
  readonly insideLanes: boolean;
  readonly moves: number;
  readonly movesWhole: number;
  readonly alertReachable: boolean;
  readonly alertName: string | null;
  readonly columnPanels: number;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const CROWDINGS = [4, 12] as const;

describe('the ask flyout clears the hand and the step bar at every viewport', () => {
  browserIt(
    'draws a pressable move over the board without covering what a player holds',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-flyout-'));
      const positions: { readonly label: string; readonly file: string }[] = [];
      for (const perSide of CROWDINGS) {
        const label = `shut-${String(perSide)}`;
        const file = join(directory, `${label}.html`);
        await writeFile(file, page(board(perSide), label, SHUT_SCRIPT), 'utf8');
        positions.push({ label, file });
      }

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const position of positions) {
          for (const [width, height] of VIEWPORTS) {
            const where = `${position.label} at ${String(width)}x${String(height)}`;
            const result = (await measurePage(
              chrome.client,
              position.file,
              width,
              height,
              MEASURE,
              position.label,
            )) as unknown as Reading;
            console.log(
              `${where}: flyout ${String(result.flyout?.width ?? null)}x${String(result.flyout?.height ?? null)} at ${String(result.flyout?.top ?? null)}, strip ${String(result.pods?.width ?? null)}, steps head ${String(result.steps?.top ?? null)}, hand head ${String(result.hand?.top ?? null)}, moves ${String(result.movesWhole)}/${String(result.moves)}`,
            );

            expect(result.viewport, `${where}: viewport`).toEqual([width, height]);

            // The injection landed, and the panel it moved is not also still in
            // the column: one panel drawn twice is two move lists for a screen
            // reader and two answers to one question.
            expect(result.flyout, `${where}: no flyout was drawn`).not.toBeNull();
            expect(result.panelDrawn, `${where}: the flyout is empty`).toBe(true);
            expect(
              result.columnPanels,
              `${where}: the shut column still draws ${String(result.columnPanels)} panel(s)`,
            ).toBe(0);

            // The playtester's sentence, as two rectangles that miss each other.
            expect(result.handLabel, `${where}: the viewer's hand was not found`).not.toBeNull();
            expect(result.steps, `${where}: the step bar was not drawn`).not.toBeNull();
            const foot = result.flyout?.bottom ?? 0;
            const stepHead = result.steps?.top ?? 0;
            expect(
              result.coversSteps,
              `${where}: the flyout's foot is ${String(round(foot - stepHead))}px below the step bar's head`,
            ).toBe(false);
            expect(result.coversHand, `${where}: the flyout covers ${String(result.handLabel)}`).toBe(false);

            // And it stays on the table it is anchored to, rather than painting
            // over the rail or off the window.
            expect(result.insideLanes, `${where}: the flyout is drawn outside the lanes column`).toBe(true);

            // Worth opening. A box that cleared the hand by being 4px tall would
            // pass every assertion above.
            expect(result.moves, `${where}: the flyout enumerated no moves at all`).toBeGreaterThan(0);
            expect(
              result.movesWhole,
              `${where}: the flyout shows no whole clickable move (${String(result.moves)} enumerated)`,
            ).toBeGreaterThan(0);

            // Wider than the strip it hangs off, which is the whole point of
            // drawing it over the board instead of widening the column.
            expect(
              result.flyout?.width ?? 0,
              `${where}: the flyout is ${String(result.flyout?.width ?? 0)}px against a ${String(result.pods?.width ?? 0)}px strip`,
            ).toBeGreaterThan(result.pods?.width ?? 0);

            // The other half of the bead: the strip says something is owed
            // whether or not the box is on screen, and the sentence is its name.
            expect(result.alertReachable, `${where}: the alert on the strip cannot be pressed`).toBe(true);
            expect(result.alertName, `${where}: the alert has no name`).toContain('waiting');
          }
        }
      } catch (error: unknown) {
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
          `ask flyout Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
