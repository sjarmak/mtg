// @vitest-environment node
/**
 * A planeswalker drawn at board size, in hand and on the battlefield, measured
 * in real Chrome.
 *
 * `mtg-s55u`. Every other face on the table is cut to a stated number of line
 * boxes: `styles/card.ts` gives the rules region `-webkit-line-clamp`, and
 * `styles/board/hand.ts` raises that number for a held card. A planeswalker's
 * ability rows are laid out in two columns, so the badge stands in a column of
 * its own and a long ability wraps beside it rather than under it — and
 * `-webkit-line-clamp` counts *line boxes*, of which a flex row generates none
 * for the clamp to count. The declaration resolved on the face; it bound on
 * nothing.
 *
 * What that produced, measured here before the fix, on a three-ability walker
 * whose last row is a two-effect ultimate:
 *
 *     viewport    zone         face            rules   picture   past the trim
 *     1440x900    hand         120 x 167.6     178.7   2         70
 *     1440x900    battlefield  122.5 x 171.2   179.6   2         70
 *     1280x800    hand          88 x 122.9     234.9   2        149
 *     1280x801    hand         101.9 x 142.3   181     2         94
 *     1024x768    hand          88 x 122.9     234.9   2        149
 *
 * The rules region is larger than the whole card at every one of them, the
 * picture is two pixels, and the rest of the text is painted outside the card's
 * own trim rather than cut inside it. It is not a hand defect: the played face
 * has it identically, because what fails is the clamp and both zones are
 * `data-size='board'`.
 *
 * **1280x801 is in the list because two of the three numbers the report was
 * filed with belong to it.** `styles/board/hand.ts`'s
 * `SHORT_TABLE_MAX_HEIGHT_REM` is 50rem and the query is inclusive, so a window
 * exactly 800px tall is a short table and draws the same 88px face 1024x768
 * does; one pixel taller is a 103.3px face with a line box more. A rig that
 * measures 800 and not 801 never sees that face at all.
 *
 * **jsdom cannot hold any of it.** `getBoundingClientRect` is all zeros there
 * and `scrollHeight` equals `clientHeight` on everything, so a region larger
 * than its card is two zeros that agree and a clamp that binds and one that
 * does not are the same silence. `../card-loyalty.browser.test.ts` measures the
 * same card type on the gallery's full face, where the box is sized by the fit
 * ladder rather than clipped; this one measures the face the table draws.
 *
 * The walker is authored here for `../card-loyalty.browser.test.ts`'s reason:
 * the quantity under test is the worst case the clip must survive, it is
 * reachable by construction, and a card read out of a set file would put a set's
 * name in a public export.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard, parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/** No mana in a loyalty ability's cost: the loyalty is the cost. */
const FREE = { mana: {}, tapSelf: false, sacrificeSelf: false };

/**
 * Three ability rows, the last a two-effect ultimate of about 170 characters,
 * which is what a walker's bottom row looks like at the end of the vocabulary.
 * The run below fails if its text does not overrun the budget the face is given,
 * so a green run is one that measured a clip rather than a card with room.
 */
const WALKER: DslCard = parseCard({
  kind: 'planeswalker',
  id: 'pw-table',
  name: 'Warden of the Turning Hour',
  set: { code: 'PWK', collectorNumber: 4 },
  rarity: 'mythic',
  colors: ['G', 'W'],
  subtypes: ['Warden'],
  manaCost: { generic: 2, G: 1, W: 1 },
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: 1,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: -1,
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: { name: "Warden's Arsenal", colors: [], subtypes: ['Equipment'], keywords: [] },
        },
      ],
    },
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: -8,
      effects: [
        {
          kind: 'returnFromGraveyard',
          scope: 'creatureCardsInPlayerGraveyard',
          target: { kind: 'targetPlayer' },
        },
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          target: { kind: 'targetPlayer' },
          scope: 'creaturesThatPlayerControls',
        },
      ],
    },
  ],
});

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

/** Four permanents a side, which is `./hand-allocation.browser.test.ts`'s roomiest table. */
const PER_SIDE = 4;

/** The walker leads both zones, so one page answers for a held face and a played one. */
function board(): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    { card: WALKER, controller, tapped: false, summoningSick: false },
    ...Array.from({ length: PER_SIDE - 1 }, (_unused, index) => ({
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
    seed: 'ui/loyalty-table',
    battlefield,
    hands: [
      [WALKER, SPELLS[1], SPELLS[2], LANDS[0], SPELLS[3], LANDS[1], SPELLS[0]],
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loyalty at board size</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Boxes, not declarations, with one exception: `clamp` is read off the resolved
 * style because the defect was a declaration that resolved and bound on
 * nothing, and a reader of a red run needs to see which of the two failed.
 */
const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const read = (face) => {
    const b = face.getBoundingClientRect();
    const rules = face.querySelector("[data-region='rules']");
    const art = face.querySelector("[data-region='art']");
    const style = rules === null ? null : getComputedStyle(rules);
    const clamp = style === null ? '' : style.getPropertyValue('-webkit-line-clamp').trim();
    const rulesBox = rules === null ? null : rules.getBoundingClientRect();
    const artBox = art === null ? null : art.getBoundingClientRect();
    return {
      shield: face.querySelector('.mtg-card__shield') !== null,
      w: round(b.width),
      h: round(b.height),
      clamp: clamp === '' || clamp === 'none' ? 0 : Number(clamp),
      rulesH: rulesBox === null ? 0 : round(rulesBox.height),
      rulesBelow: rulesBox === null ? 0 : round(Math.max(0, rulesBox.bottom - b.bottom)),
      rulesClient: rules === null ? 0 : rules.clientHeight,
      rulesScroll: rules === null ? 0 : rules.scrollHeight,
      artH: artBox === null ? 0 : round(artBox.height),
      artW: artBox === null ? 0 : round(artBox.width),
      overflow: round(Math.max(0, face.scrollHeight - face.clientHeight)),
    };
  };
  const near = document.querySelector(".mtg-board__side[data-seat='you']");
  return {
    viewport: [window.innerWidth, window.innerHeight],
    hand: [...document.querySelectorAll(".mtg-zone[data-tone='rail'] .mtg-slot[data-slot='hand'] > .mtg-card")].map(read),
    board: [...near.querySelectorAll(".mtg-board__spells > .mtg-slot[data-slot='play'] > .mtg-card")].map(read),
  };
})()`;

interface Face {
  readonly shield: boolean;
  readonly w: number;
  readonly h: number;
  readonly clamp: number;
  readonly rulesH: number;
  readonly rulesBelow: number;
  readonly rulesClient: number;
  readonly rulesScroll: number;
  readonly artH: number;
  readonly artW: number;
  readonly overflow: number;
}

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1280, 801],
  [1024, 768],
] as const;

/**
 * The picture's floor, restated from `./hand-allocation.browser.test.ts` rather
 * than imported, so neither file's reading depends on the other still being
 * about the same card. It is that file's worst non-loyalty case measured over
 * the flagship — 24.5% of face height at 2.73 : 1 — stated as the share a walker
 * must also keep, which is the acceptance criterion `mtg-s55u` was filed with.
 */
const MIN_ART_SHARE = 0.24;
const MAX_ART_ASPECT = 2.75;

/** A pixel, for the reason the other browser rigs state: integer scroll extents off a fractional layout. */
const EPS = 1;

describe('a planeswalker drawn at board size', () => {
  browserIt(
    'fits its rules region inside its own face and keeps the picture the floor every other face keeps',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-loyalty-table-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      let clipped = 0;
      try {
        const file = join(directory, 'board.html');
        await writeFile(file, page(board()), 'utf8');
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const result = await measurePage(chrome.client, file, width, height, MEASURE, 'a loyalty table');
          expect(result['viewport']).toEqual([width, height]);
          const hand = result['hand'] as readonly Face[];
          const played = result['board'] as readonly Face[];
          expect(hand, `${String(width)}x${String(height)}: hand count`).toHaveLength(HAND_SIZE);
          expect(played, `${String(width)}x${String(height)}: board count`).toHaveLength(PER_SIDE);

          for (const [zone, faces] of [
            ['hand', hand],
            ['battlefield', played],
          ] as const) {
            const walker = faces.find((face) => face.shield);
            const where = `${String(width)}x${String(height)} ${zone}`;
            expect(walker, `${where}: no walker drew a loyalty shield`).toBeDefined();
            if (walker === undefined) continue;
            const at = `${where}: a ${String(walker.w)} x ${String(walker.h)} face`;

            // The clamp reached the face. It always did; the rest of this block
            // is about whether it bound on anything.
            expect(walker.clamp, `${at}: line budget`).toBeGreaterThan(0);

            // The defect, three ways: the region is inside the card, no part of
            // it is painted past the trim, and the face holds its own contents.
            expect(walker.rulesH, `${at}: a ${String(walker.rulesH)}px rules region`).toBeLessThanOrEqual(
              walker.h,
            );
            expect(walker.rulesBelow, `${at}: rules drawn past the bottom edge`).toBeLessThanOrEqual(EPS);
            expect(walker.overflow, `${at}: the face overflowed its own trim`).toBeLessThanOrEqual(EPS);

            // What the budget is for. The picture is the residual in a flex
            // column, so a clamp that binds on nothing takes all of it: two
            // pixels, at every viewport in both zones.
            expect(
              walker.artH / walker.h,
              `${at}: the picture's share, ${String(walker.artH)}px of it`,
            ).toBeGreaterThanOrEqual(MIN_ART_SHARE);
            expect(walker.artW / walker.artH, `${at}: the picture's shape`).toBeLessThanOrEqual(
              MAX_ART_ASPECT,
            );

            // And the floor under the run: this card must be over its budget,
            // or none of the above measured a clip.
            if (walker.rulesScroll > walker.rulesClient + EPS) clipped += 1;
            console.log(
              `${where}: ${String(walker.w)} x ${String(walker.h)} face, ${String(walker.clamp)} lines, ${String(walker.rulesH)}px rules, ${String(walker.artH)}px window`,
            );
          }

          // The rest of the hand is untouched by any of it, which is what says
          // the fix is the walker's row and not a smaller budget for everyone.
          for (const face of hand.filter((held) => !held.shield)) {
            expect(
              face.overflow,
              `${String(width)}x${String(height)}: an ordinary held face`,
            ).toBeLessThanOrEqual(EPS);
          }
        }
      } catch (error: unknown) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
      }
      if (bodyError !== undefined) throw bodyError;
      expect(clipped, 'no walker overran its budget, so no reading above measured a clip').toBe(
        VIEWPORTS.length * 2,
      );
    },
    120_000,
  );
});
