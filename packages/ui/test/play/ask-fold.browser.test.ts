// @vitest-environment node
/**
 * What a player can see of the enumeration without scrolling, measured.
 *
 * `mtg-euc`. The fold reading in `../../tools/rail-split.ts` on a sixteen-move
 * priority, chrome-headless-shell 151.0.7922.47: 9 moves on screen at 1440x900,
 * 7 at 1280x800, 5 at 1024x768, 7 at 810x1080. Nothing was clipped — cut labels
 * 0, overlaps [], the column scrollable and drawing a scrollbar — and the
 * groups named at the last three viewports were `Play` and nothing else. Under
 * `@media (pointer: coarse)`, where `../../src/styles/touch.ts` floors a move
 * button at 44px, `../../tools/touch-targets.ts` read 2 of 17 wholly visible at
 * 1024x768 against 4 of 17 fine. Two lanes, each right on its own terms, and
 * between them a move list a tablet reads two options at a time.
 *
 * The height is the board's and is not on offer, so what changed is the one
 * thing outside the scroller: the panel head names every group the body drew and
 * counts each (`../../src/routes/play/rail.ts`'s `askIndex`). This file is the
 * claim that it works, and it is a claim about geometry, so it is here rather
 * than in `./ask-index.test.ts` — jsdom lays nothing out, and "above the fold"
 * is a `getBoundingClientRect` against the scroller's box.
 *
 * Two things are asserted, and the trade between them is printed on failure so
 * it is a number rather than a memory:
 *
 *  1. **Every group the list drew is named where the fold cannot reach it.** The
 *     failure this replaces is a `Mana` section a player has no way to know
 *     exists.
 *  2. **It costs the scroller at most one move.** The index is the head's own
 *     note rather than a row under it, so the baseline is the `N legal` it
 *     displaced — not a head with that slot empty, which is a panel that never
 *     shipped. Measured on a seventeen-move priority dividing `Play 13 · Mana 4`,
 *     chrome-headless-shell 151.0.7922.47:
 *
 *         rig                ask col   head with/without   moves with/without
 *         1440x900 fine      174.0px   27.8 / 27.8         6 / 6
 *         1280x800 fine      174.0px   27.8 / 27.8         5 / 5
 *         1024x768 fine      155.1px   55.8 / 27.8         3 / 4
 *         1024x768 coarse    155.1px   55.8 / 27.8         1 / 1
 *         810x1080 coarse    120.9px   55.8 / 55.8         5 / 5
 *
 *     One move, at one rig, and it is spent where the words do not fit beside
 *     the headline. What the table also says is that the other half of `mtg-euc`
 *     is untouched: a 44px floor in a 276px scroller shows **one** move at
 *     1024x768 coarse whatever the head says, and no line of copy fixes that.
 *
 * The before/after is taken on one page by rewriting the line and re-reading,
 * which is why `MEASURE` mutates and goes through `stillPage`: two renders of
 * two builds would differ by whatever else moved between them.
 *
 * The neutral `@mtg/dsl` example set, so the file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
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
import { ASK_INDEX_CLASS } from '../../src/routes/play/rail';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome, stillPage } from '../support/chrome';

const LASH = exampleCard('slc-lightning-lash');
const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const GUARDIAN = exampleCard('slc-thornhide-guardian');

/**
 * A priority that divides several ways: lands to play, a spell to cast, mana to
 * make and abilities to activate. A one-group position would leave claim 1 true
 * by having nothing to name.
 */
function busyState(): GameState {
  return scenario({
    seed: 'ui/ask-fold',
    battlefield: [
      ...Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      ...Array.from({ length: 3 }, () => ({
        card: RAIDER,
        controller: 0 as const,
        summoningSick: false,
      })),
      { card: GUARDIAN, controller: 1 as const },
    ],
    hands: [[LASH, MOUNTAIN, LASH], []],
    active: 0,
    turn: 6,
  }).state;
}

function session(): GameSession {
  const state = busyState();
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the busy board left nobody to ask');
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: session(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ask fold</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Visible means wholly inside the scroller's own box, which is the reading
 * `tools/rail-split.ts` takes: a half-drawn button at the cut edge is a move the
 * player has to scroll to press.
 */
const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const body = document.querySelector('.mtg-prompt .mtg-panel__body');
  const head = document.querySelector('.mtg-prompt .mtg-panel__head');
  const index = document.querySelector('.${ASK_INDEX_CLASS}');
  const box = body === null ? null : body.getBoundingClientRect();
  const whole = (node) => {
    const r = node.getBoundingClientRect();
    return box !== null && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
  };
  const moves = () => [...document.querySelectorAll('.mtg-panel__body button.mtg-choice')].filter(whole).length;
  const titles = [...document.querySelectorAll('.mtg-choices__group-title')].map((node) => node.textContent || '');
  const indexBox = index === null ? null : index.getBoundingClientRect();
  const seen = index === null ? '' : index.textContent || '';
  const before = moves();
  const headBefore = head === null ? -1 : round(head.getBoundingClientRect().height);
  // The baseline is the head this replaced, not a head with nothing in that
  // slot: the index IS the note now, so removing it would measure a panel that
  // never shipped and flatter the line by a whole row.
  const total = document.querySelectorAll('button.mtg-choice').length + 1;
  if (index !== null) index.textContent = total + ' legal';
  void document.documentElement.offsetHeight;
  const after = moves();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    coarse: window.matchMedia('(pointer: coarse)').matches,
    groups: titles,
    indexText: seen,
    indexOnScreen: indexBox === null ? false : indexBox.height > 0 && indexBox.bottom <= window.innerHeight + 1,
    movesWithIndex: before,
    movesWithout: after,
    headBefore,
    headAfter: head === null ? -1 : round(head.getBoundingClientRect().height),
    askWidth: box === null ? -1 : round(box.width),
  };
})()`;

const RIGS = [
  { width: 1440, height: 900, pointer: 'fine' as const },
  { width: 1280, height: 800, pointer: 'fine' as const },
  { width: 1024, height: 768, pointer: 'fine' as const },
  { width: 1024, height: 768, pointer: 'coarse' as const },
  { width: 810, height: 1080, pointer: 'coarse' as const },
];

describe('the ask says what is below the fold', () => {
  browserIt('names every group it drew, outside the scroller, for at most one move', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-fold-'));
    const file = join(directory, 'ask.html');
    await writeFile(file, page(), 'utf8');
    let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
    try {
      chrome = await launchChrome(join(directory, 'chrome'));
      for (const rig of RIGS) {
        const where = `${String(rig.width)}x${String(rig.height)} ${rig.pointer}`;
        const result = await measurePage(
          chrome.client,
          file,
          rig.width,
          rig.height,
          stillPage(MEASURE),
          `ask fold ${where}`,
          undefined,
          true,
          { pointer: rig.pointer },
        );
        const groups = result['groups'] as readonly string[];
        const indexText = String(result['indexText']);
        expect(
          groups.length,
          `${where}: the board drew one group, so this rig proves nothing`,
        ).toBeGreaterThan(1);

        // Claim 1.
        expect(result['indexOnScreen'], `${where}: the group index is not on screen`).toBe(true);
        for (const title of groups) {
          expect(indexText, `${where}: "${title}" is a section the head never names`).toContain(title);
        }

        // Claim 2, with the trade printed either way.
        const withIndex = Number(result['movesWithIndex']);
        const without = Number(result['movesWithout']);
        expect(
          without - withIndex,
          `${where}: ${String(withIndex)} moves visible against ${String(without)} on the count it replaced, head ${String(result['headBefore'])}px against ${String(result['headAfter'])}px, ask column ${String(result['askWidth'])}px, index "${indexText}"`,
        ).toBeLessThanOrEqual(1);
      }
    } finally {
      if (chrome !== null) await shutdownChrome(chrome);
    }
  });
});
