// @vitest-environment node
/**
 * The zoom is the read surface, and this is the measurement that says it can be.
 *
 * `mtg-rgc.9` / `mtg-rgc.9.2`, decided 2026-09-03: the hand does not fan, and
 * the hover zoom is where a card's rules text is read. The face in hand states
 * the name, the cost, the type line and the first line or two of text; the whole
 * text is the panel's job. That decision is only sound if the panel holds the
 * wordiest card the table can deal, so this file holds the panel to it and
 * records where its capacity ends.
 *
 * # What the hand face does and does not do, measured
 *
 * `../../tools/hand-scale.ts` against the played corpus, seven wordiest cards,
 * four permanents a side:
 *
 *     viewport    held face    rules type   column     cut      boxes needed
 *     1440x900    120px        9.8px        28 chars   7 of 7   12.2 - 16.2
 *     1280x801    103.3px      9.4px        24 chars   7 of 7   12.6 - 16.6
 *     1280x800     88px        9.0px        19 chars   7 of 7   12.4 - 16.2
 *     1024x768     88px        9.0px        19 chars   7 of 7   12.4 - 16.2
 *
 * Names cut: 0 of 7 at every viewport. Type lines cut: 0 of 7 at every viewport.
 * So the face does state name, cost and type everywhere, and the hand's own
 * budget (`styles/board/hand.ts`, 3 to 5 line boxes) cuts the rules text on
 * every wordy card at every size. That half is `./hand-allocation.browser.test.ts`'s;
 * asking the face for the rest is `mtg-rgc.9.1`'s named non-answer, because the
 * text it would draw is 9px over a 19-character column.
 *
 * A correction to `mtg-rgc.9`'s opening claim while it is in view: the hand is
 * **not** the largest face on the table. It is at or just under the battlefield
 * face at every measured size, 0.88 to 1.00 of it, which is the ratio
 * `./hand-allocation.browser.test.ts` pins.
 *
 * # What the panel does, and where it stops
 *
 * Measured 2026-09-04 in chrome-headless-shell over the corpus `npm run play`
 * deals, sixteen wordiest cards drawn as `ZoomPanel`s. The reading face is now
 * 384 x 536px with 15.6px rules text; name and type line remain uncut and the
 * imported-card census holds all 600 official positions to zero overflow,
 * identical at 1440x900, 1280x800 and 1024x768. The panel is a fixed box at
 * `ZOOM_FACE_WIDTH_REM`, so it does not vary with the table it is over; the
 * three viewports say that rather than look for a boundary.
 *
 * It is not unbounded, and layout capacity is not universally a character
 * count. The rules box is the residual of a fixed face, so **its height depends
 * on what else the face draws**: 157px on an ordinary face and 174px on a
 * walker, which at 18.9px of leading is 8.3 line boxes against 9.2. At the
 * decision measurement the generated corpus's wordiest card was a
 * 278-character walker and its wordiest ordinary face was 236. Authored cards
 * of the shape below, on an ordinary face, read whole at 262 characters. The
 * former 274-character control now fits after the text-box improvements, so a
 * repeated-effect control keeps the browser rig's negative proof
 * outside the panel's current capacity. The measured fit point remains the
 * generator's conservative ordinary-face admission boundary, and `CONTROL`
 * keeps the refusal tied to real pixels rather than remembered prose. Imported and
 * subsequently authored compatibility remains a separate policy.
 *
 * Two things that follow, neither of them a defect in this file's scope. The
 * zoom overrules the fit ladder to hold 15.6px (`styles/card.ts`), so a card past
 * the capacity is cut here rather than set smaller — and the plain `full` face
 * is no refuge: the same three cards measured 35, 49 and 68px of overflow there,
 * at the ladder's 10.1px floor, because that face's box is 103px. The panel is
 * the largest reading surface the app has, and text past it is reachable only
 * through the face's `title` (`faceDetailText`). `mtg-rgc.9.3` carries that.
 *
 * # Why the cards below are written rather than dealt
 *
 * The neutral `@mtg/dsl` example set is what a public package may read
 * (`AGENTS.md`), and its wordiest card is 62 characters — a card that fits the
 * hand face, so a green run against it alone would prove nothing about the
 * panel. Naming a card from the played corpus here would put a proper noun from
 * the private world in a public package. So both stress cards are authored: one
 * past the wordiest ordinary face the corpus deals, one past the panel's
 * capacity. The example set is drawn beside them, because the claim is about
 * every card the panel is given and not only about the worst.
 *
 * # What the rig does to the sheet, and what it may not do
 *
 * `.mtg-zoom` ships `display: none` and is revealed by a slot's `:hover` or
 * `:focus-visible`; a headless run has neither, and `measurePage` cannot restyle
 * the page from inside the evaluation (`../support/chrome-driver.ts`). So the
 * reveal is baked into the page's own `<style>`, with `position: static` so the
 * panels stack instead of landing on top of one another in the corner. Neither
 * override touches a width, a font size or a line budget, which is everything
 * the readings below are about.
 *
 * What that costs is the trigger: a page that reveals the panel by hand cannot
 * also prove the sheet reveals it. `./zoom-touch.browser.test.ts` drives the
 * real gesture, and the plain test below reads both triggers out of the sheet,
 * because a read surface reachable only with a mouse is not one.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, parseCard, renderOracleText } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { ZOOM_RULES_CHARACTER_CAPACITY } from '@mtg/card-geometry';
import { describe, expect, it } from 'vitest';
import { ZoomPanel } from '../../src/card/ZoomPanel';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/**
 * The longest rendered oracle text on an ordinary face in the corpus
 * `npm run play` deals, in characters, measured 2026-09-04 over the committed
 * 372-card fixture.
 *
 * Ordinary rather than longest outright: the corpus's 278-character ceiling is a
 * walker, whose face draws into a 17px taller rules box, so it is the wrong
 * thing for an authored creature to be measured against. A number rather than a
 * fixture read, because reading the fixture would put its cards in this file.
 */
const CORPUS_ORDINARY_CEILING_CHARS = 236;

const KEYWORDS = [
  'flying',
  'vigilance',
  'lifelink',
  'firstStrike',
  'trample',
  'deathtouch',
  'menace',
  'reach',
  'haste',
] as const;

const ABILITIES = [
  {
    kind: 'triggered',
    condition: 'selfEnters',
    effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'activated',
    cost: { mana: { generic: 2, U: 1 } },
    effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'triggered',
    condition: 'selfDies',
    effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }],
  },
  {
    kind: 'triggered',
    condition: 'selfAttacks',
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 3,
        toughness: 3,
        target: { kind: 'targetCreatureYouControl' },
      },
      {
        kind: 'pumpUntilEndOfTurn',
        power: 4,
        toughness: 4,
        target: { kind: 'targetCreatureYouControl' },
      },
      {
        kind: 'pumpUntilEndOfTurn',
        power: 2,
        toughness: 2,
        target: { kind: 'targetCreatureYouControl' },
      },
    ],
  },
] as const;

/**
 * A creature carrying as much text as the shape allows, at a stated size.
 *
 * Written out rather than dealt, and written as a ladder rather than as one card
 * so the two cases below differ only in how much they say. The name is 31
 * characters, which is the column `styles/card.ts` calibrates the name ladder's
 * floor on and therefore the longest name the panel claims to draw whole.
 */
function wordyCard(id: string, name: string, abilities: number, keywords: number): DslCard {
  return parseCard({
    id,
    name,
    kind: 'creature',
    rarity: 'mythic',
    set: { code: 'ZRC', collectorNumber: 1 },
    colors: ['W', 'U'],
    subtypes: ['Warden'],
    manaCost: { generic: 4, W: 1, U: 1 },
    power: 4,
    toughness: 5,
    keywords: KEYWORDS.slice(0, keywords),
    abilities: ABILITIES.slice(0, abilities),
  });
}

/** 262 characters: past anything the set deals on this face, and it reads whole. */
const STRESS = wordyCard('zoom-read-stress', 'Warden of the Long Reading Room', 3, 5);

/**
 * A deliberately repeated-effect hostile shape past the generator's conservative
 * ordinary-face boundary, and the floor under every green run.
 *
 * Without it a panel that had quietly stopped drawing its rules box at all, or a
 * reading that could no longer see a cut, would pass every assertion above by
 * measuring nothing. It is asserted cut, so if this ever reads whole the panel
 * grew and this control has to grow with it — which is a real change to the
 * decision this file records, not a maintenance chore.
 */
const CONTROL = wordyCard('zoom-read-overrun', 'Warden of the Long Reading Room', 4, 6);

const READS_WHOLE: readonly DslCard[] = [STRESS, ...EXAMPLE_SET];
const CARDS: readonly DslCard[] = [...READS_WHOLE, CONTROL];

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
] as const;

/**
 * The size the zoom sets its rules text at, in rem, read out of the sheet.
 *
 * `.mtg-zoom > .mtg-card` scales `--mtg-text-sm` with the reading face and the
 * generated-card rule overrules the fit ladder at higher specificity, which is
 * the whole of what makes this generated-card panel a reading surface rather
 * than a bigger thumbnail. Official printed faces deliberately keep their own
 * fit rung and are censused separately. Read rather than restated, so changing
 * the token moves this file with it and pointing the zoom at a different one
 * fails it.
 */
function zoomRulesRem(): number {
  const sheet = uiStyleSheet();
  const token =
    /\.mtg-zoom > \.mtg-card \{[\s\S]*?--rules-type: calc\(var\((--mtg-text-[a-z]+)\) \* ([\d.]+)\);/.exec(
      sheet,
    );
  if (token === null) throw new Error('the zoom names no rules-text token');
  const size = new RegExp(`${String(token[1])}: ([\\d.]+)rem;`).exec(sheet);
  if (size === null) throw new Error(`the sheet gives no size for ${String(token[1])}`);
  return Number(size[1]) * Number(token[2]);
}

function page(): string {
  const markup = CARDS.map((card) => renderToStaticMarkup(h(ZoomPanel, { card, art: null }))).join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Zoom read</title>',
    `<style>${uiStyleSheet()}`,
    'html,body{margin:0;padding:0}body{display:flex;flex-wrap:wrap}',
    // The two overrides, and nothing else: reveal what a hover would reveal, and
    // let the panels stack rather than pile up in one corner.
    '.mtg-zoom{display:block !important;position:static !important;margin:8px;}',
    `</style></head><body>${markup}</body></html>`,
  ].join('');
}

/**
 * Boxes, not declarations. `scrollHeight` against `clientHeight` is the only
 * thing that answers "is this text cut", and jsdom lays nothing out, so it
 * answers zero for a panel that reads and a panel that does not alike.
 */
const MEASURE = `(() => {
  const round = (v) => Math.round(v * 10) / 10;
  const cut = (n) => n !== null && (n.scrollWidth > n.clientWidth + 0.5 || n.scrollHeight > n.clientHeight + 0.5);
  const faces = [...document.querySelectorAll('.mtg-zoom')].map((zoom) => {
    const card = zoom.querySelector('.mtg-card');
    const rules = card.querySelector('.mtg-card__text');
    const style = rules === null ? null : getComputedStyle(rules);
    const box = card.getBoundingClientRect();
    return {
      id: card.getAttribute('data-card-id'),
      w: round(box.width),
      h: round(box.height),
      rulesPx: style === null ? 0 : round(parseFloat(style.fontSize)),
      boxes: rules === null || style === null ? 0 : round(rules.clientHeight / parseFloat(style.lineHeight)),
      rulesOverflow: rules === null ? 0 : round(Math.max(0, rules.scrollHeight - rules.clientHeight)),
      nameCut: cut(card.querySelector('.mtg-card__name')),
      typeCut: cut(card.querySelector('.mtg-card__type')),
      faceOverflow: round(Math.max(0, card.scrollHeight - card.clientHeight)),
    };
  });
  return { viewport: [window.innerWidth, window.innerHeight], root: parseFloat(getComputedStyle(document.documentElement).fontSize), faces };
})()`;

interface Panel {
  readonly id: string | null;
  readonly w: number;
  readonly h: number;
  readonly rulesPx: number;
  /** Line boxes the rules region is given, which is the capacity the text has to fit. */
  readonly boxes: number;
  readonly rulesOverflow: number;
  readonly nameCut: boolean;
  readonly typeCut: boolean;
  readonly faceOverflow: number;
}

describe('the hover zoom is the surface a card is read on', () => {
  it('is stressed past the wordiest face the set deals', () => {
    expect(renderOracleText(STRESS).length).toBeGreaterThan(CORPUS_ORDINARY_CEILING_CHARS);
    expect(renderOracleText(STRESS)).toHaveLength(ZOOM_RULES_CHARACTER_CAPACITY.ordinary);
    expect(renderOracleText(CONTROL)).toHaveLength(498);
    expect(renderOracleText(CONTROL).length).toBeGreaterThan(ZOOM_RULES_CHARACTER_CAPACITY.ordinary);
  });

  it('is revealed by a pointer and by a keyboard, so the reading is reachable either way', () => {
    const sheet = uiStyleSheet();
    expect(sheet, 'the panel does not start hidden').toContain('.mtg-zoom {\n  display: none;');
    expect(sheet, 'no pointer reveals the panel').toContain('.mtg-slot:hover > .mtg-zoom');
    expect(sheet, 'no keyboard reveals the panel').toContain('.mtg-slot:has(:focus-visible) > .mtg-zoom');
  });

  browserIt(
    'draws a card wordier than the set deals whole, at full-size rules text, on every desktop table',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-zoom-read-'));
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        const file = join(directory, 'zoom.html');
        await writeFile(file, page(), 'utf8');
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const result = await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            'zoom read',
            '.mtg-zoom > .mtg-card',
          );
          expect(result['viewport']).toEqual([width, height]);
          const root = result['root'] as number;
          const faces = result['faces'] as readonly Panel[];
          expect(faces, `${where}: panel count`).toHaveLength(CARDS.length);

          for (const face of faces) {
            const at = `${where}: ${String(face.id)}`;
            const overrun = face.id === CONTROL.id;

            // The finding. Every card the panel is given reads whole: the rules
            // box holds its own text, and the two lines a player identifies the
            // card by are not cut either.
            if (!overrun) {
              expect(face.rulesOverflow, `${at}: rules text cut by ${String(face.rulesOverflow)}px`).toBe(0);
            }
            expect(face.nameCut, `${at}: name cut`).toBe(false);
            expect(face.typeCut, `${at}: type line cut`).toBe(false);
            expect(face.faceOverflow, `${at}: the face overflowed its own trim`).toBe(0);

            // At full size, which is what separates this from a larger
            // thumbnail: the face in hand steps its text down the fit ladder and
            // the panel steps it back to the token.
            expect(face.rulesPx, `${at}: rules text size`).toBeCloseTo(zoomRulesRem() * root, 1);

            // And the panel is a fixed box that fits the shortest table we
            // support, so nothing about the reading depends on the window it is
            // over.
            expect(
              face.h,
              `${at}: a ${String(face.h)}px panel over a ${String(height)}px window`,
            ).toBeLessThan(height);
          }

          // The floor under all of it. A rules region that had stopped drawing,
          // or a reading that could no longer see a cut, would satisfy every
          // assertion above by measuring nothing.
          const control = faces.find((face) => face.id === CONTROL.id);
          expect(control, `${where}: the overrun control drew no panel`).toBeDefined();
          expect(
            control?.rulesOverflow ?? 0,
            `${where}: the overrun control was not cut, so a cut is invisible to this rig`,
          ).toBeGreaterThan(0);
          const stress = faces.find((face) => face.id === STRESS.id);
          expect(stress, `${where}: the stress card drew no panel`).toBeDefined();
          expect(
            stress?.boxes ?? 0,
            `${where}: the stress card was given fewer line boxes than the hand's own budget`,
          ).toBeGreaterThan(5);
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
