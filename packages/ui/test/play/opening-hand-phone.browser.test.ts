// @vitest-environment node
/**
 * The opening hand on a phone held sideways, which is where a decision was a
 * scrolling box.
 *
 * The box's height was already bounded — `../../src/styles/board/ask-flyout.ts`
 * pins it to the block-start of the lanes and caps it at 46% of them, so that it
 * may not cover her hand or the step bar — and that is exactly what made the
 * defect: the cap was spent on the whole panel at once, and the part that fell
 * out of the bottom was the part that answers the question.
 *
 * So this file asserts the property rather than the height. At 844x390, with the
 * ask column shut and the flyout drawn: every answer the kernel enumerated is a
 * button inside the flyout with nothing scrolled, each clears
 * `../../src/styles/touch.ts`'s coarse floor, and the panel itself does not
 * scroll — whatever the sentence above them does. The explanation is allowed to
 * scroll, and that is the trade spec section 11 states: a region may scroll and
 * a primary control may not.
 *
 * **The browser is told it is a phone.** The 44px floor is a `pointer: coarse`
 * rule, so a rig on a fine pointer would measure a button 7px short of it and
 * report a failure the device does not have. `../support/chrome.ts` takes the
 * device for that reason.
 *
 * **The shut state is written onto the markup**, for the reason
 * `./landscape-phone.browser.test.ts` gives: it is a preference read at render
 * time and this page is static markup.
 *
 * **And the flyout is assembled in the page**, which is one step further than
 * that and is worth saying plainly. `useAskFlyout` resolves the column's state
 * against a media query on mount, so a server-rendered page carries the panel in
 * the column and no flyout at all whatever is written onto `data-ask`. The
 * measurement script therefore does to the DOM exactly what
 * `../../src/routes/play/ask-flyout.ts`'s `askFlyout` does to the tree — moves
 * the rendered panel, unaltered, into a `.mtg-ask-flyout` region appended to the
 * lanes — and then measures. What is under test is the geometry the sheet gives
 * that box and the panel inside it, and both are reached from the real markup of
 * a real opening hand; what is faked is only which of two containers React put
 * the panel in.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { createSession, DEFAULT_AUTO_PASS, FULL_CONTROL } from '@mtg/kernel';
import type { GameSession } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { ASK_FLYOUT_LABEL } from '../../src/routes/play/ask-flyout';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { PlayView } from '../../src/routes/play/PlayView';
import { TOUCH_TARGET_PX } from '../../src/styles/touch';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/**
 * The one position no `scenario` spec reaches: what `createSession` stops at
 * before the first turn. A real deal for that reason, the same one
 * `./ask-flyout.test.ts` gives where it drives the same decision without a
 * browser.
 */
function openingHand(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const session = createSession(game.config.setup, game.config.seats, { autoPass: FULL_CONTROL });
  if (session.pending?.kind !== 'mulligan') throw new Error('the deal did not stop at the opening hand');
  return session;
}

function page(game: GameSession): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      notice: 'Partial set: 162 of 249 cards.',
      children: h(
        'div',
        { className: 'mtg-play-route' },
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
  const staged = markup.replace('data-ask="open"', 'data-ask="shut"');
  if (staged === markup) {
    throw new Error('the mat did not carry the ask column open, so the shut state cannot be written onto it');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Opening hand</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${staged}</body></html>`;
}

/**
 * Where the answers are, read against the box that holds them.
 *
 * `below` is signed against the flyout's own bottom edge rather than the
 * viewport's, because the flyout is what was clipping them: a button under that
 * line is off screen whatever the page around it does. `scrolled` is the panel's
 * own overflow — the thing that used to hide them — and it is reported apart
 * from the body's, which is allowed to scroll and which the explanation does.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const lanes = document.querySelector('.mtg-board__lanes');
  const staged = document.querySelector('.mtg-board__pods .mtg-prompt');
  if (lanes === null || staged === null) return null;
  const box = document.createElement('div');
  box.className = 'mtg-ask-flyout';
  box.setAttribute('data-slot', 'decision');
  box.setAttribute('role', 'region');
  box.setAttribute("aria-label", "${ASK_FLYOUT_LABEL}");
  box.appendChild(staged);
  lanes.appendChild(box);
  const flyout = box;
  const rect = flyout.getBoundingClientRect();
  const panel = flyout.querySelector('.mtg-prompt');
  const body = flyout.querySelector('.mtg-prompt > .mtg-panel__body');
  const explain = flyout.querySelector('.mtg-prompt__explain');
  const actions = [...flyout.querySelectorAll('.mtg-choice')];
  const heads = [...flyout.querySelectorAll('.mtg-choices__group-title')].map((node) => node.textContent);
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    viewportHeight: window.innerHeight,
    flyoutHeight: round(rect.height),
    flyoutBelow: round(rect.bottom - window.innerHeight),
    panelScroll: panel === null ? null : round(panel.scrollHeight - panel.clientHeight),
    bodyScroll: body === null ? null : round(body.scrollHeight - body.clientHeight),
    explainDrawn: explain === null ? 0 : round(explain.getBoundingClientRect().height),
    actionCount: actions.length,
    actionHeights: actions.map((node) => round(node.getBoundingClientRect().height)),
    actionBelow: actions.reduce(
      (worst, node) => Math.max(worst, round(node.getBoundingClientRect().bottom - rect.bottom)),
      0,
    ),
    actionLabels: actions.map((node) => node.getAttribute('aria-label') ?? node.textContent),
    headings: heads,
    listScroll: actions.reduce((worst, node) => {
      const list = node.parentElement;
      return list === null ? worst : Math.max(worst, round(list.scrollHeight - list.clientHeight));
    }, 0),
  };
})()`;

interface Reading {
  readonly coarse: boolean;
  readonly viewportHeight: number;
  readonly flyoutHeight: number;
  readonly flyoutBelow: number;
  readonly panelScroll: number | null;
  readonly bodyScroll: number | null;
  readonly explainDrawn: number;
  readonly actionCount: number;
  readonly actionHeights: readonly number[];
  readonly actionBelow: number;
  readonly actionLabels: readonly string[];
  readonly headings: readonly string[];
  readonly listScroll: number;
}

/** An iPhone 14 sideways, which is the narrowest, and a Pro Max, which is not. */
const LANDSCAPE = [
  [844, 390],
  [932, 430],
] as const;

/** Rounding slack, the same half pixel the other board rigs compare on. */
const SLACK_PX = 0.5;

describe('the opening hand on a phone held sideways', () => {
  browserIt(
    'answers from a foot that is drawn, not from under the fold',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-opening-hand-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-opening-hand-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'opening-hand.html');
      await writeFile(file, page(openingHand()), 'utf8');
      try {
        for (const [width, height] of LANDSCAPE) {
          const at = `${String(width)}x${String(height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            at,
            '.mtg-board__pods .mtg-prompt',
            true,
            { mobile: true, pointer: 'coarse' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error('the opening hand drew no prompt to put in a flyout');
          expect(seen.coarse, `${at}: the rig is emulating a finger`).toBe(true);

          expect(seen.actionCount, `${at}: the prompt does not hold every answer`).toBe(3);
          expect(seen.actionLabels.join(' | '), `${at}: the keep is not one of them`).toContain('Keep');
          expect(seen.actionLabels.join(' | '), `${at}: concede is not one of them`).toContain('Concede');

          // The whole complaint: reaching either answer took a scroll.
          expect(seen.actionBelow, `${at}: an answer is under the box`).toBeLessThanOrEqual(SLACK_PX);
          expect(
            seen.panelScroll ?? 0,
            `${at}: the panel scrolls, so the foot can leave`,
          ).toBeLessThanOrEqual(SLACK_PX);
          expect(seen.listScroll, `${at}: the answers scroll inside their own row`).toBeLessThanOrEqual(
            SLACK_PX,
          );
          expect(seen.flyoutBelow, `${at}: the box itself is under the viewport`).toBeLessThanOrEqual(
            SLACK_PX,
          );

          // And not bought by shrinking the thing a finger presses.
          for (const tall of seen.actionHeights) {
            expect(tall, `${at}: an answer is under the touch floor`).toBeGreaterThanOrEqual(
              TOUCH_TARGET_PX - SLACK_PX,
            );
          }

          // The sentence is still drawn — the foot is not a fix that deleted the
          // half of the panel that says what the decision costs.
          expect(seen.explainDrawn, `${at}: the explanation is not drawn`).toBeGreaterThan(0);

          expect(seen.headings, `${at}: the decision is drawn under a section heading`).toEqual([]);
        }
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

  browserIt(
    'refuses to measure a phone from a page with no viewport tag',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-opening-hand-untagged-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-opening-hand-untagged-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'untagged.html');
      const tagged = page(openingHand());
      const untagged = tagged.replace(/<meta name="viewport"[^>]*>/, '');
      expect(untagged).not.toBe(tagged);
      await writeFile(file, untagged, 'utf8');
      try {
        await expect(
          measurePage(
            chrome.client,
            file,
            844,
            390,
            MEASURE,
            '844x390',
            '.mtg-board__pods .mtg-prompt',
            true,
            {
              mobile: true,
              pointer: 'coarse',
            },
          ),
        ).rejects.toThrow(
          'has no viewport meta tag; serve <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        );
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
