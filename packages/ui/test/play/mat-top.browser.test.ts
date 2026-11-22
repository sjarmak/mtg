// @vitest-environment node
/**
 * What the play route spends before the table starts.
 *
 * `mtg-q249`. Measured over `../../tools/board-budget.ts` when that bead was
 * filed: the mat's top edge sat at 86.8px at 1280x800 -- 56px of shell bar plus
 * about 31px of the route's own toolbar -- which is 10.9% of the window taken
 * before the game does. It was named as the one remaining lever on this route
 * that costs neither the hand nor the battlefield, because nothing above the mat
 * is part of the game.
 *
 * It has since been spent: `0b788009` took the pack disclosures off the screens
 * that deal the packs and the toolbar went with them, and the bar came down as
 * well. The mat then started at 43.8px, at the same 43.8px at every viewport
 * this rig reads, on the fixtures page and in the built app alike.
 *
 * `ce464526` (four-mode IA with shell section rows) spent some of that back
 * on purpose: a mode with more than one section — Play has constructed,
 * draft, sealed and commander — draws a second header row of the same shape
 * as the mode switch, `.mtg-subs`, so a player can move between them without
 * leaving the route. That row sits between the bar and the mat, not inside
 * the bar, and it is not a band earning its keep back through cropped
 * content or a shrunk board; it is real navigation chrome the four-mode IA
 * added everywhere, load-bearing for Play specifically since Play is the one
 * mode most players open with a section already chosen. The mat now starts
 * at 61.8px, uniformly across every viewport this rig reads, the same clean
 * shape the 43.8px reading had.
 *
 * Nothing was holding it there, which is what this file is for. Two claims:
 *
 * 1. **The route spends no more than `MAT_TOP_MAX_PX` above the mat.**
 * 2. **And what it spends it on is the shell bar and its section row.** A
 *    budget alone would pass a route that put a band back and took the pixels
 *    out of the bar; this says which elements are allowed to be up there,
 *    which is the sentence the bead actually makes.
 *
 * The page is the route's own arrangement and nothing else: `../../src/routes/
 * PlayRoute.ts` returns `.mtg-play-route` with the view straight inside it. The
 * five rigs beside this one each draw a `routeFurniture()` of buttons and a turn
 * badge above the view, which the route drew when they were written and does not
 * draw now; on those pages the mat starts at 133.5px. That is `mtg-lv2h`, and it
 * is why this claim could not simply be added to one of them.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLand, parseCards } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadCards(): readonly DslCard[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  return parseCards((raw as { cards: unknown[] }).cards);
}

/** A mid-game table, so the mat has something in it to be pushed down. */
function session(cards: readonly DslCard[]): GameSession {
  const spells = cards.filter((card) => !isLand(card)).slice(0, 4);
  const lands = cards.filter((card) => isLand(card)).slice(0, 5);
  const side = (
    controller: PlayerId,
  ): readonly {
    readonly card: DslCard;
    readonly controller: PlayerId;
    readonly tapped: boolean;
    readonly summoningSick: boolean;
  }[] => [
    ...spells.map((card) => ({ card, controller, tapped: false, summoningSick: false })),
    ...lands.map((card, index) => ({
      card,
      controller,
      tapped: index % 2 === 1,
      summoningSick: false,
    })),
  ];
  const built = scenario({
    seed: 'ui/mat-top',
    battlefield: [...side(0), ...side(1)],
    hands: [spells.slice(0, 2), spells.slice(0, 2)],
    step: 'precombatMain',
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

function page(game: GameSession): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      title: 'Tideglass Reach',
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Play</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The mat's top edge, and every element that ends above it.
 *
 * An element counts as being above the mat only when its whole box is: a
 * container that starts in the bar and runs down past the mat's top edge is the
 * page's own scaffolding rather than a band taking height, and the sentence here
 * is about what draws in that strip.
 *
 * A box one pixel tall is not drawing. That is the visually-hidden idiom this
 * sheet uses -- `.mtg-sr-only` and the prompt's live-region count are all 1px
 * clipped boxes -- and a spoken heading costs the table no height, which is the
 * whole point of drawing it that way.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const mat = document.querySelector('.mtg-board');
  if (mat === null) return null;
  const top = mat.getBoundingClientRect().top;
  const above = [];
  for (const element of document.querySelectorAll('body *')) {
    const box = element.getBoundingClientRect();
    if (box.height <= 1 || box.bottom > top + 0.5) continue;
    above.push({
      cls: String(element.className).slice(0, 60),
      inChrome: element.closest('.mtg-shell__bar') !== null || element.closest('.mtg-subs') !== null,
      height: round(box.height),
    });
  }
  return { viewport: [window.innerWidth, window.innerHeight], aboveMat: round(top), above };
})()`;

interface Above {
  readonly cls: string;
  readonly inChrome: boolean;
  readonly height: number;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly aboveMat: number;
  readonly above: readonly Above[];
}

/**
 * What the route may spend above the mat.
 *
 * 66px rather than the 61.8 the bar plus `.mtg-subs`'s section row measures
 * (`ce464526`), keeping the original 4.2px of headroom so a type-scale step
 * in either row does not fail it, and still well under the 86.8 that was the
 * original finding: what this catches is a *third* row coming back, or
 * either of these two growing without bound, not a button growing by a
 * pixel.
 */
const MAT_TOP_MAX_PX = 66;

/** The bead's own reading, and the three windows around it. */
const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1600, 1000],
] as const;

describe('the play route above the mat', () => {
  browserIt(
    'spends its budget on the shell bar and its section row, nothing else',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-mat-top-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-mat-top-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        const file = join(directory, 'play.html');
        await writeFile(file, page(session(loadCards())), 'utf8');
        for (const [width, height] of VIEWPORTS) {
          const at = `${String(width)}x${String(height)}`;
          const seen = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            at,
            '.mtg-board',
          )) as unknown as Reading | null;
          if (seen === null) throw new Error(`${at}: the page drew no mat`);

          expect(
            seen.aboveMat,
            `${at}: the route spends ${String(seen.aboveMat)}px before the table starts`,
          ).toBeLessThanOrEqual(MAT_TOP_MAX_PX);

          const strangers = seen.above.filter((element) => !element.inChrome);
          expect(
            strangers.map((element) => `${element.cls} (${String(element.height)}px)`),
            `${at}: something other than the shell bar or its section row draws above the mat`,
          ).toEqual([]);
        }
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
