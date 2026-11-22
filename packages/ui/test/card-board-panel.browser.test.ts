// @vitest-environment node
/**
 * The rules panel on the narrowest board face, and the floor under it.
 *
 * `mtg-8kc`. Under `../src/styles/card.ts`'s `BOARD_RULES_PANEL_MAX_REM` a board
 * face used to print no rules text at all: name, picture, and nothing a player
 * could read. The box now leaves the column at that width and draws over the
 * foot of the picture instead, so the height comes out of the art rather than
 * out of the card, which is the trade the playtester took from Magic Online's own
 * smallest permanent. She gated it on one measurement — the panel legible at
 * 63.3px, the narrowest face a played position reaches — and this is that
 * measurement kept.
 *
 * It is a band rather than a ceiling. `BOARD_RULES_PANEL_MIN_REM` is the floor,
 * and the floor is the finding that cost the first version of this: a panel is
 * drawn between two boxes that already live in the picture — the cost pips in
 * its head and the P/T badge in its foot — and below a 60px content box a line
 * of text does not fit between them. `page-overlap.browser.test.ts` caught the
 * collision on a game-over table at 1280x800, where a face is 56px. So all three
 * widths are claims: one that draws nothing, one that draws a panel, one that
 * draws a column.
 *
 * **It cannot be asserted anywhere but a real browser.** Every quantity here is
 * a used value: a `clamp()` against a container query, an out-of-flow box, and
 * the rect of one character. jsdom performs no layout, so all of them are zero
 * there and `./board-rules-text.test.ts`'s claim — that the declarations are in
 * the sheet — would pass on a panel drawn under the P/T badge.
 *
 * **The text is read one character at a time**, which is the house method
 * (`../tools/face-floor.ts`): a box that clips reports a `scrollHeight` about
 * the text it wanted and says nothing about the text it drew, and a character
 * painted under the badge is in `textContent` either way. So a character counts
 * only when its own rect lies inside the panel and outside both the badge and
 * the pips.
 *
 * **Two of the eleven subjects are spells**, and they are not filler. A spell's
 * face has no `.mtg-card__stats` at all, so the reserve that lifts the panel off
 * the badge is written `:has(.mtg-card__stats)`; the unconditional version spent
 * 17px of a sorcery's picture on a badge it has not got, and at the bottom of
 * this band those 17px are the difference between a panel that clears the cost
 * pips and one that does not.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCards, parseCardsDocumentJson, renderOracleText } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { describe, expect } from 'vitest';
import { Card } from '../src/card/Card';
import { uiStyleSheet } from '../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from './support/chrome';

const FLAGSHIP = new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url);

/**
 * The three widths, and what each one is a claim about.
 *
 * `BELOW_WIDTH` is under the floor: a 62px face is a 58.91px content box, the
 * sweep's own worst clearance there was +0.5px, and half a pixel is not a
 * margin, so the box goes. `PANEL_WIDTH` is the width the bead was gated on.
 * `COLUMN_WIDTH` is the first width above the threshold that a table reaches,
 * and it is here so a rule that leaked upward fails in this file rather than on
 * a table months later.
 */
const BELOW_WIDTH = 62;
const PANEL_WIDTH = 63.3;
const COLUMN_WIDTH = 68;

/** The printed card's own proportion, which is what a slot pins the trim to. */
const CARD_ASPECT = 88 / 63;

/**
 * `BOARD_TEXT_FLOOR_REM` in the sheet, in px at the 16px root the page is drawn
 * at. It is the floor of the rules box's clamp, so the panel resolving to it is
 * the statement that this face is as small as the type ever gets.
 */
const TEXT_FLOOR_PX = 9;

function flagship(): readonly DslCard[] {
  const document: unknown = JSON.parse(readFileSync(FLAGSHIP, 'utf8'));
  if (typeof document !== 'object' || document === null || !('cards' in document)) {
    throw new Error('the flagship fixture is not a set document');
  }
  const { cards } = document as { readonly cards: unknown };
  if (!Array.isArray(cards)) throw new Error('the flagship fixture has no cards array');
  // Two neutral fixtures retain the six keyword, three sentence, two spell subjects.
  const sentenceCards = parseCardsDocumentJson(
    readFileSync(new URL('../../dsl/fixtures/sets/lantern-fen.set.json', import.meta.url), 'utf8'),
  );
  return [...parseCards(cards), ...sentenceCards];
}

/**
 * Six creatures whose text is a keyword, three whose text is a sentence, and two
 * spells.
 *
 * The keyword line is printed first (`../src/card/Card.ts`'s `textBox`), so it
 * is the line a clip spares and the line the panel exists to carry. The wordy
 * three are here because a panel that only ever draws `Flying` has been measured
 * on nothing: they are the cards that fill the line box and the cards whose text
 * the clip actually cuts. The two spells are the badge-less arm of the reserve.
 */
function subjects(cards: readonly DslCard[]): readonly DslCard[] {
  const keyworded = cards.filter((card) => card.kind === 'creature' && card.keywords.length === 1);
  const wordy = cards.filter(
    (card) => card.kind === 'creature' && card.keywords.length === 0 && renderOracleText(card).trim() !== '',
  );
  const spells = cards.filter((card) => card.kind === 'instant' || card.kind === 'sorcery');
  return [...keyworded.slice(0, 6), ...wordy.slice(0, 3), ...spells.slice(0, 2)];
}

function cell(card: DslCard, width: number): ReactElement {
  const height = Math.round(width * CARD_ASPECT * 10) / 10;
  return h(
    'div',
    {
      key: `${card.id}-${String(width)}`,
      className: 'panel-cell',
      style: { width: `${String(width)}px`, height: `${String(height)}px` },
      'data-card': card.id,
      'data-face-width': String(width),
    },
    h(Card, { card, size: 'board', art: null }),
  );
}

function pageHtml(cards: readonly DslCard[]): string {
  const markup = renderToStaticMarkup(
    h(
      'div',
      { className: 'panel-page' },
      ...[BELOW_WIDTH, PANEL_WIDTH, COLUMN_WIDTH].map((width) =>
        h('div', { key: String(width), className: 'panel-row' }, ...cards.map((card) => cell(card, width))),
      ),
    ),
  );
  // The cell is the slot: the face fills it, the way ../src/styles/board/slot.ts
  // pins the trim on a real table. `flex: none` on the cell is load-bearing —
  // a row of flex children shrinks to fit, and a first run of the sweep behind
  // this file measured eleven 11.64px faces and reported them as findings.
  const rig = `html,body{margin:0;padding:0}
.panel-row { display: flex; gap: 6px; padding: 6px; align-items: flex-start; }
.panel-cell { flex: none; }
.panel-cell > .mtg-card { --card-w: 100%; width: 100%; height: 100%; }`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Board rules panel</title><style>${uiStyleSheet()}${rig}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const cells = [...document.querySelectorAll('.panel-cell')];
  if (cells.length === 0) return null;
  return {
    faces: cells.map((cell) => {
      const face = cell.querySelector('.mtg-card');
      const rules = face.querySelector("[data-region='rules']");
      const art = face.querySelector("[data-region='art']");
      const title = face.querySelector("[data-region='title']");
      const badge = face.querySelector('.mtg-card__stats');
      const corner = face.querySelector('.mtg-card__corner');
      const keywords = face.querySelector('.mtg-card__keywords');
      const style = window.getComputedStyle(rules);
      const hidden = style.display === 'none';
      const rect = rules.getBoundingClientRect();
      const artRect = art.getBoundingClientRect();
      const badgeRect = badge === null ? null : badge.getBoundingClientRect();
      const cornerRect = corner === null ? null : corner.getBoundingClientRect();
      let drawn = '';
      let coveredByBadge = 0;
      let coveredByPips = 0;
      let firstTop = null;
      let firstLine = '';
      let lines = 0;
      if (!hidden) {
        const walker = document.createTreeWalker(rules, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        const tops = [];
        let node = walker.nextNode();
        while (node !== null) {
          const text = node.nodeValue === null ? '' : node.nodeValue;
          for (let index = 0; index < text.length; index += 1) {
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const box = range.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) { drawn += text[index]; continue; }
            const inside =
              box.top >= rect.top - 0.5 && box.bottom <= rect.bottom + 0.5 &&
              box.left >= rect.left - 0.5 && box.right <= rect.right + 0.5;
            if (!inside) continue;
            if (
              badgeRect !== null &&
              box.right > badgeRect.left && box.left < badgeRect.right &&
              box.bottom > badgeRect.top && box.top < badgeRect.bottom
            ) { coveredByBadge += 1; continue; }
            if (
              cornerRect !== null &&
              box.right > cornerRect.left && box.left < cornerRect.right &&
              box.bottom > cornerRect.top && box.top < cornerRect.bottom
            ) { coveredByPips += 1; continue; }
            drawn += text[index];
            if (firstTop === null) firstTop = round(box.top);
            if (Math.abs(round(box.top) - firstTop) < 0.6) firstLine += text[index];
            if (!tops.some((top) => Math.abs(top - round(box.top)) < 0.6)) tops.push(round(box.top));
          }
          node = walker.nextNode();
        }
        lines = tops.length;
      }
      const titleRect = title.getBoundingClientRect();
      const overlap = Math.min(rect.bottom, artRect.bottom) - Math.max(rect.top, artRect.top);
      return {
        card: cell.dataset.card,
        faceWidth: round(cell.getBoundingClientRect().width),
        position: style.position,
        display: style.display,
        fontSize: round(parseFloat(style.fontSize)),
        panelTop: round(rect.top),
        panelBottom: round(rect.bottom),
        panelWidth: round(rect.width),
        panelHeight: round(rect.height),
        artTop: round(artRect.top),
        artBottom: round(artRect.bottom),
        artHeight: round(artRect.height),
        titleBottom: round(titleRect.bottom),
        hasBadge: badge !== null,
        badgeTop: badgeRect === null ? null : round(badgeRect.top),
        pipBottom: cornerRect === null ? null : round(cornerRect.bottom),
        pipClearance: cornerRect === null || hidden ? null : round(rect.top - cornerRect.bottom),
        keywordText: keywords === null ? null : (keywords.textContent ?? '').trim(),
        drawnCharacters: drawn.length,
        drawnLines: lines,
        coveredByBadge,
        coveredByPips,
        firstLine,
        occludedShare: artRect.height > 0 ? round(Math.max(0, overlap) / artRect.height) : 0,
      };
    }),
  };
})()`;

interface Face {
  readonly card: string;
  readonly faceWidth: number;
  readonly position: string;
  readonly display: string;
  readonly fontSize: number;
  readonly panelTop: number;
  readonly panelBottom: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly artTop: number;
  readonly artBottom: number;
  readonly artHeight: number;
  readonly titleBottom: number;
  readonly hasBadge: boolean;
  readonly badgeTop: number | null;
  readonly pipBottom: number | null;
  readonly pipClearance: number | null;
  readonly keywordText: string | null;
  readonly drawnCharacters: number;
  readonly drawnLines: number;
  readonly coveredByBadge: number;
  readonly coveredByPips: number;
  readonly firstLine: string;
  readonly occludedShare: number;
}

interface Reading {
  readonly faces: readonly Face[];
}

function at(faces: readonly Face[], width: number): readonly Face[] {
  return faces.filter((face) => Math.abs(face.faceWidth - width) < 0.5);
}

describe('a board face too narrow for a rules box', () => {
  browserIt(
    'reads its rules off a panel over the picture, clear of the badge and the pips',
    async () => {
      const cards = subjects(flagship());
      expect(cards.length, 'the flagship fixture holds subjects to measure').toBe(11);
      const directory = await mkdtemp(join(tmpdir(), 'mtg-board-panel-'));
      const userDataDir = await mkdtemp(join(tmpdir(), 'mtg-board-panel-chrome-'));
      const chrome = await launchChrome(userDataDir);
      try {
        const file = join(directory, 'panel.html');
        await writeFile(file, pageHtml(cards), 'utf8');
        const seen = (await measurePage(
          chrome.client,
          file,
          1400,
          1000,
          MEASURE,
          `eleven board faces at ${String(BELOW_WIDTH)}px, ${String(PANEL_WIDTH)}px and ${String(COLUMN_WIDTH)}px`,
          '.mtg-card',
        )) as unknown as Reading | null;
        if (seen === null) throw new Error('the page drew no board face');
        expect(seen.faces.length, 'all three widths drew all eleven faces').toBe(cards.length * 3);

        const below = at(seen.faces, BELOW_WIDTH);
        const panels = at(seen.faces, PANEL_WIDTH);
        const columns = at(seen.faces, COLUMN_WIDTH);
        for (const [width, row] of [
          [BELOW_WIDTH, below],
          [PANEL_WIDTH, panels],
          [COLUMN_WIDTH, columns],
        ] as const) {
          expect(row.length, `eleven faces at ${String(width)}px`).toBe(cards.length);
        }
        // Both arms of the reserve are exercised rather than assumed: nine faces
        // carry a P/T badge and two do not.
        expect(
          panels.filter((face) => face.hasBadge).length,
          'the panel row measures faces that draw a badge',
        ).toBe(9);
        expect(
          panels.filter((face) => !face.hasBadge).length,
          'the panel row measures faces that draw no badge',
        ).toBe(2);

        for (const face of panels) {
          const where = `${face.card} at ${String(face.faceWidth)}px`;

          // The gate: the shipped sheet drew zero characters on all eleven.
          expect(face.drawnCharacters, `${where}: the panel draws text at all`).toBeGreaterThan(0);
          expect(face.fontSize, `${where}: the type is at the board floor`).toBeCloseTo(TEXT_FLOOR_PX, 1);

          // One line box, which is `BOARD_RULES_PANEL_LINES`. A second is 10.8px
          // the window has not got at the bottom of this band, and asking for it
          // is what ran the panel's head into the cost pips.
          expect(face.drawnLines, `${where}: the panel draws one line`).toBe(1);

          // Over the picture, not below it: out of flow, and inside the window
          // on both block ends.
          expect(face.position, `${where}: the box is out of the column`).toBe('absolute');
          expect(face.panelBottom, `${where}: the panel's foot is inside the window`).toBeLessThan(
            face.artBottom + 0.5,
          );
          expect(face.panelTop, `${where}: the panel's head is inside the window`).toBeGreaterThan(
            face.artTop - 0.5,
          );
          // And clear of the name above it, which is what the raise off the
          // badge cost the panel at the top of its travel.
          expect(face.panelTop, `${where}: the panel clears the title bar`).toBeGreaterThan(face.titleBottom);

          // Clear of the badge rather than under it. Zero is the whole claim:
          // the arrangement that draws the panel at the window's foot ate one to
          // six characters of the keyword line here.
          expect(face.coveredByBadge, `${where}: the badge covers no character`).toBe(0);
          if (face.badgeTop !== null) {
            expect(face.panelBottom, `${where}: the panel stops above the badge`).toBeLessThan(
              face.badgeTop + 0.5,
            );
          }

          // And clear of the cost pips, which is the collision the floor exists
          // to prevent and the one `page-overlap.browser.test.ts` found.
          expect(face.coveredByPips, `${where}: the pips cover no character`).toBe(0);
          expect(face.pipClearance, `${where}: the panel's head clears the cost`).toBeGreaterThan(0);

          // The keyword line arrives whole and on one line, which is the bar the
          // constant's docblock sets: First strike, Vigilance, Lifelink.
          if (face.keywordText !== null && face.keywordText !== '') {
            expect(face.firstLine, `${where}: the keyword line is drawn whole`).toBe(face.keywordText);
          }

          // And what it costs the picture, which is the side of the trade the
          // decision spent.
          expect(face.occludedShare, `${where}: the panel covers under 40% of the window`).toBeLessThan(0.4);
          expect(face.panelWidth, `${where}: the panel is the content box's width`).toBeGreaterThan(
            face.faceWidth * 0.85,
          );
        }

        // Under the floor the box goes, and that is the recorded cost of the
        // band rather than an oversight: a 62px face is a 58.91px content box,
        // and a line of text does not fit between the pips and the badge there.
        for (const face of below) {
          const where = `${face.card} at ${String(face.faceWidth)}px`;
          expect(face.display, `${where}: the box is drawn under the panel's floor`).toBe('none');
          expect(face.drawnCharacters, `${where}: a hidden box draws no character`).toBe(0);
        }

        // Above the threshold the same eleven cards draw the same box in the
        // column, under the picture rather than over it.
        for (const face of columns) {
          const where = `${face.card} at ${String(face.faceWidth)}px`;
          expect(face.position, `${where}: the box is in the column`).toBe('static');
          expect(face.panelTop, `${where}: the box sits under the window`).toBeGreaterThan(
            face.artBottom - 0.5,
          );
          expect(face.drawnCharacters, `${where}: the box draws text`).toBeGreaterThan(0);
        }
      } catch (error) {
        throw new Error(reason(error));
      } finally {
        await shutdownChrome(chrome);
        await rm(directory, { recursive: true, force: true });
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
