/**
 * A played table with one more permanent about to land on the far side, as
 * static HTML a browser can measure: does the opponent's play arrive, how long
 * does the browser say it takes, and is the row still one height while it is in
 * flight?
 *
 * `mtg-81a` is a CSS animation fired by an element entering the document
 * (`../src/styles/board/arrival.ts`). jsdom runs no animation, lays nothing out
 * and gives every element the same zero-sized box, so `test/play/arrival.test.ts`
 * can hold the rule, the scope and React's reconciliation and can hold none of
 * the three questions above. This is where they are asked.
 *
 * **The insertion is the stand-in, and it is a faithful one.** The page appends
 * one already-rendered `.mtg-slot` to the far seat's row and drops one empty
 * place, which is exactly the DOM mutation React performs when a permanent
 * arrives — that it is exactly that is the half `test/play/arrival.test.ts`
 * proves, by holding every other card's node identical across the same
 * re-render. Doing it this way costs the page a React runtime it has no bundler
 * for, and buys a deterministic single mutation to measure.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/arrival-panel.ts out/arrival-panel \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Then point a browser at `arrival-<n>.html` and call, in order,
 * `window.mtgArrival.rows()`, `window.mtgArrival.land()`, and
 * `window.mtgArrival.rows()` again. `window.mtgArrival.freeze(ms)` holds the
 * arriving card at one point on its timeline so a screenshot catches a real
 * intermediate frame instead of whatever the capture happened to land on.
 *
 * What it answers: the animation the browser resolved for the arriving card and
 * the duration it reports for it, the card's own box and opacity sampled across
 * the flight, and — before the insertion, during it and after it — how many
 * distinct face heights each seat's row has and how far apart the tallest and
 * shortest are. The acceptance evidence is `heights: 1` and `spread: 0` at all
 * three readings, `animation.duration` equal to `ARRIVAL_MS`, and a `travel`
 * whose `top` falls and whose `opacity` rises. Under an emulated
 * `prefers-reduced-motion: reduce` the evidence is the opposite and just as
 * important: `animation.name` is `none` and `animation.running` is 0.
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
import { Battlefield } from '../src/board/Battlefield';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { ARRIVAL_MS } from '../src/styles/board/arrival';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many permanents a side each page draws, matching `card-uniformity.ts`'s
 * counts so the height readings taken here are comparable with the ones that
 * file reports. Four is what a played game reaches, eight is a long game, twelve
 * is past it and is where a face is narrowest.
 */
export const ARRIVAL_COUNTS: readonly number[] = [4, 8, 12];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'arrival-panel');
const setPath = process.argv[3];

/**
 * The cards the page is dealt from: a named set when one is given, the DSL
 * example set otherwise. A set that fails to parse stops the run rather than
 * falling back, because a silent fallback would report a clean board that
 * nobody's set produced.
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

/** Longest name first, so the row holds the widest name spread the set contains. */
function permanents(): readonly DslCard[] {
  const listed = CARDS.filter((card) => !isLand(card) && card.kind !== 'instant' && card.kind !== 'sorcery');
  if (listed.length === 0)
    throw new Error(`${setPath ?? 'the example set'} has no permanents to stand on a board`);
  return [...listed].sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id));
}

const PERMANENTS = permanents();

function dealt(count: number): readonly DslCard[] {
  return Array.from({ length: count }, (_unused, index) => {
    const card = PERMANENTS[index % PERMANENTS.length];
    if (card === undefined) throw new Error('no permanent to deal');
    return card;
  });
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

/**
 * A mid-game position with `count` permanents a side. The seat with one slot
 * still empty is the opponent's, because that is the row the arriving card is
 * appended to and an arrival that had to reflow the row would be measuring two
 * things at once.
 */
function dealtSession(count: number): GameSession {
  const spells = [0, 1].flatMap((controller) =>
    dealt(count).map((card) => ({ card, controller: controller as PlayerId, summoningSick: false })),
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
    seed: `tools/arrival-panel/${String(count)}`,
    battlefield: [...spells, ...lands],
    hands: [dealt(count).slice(0, 5), dealt(count).slice(0, 5)],
    active: 1,
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
 * The permanent that arrives, rendered on its own so the page holds one slot it
 * can move rather than a second copy of the whole table. It is summoning sick,
 * which is what a creature that just landed is, so the corner mark that rides in
 * with the card is measurable too.
 */
function arrivingSlot(): string {
  const card = PERMANENTS[0];
  if (card === undefined) throw new Error('no permanent to deal');
  return renderToStaticMarkup(
    h(Battlefield, {
      label: 'Arriving',
      permanents: [{ key: 'arriving', card, summoningSick: true }],
    }),
  );
}

const MEASURE = `
window.mtgArrival = (function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var far = function () {
    return document.querySelector(".mtg-board__side[data-seat='opponent']");
  };
  var arriving = function () {
    var side = far();
    return side === null ? null : side.querySelector(".mtg-slot[data-permanent-key='arriving'] > .mtg-card");
  };
  var rowOf = function (seat) {
    var side = document.querySelector(".mtg-board__side[data-seat='" + seat + "']");
    if (side === null) return [];
    var faces = [];
    var slots = side.querySelectorAll(".mtg-zone__body[data-layout='board'] .mtg-board__spells .mtg-slot");
    for (var i = 0; i < slots.length; i += 1) {
      var card = slots[i].querySelector('.mtg-card');
      if (card === null) continue;
      var box = card.getBoundingClientRect();
      if (box.height === 0) continue;
      faces.push(round(box.height));
    }
    return faces;
  };
  var summarize = function (faces) {
    var seen = {};
    for (var i = 0; i < faces.length; i += 1) seen[faces[i]] = 1;
    var tall = Object.keys(seen).map(Number);
    return {
      faces: faces.length,
      heights: tall.length,
      tallest: tall.length === 0 ? null : Math.max.apply(null, tall),
      shortest: tall.length === 0 ? null : Math.min.apply(null, tall),
      spread: tall.length === 0 ? null : round(Math.max.apply(null, tall) - Math.min.apply(null, tall))
    };
  };
  var animationOf = function (element) {
    if (element === null) return null;
    var style = getComputedStyle(element);
    var running = typeof element.getAnimations === 'function' ? element.getAnimations() : [];
    var timing = running.length === 0 ? null : running[0].effect.getComputedTiming();
    return {
      name: style.animationName,
      declared: style.animationDuration,
      easing: style.animationTimingFunction,
      fill: style.animationFillMode,
      running: running.length,
      duration: timing === null ? null : timing.duration,
      activeDuration: timing === null ? null : timing.activeDuration,
      iterations: timing === null ? null : timing.iterations
    };
  };
  var frame = function (element, at) {
    if (element === null) return null;
    var box = element.getBoundingClientRect();
    var style = getComputedStyle(element);
    return {
      at: at,
      top: round(box.top),
      height: round(box.height),
      opacity: Math.round(parseFloat(style.opacity) * 1000) / 1000
    };
  };
  return {
    rows: function () {
      return { you: summarize(rowOf('you')), opponent: summarize(rowOf('opponent')) };
    },
    /** Appends the prepared slot and drops one empty place: the arrival, as React performs it. */
    land: function () {
      var side = far();
      if (side === null) throw new Error('no far seat on this page');
      var row = side.querySelector('.mtg-board__spells');
      if (row === null) throw new Error('the far seat draws no row of spells');
      var source = document.getElementById('arriving');
      var slot = source.content.querySelector(".mtg-slot[data-slot='play']").cloneNode(true);
      var empty = row.querySelector(".mtg-slot[data-empty='true']");
      if (empty !== null) row.removeChild(empty);
      row.appendChild(slot);
      return animationOf(arriving());
    },
    /** Holds the arriving card at one point on its own timeline, for a screenshot. */
    freeze: function (at) {
      var element = arriving();
      if (element === null) return null;
      var running = element.getAnimations();
      for (var i = 0; i < running.length; i += 1) {
        running[i].pause();
        running[i].currentTime = at;
      }
      var side = far();
      var marks = side.querySelectorAll(".mtg-slot[data-permanent-key='arriving'] > .mtg-slot__marks");
      for (var j = 0; j < marks.length; j += 1) {
        var held = marks[j].getAnimations();
        for (var k = 0; k < held.length; k += 1) { held[k].pause(); held[k].currentTime = at; }
      }
      return frame(element, at);
    },
    /** Samples the flight in real time, without pausing it. */
    travel: function (samples) {
      var element = arriving();
      var started = performance.now();
      var seen = [];
      return new Promise(function (done) {
        var tick = function () {
          seen.push(frame(element, round(performance.now() - started)));
          if (seen.length >= samples) { done(seen); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    animation: function () { return animationOf(arriving()); }
  };
})();
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
  const title = `Arrival, ${String(count)} permanents a side, ${String(ARRIVAL_MS)}ms`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}
<template id="arriving">${arrivingSlot()}</template>
<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of ARRIVAL_COUNTS) {
  const file = join(out, `arrival-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
