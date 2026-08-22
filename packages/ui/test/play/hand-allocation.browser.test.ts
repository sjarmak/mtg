// @vitest-environment node
/**
 * The hand is a region with a budget of its own, measured in real Chrome.
 *
 * `mtg-s3re` / `mtg-rgc.9.1`. `./table-allocation.browser.test.ts` fixed the
 * battlefield's half of this: off combat the spell row became a size container
 * and a permanent stopped being a seventh of its row. The hand went on paying
 * for the same proxy, and after that change it was the worse of the two — at
 * 1024x768 a held card was 71.5px against a permanent's 100, and on the face
 * that shipped that day, which carried 4px of border over 4px of padding a side,
 * 71.5px of face left a 55.5px content box, under `styles/card.ts`'s
 * `BOARD_RULES_MIN_REM`. So **not one of the seven cards in hand drew a word of
 * rules text at any board size** while every permanent beside them drew all of
 * it. The hand is the zone a player decides from, and it was the one region on
 * the table that could not be read.
 *
 * That arithmetic is the old face's, and it is written out rather than carried:
 * `mtg-iqyc` made the band a share of the card the next day and took the padding
 * to zero, so the same 71.5px face now wears 2px a side and measures a 67.5px
 * content box. Every threshold below is read off the element's own content box
 * for that reason (`mtg-sjh2`).
 *
 * Measured here, chrome-headless-shell 151, hand face width : viewer's upright
 * battlefield face width, before `mtg-s3re` and after:
 *
 *     1024x768   4 a side   71.5 / 100   0.72  ->  88 / 96.7   0.91
 *     1024x768   8 a side   71.5 /  84   0.85  ->  84 / 84     1.00
 *     1024x768  12 a side   71.5 /  84   0.85  ->  84 / 84     1.00
 *     1280x800   4 a side   88   / 100   0.88  ->  unchanged
 *     1280x800   8 a side   84   /  84   1.00  ->  unchanged
 *     1280x800  12 a side   84   /  84   1.00  ->  unchanged
 *     1440x900   4 a side  120   / 124   0.97  ->  unchanged
 *     1440x900   8 a side  112   / 112   1.00  ->  unchanged
 *     1440x900  12 a side  112   / 112   1.00  ->  unchanged
 *
 * Cards in hand drawing rules text went 0/7 to 7/7 at 1024x768 and was already
 * 7/7 at the other two.
 *
 * **What it cost, and the one place it cost anything.** The extra height is the
 * near lane's, and both lanes pay it equally because the two sides grow from the
 * same free space: at 1024x768 with four a side the hand zone went 117.8 to
 * 150.9 and each battlefield zone went 251.2 to 234.7, which took the viewer's
 * face from 100 to 96.7. That face keeps its rules box and its type line —
 * `./table-allocation.browser.test.ts` asserts both and is what would fail — and
 * this file asserts them too. The margin is 11px rather than the 0.7px this
 * docblock used to quote: 96.7px of face is a 91px content box against
 * `BOARD_TYPE_LINE_MIN_REM`'s 80, and the thin figure came from reading that
 * threshold as a 96px face width through a chrome the face does not carry.
 * At eight and twelve a side it cost nothing at all: the board face there is
 * already at `SHORT_CROWDED_BOARD_FACE_MAX_REM` and the row had the height to
 * spare. At 1280x800 and 1440x900 nothing moved, because a seventh of those rows
 * already cleared a complete face.
 *
 * The other cost is the one the row was built for. Seven 88px faces and their
 * gaps are 664px against a 556.3px row, so at 1024x768 about 5.9 of the seven
 * are in view and the rest are a scroll away; `styles/board/hand.ts` gives the
 * rail the same visible scrollbar `styles/board/fit.ts` gives the battlefield,
 * for the same reason, and this file asserts that a card outside the row is
 * always inside a row that can be scrolled. The alternative was leaving the face
 * at 71.5 and lowering the threshold instead, which is `mtg-rgc.9.1`'s named
 * non-answer: it draws rules text nobody can read rather than a card that is too
 * small.
 *
 * The neutral `@mtg/dsl` example set rather than the flagship fixture, so the
 * file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
] as const;

/** An opening hand, because that is the widest the row is ever asked to be. */
const HAND_SIZE = 7;

/**
 * How far under the battlefield a held card may be drawn.
 *
 * The defect was 0.72 and the worst reading in the matrix after it is 0.88, at
 * 1280x800 with four a side, where the hand is at
 * `SHORT_TABLE_HAND_FACE_MAX_REM` and the board is at a complete face. The bound
 * is stated a little under that so the assertion is about the inversion rather
 * than about a tenth of a pixel.
 */
const MIN_HAND_SHARE = 0.85;

function board(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
    ...Array.from({ length: 5 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller,
      tapped: index % 3 === 0,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/hand-allocation-${String(perSide)}`,
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1], SPELLS[2], LANDS[0], SPELLS[3], LANDS[1], SPELLS[0]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3], LANDS[3], SPELLS[0], SPELLS[1]],
    ],
    active: 0,
    turn: 7,
  });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    pending: pendingDecision(state),
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hand allocation</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Boxes, not declarations. Every number below is a `getBoundingClientRect` or a
 * scroll extent off a laid-out page: jsdom performs no layout, so a rules box
 * that draws and one that does not are the same zero there, which is the whole
 * reason this rig exists beside `./hand-scale.test.ts`.
 */
const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const drawn = (n) => n !== null && n.getBoundingClientRect().height > 0;
  // A board face is border-box, so a computed width is the border-box width and
  // the content box a container query resolves against is that minus the two
  // identity bands, which are a share of the face's own width rather than a
  // constant (../../src/styles/card.ts).
  const chrome = (s) =>
    parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
  const box = (n) => { if (n === null) return null; const r = n.getBoundingClientRect(); return [round(r.width), round(r.height)]; };
  const readFace = (face, row) => {
    const slot = face.parentElement;
    const b = face.getBoundingClientRect();
    const style = getComputedStyle(face);
    const rules = face.querySelector('.mtg-card__text');
    let outside = 0;
    if (row !== null) {
      const r = row.getBoundingClientRect();
      outside = round(Math.max(0, r.top - b.top, b.bottom - r.bottom, r.left - b.left, b.right - r.right));
    }
    return {
      name: face.querySelector('.mtg-card__name') === null ? '' : face.querySelector('.mtg-card__name').textContent,
      tapped: slot.getAttribute('data-tapped') === 'true',
      w: round(b.width), h: round(b.height),
      content: round(parseFloat(style.width) - chrome(style)),
      typeDrawn: drawn(face.querySelector('.mtg-card__type')),
      rulesDrawn: drawn(rules),
      rulesClip: rules === null || !drawn(rules) ? 0 : round(Math.max(0, rules.scrollHeight - rules.clientHeight)),
      outside,
    };
  };
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  const far = document.querySelector(".mtg-board__side[data-seat='opponent']");
  const handRow = document.querySelector(".mtg-zone[data-tone='rail'] > .mtg-zone__body[data-layout='rail']");
  const held = [...document.querySelectorAll(".mtg-zone[data-tone='rail'] .mtg-slot[data-slot='hand'] > .mtg-card")];
  const played = [...near.querySelectorAll(".mtg-board__spells > .mtg-slot[data-slot='play'] > .mtg-card")];
  return {
    viewport: [window.innerWidth, window.innerHeight],
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    hand: held.map((f) => readFace(f, handRow)),
    board: played.map((f) => readFace(f, near.querySelector('.mtg-board__spells'))),
    handRow: box(handRow),
    handZone: box(document.querySelector(".mtg-zone[data-tone='rail']")),
    handScrollX: handRow === null ? -1 : round(handRow.scrollWidth - handRow.clientWidth),
    nearSpells: box(near.querySelector('.mtg-board__spells')),
    farSpells: box(far.querySelector('.mtg-board__spells')),
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
  };
})()`;

interface Face {
  readonly name: string;
  readonly tapped: boolean;
  readonly w: number;
  readonly h: number;
  /** The used content width, which is what the face's container queries resolve against. */
  readonly content: number;
  readonly typeDrawn: boolean;
  readonly rulesDrawn: boolean;
  readonly rulesClip: number;
  readonly outside: number;
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const CROWDINGS = [4, 8, 12];

/**
 * The hand's own line-budget ladder, read out of the sheet the page is styled
 * with rather than restated here.
 *
 * `styles/board/hand.ts` owns the ladder and argues for it; this file owns the
 * claim that Chrome resolves it and that the picture survives. Parsing the sheet
 * is what keeps those two from drifting: change the ladder and this test moves
 * with it, change the *scope* so the bands stop reaching a held card and this
 * test fails, which is the failure worth having.
 */
function handLadder(): readonly { readonly rem: number; readonly lines: number }[] {
  const pattern =
    /@container \(min-width: ([\d.]+)rem\) \{\n {2}[^\n]*\.mtg-slot\[data-slot='hand'\] \.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{\n {4}-webkit-line-clamp: (\d+);/g;
  return [...uiStyleSheet().matchAll(pattern)]
    .map((match) => ({ rem: Number(match[1]), lines: Number(match[2]) }))
    .sort((a, b) => a.rem - b.rem);
}

/**
 * The content width, in rem, at or under which `styles/card.ts` stops drawing a
 * region of a board face at all.
 *
 * Read out of the sheet rather than restated, and read as a *content* width
 * rather than converted to a face width, because a face width cannot express it.
 * The identity band is `card width x FRAME_BAND_MM / CARD_TRIM_MM.width`
 * (`mtg-iqyc`) and lands on a device pixel, so the chrome a face carries is 4px
 * at 60px of face, 6px at 88 and 8px at 120 — and it is not even monotone:
 * measured in chrome-headless-shell, a 72px face has a 68px content box and a
 * 73px face has 67. There is no constant to state and no arithmetic off the face
 * that is reliable, so every threshold here is asked of `face.content`, which the
 * reading above takes off the element (`mtg-sjh2`).
 *
 * At or under, because `max-width` is inclusive: a 64px content box is hidden
 * and a 65px one draws, which the same sweep confirms.
 */
function boardRegionMinRem(region: 'rules' | 'type'): number {
  const hidden = new RegExp(
    `@container \\(max-width: ([\\d.]+)rem\\) \\{\\n {2}\\.mtg-card\\[data-size='board'\\] > \\[data-region='${region}'\\] \\{ display: none; \\}`,
  ).exec(uiStyleSheet());
  if (hidden === null) throw new Error(`the sheet hides no board ${region} region`);
  return Number(hidden[1]);
}

/** And what a *played* face of the same width is granted, out of the same sheet. */
function playedBudget(rem: number): number {
  const sheet = uiStyleSheet();
  const hidden = boardRegionMinRem('rules');
  const narrow =
    /@container \(max-width: ([\d.]+)rem\) \{\n {2}\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{ -webkit-line-clamp: (\d+); \}/.exec(
      sheet,
    );
  const wide =
    /\n\.mtg-card\[data-size='board'\] > \[data-region='rules'\] \{[^}]*-webkit-line-clamp: (\d+)/.exec(
      sheet,
    );
  if (narrow === null || wide === null) throw new Error('the sheet states no played budget');
  if (rem <= hidden) return 0;
  if (rem <= Number(narrow[1])) return Number(narrow[2]);
  return Number(wide[1]);
}

/** The band a face of this content width falls in, or the played budget below the first one. */
function expectedHandLines(rem: number): number {
  const reached = handLadder().filter((band) => rem >= band.rem);
  const last = reached[reached.length - 1];
  return last === undefined ? playedBudget(rem) : last.lines;
}

/**
 * How little of a held face the picture may be left with.
 *
 * A budget is a maximum rather than a reservation, so a card whose text fits
 * costs the window nothing — but the seven wordiest cards of the flagship set
 * need 7 to 20 line boxes and overrun every band on offer, so the window pays
 * the whole difference on every one of them. These two are that worst case,
 * measured: 24.5% and 2.73 : 1 at 1440x900, 26.4% / 2.49 : 1 at 1280x800,
 * 26.9% / 2.48 : 1 at 1024x768. They are the floor the rejected alternative
 * broke — a hand face at MTGO's 176px took the viewer's own battlefield face to
 * 57.9px, under `BOARD_FACE_MIN_REM`, which is the same complaint one zone over.
 */
const MIN_ART_SHARE = 0.24;
const MAX_ART_ASPECT = 2.75;

/**
 * Every held and played face carrying text no budget can hold, so the window
 * pays the most it can ever be asked to.
 *
 * Written in rather than drawn from a card, because the point is to exceed the
 * widest band by a margin no set can accidentally close, and because a card name
 * in this file would put one in the public export.
 */
const OVERRUN = `(() => {
  const line = 'Whenever this permanent deals combat damage to a player, draw a card, then discard a card unless you control another creature with power four or greater. ';
  const stress = line + line + line;
  const round = (v) => Math.round(v * 10) / 10;
  // A board face is border-box, so a computed width is the border-box width and
  // the content box a container query resolves against is that minus the two
  // identity bands, which are a share of the face's own width rather than a
  // constant (../../src/styles/card.ts).
  const chrome = (s) =>
    parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
  for (const box of document.querySelectorAll(".mtg-card[data-size='board'] > [data-region='rules']")) {
    box.textContent = stress;
  }
  const read = (face) => {
    const b = face.getBoundingClientRect();
    const faceStyle = getComputedStyle(face);
    const rules = face.querySelector("[data-region='rules']");
    const art = face.querySelector("[data-region='art']");
    const style = rules === null ? null : getComputedStyle(rules);
    const clamp = style === null ? '' : style.getPropertyValue('-webkit-line-clamp').trim();
    const leading = style === null ? 0 : parseFloat(style.lineHeight);
    const padding = style === null ? 0 : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const frame = art === null ? null : art.getBoundingClientRect();
    return {
      w: round(b.width),
      h: round(b.height),
      content: round(parseFloat(faceStyle.width) - chrome(faceStyle)),
      clamp: clamp === '' || clamp === 'none' ? 0 : Number(clamp),
      lines: rules === null || leading === 0 ? 0 : round((rules.clientHeight - padding) / leading),
      artH: frame === null ? 0 : round(frame.height),
      artW: frame === null ? 0 : round(frame.width),
      overflow: round(Math.max(0, face.scrollHeight - face.clientHeight)),
    };
  };
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  return {
    viewport: [window.innerWidth, window.innerHeight],
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    hand: [...document.querySelectorAll(".mtg-zone[data-tone='rail'] .mtg-slot[data-slot='hand'] > .mtg-card")].map(read),
    board: [...near.querySelectorAll(".mtg-board__spells > .mtg-slot[data-slot='play'] > .mtg-card")].map(read),
  };
})()`;

interface Overrun {
  readonly w: number;
  readonly h: number;
  readonly content: number;
  readonly clamp: number;
  readonly lines: number;
  readonly artH: number;
  readonly artW: number;
  readonly overflow: number;
}

describe('the hand is a region with a budget rather than a seventh of a row', () => {
  browserIt(
    'draws a readable held card at every supported table without shrinking the board out of its own thresholds',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-hand-allocation-'));
      const pages = new Map<number, string>();
      for (const perSide of CROWDINGS) {
        const file = join(directory, `board-${String(perSide)}.html`);
        await writeFile(file, page(board(perSide)), 'utf8');
        pages.set(perSide, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [perSide, file] of pages) {
          for (const [width, height] of VIEWPORTS) {
            const where = `${String(width)}x${String(height)} at ${String(perSide)} a side`;
            const result = await measurePage(chrome.client, file, width, height, MEASURE, 'hand allocation');
            expect(result['viewport']).toEqual([width, height]);
            const root = result['root'] as number;
            const rulesMinPx = boardRegionMinRem('rules') * root;
            const typeMinPx = boardRegionMinRem('type') * root;
            const hand = result['hand'] as readonly Face[];
            const played = result['board'] as readonly Face[];
            expect(hand, `${where} hand count`).toHaveLength(HAND_SIZE);
            expect(played, `${where} board count`).toHaveLength(perSide);

            // The finding, as a box: every card in hand is wide enough for its
            // rules box, and draws one. The width asked for is the content box,
            // which is the box the query in the sheet is evaluated against.
            for (const face of hand) {
              expect(face.content, `${where}: held ${face.name} content box`).toBeGreaterThan(rulesMinPx);
              expect(face.rulesDrawn, `${where}: held ${face.name} rules box`).toBe(true);
              expect(face.rulesClip, `${where}: held ${face.name} rules text cut`).toBeLessThanOrEqual(1);
            }

            // And one size of card across the row: a stated width with no shrink
            // means a crowded row scrolls, so any spread here is a slot that
            // took its size from something other than the rule.
            const widths = new Set(hand.map((face) => face.w));
            expect([...widths], `${where}: the hand draws more than one size of card`).toHaveLength(1);

            // The inversion. A held card may be a little smaller than a
            // permanent — the battlefield is the primary reading surface and
            // ./hand-scale.ts keeps its ceiling above the hand's — but not the
            // 0.72 of the defect.
            const upright = played.filter((face) => !face.tapped);
            expect(upright.length, `${where}: no upright permanent to compare`).toBeGreaterThan(0);
            const handWidth = hand[0]?.w ?? 0;
            const boardWidth = upright[0]?.w ?? 0;
            expect(
              handWidth / boardWidth,
              `${where}: held ${String(handWidth)} against played ${String(boardWidth)}`,
            ).toBeGreaterThanOrEqual(MIN_HAND_SHARE);

            // What the hand took, it took from height the battlefield row was
            // holding and not spending. These two are what say so: the board
            // still clears its own thresholds, and the seat that paid is not
            // drawing a smaller card than the seat that did not.
            //
            // The content box again, and here it is also the only reading that
            // means anything: half these permanents are tapped, and a tapped
            // face is rotated, so its `getBoundingClientRect().width` is the
            // face's *height* and clears any width bound for free.
            for (const face of played) {
              expect(face.content, `${where}: played ${face.name} content box`).toBeGreaterThan(rulesMinPx);
              expect(face.rulesDrawn, `${where}: played ${face.name} rules box`).toBe(true);
            }
            if (perSide === 4) {
              for (const face of played) {
                expect(face.content, `${where}: played ${face.name} type line content box`).toBeGreaterThan(
                  typeMinPx,
                );
                expect(face.typeDrawn, `${where}: played ${face.name} type line`).toBe(true);
              }
            }
            const near = result['nearSpells'] as readonly number[] | null;
            const far = result['farSpells'] as readonly number[] | null;
            expect(near, `${where}: no near spell row`).not.toBeNull();
            expect(far, `${where}: no far spell row`).not.toBeNull();
            expect(
              Math.abs((near?.[1] ?? 0) - (far?.[1] ?? 0)),
              `${where}: the two lanes did not pay equally`,
            ).toBeLessThanOrEqual(1);

            // A card the row cannot show is a card the row can be scrolled to,
            // never one that is simply gone. And the table still fits its
            // window, which is what stops the whole question from being answered
            // by a longer page.
            const hidden = hand.filter((face) => face.outside > 1);
            if (hidden.length > 0) {
              expect(
                result['handScrollX'],
                `${where}: ${String(hidden.length)} held cards outside a row that does not scroll`,
              ).toBeGreaterThan(0);
            }
            expect(result['pageOverflowY'], `${where}: the table overflowed its window`).toBeLessThanOrEqual(
              1,
            );
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    120_000,
  );
});

/**
 * The other half of `mtg-rgc.9`, and the half a slot width cannot answer.
 *
 * The row got the held card up to the battlefield's size and the card still
 * could not be read, because at that size it wears `data-size='board'` and
 * inherits the battlefield's line budget: three boxes, two under a 6rem face.
 * Three lines is the right budget for a permanent, which is scanned; it is the
 * wrong one for the card a player is deciding whether to cast.
 *
 * So the hand gets a budget of its own, scoped to the slot. Chrome is the only
 * thing that can say whether that reaches a held card — `-webkit-line-clamp` is
 * resolved per container query against the face's content box, and jsdom
 * evaluates neither — and it is the only thing that can say what it cost the
 * picture, which is the reason the two rejected candidates were rejected.
 *
 * Measured at four a side over `../../tools/hand-scale.ts` against the flagship
 * set, wordiest card at each face width, before and after:
 *
 *     content   face            budget   window          share   shape
 *     7rem      120 x 167.6     3 -> 5   64.8 -> 41.0    24.5%   2.73 : 1
 *     5.94rem   103.3 x 144.3   2 -> 4   59.7 -> 38.1    26.4%   2.49 : 1
 *     5.13rem    88 x 122.9     2 -> 3   43.9 -> 33.1    26.9%   2.48 : 1
 *
 * By content box rather than by viewport, because two of the three viewports
 * this file measures draw the same face: `SHORT_TABLE_MAX_HEIGHT_REM` is 50rem
 * and the query is inclusive, so an exactly-800px window is a short table and
 * 1280x800 draws the 88px face that 1024x768 does. The middle row is 1280x801.
 * That one pixel is `styles/board/hand.ts`'s finding, not this file's;
 * `mtg-2s2k` measured both sides of it, left the bound where it was, and
 * `short-table-boundary.browser.test.ts` pins it there.
 *
 * And on a median hand rather than the wordiest, at 1440x900, five of seven kept
 * their window to the pixel and the cut went 2/7 to 0/7 — a budget is a maximum,
 * not a reservation, and a card whose text fits pays nothing for one.
 */
describe('a card in hand is given a longer line budget than a card in play', () => {
  browserIt(
    'resolves the hand ladder on a held face and leaves the picture a floor it never crosses',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-hand-budget-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        const file = join(directory, 'board.html');
        await writeFile(file, page(board(4)), 'utf8');
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const result = await measurePage(chrome.client, file, width, height, OVERRUN, 'hand budget');
          const root = result['root'] as number;
          const hand = result['hand'] as readonly Overrun[];
          const played = result['board'] as readonly Overrun[];
          expect(hand, `${where}: hand count`).toHaveLength(HAND_SIZE);
          expect(played.length, `${where}: no played face to compare`).toBeGreaterThan(0);

          for (const [index, face] of hand.entries()) {
            const rem = face.content / root;
            const at = `${where}: held card ${String(index)} at ${String(face.content)}px content`;

            // The declaration reached the face, and the face fell in the band
            // its width puts it in.
            expect(face.clamp, `${at}: line budget`).toBe(expectedHandLines(rem));

            // And it is a budget in pixels rather than a number in a sheet: the
            // text overruns every band, so the box drawn is exactly the budget.
            expect(
              face.lines,
              `${at}: line boxes drawn against a budget of ${String(face.clamp)}`,
            ).toBeCloseTo(face.clamp, 0);

            // More than the battlefield grants a face of the same width, which
            // is the whole of what this change is for.
            expect(face.clamp, `${at}: against a played face of the same width`).toBeGreaterThan(
              playedBudget(rem),
            );

            // What it cost. The window is the residual in a flex column, so
            // every line the box takes comes out of the picture and nothing
            // else; these two are the point past which that stops being worth
            // it, and they are why the bigger-face candidates were refused.
            expect(
              face.artH / face.h,
              `${at}: the picture's share of a ${String(face.h)}px face`,
            ).toBeGreaterThanOrEqual(MIN_ART_SHARE);
            expect(face.artW / face.artH, `${at}: the picture's shape`).toBeLessThanOrEqual(MAX_ART_ASPECT);

            // And the face still holds its own contents. A clamp that fails to
            // bind spills the text past the trim, which draws over the card
            // below it rather than being cut.
            expect(face.overflow, `${at}: the face overflowed its own trim`).toBeLessThanOrEqual(1);
          }

          // The battlefield is untouched by any of it: the scope is the slot, so
          // a permanent keeps the budget it had.
          for (const [index, face] of played.entries()) {
            expect(face.clamp, `${where}: played card ${String(index)} line budget`).toBe(
              playedBudget(face.content / root),
            );
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
    },
    120_000,
  );
});
