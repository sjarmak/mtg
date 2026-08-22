/**
 * Where the ask sits and where the history sits, as static HTML a browser can
 * measure.
 *
 * `mtg-rgc.4`. Magic Online splits its two rails by purpose: the left column
 * carries the current ask in plain language between the two player pods, and the
 * right column is the chat and the game log and nothing else. Ours stacked the
 * priority prompt, the stack and both graveyards into one right rail with the log
 * sharing that column, so under a crowded board the parts competed for a height
 * none of them could give up.
 *
 * The claim is geometry and jsdom lays nothing out — `getBoundingClientRect` is
 * all zeros there, so no test in this checkout can say whether the prompt is
 * legible in the pod gap or whether the log stopped being squeezed. This is where
 * it is said instead. `tools/seat-pod.ts` is the same arrangement asking about
 * the block the prompt now sits under, and this file copies its page, its
 * overlap rule and its two permanent counts outright.
 *
 * The measure deliberately finds the prompt through its own class rather than
 * through whichever column it is in, so one page script reads a before and an
 * after and the two numbers are taken the same way.
 *
 * **The log is opened by injection rather than by a click**, which is the one
 * substitution here and the same one `tools/turn-stops-panel.ts` makes for the
 * same reason: whether the log is open is React state nothing outside the
 * component can set, and a static page has no handler to click. The injected
 * panel carries the real narrated lines — `../src/log/group.ts`'s `buildLog` over
 * the same events the page rendered — under the class names `../src/styles/board/log.ts`
 * styles, so what is measured is the shipped sheet against real content. What the
 * page does not exercise is the click itself.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/rail-split.ts out/rail-split
 *
 * Then point a browser at `rail-split-<n>.html` at each viewport and call
 * `window.mtgRailSplit()`, `window.mtgOpenLog()` and `window.mtgRailSplit()`
 * again.
 *
 * What it answers: the box of each rail, the box of the prompt and which column
 * holds it, every card slot's box per seat, how many log lines are inside the
 * open panel, and every overlap between anything in one column and anything the
 * other two draw. The acceptance evidence is `overlaps: []` at all three
 * viewports and both counts, a prompt whose column is `pods`, and more log lines
 * visible after than before.
 *
 * It also answers two questions about the ask itself, and both were added
 * because the file's first answer to them was wrong. `cutLabels` counts text
 * painted outside the box it lives in as well as text that clipped itself, which
 * is `mtg-6i4`: the old check asked only the second question and reported clean
 * while 28 of 28 move labels hung out over the board. `fold` is how much of the
 * enumeration is on screen and how much is under it, which is `mtg-46g`.
 * Neither number is an assertion here — this file measures and prints, and the
 * numbers are argued where the rules are, in `../src/styles/views.ts` and
 * `../src/styles/board/rail.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, Fragment } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { choose, DEFAULT_AUTO_PASS, humanSeat, passIndex, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { buildLog } from '../src/log/group';
import type { LogLine, LogStep, LogTurn } from '../src/log/group';
import { GAME_LOG_LABEL } from '../src/log/GameLog';
import { PlayView } from '../src/routes/play/PlayView';
import { ownedName } from '../src/routes/play/naming';
import { nameOf } from '../src/routes/play/position';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * How many permanents a side each page draws: `tools/seat-pod.ts`'s two counts,
 * because the question is the same one one column over. Four is what a played
 * game was measured reaching and twelve is the crowded case, where the lanes are
 * already width-bound and a fixed column taken off them is at its most expensive.
 */
export const RAIL_SPLIT_COUNTS: readonly number[] = [4, 12];

/**
 * How many decisions the page spends before it is drawn, and where it stops.
 *
 * The log is the block whose share of the rail this bead is about, and a log of
 * four lines cannot be squeezed by anything. `scenario` emits no events at all —
 * it builds a position rather than reaching one — so a page drawn straight off it
 * has an empty log and the visible-line count would be a reading about the
 * content rather than about the box. 120 rounds of the kernel's own pass reaches
 * about 88 story lines over 35 turns, which is the same size of log
 * `../src/styles/board/log.ts` took its scroll measurements against.
 *
 * The pass is chosen wherever the kernel put it and the first option is taken
 * when a decision has no pass in it, which is the declaration of no attackers and
 * the discard. Nothing attacks and nothing is cast, so the board the page draws
 * is still the board that was dealt: both counts come out exactly as many
 * permanents a side as they were given.
 *
 * The run then continues to the next priority, so both counts are measured
 * against the same kind of prompt and the option count differs because of the
 * board rather than because of where each page happened to stop.
 */
const LOG_ROUNDS = 120;

/** A bound on that continuation, so a game that never offers one still writes a page. */
const PARK_LIMIT = 60;

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'rail-split');
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

/** A position with `count` permanents a side and a seven-land mana base under each. */
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
    seed: `tools/rail-split/${String(count)}`,
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
 * The same position after `LOG_ROUNDS` rounds, parked at a priority, so the log
 * holds a real stream and both counts are asked the same question.
 */
function playedSession(count: number): GameSession {
  let session = dealtSession(count);
  for (let spent = 0; spent < LOG_ROUNDS; spent += 1) {
    const decision = session.pending;
    if (decision === null) return session;
    session = choose(session, passIndex(decision) ?? 0, { autoPass: DEFAULT_AUTO_PASS });
  }
  for (let spent = 0; spent < PARK_LIMIT; spent += 1) {
    const decision = session.pending;
    if (decision === null || decision.kind === 'priority') return session;
    session = choose(session, passIndex(decision) ?? 0, { autoPass: DEFAULT_AUTO_PASS });
  }
  return session;
}

/**
 * The open log's panel and foot, built to the class names `../src/log/GameLog.ts`
 * renders and filled with that file's own narrated lines.
 *
 * Restating the wrapper elements is the cost of injection and is why this lives
 * beside the page rather than inside a test: the content is real (`buildLog` over
 * the page's own events) and the sheet is the shipped one, and what is duplicated
 * is four nested lists that the sheet is keyed on.
 */
function logPanelMarkup(session: GameSession): string {
  const turns = buildLog({
    events: session.events,
    names: {
      player: (id: PlayerId): string => ['You', 'Bot'][id] ?? String(id),
      card: (oid: string): string => nameOf(session.state, oid),
      target: (oid: string): string => ownedName(session.state, ['You', 'Bot'], oid),
    },
    viewer: 0,
    density: 'story',
  });
  const lineNode = (line: LogLine): ReactElement =>
    h(
      'li',
      { key: line.key, className: 'mtg-log__line', 'data-role': line.role },
      h('span', { className: 'mtg-log__num' }, String(line.index + 1)),
      h('span', { className: 'mtg-log__text' }, line.text),
    );
  const stepNode = (step: LogStep): ReactElement =>
    h(
      'li',
      { key: step.key, className: 'mtg-log__step' },
      h('h4', { className: 'mtg-log__step-title' }, step.title),
      h('ol', { className: 'mtg-log__lines' }, ...step.lines.map(lineNode)),
    );
  const turnNode = (turn: LogTurn): ReactElement =>
    h(
      'li',
      { key: turn.key, className: 'mtg-log__turn' },
      h(
        'h3',
        { className: 'mtg-log__turn-title' },
        h('span', { className: 'mtg-log__turn-no' }, turn.title),
        turn.owner === null ? null : h('span', { className: 'mtg-log__turn-owner' }, turn.owner),
      ),
      h('ol', { className: 'mtg-log__steps' }, ...turn.steps.map(stepNode)),
    );
  return renderToStaticMarkup(
    h(
      Fragment,
      null,
      h(
        'div',
        { className: 'mtg-log__panel', role: 'region', 'aria-label': GAME_LOG_LABEL, tabIndex: 0 },
        h('ol', { className: 'mtg-log__turns' }, ...turns.map(turnNode)),
      ),
      h(
        'div',
        { className: 'mtg-log__foot' },
        h(
          'div',
          { className: 'mtg-log__levels', role: 'group', 'aria-label': 'How much of the log to show' },
          h('button', { type: 'button', className: 'mtg-btn mtg-log__density' }, 'Story'),
          h('button', { type: 'button', className: 'mtg-btn mtg-log__density' }, 'Detail'),
          h('button', { type: 'button', className: 'mtg-btn mtg-log__density' }, 'Every event'),
        ),
        h('span', { className: 'mtg-log__hidden' }, 'nothing hidden'),
      ),
    ),
  );
}

/**
 * What a browser reads off the page.
 *
 * Overlap is computed against everything the other two columns draw rather than
 * against a column's own rectangle, for `tools/seat-pod.ts`'s reason: a prompt
 * inside the mat and on top of a card is still a prompt drawn over the board. Two
 * boxes count as overlapping when they share more than half a square pixel, which
 * is a real intersection rather than two neighbors rounding into each other.
 *
 * **Every rect is clipped to its scrollers first, and that is not a refinement.**
 * A crowded row scrolls sideways (`../src/styles/board/fit.ts`), and
 * `getBoundingClientRect` reports where a card *would* be rather than where it is
 * painted, so the twelfth permanent in a row reports a box out in the rail's
 * column. Unclipped, the baseline page reported 24 overlaps at 1024x768 and every
 * one of them was a card the browser had already clipped. Clipping to each
 * ancestor's own padding box is what makes the count a statement about paint.
 */
const MEASURE = `
window.mtgOpenLog = function () {
  var host = document.querySelector('.mtg-log');
  if (host === null) return false;
  if (host.querySelector('.mtg-log__panel') !== null) return true;
  host.insertAdjacentHTML('beforeend', window.MTG_RAIL_LOG);
  host.setAttribute('data-open', 'true');
  return true;
};
window.mtgCloseLog = function () {
  var host = document.querySelector('.mtg-log');
  if (host === null) return false;
  var panel = host.querySelector('.mtg-log__panel');
  if (panel !== null) panel.remove();
  var foot = host.querySelector('.mtg-log__foot');
  if (foot !== null) foot.remove();
  host.setAttribute('data-open', 'false');
  return true;
};
window.mtgRailSplit = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var box = function (node) {
    if (node === null || node === undefined) return null;
    var rect = node.getBoundingClientRect();
    return { x: round(rect.left), y: round(rect.top), w: round(rect.width), h: round(rect.height) };
  };
  var area = function (a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  // Where a node is actually painted: its own rect, cut down by every ancestor
  // that clips. A card scrolled out of a row reports a rect out in the next
  // column, and the browser is not drawing it there.
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
    return { left: left, top: top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
  };
  var describe = function (node) {
    return node.className + (node.getAttribute('aria-label') === null ? '' : ' [' + node.getAttribute('aria-label') + ']');
  };
  // Text wider than the box it is painted in. The ask column is narrower than
  // the rail the prompt came out of, so whether a move is still readable in it
  // is a measurement rather than an opinion.
  //
  // **Two things cut text and only one of them is the element's own doing.**
  // This asked each node whether it had clipped itself — scrollWidth >
  // clientWidth, which is what an ellipsis or a hidden overflow produces —
  // and reported 0 at all three viewports while 28 of 28 move labels were being
  // sliced mid-word (mtg-6i4). Those labels did not clip themselves. They laid
  // out at a flat 150px, because a grid track minimum is a floor a grid item
  // never shrinks below, and the *column* clipped them: 48.3px out over the
  // board at 1024x768 and 15.1px at 1280x800. A check that can only see the
  // first mechanism is a check that reports clean while the second one is
  // happening, so both are counted and named apart. outside is the node's own
  // box against the box it is actually painted in, which is painted's walk up
  // the clipping ancestors read for its *difference* rather than for its
  // intersection.
  var cut = function (selector) {
    var found = document.querySelectorAll(selector);
    var reading = { nodes: found.length, outside: 0, worst: 0, selfClipped: 0 };
    for (var c = 0; c < found.length; c += 1) {
      var rect = found[c].getBoundingClientRect();
      var shown = painted(found[c]);
      var over = Math.max(rect.right - shown.right, shown.left - rect.left);
      if (over > 0.5) {
        reading.outside += 1;
        if (over > reading.worst) reading.worst = round(over);
      }
      if (found[c].scrollWidth > found[c].clientWidth + 0.5) reading.selfClipped += 1;
    }
    return reading;
  };
  // How much of the move list is on screen, and how much of it is under the
  // fold. The panel body is an internal scroller, so nothing here is
  // unreachable; what the numbers answer is how much of the enumeration a
  // player is looking at (mtg-46g). A move counts as shown when every pixel of
  // it is inside the body's own box — half a button is not a button.
  var fold = function () {
    var body = document.querySelector('.mtg-prompt .mtg-panel__body');
    if (body === null) return null;
    var frame = body.getBoundingClientRect();
    var inside = function (node) {
      var r = node.getBoundingClientRect();
      return r.top >= frame.top - 0.5 && r.bottom <= frame.bottom + 0.5;
    };
    var moves = document.querySelectorAll('.mtg-choice');
    var shown = 0;
    for (var m = 0; m < moves.length; m += 1) if (inside(moves[m])) shown += 1;
    var titles = document.querySelectorAll('.mtg-choices__group-title');
    var named = [];
    for (var t = 0; t < titles.length; t += 1) if (inside(titles[t])) named.push(titles[t].textContent);
    return {
      body: round(frame.height),
      content: round(body.scrollHeight),
      hidden: round(body.scrollHeight - body.clientHeight),
      scrollbar: round(body.offsetWidth - body.clientWidth),
      moves: moves.length,
      movesShown: shown,
      groupsShown: named,
      sharedLines: document.querySelectorAll('.mtg-choices__shared').length
    };
  };
  var prompt = document.querySelector('.mtg-prompt');
  var column = null;
  if (prompt !== null) {
    column = prompt.closest('.mtg-board__pods') !== null ? 'pods'
      : prompt.closest('.mtg-board__rail') !== null ? 'rail' : 'elsewhere';
  }
  var seats = {};
  var sides = document.querySelectorAll('.mtg-board__side');
  for (var s = 0; s < sides.length; s += 1) {
    var seat = sides[s].getAttribute('data-seat');
    var slots = sides[s].querySelectorAll(".mtg-slot[data-slot='play']");
    var boxes = [];
    var painted_slots = 0;
    for (var f = 0; f < slots.length; f += 1) {
      if (slots[f].parentElement !== null && slots[f].parentElement.classList.contains('mtg-lands')) continue;
      boxes.push(box(slots[f]));
      var p = painted(slots[f]);
      if (p.right - p.left > 0.5 && p.bottom - p.top > 0.5) painted_slots += 1;
    }
    var widths = boxes.map(function (b) { return b.w; });
    var heights = boxes.map(function (b) { return b.h; });
    seats[seat] = {
      side: box(sides[s]),
      battlefield: box(sides[s].querySelector(".mtg-zone[aria-label$='battlefield']")),
      slots: boxes.length,
      slotsPainted: painted_slots,
      slotWidth: boxes.length === 0 ? null
        : { min: Math.min.apply(null, widths), max: Math.max.apply(null, widths) },
      slotHeight: boxes.length === 0 ? null
        : { min: Math.min.apply(null, heights), max: Math.max.apply(null, heights) },
      slotBoxes: boxes
    };
  }
  var log = document.querySelector('.mtg-log');
  var panel = log === null ? null : log.querySelector('.mtg-log__panel');
  var visibleLines = 0;
  if (panel !== null) {
    var lines = panel.querySelectorAll('.mtg-log__line');
    for (var l = 0; l < lines.length; l += 1) {
      // A line counts as read when every pixel of it survives the panel's own
      // scroll *and* the rail block's clip. Half a line is not a line, and the
      // block is the thing this bead moves room into.
      var lineRect = lines[l].getBoundingClientRect();
      var shown = painted(lines[l]);
      if (shown.bottom - shown.top >= lineRect.height - 0.5 && lineRect.height > 0) visibleLines += 1;
    }
  }
  // Every drawn thing in each of the three columns, so an overlap is reported
  // whichever column produced it.
  var groups = [
    { name: 'pods', nodes: document.querySelectorAll('.mtg-board__pods > *') },
    { name: 'lanes', nodes: document.querySelectorAll('.mtg-board__lanes .mtg-zone, .mtg-board__lanes .mtg-slot') },
    { name: 'rail', nodes: document.querySelectorAll('.mtg-board__rail > *') }
  ];
  var overlaps = [];
  for (var g = 0; g < groups.length; g += 1) {
    for (var o = g + 1; o < groups.length; o += 1) {
      for (var i = 0; i < groups[g].nodes.length; i += 1) {
        for (var j = 0; j < groups[o].nodes.length; j += 1) {
          var one = groups[g].nodes[i];
          var two = groups[o].nodes[j];
          if (one.contains(two) || two.contains(one)) continue;
          var shared = area(painted(one), painted(two));
          if (shared > 0.5) {
            overlaps.push({ a: groups[g].name + ' ' + describe(one), b: groups[o].name + ' ' + describe(two), area: round(shared) });
          }
        }
      }
    }
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    mat: box(document.querySelector('.mtg-board')),
    leftRail: box(document.querySelector('.mtg-board__pods')),
    lanes: box(document.querySelector('.mtg-board__lanes')),
    rightRail: box(document.querySelector('.mtg-board__rail')),
    prompt: { column: column, box: box(prompt), head: box(document.querySelector('.mtg-prompt .mtg-panel__head')), body: box(document.querySelector('.mtg-prompt .mtg-panel__body')), choices: document.querySelectorAll('.mtg-choice').length, cutLabels: cut('.mtg-choice__label'), cutGroupTitles: cut('.mtg-choices__group-title'), cutPodNames: cut('.mtg-pod__name, .mtg-pod__chip-label'), fold: fold() },
    stack: box(document.querySelector(".mtg-zone[aria-label='Stack']")),
    log: { open: log === null ? null : log.getAttribute('data-open'), box: box(log), panel: box(panel), visibleLines: visibleLines, lines: panel === null ? 0 : panel.querySelectorAll('.mtg-log__line').length },
    graveyards: [].slice.call(document.querySelectorAll(".mtg-browser[aria-label$='graveyard']")).map(box),
    seats: seats,
    overlaps: overlaps,
    pageOverflow: {
      x: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      y: round(document.documentElement.scrollHeight - document.documentElement.clientHeight)
    }
  };
};
`;

function page(count: number): string {
  const session = playedSession(count);
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const title = `Rail split, ${String(count)} permanents a side`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>window.MTG_RAIL_LOG = ${JSON.stringify(logPanelMarkup(session))};
${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const count of RAIL_SPLIT_COUNTS) {
  const file = join(out, `rail-split-${String(count)}.html`);
  writeFileSync(file, page(count), 'utf8');
  console.log(`wrote ${file}`);
}
