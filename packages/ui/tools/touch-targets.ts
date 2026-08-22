/**
 * Every control on the played table, measured, and what a tap at its center hits.
 *
 * `mtg-yg8`. the playtester wants to play this on an iPad, and the surface has one
 * input model: a pointer. Two of the four things that friction audit found are
 * geometry — a control smaller than Apple's 44pt minimum, and a hit test at a
 * control's own center landing on something else — and jsdom lays nothing out, so
 * `getBoundingClientRect` is all zeros in every test in this checkout. This is
 * where those two are said instead, the way `tools/rail-split.ts`,
 * `tools/cast-panel.ts` and `tools/hand-scale.ts` say theirs.
 *
 * It writes two pages, because one of the surfaces the audit is about is only
 * drawn while a card's menu is open:
 *
 *  - `touch-targets-table.html` — the whole shipped `PlayView` at a parked
 *    priority, which is the state a player spends a game in.
 *  - `touch-targets-menu.html` — the same table with one card's picker forced
 *    open, `tools/cast-panel.ts`'s own substitution: a picker is React state
 *    nothing outside the component can set, and a static page has no handler to
 *    click, so `playTable` is handed a `selection` whose `pickerFor` returns the
 *    real `pickerPanel` over the real enumeration.
 *
 * What a browser reads off either one: every focusable control, its box, whether
 * both axes clear `TOUCH_TARGET_PX`, and `elementFromPoint` at its own center —
 * `self` when the point lands on the control or inside it, and the offending
 * element's description when it does not. Grouped by class so the report is a
 * table of surfaces rather than three hundred rows.
 *
 * It also reports what the media queries the touch sheet is gated on say about
 * the emulated device, which is the one thing about this rig worth distrusting:
 * `(pointer: coarse)` under Chrome's touch emulation is not WebKit on an iPad,
 * and only the device settles whether the sheet applies there at all.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser. Run it, then drive the pages over CDP at each viewport:
 *
 *     npx tsx packages/ui/tools/touch-targets.ts out/touch-targets
 *
 * and call `window.mtgTouchTargets()` at 1440x900, 1280x800, 1024x768 (which is
 * also the iPad in landscape) and 810x1080 (the iPad in portrait), with and
 * without a touch-capable device metrics override.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, Fragment } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { GameLog } from '../src/log/GameLog';
import { pickerPanel } from '../src/routes/play/picker';
import { PlayView } from '../src/routes/play/PlayView';
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
import { TOUCH_TARGET_PX } from '../src/styles/touch';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'touch-targets');

const NAMES: SeatNames = ['You', 'Bot'];
const MOUNTAIN = exampleCard('slc-mountain');
const RAIDER = exampleCard('slc-emberflow-raider');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');

/**
 * A board with something on it and a hand worth playing from.
 *
 * Four permanents a side, which is what `tools/rail-split.ts` measured a played
 * game reaching, plus a mana base — the prompt is a real list of moves rather
 * than a pass and a concession, so the option row this bead is about has options
 * in it.
 */
function skirmish(): GameState {
  const lands: readonly {
    readonly card: DslCard;
    readonly controller: PlayerId;
    readonly tapped?: boolean;
  }[] = [
    { card: MOUNTAIN, controller: 0 },
    { card: MOUNTAIN, controller: 0 },
    { card: MOUNTAIN, controller: 0, tapped: true },
    { card: MOUNTAIN, controller: 1 },
    { card: MOUNTAIN, controller: 1 },
  ];
  return scenario({
    seed: 'tools/touch-targets',
    battlefield: [
      ...lands,
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: GUARDIAN, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
      { card: RAIDER, controller: 1, summoningSick: false },
    ],
    hands: [
      [MOUNTAIN, RAIDER, LASH, GUARDIAN, DRAKE],
      [MOUNTAIN, RAIDER],
    ],
    active: 0,
    turn: 4,
  }).state;
}

function seated(state: GameState): GameSession {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending: decision,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** The card whose menu the second page forces open: a spell with several aims. */
function lashOid(state: GameState): ObjectId {
  const found = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === 'Lightning Lash');
  if (found === undefined) throw new Error('the scenario put no Lightning Lash in hand');
  return found;
}

/** The shipped view, whole, which is what a player is looking at. */
function tablePage(): string {
  const session = seated(skirmish());
  return renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session,
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
}

/**
 * The same table with one card's picker standing open.
 *
 * `tools/cast-panel.ts`'s arrangement and its reason: the panel is real
 * (`pickerPanel` over the real enumeration) and the sheet is the shipped one, and
 * what is substituted is the click that would have opened it.
 */
function menuPage(): string {
  const state = skirmish();
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  const oid = lashOid(state);
  const prompt = buildPrompt(state, decision, NAMES);
  const byObject = choicesByObject(prompt);
  const mine = byObject.get(oid) ?? [];
  if (mine.length === 0) throw new Error('the scenario offers no move on the card the menu is opened over');
  const panel = pickerPanel('Lightning Lash', mine, () => undefined);
  const rendered = playTable({
    // A rig owns no session, so nothing is being declared and nothing can be
    // staged (`../src/routes/play/combat.ts`).
    staging: NO_STAGING,
    combat: null,
    position: boardPosition(state, 0, NAMES, null),
    playable: new Set(state.players[0].hand),
    byObject,
    selection: {
      openKey: oid,
      select: () => undefined,
      activate: () => undefined,
      openMenu: () => undefined,
      dismiss: () => undefined,
      pickerFor: (key: string): ReactNode => (key === oid ? panel : null),
      declaration: null,
      ordering: null,
      targeting: null,
    },
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
    // The disclosure head is a touch target, and since `mtg-rgc.13` it is on the
    // bar rather than on the strip, so it is measured where it is drawn.
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
      names: { player: (id: PlayerId): string => NAMES[id], card: () => '', target: () => '' },
      viewer: 0,
    }),
    // The side panel is collapsible since `mtg-crw`; every page here draws it
    // open, which is the state these rigs have always measured.
    railHead: railToggle({ collapsed: false, toggle: () => undefined }),
    railCollapsed: false,
    onResolve: null,
  });
  return renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-play' },
        // No dealer, no strip (`mtg-rgc.13`).
        playToolbar(null),
        h('div', { className: 'mtg-play__table' }, rendered),
      ),
    }),
  );
}

/**
 * What a browser reads off either page.
 *
 * A control is anything the tab order or a pointer can reach, found by role
 * rather than by class, so a surface nobody thought to list is still measured.
 * `under` is the count in that group failing `TOUCH_TARGET_PX` on either axis,
 * and `misses` is the count whose own center hit-tests to something outside it —
 * the audit's second geometric finding, and the one a size increase can create
 * as easily as it cures.
 *
 * Boxes are rounded to a tenth. Zero-area controls are reported as `hidden`
 * rather than counted short: a control the sheet has not drawn is not a control
 * with a small target.
 */
const MEASURE = `
window.mtgTouchTargets = function () {
  var MIN = ${String(TOUCH_TARGET_PX)};
  var round = function (v) { return Math.round(v * 10) / 10; };
  var describe = function (node) {
    if (node === null || node === undefined) return 'nothing';
    var label = node.getAttribute === undefined ? null : node.getAttribute('aria-label');
    return node.tagName.toLowerCase() + '.' + String(node.className || '(none)').split(' ').join('.') +
      (label === null ? '' : ' [' + label + ']');
  };
  var groupOf = function (node) {
    var classes = String(node.className || '').split(' ');
    for (var i = 0; i < classes.length; i += 1) {
      if (classes[i].indexOf('mtg-') === 0) return classes[i];
    }
    return node.tagName.toLowerCase();
  };
  // Where a control is actually painted: its own rect, cut down by every
  // ancestor that clips. \`tools/rail-split.ts\` needed the same function for the
  // same reason and its docblock argues it: a control scrolled out of a panel
  // reports a rect the browser is not drawing, and a hit test at that rect's
  // center is a statement about the thing behind it rather than about the
  // control.
  var painted = function (node) {
    var rect = node.getBoundingClientRect();
    var left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    var parent = node.parentElement;
    while (parent !== null && parent !== document.documentElement) {
      var style = window.getComputedStyle(parent);
      if (style.overflow !== 'visible' || style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        var clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left); top = Math.max(top, clip.top);
        right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
      }
      parent = parent.parentElement;
    }
    left = Math.max(left, 0); top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight);
    return { left: left, top: top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
  };
  var found = document.querySelectorAll(
    'button, [role="button"], a[href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  var groups = {};
  var short = [];
  var misses = [];
  var cutOff = [];
  var hidden = 0;
  for (var i = 0; i < found.length; i += 1) {
    var node = found[i];
    var rect = node.getBoundingClientRect();
    var w = round(rect.width);
    var h = round(rect.height);
    if (w < 0.5 || h < 0.5) { hidden += 1; continue; }
    var key = groupOf(node);
    if (groups[key] === undefined) {
      groups[key] = { count: 0, whole: 0, minW: w, minH: h, maxW: w, maxH: h, under: 0, misses: 0, cut: 0 };
    }
    var g = groups[key];
    g.count += 1;
    if (w < g.minW) g.minW = w;
    if (h < g.minH) g.minH = h;
    if (w > g.maxW) g.maxW = w;
    if (h > g.maxH) g.maxH = h;
    if (w + 0.5 < MIN || h + 0.5 < MIN) {
      g.under += 1;
      if (short.length < 8) short.push({ group: key, w: w, h: h, what: describe(node) });
    }
    // A control the page has cut in half is a control whose label is cut in
    // half, whatever its own box says. Reported apart from the hit test,
    // because one is about reading it and the other is about pressing it.
    var shown = painted(node);
    var wholly = shown.right - shown.left >= rect.width - 0.5 && shown.bottom - shown.top >= rect.height - 0.5;
    if (wholly) g.whole += 1;
    else {
      g.cut += 1;
      if (cutOff.length < 8) {
        cutOff.push({
          group: key, of: [w, h],
          painted: [round(shown.right - shown.left), round(shown.bottom - shown.top)],
          what: describe(node)
        });
      }
    }
    // The hit test is asked of the painted center rather than the laid-out one,
    // so a clipped control is asked about the part of it a finger can reach.
    var cx = (shown.left + shown.right) / 2;
    var cy = (shown.top + shown.bottom) / 2;
    if (shown.right - shown.left < 0.5 || shown.bottom - shown.top < 0.5) continue;
    var at = document.elementFromPoint(cx, cy);
    if (at === null || !(at === node || node.contains(at))) {
      g.misses += 1;
      if (misses.length < 8) misses.push({ group: key, at: [round(cx), round(cy)], hit: describe(at), what: describe(node) });
    }
  }
  var query = function (text) {
    return window.matchMedia === undefined ? null : window.matchMedia(text).matches;
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    media: {
      pointerCoarse: query('(pointer: coarse)'),
      pointerFine: query('(pointer: fine)'),
      hoverNone: query('(hover: none)'),
      anyPointerCoarse: query('(any-pointer: coarse)')
    },
    maxTouchPoints: navigator.maxTouchPoints,
    controls: found.length,
    hidden: hidden,
    groups: groups,
    short: short,
    misses: misses,
    cutOff: cutOff,
    pageOverflow: {
      x: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      y: round(document.documentElement.scrollHeight - document.documentElement.clientHeight)
    }
  };
};
`;

function page(title: string, markup: string): string {
  // The viewport meta is `../index.html`'s own, and leaving it off is not a
  // cosmetic difference: without it a mobile browser lays the page out at its
  // default 980px and scales the result, so a page measured under a touch device
  // override reported a 1307px-tall viewport for a 1080px window and every
  // height read off it was a statement about a page nobody will load.
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const [name, built] of [
  ['table', page('Touch targets, parked at a priority', tablePage())],
  ['menu', page("Touch targets, one card's menu open", menuPage())],
] as const) {
  const file = join(out, `touch-targets-${name}.html`);
  writeFileSync(file, built, 'utf8');
  console.log(`wrote ${file}`);
}
