// @vitest-environment node
/**
 * What a landscape phone stops drawing, and what it refuses to stop drawing.
 *
 * `mtg-aqxi.21`. Three blocks on the played table were, at 844x390, spending
 * their height printing text that could not be read in the space they had. All
 * three were found by measuring the page rather than by looking at it, and each
 * number below is the reading that decided the rule:
 *
 *  1. **The shut ask column is a 48px strip, and the graveyard browsers were
 *     still in it.** `../../src/styles/board/rail.ts` already stopped drawing
 *     the panel, the play-meta line and the pod names in the shut state and
 *     missed the two browsers because they are a `.mtg-zone` rather than a
 *     `.mtg-panel`. Measured: 93px and 100px of content behind `overflow:
 *     hidden` in a 48px strip, so both seats' graveyards were drawn as a title
 *     cut through the middle of a letter for the whole game.
 *  2. **The pod chips were 2.5px over.** The pair wanted 99.9px in a 97.4px row,
 *     and 2.5px came out of the two words rather than out of the gap between
 *     them: `Ha… 7` over `Libra… 53`. `../../src/styles/mobile.ts` tightens the
 *     gaps instead, and the pair lays out at 87.9.
 *  3. **The stack's sentence was 345px of parts in a 214px row.** One part of it
 *     is a card name and the rest are words this codebase wrote, so the name is
 *     the part that gives — but only down to a floor, because with no floor it
 *     took the whole 131px deficit and measured 2px wide, which is a sentence
 *     that says "aimed at" and then nothing. The closing "resolves next" comes
 *     off the table entirely: the top entry already wears the accent and is the
 *     only one with a Resolve button beside it.
 *
 * The shut state is set here rather than pressed, because the initial state is a
 * media query read in an effect and this page is static markup. The rule under
 * test is the CSS, and the attribute is what the CSS reads.
 *
 * Both arms of each claim are asserted. A rule that stopped drawing the strip's
 * contents at every height, or dropped the closing word off a desktop, would
 * pass on the phone reading alone.
 *
 * jsdom performs no layout, so none of this is measurable there; the harness is
 * `../support/chrome.ts`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { FIXTURE_NAMES, stackedBoard, VIEWER } from '../../src/dev/fixtures/board';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: stackedBoard(),
        viewer: VIEWER,
        names: FIXTURE_NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Short strip</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading per ask state, taken from the same layout.
 *
 * The chips are read with the column open because the shut state stops drawing
 * them: the row they overflowed is the one a viewer sees, and it is the open
 * one.
 */
const MEASURE = stillPage(`(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const board = document.querySelector('.mtg-board');
  const box = (node) => {
    if (node === null || node === undefined) return null;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      w: round(rect.width),
      h: round(rect.height),
      scrollW: node.scrollWidth,
      scrollH: node.scrollHeight,
      ellipsis: style.textOverflow,
      cls: node.className,
      text: (node.textContent ?? '').trim(),
    };
  };
  const read = () => ({
    ask: board.getAttribute('data-ask'),
    podZones: [...document.querySelectorAll('.mtg-board__pods > .mtg-zone')].map(box),
    askToggle: box(document.querySelector('.mtg-ask__toggle')),
    chips: [...document.querySelectorAll('.mtg-board__pods .mtg-pod__chip')].flatMap((chip) =>
      [...chip.children].map(box),
    ),
    stack: [...(document.querySelector('.mtg-stack__meta')?.children ?? [])].map(box),
  });
  const first = read();
  board.setAttribute('data-ask', 'shut');
  void board.getBoundingClientRect();
  const second = read();
  return {
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    open: first,
    shut: second,
  };
})()`);

interface Box {
  readonly w: number;
  readonly h: number;
  readonly scrollW: number;
  readonly scrollH: number;
  readonly ellipsis: string;
  readonly cls: string;
  readonly text: string;
}

interface Arm {
  readonly ask: string;
  readonly podZones: readonly Box[];
  readonly askToggle: Box | null;
  readonly chips: readonly Box[];
  readonly stack: readonly Box[];
}

interface Reading {
  readonly root: number;
  readonly open: Arm;
  readonly shut: Arm;
}

/** The floor the target keeps, stated where the rule states it. */
const TARGET_MIN_REM = 4;

/** A half pixel: sub-pixel layout rounding is not a clipped word. */
const SLACK_PX = 0.5;

const PHONE = { width: 844, height: 390 } as const;
const DESK = { width: 1440, height: 900 } as const;

async function readAt(
  client: Parameters<typeof measurePage>[0],
  file: string,
  size: { readonly width: number; readonly height: number },
  coarse: boolean,
): Promise<Reading> {
  const label = `${String(size.width)}x${String(size.height)}`;
  const seen = (await measurePage(
    client,
    file,
    size.width,
    size.height,
    MEASURE,
    label,
    '.mtg-board',
    true,
    coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
  )) as unknown as Reading | null;
  if (seen === null) throw new Error(`${label}: the page drew no board`);
  return seen;
}

function target(stack: readonly Box[]): Box {
  const found = stack.find((part) => part.cls.includes('mtg-stack__target'));
  if (found === undefined) throw new Error('the stack entry names nothing it is aimed at');
  return found;
}

function state(stack: readonly Box[]): Box {
  const found = stack.find((part) => part.cls.includes('mtg-stack__state'));
  if (found === undefined) throw new Error('the stack entry says nothing about resolution order');
  return found;
}

describe('the played table on a phone held sideways', () => {
  browserIt(
    'stops drawing what it cannot fit, and keeps drawing what it can',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-short-strip-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-short-strip-chrome-'));
      const file = join(directory, 'play.html');
      await writeFile(file, page(), 'utf8');
      const chrome = await launchChrome(userDataDir);
      try {
        const phone = await readAt(chrome.client, file, PHONE, true);
        const desk = await readAt(chrome.client, file, DESK, false);

        // 1. The shut strip. Both browsers are drawn beside an open column and
        // neither is drawn in the strip, while the way back out stays drawn.
        expect(phone.open.podZones.length, 'the pods column draws no graveyard browser').toBeGreaterThan(1);
        for (const [index, zone] of phone.open.podZones.entries()) {
          expect(zone.h, `graveyard browser ${String(index)} beside an open column`).toBeGreaterThan(0);
        }
        for (const [index, zone] of phone.shut.podZones.entries()) {
          expect(zone.h, `graveyard browser ${String(index)} inside the shut strip`).toBe(0);
        }
        expect(phone.shut.askToggle?.h ?? 0, 'the shut strip has no way out of it').toBeGreaterThan(0);
        // What decides is the state, not the size: the strip is 48px wide on a
        // desktop too, and a browser drawn in it there would be cut the same way.
        for (const [index, zone] of desk.open.podZones.entries()) {
          expect(zone.h, `graveyard browser ${String(index)} beside an open desktop column`).toBeGreaterThan(
            0,
          );
        }
        for (const [index, zone] of desk.shut.podZones.entries()) {
          expect(zone.h, `graveyard browser ${String(index)} inside a shut desktop strip`).toBe(0);
        }

        // 2. The chips. Every word in the pod's row is drawn at the width the
        // word wants, which is what the tightened gaps bought.
        expect(phone.open.chips.length, 'the pods draw no chips').toBeGreaterThan(1);
        for (const chip of phone.open.chips) {
          expect(chip.scrollW, `"${chip.text}" is clipped by its chip`).toBeLessThanOrEqual(
            chip.w + SLACK_PX,
          );
        }

        // 3. The stack's sentence. The name gives, down to a floor, and says so
        // with an ellipsis; nothing else in the row is cut.
        const short = target(phone.open.stack);
        expect(short.w, 'the target was squeezed past its floor').toBeGreaterThanOrEqual(
          TARGET_MIN_REM * phone.root - SLACK_PX,
        );
        expect(short.scrollW, 'the target had room and was shortened anyway').toBeGreaterThan(short.w);
        expect(short.ellipsis, 'the shortened target does not say it was shortened').toBe('ellipsis');
        for (const part of phone.open.stack) {
          if (part.cls.includes('mtg-stack__target')) continue;
          if (part.cls.includes('mtg-stack__state')) continue;
          expect(part.scrollW, `"${part.text}" was shortened to pay for the name`).toBeLessThanOrEqual(
            part.w + SLACK_PX,
          );
        }
        expect(state(phone.open.stack).h, 'the closing word still costs the strip a row').toBe(0);

        // On a window with room the name gets more of it, and the closing word
        // is back. `4rem` is a floor and not a width: a rule that pinned the
        // target to its floor would read the same on the phone and fail here.
        const full = target(desk.open.stack);
        expect(full.w, 'the target is held at its floor on a desktop').toBeGreaterThan(short.w);
        expect(state(desk.open.stack).h, 'the closing word went missing off a phone').toBeGreaterThan(0);
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
