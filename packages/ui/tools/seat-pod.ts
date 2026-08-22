/**
 * Where a player's vitals sit, and what the battlefield gets back when they stop
 * sitting above it, as static HTML a browser can measure.
 *
 * `mtg-rgc.1` moves life, name and the zone counts off the horizontal strip
 * above each battlefield and into a pod in a column of their own on the far
 * left, which is Magic Online's arrangement. The whole claim is geometry — the
 * strip cost a row of the column and the pod costs none of it — and jsdom lays
 * nothing out, so `getBoundingClientRect` is all zeros in vitest and no test in
 * this checkout can say whether the mat gained anything. This is where it is
 * said instead.
 *
 * `tools/board-crowding.ts` and `tools/card-uniformity.ts` are the same
 * arrangement asking about a card's size; this one asks about the block beside
 * it. The measure deliberately finds the vitals through **either** selector —
 * `.mtg-pod` for the pod and `.mtg-board__side > .mtg-status` for the strip that
 * preceded it — so one page script reads a before and an after and the two
 * numbers are taken the same way.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/seat-pod.ts out/seat-pod
 *
 * Then point a browser at `seat-pod-<n>.html` at each viewport and call
 * `window.mtgSeatPod()`.
 *
 * What it answers: the pod's box per seat, the battlefield well's box per seat,
 * the tallest face in each row, the mat's box, and every overlap between a pod
 * and anything the mat draws — a zone, a card slot, the rail. The acceptance
 * evidence is `overlaps: []` at all three viewports, `podsInsideMat: true`, and
 * a battlefield taller than the same page measured before the move.
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
 * Four is the count a played game was measured reaching (`tools/board-text.ts`),
 * and twelve is the crowded case the pod has to survive: the row is at its
 * narrowest there, the wells are at their shortest, and a fixed column taken off
 * the width is at its most expensive.
 */
export const SEAT_POD_COUNTS: readonly number[] = [4, 12];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'seat-pod');
const setPath = process.argv[3];

/**
 * The cards the page is dealt from: a named set when one is given, the DSL
 * example set otherwise. A set that fails to parse stops the run rather than
 * falling back, because a silent fallback would report numbers nobody's set
 * produced.
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

/** The permanents a page deals, longest name first, so a row holds the widest names. */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => !isLand(card) && card.kind !== 'instant' && card.kind !== 'sorcery');
  if (listed.length === 0) {
    throw new Error(`${setPath ?? 'the example set'} has no permanents to stand on a board`);
  }
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
 * A position with `count` permanents a side, a seven-land mana base under each
 * seat, and five cards in each hand.
 *
 * Both seats are dealt the same list, so a pod that misbehaves is visible on
 * both ends of the column rather than on whichever seat drew the long names.
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
    seed: `tools/seat-pod/${String(count)}`,
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
 * Overlap is computed rather than eyeballed, and it is computed against
 * everything the mat draws rather than against the mat's own box: a pod inside
 * the mat's rectangle and on top of a card is still a pod drawn over the board.
 * Two boxes count as overlapping when they share more than half a square pixel,
 * which is a real intersection rather than two neighbors rounding into each
 * other.
 */
const MEASURE = `
window.mtgSeatPod = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var box = function (node) {
    if (node === null) return null;
    var rect = node.getBoundingClientRect();
    return { x: round(rect.left), y: round(rect.top), w: round(rect.width), h: round(rect.height) };
  };
  var area = function (a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  var describe = function (node) {
    return node.className + (node.getAttribute('aria-label') === null ? '' : " [" + node.getAttribute('aria-label') + "]");
  };
  var cut = function (node) { return node.scrollWidth > node.clientWidth + 0.5; };
  var vitals = [];
  var nodes = document.querySelectorAll('.mtg-pod, .mtg-board__side > .mtg-status');
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    var side = node.closest('.mtg-board__side');
    var words = node.querySelectorAll('.mtg-pod__chip-label, .mtg-pod__name, .mtg-status__count-label');
    var cutWords = [];
    for (var w = 0; w < words.length; w += 1) if (cut(words[w])) cutWords.push(words[w].textContent);
    vitals.push({
      kind: node.classList.contains('mtg-pod') ? 'pod' : 'strip',
      seat: node.getAttribute('data-seat') || (side === null ? 'unknown' : side.getAttribute('data-seat')),
      label: node.getAttribute('aria-label'),
      box: box(node),
      cutWords: cutWords
    });
  }
  var seats = {};
  var sides = document.querySelectorAll('.mtg-board__side');
  for (var s = 0; s < sides.length; s += 1) {
    var seat = sides[s].getAttribute('data-seat');
    var field = sides[s].querySelector(".mtg-zone[aria-label$='battlefield']");
    var slots = sides[s].querySelectorAll(".mtg-slot[data-slot='play']");
    var heights = [];
    for (var f = 0; f < slots.length; f += 1) {
      // The mana base is a band of tiles under the row and is sized by its own
      // rules, so a tile counted here would report a second face height that
      // has nothing to do with how much room the spells got.
      if (slots[f].parentElement !== null && slots[f].parentElement.classList.contains('mtg-lands')) continue;
      var face = slots[f].querySelector('.mtg-card');
      if (face === null) continue;
      var faceBox = face.getBoundingClientRect();
      if (faceBox.height > 0) heights.push(round(faceBox.height));
    }
    seats[seat] = {
      side: box(sides[s]),
      battlefield: box(field),
      faces: heights.length,
      tallestFace: heights.length === 0 ? null : Math.max.apply(null, heights),
      shortestFace: heights.length === 0 ? null : Math.min.apply(null, heights)
    };
  }
  var mat = document.querySelector('.mtg-board');
  var matRect = mat === null ? null : mat.getBoundingClientRect();
  var drawn = document.querySelectorAll('.mtg-board__lanes .mtg-zone, .mtg-board__lanes .mtg-slot, .mtg-board__rail');
  var overlaps = [];
  var podsInsideMat = matRect !== null;
  for (var v = 0; v < nodes.length; v += 1) {
    var vitalRect = nodes[v].getBoundingClientRect();
    if (matRect !== null && area(vitalRect, matRect) < vitalRect.width * vitalRect.height - 0.5) {
      podsInsideMat = false;
    }
    for (var d = 0; d < drawn.length; d += 1) {
      if (drawn[d].contains(nodes[v])) continue;
      var shared = area(vitalRect, drawn[d].getBoundingClientRect());
      if (shared > 0.5) {
        overlaps.push({ vitals: describe(nodes[v]), over: describe(drawn[d]), area: round(shared) });
      }
    }
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    vitals: vitals,
    seats: seats,
    mat: box(mat),
    lanes: box(document.querySelector('.mtg-board__lanes')),
    pods: box(document.querySelector('.mtg-board__pods')),
    rail: box(document.querySelector('.mtg-board__rail')),
    podsInsideMat: podsInsideMat,
    overlaps: overlaps,
    pageOverflow: {
      x: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      y: round(document.documentElement.scrollHeight - document.documentElement.clientHeight)
    }
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
  const title = `Seat pods, ${String(count)} permanents a side`;
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
for (const count of SEAT_POD_COUNTS) {
  const file = join(out, `seat-pod-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
