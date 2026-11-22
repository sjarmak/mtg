// @vitest-environment node
/**
 * The replay transport on a landscape phone, which is where it went missing.
 *
 * `mtg-aqxi.18`. the playtester, 2026-08-22: the play button disappeared on the
 * Replay section, so advancing the game means pressing Next over and over. Measured
 * before the fix over the fixture log at game 0, seq 120: at 844x390 and at
 * 932x430 *both* toolbars on the route read `display: none` — First, Prev, Play,
 * Next, Last, the turn select and the speed select, none of them drawn — while
 * portrait and 1440x900 drew them all.
 *
 * The rule that did it is `../../src/styles/mobile.ts`'s, and it was right about
 * the route it was written for. A landscape *table* gives its whole height to
 * the mat, and what it drops is the route switcher, the sentence about the set
 * and the seed. `TABLE` is play, draft and replay, and on replay the toolbar is
 * not chrome around the game: it is the only way to move through one.
 *
 * So the exemption is one class wide, and this file holds both halves of it —
 * the transport is drawn at every size, and the head band above it is still gone
 * on a landscape phone. A test that only asserted the first half would pass on a
 * revert that gave the route back all 105px of its bands.
 *
 * **The browser is told it is a phone**, because `../../src/styles/touch.ts`'s
 * floor is what makes these buttons 44px rather than 29px, and reaching Play
 * with a thumb is the whole complaint.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { uiStyleSheet } from '../../src/styles/index';
import { TRANSPORT_CLASS } from '../../src/styles/replay';
import { WCAG_TARGET_PX } from '../../src/styles/touch';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';
import { fixtureLog } from './support/log-fixture';

/** A frame with permanents, a hand a side and more game after it. */
const SEQ = '120';

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'analysis',
      sub: 'replay',
      onSelectMode: () => undefined,
      title: 'MTG Lab',
      children: h(ReplayViewer, {
        state: { status: 'ready', log: fixtureLog() },
        route: { mode: 'analysis', sub: 'replay', params: { seq: SEQ } },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Replay</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One reading of the route's two bands.
 *
 * `head` is found as the toolbar that is not the transport rather than by
 * position, so a third band arriving on this route does not silently become the
 * one being asserted absent.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const bars = [...document.querySelectorAll('.mtg-toolbar')];
  const transport = bars.find((bar) => bar.classList.contains('${TRANSPORT_CLASS}')) ?? null;
  const head = bars.find((bar) => !bar.classList.contains('${TRANSPORT_CLASS}')) ?? null;
  const named = (label) => [...(transport?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label) ?? null;
  const drawn = (el) => {
    if (el === null) return null;
    const rect = el.getBoundingClientRect();
    return { height: round(rect.height), width: round(rect.width), bottom: round(rect.bottom) };
  };
  const play = named('Play');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
    transport: drawn(transport),
    head: drawn(head),
    controls: [...(transport?.querySelectorAll('button, select') ?? [])].map((el) => ({
      what: String(el.getAttribute('aria-label') ?? el.textContent),
      height: round(el.getBoundingClientRect().height),
      belowFold: round(el.getBoundingClientRect().bottom - window.innerHeight),
    })),
    playDisabled: play === null ? null : play.disabled,
  };
})()`;

interface Box {
  readonly height: number;
  readonly width: number;
  readonly bottom: number;
}

interface Control {
  readonly what: string;
  readonly height: number;
  readonly belowFold: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly coarse: boolean;
  readonly pageOverflowY: number;
  readonly transport: Box | null;
  readonly head: Box | null;
  readonly controls: readonly Control[];
  readonly playDisabled: boolean | null;
}

/** Two phones sideways, a phone upright, and a laptop window. */
const SIZES = [
  { width: 844, height: 390, coarse: true, landscapePhone: true },
  { width: 932, height: 430, coarse: true, landscapePhone: true },
  { width: 390, height: 844, coarse: true, landscapePhone: false },
  { width: 1440, height: 900, coarse: false, landscapePhone: false },
] as const;

/** Every control the transport offers, so a band that lost one is a failure. */
const CONTROLS = ['First', 'Prev', 'Play', 'Next', 'Last', 'Turn', 'Speed'] as const;

const SLACK_PX = 0.5;

describe('the replay transport', () => {
  browserIt(
    'is on the screen at every size, including a phone held sideways',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-replay-transport-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-replay-transport-chrome-'));
      const chrome = await launchChrome(userDataDir);
      const file = join(directory, 'replay.html');
      await writeFile(file, page(), 'utf8');
      try {
        for (const size of SIZES) {
          const at = `${String(size.width)}x${String(size.height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            size.width,
            size.height,
            MEASURE,
            at,
            '.mtg-replay',
            true,
            size.coarse ? { mobile: true, pointer: 'coarse' } : { mobile: false, pointer: 'fine' },
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no replay`);
          expect(seen.coarse, `${at}: the rig emulates the right pointer`).toBe(size.coarse);

          // The band is drawn, whole, with every control on it and on screen.
          expect(seen.transport?.height ?? 0, `${at}: the transport is not drawn`).toBeGreaterThan(0);
          expect(
            seen.controls.map((control) => control.what),
            `${at}: the transport is missing a control`,
          ).toEqual([...CONTROLS]);
          for (const control of seen.controls) {
            expect(control.belowFold, `${at}: ${control.what} is under the fold`).toBeLessThanOrEqual(
              SLACK_PX,
            );
            if (size.coarse) {
              expect(control.height, `${at}: ${control.what} is too small to hit`).toBeGreaterThanOrEqual(
                WCAG_TARGET_PX,
              );
            }
          }
          expect(seen.playDisabled, `${at}: Play is dead with game left to watch`).toBe(false);

          // And the route did not get the rest of its chrome back with it.
          if (size.landscapePhone) {
            expect(seen.head?.height ?? -1, `${at}: the head band draws over the mat again`).toBe(0);
          } else {
            expect(seen.head?.height ?? 0, `${at}: the head band went missing off a phone`).toBeGreaterThan(
              0,
            );
          }

          // The board still fits the window it is in.
          expect(seen.pageOverflowY, `${at}: the replay scrolls as a document`).toBeLessThanOrEqual(SLACK_PX);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
