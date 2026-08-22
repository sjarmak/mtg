// @vitest-environment node
/**
 * A game played from the Draft tab is the same table, and it was not drawn like
 * one.
 *
 * `../../src/routes/draft/DraftGame.ts` hands a finished pool to `LiveGame`,
 * which is the same `PlayView` the Play tab mounts. What differs is one
 * attribute three ancestors up: `../../src/app/Shell.ts` stamps
 * `data-mtg-mode` from the router, so the identical markup renders under
 * `[data-mtg-mode='draft']` there and `[data-mtg-mode='play']` here. Every rule
 * that makes the board a *table* — the height budget, the three grid tracks,
 * the hand row, both columns and the two disclosures that collapse them — is
 * emitted under `../../src/styles/board/geometry.ts`'s `TABLE` and `PLAY`
 * selectors, and those named two modes and three. Counted off the built sheet,
 * the draft route matched 6 rules, which is what `deck`, `cards` and `analysis`
 * match; they are the per-mode palette and no more. The played table matched
 * 107.
 *
 * So the symptom was not a layout that fits badly. It was a layout that was
 * never applied: the board fell back to ordinary document flow, ran off the
 * foot of the window, left both battlefields enormous and empty, squeezed the
 * ask column to its content width, and — the report that started this — left
 * both collapse controls flipping an attribute no rule reads, so pressing
 * either one did nothing at all.
 *
 * This file measures the property rather than the numbers: the draft table is
 * asked to behave like the played table, at one viewport, on one position. It
 * asserts the board is inside the window and that each disclosure moves its own
 * track, because those are the two things a person sitting in front of it
 * noticed.
 *
 * The played render is measured beside it as the control, so a regression in
 * the shared sheet fails as a pair rather than reading as a draft-only bug.
 *
 * The harness is `../support/chrome.ts`: jsdom lays nothing out, so every box
 * here would be zero and a table that fits and one that overflows would read
 * the same.
 *
 * Proved able to fail, one lever at a time and then put back:
 *
 *  - `draft` out of `FITTED_MODES` in `../../src/styles/board/geometry.ts`:
 *    `draft at 1280x800: the table is drawn 879px past the foot of the window`.
 *  - `draft` out of `PLAYED_MODES` there, which is what `../../src/styles/base.ts`
 *    scopes the tightened bar to: `the draft bar is 55.8px against the played
 *    bar's 39.8px, and the table pays the difference`.
 *
 * The first is the state the report came from and the second is the 16px that
 * would have been left behind by fixing only the first.
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
import type { GameSession, PlayerId } from '@mtg/kernel';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import type { UiMode } from '../../src/app/router';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const RAIDER = exampleCard('slc-emberflow-raider');
const SENTINEL = exampleCard('slc-skywatch-sentinel');
const DRAKE = exampleCard('slc-windrider-drake');
const MOUNTAIN = exampleCard('slc-mountain');

/** Four permanents and five Mountains a side, and five cards in each hand. */
function board(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...[RAIDER, SENTINEL, DRAKE, RAIDER].map((card) => ({
      card,
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
    seed: 'ui/draft-table',
    battlefield,
    hands: [
      [RAIDER, SENTINEL, DRAKE, MOUNTAIN, RAIDER],
      [DRAKE, MOUNTAIN, RAIDER, SENTINEL, DRAKE],
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

function page(game: GameSession, mode: UiMode, shut: boolean): string {
  const rendered = renderToStaticMarkup(
    h(Shell, {
      mode,
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
  const markup = shut
    ? rendered
        .replaceAll('data-rail="open"', 'data-rail="shut"')
        .replaceAll('data-ask="open"', 'data-ask="shut"')
    : rendered;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${mode}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The table's box, then each track measured open and shut.
 *
 * The disclosures are driven by setting the attribute the hook sets rather than
 * by clicking, because a statically rendered page has no hook: what is under
 * test is whether any rule reads the attribute, which is the half that was
 * missing. `getBoundingClientRect` forces the reflow between the two readings.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const widthOf = (selector) => {
    const found = document.querySelector(selector);
    return found === null ? null : round(found.getBoundingClientRect().width);
  };
  const mat = document.querySelector('.mtg-board');
  const box = mat === null ? null : mat.getBoundingClientRect();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    mat: box === null ? null : { top: round(box.top), bottom: round(box.bottom), height: round(box.height) },
    past: box === null ? null : round(box.bottom - window.innerHeight),
    rail: widthOf('.mtg-board__rail'),
    ask: widthOf('.mtg-board__pods'),
    bar: (() => { const b = document.querySelector('.mtg-shell__bar'); return b === null ? null : round(b.getBoundingClientRect().height); })(),
  };
})()`;

interface Reading {
  readonly viewport: readonly [number, number];
  readonly mat: { readonly bottom: number; readonly height: number } | null;
  readonly past: number | null;
  readonly rail: number | null;
  readonly ask: number | null;
  readonly bar: number | null;
}

const WIDTH = 1280;
const HEIGHT = 800;

/** The played table is the control; the draft table is the subject. */
const MODES: readonly UiMode[] = ['play', 'draft'];

describe('a game played from the draft tab', () => {
  let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mtg-draft-table-'));
    try {
      chrome = await launchChrome(join(dir, 'profile'));
    } catch (error) {
      throw new Error(`could not start the browser: ${reason(error)}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (chrome !== null) await shutdownChrome(chrome);
    if (dir !== '') await rm(dir, { recursive: true, force: true });
  }, 60_000);

  async function read(mode: UiMode, shut: boolean): Promise<Reading> {
    const label = `${mode}-${shut ? 'shut' : 'open'}`;
    const file = join(dir, `${label}.html`);
    await writeFile(file, page(board(), mode, shut), 'utf8');
    if (chrome === null) throw new Error('no browser');
    const measured = await measurePage(chrome.client, file, WIDTH, HEIGHT, MEASURE, label);
    return measured as unknown as Reading;
  }

  browserIt(
    'is drawn as a table, the same one the play tab draws',
    async () => {
      const seen = new Map<UiMode, { readonly open: Reading; readonly shut: Reading }>();
      for (const mode of MODES) {
        seen.set(mode, { open: await read(mode, false), shut: await read(mode, true) });
      }

      for (const mode of MODES) {
        const read0 = seen.get(mode);
        if (read0 === undefined) throw new Error(`no reading for ${mode}`);
        const { open, shut } = read0;
        const where = `${mode} at ${String(WIDTH)}x${String(HEIGHT)}`;

        expect(open.mat, `${where}: no board was rendered`).not.toBeNull();
        const past = open.past ?? 0;
        expect(
          past <= 1,
          `${where}: the table is drawn ${String(Math.round(past))}px past the foot of the window`,
        ).toBe(true);

        expect(open.rail, `${where}: no side panel was rendered`).not.toBeNull();
        expect(
          (shut.rail ?? 0) < (open.rail ?? 0),
          `${where}: shutting the side panel did not narrow its track (${String(open.rail)}px both ways)`,
        ).toBe(true);

        expect(open.ask, `${where}: no ask column was rendered`).not.toBeNull();
        expect(
          (shut.ask ?? 0) < (open.ask ?? 0),
          `${where}: shutting the game-details column did not narrow its track (${String(open.ask)}px both ways)`,
        ).toBe(true);
      }

      // And it is the *same* table, not merely another one that also fits: one
      // surface under two route names, so any figure that differs is a rule
      // that named one of them.
      const played = seen.get('play');
      const drafted = seen.get('draft');
      if (played === undefined || drafted === undefined) throw new Error('a mode went unmeasured');
      expect(
        drafted.open.bar,
        `the draft bar is ${String(drafted.open.bar)}px against the played bar's ${String(played.open.bar)}px, and the table pays the difference`,
      ).toBe(played.open.bar);
      expect(
        drafted.open.mat?.height,
        `the draft table is ${String(drafted.open.mat?.height)}px tall against the played table's ${String(played.open.mat?.height)}px`,
      ).toBe(played.open.mat?.height);
      expect(drafted.open.rail).toBe(played.open.rail);
      expect(drafted.shut.rail).toBe(played.shut.rail);
      expect(drafted.open.ask).toBe(played.open.ask);
      expect(drafted.shut.ask).toBe(played.shut.ask);
    },
    180_000,
  );
});
