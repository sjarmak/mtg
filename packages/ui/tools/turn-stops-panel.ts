/**
 * What the open stops panel covers, as a page a browser can measure.
 *
 * `mtg-5jl` is two claims. The first is that the panel has no reachable way out,
 * and `test/play/panel-input.test.ts` holds that in jsdom. The second is
 * geometric — "covers the opponent's life total, hand/library/graveyard counts
 * and first permanent slot" — and jsdom performs no layout, so
 * `getBoundingClientRect` is all zeros there and the claim cannot be checked at
 * all. This is that measurement, in the arrangement `cast-panel.ts` and
 * `board-crowding.ts` already use: render the shipped markup to a static page,
 * inject a measurement function, read the boxes over CDP.
 *
 * **The panel is opened by injection rather than by a click**, which is the one
 * substitution here. Whether it is open is React state nothing outside the
 * component can set, and a static page has no React to click. So the page ships
 * `turnStopsPanel`'s own markup as a string and `window.mtgOpenStops()` drops it
 * inside the real `.mtg-turnstops` element and sets `data-open`, which is
 * exactly what the component does; the class names, the sheet and the anchor are
 * the shipped ones, and the panel's position comes from `styles/views.ts` rather
 * than from anything written here. Closing removes it again, which is what a
 * dismissal leaves behind, so one page answers both halves of the before and
 * after.
 *
 * Measured in chrome-headless-shell 151.0.7922.47 on 2026-08-13, at 1440x900,
 * 1280x800 and 1024x768. The panel is 416x269 at (16, 85) at all three, and open
 * it covers 14,796 square pixels of the opponent's status row — the left 411 of
 * its 1,118 pixels at the widest viewport, which is the seat name, the life
 * total and all three zone counts — plus four card slots. Dismissed, every one
 * of those numbers is zero. The bead's geometric claim is exact, and the fix is
 * not that the panel moved: it is that a player can now make it go away.
 *
 * **Those numbers are for the old anchor.** `mtg-rgc.13` moved the head off the
 * strip and onto the step bar, so the panel now hangs between the viewer's own
 * battlefield and their own hand and opens upward; what it covers there is
 * `../test/play/stops-panel.browser.test.ts`, which measures both directions on
 * one page and fails on the one that buries the hand. This tool still reports the
 * opponent's status row and the slots, which is what `mtg-5jl` was about, and it
 * now reports the near band's two zones beside them.
 *
 * Node-only, like the two tools it copies: it writes files and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/turn-stops-panel.ts out/verify
 *
 * Then load the page in chrome-headless-shell over CDP and call
 * `window.mtgTurnStops()` before and after `window.mtgOpenStops()`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { GameState } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, pendingDecision, scenario } from '@mtg/kernel';
import { GameLog } from '../src/log/GameLog';
import { Shell } from '../src/app/Shell';
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
import { turnStopsPanel } from '../src/routes/play/TurnStops';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');

const NAMES: SeatNames = ['You', 'Bot'];
const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/**
 * A board on both sides, because the panel can only cover what is drawn.
 *
 * The far seat holds two permanents so its first slot is a card rather than an
 * empty placeholder, which is the thing the bead names.
 */
function skirmish(): GameState {
  return scenario({
    seed: 'tools/turn-stops-panel',
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

/** `PlayView`'s body, composed from the same four seams that view composes. */
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
    // Two columns since `mtg-rgc.4`: the ask between the pods, the history in
    // the rail. `../src/styles/board/rail.ts` argues the split.
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
    // Under the near battlefield since `mtg-rgc.6`, and carrying the disclosure
    // since `mtg-rgc.13`. That is the whole reason this rig was re-run: the
    // panel's anchor moved from a strip above the table to a bar between the
    // near battlefield and the near hand, so what it covers is a different set
    // of boxes and the direction it opens is a decision rather than a default.
    steps: stepBar({
      step: state.turn.step,
      turnText: describeTurn(state, NAMES),
      stepText: describeStep(state, NAMES),
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      canYield: true,
      onYield: () => undefined,
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
  // Nothing dealt this game, so there is no strip: `playToolbar` draws one only
  // for a caller with a control to put on it (`mtg-rgc.13`).
  const toolbar = playToolbar(null);
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

/** The panel's own markup, from the component that draws it. */
function panelMarkup(): string {
  return renderToStaticMarkup(
    turnStopsPanel(
      {
        label: 'Turn 1: You',
        detail: 'main phase',
        settings: DEFAULT_AUTO_PASS,
        onChange: () => undefined,
        canYield: true,
        onYield: () => undefined,
      },
      () => undefined,
    ),
  );
}

/**
 * What a browser reads off the page: the panel's box, and every box it hides.
 *
 * Overlap in square pixels rather than a boolean, because "covers" is a matter
 * of degree and the fix is not that the panel moved — it is that a player can
 * make it go away. Before and after are therefore the same page with the panel
 * injected and removed, and the number that matters is that the second one is
 * zero everywhere.
 */
const MEASURE = `
window.mtgTurnStops = function () {
  var box = function (node) {
    var r = node.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  };
  var overlap = function (a, b) {
    var w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    var hgt = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return w > 0 && hgt > 0 ? w * hgt : 0;
  };
  var panel = document.querySelector('.mtg-turnstops__panel');
  var covers = function (node) {
    return node === null || panel === null ? 0 : overlap(box(panel), box(node));
  };
  var near = document.querySelector(".mtg-board__side[data-seat='you']");
  var nearField = near === null ? null : near.querySelector(".mtg-zone:not([data-tone='rail'])");
  var nearHand = near === null ? null : near.querySelector(".mtg-zone[data-tone='rail']");
  var bar = document.querySelector('.mtg-phasebar');
  var report = {
    viewport: [window.innerWidth, window.innerHeight],
    panel: panel === null ? null : box(panel),
    // Where the anchor is, since \`mtg-rgc.13\` moved it off the strip and onto
    // the bar between these two zones. The three numbers under it are the whole
    // of the direction decision: which of the near seat's own boxes pays while
    // the panel is open, and whether anything runs off the top of the window.
    bar: bar === null ? null : box(bar),
    nearField: nearField === null ? null : box(nearField),
    nearHand: nearHand === null ? null : box(nearHand),
    coveredNearField: covers(nearField),
    coveredNearHand: covers(nearHand),
    aboveViewport: panel === null ? 0 : Math.max(0, Math.round(-panel.getBoundingClientRect().top)),
    statusRows: [],
    coveredSlots: 0,
    coveredSlotArea: 0
  };
  var rows = document.querySelectorAll('.mtg-status');
  for (var i = 0; i < rows.length; i += 1) {
    var rowBox = box(rows[i]);
    report.statusRows.push({
      name: rows[i].getAttribute('aria-label'),
      box: rowBox,
      covered: panel === null ? 0 : overlap(box(panel), rowBox)
    });
  }
  var slots = document.querySelectorAll('.mtg-slot');
  for (var j = 0; j < slots.length; j += 1) {
    var hit = panel === null ? 0 : overlap(box(panel), box(slots[j]));
    if (hit > 0) { report.coveredSlots += 1; report.coveredSlotArea += hit; }
  }
  return report;
};
window.mtgOpenStops = function () {
  var host = document.querySelector('.mtg-turnstops');
  if (host === null) return false;
  if (host.querySelector('.mtg-turnstops__panel') !== null) return true;
  host.insertAdjacentHTML('beforeend', window.MTG_STOPS_PANEL);
  host.setAttribute('data-open', 'true');
  return true;
};
window.mtgCloseStops = function () {
  var panel = document.querySelector('.mtg-turnstops__panel');
  if (panel !== null) panel.remove();
  var host = document.querySelector('.mtg-turnstops');
  if (host !== null) host.setAttribute('data-open', 'false');
  return document.querySelector('.mtg-turnstops__panel') === null;
};
`;

function page(markup: string, panel: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>turn-stops</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>window.MTG_STOPS_PANEL = ${JSON.stringify(panel)};
${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
const file = join(out, 'turn-stops.html');
writeFileSync(file, page(table(), panelMarkup()), 'utf8');
console.log(`wrote ${file}`);
