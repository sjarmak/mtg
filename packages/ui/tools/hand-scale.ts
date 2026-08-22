/**
 * The hand beside the battlefield, as static HTML a browser can measure: how
 * much bigger is a card you are deciding from than a card you are only scanning,
 * and can you read its rules text without hovering it?
 *
 * `tools/card-uniformity.ts` is the rig this copies, and it answers the question
 * one zone at a time: it walks `[data-slot='play']` only, so the hand — which is
 * the zone `mtg-rgc.5` is about — is not in its report at all. This one measures
 * both zones on one page and reports the *ratio*, because "the hand is the
 * largest thing on screen" is a claim about two rows and not about either one.
 *
 * Magic Online is the reference, and the reference is measured rather than
 * remembered. In `references/maxresdefault-80883895.jpg` (a 1280x720 client) a
 * battlefield card is about 77 x 92 and a hand card about 105 x 145, so the hand
 * is 1.36x the board on the width axis; in `references/068-1083771671.png` (1900
 * wide) a hand card is 178 x 252, a quarter of the window's height. The reason
 * is stated in `mtg-rgc.5` and worth restating wherever the numbers are read:
 * the battlefield is a summary you scan, the hand is the thing you are deciding
 * from, so it gets the pixels.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/hand-scale.ts out/hand-scale \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `hand-<n>.html` at each viewport and call
 * `window.mtgHandScale()`.
 *
 * What it answers: per zone, the face box, how many distinct face heights the
 * row drew and how far apart they are, how many names were cut sideways or
 * below, the rules box's rendered text size and the character column that size
 * yields at that box's width, and the count of faces drawing the playable ring.
 * The ratio block is the hand's face box over the viewer's battlefield face box.
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
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many permanents a side each page draws, and how many cards the hand holds.
 *
 * The counts are `card-uniformity.ts`'s, so the two rigs' numbers can be read
 * beside each other: four is what a played game reaches, eight is a long game,
 * twelve is past either and is where `mtg-0sq` lives. The hand is seven because
 * seven is an opening hand and because a hand only ever gets smaller from there
 * — a rig that measured five would report the roomiest case as the ordinary one.
 */
export const HAND_SCALE_COUNTS: readonly number[] = [4, 8, 12];
export const HAND_SIZE = 7;

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'hand-scale');
const setPath = process.argv[3];

/** The cards the page is dealt from; a set that fails to parse stops the run. */
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

const CARDS = cards();

/** Permanents, longest name first, for `card-uniformity.ts`'s stated reason. */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => !isLand(card) && card.kind !== 'instant' && card.kind !== 'sorcery');
  if (listed.length === 0)
    throw new Error(`${setPath ?? 'the example set'} has no permanents to stand on a board`);
  return [...listed].sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id));
}

const PERMANENTS = permanents();

/**
 * The hand, longest *rules text* first.
 *
 * A different sort from the battlefield's, and deliberately: the board rig is
 * about names, and this one is about whether a card in hand can be read. The
 * wordiest cards in the set are where that question has an answer, so they are
 * the ones dealt.
 */
/**
 * How far down that sort the dealt hand starts. Zero, the wordiest seven, is the
 * worst case and is what this rig was built to report.
 *
 * It is a knob because the worst case is not the whole answer to a *budget*
 * question. `../src/styles/board/hand.ts` states how many line boxes a held card
 * draws, and the claim that carries it is that a budget is a maximum rather than
 * a reservation: a card whose text fits draws what it has and the picture keeps
 * the rest. The wordiest seven cannot show that, because every one of them
 * overruns every budget on offer. Deal from the middle of the sort instead and it
 * is read straight off the page — `HAND_SCALE_OFFSET=180` on the flagship set is
 * where that file's median-hand numbers were taken.
 */
const HAND_OFFSET = Number(process.env['HAND_SCALE_OFFSET'] ?? '0');

function handCards(): readonly DslCard[] {
  const listed = [...CARDS].sort(
    (a, b) => renderOracleText(b).length - renderOracleText(a).length || a.id.localeCompare(b.id),
  );
  return listed.slice(HAND_OFFSET, HAND_OFFSET + HAND_SIZE);
}

/** The mana base: the set's own basics, which are minted rather than printed. */
function manaBase(count: number): readonly DslCard[] {
  const basics = setBasics(CARDS);
  return Array.from({ length: count }, (_unused, index) => {
    const land = basics[index % basics.length];
    if (land === undefined) throw new Error('setBasics returned nothing to build a mana base from');
    return land;
  });
}

/** A position with `count` distinct permanents a side and a seven-card hand. */
function dealtSession(count: number): GameSession {
  const dealt = Array.from({ length: count }, (_unused, index) => {
    const card = PERMANENTS[index % PERMANENTS.length];
    if (card === undefined) throw new Error('no permanent to deal');
    return card;
  });
  const spells = [0, 1].flatMap((controller) =>
    dealt.map((card) => ({ card, controller: controller as PlayerId, summoningSick: false })),
  );
  const lands = [0, 1].flatMap((controller) =>
    manaBase(7).map((card, index) => ({
      card,
      controller: controller as PlayerId,
      summoningSick: false,
      tapped: index % 2 === 1,
    })),
  );
  const hand = handCards();
  const built = scenario({
    seed: `tools/hand-scale/${String(count)}`,
    battlefield: [...spells, ...lands],
    hands: [hand, hand],
    active: 0,
    turn: 4,
  });
  const state: GameState = built.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: built.events,
    result: null,
    beat: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    committed: null,
  };
}

/**
 * What a browser reads off the page.
 *
 * The character column is measured rather than assumed. `anatomy.ts` carries
 * three columns read this way and each one is a box width over a font's advance;
 * here the advance is taken from the browser itself, by setting a canvas to the
 * rules box's own resolved font and measuring a pangram-ish sample of the card
 * serif. That makes the number comparable with `RULES_BOX_COLUMN`'s 34 without
 * restating any of its arithmetic.
 *
 * Legibility is reported as the resolved pixel size and the column, and not as a
 * verdict, because the threshold is a judgment: the published floors quoted in
 * `../src/styles/card.ts` (WCAG 18.5px, the Xbox guidelines' 18px at 1080p) are
 * above what any client's board thumbnail draws, so a boolean here would fail
 * every surface in every client and say nothing.
 */
const MEASURE = `
window.mtgHandScale = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var canvas = document.createElement('canvas');
  var pen = canvas.getContext('2d');
  var SAMPLE = 'When this creature enters, draw a card and gain two life.';
  var advance = function (style) {
    pen.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    return pen.measureText(SAMPLE).width / SAMPLE.length;
  };
  var read = function (slot) {
    var card = slot.querySelector('.mtg-card');
    if (card === null) return null;
    var faceBox = card.getBoundingClientRect();
    if (faceBox.height === 0) return null;
    var name = card.querySelector('.mtg-card__name');
    var type = card.querySelector('.mtg-card__type');
    var rules = card.querySelector('.mtg-card__text');
    var art = card.querySelector('.mtg-art');
    var side = slot.closest('.mtg-board__side');
    var rulesStyle = rules === null ? null : getComputedStyle(rules);
    var rulesAdvance = rulesStyle === null ? null : advance(rulesStyle);
    var rulesShown = rulesStyle !== null && rulesStyle.display !== 'none';
    var rulesWidth = !rulesShown ? null : rules.clientWidth - parseFloat(rulesStyle.paddingLeft) - parseFloat(rulesStyle.paddingRight);
    return {
      seat: side === null ? 'unknown' : side.getAttribute('data-seat'),
      zone: slot.getAttribute('data-slot'),
      id: card.getAttribute('data-card-id'),
      chars: name === null ? null : name.textContent.length,
      faceW: round(faceBox.width),
      faceH: round(faceBox.height),
      slotH: round(slot.getBoundingClientRect().height),
      trim: Math.round((faceBox.width / faceBox.height) * 1000) / 1000,
      artH: art === null ? null : round(art.getBoundingClientRect().height),
      interactive: card.getAttribute('data-interactive') === 'true',
      nameStep: name === null ? null : name.getAttribute('data-fit'),
      nameFontPx: name === null ? null : round(parseFloat(getComputedStyle(name).fontSize)),
      nameLines: name === null ? null : Math.round(name.scrollHeight / parseFloat(getComputedStyle(name).lineHeight) * 10) / 10,
      nameCutSideways: name === null ? false : name.scrollWidth > name.clientWidth + 0.5,
      nameCutBelow: name === null ? false : name.scrollHeight > name.clientHeight + 0.5,
      typeCutSideways: type === null ? false : type.scrollWidth > type.clientWidth + 0.5,
      typeCutBelow: type === null ? false : type.scrollHeight > type.clientHeight + 0.5,
      rulesShown: rulesShown,
      rulesFontPx: !rulesShown ? null : round(parseFloat(rulesStyle.fontSize)),
      rulesBoxW: rulesWidth === null ? null : round(rulesWidth),
      rulesColumn: rulesWidth === null || rulesAdvance === null || rulesAdvance === 0 ? null : Math.floor(rulesWidth / rulesAdvance),
      rulesLines: !rulesShown ? null : Math.round(rules.scrollHeight / parseFloat(rulesStyle.lineHeight) * 10) / 10,
      rulesCutBelow: !rulesShown ? false : rules.scrollHeight > rules.clientHeight + 0.5
    };
  };
  var faces = [];
  var slots = document.querySelectorAll('.mtg-slot[data-slot]');
  for (var i = 0; i < slots.length; i += 1) {
    var slot = slots[i];
    if (slot.parentElement !== null && slot.parentElement.classList.contains('mtg-lands')) continue;
    var face = read(slot);
    if (face !== null) faces.push(face);
  }
  var summarize = function (row) {
    var heights = {};
    for (var j = 0; j < row.length; j += 1) heights[row[j].faceH] = 1;
    var tall = Object.keys(heights).map(Number);
    var pick = function (key) { return row.length === 0 ? null : row[0][key]; };
    return {
      faces: row.length,
      heights: tall.length,
      tallest: tall.length === 0 ? null : Math.max.apply(null, tall),
      shortest: tall.length === 0 ? null : Math.min.apply(null, tall),
      spread: tall.length === 0 ? null : round(Math.max.apply(null, tall) - Math.min.apply(null, tall)),
      faceW: pick('faceW'),
      faceH: pick('faceH'),
      trims: Object.keys(row.reduce(function (seen, face) { seen[face.trim] = 1; return seen; }, {})),
      rulesFontPx: pick('rulesFontPx'),
      rulesColumn: pick('rulesColumn'),
      rulesDrawn: row.filter(function (face) { return face.rulesShown; }).length,
      rulesCut: row.filter(function (face) { return face.rulesCutBelow; }).length,
      rulesLines: pick('rulesLines'),
      interactive: row.filter(function (face) { return face.interactive; }).length,
      namesCutSideways: row.filter(function (face) { return face.nameCutSideways; }).length,
      namesCutBelow: row.filter(function (face) { return face.nameCutBelow; }).length,
      typesCut: row.filter(function (face) { return face.typeCutSideways || face.typeCutBelow; }).length,
      cutNames: row.filter(function (face) { return face.nameCutSideways || face.nameCutBelow; })
        .map(function (face) { return face.id + ' (' + face.chars + ' chars, ' + face.nameLines + ' lines)'; })
    };
  };
  var group = function (test) { return summarize(faces.filter(test)); };
  var hand = group(function (face) { return face.zone === 'hand'; });
  var yours = group(function (face) { return face.zone === 'play' && face.seat === 'you'; });
  var theirs = group(function (face) { return face.zone === 'play' && face.seat === 'opponent'; });
  var ratio = function (a, b) { return a === null || b === null || b === 0 ? null : Math.round((a / b) * 100) / 100; };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hand: hand,
    you: yours,
    opponent: theirs,
    ratio: { width: ratio(hand.faceW, yours.faceW), height: ratio(hand.faceH, yours.faceH) },
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    all: faces
  };
};
`;

function page(count: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: dealtSession(count),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const title = `Hand scale, ${String(count)} permanents a side`;
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
for (const count of HAND_SCALE_COUNTS) {
  const file = join(out, `hand-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
