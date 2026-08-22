/**
 * A played table whose permanents all wear corner marks, as static HTML a
 * browser can measure: does the marks row cover the card's name?
 *
 * `mtg-9edk`. `../src/styles/board/slot.ts` anchors `.mtg-slot__marks` to the
 * slot's own top-left corner, which was the top of the art window until
 * `ca9ce2b` put the title bar first. jsdom lays nothing out —
 * `getBoundingClientRect` is all zeros there — so no vitest test in this
 * checkout can say whether one box covers another. This writes the page the
 * question is answered on, and `window.mtgCornerMarks()` is the answer as
 * numbers.
 *
 * **Letters, not pixels, is the unit that matters**, so the measurement counts
 * them: a `Range` over the name's own text node gives one rect per character,
 * and a character whose rect intersects the marks row is a character the player
 * cannot read. `coveredText` is those characters as a string, so a report says
 * which letters went rather than how many.
 *
 * Two pages per crowding, because a tapped slot is a different geometry and has
 * its own rule in the sheet: the marks are anchored to the slot's other corner
 * there, and a quarter turn puts a different part of the card under them.
 *
 * The marks a page can deal are the ones a `scenario` can express — the
 * summoning-sick hourglass and the damage count — which is two badges of the
 * five that ride the row. Counters and the target reticle need object counters
 * and a stack that `scenario` does not build. That bounds the *width* of the row
 * and not its *origin*, and the origin is the defect: every mark is a flex item
 * of the one row, so a row that starts over the name starts there whether it
 * holds one badge or five, and a wider row covers more letters. `markWidths`
 * reports each badge, so the wider cases are arithmetic on a measured number
 * rather than a guess.
 *
 * The same arrangement as `card-uniformity.ts` and Node-only like it: it writes
 * files and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/corner-marks.ts out/corner-marks \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * then navigate a browser to `marks-<n>.html` or `marks-tapped-<n>.html` at each
 * viewport and call `window.mtgCornerMarks()`.
 *
 * The set is **required**, and that is deliberate: a rig on this project
 * defaulted its set argument and measured the DSL example set for a night while
 * reporting numbers about a flagship board. A page has to be able to name the
 * set it drew.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLand, parseCards, setBasics } from '@mtg/dsl';
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
 * is the width at which a board face is largest — so it is the crowding where
 * the name has the most room and a badge over it is least excusable. Eight is a
 * long game, and the face is narrower there, so the same badge takes a larger
 * share of the bar.
 */
export const MARK_COUNTS: readonly number[] = [4, 8];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'corner-marks');
const named = process.argv[3];
if (named === undefined) {
  throw new Error('name the set to deal from: corner-marks.ts <out-dir> <set.json>');
}
const setPath: string = named;

const CARDS = ((): readonly DslCard[] => {
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) {
    throw new Error(`${setPath} has no "cards" array, so it is not a set document`);
  }
  return parseCards(listed);
})();

/**
 * The permanents a page deals, longest name first.
 *
 * Only creatures, because the marks this rig deals are a creature's: summoning
 * sickness is asked of a creature object and damage is marked on one. Longest
 * name first for `card-uniformity.ts`'s reason — the deal is a function of the
 * set rather than of the order its document lists cards in, and the name most
 * at risk of being covered is on every board however few slots it has.
 */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => card.kind === 'creature' && !isLand(card));
  if (listed.length === 0) throw new Error(`${setPath} has no creatures to stand on a board`);
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
 * A position with `count` distinct creatures a side, every one of them
 * summoning sick and carrying a point of damage, over a seven-land mana base.
 *
 * Every permanent is marked rather than a sample of them, because the question
 * is asked of a *row*: one marked card in a row of four says whether that card's
 * name is covered and nothing about how the rest of the set's names fare.
 */
function dealtSession(count: number, tapped: boolean): GameSession {
  const dealt = Array.from({ length: count }, (_unused, index) => {
    const card = PERMANENTS[index % PERMANENTS.length];
    if (card === undefined) throw new Error('no permanent to deal');
    return card;
  });
  const spells = [0, 1].flatMap((controller) =>
    dealt.map((card) => ({
      card,
      controller: controller as PlayerId,
      summoningSick: true,
      damage: 1,
      tapped,
    })),
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
    seed: `tools/corner-marks/${String(count)}`,
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
 * The overlap is asked of the marks row against the *name*, not against the
 * title bar: a bar is a box with room in it and a name is the ink, and covering
 * the empty end of a bar costs a reader nothing. `covered` is therefore counted
 * by character rects, which is the only unit the complaint was written in — "a
 * card wearing the target reticle reads '(mark)ookout Landing Sentry'".
 *
 * A character rect is taken from a `Range` over the name's own text node.  A
 * wrapped name gives rects on several lines and the marks row can only reach the
 * first of them, which the count handles for free: a rect that does not
 * intersect is not counted whatever line it is on.
 *
 * **Only characters the name is actually drawing.** The board face caps the name
 * at `BOARD_NAME_LINES` with `overflow: clip` (`../src/styles/card.ts`), and a
 * `Range` reports a rect for the clipped-away lines too — so a badge sitting a
 * line below the bar was credited with covering letters that are painted
 * nowhere. Each character is intersected with the name's own box first, and the
 * count is what a player could have read.
 */
const MEASURE = `
window.mtgCornerMarks = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var overlap = function (a, b) {
    var x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return { x: round(Math.max(0, x)), y: round(Math.max(0, y)) };
  };
  var charRects = function (element) {
    var node = element.firstChild;
    if (node === null || node.nodeType !== 3) return [];
    var text = node.nodeValue;
    var rects = [];
    for (var i = 0; i < text.length; i += 1) {
      var range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      var box = range.getBoundingClientRect();
      rects.push({ ch: text.charAt(i), box: box });
    }
    return rects;
  };
  var faces = [];
  var slots = document.querySelectorAll(".mtg-slot[data-slot='play']");
  for (var s = 0; s < slots.length; s += 1) {
    var slot = slots[s];
    if (slot.parentElement !== null && slot.parentElement.classList.contains('mtg-lands')) continue;
    var card = slot.querySelector('.mtg-card');
    var marksRow = slot.querySelector('.mtg-slot__marks');
    if (card === null || marksRow === null) continue;
    var faceBox = card.getBoundingClientRect();
    if (faceBox.height === 0) continue;
    var name = card.querySelector('.mtg-card__name');
    if (name === null) continue;
    var nameBox = name.getBoundingClientRect();
    var rowBox = marksRow.getBoundingClientRect();
    var marks = marksRow.querySelectorAll('.mtg-mark');
    var drawn = [];
    for (var m = 0; m < marks.length; m += 1) {
      var markBox = marks[m].getBoundingClientRect();
      if (markBox.width === 0 && markBox.height === 0) continue;
      if (marks[m].getAttribute('data-silent') === 'true') continue;
      drawn.push({
        key: marks[m].getAttribute('data-mark'),
        w: round(markBox.width),
        h: round(markBox.height),
        overlapsName: overlap(markBox, nameBox).x > 0.5 && overlap(markBox, nameBox).y > 0.5
      });
    }
    var covered = [];
    var rects = charRects(name).filter(function (entry) {
      var inside = overlap(entry.box, nameBox);
      return inside.x > 0.5 && inside.y > 0.5;
    });
    for (var c = 0; c < rects.length; c += 1) {
      var hit = false;
      for (var d = 0; d < marks.length; d += 1) {
        if (marks[d].getAttribute('data-silent') === 'true') continue;
        var box = marks[d].getBoundingClientRect();
        if (box.width === 0) continue;
        var lap = overlap(box, rects[c].box);
        if (lap.x > 0.5 && lap.y > 0.5) hit = true;
      }
      if (hit) covered.push(rects[c].ch);
    }
    var side = slot.closest('.mtg-board__side');
    var rowLap = overlap(rowBox, nameBox);
    // The window's other tenant. The badges and the mana cost share one picture,
    // so a row wide enough to reach the cost trades one covered field for
    // another and the check has to see both.
    var cost = card.querySelector('.mtg-card__corner');
    var costLap = cost === null ? null : overlap(rowBox, cost.getBoundingClientRect());
    faces.push({
      seat: side === null ? 'unknown' : side.getAttribute('data-seat'),
      id: card.getAttribute('data-card-id'),
      tapped: slot.getAttribute('data-tapped') === 'true',
      faceW: round(faceBox.width),
      faceH: round(faceBox.height),
      nameX: round(nameBox.left - faceBox.left),
      nameY: round(nameBox.top - faceBox.top),
      nameW: round(nameBox.width),
      nameH: round(nameBox.height),
      rowX: round(rowBox.left - faceBox.left),
      rowY: round(rowBox.top - faceBox.top),
      rowW: round(rowBox.width),
      rowH: round(rowBox.height),
      overlapX: rowLap.x,
      overlapY: rowLap.y,
      costOverlapX: costLap === null ? null : costLap.x,
      costOverlapY: costLap === null ? null : costLap.y,
      marks: drawn,
      covered: covered.length,
      coveredText: covered.join('')
    });
  }
  var summarize = function (row) {
    var withOverlap = row.filter(function (face) { return face.overlapX > 0.5 && face.overlapY > 0.5; });
    var coveredCounts = row.map(function (face) { return face.covered; });
    return {
      faces: row.length,
      facesWithNameOverlap: withOverlap.length,
      worstOverlapX: row.length === 0 ? null : Math.max.apply(null, row.map(function (f) { return f.overlapX; })),
      worstOverlapY: row.length === 0 ? null : Math.max.apply(null, row.map(function (f) { return f.overlapY; })),
      lettersCoveredMax: coveredCounts.length === 0 ? null : Math.max.apply(null, coveredCounts),
      lettersCoveredTotal: coveredCounts.reduce(function (sum, n) { return sum + n; }, 0),
      facesWithLettersCovered: row.filter(function (face) { return face.covered > 0; }).length,
      facesWithCostCovered: row.filter(function (face) {
        return face.costOverlapX !== null && face.costOverlapX > 0.5 && face.costOverlapY > 0.5;
      }).length,
      examples: row.filter(function (face) { return face.covered > 0; })
        .slice(0, 3)
        .map(function (face) { return face.id + ': "' + face.coveredText + '"'; })
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
    set: document.body.getAttribute('data-set'),
    tapped: document.body.getAttribute('data-tapped') === 'true',
    seats: perSeat,
    mat: summarize(faces),
    all: faces
  };
};
`;

function page(count: number, tapped: boolean): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: dealtSession(count, tapped),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const title = `Corner marks, ${String(count)} permanents a side${tapped ? ', tapped' : ''}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body data-set="${basename(setPath)}" data-tapped="${String(tapped)}">${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of MARK_COUNTS) {
  for (const tapped of [false, true]) {
    const file = join(out, `marks${tapped ? '-tapped' : ''}-${String(count)}.html`);
    writeFileSync(file, page(count, tapped), 'utf8');
    console.log(`wrote ${file}`);
  }
}
