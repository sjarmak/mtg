/**
 * Does the whole turn structure fit the strip, and what gives when it does not?
 *
 * `mtg-rgc.2` is a width problem before it is anything else. Thirteen step names,
 * a turn label and two rows of stop marks have to share the one full-width row
 * above a board that also has to hold two battlefields, two hands and every legal
 * move. Magic Online answers it by truncating step names — the turn-18 capture in
 * `references/maxresdefault-80883895.jpg` reads `Begin… Attack Block Dam… End…
 * Main End Clean…` — and the bead's instruction was to measure that choice rather
 * than assume it.
 *
 * jsdom cannot: it performs no layout, `getBoundingClientRect` is all zeros, and
 * `scrollWidth` is `clientWidth` on everything. So this is the same arrangement
 * `cast-panel.ts` and `turn-stops-panel.ts` use — render the shipped markup to a
 * static page with the shipped sheet, inject a measurement function, read the
 * boxes over CDP in chrome-headless-shell.
 *
 * **It measures the crowded case on purpose.** The strip carries the dealer's
 * own control on every sealed game, which is what `npm run play` opens, and that
 * button is what the bar has to fit around. Measuring the bare strip would be
 * measuring the easy one.
 *
 * ## What the turn cost the steps, chrome-headless-shell 151, 2026-08-21
 *
 * `mtg-rgc.13` put the turn at the left-hand end of this bar, so the steps row
 * lost the width the head takes. Read on this page against the same page with
 * the head hidden — lines in the steps row, and the near battlefield's height:
 *
 *   viewport   without the turn   with it     battlefield
 *   1440x900   1 line, 33.9       2, 59.9     316.9 → 303.9
 *   1280x800   2 lines, 69.9      2, 69.9     271.3 → 271.3
 *   1024x768   2 lines, 69.9      2, 69.9     255.3 → 255.3
 *
 * One line at the widest viewport, nothing at the other two, and no node clipped
 * and no sideways scroll in any of the six readings. `styles/views.ts` argues the
 * 5rem cap that holds it there, which is a ledge: 5.5rem is a third line at
 * 1024x768.
 *
 * ## What it reported before that, chrome-headless-shell 151.0.7922.47, 2026-08-16
 *
 * At all three viewports the steps strip has `scrollWidth === clientWidth` — no
 * sideways scroll anywhere, which is the property the old bar did not have — the
 * page never scrolls sideways, and all thirteen nodes are inside the bar with two
 * stop rows on the eleven that can hold one. The toolbar above the board is one
 * row of 28.8px at all three; the bar is its own block under the battlefield and
 * its height is the second number below.
 *
 * Before `styles/views.ts` gave the steps a content basis and a wrap, and after:
 *
 *   viewport   bar width   bar height     words clipped   lines
 *   1440x900   934.0       33.9 → 33.9    3 → 0           1 → 1
 *   1280x800   789.1       33.9 → 69.9    6 → 0           1 → 2
 *   1024x768   566.3       33.9 → 69.9   12 → 0           1 → 2
 *
 * The three words clipped at 1440x900 were arithmetic and not room: the thirteen
 * labels want 779px of the 863 the steps row had, and thirteen equal columns gave
 * `Begin combat` 65px of the 92 it wanted while `End` used 25 of its 65. The
 * other two viewports are genuinely short — 718 and 495 against 779 — and buy the
 * words with a second line.
 *
 * The DOM text and the accessible name were never truncated even when the drawn
 * word was, so what a screen reader and a voice control get did not change.
 *
 * Node-only, like the two tools it copies: it writes a file and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/step-bar.ts out/verify
 *
 * Then load the page in chrome-headless-shell over CDP at each viewport and call
 * `window.mtgStepBar()`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { GameState } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, DEFAULT_BEATS, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { GameLog } from '../src/log/GameLog';
import { boardPosition } from '../src/routes/play/position';
import type { SeatNames } from '../src/routes/play/position';
import { priorityFoot } from '../src/routes/play/priority';
import {
  buildPrompt,
  choicesByObject,
  describeStep,
  describeTurn,
  stepLabel,
} from '../src/routes/play/prompt';
import { promptPanel } from '../src/routes/play/rail';
import { railToggle } from '../src/routes/play/rail-collapse';
import { playTable } from '../src/routes/play/table';
import { NO_STAGING } from '../src/routes/play/combat';
import { playToolbar, stepBar } from '../src/routes/play/toolbar';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');

/**
 * A long seat name, because that is the honest case.
 *
 * Magic Online's own capture truncates `BswizzMTG` to `BswizzM…`, and a badge
 * measured with `You` in it would be a badge measured with the problem removed.
 */
const NAMES: SeatNames = ['Thornwood Warden', 'Bot'];
const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

function skirmish(): GameState {
  return scenario({
    seed: 'tools/step-bar',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
      { card: GUARDIAN, controller: 1, summoningSick: false },
    ],
    hands: [[MOUNTAIN, RAIDER, LASH], []],
  }).state;
}

/** `PlayView`'s body, composed from the same seams that view composes. */
function table(): string {
  const state = skirmish();
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  const prompt = buildPrompt(state, decision, NAMES);
  const rendered = playTable({
    // A rig owns no session, so nothing is being declared and nothing can be
    // staged (`../src/routes/play/combat.ts`).
    staging: NO_STAGING,
    combat: null,
    position: boardPosition(state, 0, NAMES, null),
    playable: new Set(state.players[0].hand),
    byObject: choicesByObject(prompt),
    selection: {
      openKey: null,
      select: () => undefined,
      activate: () => undefined,
      openMenu: () => undefined,
      dismiss: () => undefined,
      pickerFor: () => null,
      declaration: null,
      ordering: null,
      targeting: null,
    },
    // The ask is in the pod column and the history is in the rail (`mtg-rgc.4`),
    // which is the split this tool has to measure the bar against: the strip's
    // width is what the two columns leave it.
    // The panel and the pass under it, which is the pair `../src/routes/play/
    // PlayView.ts` puts in this slot since `mtg-crw`: the priority band the
    // pass used to sit in spanned the table and is gone.
    prompt: h(
      Fragment,
      null,
      promptPanel(prompt, () => undefined, 0),
      priorityFoot({
        holder: state.turn.priority,
        names: NAMES,
        stackDepth: state.stack.length,
        overYourOwn: false,
        stepText: stepLabel(state.turn.step),
        passAt: 0,
        onPass: () => undefined,
        keyNote: null,
      }),
    ),
    // Under the near battlefield and over the near hand since `mtg-rgc.6`, which
    // is the placement this tool now measures: the bar's box against the two
    // zones it sits between, rather than against the strip it used to share.
    // The turn rides at its left-hand end since `mtg-rgc.13`, so the width this
    // rig is about is now the width the thirteen nodes have left over.
    steps: stepBar({
      step: state.turn.step,
      turnText: describeTurn(state, NAMES),
      stepText: describeStep(state, NAMES),
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      canYield: true,
      onYield: () => undefined,
      beats: DEFAULT_BEATS,
      onBeats: () => undefined,
    }),
    rail: h(GameLog, {
      events: [],
      names: { player: (id) => NAMES[id], card: () => '', target: () => '' },
      viewer: 0,
    }),
    // The side panel is collapsible since `mtg-crw`; every page here draws it
    // open, which is the state these rigs have always measured.
    railHead: railToggle({ collapsed: false, toggle: () => undefined }),
    railCollapsed: false,
    onResolve: null,
  });
  // What every sealed game puts on this strip, and since `mtg-rgc.13` the only
  // thing on it: the turn left for the bar, so what is left above the table is
  // the dealer's own control.
  const toolbar = playToolbar(h('button', { type: 'button', className: 'mtg-btn' }, 'Back to deckbuilding'));
  return renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-play', tabIndex: -1 },
        toolbar,
        h('div', { className: 'mtg-play__table' }, rendered),
      ),
    }),
  );
}

/**
 * What a browser reads off the page.
 *
 * Truncation is `scrollWidth > clientWidth` on the label element, which is the
 * one question `text-overflow: ellipsis` answers and the one jsdom cannot: it
 * reports the two as equal on everything. The same comparison on the steps strip
 * is the no-sideways-scroll claim, and it has to be zero — a bar that scrolls is
 * a bar hiding the nodes it exists to show.
 */
const MEASURE = `
window.mtgStepBar = function () {
  var box = function (node) {
    var r = node.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  };
  var clipped = function (node) { return node.scrollWidth > node.clientWidth + 1; };
  var bar = document.querySelector('.mtg-phasebar');
  var steps = document.querySelector('.mtg-phasebar__steps');
  var badge = document.querySelector('.mtg-turnstops__label');
  var toggle = document.querySelector('.mtg-phasebar__beats');
  var strip = document.querySelector('.mtg-toolbar');
  var near = document.querySelector(".mtg-board__side[data-seat='you']");
  var field = near === null ? null : near.querySelector(".mtg-zone:not([data-tone='rail'])");
  var hand = near === null ? null : near.querySelector(".mtg-zone[data-tone='rail']");
  var report = {
    viewport: [window.innerWidth, window.innerHeight],
    strip: strip === null ? null : box(strip),
    bar: bar === null ? null : box(bar),
    // The placement claim, as three boxes on one axis: the bar's top edge is the
    // near battlefield's bottom edge and its bottom edge is the hand's top, give
    // or take the band's own gap. \`mtg-rgc.6\`.
    nearField: field === null ? null : box(field),
    nearHand: hand === null ? null : box(hand),
    inNearBand: bar !== null && near !== null && near.contains(bar),
    steps: steps === null ? null : {
      box: box(steps),
      scrollWidth: steps.scrollWidth,
      clientWidth: steps.clientWidth,
      sidewaysScroll: steps.scrollWidth - steps.clientWidth
    },
    badge: badge === null ? null : { box: box(badge), text: badge.textContent, truncated: clipped(badge) },
    toggle: toggle === null ? null : box(toggle),
    nodes: [],
    truncated: [],
    pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  };
  var nodes = document.querySelectorAll('.mtg-phasebar__node');
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    var label = node.querySelector('.mtg-phasebar__text');
    var cut = label !== null && clipped(label);
    report.nodes.push({
      step: node.getAttribute('data-step'),
      text: label === null ? null : label.textContent,
      box: box(node),
      rows: node.querySelectorAll('.mtg-phasebar__pip').length,
      beat: node.getAttribute('data-beat') === 'true',
      truncated: cut
    });
    if (cut) report.truncated.push(node.getAttribute('data-step'));
  }
  return report;
};
`;

function page(markup: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>step-bar</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
const file = join(out, 'step-bar.html');
writeFileSync(file, page(table()), 'utf8');
console.log(`wrote ${file}`);
