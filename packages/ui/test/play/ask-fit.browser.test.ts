// @vitest-environment node
/**
 * A move label shrinks before it breaks, and the browser is the only witness.
 *
 * `mtg-xgw`. `src/styles/views.ts` gave `.mtg-choice__label` `overflow-wrap:
 * break-word` so a long label could not escape the ask column, and nothing came
 * before it, so at the narrow viewport the last resort fired on ordinary card
 * names: eight of ten labels started a line inside a word, `Mountai` over a lone
 * `n`. `src/styles/ask-fit.ts` puts a ladder in front of it — the label steps
 * down a scale as its button narrows, and break-word is what happens after the
 * ladder runs out.
 *
 * Which rung fires is a container query, so only a browser can answer it.
 * `../support/chrome.ts` is the harness for the reason every `.browser.test.ts`
 * in this directory names: jsdom performs no layout, every box would be zeros,
 * and a label that wrapped cleanly and one that split a word would read the
 * same. The arithmetic half is `ask-fit.test.ts`.
 *
 * # How a mid-word break is detected
 *
 * Not from the text and not from the box: each character is measured with its
 * own `Range`, the rects are grouped into line boxes by their top edge, and a
 * line that begins on a non-space whose predecessor is also a non-space is a
 * break taken inside a word. That reads what the browser actually did rather
 * than re-deriving where it should have wrapped, which is the same instrument
 * `tools/rail-split.ts` uses on the same column.
 *
 * # What is asserted, and what is left to the tool
 *
 * Three properties, not the pixel table. No label breaks inside a word at any
 * viewport the table supports; no label is set below the ladder's own floor,
 * because a rung past the bottom is not a fit but a disappearance; and where
 * the column is wide enough every label is still at full size, which is the
 * half a ladder gets wrong by taxing the widths that never needed it.
 * `tools/rail-split.ts` prints the numbers.
 *
 * # Proved able to fail
 *
 * With the `font-size` on `.mtg-choice__label` in `src/styles/views.ts` cut
 * back to `var(--mtg-text-sm)` — the ladder computed, published and ignored —
 * and then put back by hand:
 *
 *     9 move labels break inside a word at 810x1080: ["Mountai|n","Emberfl|ow
 *     Raid","Emberfl|ow Raid","Thornhi|de Guar","Guardia|n","Windrid|er
 *     Drak","Emberfl|ow Raid","Mountai|n for R","Mountai|n for R"]: expected
 *     [ Array(9) ] to deeply equal []
 *
 * Nine breaks over eight labels, because one two-word name is broken twice.
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
import type { GameSession } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { ASK_FIT_STEPS, askFitScale } from '../../src/styles/ask-fit';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/** `--mtg-text-sm` in px, which is the size a label keeps when no rung fires. */
const LABEL_PX = 0.8125 * 16;

/**
 * A board with something on it and a hand worth playing from.
 *
 * `tools/touch-targets.ts`'s position, because that is the parked table the
 * measurements in `src/styles/ask-fit.ts` were taken on and this file is the
 * gate under them. Four permanents a side plus a mana base, so the prompt
 * enumerates a list of moves whose labels carry card names rather than a pass
 * and a concession.
 */
function skirmish(): GameSession {
  const built = scenario({
    seed: 'ui/ask-fit',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0, tapped: true },
      { card: MOUNTAIN, controller: 1 },
      { card: MOUNTAIN, controller: 1 },
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: GUARDIAN, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
      { card: RAIDER, controller: 1, summoningSick: false },
    ],
    hands: [
      [MOUNTAIN, RAIDER, LASH, GUARDIAN, DRAKE],
      [MOUNTAIN, RAIDER],
    ],
    active: 0,
    turn: 4,
  });
  const pending = pendingDecision(built.state);
  if (pending === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function page(game: GameSession, title: string): string {
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  // Per-character rects grouped into line boxes, which is what the browser did
  // rather than what a re-derivation thinks it should have done.
  const rows = (node) => {
    const text = node.textContent;
    const range = document.createRange();
    const found = [];
    for (let at = 0; at < text.length; at += 1) {
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const rects = range.getClientRects();
      if (rects.length === 0) continue;
      const rect = rects[0];
      if (rect.width < 0.01 && rect.height < 0.01) continue;
      const previous = found[found.length - 1];
      if (previous === undefined || Math.abs(previous.top - rect.top) > 1) {
        found.push({ top: rect.top, start: at });
      }
    }
    return found;
  };
  const labels = [];
  const midWord = [];
  for (const element of document.querySelectorAll('.mtg-prompt .mtg-choice__label')) {
    const node = element.firstChild;
    if (node === null || node.nodeType !== 3) continue;
    const text = node.textContent;
    const lines = rows(node);
    for (let line = 1; line < lines.length; line += 1) {
      const start = lines[line].start;
      const before = text[start - 1];
      if (before === undefined || /\\s/.test(before) || /\\s/.test(text[start])) continue;
      midWord.push(text.slice(Math.max(0, start - 7), start) + '|' + text.slice(start, start + 7));
    }
    const button = element.closest('.mtg-choice');
    labels.push({
      text: text,
      width: round(element.getBoundingClientRect().width),
      button: button === null ? 0 : round(button.getBoundingClientRect().width),
      font: round(parseFloat(getComputedStyle(element).fontSize)),
      lines: lines.length,
    });
  }
  return { viewport: [window.innerWidth, window.innerHeight], labels: labels, midWord: midWord };
})()`;

interface Label {
  readonly text: string;
  readonly width: number;
  readonly button: number;
  readonly font: number;
  readonly lines: number;
}

interface Reading {
  readonly viewport: readonly [number, number];
  readonly labels: readonly Label[];
  readonly midWord: readonly string[];
}

/**
 * The widths the played table supports, narrowest last.
 *
 * 810x1080 is the iPad in portrait and the cell that decides this bead: it is
 * where the ask column reaches its own floor and where every one of the eight
 * mid-word breaks was. 1440x900 is the other end, and it is here to catch the
 * ladder firing where there was room all along.
 */
const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [810, 1080],
] as const;

/** The widest viewport, where a rung that fires is a rung that taxed a reader. */
const ROOMY = 1440;

describe('a move label shrinks down its ladder before it breaks a word', () => {
  browserIt(
    'takes no mid-word break at any supported width and stays whole where there is room',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-fit-'));
      const file = join(directory, 'ask-fit.html');
      await writeFile(file, page(skirmish(), 'ask-fit'), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const result = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            where,
          )) as unknown as Reading;
          console.log(
            `${where}: ${String(result.labels.length)} labels, button ${String(result.labels[0]?.button ?? 0)}px, label ${String(result.labels[0]?.width ?? 0)}px, type ${[...new Set(result.labels.map((label) => label.font))].join('/')}px, worst ${String(result.labels.reduce((most, label) => Math.max(most, label.lines), 0))} lines, ${String(result.midWord.length)} mid-word`,
          );

          expect(result.viewport, `${where}: viewport`).toEqual([width, height]);
          // The position has to have labels in it or every assertion below is
          // vacuous, and a prompt that enumerated nothing is its own bug.
          expect(result.labels.length, `${where}: the position enumerated no moves`).toBeGreaterThan(0);

          // The bead. A line that begins inside a word is the failure, whatever
          // the label is and however many lines it took.
          expect(
            result.midWord,
            `${String(result.midWord.length)} move labels break inside a word at ${where}: ${JSON.stringify(result.midWord)}`,
          ).toEqual([]);

          for (const label of result.labels) {
            // The floor of the ladder, as the px a reader gets. A rung past the
            // bottom is not a fit; it is text that has stopped being text.
            expect(
              label.font,
              `${where}: ${JSON.stringify(label.text)} is set at ${String(label.font)}px, under the ladder's floor`,
            ).toBeGreaterThanOrEqual(LABEL_PX * askFitScale(ASK_FIT_STEPS.length - 1) - 0.1);
            expect(
              label.font,
              `${where}: ${JSON.stringify(label.text)} is set at ${String(label.font)}px, over full size`,
            ).toBeLessThanOrEqual(LABEL_PX + 0.1);
            // And the ladder is off where the column has room. The tax a fit
            // ladder levies on the widths that never needed it is the other
            // half of getting this wrong, and it is silent.
            if (width >= ROOMY) {
              expect(
                label.font,
                `${where}: ${JSON.stringify(label.text)} was shrunk to ${String(label.font)}px in a ${String(label.button)}px button`,
              ).toBe(LABEL_PX);
            }
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
          `ask fit Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
