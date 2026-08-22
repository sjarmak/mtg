/**
 * A played table dealt from a real set's own cards, as static HTML a browser can
 * measure: are all the faces in a row the same height, and does every name fit
 * the bar it is printed in?
 *
 * `tools/board-crowding.ts` is the same arrangement and answers a different
 * question. That page repeats **one** creature so nothing in the row varies but
 * the count, which is exactly what a uniformity check must not do: a row of one
 * card is uniform by construction. This one deals *distinct* cards, longest name
 * first, so the row holds the widest spread of name lengths the set contains and
 * a face that grows to fit its own words shows up as a taller neighbor.
 *
 * The playtester, 2026-08-13: "some of the cards end up taller than the others but I
 * want them uniform, and need to make sure that titles fit on the card and dont
 * wrap over extra letters". Both halves are geometry, and jsdom lays nothing
 * out — `getBoundingClientRect` is all zeros there — so neither half can be
 * asserted in vitest. This is where they are asserted instead.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/card-uniformity.ts out/card-uniformity \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `uniformity-<n>.html` at each viewport and call
 * `window.mtgCardUniformity()`.
 *
 * What it answers, per battlefield slot: the face's box, the slot's box, the
 * name bar's box, and whether the name overflows that bar in either direction —
 * sideways, which is a name cut mid-word, or downwards, which is a name whose
 * later lines were clipped away. Summarized per seat and again over the whole
 * mat: how many distinct face heights there were, how far apart the tallest and
 * the shortest are, which trims were drawn, and every name that was cut. The
 * acceptance evidence is `seats.<seat>.heights: 1`, `spread: 0` and
 * `cutNames: []`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many permanents a side each page draws.
 *
 * Four is the count `tools/board-text.ts` measured a real game reaching, and it
 * is the width at which a board face is largest and a long name has the best
 * chance of fitting. Eight is a long game. Twelve is past what a played game
 * reaches and is here because the face is narrowest there, so it is where a name
 * that has to shrink shrinks furthest.
 */
export const UNIFORMITY_COUNTS: readonly number[] = [4, 8, 12];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'card-uniformity');
const setPath = process.argv[3];

/**
 * The cards the page is dealt from: a named set when one is given, the DSL
 * example set otherwise. A set that fails to parse stops the run rather than
 * falling back, because the fallback has no long names in it and a silent one
 * would report a clean board that nobody's set produced.
 */
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

/**
 * The permanents a page deals, longest name first.
 *
 * Only permanents, because an instant never stands on a battlefield. Sorted by
 * name length with the id as the tie-break, so the deal is a function of the set
 * rather than of the order its document happens to list cards in, and so the
 * longest name in the set is always on the board however few slots a page has.
 */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => !isLand(card) && card.kind !== 'instant' && card.kind !== 'sorcery');
  if (listed.length === 0)
    throw new Error(`${setPath ?? 'the example set'} has no permanents to stand on a board`);
  return [...listed].sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id));
}

const PERMANENTS = permanents();

/** The mana base: the set's own basics, which are minted rather than printed. */
function manaBase(count: number): readonly DslCard[] {
  const basics = setBasics(CARDS);
  return Array.from({ length: count }, (_unused, index) => {
    const land = basics[index % basics.length];
    if (land === undefined) throw new Error('setBasics returned nothing to build a mana base from');
    return land;
  });
}

/**
 * A position with `count` distinct permanents a side and a seven-land mana base
 * under each seat.
 *
 * The two seats are dealt the *same* list rather than halves of one, so a name
 * that misbehaves is visible on both sides of the mat and a page with four slots
 * still carries the four longest names in the set.
 */
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
  const built = scenario({
    seed: `tools/card-uniformity/${String(count)}`,
    battlefield: [...spells, ...lands],
    hands: [dealt.slice(0, 5), dealt.slice(0, 5)],
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
 * A name that does not fit is asked of the element rather than inferred from a
 * font size, for `face-census.ts`'s reason: a step published in the markup and a
 * box resolved by the sheet are two different facts, and only the browser holds
 * the second. `scrollWidth > clientWidth` is a name cut mid-word — the ellipsis
 * case — and `scrollHeight > clientHeight` is a name whose second or third line
 * was clipped away. Both are failures of "titles fit on the card".
 *
 * **Uniformity is asked of a seat's own row rather than of the whole mat**, and
 * that is a real distinction rather than a softening. The two seats' rows are
 * fitted independently and come out at different widths — measured at 1600x1000
 * with eight permanents a side, the opponent draws 129.4px faces and the viewer
 * 137px — so a mat-wide count of distinct heights reports that difference and
 * says nothing about the question. Nobody sees the two rows side by side; what a
 * player sees is one row, and a row is where "some are taller than the others"
 * is either true or false. The mat-wide numbers are reported too, under `mat`,
 * so the seat difference stays visible rather than being defined away.
 *
 * Heights are rounded to a tenth before they are counted distinct, so a
 * sub-pixel difference between two faces is not reported as two heights. A
 * genuine difference here is tens of pixels, not tenths.
 */
const MEASURE = `
window.mtgCardUniformity = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var faces = [];
  var slots = document.querySelectorAll(".mtg-slot[data-slot='play']");
  for (var i = 0; i < slots.length; i += 1) {
    var slot = slots[i];
    if (slot.parentElement !== null && slot.parentElement.classList.contains('mtg-lands')) continue;
    var card = slot.querySelector('.mtg-card');
    if (card === null) continue;
    var faceBox = card.getBoundingClientRect();
    if (faceBox.height === 0) continue;
    var name = card.querySelector('.mtg-card__name');
    var type = card.querySelector('.mtg-card__type');
    var art = card.querySelector('.mtg-art');
    var slotBox = slot.getBoundingClientRect();
    var nameBox = name === null ? null : name.getBoundingClientRect();
    var side = slot.closest('.mtg-board__side');
    faces.push({
      seat: side === null ? 'unknown' : side.getAttribute('data-seat'),
      id: card.getAttribute('data-card-id'),
      chars: name === null ? null : name.textContent.length,
      faceW: round(faceBox.width),
      faceH: round(faceBox.height),
      slotH: round(slotBox.height),
      trim: Math.round((faceBox.width / faceBox.height) * 1000) / 1000,
      artH: art === null ? null : round(art.getBoundingClientRect().height),
      nameStep: name === null ? null : name.getAttribute('data-fit'),
      nameFontPx: name === null ? null : round(parseFloat(getComputedStyle(name).fontSize)),
      nameH: nameBox === null ? null : round(nameBox.height),
      nameLines: name === null ? null : Math.round(name.scrollHeight / parseFloat(getComputedStyle(name).lineHeight) * 10) / 10,
      nameCutSideways: name === null ? false : name.scrollWidth > name.clientWidth + 0.5,
      nameCutBelow: name === null ? false : name.scrollHeight > name.clientHeight + 0.5,
      typeStep: type === null ? null : type.getAttribute('data-fit'),
      typeCutSideways: type === null ? false : type.scrollWidth > type.clientWidth + 0.5,
      typeCutBelow: type === null ? false : type.scrollHeight > type.clientHeight + 0.5
    });
  }
  var summarize = function (row) {
    var heights = {};
    for (var j = 0; j < row.length; j += 1) heights[row[j].faceH] = 1;
    var tall = Object.keys(heights).map(Number);
    return {
      faces: row.length,
      heights: tall.length,
      tallest: tall.length === 0 ? null : Math.max.apply(null, tall),
      shortest: tall.length === 0 ? null : Math.min.apply(null, tall),
      spread: tall.length === 0 ? null : round(Math.max.apply(null, tall) - Math.min.apply(null, tall)),
      trims: Object.keys(row.reduce(function (seen, face) { seen[face.trim] = 1; return seen; }, {})),
      namesCutSideways: row.filter(function (face) { return face.nameCutSideways; }).length,
      namesCutBelow: row.filter(function (face) { return face.nameCutBelow; }).length,
      typesCut: row.filter(function (face) { return face.typeCutSideways || face.typeCutBelow; }).length,
      cutNames: row.filter(function (face) { return face.nameCutSideways || face.nameCutBelow; })
        .map(function (face) { return face.id + ' (' + face.chars + ' chars, ' + face.nameLines + ' lines)'; })
    };
  };
  var seats = {};
  for (var k = 0; k < faces.length; k += 1) {
    if (seats[faces[k].seat] === undefined) seats[faces[k].seat] = [];
    seats[faces[k].seat].push(faces[k]);
  }
  var perSeat = {};
  for (var seat in seats) if (Object.prototype.hasOwnProperty.call(seats, seat)) perSeat[seat] = summarize(seats[seat]);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    seats: perSeat,
    mat: summarize(faces),
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
  const title = `Card uniformity, ${String(count)} permanents a side`;
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
for (const count of UNIFORMITY_COUNTS) {
  const file = join(out, `uniformity-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
