// @vitest-environment node
/**
 * The ask column carries four blocks now, and it was measured for two.
 *
 * `mtg-rgc.7`'s second lever. Both graveyards were blocks in the right rail;
 * `references/068-1083771671.png` hangs each player's zones off that player's own
 * pod, so each one moved under the pod it belongs to (`src/board/Board.ts`).
 * That is a claim about the *narrow* viewport rather than about the reference:
 * the column held a pod, the prompt and a pod, and it now holds a pod, a
 * graveyard, the prompt, a pod and a graveyard, at every width the table
 * supports. A layout that only works on a wide window is the failure mode, so
 * the column is re-measured here rather than argued.
 *
 * # What the column actually costs, at the width where it is scarce
 *
 * Measured in chrome-headless-shell 151.0.7922.47 over the played table on the
 * DSL example set at 1024x768 with twelve permanents a side, which is the
 * narrowest cell in the matrix and the one that decides the question. The
 * column's own box is 710.2px and its blocks come to 710.1px:
 *
 * | block                     |    px |
 * | ------------------------- | ----: |
 * | the disclosure            |  28.8 |
 * | the opponent's pod        |  99.2 |
 * | the opponent's graveyard  |  41.9 |
 * | the play-meta strip       |  50.8 |
 * | the prompt                | 265.6 |
 * | the priority row          |  32.8 |
 * | your pod                  | 121.1 |
 * | your graveyard            |  41.9 |
 * | seven 4px gaps            |  28.0 |
 *
 * It fits, and nothing scrolls. The two graveyards cost 91.7px between them,
 * strips and gaps together, and every one of those pixels comes out of the
 * prompt: 357.3px before, 265.6px after, because the prompt is the one block in
 * the column declared `flex: 1 1 auto` (`src/styles/board/rail.ts`) and the
 * other blocks are `flex: none`. That is the trade, stated as a number: the
 * prompt gives up a quarter of its height and is still 5.1x the floor a rail
 * block is entitled to, and it is an internal scroller, so what it gives up is
 * scroll distance rather than moves.
 *
 * The bargain is asserted below rather than read off that table. What is
 * asserted is that the column fits, that the prompt still *shows* a whole legal
 * move a player can click, and that the graveyards cost less than the prompt
 * has — properties, not the numbers, so a re-tune that moves every figure here
 * fails only if it breaks the arrangement.
 *
 * # The forty-card graveyard
 *
 * A shut graveyard is one row of chrome, so the table above is the state the
 * column is in almost always. Opened, it is a list, and a list is unbounded:
 * `src/styles/board/rail.ts` floors an opened browser, caps it at a share of the
 * column, and `src/styles/board/browser.ts` scrolls inside it. The last position
 * here opens a forty-card graveyard by injecting the list the component would
 * have mounted — `ZoneBrowser`'s open state is a `useState`, so a statically
 * rendered page cannot be clicked open — and asserts that nothing left the
 * column, that the pile shows a whole card, that its list scrolls, and that the
 * prompt beside it still shows a whole clickable move. At 1024x768 that is a
 * 72.0px pile against a 235.4px prompt, one card and one move; the pile's other
 * 39 cards are a scroll rather than a click away.
 *
 * That pair is the reason this position is here at all. The first version of
 * the rule let the opened pile shrink without a floor, and because flex weights
 * a shrink by base size, the block whose content is forty rows took nearly the
 * whole of the column's deficit and settled at 28.0px — a scroller shorter than
 * one of its own rows.
 *
 * # Proved able to fail
 *
 * Each of these was run against a `src/styles/board/rail.ts` broken one line at
 * a time and then put back:
 *
 *  - Giving each shut strip a body-sized floor, which is what leaving them as
 *    rail blocks would have cost, fails the fit assertion at the narrow
 *    viewport: `shut-4 at 1024x768: your graveyard is drawn past the foot of
 *    the column: expected false to be true`.
 *  - Dropping the opened pile's floor fails with `open-12 at 1024x768: the
 *    opened pile is 28px and shows no whole card: expected 0 to be greater than
 *    0`.
 *  - Making the opened pile unshrinkable instead, so it takes the whole 30% cap
 *    and the prompt pays all of it, fails the other half of the same trade:
 *    `open-12 at 1024x768: the prompt shows no whole clickable move (61
 *    enumerated): expected 0 to be greater than 0`.
 *
 * The harness is `../support/chrome.ts`: jsdom performs no layout, so every box
 * here would be zeros and a column that fits and one that overflows would read
 * the same.
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
 * `perSide` creatures and seven untapped Mountains a side, with both graveyards
 * stocked.
 *
 * The graveyards are what this file is about, so they are never empty: an empty
 * `ZoneBrowser` draws a `div` head with no control on it, which is a different
 * block from the one that moved and would make the hit test vacuous.
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
    seed: `ui/ask-column-${String(perSide)}`,
    battlefield,
    hands: [
      [LASH, LASH, spellAt(0), spellAt(1), spellAt(2)],
      [LASH, spellAt(1), spellAt(2), spellAt(3), spellAt(0)],
    ],
    graveyards: [
      [spellAt(0), spellAt(1), MOUNTAIN],
      [spellAt(2), spellAt(3)],
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

/**
 * Forty cards in the viewer's graveyard, opened.
 *
 * The markup is `ZoneBrowser`'s own open branch, which is the list and nothing
 * else: `src/styles/board/rail.ts` selects the opened state with
 * `:has(.mtg-browser__list)` rather than off an attribute, so mounting the list
 * is the whole of opening it and there is no second state to keep in step. Forty
 * because that is a graveyard nobody's column was sized for, and because the cap
 * is a share of the column rather than a count.
 */
const OPEN_SCRIPT = `<script>(function(){
  var browsers = document.querySelectorAll('.mtg-board__pods > .mtg-browser');
  var last = browsers[browsers.length - 1];
  if (last === undefined) return;
  var rows = '';
  for (var at = 0; at < 40; at += 1) {
    rows += '<li class="mtg-browser__row"><button type="button" class="mtg-browser__card">' +
      '<span class="mtg-swatch" data-identity="R"></span>' +
      '<span class="mtg-browser__name">Emberflow Raider ' + String(at + 1) + '</span></button></li>';
  }
  last.insertAdjacentHTML('beforeend', '<ul class="mtg-browser__list">' + rows + '</ul>');
})();</script>`;

function page(game: GameSession, title: string, extra = ''): string {
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
 * Overflow is asked of the column as `scrollHeight - clientHeight` rather than
 * by comparing block boxes, because those are two different failures: a block
 * painted past the column's edge is a clip and a column taller than its track is
 * a scroll, and `src/styles/board/rail.ts` deliberately chooses the second. Both
 * are returned.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const boxOf = (element) => {
    if (element === null || element === undefined) return null;
    const b = element.getBoundingClientRect();
    return { left: round(b.left), top: round(b.top), width: round(b.width), height: round(b.height), bottom: round(b.bottom), right: round(b.right) };
  };
  const named = (element) => {
    const cls = element.getAttribute('class');
    return (cls === null || cls === '' ? element.tagName : cls).slice(0, 40);
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
  const slack = (element) => element === null ? null : round(element.scrollHeight - element.clientHeight);

  const mat = document.querySelector('.mtg-board');
  const pods = document.querySelector('.mtg-board__pods');
  const podsBox = boxOf(pods);
  const blocks = pods === null ? [] : [...pods.children].map((element) => ({
    what: named(element),
    box: boxOf(element),
    // Inside the column's own box, to a pixel of slack for the subpixel
    // rounding a flex column does when it distributes a remainder.
    inside: podsBox === null || (element.getBoundingClientRect().top >= podsBox.top - 1 && element.getBoundingClientRect().bottom <= podsBox.bottom + 1),
  }));

  const graveyards = pods === null ? [] : [...pods.querySelectorAll(':scope > .mtg-browser')].map((zone) => {
    const list = zone.querySelector('.mtg-browser__list');
    const zoneBox = zone.getBoundingClientRect();
    // A card that is whole inside the strip's own box and answers its own
    // center. The list scrolls, so a row half out of the top of it is a row the
    // player can reach and not a row they can read.
    const cards = [...zone.querySelectorAll('button.mtg-browser__card')];
    return {
      label: zone.getAttribute('aria-label'),
      box: boxOf(zone),
      head: boxOf(zone.querySelector('.mtg-browser__head')),
      reachable: hits(zone.querySelector('button.mtg-browser__head')),
      open: list !== null,
      cards: cards.length,
      wholeCards: cards.filter((card) => {
        const b = card.getBoundingClientRect();
        return b.top >= zoneBox.top - 0.5 && b.bottom <= zoneBox.bottom + 0.5 && hits(card);
      }).length,
      listSlack: slack(list),
      insideColumn: podsBox === null || (zoneBox.bottom <= podsBox.bottom + 1),
    };
  });

  const prompt = document.querySelector('.mtg-board__pods > .mtg-prompt');
  const body = prompt === null ? null : prompt.querySelector('.mtg-panel__body');
  const bodyBox = body === null ? null : body.getBoundingClientRect();
  const choices = [...document.querySelectorAll('.mtg-board__pods button.mtg-choice')];
  const whole = choices.filter((choice) => {
    if (bodyBox === null) return false;
    const b = choice.getBoundingClientRect();
    return b.top >= bodyBox.top - 0.5 && b.bottom <= bodyBox.bottom + 0.5 && hits(choice);
  });

  return {
    viewport: [window.innerWidth, window.innerHeight],
    mat: boxOf(mat),
    pods: podsBox,
    podsSlack: slack(pods),
    blocks: blocks,
    outside: blocks.filter((block) => !block.inside).map((block) => block.what),
    graveyards: graveyards,
    railBrowsers: [...document.querySelectorAll('.mtg-board__rail .mtg-browser')].map(named),
    railBlocks: [...document.querySelectorAll('.mtg-board__rail > *')].map(named),
    prompt: boxOf(prompt),
    promptBody: boxOf(body),
    promptSlack: slack(body),
    moves: choices.length,
    movesWhole: whole.length,
    firstWhole: whole.length === 0 ? null : (whole[0].textContent || '').trim().slice(0, 40),
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

interface Grave {
  readonly label: string | null;
  readonly box: Box | null;
  readonly head: Box | null;
  readonly reachable: boolean;
  readonly open: boolean;
  readonly cards: number;
  readonly wholeCards: number;
  readonly listSlack: number | null;
  readonly insideColumn: boolean;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly mat: Box | null;
  readonly pods: Box | null;
  readonly podsSlack: number | null;
  readonly blocks: readonly { readonly what: string; readonly box: Box | null; readonly inside: boolean }[];
  readonly outside: readonly string[];
  readonly graveyards: readonly Grave[];
  readonly railBrowsers: readonly string[];
  readonly railBlocks: readonly string[];
  readonly prompt: Box | null;
  readonly promptBody: Box | null;
  readonly promptSlack: number | null;
  readonly moves: number;
  readonly movesWhole: number;
  readonly firstWhole: string | null;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const CROWDINGS = [4, 12] as const;

/** Both seats' graveyards, and the count is the point of the bead. */
const GRAVEYARDS = 2;

describe('the ask column carries both graveyards at every viewport', () => {
  browserIt(
    'fits the column, keeps a whole move clickable, and bounds an opened pile',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-ask-column-'));
      const positions: { readonly label: string; readonly file: string; readonly open: boolean }[] = [];
      for (const perSide of CROWDINGS) {
        const label = `shut-${String(perSide)}`;
        const file = join(directory, `${label}.html`);
        await writeFile(file, page(board(perSide), label), 'utf8');
        positions.push({ label, file, open: false });
      }
      const openFile = join(directory, 'open-12.html');
      await writeFile(openFile, page(board(12), 'open-12', OPEN_SCRIPT), 'utf8');
      positions.push({ label: 'open-12', file: openFile, open: true });

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
              `${where}: column ${String(result.pods?.height ?? null)} scrolling ${String(result.podsSlack)}, blocks ${result.blocks.map((block) => `${block.what.split(' ')[1] ?? block.what}=${String(block.box?.height ?? 0)}`).join(' ')}, prompt ${String(result.prompt?.height ?? null)}, moves ${String(result.movesWhole)}/${String(result.moves)}, piles ${result.graveyards.map((grave) => `${String(grave.box?.height ?? 0)}px/${String(grave.wholeCards)} whole of ${String(grave.cards)}`).join(' ')}`,
            );

            expect(result.viewport, `${where}: viewport`).toEqual([width, height]);

            // The move itself: both graveyards under their own pods, and none
            // left in the rail. Asserted as a count on each side, because a
            // graveyard drawn in both places would pass either half alone.
            expect(
              result.graveyards.length,
              `${where}: the ask column holds ${String(result.graveyards.length)} graveyards`,
            ).toBe(GRAVEYARDS);
            expect(
              result.railBrowsers,
              `${where}: a graveyard is still in the rail: ${JSON.stringify(result.railBrowsers)}`,
            ).toEqual([]);

            // Each strip is still a thing a player can open. It is the whole of
            // what the closed state offers, so a strip clipped to nothing by the
            // block above it would leave the pile unreachable rather than small.
            for (const grave of result.graveyards) {
              expect(grave.reachable, `${where}: ${String(grave.label)} cannot be clicked open`).toBe(true);
              expect(
                grave.insideColumn,
                `${where}: ${String(grave.label)} is drawn past the foot of the column`,
              ).toBe(true);
            }

            // The re-measurement. A column that does not fit scrolls, which is
            // the bargain rail.ts chose over hiding; this says it never has to
            // make it at any viewport the table supports.
            expect(
              result.outside,
              `${where}: ${JSON.stringify(result.outside)} is drawn outside the ask column`,
            ).toEqual([]);
            expect(
              result.podsSlack,
              `${where}: the ask column does not fit and scrolls ${String(result.podsSlack)}px`,
            ).toBeLessThanOrEqual(0.5);

            // What the prompt gave up has to stop short of the move list. A
            // whole button, hit-tested, rather than a height: a prompt cut to a
            // half-drawn row is a smaller column and a worse table.
            expect(result.moves, `${where}: the position enumerated no moves at all`).toBeGreaterThan(0);
            expect(
              result.movesWhole,
              `${where}: the prompt shows no whole clickable move (${String(result.moves)} enumerated)`,
            ).toBeGreaterThan(0);

            const prompt = result.prompt;
            const graveHeight = result.graveyards.reduce((sum, grave) => sum + (grave.box?.height ?? 0), 0);
            expect(prompt, `${where}: no prompt was drawn`).not.toBeNull();
            if (prompt !== null && !position.open) {
              // The trade, as a property rather than as the 91.7px it measured
              // at: what the graveyards take is smaller than what the block they
              // took it from still has. A cap that inverted this would mean the
              // column had become two piles with a prompt between them.
              expect(
                graveHeight,
                `${where}: the graveyards take ${String(graveHeight)}px and the prompt has ${String(prompt.height)}px`,
              ).toBeLessThan(prompt.height);
            }

            if (!position.open) {
              expect(
                result.graveyards.every((grave) => !grave.open),
                `${where}: a graveyard drew its list without being opened`,
              ).toBe(true);
              continue;
            }

            // The forty-card pile. The list is a scroller inside a capped block,
            // so what grows is the scroll distance and not the column: the same
            // three assertions above still hold on this page, and these say the
            // pile is what is absorbing it.
            const opened = result.graveyards.filter((grave) => grave.open);
            expect(opened.length, `${where}: the injection opened no graveyard`).toBe(1);
            const pile = opened[0];
            const column = result.pods;
            expect(pile, `${where}: the opened graveyard vanished`).toBeDefined();
            expect(column, `${where}: no ask column was drawn`).not.toBeNull();
            if (pile === undefined || column === null) continue;
            expect(pile.cards, `${where}: the injected pile is the wrong size`).toBe(40);
            expect(
              pile.box === null ? 0 : pile.box.height,
              `${where}: the opened pile took ${String(pile.box?.height ?? 0)}px of a ${String(column.height)}px column`,
            ).toBeLessThan(column.height / 2);
            expect(
              pile.listSlack,
              `${where}: the opened pile does not scroll, so its forty cards went somewhere else`,
            ).toBeGreaterThan(0);
            // And it is worth having opened. Written as a shrinkable block this
            // was the assertion that failed: the pile's flex base is forty rows,
            // so it absorbed the whole of the column's deficit and settled at
            // 28.0px, a scroller shorter than one of its own rows. Whole rows
            // rather than a height, because the height that is enough is a
            // question about the row and this is the answer to it.
            expect(
              pile.wholeCards,
              `${where}: the opened pile is ${String(pile.box?.height ?? 0)}px and shows no whole card`,
            ).toBeGreaterThan(0);
            // And the block above it is where it was: the pods are the two
            // fixed points in this column and the reference hangs each zone off
            // one of them, so a pile that moved a pod would be reading the wrong
            // seat's graveyard as well as spending the wrong column.
            for (const block of result.blocks) {
              expect(block.inside, `${where}: ${block.what} left the column when the pile opened`).toBe(true);
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
          `ask column Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
