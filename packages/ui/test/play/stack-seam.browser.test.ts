// @vitest-environment node
/**
 * The stack is drawn over the board, and it covers nothing a player may click.
 *
 * `mtg-rgc.7`'s first lever, and the half of it that is a promise rather than a
 * move. The stack was a block in the right rail, floored at 52px by
 * `styles/board/rail.ts` and empty at nearly every decision in a game; it is a
 * strip on the seam between the two seats now, absent when the stack is, drawn
 * over the mat rather than in a column of its own.
 *
 * An overlay that covers a click target is a worse defect than the block it
 * replaced. Wizards shipped 2025.47.00 to fix exactly that in Arena, so the
 * acceptance criterion this file exists for is not "the stack draws on top" —
 * it is **"the stack draws on top and does not cover a legal click target"**,
 * and the whole point is that it is measured rather than asserted in a comment.
 *
 * # Where it sits, and why that is a guarantee rather than a hope
 *
 * The seam is the one region of the lanes with nothing in it. Measured in
 * chrome-headless-shell 151.0.7922.47 over the played table at 1024x768,
 * 1280x800 and 1440x900 by 4 and 12 permanents a side, taking the nearest card
 * box, slot box, click target or line of text above and below the divider's
 * midline: the free band is 57.6 / 53.5 / 57.1px at four a side and 58.1 / 61.1
 * / 63.2px at twelve, and in all twelve readings the nearest object on both
 * sides is an empty `.mtg-slot` — no ink, no target, no badge. It does not
 * shrink with crowding, because `styles/board/fit.ts` fits a row's slots to the
 * height the row is given and spends crowding on the width axis.
 *
 * The strip is 32px in a band that is never narrower than 53.5px, positioned
 * 12px above the divider's top edge, and the clearance between its own painted
 * box and the nearest object is measured at every viewport and both crowdings by
 * the `clearAbove` / `clearBelow` assertions below rather than being read off
 * those numbers: 3.0px at its tightest above and 7.6px at its tightest below.
 *
 * # What happens when the board is crowded, and when there is no free space
 *
 * Three rules, and each is a different mechanism rather than a wider margin:
 *
 *  1. **Width is the only axis the strip spends.** Entries ellipsize, the row
 *     does not wrap, and it does not scroll, so a stack ten objects deep is the
 *     same 32px a stack of one is. Nothing it draws can grow toward a card.
 *  2. **When the seam is not free, the strip stops being out of flow.** The
 *     divider is a bar most of the time and a combat band during an attack, and
 *     the band holds cards. `styles/board/stack.ts` selects the arrangement off
 *     `data-combat`: at `false` the strip is absolutely positioned over the mat,
 *     at `true` it is an ordinary flex item in the row beside the attackers and
 *     flex layout is the guarantee. The combat position below is that case, and
 *     the same non-occlusion assertion is made on it.
 *  3. **Under a coarse pointer the board reflows instead.** `styles/touch.ts`'s
 *     `TOUCH_TARGET_PX` floors the resolve control at 44px, which is taller than
 *     the free band, so the strip goes back into flow there and the mat pays for
 *     it. That is the one case where the board moves, and it moves on purpose.
 *
 * # What is asserted, at three viewports by two crowdings
 *
 *  1. **No legal click target is covered.** Every button, link, `role="button"`,
 *     tabbable element and battlefield card face on the page is hit-tested at its
 *     own center with `elementFromPoint`; a hit that lands inside the stack strip
 *     is a failure. A hit test rather than a reading of the rules, because
 *     occlusion is the one thing a stylesheet read by eye cannot answer: the
 *     element doing the covering does not appear in the covered element's rules.
 *  2. **The strip's ink meets nothing.** Every painted part of the strip against
 *     every card box, slot box and click target in the lanes, counting rectangle
 *     intersections. The hit test asks about one point per target and this asks
 *     about the whole box, so a strip grown sideways over the shoulder of a card
 *     fails here before it fails there. Ink rather than layout: a rectangle an
 *     ancestor's overflow cut is intersected back down to what is drawn, because
 *     `getBoundingClientRect` reports the uncut box and this claim is about what
 *     the player can see. The first version of this file read rectangles and
 *     accused the combat arrangement of painting a stack entry 31.6px and 62.3px
 *     over two attacker faces that `.mtg-stack`'s own ellipsis clip had already
 *     taken care of.
 *  3. **The board does not move when a spell goes on the stack.** Occlusion
 *     rather than reflow is the decision Arena made in Patch Notes 2021.07 and
 *     the reason the strip is out of flow; this is what makes it checkable.
 *     Every battlefield slot on both seats, both seat halves and the divider are
 *     measured on the same position with an empty stack and with a spell cast
 *     onto it, and every box has to be identical. The cast taps lands, which is
 *     why the comparison is over the spell rows rather than the mana band.
 *  4. **The strip is inside the free band with room on both sides.** The band is
 *     measured from whatever is actually nearest rather than from the numbers in
 *     the docblock above, so a change that fills the seam fails here rather than
 *     being caught by a reader comparing a comment to a screen.
 *
 * # The gate is proved able to fail
 *
 * A zero is not evidence when a broken selector produces the same zero, so the
 * last position is the same page with a 160 x 200px box injected **into the
 * strip itself**, positioned 60px below it and given back the pointer events the
 * container gives away. That is what "the strip grew over a card" looks like to
 * every check here, and the run fails if claims 1, 2 and 4 do not all report it.
 * On the run this file shipped in it reported 3 covered targets, 10 struck
 * boxes and a `clearBelow` of -209.5px.
 *
 * Demonstrated by mutation as well, each run against a `styles/board/stack.ts`
 * broken one line at a time and then put back:
 *
 *  - `STACK_SEAM_TOP_REM` from -0.75 to 1.5, which walks the strip down into the
 *    near seat's row, fails claim 2 with `stack-4 at 1024x768: the strip's ink
 *    meets the board: [{"part":"mtg-stack-seam__count","board":"mtg-slot",
 *    "overlapPx":[48.1,18.5]}, …]: expected 48 to be +0`, and would have failed
 *    claim 4 at `clearBelow` -28.4.
 *  - `position: absolute` to `position: static` on the out-of-combat rule fails
 *    claim 3 with `stack-4 at 1024x768: a spell going on the stack moved the
 *    battlefield: expected [ [ 165.7, 64.5, 89.8, 125.4 ], …(7) ] to deeply
 *    equal [ [ 165.7, 64.2, 81.6, 113.9 ], …(7) ]` — the whole board resized
 *    around the strip, which is the reflow this bead exists to remove.
 *
 * The harness is `../support/chrome.ts`, and it exists because jsdom performs no
 * layout: every rectangle here would be zeros there, and a strip over a card and
 * a strip beside one would read the same.
 *
 * The neutral `@mtg/dsl` example set, so the file exports publicly (`AGENTS.md`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import {
  DEFAULT_AUTO_PASS,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const SPELLS = [
  exampleCard('slc-emberflow-raider'),
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
] as const;
const MOUNTAIN = exampleCard('slc-mountain');
const LASH = exampleCard('slc-lightning-lash');

function spellAt(index: number): Card {
  return SPELLS[index % SPELLS.length] ?? SPELLS[0];
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

/**
 * `perSide` creatures and seven untapped Mountains a side, two instants in hand.
 *
 * Red throughout so a cast is always available: what the stack positions need is
 * a spell the viewer can put on it at the priority the position opens at, and a
 * mana base that cannot pay is a position where the enumeration has no cast in
 * it and the page under test would be the empty one.
 */
function board(perSide: number, step?: 'declareAttackers'): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: spellAt(index),
      controller: controller as PlayerId,
      summoningSick: false,
    })),
    ...Array.from({ length: 7 }, () => ({
      card: MOUNTAIN,
      controller: controller as PlayerId,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/stack-seam-${String(perSide)}`,
    battlefield,
    hands: [
      [LASH, LASH, spellAt(0), spellAt(1), spellAt(2)],
      [LASH, spellAt(1), spellAt(2), spellAt(3), spellAt(0)],
    ],
    active: 0,
    turn: 6,
    ...(step === undefined ? {} : { step }),
  });
  return sessionOn(built.state, built.events);
}

/** The same position with `depth` spells cast onto the stack by the viewer. */
function stacked(game: GameSession, depth: number): GameSession {
  let state = game.state;
  for (let cast = 0; cast < depth; cast += 1) {
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the position settled before the stack was loaded');
    const spell = decision.options.find((option) => option.type === 'castSpell');
    if (spell === undefined) throw new Error(`nothing castable at depth ${String(cast)}`);
    state = reduce(state, spell).state;
  }
  return sessionOn(state, game.events);
}

/**
 * Attackers declared and a spell on the stack: the seam holding both at once.
 *
 * Walked through the kernel's own enumeration rather than fabricated, the way
 * `./page-overlap.browser.test.ts` builds its blocker position, so the page is
 * one a game could have reached. This is the position where the strip is in flow
 * rather than over the mat, and it is the only one where the divider is tall.
 */
function combatStack(perSide: number): GameSession {
  const game = board(perSide, 'declareAttackers');
  const decision = pendingDecision(game.state);
  if (decision === null || decision.kind !== 'declareAttackers') {
    throw new Error('the position never reached an attack declaration');
  }
  // Driven to the end of the declaration rather than reduced once. A wide
  // board's attack no longer arrives as one list to pick the last of: past the
  // enumeration cap the kernel asks one creature at a time (`mtg-tb7v`), so a
  // single reduction leaves the game still owing attackers and the cast loop
  // below throws on a decision it was never written to answer. `mtg-y16d`
  // pulled this loop out to `driveDeclaration`, shared with every other site
  // that used to reduce once against the last enumerated option.
  let state = driveDeclaration(game.state, 'declareAttackers');
  for (let guard = 0; guard < 12; guard += 1) {
    const pending = pendingDecision(state);
    if (pending === null) throw new Error('the game ended before a spell could be cast');
    const spell = pending.options.find((option) => option.type === 'castSpell');
    if (spell !== undefined) return sessionOn(reduce(state, spell).state, game.events);
    if (pending.kind !== 'priority') throw new Error(`no cast offered at ${pending.kind}`);
    state = reduce(state, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the attack never offered a window to cast into');
}

/**
 * The injected defect: a box inside the strip, below it, that takes clicks.
 *
 * Inside the strip rather than beside it, because what every check here asks is
 * whether *the stack* covers something; a floating div would prove the
 * instrument works on a stranger. Given `pointer-events: auto` explicitly,
 * because the container gives them away on purpose and the control is the case
 * where a part of the strip has taken them back.
 */
const CONTROL_SCRIPT = `<script>(function(){
  var seam = document.querySelector('.mtg-stack-seam');
  if (seam === null) return;
  seam.insertAdjacentHTML('beforeend',
    '<span class="mtg-stack-seam__injected" style="position:absolute;left:40%;top:60px;width:160px;height:200px;background:#c00;pointer-events:auto">covering a card</span>');
})();</script>`;

function page(game: GameSession, title: string, extra = ''): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
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
 * One expression, so the driver is a navigate and one `Runtime.evaluate`.
 *
 * The free band is computed here rather than in the assertions because it is a
 * question about painted geometry: the nearest thing above and below the
 * divider's midline, over card boxes, slot boxes, click targets and the line
 * boxes of every leaf's own text, with the strip and everything inside it
 * excluded. Line boxes rather than element boxes for the text, for the reason
 * `./page-overlap.browser.test.ts` gives at length: an element rect is a box
 * that may be mostly empty, and a two-word label in a wide box would report the
 * whole box as occupied.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const rect = (element) => {
    const b = element.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  };
  const boxOf = (element) => {
    if (element === null) return null;
    const b = element.getBoundingClientRect();
    return [round(b.left), round(b.top), round(b.width), round(b.height)];
  };
  const named = (element) => {
    const cls = element.getAttribute('class');
    return (cls === null || cls === '' ? element.tagName : cls).slice(0, 40);
  };
  const drawn = (element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const b = element.getBoundingClientRect();
    return b.width > 0.5 && b.height > 0.5;
  };
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  // Whether a point is somewhere a click could reach at all: inside the window,
  // and inside every ancestor that clips on the axis it clips. A battlefield row
  // and the ask column's body are both scrollers, so a target scrolled out of one
  // still has a rectangle and still answers elementFromPoint with whatever is
  // painted at that spot. Counting those as covered would fill this instrument
  // with the scrollers doing their job — measured before this filter, 4 to 13 per
  // page — and bury the one class of cover the file exists to catch.
  const reachable = (element, x, y) => {
    if (x < 0 || y < 0 || x > width || y > height) return false;
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const b = node.getBoundingClientRect();
      if (style.overflowX !== 'visible' && (x < b.left - 0.5 || x > b.right + 0.5)) return false;
      if (style.overflowY !== 'visible' && (y < b.top - 0.5 || y > b.bottom + 0.5)) return false;
    }
    return true;
  };

  const seam = document.querySelector('.mtg-stack-seam');
  const divider = document.querySelector('.mtg-board__divider');
  const lanes = document.querySelector('.mtg-board__lanes');
  const inSeam = (node) => seam !== null && node !== null && seam.contains(node);

  // Claim 1: every legal click target, hit-tested at its own center.
  const TARGETS = "button, a[href], [role='button'], [tabindex]:not([tabindex='-1']), .mtg-slot[data-slot='play'] > .mtg-card";
  const covered = [];
  const coveredBySeam = [];
  let targets = 0;
  for (const element of document.querySelectorAll(TARGETS)) {
    if (inSeam(element)) continue;
    if (!drawn(element)) continue;
    const b = element.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    if (!reachable(element, x, y)) continue;
    targets += 1;
    const hit = document.elementFromPoint(x, y);
    if (hit !== null && (hit === element || element.contains(hit))) continue;
    const entry = {
      what: named(element),
      by: hit === null ? 'nothing is drawn there' : named(hit),
      at: [round(x), round(y)],
    };
    covered.push(entry);
    if (inSeam(hit)) coveredBySeam.push(entry);
  }

  // Claim 2: the strip's own painted parts against everything on the board.
  const meets = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  // A clipped box is not painted where its rectangle says it is, and this claim
  // is about ink. getBoundingClientRect reports the layout box whether or not an
  // ancestor's overflow cut it, so an instrument that read rectangles could not
  // see a clip at all -- and the combat arrangement's overflow: hidden is the
  // whole of what makes flex layout the guarantee on that side. Measured before
  // this helper existed and after the clip landed: the count pill still reported
  // 31.6px and 62.3px over two attacker faces at 1024x768 with twelve a side,
  // over ink Chrome was not drawing. Intersecting with every clipping ancestor
  // is the same walk reachable() does one claim up, kept separate because that
  // one answers a yes/no about a point and this one returns a box.
  const visible = (element) => {
    let box = rect(element);
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const b = node.getBoundingClientRect();
      if (style.overflowX !== 'visible') {
        box = { left: Math.max(box.left, b.left), top: box.top, right: Math.min(box.right, b.right), bottom: box.bottom };
      }
      if (style.overflowY !== 'visible') {
        box = { left: box.left, top: Math.max(box.top, b.top), right: box.right, bottom: Math.min(box.bottom, b.bottom) };
      }
    }
    return box.right - box.left > 0.5 && box.bottom - box.top > 0.5 ? box : null;
  };
  // The strip's painted extent is the union of the boxes it actually draws, not
  // its own rectangle. An absolutely positioned child does not enlarge its
  // parent's box, so a part of the strip that grew past it would be invisible to
  // every check keyed off the seam's own client rect, including the control
  // below, which is exactly that shape.
  const inked = (element) => ({ element: element, box: visible(element) });
  const parts = seam === null
    ? []
    : [...seam.querySelectorAll('*')].filter(drawn).map(inked).filter((part) => part.box !== null);
  const seamBox = seam === null ? null : visible(seam);
  const painted = [seamBox, ...parts.map((part) => part.box)]
    .filter((box) => box !== null)
    .reduce((into, box) => into === null ? box : {
      left: Math.min(into.left, box.left), top: Math.min(into.top, box.top),
      right: Math.max(into.right, box.right), bottom: Math.max(into.bottom, box.bottom),
    }, null);
  const boardBoxes = lanes === null
    ? []
    : [...lanes.querySelectorAll(".mtg-card, .mtg-slot, " + TARGETS)]
        .filter((element) => !inSeam(element) && drawn(element))
        .map(inked)
        .filter((entry) => entry.box !== null);
  const struck = [];
  for (const part of parts) {
    for (const box of boardBoxes) {
      if (!meets(part.box, box.box)) continue;
      struck.push({
        part: named(part.element),
        board: named(box.element),
        overlapPx: [
          round(Math.min(part.box.right, box.box.right) - Math.max(part.box.left, box.box.left)),
          round(Math.min(part.box.bottom, box.box.bottom) - Math.max(part.box.top, box.box.top)),
        ],
      });
    }
  }

  // Claim 4: the free band around the seam, and where the strip sits in it.
  let band = null;
  if (lanes !== null && divider !== null) {
    const db = divider.getBoundingClientRect();
    const middle = (db.top + db.bottom) / 2;
    const range = document.createRange();
    const objects = [];
    for (const element of lanes.querySelectorAll('*')) {
      if (inSeam(element) || element === divider || element.contains(divider)) continue;
      if (!drawn(element)) continue;
      const b = element.getBoundingClientRect();
      const cls = element.getAttribute('class') || '';
      const target = element.matches(TARGETS);
      if (target || cls.includes('mtg-card') || cls.includes('mtg-slot')) {
        objects.push({ kind: target ? 'a click target' : 'an empty ' + named(element), top: b.top, bottom: b.bottom });
      }
      let carried = false;
      for (const child of element.children) {
        if ((child.textContent || '').trim() !== '') { carried = true; break; }
      }
      if (carried) continue;
      for (const node of element.childNodes) {
        if (node.nodeType !== 3) continue;
        if ((node.textContent || '').trim() === '') continue;
        range.selectNodeContents(node);
        for (const line of range.getClientRects()) {
          if (line.width <= 0 || line.height <= 0) continue;
          objects.push({ kind: 'the words "' + (node.textContent || '').trim().slice(0, 24) + '"',
            top: Math.max(line.top, b.top), bottom: Math.min(line.bottom, b.bottom) });
        }
      }
    }
    let above = -1e9, below = 1e9, aboveWhat = null, belowWhat = null;
    for (const object of objects) {
      if (object.bottom <= middle && object.bottom > above) { above = object.bottom; aboveWhat = object.kind; }
      if (object.top >= middle && object.top < below) { below = object.top; belowWhat = object.kind; }
    }
    band = {
      free: round(below - above),
      aboveWhat: aboveWhat,
      belowWhat: belowWhat,
      clearAbove: painted === null ? null : round(painted.top - above),
      clearBelow: painted === null ? null : round(below - painted.bottom),
    };
  }

  return {
    viewport: [window.innerWidth, window.innerHeight],
    seam: boxOf(seam),
    seamInFlow: seam === null ? null : getComputedStyle(seam).position === 'static',
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    entries: document.querySelectorAll('.mtg-stack__entry').length,
    targets: targets,
    covered: covered.length,
    coveredBySeam: coveredBySeam.length,
    worstCovered: coveredBySeam.slice(0, 4),
    otherCovered: covered.slice(0, 4),
    struck: struck.length,
    worstStruck: struck.slice(0, 4),
    band: band,
    // What claim 3 compares between the two pages, in document order.
    sides: [...document.querySelectorAll('.mtg-board__side')].map(boxOf),
    divider: boxOf(divider),
    playSlots: [...document.querySelectorAll(".mtg-board__spells > .mtg-slot")].map(boxOf),
  };
})()`;

interface Covered {
  readonly what: string;
  readonly by: string;
  readonly at: readonly number[];
}

interface Struck {
  readonly part: string;
  readonly board: string;
  readonly overlapPx: readonly number[];
}

interface Band {
  readonly free: number;
  readonly aboveWhat: string | null;
  readonly belowWhat: string | null;
  readonly clearAbove: number | null;
  readonly clearBelow: number | null;
}

interface Reading {
  readonly viewport: readonly number[];
  readonly seam: readonly number[] | null;
  readonly seamInFlow: boolean | null;
  readonly combat: string | null;
  readonly entries: number;
  readonly targets: number;
  readonly covered: number;
  readonly coveredBySeam: number;
  readonly worstCovered: readonly Covered[];
  readonly otherCovered: readonly Covered[];
  readonly struck: number;
  readonly worstStruck: readonly Struck[];
  readonly band: Band | null;
  readonly sides: readonly (readonly number[] | null)[];
  readonly divider: readonly number[] | null;
  readonly playSlots: readonly (readonly number[] | null)[];
}

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

const CROWDINGS = [4, 12] as const;

/** The floor under the population, so a zero cannot be a zero for lack of a page. */
const MIN_TARGETS = 20;

describe('the stack draws over the board and covers nothing a player may click', () => {
  browserIt(
    'hit-tests every target clear of the strip at three viewports and both crowdings',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-stack-seam-'));
      const positions: {
        readonly label: string;
        readonly file: string;
        readonly kind: 'bar' | 'combat' | 'control';
        readonly perSide: number;
      }[] = [];
      const write = async (
        label: string,
        game: GameSession,
        kind: 'bar' | 'combat' | 'control',
        perSide: number,
        extra = '',
      ): Promise<void> => {
        const file = join(directory, `${label}.html`);
        await writeFile(file, page(game, label, extra), 'utf8');
        positions.push({ label, file, kind, perSide });
      };
      // The empty-stack twin of each crowding, kept beside its loaded page so
      // claim 3 compares two renders of one position rather than two positions.
      const empty = new Map<number, string>();
      for (const perSide of CROWDINGS) {
        const open = board(perSide);
        const file = join(directory, `empty-${String(perSide)}.html`);
        await writeFile(file, page(open, `Empty stack, ${String(perSide)} a side`), 'utf8');
        empty.set(perSide, file);
        await write(`stack-${String(perSide)}`, stacked(open, 2), 'bar', perSide);
        await write(`combat-${String(perSide)}`, combatStack(perSide), 'combat', perSide);
      }
      await write('control', stacked(board(4), 2), 'control', 4, CONTROL_SCRIPT);

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const position of positions) {
          for (const [width, height] of VIEWPORTS) {
            if (position.kind === 'control' && width !== 1280) continue;
            const where = `${position.label} at ${String(width)}x${String(height)}`;
            const result = (await measurePage(
              chrome.client,
              position.file,
              width,
              height,
              MEASURE,
              position.label,
            )) as unknown as Reading;
            const band = result.band;
            console.log(
              `${where}: entries ${String(result.entries)}, combat ${String(result.combat)}, seam ${JSON.stringify(result.seam)}, targets ${String(result.targets)}, coveredBySeam ${String(result.coveredBySeam)}, covered ${String(result.covered)}, struck ${String(result.struck)}, band ${band === null ? 'none' : `${String(band.free)} free, ${String(band.clearAbove)} above, ${String(band.clearBelow)} below`}`,
            );
            if (result.covered > 0) console.log(JSON.stringify(result.otherCovered));
            if (result.struck > 0) console.log(JSON.stringify(result.worstStruck));

            expect(result.viewport, `${where}: viewport`).toEqual([width, height]);
            expect(result.seam, `${where}: the stack drew no strip at all`).not.toBeNull();
            expect(result.entries, `${where}: the strip drew no objects`).toBeGreaterThan(0);
            expect(result.targets, `${where}: too few click targets to be measuring a table`).toBeGreaterThan(
              MIN_TARGETS,
            );

            if (position.kind === 'control') {
              expect(result.coveredBySeam, `${where}: the hit test found no injected cover`).toBeGreaterThan(
                0,
              );
              expect(result.struck, `${where}: the ink check found no injected cover`).toBeGreaterThan(0);
              expect(band, `${where}: no band was measured`).not.toBeNull();
              if (band !== null) {
                expect(
                  band.clearBelow,
                  `${where}: the band check did not notice the injected box leaving the seam`,
                ).toBeLessThan(0);
              }
              continue;
            }

            // Claim 1, and the one the bead is about.
            expect(
              result.coveredBySeam,
              `${where}: the stack covered ${String(result.coveredBySeam)} click targets: ${JSON.stringify(result.worstCovered)}`,
            ).toBe(0);
            // Claim 2.
            expect(
              result.struck,
              `${where}: the strip's ink meets the board: ${JSON.stringify(result.worstStruck)}`,
            ).toBe(0);

            if (position.kind === 'combat') {
              // The second arrangement: the band holds cards, so the strip is a
              // flex item in the row rather than a box over the mat, and claims
              // 1 and 2 above are what says flex layout kept them apart. There
              // is no free band to measure here — the seam is full, which is the
              // condition this arrangement exists for.
              expect(result.combat, `${where}: the band never opened`).toBe('true');
              expect(result.seamInFlow, `${where}: the strip stayed out of flow over a full band`).toBe(true);
              continue;
            }

            expect(result.combat, `${where}: the band opened on a position with no attack`).toBe('false');
            expect(result.seamInFlow, `${where}: the strip is in flow and the board is paying for it`).toBe(
              false,
            );
            // Claim 4. Named from what was actually nearest, so the message says
            // which object the strip reached rather than that a number moved.
            expect(band, `${where}: no free band could be measured`).not.toBeNull();
            if (band !== null) {
              expect(
                band.clearAbove,
                `${where}: the strip is ${String(band.clearAbove)}px past the nearest object above it (${String(band.aboveWhat)})`,
              ).toBeGreaterThan(0);
              expect(
                band.clearBelow,
                `${where}: the strip is ${String(band.clearBelow)}px past the nearest object below it (${String(band.belowWhat)})`,
              ).toBeGreaterThan(0);
            }

            // Claim 3. Occlusion rather than reflow: the same position with an
            // empty stack has to lay the board out in exactly the same places.
            const twin = empty.get(position.perSide);
            expect(twin, `${where}: no empty-stack twin was written`).toBeDefined();
            if (twin === undefined) continue;
            const before = (await measurePage(
              chrome.client,
              twin,
              width,
              height,
              MEASURE,
              `${position.label} twin`,
            )) as unknown as Reading;
            expect(before.seam, `${where}: the empty stack drew a strip`).toBeNull();
            expect(
              before.playSlots.length,
              `${where}: the twin drew a different number of battlefield slots`,
            ).toBe(result.playSlots.length);
            expect(before.playSlots, `${where}: a spell going on the stack moved the battlefield`).toEqual(
              result.playSlots,
            );
            expect(before.sides, `${where}: a spell going on the stack moved a seat`).toEqual(result.sides);
            expect(before.divider, `${where}: a spell going on the stack moved the seam`).toEqual(
              result.divider,
            );
          }
        }
      } catch (error: unknown) {
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
          `stack seam Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    180_000,
  );
});
