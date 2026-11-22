/**
 * What a board face too narrow for a rules box reads off the panel over its
 * picture.
 *
 * `mtg-8kc`. Below `../src/styles/card.ts`'s `BOARD_RULES_PANEL_MAX_REM` the
 * rules box used to be drawn nowhere, so a 1024x768 table printed name, picture
 * and type line and no words. the playtester's decision on 2026-09-03 was that the
 * pixels come from the art rather than from the column: below a stated width the
 * rules text stops taking its own height and draws as a panel over the bottom of
 * the window, truncated, which is what Magic Online's client does at a 109 x 155
 * permanent. She gated it on one measurement, and this rig is that measurement:
 * **the panel legible at 63.3px**, which is the narrowest face a played position
 * reaches (1280x800, one attacker declared, combat band 119.2px, rows 100 each).
 *
 * Five numbers per face, because "legible" is not one question:
 *
 *  - **The type size the panel resolves to.** `BOARD_TEXT_FLOOR_REM` is 9px and
 *    is the floor every other reading on this face is taken against.
 *  - **What the first line holds.** A `Range` over each character gives one rect
 *    per character, so the reading is the text a player can read rather than the
 *    text the markup carries. A keyword line that arrives whole is the bar the
 *    `BOARD_RULES_PANEL_MAX_REM` docblock sets: `First strike` and `Deathtouch`
 *    and `Vigilance`.
 *  - **What the panel costs the picture**, as the share of the window's height
 *    it covers. The column pays nothing under this treatment; the picture pays
 *    in occlusion, and that is the trade being priced.
 *  - **What the P/T badge covers and what the panel reaches.** The badge is the
 *    one thing inside the window the panel can collide with, and the title bar
 *    is the one thing above it, so both are counted per character rather than
 *    argued about. The arrangement that ships raises the panel clear of the
 *    badge; the two it was chosen over are in the constant's docblock.
 *  - **Lines wanted against lines shown**, so a panel that silently drops a
 *    card's second sentence says so.
 *
 * Widths: the hard case, the two a played table reaches, and 109 for the client
 * the treatment is copied from.
 *
 * It drives chrome-headless-shell itself, the way `./shots.ts` does, because the
 * answer is a number rather than a page to look at — and it rasters the 63.3px
 * row anyway, because a number that says nothing is covered still cannot say
 * whether the result reads.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/board-panel.ts out/board-panel
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCards, parseCardsDocumentJson, renderOracleText } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import { uiStyleSheet } from '../src/styles/index';
import { cleanupTarget, launchChrome, measurePage, shutdownChrome } from '../test/support/chrome-driver';
import type { CdpClient } from '../test/support/chrome-driver';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * The widths measured, in px of face.
 *
 * 63.3 is the bead's hard case. 68 and 82.6 are what `card-uniformity.ts` read
 * off 1024x768 and 1280x800 at four permanents a side. 109 is the width Magic
 * Online draws the panel at, and is here so a reading at 63.3 can be compared
 * against the client the treatment is borrowed from rather than only against a
 * floor.
 *
 * 56, 60 and 62 were added after the fact and are the reason the list is not
 * just the bead's own number. `../test/play/page-overlap.browser.test.ts`
 * builds its positions out of a played game rather than out of a list of widths,
 * and its game-over table at 1280x800 draws a 56px face. The first panel
 * measured over this rig cleared the P/T badge and the title bar, because those
 * are what it was asked about, and reached into the cost pips at 56 — so the
 * narrowest width a rig states is a guess about a table until a table is
 * measured, and this one was wrong by 7.3px. 60 and 62 bracket
 * `BOARD_RULES_PANEL_MIN_REM`, the floor that reading produced.
 *
 * The `subjects` below are nine creatures and two spells, and the floor was not
 * set from them: it was read with this function returning every non-land card in
 * the fixture, 79 faces a width, because the binding case is a name that wraps
 * to two lines and which of nine cards does that is an accident of the nine.
 * Worst clearance over all 79 was -2.11px at a 57.06px content box, +0.5px at
 * 58.91 and +2.02px at 60.08.
 */
const WIDTHS: readonly number[] = [56, 60, 62, 63.3, 68, 78, 82.6, 109];

/** The printed card's own proportion, which is what a slot pins the trim to. */
const CARD_ASPECT = 88 / 63;

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'board-panel');

const SET_PATH = join(REPO_ROOT, 'packages/setgen/fixtures/sets/tideglass-reach.set.json');

function flagship(): readonly DslCard[] {
  const document: unknown = JSON.parse(readFileSync(SET_PATH, 'utf8'));
  const { cards } = document as { readonly cards: unknown };
  if (!Array.isArray(cards)) throw new Error(`${SET_PATH} has no cards array`);
  // Two neutral fixtures retain the six keyword, three sentence, two spell subjects.
  const sentenceCards = parseCardsDocumentJson(
    readFileSync(new URL('../../dsl/fixtures/sets/lantern-fen.set.json', import.meta.url), 'utf8'),
  );
  return [...parseCards(cards), ...sentenceCards];
}

/**
 * The subjects: keyworded creatures first, then creatures whose text is a
 * sentence rather than a keyword.
 *
 * The keyword line is what the box prints first (`../src/card/Card.ts`'s
 * `textBox`), so it is the line a clip spares and the line this panel has to
 * carry; the wordy creatures are here because a treatment that only ever draws
 * `Flying` has not been measured on anything.
 */
function subjects(cards: readonly DslCard[]): readonly DslCard[] {
  const keyworded = cards.filter((card) => card.kind === 'creature' && card.keywords.length > 0);
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
      className: 'board-panel-cell',
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
      { className: 'board-panel' },
      ...WIDTHS.map((width) =>
        h(
          'div',
          { key: String(width), className: 'board-panel-row' },
          ...cards.map((card) => cell(card, width)),
        ),
      ),
    ),
  );
  const rig = `
html, body { margin: 0; padding: 0; background: #0d1016; }
.board-panel-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; align-items: flex-start; }
/* flex: none, because a row wide enough to need wrapping otherwise shrinks every
   cell instead and the rig measures a width nobody asked for. */
.board-panel-cell { flex: none; }
/* The cell is the slot: the face fills it, the way ../src/styles/board/slot.ts
   pins the trim on a real table. */
.board-panel-cell > .mtg-card { --card-w: 100%; width: 100%; height: 100%; }`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>mtg-8kc board panel</title><style>${uiStyleSheet()}${rig}</style></head><body>${markup}</body></html>`;
}

/**
 * The reading, in the page.
 *
 * Characters are measured one `Range` at a time and kept only when their own
 * rect lies inside the box, which is `./face-floor.ts`'s method and is here for
 * its reason: a box that clips reports a `scrollHeight` about what the content
 * wanted and says nothing about what was drawn. A character the badge covers is
 * counted separately rather than dropped, because a panel that draws a keyword
 * under the badge and a panel that does not draw it at all are the same string
 * to anything reading `textContent`.
 */
const MEASURE = `(() => {
  const r = (value) => Math.round(value * 100) / 100;
  const rows = [];
  for (const cell of document.querySelectorAll('.board-panel-cell')) {
    const face = cell.querySelector('.mtg-card');
    const rules = face.querySelector("[data-region='rules']");
    const type = face.querySelector("[data-region='type']");
    const art = face.querySelector("[data-region='art']");
    const title = face.querySelector("[data-region='title']");
    const faceRect = face.getBoundingClientRect();
    const artRect = art === null ? null : art.getBoundingClientRect();
    const faceStyle = window.getComputedStyle(face);
    const inset =
      parseFloat(faceStyle.paddingLeft) + parseFloat(faceStyle.paddingRight) +
      parseFloat(faceStyle.borderLeftWidth) + parseFloat(faceStyle.borderRightWidth);
    const row = {
      card: cell.dataset.card,
      faceWidth: r(faceRect.width),
      faceHeight: r(faceRect.height),
      contentWidth: r(faceRect.width - inset),
      artHeight: artRect === null ? 0 : r(artRect.height),
      drawn: false,
    };
    if (type !== null) {
      const typeStyle = window.getComputedStyle(type);
      const typeRect = type.getBoundingClientRect();
      row.typeDrawn = typeStyle.display !== 'none' && typeRect.height > 0;
      row.typeHeight = r(typeRect.height);
      row.typeText = type.textContent === null ? '' : type.textContent.trim();
      row.typeAfter = window.getComputedStyle(type.querySelector('.mtg-card__type') ?? type, '::after').content;
    }
    const badge = face.querySelector('.mtg-card__stats');
    const badgeRect = badge === null ? null : badge.getBoundingClientRect();
    row.hasBadge = badgeRect !== null;
    if (badgeRect !== null) {
      row.badgeWidth = r(badgeRect.width);
      row.badgeHeight = r(badgeRect.height);
    }
    // The cost, in the window's other corner. It is measured for the same reason
    // the badge is and it was missed for the opposite one: the badge is what the
    // panel was raised off, and the pips are what it was raised into.
    const corner = face.querySelector('.mtg-card__corner');
    const cornerRect = corner === null ? null : corner.getBoundingClientRect();
    if (cornerRect !== null) {
      row.pipHeight = r(cornerRect.height);
      row.pipBottom = r(cornerRect.bottom);
    }
    if (rules !== null) {
      const style = window.getComputedStyle(rules);
      const rect = rules.getBoundingClientRect();
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      row.drawn = style.display !== 'none' && rect.height > 0;
      row.fontSize = r(parseFloat(style.fontSize));
      row.lineHeight = r(lineHeight);
      row.panelWidth = r(rect.width);
      row.panelHeight = r(rect.height);
      row.linesShown = lineHeight > 0 ? r(rect.height / lineHeight) : 0;
      row.linesWanted = lineHeight > 0 ? r(rules.scrollHeight / lineHeight) : 0;
      const walker = document.createTreeWalker(rules, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let drawn = '';
      let characters = 0;
      let hidden = 0;
      let underPips = 0;
      let firstTop = null;
      let firstLine = '';
      let node = walker.nextNode();
      while (node !== null) {
        const text = node.nodeValue === null ? '' : node.nodeValue;
        for (let index = 0; index < text.length; index += 1) {
          characters += 1;
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
          ) {
            hidden += 1;
            continue;
          }
          if (
            cornerRect !== null &&
            box.right > cornerRect.left && box.left < cornerRect.right &&
            box.bottom > cornerRect.top && box.top < cornerRect.bottom
          ) {
            underPips += 1;
            continue;
          }
          drawn += text[index];
          if (firstTop === null) firstTop = r(box.top);
          if (Math.abs(r(box.top) - firstTop) < 0.6) firstLine += text[index];
        }
        node = walker.nextNode();
      }
      row.characters = characters;
      row.coveredByBadge = hidden;
      row.coveredByPips = underPips;
      // The clearance itself, so a reading says how much room is left rather
      // than only that there is some. Negative is the collision.
      row.pipClearancePx = cornerRect === null || !row.drawn ? null : r(rect.top - cornerRect.bottom);
      row.drawnCharacters = drawn.length;
      row.drawnText = drawn.slice(0, 120);
      row.firstLine = firstLine;
      row.firstLineCharacters = firstLine.length;
      if (title !== null && row.drawn) {
        const titleWalker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
        const titleRange = document.createRange();
        let titleCovered = 0;
        let titleNode = titleWalker.nextNode();
        while (titleNode !== null) {
          const text = titleNode.nodeValue === null ? '' : titleNode.nodeValue;
          for (let index = 0; index < text.length; index += 1) {
            titleRange.setStart(titleNode, index);
            titleRange.setEnd(titleNode, index + 1);
            const box = titleRange.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;
            if (
              box.right > rect.left && box.left < rect.right &&
              box.bottom > rect.top && box.top < rect.bottom
            ) titleCovered += 1;
          }
          titleNode = titleWalker.nextNode();
        }
        row.titleCovered = titleCovered;
        row.titleOverlapPx = r(Math.max(0, title.getBoundingClientRect().bottom - rect.top));
      }
      if (artRect !== null && row.drawn) {
        const top = Math.max(rect.top, artRect.top);
        const bottom = Math.min(rect.bottom, artRect.bottom);
        const covered = Math.max(0, bottom - top);
        row.occludedPx = r(covered);
        row.occludedShare = artRect.height > 0 ? r(covered / artRect.height) : 0;
      } else {
        row.occludedPx = 0;
        row.occludedShare = 0;
      }
    }
    rows.push(row);
  }
  return { rows };
})()`;

const cards = subjects(flagship());
if (cards.length === 0) throw new Error('the flagship fixture holds no creature to measure');
mkdirSync(out, { recursive: true });
const file = join(out, 'board-panel.html');
writeFileSync(file, pageHtml(cards));

/**
 * A 4x raster of the narrowest row, so the reading can be looked at as well as
 * counted.
 *
 * The device scale factor rather than a zoom, because zoom changes the layout
 * being measured and a scale factor changes only how many device pixels each
 * CSS pixel is drawn with -- which is the difference between looking at this
 * panel and looking at a different one.
 */
async function capture(client: CdpClient, image: string, target: string): Promise<void> {
  const created = await client.call('Target.createTarget', { url: 'about:blank' });
  const targetId = String(created['targetId']);
  let sessionId: string | null = null;
  try {
    const attached = await client.call('Target.attachToTarget', { targetId, flatten: true });
    sessionId = String(attached['sessionId']);
    await client.call('Page.enable', {}, sessionId);
    await client.call(
      'Emulation.setDeviceMetricsOverride',
      { width: 1400, height: 1400, deviceScaleFactor: 4, mobile: false },
      sessionId,
    );
    await client.call('Page.navigate', { url: pathToFileURL(target).href }, sessionId);
    await client.call(
      'Runtime.evaluate',
      {
        expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
        awaitPromise: true,
      },
      sessionId,
      30_000,
    );
    const clip = await client.call(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const row = document.querySelector('.board-panel-row');
          const box = row.getBoundingClientRect();
          return JSON.stringify({ x: 0, y: box.top, width: 700, height: box.height });
        })()`,
        returnByValue: true,
      },
      sessionId,
      30_000,
    );
    const result = clip['result'] as { readonly value?: unknown } | undefined;
    const box = JSON.parse(String(result?.value)) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const frame = await client.call(
      'Page.captureScreenshot',
      { format: 'png', clip: { ...box, scale: 1 } },
      sessionId,
      30_000,
    );
    writeFileSync(image, Buffer.from(String(frame['data']), 'base64'));
  } finally {
    await cleanupTarget(client, targetId, sessionId).catch(() => undefined);
  }
}

const profile = mkdtempSync(join(tmpdir(), 'mtg-board-panel-'));
const { child, client } = await launchChrome(profile);
try {
  const reading = await measurePage(client, file, 1400, 1400, MEASURE, 'board panel', '.mtg-card');
  writeFileSync(join(out, 'board-panel.json'), `${JSON.stringify(reading, null, 2)}\n`);
  await capture(client, join(out, 'board-panel.png'), file);
  console.log(`wrote ${join(out, 'board-panel.json')} and ${join(out, 'board-panel.png')}`);
} finally {
  await shutdownChrome({ child, client });
  rmSync(profile, { recursive: true, force: true });
}
