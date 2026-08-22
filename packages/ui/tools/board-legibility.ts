/**
 * The board's legibility as numbers, on a stated position a browser can lay out.
 *
 * Four things `mtg-8ou`, `mtg-yi5`, `mtg-3rm` and `mtg-ej5` are about are all
 * geometry or computed style, and jsdom performs no layout and resolves no
 * cascade, so no vitest test in this checkout can answer any of them. Each one
 * can regress with the declaration still in the sheet: a rule that loses the
 * cascade to `styles/board/fit.ts`, a slot that never gets `data-tapped`, a
 * `data-interactive` that stopped being stamped, an empty slot the row draws at
 * a floor some other block set. This writes the page those questions are asked
 * on, and `window.mtgBoardLegibility()` is the same answer as numbers.
 *
 * The position states each comparison as a pair of neighbors under one width
 * constraint, so a difference between them is the treatment and not the layout:
 * an upright creature beside a tapped one, a damaged creature beside an
 * undamaged one, a hand holding one card this position can pay for and one it
 * cannot, and a row with more places than permanents.
 *
 * `tap-rotation.ts` is the narrower ancestor of this file and is kept: it asks
 * only whether a tapped permanent turned, over both faces, and it is the file a
 * rotation regression should fail first. This one asks what the turn costs.
 *
 * The same arrangement as `board-crowding.ts` and `land-variants.ts`, and
 * Node-only like both: it writes a file and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/board-legibility.ts out/verify
 *
 * then navigate a browser to `board-legibility.html` and call
 * `window.mtgBoardLegibility()`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');

const CREATURE = exampleCard('slc-thornhide-guardian');
const LAND = exampleCard('slc-mountain');

/**
 * How much damage the marked creature carries.
 *
 * Below the 3/5's toughness, because the badge's sentence counts what is left
 * before lethal and a creature at or past its toughness is one state-based check
 * from the graveyard — a position to state deliberately, not the ordinary one to
 * measure the badge on. The first version of this file marked one damage on a
 * 2/1 and measured a row with no damaged creature in it at all.
 */
const MARKED_DAMAGE = 2;

interface Placed {
  readonly card: ReturnType<typeof exampleCard>;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
  readonly damage: number;
}

/**
 * One seat's permanents: two creatures and two lands, one of each turned, and
 * damage on exactly one creature.
 *
 * Four in the row against the four places `routes/play/position.ts` draws, so
 * the row holds two permanents and two empty markers and the areas of the two
 * are comparable in one screenshot.
 */
function permanents(controller: PlayerId): readonly Placed[] {
  return [
    { card: CREATURE, controller, tapped: false, summoningSick: false, damage: MARKED_DAMAGE },
    { card: CREATURE, controller, tapped: true, summoningSick: false, damage: 0 },
    { card: LAND, controller, tapped: false, summoningSick: false, damage: 0 },
    { card: LAND, controller, tapped: true, summoningSick: false, damage: 0 },
  ];
}

/**
 * A hand of one card this position can pay for and one it cannot.
 *
 * The land is playable (the land drop is unspent), and the creature is not, on
 * a board whose only untapped land is one. That is the audit's own comparison —
 * two faces in one rail, one with a move on it and one without — and it is the
 * comparison the treatment has to be visible in.
 */
function hand(): readonly ReturnType<typeof exampleCard>[] {
  return [CREATURE, LAND];
}

function legibilitySession(): GameSession {
  const built = scenario({
    seed: 'tools/board-legibility',
    battlefield: [...permanents(0), ...permanents(1)],
    hands: [hand(), []],
    active: 0,
    turn: 5,
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
 * What a browser reads off the page.
 *
 * Every number here is one a defect was reported in, in the units it was
 * reported in. The face box and the name box because a tapped permanent was
 * reported as 128x92 with an 11x76 name; the empty slot's area against the
 * smallest real permanent's because a placeholder was reported as fifteen times
 * the size of a land; the mark's text and font size because a badge was
 * reported as carrying the wrong number at 11px; and the four style channels an
 * interactive face was reported as sharing with an inert one, plus the two it
 * carries now.
 */
const MEASURE = `
window.mtgBoardLegibility = function () {
  var round = function (n) { return Math.round(n * 10) / 10; };
  var box = function (el) {
    if (el === null) return null;
    var r = el.getBoundingClientRect();
    return { w: round(r.width), h: round(r.height), area: Math.round(r.width * r.height) };
  };
  var qa = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var text = function (n) { return n === null ? null : (n.textContent || '').replace(/\\s+/g, ' ').trim(); };
  var face = function (card) {
    var style = getComputedStyle(card);
    var slot = card.closest('.mtg-slot');
    return {
      name: text(card.querySelector('.mtg-card__name')),
      size: card.getAttribute('data-size'),
      interactive: card.getAttribute('data-interactive') === 'true',
      tapped: slot.getAttribute('data-tapped') === 'true',
      cursor: style.cursor,
      borderColor: style.borderTopColor,
      outline: style.outlineStyle,
      opacity: style.opacity,
      filter: style.filter,
      boxShadow: style.boxShadow,
      rotate: style.rotate,
      scale: style.scale,
      faceBox: box(card),
      nameBox: box(card.querySelector('.mtg-card__name')),
      slotBox: box(slot)
    };
  };
  var pick = function (rows, kind, tapped) {
    var found = rows.filter(function (row) { return row.size === kind && row.tapped === tapped; });
    return found.length === 0 ? null : { count: found.length, sample: found[0] };
  };
  var play = qa(".mtg-slot[data-slot='play'] > .mtg-card").map(face);
  var held = qa(".mtg-slot[data-slot='hand'] > .mtg-card").map(face);
  var lit = held.filter(function (row) { return row.interactive; });
  var dark = held.filter(function (row) { return !row.interactive; });
  var empty = qa(".mtg-slot[data-empty='true']").map(box);
  var smallest = play.map(function (row) { return row.faceBox.area; }).sort(function (a, b) { return a - b; })[0];
  return {
    ready: { lit: lit[0] || null, unlit: dark[0] || null },
    upright: pick(play, 'board', false),
    tapped: pick(play, 'board', true),
    tile: pick(play, 'art', false),
    tappedTile: pick(play, 'art', true),
    empty: { count: empty.length, sample: empty[0] || null, smallestPermanent: smallest },
    marks: qa('.mtg-mark').map(function (mark) {
      var style = getComputedStyle(mark);
      return {
        mark: mark.getAttribute('data-mark'),
        text: text(mark),
        name: mark.getAttribute('aria-label'),
        fontSize: style.fontSize,
        decoration: style.textDecorationLine,
        onCard: text(mark.closest('.mtg-slot').querySelector('.mtg-card__name')),
        printed: text(mark.closest('.mtg-slot').querySelector('.mtg-card__pt')),
        box: box(mark)
      };
    }),
    overlappingPairs: (function () {
      var faces = qa(".mtg-slot[data-slot='play'] > .mtg-card");
      var pairs = 0;
      for (var a = 0; a < faces.length; a += 1) {
        for (var b = a + 1; b < faces.length; b += 1) {
          var one = faces[a].getBoundingClientRect();
          var two = faces[b].getBoundingClientRect();
          if (one.width === 0 || two.width === 0) continue;
          if (one.left < two.right - 0.5 && two.left < one.right - 0.5 &&
              one.top < two.bottom - 0.5 && two.top < one.bottom - 0.5) pairs += 1;
        }
      }
      return pairs;
    })()
  };
};
`;

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: legibilitySession(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>The board, measured</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
const file = join(out, 'board-legibility.html');
writeFileSync(file, page(), 'utf8');
console.log(`wrote ${file}; call window.mtgBoardLegibility() on it`);
