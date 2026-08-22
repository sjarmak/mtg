/**
 * The played table with objects on the stack, as static HTML a browser can
 * measure.
 *
 * `mtg-bz2.4` moved the stack to the head of the side rail and put the priority
 * sentence in the row the fixed pass already owned, and both of those are claims
 * jsdom cannot check: it lays nothing out, so "the stack is above the log" and
 * "the pass did not move" are facts only a real engine holds. This writes the
 * real `Shell` around the real `PlayView` over a position with a two-object
 * stack, and hands the page a measuring function so the driver is a navigate and
 * one `Runtime.evaluate`.
 *
 * **Three things `mtg-crw` and `mtg-atq` changed about what it reads.** The
 * priority band is gone, so there is no row for a sentence and a button to share
 * a line in; the pass is a block at the foot of the ask column and what this asks
 * about it is which column it is in and whether it is on screen. The top stack
 * entry carries the move that resolves it, so the entry's own button is measured
 * — it is the control the playtester asked for and it has to clear a touch target. And
 * the side panel collapses, so `window.mtgShutPanel()` flips the mat's own
 * `data-rail` the way `rail-split.ts`'s `mtgOpenLog` injects a log: the state is
 * React's and a static page has no handler to click, and what the sheet does with
 * the attribute is the whole of what is being measured.
 *
 * The same arrangement `board-crowding.ts` and `face-census.ts` use, and
 * Node-only for the same reason: it writes files and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/priority-stack.ts out/priority-stack
 *
 * Then point a browser at `priority-stack.html` and call
 * `window.mtgPriorityStack()`.
 *
 * What it answers: the order and boxes of the rail's blocks; the tops of the
 * stack's own entries, so the object that resolves next can be shown to be drawn
 * first as well as listed first; and the priority row, so the sentence and the
 * pass can be shown to share one line with the pass still at the right-hand end
 * of the lanes column.
 *
 * **The stack is no longer one of those rail blocks** (`mtg-rgc.7`): it is a
 * strip on the seam between the two seats, so `railBlocks` is the disclosure and
 * the log, and where the strip sits and what it may cover is measured by
 * `../test/play/stack-seam.browser.test.ts` rather than here. The entry readings
 * below are unchanged, because they were never scoped to the rail.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, isLand } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { Action, GameSession, GameState, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'priority-stack');

const LANDS = EXAMPLE_SET.filter(isLand);
const SPELLS = EXAMPLE_SET.filter((card) => !isLand(card));

interface Placed {
  readonly card: DslCard;
  readonly controller: PlayerId;
}

function manaBase(count: number, controller: PlayerId): readonly Placed[] {
  return Array.from({ length: count }, (_unused, index) => {
    const card = LANDS[index % LANDS.length];
    if (card === undefined) throw new Error('the example set has no lands');
    return { card, controller };
  });
}

/** One of the example set's creatures, for the opposing board. */
function blocker(): Placed {
  const card = SPELLS.find((candidate) => candidate.kind === 'creature');
  if (card === undefined) throw new Error('the example set has no creature');
  return { card, controller: 1 };
}

/**
 * A position with two objects on the stack and the caster still holding
 * priority.
 *
 * Cast through `reduce` rather than stated, because `scenario` builds boards and
 * not stacks: a position with a fabricated stack would be one the kernel could
 * not have reached, which is the property `scenario`'s header exists to keep.
 */
function stackedSession(): GameSession {
  const built = scenario({
    seed: 'tools/priority-stack',
    battlefield: [...manaBase(8, 0), ...manaBase(6, 1), blocker()],
    hands: [SPELLS.slice(0, 6), SPELLS.slice(0, 4)],
    active: 0,
    turn: 5,
  });
  let state: GameState = built.state;
  for (let pushed = 0; pushed < 2; pushed += 1) {
    const cast = legalActions(state).find((action: Action) => action.type === 'castSpell');
    if (cast === undefined) break;
    state = reduce(state, cast).state;
  }
  if (state.stack.length === 0) throw new Error('the example set gave this position nothing to cast');
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
 * The rail's blocks are read as its direct element children in document order
 * with their tops, because "above" is the claim and a class list alone cannot
 * carry it: a column that reversed itself in CSS would produce the same markup
 * order and the opposite picture, which is exactly the defect this bead fixed in
 * the stack's own entries.
 */
const MEASURE = `
window.mtgShutPanel = function (shut) {
  var mat = document.querySelector("[data-mtg-mode='play'] .mtg-board");
  if (mat === null) return false;
  mat.setAttribute('data-rail', shut ? 'shut' : 'open');
  return true;
};
window.mtgPriorityStack = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var box = function (node) {
    if (node === null) return null;
    var rect = node.getBoundingClientRect();
    return { top: round(rect.top), left: round(rect.left), right: round(rect.right), bottom: round(rect.bottom), width: round(rect.width), height: round(rect.height) };
  };
  var scope = "[data-mtg-mode='play'] ";
  var rail = document.querySelector(scope + '.mtg-board__rail');
  var blocks = rail === null ? [] : [].slice.call(rail.children).map(function (child) {
    var rect = child.getBoundingClientRect();
    return { label: child.getAttribute('aria-label') || child.className, top: round(rect.top), height: round(rect.height) };
  });
  var entries = [].slice.call(document.querySelectorAll(scope + '.mtg-stack__entry')).map(function (entry) {
    return { order: entry.getAttribute('data-order'), top: entry.getBoundingClientRect().top, isTop: entry.getAttribute('data-top') === 'true' };
  });
  var foot = document.querySelector(scope + '.mtg-priority');
  var own = document.querySelector(scope + '.mtg-priority__own');
  var pass = document.querySelector(scope + '.mtg-play__pass');
  var resolve = document.querySelector(scope + '.mtg-stack__resolve');
  var toggle = document.querySelector(scope + '.mtg-rail__toggle');
  var mat = document.querySelector(scope + '.mtg-board');
  var hand = document.querySelector(scope + ".mtg-board__side[data-seat='you'] .mtg-zone[aria-label$='hand']");
  var column = function (node) {
    if (node === null) return null;
    return node.closest('.mtg-board__pods') !== null ? 'pods'
      : node.closest('.mtg-board__rail') !== null ? 'rail'
      : node.closest('.mtg-board__lanes') !== null ? 'lanes' : 'elsewhere';
  };
  var onScreen = function (node) {
    if (node === null) return null;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= -0.5 && r.left >= -0.5 &&
      r.bottom <= window.innerHeight + 0.5 && r.right <= window.innerWidth + 0.5;
  };
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    railState: mat === null ? null : mat.getAttribute('data-rail'),
    railBlocks: blocks,
    stackEntries: entries,
    // Markup order and paint order agree when the first entry in the document
    // is also the highest on screen; a reversed column would flip the second.
    topEntryIsFirstInDom: entries.length < 2 ? null : entries[0].isTop && entries[0].top < entries[1].top,
    foot: box(foot),
    // The clause that only exists while the top of the stack is the asked seat's
    // own, which is the one sentence the ask column above cannot give.
    own: box(own),
    pass: box(pass),
    // The pass is in the ask column since mtg-crw, and it has to be painted and
    // reachable there: a promise of a fixed home is a promise about the screen.
    passColumn: column(pass),
    passOnScreen: onScreen(pass),
    // The move on the object it is about (mtg-atq). One button, on the top entry
    // only, and it has to clear a finger.
    resolve: box(resolve),
    resolves: document.querySelectorAll(scope + '.mtg-stack__resolve').length,
    toggle: box(toggle),
    toggleExpanded: toggle === null ? null : toggle.getAttribute('aria-expanded'),
    toggleDisabled: toggle === null ? null : toggle.disabled === true,
    toggleOnScreen: onScreen(toggle),
    rail: box(rail),
    mat: box(mat),
    hand: box(hand),
    lanes: box(document.querySelector(scope + '.mtg-board__lanes')),
    pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 1,
  };
};
`;

function page(): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: stackedSession(),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        // The strip a player actually gets; `board-crowding.ts` says why all
        // three settings props are needed before the bar is drawn at all.
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Priority and the stack</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
const file = join(out, 'priority-stack.html');
writeFileSync(file, page(), 'utf8');
console.log(`wrote ${file}`);
