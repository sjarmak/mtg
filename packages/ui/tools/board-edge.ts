/**
 * How much of a battlefield permanent the spell row's scroll container cuts off
 * its own ends.
 *
 * `hand-edge.ts` is the rig this copies, and it asks the same question one zone
 * over: a scroll container clips at its padding box, a card paints several marks
 * *outside* its own border box, and whatever the row does not reserve, the first
 * and last permanents lose. The marks are `../src/styles/board/slot.ts`'s
 * castable ring (2px of amber over 3px of seam, plus a 14px halo),
 * `../src/styles/card.ts`'s selection outline, `../src/styles/base.ts`'s focus
 * ring, and the growth of the 1.03 hover scale. A permanent wearing none of them
 * is perfect at 0.00px of clearance, which is why the defect reads as
 * intermittent — `mtg-e3n`, and the hand's own `mtg-3oy` before it.
 *
 * **The difference from the hand, and the reason this rig walks ancestors rather
 * than reading one box.** The hand's rail body is the only scroll container over
 * a hand card. A battlefield permanent has two: `.mtg-board__spells` is a
 * scroller inside `.mtg-zone__body[data-layout='board']`, which
 * `../src/styles/board/fit.ts` also makes one. Clearance against the inner box
 * says nothing on its own, because the outer box can cut what the inner one
 * reserved. So `clip` is the *nearest* clipping ancestor on each side and the
 * report names it, which is what makes a fix that only moved the clip out one
 * box visible as a fix that moved nothing.
 *
 * Both seats are read because a rule that lands on one row is not thereby right
 * on the other, even though both now share the same available-width basis.
 *
 * The face box is reported beside the clearance, and it is the thing this bead
 * may not move: `hand.ts` sizes a board face as a share of this row's *content*
 * box, so inline padding taken off the row comes straight off every permanent.
 * How much headroom there is before that costs a reading is
 * `../src/styles/card.ts`'s `BOARD_RULES_MIN_REM`, which drops the rules box
 * when a face's own content box reaches 4rem — an 80.00px face, against the
 * 82.61px one a 1280x800 board draws at four a side.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/board-edge.ts out/board-edge \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `board-<n>.html` at each viewport and call
 * `window.mtgBoardEdge()`. `window.mtgSetState(seat, index, state)` puts a
 * permanent into the states that paint the marks, because the defect is
 * invisible on a card that wears none.
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
 * How many permanents a side each page draws.
 *
 * `card-uniformity.ts`'s counts, so the two rigs' face boxes can be read beside
 * each other: four is what a played game reaches and is where a face is largest,
 * eight is a long game, twelve is past either. The clip is at the row's edge at
 * every count; what the count moves is the face that is being cut.
 */
export const BOARD_EDGE_COUNTS: readonly number[] = [4, 8, 12];
const HAND_SIZE = 7;

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'board-edge');
const setPath = process.argv[3];

/** The cards the page is dealt from; a set that fails to parse stops the run. */
function cards(): readonly DslCard[] {
  if (setPath === undefined) return EXAMPLE_SET;
  const document: unknown = JSON.parse(readFileSync(setPath, 'utf8'));
  const listed =
    typeof document === 'object' && document !== null && 'cards' in document
      ? (document as { readonly cards: unknown }).cards
      : null;
  if (!Array.isArray(listed)) throw new Error(`${setPath} has no "cards" array`);
  return parseCards(listed);
}

const CARDS = cards();

/** Distinct permanents, longest name first, so the row holds the widest spread the set has. */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => !isLand(card) && card.kind !== 'instant' && card.kind !== 'sorcery');
  if (listed.length === 0) throw new Error('no permanents');
  return [...listed].sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id));
}

const PERMANENTS = permanents();

function handCards(size: number): readonly DslCard[] {
  const listed = [...CARDS].sort(
    (a, b) => renderOracleText(b).length - renderOracleText(a).length || a.id.localeCompare(b.id),
  );
  return Array.from({ length: size }, (_unused, index) => {
    const card = listed[index % listed.length];
    if (card === undefined) throw new Error('no card to deal');
    return card;
  });
}

function manaBase(count: number): readonly DslCard[] {
  const basics = setBasics(CARDS);
  return Array.from({ length: count }, (_unused, index) => {
    const land = basics[index % basics.length];
    if (land === undefined) throw new Error('setBasics returned nothing');
    return land;
  });
}

function dealtSession(perSide: number): GameSession {
  const dealt = Array.from({ length: perSide }, (_unused, index) => {
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
  const hand = handCards(HAND_SIZE);
  const built = scenario({
    seed: `tools/board-edge/${String(perSide)}`,
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
 * Ink extent of a box, outward, from its own box-shadow and outline.
 *
 * `hand-edge.ts`'s function, unchanged: a `box-shadow` of `Ox Oy B S` paints out
 * to `S + B` in the conservative reading the sheet's own docblocks use, and the
 * visible edge under a gaussian of radius B is nearer `S + B / 2`. Both are
 * reported.
 */
const MEASURE = `
window.mtgBoardEdge = function () {
  var round = function (v) { return Math.round(v * 100) / 100; };
  var shadowExtent = function (spec) {
    if (!spec || spec === 'none') return { full: 0, half: 0 };
    var parts = spec.split(/,(?![^()]*\\))/);
    var full = 0, half = 0;
    for (var i = 0; i < parts.length; i += 1) {
      var nums = parts[i].match(/-?[0-9.]+px/g);
      if (nums === null) continue;
      var n = nums.map(function (t) { return parseFloat(t); });
      var ox = n[0] || 0, oy = n[1] || 0, blur = n[2] || 0, spread = n[3] || 0;
      full = Math.max(full, spread + blur - ox);
      half = Math.max(half, spread + blur / 2 - ox);
    }
    return { full: full, half: half };
  };
  var name = function (el) {
    if (el === null) return null;
    var cls = typeof el.className === 'string' ? el.className : '';
    var layout = el.getAttribute ? el.getAttribute('data-layout') : null;
    return cls + (layout === null ? '' : "[data-layout='" + layout + "']");
  };
  /* Every clipping ancestor of a node, nearest first: a box whose overflow is
     anything but visible on an axis clips at its padding box on that axis. */
  var clippers = function (node, stop) {
    var found = [];
    var el = node.parentElement;
    while (el !== null) {
      var cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        var box = el.getBoundingClientRect();
        found.push({
          el: el,
          label: name(el),
          overflow: cs.overflowX + ' / ' + cs.overflowY,
          paddingInline: cs.paddingLeft + ' / ' + cs.paddingRight,
          marginInline: cs.marginLeft + ' / ' + cs.marginRight,
          left: box.left + parseFloat(cs.borderLeftWidth),
          right: box.right - parseFloat(cs.borderRightWidth),
          top: box.top + parseFloat(cs.borderTopWidth)
        });
      }
      if (el === stop) break;
      el = el.parentElement;
    }
    return found;
  };
  var seats = {};
  var seatNames = ['you', 'opponent'];
  for (var q = 0; q < seatNames.length; q += 1) {
    var seat = seatNames[q];
    var row = document.querySelector(".mtg-board__side[data-seat='" + seat + "'] .mtg-board__spells");
    if (row === null) { seats[seat] = { error: 'no spell row' }; continue; }
    var rowStyle = getComputedStyle(row);
    var slots = row.querySelectorAll(".mtg-slot[data-slot='play']");
    var read = [];
    for (var s = 0; s < slots.length; s += 1) {
      var card = slots[s].querySelector('.mtg-card');
      if (card === null) { read.push({ index: s, empty: true }); continue; }
      var box = card.getBoundingClientRect();
      var cs = getComputedStyle(card);
      var shadow = shadowExtent(cs.boxShadow);
      var outline = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
      var ink = Math.max(shadow.full, outline);
      var inkHalf = Math.max(shadow.half, outline);
      var boxes = clippers(card, null);
      var startClip = null, endClip = null, startGap = Infinity, endGap = Infinity;
      for (var b = 0; b < boxes.length; b += 1) {
        var gs = box.left - boxes[b].left;
        var ge = boxes[b].right - box.right;
        if (gs < startGap) { startGap = gs; startClip = boxes[b]; }
        if (ge < endGap) { endGap = ge; endClip = boxes[b]; }
      }
      read.push({
        index: s,
        id: card.getAttribute('data-card-id'),
        interactive: card.getAttribute('data-interactive') === 'true',
        selected: card.getAttribute('data-selected') === 'true',
        focused: card === document.activeElement,
        faceW: round(box.width),
        faceH: round(box.height),
        startGap: round(startGap),
        endGap: round(endGap),
        startClipBy: startClip === null ? null : startClip.label,
        endClipBy: endClip === null ? null : endClip.label,
        inkFull: round(ink),
        inkHalf: round(inkHalf),
        cutStartFull: round(Math.max(0, ink - startGap)),
        cutStartHalf: round(Math.max(0, inkHalf - startGap)),
        cutEndFull: round(Math.max(0, ink - endGap))
      });
    }
    var first = slots.length === 0 ? null : slots[0].querySelector('.mtg-card');
    /* The mana band under the row, which is the other thing this page can say
       for free: how tall it is, and how many tiles fit before it scrolls. The
       band is flex-nowrap over fixed-size tiles (../src/styles/board/lands.ts),
       so the capacity is arithmetic rather than a search. */
    var band = row.parentElement === null ? null : row.parentElement.querySelector('.mtg-lands');
    var tile = band === null ? null : band.querySelector(".mtg-slot[data-slot='play']");
    var bandGap = band === null ? 0 : parseFloat(getComputedStyle(band).columnGap) || 0;
    var tileW = tile === null ? 0 : tile.getBoundingClientRect().width;
    seats[seat] = {
      row: {
        paddingInline: rowStyle.paddingLeft + ' / ' + rowStyle.paddingRight,
        marginInline: rowStyle.marginLeft + ' / ' + rowStyle.marginRight,
        overflow: rowStyle.overflowX + ' / ' + rowStyle.overflowY,
        clientW: row.clientWidth,
        clientH: row.clientHeight,
        scrollW: row.scrollWidth,
        scrollH: row.scrollHeight,
        overflowing: row.scrollWidth > row.clientWidth,
        overflowingBlock: row.scrollHeight > row.clientHeight
      },
      band: band === null ? null : {
        clientW: band.clientWidth,
        scrollW: band.scrollWidth,
        clientH: band.clientHeight,
        tiles: band.querySelectorAll(".mtg-slot[data-slot='play']").length,
        tileW: round(tileW),
        tileH: tile === null ? 0 : round(tile.getBoundingClientRect().height),
        gap: round(bandGap),
        fits: tileW === 0 ? 0 : Math.floor((band.clientWidth + bandGap) / (tileW + bandGap))
      },
      clippers: first === null ? [] : clippers(first, null).map(function (c) {
        return { label: c.label, overflow: c.overflow, paddingInline: c.paddingInline, marginInline: c.marginInline };
      }),
      slots: read
    };
  }
  return { viewport: { width: window.innerWidth, height: window.innerHeight }, seats: seats };
};
window.mtgSetState = function (seat, index, state) {
  var row = document.querySelector(".mtg-board__side[data-seat='" + seat + "'] .mtg-board__spells");
  if (row === null) return false;
  var slots = row.querySelectorAll(".mtg-slot[data-slot='play']");
  if (slots[index] === undefined) return false;
  var card = slots[index].querySelector('.mtg-card');
  if (card === null) return false;
  if (state === 'castable') card.setAttribute('data-interactive', 'true');
  if (state === 'selected') card.setAttribute('data-selected', 'true');
  if (state === 'inert') card.removeAttribute('data-interactive');
  if (state === 'focus') card.focus();
  return true;
};
`;

function page(perSide: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: dealtSession(perSide),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Board edge, ${String(perSide)} a side</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of BOARD_EDGE_COUNTS) {
  const file = join(out, `board-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
