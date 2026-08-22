/**
 * A mid-game table, as static HTML a browser can measure the rules text on.
 *
 * `mtg-u69` is a defect no vitest test in this checkout can see, and for the
 * reason `board-crowding.ts` records: jsdom performs no layout, so a test there
 * can say the markup carries a rules box and cannot say whether one pixel of it
 * was ever drawn. The bead was filed off exactly that gap — the box was in the
 * face's `title` attribute and nowhere on the screen — so the fix has to be
 * measured the way the defect was found.
 *
 * What this page is for that `board-crowding.ts` is not: crowding measures the
 * art window against the face, over a *built* position at counts a game does not
 * reach. This measures the words, over a position a game does reach, in the two
 * places a player reads them — a hand you are choosing a play out of and a
 * battlefield you are choosing a block on. Both wear the same face
 * (`../src/board/CardSlot.ts`) and neither is the other's proxy: a hand slot is
 * a rail of seven and a battlefield slot is a row that shrinks to fit, so the
 * same face is drawn at two different widths on one screen.
 *
 * Node-only, like everything else under `tools/`: it writes a file and opens no
 * browser.
 *
 *     npx tsx packages/ui/tools/board-text.ts out/board-text
 *     npx tsx packages/ui/tools/board-text.ts out/board-text \
 *       out/art/flagship-set/set.json out/art/flagship-set/art.json
 *
 * then navigate to `board-text-<spells>.html` and call `window.mtgBoardText()`.
 * The set and the manifest are optional and both are build output, so the
 * default is the DSL example set; a real set is what makes the character counts
 * mean anything, because the column a box holds is a fact about the words a set
 * actually prints.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, isLand, parseCards, renderOracleText, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many non-land permanents a side, one page each.
 *
 * Three counts rather than one, because the face's width is what decides
 * whether its words fit and the row is what decides its width. Four is the
 * ordinary mid-game board the bead was filed against, six is a developed one,
 * and nine is past anything a driven game in this checkout reached — the widest
 * board `board-crowding.ts` measured a played game at was seven a side. If the
 * text still reads at nine it reads everywhere a game goes.
 */
export const TEXT_COUNTS: readonly number[] = [4, 6, 9];

/** The mana base under the row, at the middle of the realistic five-to-nine. */
const LAND_COUNT = 7;

/** A full grip, which is the width a hand slot is drawn at when it matters most. */
const HAND_SIZE = 7;

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'board-text');
const setPath = process.argv[3];
const artPath = process.argv[4];

/** The cards the page is drawn from; a set that fails to parse stops the run. */
function cards(): readonly DslCard[] {
  if (setPath === undefined) return EXAMPLE_SET;
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) {
    throw new Error(`${setPath} has no "cards" array, so it is not a set document`);
  }
  return parseCards(listed);
}

/** The manifest's resolver, rebased on the page's own directory, or null. */
function artFor(): ArtResolver | null {
  if (artPath === undefined) return null;
  const read = readArtManifest(JSON.parse(readFileSync(artPath, 'utf8')), artPath);
  if (!read.ok) throw new Error(read.message);
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
}

const CARDS = cards();
const ART = artFor();

/**
 * The lands the mana base is drawn from: the set's own, and the five basics it
 * is played with when it prints none of them.
 *
 * `setBasics` rather than a filter, for the reason the art pipeline's governance check learned
 * the hard way (CLAUDE.md): a flagship set's card list contains no Swamp, and
 * `@mtg/deckbuild` mints one at build time under an id the list never mentions.
 * A page drawn from the filter alone has no mana base at all, and the land tile
 * is half of what `mtg-9k0` is about.
 */
const LANDS: readonly DslCard[] = (() => {
  const printed = CARDS.filter((card) => isLand(card));
  return printed.length > 0 ? printed : setBasics(CARDS);
})();

/**
 * The wordiest cards in the set, longest first.
 *
 * The page is drawn from these rather than from the set's own order, because a
 * measurement of whether text fits is only worth taking against the text least
 * likely to. A row of vanilla creatures reports that everything fits and says
 * nothing.
 */
const TALKATIVE: readonly DslCard[] = [...CARDS.filter((card) => !isLand(card))].sort(
  (left, right) => renderOracleText(right).length - renderOracleText(left).length,
);

function talkative(index: number): DslCard {
  const card = TALKATIVE[index % TALKATIVE.length];
  if (card === undefined) throw new Error('the set has no non-land cards to draw a board from');
  return card;
}

/** The mana base, cycling the set's lands so the band is not one picture repeated. */
function manaBase(): readonly DslCard[] {
  if (LANDS.length === 0) throw new Error('the set has no lands');
  return Array.from({ length: LAND_COUNT }, (_unused, index) => {
    const card = LANDS[index % LANDS.length];
    if (card === undefined) throw new Error('the set has no lands');
    return card;
  });
}

/**
 * A position with `count` distinct non-land permanents a side, a mana base under
 * each, and a full grip in the viewer's hand.
 *
 * Distinct rather than one card repeated, which is the opposite of what
 * `board-crowding.ts` wants: crowding holds the card fixed so the count is the
 * only variable, and this holds the count fixed so the *text* is the variable.
 * Every face on the page prints a different oracle text and the shortest one
 * measured is the fit the worst card gets.
 */
function textSession(count: number): GameSession {
  const spells = Array.from({ length: count * 2 }, (_unused, index) => ({
    card: talkative(index),
    controller: (index % 2) as PlayerId,
    summoningSick: false,
    // Every third permanent tapped, so the page carries the case `mtg-yi5`
    // owns without being about it: a rotated face is a face whose text is drawn
    // under a scale, and the measure below reports it separately rather than
    // averaging it into the upright ones.
    tapped: index % 3 === 2,
  }));
  const lands = [0, 1].flatMap((controller) =>
    manaBase().map((land, index) => ({
      card: land,
      controller: controller as PlayerId,
      summoningSick: false,
      tapped: index % 2 === 1,
    })),
  );
  const built = scenario({
    seed: `tools/board-text/${String(count)}`,
    battlefield: [...spells, ...lands],
    hands: [
      Array.from({ length: HAND_SIZE }, (_unused, index) => talkative(index + count * 2)),
      Array.from({ length: HAND_SIZE }, (_unused, index) => talkative(index)),
    ],
    active: 0,
    turn: 6,
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

/**
 * What a browser reads off the page, per card face that carries words.
 *
 * The three claims the bead turns on, and how each is read:
 *
 *  - **Is there a rules box at all.** `region` is `absent` when the face laid
 *    out no rules region and the computed `display` when it laid one out, so a
 *    box present in the markup and hidden by a container query is distinguished
 *    from a box that was never emitted. The bead's own measurement was `0x0`,
 *    which either can produce.
 *  - **How big the words are.** The computed `font-size` in px, which is the
 *    only number that answers "can you read it" and the one jsdom cannot give.
 *  - **How much of them you get.** `wrapped` is each printed line's own height
 *    over the line box, so a paragraph that took three lines is three; `clipped`
 *    is the box's scroll height against its client height, which is what
 *    `overflow-y: clip` turns a card past the ladder's floor into.
 *
 * `column` is the character count divided by the lines it wrapped onto, per
 * printed line, and is reported as the *minimum* over the page: the narrowest
 * column any face got is what the next card has to fit into. It is measured
 * rather than assumed, because `RULES_BOX_COLUMN` in `../src/card/anatomy.ts` is
 * the full face's column and a board face is a different width in a different
 * size of type.
 */
const MEASURE = `
window.mtgBoardText = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var read = function (slot) {
    var card = slot.querySelector('.mtg-card');
    if (card === null) return null;
    var faceBox = card.getBoundingClientRect();
    if (faceBox.height === 0) return null;
    var text = card.querySelector("[data-region='rules']");
    var style = text === null ? null : getComputedStyle(text);
    var lineHeight = style === null ? 0 : parseFloat(style.lineHeight);
    var lines = text === null ? [] : [].slice.call(text.querySelectorAll('.mtg-card__line'));
    var keywords = text === null ? null : text.querySelector('.mtg-card__keywords');
    var wrapped = lines.map(function (line) {
      var box = line.getBoundingClientRect();
      return lineHeight > 0 ? Math.max(1, Math.round(box.height / lineHeight)) : 0;
    });
    var chars = lines.map(function (line) { return (line.textContent || '').length; });
    var columns = [];
    for (var i = 0; i < lines.length; i += 1) {
      if (wrapped[i] > 0 && chars[i] > 0) columns.push(chars[i] / wrapped[i]);
    }
    var textBox = text === null ? null : text.getBoundingClientRect();
    var art = card.querySelector('.mtg-art');
    var artBox = art === null ? null : art.getBoundingClientRect();
    var type = card.querySelector('.mtg-card__type');
    var name = card.querySelector('.mtg-card__name');
    var cut = function (node) {
      // The bead's own measure: a line is truncated when it wants more width
      // than its box gives it. scrollWidth is the whole line, clientWidth the
      // part drawn.
      if (node === null) return null;
      return Math.max(0, Math.round(node.scrollWidth - node.clientWidth));
    };
    return {
      name: (name || { textContent: null }).textContent,
      size: card.getAttribute('data-size'),
      tapped: slot.getAttribute('data-tapped') === 'true',
      faceW: round(faceBox.width),
      faceH: round(faceBox.height),
      artH: artBox === null ? null : round(artBox.height),
      artShare: artBox === null ? null : Math.round((artBox.height / faceBox.height) * 1000) / 10,
      typeLine: type === null ? null : (type.textContent || ''),
      typeShown: type === null ? 'absent' : getComputedStyle(type).display,
      typeCutPx: cut(type),
      nameCutPx: cut(name),
      region: text === null ? 'absent' : style.display,
      fit: text === null ? null : text.getAttribute('data-fit'),
      fontPx: text === null ? null : round(parseFloat(style.fontSize)),
      linePx: text === null ? null : round(lineHeight),
      boxW: textBox === null ? null : round(textBox.width),
      boxH: textBox === null ? null : round(textBox.height),
      paragraphs: lines.length,
      wrappedLines: wrapped.reduce(function (sum, count) { return sum + count; }, 0),
      chars: chars.reduce(function (sum, count) { return sum + count; }, 0),
      column: columns.length === 0 ? null : round(Math.min.apply(null, columns)),
      clipped: text === null ? null : text.scrollHeight > text.clientHeight + 1,
      keywords: keywords === null ? null : (keywords.textContent || ''),
      keywordsPx:
        keywords === null ? null : round(keywords.getBoundingClientRect().height),
    };
  };
  var gather = function (selector) {
    var rows = [];
    var slots = document.querySelectorAll(selector);
    for (var i = 0; i < slots.length; i += 1) {
      var row = read(slots[i]);
      if (row !== null) rows.push(row);
    }
    return rows;
  };
  var summarize = function (rows) {
    var withText = rows.filter(function (row) { return row.region !== 'absent' && row.region !== 'none'; });
    var fonts = withText.map(function (row) { return row.fontPx; });
    var columns = withText.map(function (row) { return row.column; }).filter(function (value) { return value !== null; });
    var typed = rows.filter(function (row) { return row.typeShown !== 'absent' && row.typeShown !== 'none'; });
    var arts = rows.map(function (row) { return row.artH; }).filter(function (value) { return value !== null; });
    return {
      faces: rows.length,
      withText: withText.length,
      clipped: withText.filter(function (row) { return row.clipped; }).length,
      minFontPx: fonts.length === 0 ? null : Math.min.apply(null, fonts),
      maxFontPx: fonts.length === 0 ? null : Math.max.apply(null, fonts),
      minColumn: columns.length === 0 ? null : Math.min.apply(null, columns),
      maxColumn: columns.length === 0 ? null : Math.max.apply(null, columns),
      minArtH: arts.length === 0 ? null : Math.min.apply(null, arts),
      typeLines: typed.length,
      typeCut: typed.filter(function (row) { return row.typeCutPx > 0; }).length,
      nameCut: rows.filter(function (row) { return row.nameCutPx > 0; }).length,
      sample: rows[0] || null
    };
  };
  var play = gather("[data-mtg-mode='play'] .mtg-board__spells .mtg-slot[data-slot='play']");
  var hand = gather("[data-mtg-mode='play'] .mtg-board__side[data-seat='you'] .mtg-slot[data-slot='hand']");
  var zoomFace = document.querySelector('.mtg-zoom > .mtg-card');
  var zoomText = zoomFace === null ? null : zoomFace.querySelector("[data-region='rules']");
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    play: summarize(play),
    hand: summarize(hand),
    upright: summarize(play.filter(function (row) { return !row.tapped; })),
    rotated: summarize(play.filter(function (row) { return row.tapped; })),
    zoom: zoomText === null ? null : {
      // display:none, so the box is zero until a pointer is over the slot; the
      // font size resolves regardless and is the number the zoom is judged on.
      fontPx: round(parseFloat(getComputedStyle(zoomText).fontSize)),
      faceW: round(parseFloat(getComputedStyle(zoomFace).width))
    },
    playFaces: play,
    handFaces: hand
  };
};
`;

function page(count: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: textSession(count),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
        ...(ART === null ? {} : { artFor: ART }),
      }),
    }),
  );
  const title = `Board text, ${String(count)} permanents a side`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of TEXT_COUNTS) {
  const file = join(out, `board-text-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
