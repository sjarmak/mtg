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
 * The second test is the other end of the same sentence — what happens once
 * the ladder has run out — and `LONG_WORD` below carries its argument.
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
 * And with `overflow-wrap: break-word` deleted from the same rule, which is
 * the declaration the second test exists for:
 *
 *     "Cast EmberflowThornhideWindriderLightning" draws 174px inside a 130px
 *     column, so it is past the column's edge: expected 174 to be less than
 *     or equal to 130
 *
 * At 1440x900, the widest column the table has, so it is past the edge at
 * every width below it too.
 *
 * The neutral `@mtg/dsl` example set, so the file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
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
 * One word no column on this surface can hold, built out of the set's own.
 *
 * `mtg-o0ke`. The ladder above is the step before the last resort; this is the
 * last resort. `src/styles/ask-fit.ts` states its own floor — at the bottom
 * rung a nine-character word wants about 45px, so a word past roughly thirteen
 * characters still breaks in a narrow column — and `overflow-wrap: break-word`
 * on `.mtg-choice__label` is what happens then. Nothing measured it, so the
 * next stylesheet edit could drop the declaration and the suite would stay
 * green.
 *
 * The fixture is the whole difficulty. Every name in the neutral example set
 * fits its column at full size, so an assertion written against that data
 * passes with the rule and without it, which is worse than no test. So the
 * name is synthetic and says so: the first word of four example cards run
 * together, 36 characters, no set would print it, and that is the point.
 *
 * Sized against a measurement rather than a guess, and the run re-measures it
 * rather than trusting this paragraph. The label is at the ladder's bottom
 * rung at every width the table supports, so 9.1px type gives a character
 * about 4.8px and the word wants 173.6px, against columns of 130px at
 * 1440x900 and 1280x800, 111px at 1024x768 and 77px at 810x1080. A first
 * draft used three words and 27 characters, which wanted 132.8px and cleared
 * the widest column by 2.8 - a fixture that would stop being pathological the
 * next time the ask column got wider, and the sanity assertion below caught
 * it. The test builds a `white-space: pre` probe in the label's own computed
 * font and fails if the word turns out to fit after all.
 */
const LONG_WORD = [RAIDER, GUARDIAN, DRAKE, LASH]
  .map((card) => card.name.split(' ')[0] ?? card.name)
  .join('');

// Through `parseCard`, like every card in the example set it is built from,
// so a fixture that stops being a legal card fails at import rather than
// drawing something the surface would never be handed.
const LONG: Card = parseCard({
  kind: 'creature',
  id: 'ask-fit-long-word',
  name: LONG_WORD,
  rarity: 'common',
  set: { code: RAIDER.set.code, collectorNumber: 99 },
  manaCost: { R: 1 },
  colors: ['R'],
  subtypes: ['Beast'],
  power: 1,
  toughness: 1,
});

/**
 * A board with something on it and a hand worth playing from.
 *
 * `tools/touch-targets.ts`'s position, because that is the parked table the
 * measurements in `src/styles/ask-fit.ts` were taken on and this file is the
 * gate under them. Four permanents a side plus a mana base, so the prompt
 * enumerates a list of moves whose labels carry card names rather than a pass
 * and a concession.
 */
function skirmish(extra: readonly Card[] = []): GameSession {
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
      [MOUNTAIN, RAIDER, LASH, GUARDIAN, DRAKE, ...extra],
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
 * The overflow reading, and the probe that keeps it from being vacuous.
 *
 * `need` is the width the longest word wants when nothing may wrap it: a
 * `white-space: pre` span in the label's own computed font, measured and
 * removed. `client` is the column the label actually got. A fixture where
 * `need` is not comfortably over `client` is not testing `overflow-wrap` at
 * all, so the run asserts that first and the rule second.
 */
interface Overflow {
  readonly viewport: readonly [number, number];
  readonly text: string;
  readonly font: number;
  readonly scroll: number;
  readonly client: number;
  readonly need: number;
  readonly lines: number;
}

function overflowScript(word: string): string {
  return `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const word = ${JSON.stringify(word)};
  let found = null;
  for (const element of document.querySelectorAll('.mtg-prompt .mtg-choice__label')) {
    if (element.textContent.includes(word)) { found = element; break; }
  }
  if (found === null) throw new Error('no move label carries the long word');
  const style = getComputedStyle(found);
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.left = '-9999px';
  probe.style.top = '0';
  probe.style.whiteSpace = 'pre';
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  probe.textContent = word;
  document.body.appendChild(probe);
  const need = probe.getBoundingClientRect().width;
  probe.remove();
  const box = found.getBoundingClientRect();
  const line = parseFloat(style.lineHeight);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    text: found.textContent,
    font: round(parseFloat(style.fontSize)),
    scroll: found.scrollWidth,
    client: found.clientWidth,
    need: round(need),
    lines: Number.isFinite(line) && line > 0 ? Math.round(box.height / line) : 0,
  };
})()`;
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

  browserIt(
    'keeps a word too long for any rung inside the column instead of past its edge',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-break-'));
      const file = join(directory, 'break-word.html');
      await writeFile(file, page(skirmish([LONG]), 'break-word'), 'utf8');

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
            overflowScript(LONG_WORD),
            where,
          )) as unknown as Overflow;
          console.log(
            `${where}: ${String(LONG_WORD.length)} characters want ${String(result.need)}px in a ${String(result.client)}px column at ${String(result.font)}px, drawn ${String(result.scroll)}px over ${String(result.lines)} lines`,
          );

          expect(result.viewport, `${where}: viewport`).toEqual([width, height]);
          // The fixture, before the rule. A word that fits is a word this test
          // learns nothing from, and the example set is full of them.
          expect(
            result.need,
            `${where}: the fixture word wants only ${String(result.need)}px and the column is ${String(result.client)}px, so nothing here is being contained`,
          ).toBeGreaterThan(result.client * 1.2);
          // The bead. Without `overflow-wrap: break-word` the word is one
          // unbreakable line and the label's scroll width is the word's.
          expect(
            result.scroll,
            `${where}: ${JSON.stringify(result.text)} draws ${String(result.scroll)}px inside a ${String(result.client)}px column, so it is past the column's edge`,
          ).toBeLessThanOrEqual(result.client);
          // And it was broken rather than clipped: a single line at this width
          // would mean the overflow was hidden, not wrapped.
          expect(
            result.lines,
            `${where}: the long word was contained on one line, which is a clip and not a break`,
          ).toBeGreaterThan(1);
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
          `break-word Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
