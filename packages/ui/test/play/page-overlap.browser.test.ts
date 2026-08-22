// @vitest-environment node
/**
 * Every word on the played table is painted somewhere no other word is, and
 * nowhere the page has hidden.
 *
 * `mtg-bc2.143`. `mtg-bc2.137` shipped with an overlap check that only looked at
 * card faces, and the defect it missed was in the side rail: at a crowded
 * blocker declaration the stack and both graveyards were squeezed to 9px against
 * 44px of content and painted their heads over each other. A check that only
 * looks where the author expected the bug is how that shipped, so this one looks
 * at the whole page and knows nothing about which element is which.
 *
 * The instrument, restated so it can be read without the bead:
 *
 *  1. Collect every element whose own text no element child carries. That is the
 *     ink: a `<div>` whose words all live in a `<span>` is the span's ink, not
 *     the div's, and counting both would report every nested label as an overlap
 *     with itself.
 *  2. Compute each one's **painted** rectangle by intersecting its client rect
 *     with every clipping ancestor's on the axis that ancestor clips, and then
 *     with the viewport. A client rect says where a box would be; the painted
 *     rect says where its ink actually lands, and the two differ by exactly the
 *     amount a scroller has taken away.
 *  3. Count pairs whose painted rectangles intersect and where neither contains
 *     the other. Containment is excluded because a badge drawn inside its own
 *     chip is a layout, not a collision.
 *  4. Count text cut off by an ancestor whose computed overflow is `hidden` or
 *     `clip` rather than `auto` or `scroll`. That is ink the page hides with no
 *     way to reach it, and it is the failure mode the rail's own docblock names:
 *     the per-block `overflow: hidden` that stopped the heads painting over each
 *     other converted the overlap into a silent truncation.
 *
 * The element's *own* clip is deliberately not counted. `styles/board/rail.ts`
 * ellipsizes the disclosure label on purpose, and an ellipsis is a legible
 * shortening rather than ink with no way to reach it. An ancestor cutting a
 * descendant is the defect; a box shortening its own line is a decision.
 *
 * **The instrument is proved able to fail.** A gate whose only evidence is a zero
 * is a gate nobody can tell from a broken selector, so the last position here is
 * a real page with two defects injected into it — one pair of overlapping labels
 * and one label cut off by a `overflow: hidden` ancestor — and the run fails if
 * the check does not find both. That control is why the zeros above are worth
 * reading.
 *
 * The harness is `../support/chrome.ts` and the reason it exists is the reason
 * this file could not be written before: jsdom performs no layout, so
 * `getBoundingClientRect` is zeros on everything and two boxes overlapping and
 * two boxes not overlapping are the same reading there.
 *
 * The neutral `@mtg/dsl` example set rather than the flagship fixture, so the
 * file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_CARDS, exampleCard, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  DEFAULT_AUTO_PASS,
  choose,
  createSession,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import type { GameSession, GameState } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [
  exampleCard('slc-plains'),
  exampleCard('slc-island'),
  exampleCard('slc-swamp'),
  exampleCard('slc-mountain'),
] as const;

let minted = 0;

/** A plain body, so a blocker roster is as long as it is asked to be. */
function creature(name: string): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `slc-overlap-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'SLC', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
  });
}

function sessionOn(state: GameState, events: GameSession['events']): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/** `perSide` permanents and five lands a side, every other one tapped. */
function board(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
    ...Array.from({ length: 5 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller,
      tapped: index % 3 === 0,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/page-overlap-${String(perSide)}`,
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1], SPELLS[2], LANDS[0], SPELLS[3], LANDS[1], SPELLS[0]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3], LANDS[3], SPELLS[0], SPELLS[1]],
    ],
    active: 0,
    turn: 7,
  });
  return sessionOn(built.state, built.events);
}

/**
 * The same board with an object on the stack.
 *
 * `mtg-rgc.7` moved the stack out of the rail and onto the seam between the two
 * seats, where it is drawn over the mat. Every position in this file had an
 * empty stack, and an empty stack draws no strip at all, so the whole of the
 * one element on this page that is deliberately out of flow was going
 * unmeasured here. `./stack-seam.browser.test.ts` asks whether it covers a click
 * target; this asks the question this file asks of everything else, which is
 * whether its words are drawn over anybody else's.
 *
 * Cast through the kernel's own enumeration rather than fabricated. When the
 * position offers no cast the board is left as it is and the case measures the
 * empty-stack page twice, which is why the assertion below is on the reading
 * rather than here: a position that quietly stopped loading the stack would
 * otherwise pass as a page with nothing to draw.
 */
function stacked(game: GameSession): GameSession {
  const decision = pendingDecision(game.state);
  if (decision === null) throw new Error('the board settled before a spell could be cast');
  const spell = decision.options.find((option) => option.type === 'castSpell');
  if (spell === undefined) throw new Error('the board offered no castable spell');
  return sessionOn(reduce(game.state, spell).state, game.events);
}

/**
 * The blocker declaration, parked on the defender.
 *
 * Walked to the attack through the kernel's own turn machinery and reduced with
 * the enumeration's own attack-with-everything option, the way
 * `./declare.test.ts` builds the same shape, so the position is one the game
 * could have reached rather than one fabricated beside it.
 */
function blockers(attackers: number, defenders: number): GameSession {
  const built = scenario({
    seed: 'ui/page-overlap-blockers',
    battlefield: [
      ...Array.from({ length: attackers }, (_unused, index) => ({
        card: creature(`Wandering Herald ${String(index + 1)}`),
        controller: 0 as const,
        summoningSick: false,
      })),
      ...Array.from({ length: defenders }, (_unused, index) => ({
        card: creature(`Ridgeline Guard ${String(index + 1)}`),
        controller: 1 as const,
        summoningSick: false,
      })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const decision = pendingDecision(built.state);
  if (decision === null || decision.kind !== 'declareAttackers') {
    throw new Error('the board never reached an attack declaration');
  }
  // Driven to the end of the declaration rather than reduced once: past the
  // enumeration cap the kernel asks about one creature at a time (`mtg-tb7v`,
  // `mtg-y16d`).
  let current = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before blockers were declared');
    if (pending.kind === 'declareBlockers') return sessionOn(current, built.events);
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

/** A whole game clicked to its result, which is the page the winner reads. */
function finished(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  let session = createSession(game.config.setup, game.config.seats);
  let clicks = 0;
  while (session.pending !== null && clicks < 2_000) {
    session = choose(session, 0);
    clicks += 1;
  }
  if (session.result === null) throw new Error('the driven game never ended');
  return session;
}

function page(game: GameSession, viewer: 0 | 1, title: string, extra = ''): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}${extra}</body></html>`;
}

/**
 * The two defects the control injects: a pair of labels drawn over one another,
 * and a label an `overflow: hidden` ancestor cuts in half.
 *
 * Fixed positions and inline styles rather than a class, so the control is
 * independent of anything the sheet does and stays a control when the sheet
 * changes.
 */
const CONTROL_MARKUP = `<div style="position:fixed;left:40px;top:300px;width:200px;height:40px;z-index:99">
<span style="position:absolute;left:0;top:0">injected overlap one</span>
<span style="position:absolute;left:10px;top:6px">injected overlap two</span>
</div>
<div style="position:fixed;left:300px;top:300px;width:40px;height:12px;overflow:hidden;z-index:99">
<span style="display:block;width:400px;white-space:nowrap">injected clipped label with nowhere to scroll</span>
</div>`;

/**
 * Painted rectangles, overlapping pairs, and ink no scroller can reach.
 *
 * Written as one expression rather than as a page script, the way the two
 * allocation tests beside this one are, so the driver is a navigate and one
 * `Runtime.evaluate` and the harness needs to know no class names.
 */
const MEASURE = `(() => {
  const EPS = 0.5;
  const round = (value) => Math.round(value * 10) / 10;
  const skip = new Set(['SCRIPT', 'STYLE', 'TITLE', 'HEAD', 'META', 'KAELEN', 'NOSCRIPT', 'BR']);
  const view = {
    left: 0,
    top: 0,
    right: document.documentElement.clientWidth,
    bottom: document.documentElement.clientHeight,
  };
  const clipsOn = (style, axis) => (axis === 'x' ? style.overflowX : style.overflowY) !== 'visible';
  const reachable = (mode) => mode === 'auto' || mode === 'scroll';
  const range = document.createRange();

  // The line boxes of an element's own text, which is where its ink is. An
  // element rect is a box that may be mostly empty: a rules paragraph two words
  // long still measures the full width of its column, and comparing those boxes
  // reports a collision wherever two roomy boxes are near each other rather than
  // wherever two words are. A leaf's text is all in direct text nodes by
  // construction, so a range over each of them is the whole of it.
  //
  // Trimmed to the element's own box on the BLOCK axis and left exact on the
  // inline one, and the asymmetry is the font rather than a preference: a range
  // rect is as tall as the font's ascent and descent, which at a tight
  // line-height is taller than the line box, so two stacked blocks report a
  // pixel of overlap with no glyph within ten of the other's. The inline axis
  // has no such overshoot, so a label spilling sideways onto its neighbor is
  // still the collision it looks like. A line escaping its own box downward
  // with overflow visible is the case this trades away, and it is the rarer one:
  // a block grows to its lines unless something pinned its height.
  const lines = (element) => {
    const own = element.getBoundingClientRect();
    const out = [];
    for (const node of element.childNodes) {
      if (node.nodeType !== 3) continue;
      if (node.textContent === null || node.textContent.trim() === '') continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const top = Math.max(rect.top, own.top);
        const bottom = Math.min(rect.bottom, own.bottom);
        if (rect.width > 0 && bottom - top > 0) {
          out.push({ left: rect.left, top: top, right: rect.right, bottom: bottom });
        }
      }
    }
    return out;
  };

  const faceNodes = [...document.querySelectorAll('.mtg-card')];
  const inked = [];
  const inkedCut = [];
  for (const element of document.querySelectorAll('*')) {
    if (skip.has(element.tagName)) continue;
    const text = element.textContent === null ? '' : element.textContent.trim();
    if (text === '') continue;
    let carried = false;
    for (const child of element.children) {
      const childText = child.textContent === null ? '' : child.textContent.trim();
      if (childText !== '') { carried = true; break; }
    }
    if (carried) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const own = lines(element);
    if (own.length === 0) continue;

    // Two walks up the ancestors, and they are deliberately different. The clip
    // that decides where ink LANDS starts at the element itself, because a line
    // its own line-clamp dropped is not painted under the box; the clip that
    // counts as ink WITH NO WAY TO REACH IT starts at the parent, because a box
    // shortening its own line with an ellipsis is a decision and the rail makes
    // it on purpose (../../src/styles/board/rail.ts).
    const clippers = [];
    for (let node = element; node !== null; node = node.parentElement) {
      const ancestor = getComputedStyle(node);
      if (!clipsOn(ancestor, 'x') && !clipsOn(ancestor, 'y')) continue;
      const box = node.getBoundingClientRect();
      clippers.push({
        self: node === element,
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        x: ancestor.overflowX,
        y: ancestor.overflowY,
        name: node.className === '' ? node.tagName : String(node.className),
      });
    }

    let cut = null;
    const painted = [];
    for (const line of own) {
      let box = { left: line.left, top: line.top, right: line.right, bottom: line.bottom };
      for (const clipper of clippers) {
        for (const axis of ['x', 'y']) {
          const mode = axis === 'x' ? clipper.x : clipper.y;
          if (mode === 'visible') continue;
          const low = axis === 'x' ? 'left' : 'top';
          const high = axis === 'x' ? 'right' : 'bottom';
          // Measured against what is still painted at this point in the walk
          // rather than against the raw line, so an ancestor is charged only for
          // the ink it is the one taking away.
          const outside = Math.max(clipper.box[low] - box[low], box[high] - clipper.box[high]);
          if (!clipper.self && cut === null && outside > 1) {
            cut = reachable(mode)
              ? false
              : {
                  text: text.slice(0, 60),
                  axis: axis,
                  outsidePx: round(outside),
                  mode: mode,
                  ancestor: clipper.name,
                };
          }
          box[low] = Math.max(box[low], clipper.box[low]);
          box[high] = Math.min(box[high], clipper.box[high]);
        }
      }
      box.left = Math.max(box.left, view.left);
      box.top = Math.max(box.top, view.top);
      box.right = Math.min(box.right, view.right);
      box.bottom = Math.min(box.bottom, view.bottom);
      if (box.right - box.left > EPS && box.bottom - box.top > EPS) painted.push(box);
    }
    // Text with no painted extent at all is replaced rather than cut: a symbol
    // is a disc with its brace token pushed off at text-indent: -9999px inside
    // its own overflow: hidden box (../../src/styles/symbols.ts), which is how
    // the glyph carries an accessible name. Nothing about that is ink somebody
    // is losing. The second number is about text a reader can see the start of
    // and cannot reach the end of, so it is asked only of text that is drawn.
    if (painted.length === 0) continue;
    if (cut !== null && cut !== false) inkedCut.push(cut);
    const hull = painted.reduce(
      (into, box) => ({
        left: Math.min(into.left, box.left),
        top: Math.min(into.top, box.top),
        right: Math.max(into.right, box.right),
        bottom: Math.max(into.bottom, box.bottom),
      }),
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    inked.push({
      text: text.slice(0, 60),
      painted: painted,
      hull: hull,
      // Which face this ink belongs to and which region of it, so a pair can be
      // named rather than only counted.
      face: faceNodes.indexOf(element.closest('.mtg-card')),
      region: element.closest('.mtg-card__stats') !== null
        ? 'pt'
        : element.closest('.mtg-card__text') !== null
          ? 'rules'
          : element.closest('.mtg-card__type') !== null
            ? 'type'
            : 'other',
    });
  }

  const meets = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPS;
  const contains = (outer, inner) =>
    outer.left <= inner.left + EPS && outer.top <= inner.top + EPS &&
    outer.right >= inner.right - EPS && outer.bottom >= inner.bottom - EPS;

  const pairs = [];
  for (let i = 0; i < inked.length; i += 1) {
    for (let j = i + 1; j < inked.length; j += 1) {
      const one = inked[i];
      const two = inked[j];
      if (!meets(one.hull, two.hull)) continue;
      if (contains(one.hull, two.hull) || contains(two.hull, one.hull)) continue;
      let worst = null;
      for (const a of one.painted) {
        for (const b of two.painted) {
          if (!meets(a, b)) continue;
          const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (worst === null || width * height > worst[0] * worst[1]) worst = [round(width), round(height)];
        }
      }
      if (worst === null) continue;
      // A face's own out-of-flow P/T badge drawn over another region of the same
      // face is counted apart from the rest, because it fails with its own
      // message; both counts are asserted zero. See the note in the test below.
      const regions = [one.region, two.region].sort().join('+');
      const ptBadge =
        one.face >= 0 && one.face === two.face && (one.region === 'pt') !== (two.region === 'pt');
      pairs.push({ a: one.text, b: two.text, overlapPx: worst, regions: regions, ptBadge: ptBadge });
    }
  }

  const unclassified = pairs.filter((pair) => !pair.ptBadge);
  return {
    viewport: [window.innerWidth, window.innerHeight],
    inked: inked.length,
    lines: inked.reduce((total, entry) => total + entry.painted.length, 0),
    faces: document.querySelectorAll(".mtg-slot[data-slot='play'] > .mtg-card").length,
    stackEntries: document.querySelectorAll('.mtg-stack__entry').length,
    overlaps: unclassified.length,
    worst: unclassified.slice(0, 6),
    ptBadge: pairs.length - unclassified.length,
    ptWorst: pairs.filter((pair) => pair.ptBadge).slice(0, 3),
    ptRegions: [...new Set(pairs.filter((pair) => pair.ptBadge).map((pair) => pair.regions))],
    clipped: inkedCut.length,
    clips: inkedCut.slice(0, 6),
    pageOverflowY: round(document.documentElement.scrollHeight - document.documentElement.clientHeight),
  };
})()`;

interface Pair {
  readonly a: string;
  readonly b: string;
  readonly overlapPx: readonly [number, number];
  readonly regions: string;
  readonly ptBadge: boolean;
}

interface Clip {
  readonly text: string;
  readonly axis: string;
  readonly outsidePx: number;
  readonly mode: string;
  readonly ancestor: string;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly inked: number;
  readonly lines: number;
  readonly faces: number;
  readonly stackEntries: number;
  readonly overlaps: number;
  readonly worst: readonly Pair[];
  readonly ptBadge: number;
  readonly ptWorst: readonly Pair[];
  readonly ptRegions: readonly string[];
  readonly clipped: number;
  readonly clips: readonly Clip[];
  readonly pageOverflowY: number;
}

const VIEWPORTS = [
  [1280, 800],
  [1440, 900],
] as const;

/**
 * The floor under the population, so a zero cannot be a zero because the
 * selector found nothing.
 */
const MIN_INKED = 40;

/**
 * What is asserted here, at every built position and both viewports: the
 * viewport read back matches the one requested, the ink count clears
 * `MIN_INKED`, the count of unclassified overlapping pairs is zero, the count of
 * collisions between a face's own out-of-flow P/T badge and another region of
 * that same face is zero, the count of unreachable clips is zero, and on the
 * control the overlap and clip counts are above zero. Each one fails loudly on
 * the control.
 *
 * The badge count used to be recorded and exempted rather than asserted, and it
 * is asserted now because `mtg-kcv2` was fixed. `styles/card.ts` drew
 * `.mtg-card__stats` absolutely at the inner foot of the face with an opaque
 * `background: var(--panel)` and `z-index: 1`, over the foot of the text box; a
 * rules line or a type line that reached that corner was painted over. The run
 * that installed this file measured 4 such pairs at board-4 / 1280x800 (worst
 * 9 x 11.3 px, a two-keyword rules line under a 2/3) and 2 at game-over /
 * 1440x900 (one of them a type line under a 3/3). A board face now draws the
 * badge in the art window's overlay, beside the cost pips and outside the text
 * column entirely; a full face keeps it in the card's own corner, where it was
 * already measured clean. The badge count is 0 at all twelve built readings.
 *
 * The recorded `ptRegions` are carried into the failure message rather than into
 * an exemption set: a collision that comes back tells you which two regions of
 * which face met, whether or not it is the one this paragraph is about.
 */

describe('no word on the played table is painted over another, or hidden with no way to reach it', () => {
  browserIt(
    'counts zero overlapping text pairs and zero unreachable clips at every built position',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-page-overlap-'));
      const positions: {
        readonly label: string;
        readonly file: string;
        readonly control: boolean;
        readonly stack: boolean;
      }[] = [];
      const write = async (label: string, html: string, control = false, stack = false): Promise<void> => {
        const file = join(directory, `${label}.html`);
        await writeFile(file, html, 'utf8');
        positions.push({ label, file, control, stack });
      };
      // The bead names 4 to 16 permanents a side. Both ends and the middle: the
      // row changes what it draws between them (`styles/card.ts` swaps a small
      // face's contents on a container query), so an interior count is a
      // different page rather than a coarser one.
      await write('board-4', page(board(4), 0, 'Four a side'));
      await write('board-10', page(board(10), 0, 'Ten a side'));
      await write('board-16', page(board(16), 0, 'Sixteen a side'));
      // The one element on this page that is drawn out of flow, and the only
      // position where it exists at all (`mtg-rgc.7`).
      await write('stack-10', page(stacked(board(10)), 0, 'A spell on the stack'), false, true);
      await write('declare-blockers', page(blockers(1, 9), 1, 'Declare blockers'));
      await write('game-over', page(finished(), 0, 'Game over'));
      await write('control', page(board(4), 0, 'control page', CONTROL_MARKUP), true);

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const position of positions) {
          for (const [width, height] of VIEWPORTS) {
            if (position.control && width !== 1280) continue;
            const where = `${position.label} at ${String(width)}x${String(height)}`;
            const result = (await measurePage(
              chrome.client,
              position.file,
              width,
              height,
              MEASURE,
              position.label,
            )) as unknown as Reading;
            console.log(
              `${where}: inked ${String(result.inked)}, lines ${String(result.lines)}, faces ${String(result.faces)}, overlaps ${String(result.overlaps)}, ptBadge ${String(result.ptBadge)}, clipped ${String(result.clipped)}, overflowY ${String(result.pageOverflowY)}`,
            );
            if (result.overlaps > 0) console.log(JSON.stringify(result.worst));
            if (result.ptBadge > 0) console.log(JSON.stringify(result.ptWorst));
            if (result.clipped > 0) console.log(JSON.stringify(result.clips));
            expect(result.viewport, `${where} viewport`).toEqual([width, height]);
            expect(result.inked, `${where}: too little ink to be measuring a table`).toBeGreaterThanOrEqual(
              MIN_INKED,
            );
            if (position.stack) {
              // Otherwise the strip's zero overlaps would be the zero of a page
              // that drew no strip, which is what every other position here is.
              expect(
                result.stackEntries,
                `${where}: the position drew no stack, so the strip went unmeasured`,
              ).toBeGreaterThan(0);
            }
            if (position.control) {
              expect(result.overlaps, `${where}: the check found no injected overlap`).toBeGreaterThan(0);
              expect(result.clipped, `${where}: the check found no injected clip`).toBeGreaterThan(0);
              continue;
            }
            expect(result.overlaps, `${where}: ${JSON.stringify(result.worst)}`).toBe(0);
            expect(result.clipped, `${where}: ${JSON.stringify(result.clips)}`).toBe(0);
            expect(
              result.ptBadge,
              `${where}: a P/T badge painted over its own face at ${result.ptRegions.join(', ')}: ${JSON.stringify(result.ptWorst)}`,
            ).toBe(0);
          }
        }
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove Chrome fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `page overlap Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
