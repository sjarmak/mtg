// @vitest-environment node
/**
 * Which way the auto-pass panel opens, as a pixel rather than as an intention.
 *
 * `mtg-rgc.13` moved the turn indicator to the left-hand end of the step bar,
 * where Magic Online writes it. The indicator is also the head of the auto-pass
 * disclosure (`src/routes/play/TurnStops.ts`), so the panel went with it, and
 * the bar's two neighbors in the near band are the viewer's own battlefield
 * above it and the viewer's own hand below it. The panel was anchored with
 * `inset-block-start`, which on a strip above the table opened it over the mat
 * and on this bar opens it over the hand.
 *
 * That is the failure mode the bead names, and it is worse than a general
 * occlusion: a stop exists so a player can hold up an instant, and the instant
 * they would hold up is a card in that hand. Covering it while they decide where
 * to be asked covers the evidence for the decision. So the panel opens upward
 * (`inset-block-end`), and what it covers instead is board state, which is read
 * rather than chosen from.
 *
 * Both arms are measured on one page, because the claim is about the direction
 * and not about the room: the second arm overrides the two properties back the
 * way they were and asserts the hand is buried. A change that reverts the
 * direction therefore fails the first arm, and a change that makes the panel
 * miss the hand for some unrelated reason fails the second.
 *
 * What it read, chrome-headless-shell 151.0.7922.47 on 2026-08-21, over a board
 * of nine permanents a side and a hand of seven. Square pixels covered:
 *
 *   viewport   panel        bar head   upward: mat / hand   downward: mat / hand
 *   1024x768   416x332.9    534.2      96,986 / 0           0 / 62,209
 *   1280x800   416x332.9    576.2      105,701 / 0          0 / 58,058
 *   1440x900   416x332.9    667.5      124,666 / 0          0 / 76,609
 *
 * The panel is the same size in both arms and at every viewport — 60dvh is
 * 460.8px at the shortest one and the panel wants 332.9 — so the reading is
 * about the anchor and nothing else.
 *
 * jsdom performs no layout — `getBoundingClientRect` is all zeros there — so
 * `./phase-bar.test.ts` can only assert the declaration and this file is what
 * says the two rectangles miss. The harness is `../support/chrome.ts`, the same
 * one `./ask-flyout.browser.test.ts` drives.
 *
 * **The panel is opened by injection**, which is the substitution
 * `../../tools/turn-stops-panel.ts` already makes for the same reason: whether
 * it is open is React state nothing outside the component can set, and a static
 * page has no React to click. What is injected is `turnStopsPanel`'s own output
 * into the shipped `.mtg-turnstops` anchor, so the class names, the sheet and
 * the anchor are all the shipped ones and only the state is faked.
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
import { turnStopsPanel } from '../../src/routes/play/TurnStops';
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
 * A board on both sides and a full hand, because the panel can only cover what
 * is drawn and the hand is the thing this file is about.
 */
function board(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: 4 }, (_unused, index) => ({
      card: spellAt(index),
      controller: controller as PlayerId,
      summoningSick: false,
    })),
    ...Array.from({ length: 5 }, () => ({
      card: MOUNTAIN,
      controller: controller as PlayerId,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: 'ui/stops-panel',
    battlefield,
    hands: [
      [LASH, LASH, spellAt(0), spellAt(1), spellAt(2), spellAt(3), MOUNTAIN],
      [LASH, spellAt(1), spellAt(2)],
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

const PANEL_MARKUP = renderToStaticMarkup(
  turnStopsPanel(
    {
      label: 'Turn 6: You',
      detail: 'precombat main phase',
      settings: DEFAULT_AUTO_PASS,
      onChange: () => undefined,
      canYield: true,
      onYield: () => undefined,
    },
    () => undefined,
  ),
);

/** What the component does when the head is pressed, done from outside React. */
const OPEN_SCRIPT = `<script>(function(){
  var host = document.querySelector('.mtg-turnstops');
  if (host === null) return;
  host.insertAdjacentHTML('beforeend', ${JSON.stringify(PANEL_MARKUP)});
  host.setAttribute('data-open', 'true');
})();</script>`;

/**
 * The arm that puts the anchor back the way `mtg-rgc.13` found it.
 *
 * Two declarations, applied after the sheet, so the only difference between the
 * two readings is the direction. `inset-block-end: auto` is needed as well as
 * the start: leaving both set pins the panel to the bar's whole height.
 */
const DOWNWARD = `<style>.mtg-turnstops__panel {
  inset-block-start: calc(100% + var(--mtg-space-1));
  inset-block-end: auto;
}</style>`;

function page(title: string, extra: string): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: board(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style>${extra}</head><body>${markup}${OPEN_SCRIPT}</body></html>`;
}

/**
 * One expression: the panel's box, the two zones either side of the bar, and how
 * much of each one it hides.
 *
 * Overlap in square pixels rather than as a boolean, because what the direction
 * decides is not whether something is covered — something always is — but which
 * surface pays. Both numbers are reported at every viewport for that reason.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const boxOf = (element) => {
    if (element === null || element === undefined) return null;
    const b = element.getBoundingClientRect();
    return { left: round(b.left), top: round(b.top), width: round(b.width), height: round(b.height), bottom: round(b.bottom), right: round(b.right) };
  };
  // A pixel of slack, for the subpixel remainder a flex column distributes.
  // Touching edges are not an overlap.
  const area = (one, two) => {
    if (one === null || two === null) return 0;
    const w = Math.min(one.right, two.right) - Math.max(one.left, two.left) - 1;
    const h = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top) - 1;
    return w > 0 && h > 0 ? Math.round(w * h) : 0;
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

  const panel = document.querySelector('.mtg-turnstops__panel');
  const bar = document.querySelector('.mtg-phasebar');
  const mine = document.querySelector(".mtg-board__side[data-seat='you']");
  const zones = mine === null ? [] : [...mine.querySelectorAll('.mtg-zone')];
  const named = (word) => zones.filter((zone) => (zone.getAttribute('aria-label') || '').toLowerCase().indexOf(word) >= 0)[0] || null;
  const hand = named('hand');
  const field = named('battlefield');
  const panelBox = boxOf(panel);
  const buttons = panel === null ? [] : [...panel.querySelectorAll('button')];

  return {
    viewport: [window.innerWidth, window.innerHeight],
    panel: panelBox,
    bar: boxOf(bar),
    hand: boxOf(hand),
    handLabel: hand === null ? null : hand.getAttribute('aria-label'),
    field: boxOf(field),
    fieldLabel: field === null ? null : field.getAttribute('aria-label'),
    coversHand: area(panelBox, boxOf(hand)),
    coversField: area(panelBox, boxOf(field)),
    aboveWindow: panelBox === null ? 0 : round(Math.max(0, -panelBox.top)),
    belowWindow: panelBox === null ? 0 : round(Math.max(0, panelBox.bottom - document.documentElement.clientHeight)),
    buttons: buttons.length,
    buttonsPressable: buttons.filter(hits).length,
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
  readonly panel: Box | null;
  readonly bar: Box | null;
  readonly hand: Box | null;
  readonly handLabel: string | null;
  readonly field: Box | null;
  readonly fieldLabel: string | null;
  readonly coversHand: number;
  readonly coversField: number;
  readonly aboveWindow: number;
  readonly belowWindow: number;
  readonly buttons: number;
  readonly buttonsPressable: number;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

describe('the auto-pass panel opens over the board rather than over the hand', () => {
  browserIt(
    'clears the cards a player is holding at every viewport, and stays on screen',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-stops-panel-'));
      const upward = join(directory, 'upward.html');
      const downward = join(directory, 'downward.html');
      await writeFile(upward, page('upward', ''), 'utf8');
      await writeFile(downward, page('downward', DOWNWARD), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const up = (await measurePage(
            chrome.client,
            upward,
            width,
            height,
            MEASURE,
            'upward',
          )) as unknown as Reading;
          const down = (await measurePage(
            chrome.client,
            downward,
            width,
            height,
            MEASURE,
            'downward',
          )) as unknown as Reading;
          console.log(
            `${where}: panel ${String(up.panel?.width ?? null)}x${String(up.panel?.height ?? null)} at ${String(up.panel?.top ?? null)}, bar head ${String(up.bar?.top ?? null)}, hand head ${String(up.hand?.top ?? null)}; upward covers ${String(up.coversHand)}px2 of the hand and ${String(up.coversField)}px2 of the battlefield, downward covers ${String(down.coversHand)}px2 and ${String(down.coversField)}px2`,
          );

          expect(up.viewport, `${where}: viewport`).toEqual([width, height]);
          expect(up.panel, `${where}: no panel was drawn`).not.toBeNull();
          expect(up.handLabel, `${where}: the viewer's hand was not found`).not.toBeNull();
          expect(up.fieldLabel, `${where}: the viewer's battlefield was not found`).not.toBeNull();

          // The claim, as two rectangles that miss each other.
          expect(
            up.coversHand,
            `${where}: the panel covers ${String(up.coversHand)} square pixels of ${String(up.handLabel)}`,
          ).toBe(0);

          // And it opens off the bar rather than somewhere else that happens to
          // miss the hand: its foot is on the bar's head, give or take the gap.
          expect(up.bar, `${where}: the bar was not drawn`).not.toBeNull();
          expect(
            (up.bar?.top ?? 0) - (up.panel?.bottom ?? 0),
            `${where}: the panel's foot is ${String(round((up.bar?.top ?? 0) - (up.panel?.bottom ?? 0)))}px from the bar`,
          ).toBeLessThan(16);

          // What it costs, stated rather than implied: the near battlefield is
          // what pays while the panel is open.
          expect(
            up.coversField,
            `${where}: the panel covers nothing at all, which means it is not where it is said to be`,
          ).toBeGreaterThan(0);

          // Whole, on screen, and worth opening. A panel that cleared the hand
          // by opening off the top of the window would pass everything above.
          expect(up.aboveWindow, `${where}: ${String(up.aboveWindow)}px of the panel is off the top`).toBe(0);
          expect(up.belowWindow, `${where}: ${String(up.belowWindow)}px of the panel is off the bottom`).toBe(
            0,
          );
          expect(up.buttons, `${where}: the panel drew no controls`).toBeGreaterThan(0);
          expect(
            up.buttonsPressable,
            `${where}: ${String(up.buttonsPressable)} of ${String(up.buttons)} panel controls can be pressed`,
          ).toBe(up.buttons);

          // The other direction, which is what the bead named and what this
          // arrangement is chosen against. If this ever reads zero, the two
          // readings are measuring the same thing and the first one proves
          // nothing.
          expect(
            down.coversHand,
            `${where}: opening downward covers none of the hand, so the direction decides nothing`,
          ).toBeGreaterThan(0);
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
          `stops panel Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
