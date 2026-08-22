// @vitest-environment node
/**
 * The identity frame, measured against the card it is drawn round.
 *
 * `mtg-iqyc` is two reports that turned out to be one defect. A declared
 * attacker in the combat band wore a frame that "swallows most of the face",
 * and the hover zoom drew "a double border". Both came from the same thing: the
 * face's visible frame was an identity border plus the ground's own padding,
 * both stated in pixels, and neither knew how wide the card under them had been
 * drawn.
 *
 * Measured here in chrome-headless-shell at 1440x900 and 1280x800, on a board
 * mid-combat with two attackers declared, before the fix:
 *
 * | face                 | width | border | ground pad | frame / width |
 * | -------------------- | ----- | ------ | ---------- | ------------- |
 * | attacker in the band |  87.8 |    4px |        4px |          9.1% |
 * | hover zoom           |   320 |    7px |        8px |          4.7% |
 *
 * The band's card is sized off the band's height (`src/styles/board/band.ts`),
 * so it is the smallest face this surface draws and it paid the fixed 8px the
 * hardest. And the ground band is a different color from the border, so on the
 * biggest face on the surface the pair read as two rings — the "double border".
 *
 * After: the frame is one band of `FRAME_BAND_MM / CARD_TRIM_MM.width` (2.6 of
 * 63 mm, which is where `@mtg/card-render` starts a printed card's content), the
 * ground's padding is gone, and every face wears the same proportion:
 *
 * | face                 | width | border | ground pad | frame / width |
 * | -------------------- | ----- | ------ | ---------- | ------------- |
 * | attacker in the band | 100.6 |    4px |        0px |          4.0% |
 * | permanent at rest    | 105.5 |    4px |        0px |          3.8% |
 * | land tile's neighbor |    56 |    2px |        0px |          3.6% |
 * | hover zoom           |   320 |   13px |        0px |          4.1% |
 *
 * The rows are one rule: the band is `width x FRAME_BAND_SHARE`, rounded to a
 * device pixel, which is where the small gaps in that last column come from.
 *
 * The two claims below are exactly those two columns: the band is the printed
 * share of the face's own width, and there is one band rather than two.
 *
 * The zoom is revealed by `:hover`, which a static page has none of, so the page
 * this file writes carries one extra rule forcing the band's zooms visible. That
 * changes `display` and nothing else; a border width and a padding are the same
 * numbers either way.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { GameSession, ObjectId, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { CARD_TRIM_MM, FRAME_BAND_MM } from '../../src/card/anatomy';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** The neutral example set: nothing here is a claim about a card. */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

/**
 * A mid-combat position with two attackers declared, one of which has vigilance
 * and one of which does not — so the band holds an upright entry and a rotated
 * one, and the frame is measured on both. The attack goes through `reduce`
 * rather than being written into the state by hand.
 */
function board(): GameSession {
  const battlefield = [
    ...Array.from({ length: 4 }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller: 0 as PlayerId,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: 4 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller: 0 as PlayerId,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: 3 }, (_unused, index) => ({
      card: SPELLS[(index + 2) % SPELLS.length] ?? SPELLS[0],
      controller: 1 as PlayerId,
      tapped: false,
      summoningSick: false,
    })),
  ];
  const built = scenario({
    seed: 'ui/combat-frame',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[1], SPELLS[2]],
    ],
    step: 'declareAttackers',
    active: 0,
    turn: 10,
  });
  const attackers: readonly ObjectId[] = built.state.battlefield
    .filter((oid) => {
      const object = built.state.objects[oid];
      return object !== undefined && object.controller === 0 && object.card.kind === 'creature';
    })
    .slice(0, 2);
  expect(attackers, 'the stated attack has creatures to declare').toHaveLength(2);
  const declared = reduce(built.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: attackers.map((oid) => ({ oid, defender: 1 as PlayerId })),
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: declared.state,
    events: [...built.events, ...declared.events],
    result: null,
    pending: pendingDecision(declared.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** The one rule the page adds: a static document has no pointer to hover with. */
const SHOW_ZOOM = `.mtg-combat__entry .mtg-slot > .mtg-zoom { display: block; }`;

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Combat frame</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}${SHOW_ZOOM}</style></head><body>${markup}</body></html>`;
}

/**
 * Every face the page draws, with the width it was drawn at and the two lengths
 * that make up its frame. A land tile is excluded by name rather than by size:
 * it is deliberately one hairline round a picture (`src/styles/card.ts`,
 * `ART_TILE`) and is not this face.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const faces = [...document.querySelectorAll('.mtg-card')]
    .filter((face) => face.getAttribute('data-size') !== 'art')
    .map((face) => {
      const style = getComputedStyle(face);
      const box = face.getBoundingClientRect();
      const rotated = style.rotate !== 'none' && style.rotate !== '';
      const name = face.querySelector('.mtg-card__name');
      return {
        name: name === null ? '' : name.textContent,
        size: face.getAttribute('data-size'),
        // A rotated face hands back its turned bounding box, so its own inline
        // size is the short side. That is the number the frame is a share of.
        width: round(rotated ? box.height : box.width),
        border: [
          parseFloat(style.borderTopWidth),
          parseFloat(style.borderRightWidth),
          parseFloat(style.borderBottomWidth),
          parseFloat(style.borderLeftWidth),
        ],
        pad: [
          parseFloat(style.paddingTop),
          parseFloat(style.paddingRight),
          parseFloat(style.paddingBottom),
          parseFloat(style.paddingLeft),
        ],
        inBand: face.closest('.mtg-combat__entry') !== null,
        inZoom: face.closest('.mtg-zoom') !== null,
      };
    });
  const divider = document.querySelector('.mtg-board__divider');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    entries: document.querySelectorAll('.mtg-combat__entry').length,
    faces,
  };
})()`;

interface FaceReading {
  readonly name: string;
  readonly size: string;
  readonly width: number;
  readonly border: readonly number[];
  readonly pad: readonly number[];
  readonly inBand: boolean;
  readonly inZoom: boolean;
}

/** The share of a card's width the frame band takes, on paper and on screen. */
const FRAME_BAND_SHARE = FRAME_BAND_MM / CARD_TRIM_MM.width;

/**
 * One CSS pixel, because a computed border width lands on a device pixel and a
 * share of a fractional width does not.
 */
const TOLERANCE_PX = 1;

/** Below this the face is a rounding artifact rather than a card. */
const MIN_FACE_PX = 24;

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
] as const;

describe('the identity frame is a share of the card it is drawn round', () => {
  browserIt(
    'wears the printed band on every face, in one band rather than two',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-frame-'));
      const file = join(directory, 'board.html');
      await writeFile(file, page(board()), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const result = await measurePage(chrome.client, file, width, height, MEASURE, 'combat frame');
          expect(result['viewport']).toEqual([width, height]);
          expect(result['combat'], `${where} seam`).toBe('true');
          expect(result['entries'], `${where} attackers in the seam`).toBe(2);

          const faces = result['faces'] as readonly FaceReading[];
          expect(faces.length, `${where} faces`).toBeGreaterThan(0);
          expect(
            faces.filter((face) => face.inBand && !face.inZoom).length,
            `${where} faces in the band`,
          ).toBe(2);
          // Every slot carries a zoom panel; the two the page reveals are the
          // only ones a browser lays out, and the rest measure zero.
          expect(
            faces.filter((face) => face.inZoom && face.width >= MIN_FACE_PX).length,
            `${where} zoomed faces drawn`,
          ).toBe(2);

          for (const face of faces) {
            if (face.width < MIN_FACE_PX) continue;
            const at = `${where}: ${face.name} (${face.size}, ${String(face.width)}px wide)`;
            const wanted = face.width * FRAME_BAND_SHARE;
            for (const side of face.border) {
              expect(side, `${at} frame band`).toBeGreaterThan(wanted - TOLERANCE_PX);
              expect(side, `${at} frame band`).toBeLessThan(wanted + TOLERANCE_PX);
            }
            // One band and not two: the ground used to show as a second ring of
            // its own color just inside the border, which is what the hover zoom
            // read as a double border.
            for (const side of face.pad) {
              expect(side, `${at} second ring inside the frame`).toBe(0);
            }
          }
        }
      } catch (error) {
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
          `combat frame Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    60_000,
  );
});
