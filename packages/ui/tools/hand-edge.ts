/**
 * How much of a hand card the rail's scroll container cuts off its own ends.
 *
 * `hand-scale.ts` is the rig this copies, and it answers a different question:
 * that one measures how *large* a hand card is, this one measures what happens
 * to the card at the edge of the row. A rail body is a scroll container
 * (`../src/styles/board/zone.ts`), a scroll container clips at its padding box,
 * and a card paints several marks outside its own border box — the castable ring
 * and its halo (`../src/styles/board/slot.ts`), the selection outline
 * (`../src/styles/card.ts`), the focus ring (`../src/styles/base.ts`) and the
 * growth of the 1.03 hover scale. Whatever the row does not reserve for those,
 * the first and last cards lose. `mtg-3oy` is what that cost: 0.00px of slack at
 * the inline-start edge, at every viewport and every hand size.
 *
 * **Why it varies the hand size rather than the board.** The row draws seven
 * places, so a hand under seven leaves its slack at the *end* and only the first
 * card is against an edge; a hand of seven or more puts a card against both.
 * Past seven the row scrolls, and a scrolling row is a different reading again —
 * so the sizes bracket that threshold on both sides.
 *
 * What a browser reads back per slot: the face box, the offset from the clip
 * edge at each end, the outward ink extent computed from the card's own resolved
 * `box-shadow` and `outline`, and how much of that extent falls outside the clip
 * box. `window.mtgSetState` puts the first card into the states that paint those
 * marks, because the defect is invisible on a card that wears none.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/hand-edge.ts out/hand-edge \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `hand-<n>.html` at each viewport and call
 * `window.mtgHandEdge()`.
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

export const HAND_SIZES: readonly number[] = [1, 3, 5, 7, 8, 10];
const PERMANENTS_A_SIDE = 4;

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'hand-edge');
const setPath = process.argv[3];

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

function dealtSession(handSize: number): GameSession {
  const dealt = Array.from({ length: PERMANENTS_A_SIDE }, (_unused, index) => {
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
  const hand = handCards(handSize);
  const built = scenario({
    seed: `tools/hand-edge/${String(handSize)}`,
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
 * A `box-shadow` of `Ox Oy B S` paints out to `S + B` past the border box in the
 * conservative reading the sheet's own docblocks use; the visible edge under a
 * gaussian of radius B is nearer `S + B / 2`. Both are reported.
 */
const MEASURE = `
window.mtgHandEdge = function () {
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
  var body = document.querySelector(".mtg-board__side[data-seat='you'] .mtg-zone[data-tone='rail'] .mtg-zone__body");
  if (body === null) return { error: 'no near hand body' };
  var bodyStyle = getComputedStyle(body);
  var bodyBox = body.getBoundingClientRect();
  var clipLeft = bodyBox.left + parseFloat(bodyStyle.borderLeftWidth);
  var clipRight = bodyBox.right - parseFloat(bodyStyle.borderRightWidth);
  var clipTop = bodyBox.top + parseFloat(bodyStyle.borderTopWidth);
  var slots = body.querySelectorAll(".mtg-slot[data-slot='hand']");
  var read = [];
  for (var s = 0; s < slots.length; s += 1) {
    var slot = slots[s];
    var card = slot.querySelector('.mtg-card');
    if (card === null) { read.push({ index: s, empty: true }); continue; }
    var box = card.getBoundingClientRect();
    var cs = getComputedStyle(card);
    var shadow = shadowExtent(cs.boxShadow);
    var outline = cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
    var ink = Math.max(shadow.full, outline);
    var inkHalf = Math.max(shadow.half, outline);
    read.push({
      index: s,
      id: card.getAttribute('data-card-id'),
      interactive: card.getAttribute('data-interactive') === 'true',
      selected: card.getAttribute('data-selected') === 'true',
      focused: card === document.activeElement,
      faceW: round(box.width),
      faceH: round(box.height),
      left: round(box.left - clipLeft),
      right: round(clipRight - box.right),
      inkFull: round(ink),
      inkHalf: round(inkHalf),
      cutStartFull: round(Math.max(0, ink - (box.left - clipLeft))),
      cutStartHalf: round(Math.max(0, inkHalf - (box.left - clipLeft))),
      cutEndFull: round(Math.max(0, ink - (clipRight - box.right))),
      cutBlockStart: round(Math.max(0, ink - (box.top - clipTop)))
    });
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    body: {
      paddingInline: bodyStyle.paddingLeft + ' / ' + bodyStyle.paddingRight,
      paddingBlock: bodyStyle.paddingTop + ' / ' + bodyStyle.paddingBottom,
      overflowX: bodyStyle.overflowX,
      overflowY: bodyStyle.overflowY,
      clientW: body.clientWidth,
      scrollW: body.scrollWidth,
      overflowing: body.scrollWidth > body.clientWidth,
      scrollLeft: body.scrollLeft
    },
    slots: read
  };
};
window.mtgSetState = function (index, state) {
  var body = document.querySelector(".mtg-board__side[data-seat='you'] .mtg-zone[data-tone='rail'] .mtg-zone__body");
  var slots = body.querySelectorAll(".mtg-slot[data-slot='hand']");
  var card = slots[index].querySelector('.mtg-card');
  if (state === 'selected') card.setAttribute('data-selected', 'true');
  if (state === 'inert') card.removeAttribute('data-interactive');
  if (state === 'focus') card.focus();
  return true;
};
window.mtgCardBox = function (index) {
  var body = document.querySelector(".mtg-board__side[data-seat='you'] .mtg-zone[data-tone='rail'] .mtg-zone__body");
  var slots = body.querySelectorAll(".mtg-slot[data-slot='hand']");
  var card = slots[index].querySelector('.mtg-card');
  var box = card.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height };
};
`;

function page(handSize: number): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: dealtSession(handSize),
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
<head><meta charset="utf-8"><title>Hand edge, ${String(handSize)} cards</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const size of HAND_SIZES) {
  const file = join(out, `hand-${String(size)}.html`);
  writeFileSync(file, page(size), 'utf8');
  console.log(`wrote ${file}`);
}
