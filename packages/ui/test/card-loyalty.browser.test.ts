// @vitest-environment node
/**
 * The planeswalker face against a real layout: the loyalty shield covers no
 * ability, and no ability runs off the bottom of the card.
 *
 * Two defects produced this file, both reported by the playtester on 2026-08-18
 * against the flagship's wordiest walker in the Cards tab. The first she named:
 * "the loyalty is covering up too much text" — the shield is mounted in
 * `.mtg-card__stats`, which is absolute and reserves nothing, so it painted
 * over the last ability's second line. The second was under it and had to be
 * verified rather than taken on report: that ability's own text ran past the
 * bottom edge of the card, because a walker's three ruled rows ask for ten
 * lines where the ladder was sized for a creature's six.
 *
 * **Neither is a fact jsdom can hold.** jsdom lays nothing out:
 * `getBoundingClientRect` is all zeros and `scrollHeight` equals `clientHeight`
 * on everything, so an occlusion is two zero rectangles that agree and a clip
 * is a comparison of a number with itself. `../test/cards.flagship.test.ts` can
 * assert that all three abilities are *present* in the markup and it does; that
 * a badge is painted over the words it belongs to is invisible there, and both
 * defects shipped past a green suite. So this is a browser rig, on the same
 * `./support/chrome.ts` harness `card-fit.browser.test.ts` uses, measuring the
 * shipped markup with the shipped sheet.
 *
 * **What is asserted**: one assertion per reported defect, and a third that no
 * report could have named.
 *
 * 1. The shield's rectangle intersects no ability row's rectangle. Not "the
 *    shield is below the box" — the shield is *supposed* to overlap the frame
 *    and hang into the card's corner the way a printed one does. What must not
 *    happen is that it lands on a word.
 * 2. Nothing is clipped. `.mtg-card__text` is `overflow-y: clip`, so
 *    `scrollHeight` over `clientHeight` is a glyph sliced off the bottom, and
 *    every row's rectangle must additionally close above the card's own bottom
 *    edge — the symptom as it was seen, which is text disappearing under the
 *    frame rather than inside the box.
 * 3. The ladder's estimate is never under the row the browser drew. Added by
 *    `mtg-ypz`, which found it under by the cost badge's own block padding on
 *    every costed row: a baseline-aligned flex line is as tall as its tallest
 *    ascent plus its tallest descent, so the badge's padding hangs over the
 *    sentence's first line and the row comes out taller than the lines in it.
 *    Neither assertion above could see it. These faces sit at the ladder floor
 *    by construction, and a short estimate only shows as a cut when it carries
 *    a face past a rung that would have held it — so the bound has to be
 *    checked as a bound, at the rung each face is actually drawn at.
 *
 * **The walkers are authored here rather than read from a set file**, which is
 * the opposite of `card-fit.browser.test.ts`'s choice and for a reason that
 * only applies to this card type. That file measures the wordiest face a
 * generator produced, and no hand-written card is that card. Here the quantity
 * under test is the *worst case the ladder must survive*, and it is reachable
 * by construction: `ULTIMATE` below is three loyalty rows whose last is a
 * two-effect ability of 170 characters, which is what a walker's bottom row
 * looks like at the end of the vocabulary, and it lands on the last rung of
 * `LOYALTY_FIT_STEPS`. A file that is checked to be at the floor is a file that
 * cannot quietly stop measuring the case it exists for, and it keeps this
 * package's tests naming no private card.
 *
 * A row with no badge at all is measured too (`FLAVORED`), because the sheet
 * sets those across the whole box and a two-column rule that leaked onto them
 * would show up as a row of the wrong width rather than as a clip.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Shell } from '../src/app/Shell';
import { LOYALTY_FIT_STEPS, rulesFitStep, textBoxBlocks, textBoxCost } from '../src/card/anatomy';
import { CardsRoute } from '../src/routes/CardsRoute';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from './support/chrome';

/** No mana in a loyalty ability's cost: the loyalty is the cost. */
const FREE = { mana: {}, tapSelf: false, sacrificeSelf: false };

function walker(literal: Readonly<Record<string, unknown>>): DslCard {
  return parseCard({
    kind: 'planeswalker',
    rarity: 'mythic',
    colors: ['W'],
    subtypes: ['Warden'],
    ...literal,
  });
}

/** Two short rows: a walker with room to spare, so the run has a lower end. */
const PLAIN = walker({
  id: 'pw-plain',
  name: 'Warden of the Quiet Gate',
  set: { code: 'PWK', collectorNumber: 1 },
  manaCost: { generic: 2, W: 1 },
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: 1,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: -2,
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'targetCreatureYouControl' },
        },
      ],
    },
  ],
});

/**
 * The same shape with flavor text, which is the row a walker prints with no
 * badge on it. The abilities are short on purpose: flavor is only composed into
 * the box when it costs the rules text no ladder step (`composeTextBox`), so a
 * wordier walker would drop it and this face would measure nothing new.
 */
const FLAVORED = walker({
  id: 'pw-flavored',
  name: 'Warden of the Open Field',
  set: { code: 'PWK', collectorNumber: 2 },
  manaCost: { generic: 3, W: 1 },
  startingLoyalty: 4,
  flavorText: 'The gate remembers every name.',
  abilities: [
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: 1,
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: -3,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** Three rows, the middle one wrapping: the ordinary printed walker. */
const THREE = walker({
  id: 'pw-three',
  name: 'Warden of the Sealing Light',
  set: { code: 'PWK', collectorNumber: 3 },
  manaCost: { generic: 4, W: 1 },
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: 1,
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Gate Soldier',
            power: 1,
            toughness: 1,
            colors: ['W'],
            subtypes: ['Human', 'Soldier'],
            keywords: [],
          },
        },
      ],
    },
    {
      kind: 'activated',
      cost: FREE,
      loyaltyCost: -2,
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
      loyaltyCost: -6,
      effects: [
        { kind: 'exileTarget', target: { kind: 'targetOpponent' }, scope: 'creaturesThatPlayerControls' },
      ],
    },
  ],
});

/**
 * The worst case: a two-effect ultimate of 170 characters under two rows that
 * already wrap. This is the face both defects were reported on, and the run
 * below checks that it reached the last rung of the ladder, so the gate cannot
 * pass by measuring only walkers that were never in trouble.
 */
const ULTIMATE = walker({
  id: 'pw-ultimate',
  name: 'Warden of the Turning Hour',
  set: { code: 'PWK', collectorNumber: 4 },
  colors: ['G', 'W'],
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
          // An Equipment is an artifact and is not a creature, and a token
          // says which of those it is by what it states rather than by a flag:
          // `TokenSpecSchema` carries no `artifact` key, and
          // `@mtg/dsl`'s `tokenCard` reads a stated power and toughness as a
          // creature token and their absence as an artifact one. This fixture
          // stated both a body and `artifact: true`, which parsed until the
          // schema became strict and then failed the whole file at collection
          // time — unnoticed, because no command in this repo runs the browser
          // project (`mtg-dg26`).
          token: {
            name: "Warden's Arsenal",
            colors: [],
            subtypes: ['Equipment'],
            keywords: [],
          },
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

const FACES: readonly DslCard[] = [PLAIN, FLAVORED, THREE, ULTIMATE];
const BY_ID: ReadonlyMap<string, DslCard> = new Map(FACES.map((card) => [card.id, card]));

const GALLERY_FACE = ".mtg-gallery > .mtg-card[data-size='full']";

function pageHtml(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'cards',
      onSelectMode: () => undefined,
      children: h(CardsRoute, {
        cards: FACES,
        route: { mode: 'cards', params: {} },
        onSetParams: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Planeswalker face</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Half a pixel, and it is rounding rather than tolerance, for the reason
 * `card-fit.browser.test.ts` states: client and scroll heights are integers
 * rounded off a fractional layout. Both defects here are whole glyphs — the
 * shield is 28px tall and a clipped line is a whole line — so nothing this file
 * exists to catch can hide inside it. It is also what keeps a shield whose top
 * edge lands exactly on the box's bottom edge from reading as an overlap: the
 * two are meant to meet, since the reservation is derived from the shield.
 */
const EPS = 0.5;

/** One read of every planeswalker face on the page. It mutates nothing. */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom) };
  };
  const faces = [];
  for (const card of document.querySelectorAll(${JSON.stringify(GALLERY_FACE)})) {
    const shield = card.querySelector('.mtg-card__shield');
    if (shield === null) continue;
    const text = card.querySelector('.mtg-card__text');
    if (text === null) continue;
    faces.push({
      id: card.getAttribute('data-card-id'),
      published: Number(text.getAttribute('data-fit')),
      card: box(card),
      text: box(text),
      shield: box(shield),
      shieldText: shield.textContent,
      clientHeight: text.clientHeight,
      scrollHeight: text.scrollHeight,
      lines: [...text.querySelectorAll('.mtg-card__line')].map((line) => ({
        loyalty: line.getAttribute('data-loyalty'),
        badges: line.querySelectorAll('.mtg-card__loyalty').length,
        words: (line.textContent ?? '').slice(0, 48),
        rect: box(line),
      })),
    });
  }
  return { viewport: [window.innerWidth, window.innerHeight], faces: faces };
})()`;

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface LineReading {
  readonly loyalty: string | null;
  readonly badges: number;
  readonly words: string;
  readonly rect: Rect;
}

interface FaceReading {
  readonly id: string | null;
  readonly published: number;
  readonly card: Rect;
  readonly text: Rect;
  readonly shield: Rect;
  readonly shieldText: string | null;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly lines: readonly LineReading[];
}

interface Reading {
  readonly viewport: readonly number[];
  readonly faces: readonly FaceReading[];
}

/** Whether two drawn rectangles share more than rounding on both axes. */
function overlaps(left: Rect, right: Rect): boolean {
  const horizontal = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const vertical = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return horizontal > EPS && vertical > EPS;
}

const VIEWPORTS = [
  [1280, 800],
  [1440, 900],
] as const;

describe('the planeswalker face a browser draws', () => {
  browserIt(
    'covers no ability with its loyalty shield, and cuts no ability off the bottom of the card',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-card-loyalty-'));
      const file = join(directory, 'walkers.html');
      await writeFile(file, pageHtml(), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      const rungsMeasured = new Set<number>();
      let badgelessRows = 0;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const reading = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            `the walker gallery at ${where}`,
            GALLERY_FACE,
          )) as unknown as Reading;
          expect(reading.viewport, where).toEqual([width, height]);
          expect(reading.faces.length, `${where}: planeswalker faces measured`).toBe(FACES.length);

          const covered: string[] = [];
          const cut: string[] = [];
          const under: string[] = [];
          for (const face of reading.faces) {
            const card = BY_ID.get(face.id ?? '');
            if (card === undefined) {
              throw new Error(`${where}: the gallery drew an unknown face ${String(face.id)}`);
            }
            if (card.kind !== 'planeswalker') throw new Error(`${card.id} is not a planeswalker`);
            // The face is the one the ladder decided, or the numbers below are
            // about a box nothing sized.
            expect(face.published, `${where}: ${card.id} is at a rung nothing chose`).toBe(
              rulesFitStep(card),
            );
            expect(face.shieldText, `${where}: ${card.id} shield`).toBe(String(card.startingLoyalty));
            expect(face.lines.length, `${where}: ${card.id} rows drawn`).toBe(textBoxBlocks(card).length);
            rungsMeasured.add(face.published);

            for (const line of face.lines) {
              // A row that states no cost draws no badge and runs the full
              // width of the box, which is the flavor row and the second line
              // of any ability that prints two.
              if (line.loyalty === null) {
                badgelessRows += 1;
                expect(line.badges, `${where}: ${card.id} drew a badge on an uncosted row`).toBe(0);
              } else {
                expect(line.badges, `${where}: ${card.id} row ${line.loyalty} badge`).toBe(1);
              }
              // Defect 1: the shield painted over the words.
              if (overlaps(face.shield, line.rect)) {
                covered.push(`${card.id}: the shield covers "${line.words}"`);
              }
              // Defect 2: the row ran past the bottom of the card. The clip
              // edge is the box's padding box, so the scroll height below is
              // the exact test; this one is the symptom as it was seen, a line
              // of text disappearing under the frame.
              if (line.rect.bottom > face.card.bottom - EPS) {
                cut.push(
                  `${card.id}: "${line.words}" closes at ${String(line.rect.bottom)} past the card's ${String(face.card.bottom)}`,
                );
              }
            }
            if (face.scrollHeight > face.clientHeight + EPS) {
              cut.push(
                `${card.id}: ${String(face.scrollHeight)}px of rows in a ${String(face.clientHeight)}px box`,
              );
            }
            // Defect 3, which is neither of the two reported and is what let
            // both of them happen: the ladder's estimate of a costed row coming
            // in under the row the browser drew. `textBoxCost` is an upper
            // bound on the height of what a face draws, and a bound that is not
            // one is how a walker reaches a rung it does not fit. The rendered
            // quantity is the first row's top to the last row's bottom, which
            // holds the sheet's own dividers and margins exactly and excludes
            // the box's padding, which the estimate does not model.
            //
            // It was under by the cost badge's own block padding on every
            // costed row (`mtg-ypz`): the row is a baseline-aligned flex line,
            // the badge's padding hangs over the sentence's first line, and the
            // estimate charged the lines and not the padding. Three rows of a
            // shipped walker, three pixels, invisible to every arithmetic test
            // in the suite and to both assertions above — these faces sit at
            // the ladder floor by construction, so a short estimate does not
            // move them to a rung where it would show as a cut.
            const first = face.lines[0];
            const last = face.lines[face.lines.length - 1];
            if (first !== undefined && last !== undefined) {
              const content = last.rect.bottom - first.rect.top;
              const estimate = textBoxCost(card, rulesFitStep(card));
              if (estimate < content - EPS) {
                under.push(
                  `${card.id}: estimated ${estimate.toFixed(2)}px, rendered ${content.toFixed(2)}px over ${String(face.lines.length)} rows at rung ${String(face.published)}`,
                );
              }
            }
          }
          expect(
            covered,
            `${where}: the loyalty shield was drawn over ${String(covered.length)} ability rows: ${covered.join(' | ')}`,
          ).toEqual([]);
          expect(
            cut,
            `${where}: ${String(cut.length)} ability rows were cut off: ${cut.join(' | ')}`,
          ).toEqual([]);
          expect(
            under,
            `${where}: the estimate came in under the browser on ${String(under.length)} walker faces: ${under.join(' | ')}`,
          ).toEqual([]);
          console.log(
            `${where}: ${String(reading.faces.length)} planeswalker faces, no covered row, no cut row, no under-estimate`,
          );
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
          `the planeswalker face gate failed on ${String(cleanupErrors.length)} count(s):\n${cleanupErrors.map((error) => error.message).join('\n')}`,
        );
      }

      // Floors, so a green run is a run that measured the case it exists for.
      // The wordiest walker must have reached the last rung of the loyalty
      // ladder: a run in which every face had room to spare would prove nothing
      // about either defect, both of which were reported on the face that had
      // none.
      expect(
        rungsMeasured.has(LOYALTY_FIT_STEPS.length - 1),
        `no face reached the floor of the loyalty ladder; rungs drawn: ${[...rungsMeasured].sort((left, right) => left - right).join(', ')}`,
      ).toBe(true);
      expect(badgelessRows, 'no row without a cost badge was drawn, so none was measured').toBeGreaterThan(0);
    },
    120_000,
  );
});
