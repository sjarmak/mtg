/**
 * How much of a combat declaration is on screen, as static HTML a browser can
 * measure.
 *
 * `mtg-y1t`. The kernel enumerates an attack as the subsets of the eligible
 * attackers and a block as the cartesian product of each blocker's choices, so
 * both option counts are exponential in the creatures standing on the board. A
 * played game reached a blocker declaration with 256 of them in a 449px column.
 * The claim that the roster fixes it is geometry, and jsdom lays nothing out —
 * `getBoundingClientRect` is all zeros there — so it is said here, the way
 * `tools/rail-split.ts` says the same kind of thing one column over.
 *
 * The page is `PlayView` parked on a real declaration, reached through the
 * kernel's own turn machinery: a board is stated, the attack is declared with
 * the enumeration's own option, and priority is passed to the blocker step.
 * Nothing about the position is fabricated beside the game.
 *
 * **The reading is taken through the panel's own classes rather than through
 * whichever surface drew them**, so one page script reads a before and an after
 * and the two numbers are taken the same way. Before is this file on a checkout
 * without `src/routes/play/declare.ts`; after is this file as it stands.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/block-ask.ts out/block-ask
 *
 * Then point a browser at `block-ask-<n>.html` at a viewport and call
 * `window.mtgBlockAsk()`.
 *
 * What it answers: the ask panel's box, the body's scroll height, how many
 * controls are in the labeled group, how many of them are wholly inside the
 * body, and what the kernel enumerated behind them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { GameSession, GameState } from '@mtg/kernel';
import {
  DEFAULT_AUTO_PASS,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'block-ask');

/**
 * How many untapped creatures the defending seat has, per page.
 *
 * Eight is the board `mtg-y1t` was filed off — 2^8 = 256 legal blocks. Four is
 * the ordinary midgame at 16, which is `mtg-euc`'s option count arrived at from
 * the other direction, and it is here so the two pages say whether the roster's
 * cost is flat in the board or grows with it.
 */
const BLOCKER_COUNTS: readonly number[] = [4, 8];

let minted = 0;

/**
 * A creature invented for this page.
 *
 * Invented rather than taken from a set, for the reason `packages/slice`'s
 * public boundary gives: a proper noun from the private world is a bug in a
 * public package, and this file exports. The names are deliberately long-ish,
 * because a short name would flatter the column.
 */
function creature(name: string): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `blk-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'BLK', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
  });
}

const BLOCKER_NAMES: readonly string[] = [
  'Harborwatch Sentry',
  'Cinderfall Drover',
  'Marshlight Picket',
  'Quarry Stonewarden',
  'Bellringer Adept',
  'Tidewrack Hound',
  'Ashfield Lantern',
  'Palisade Outrider',
];

/** A position parked on the blocker declaration, with `blockers` able to answer. */
function blockingState(blockers: number): GameState {
  const built = scenario({
    seed: `tools/block-ask/${String(blockers)}`,
    battlefield: [
      { card: creature('Gravebriar Vanguard'), controller: 0, summoningSick: false },
      ...Array.from({ length: blockers }, (_unused, at) => ({
        card: creature(BLOCKER_NAMES[at % BLOCKER_NAMES.length] ?? `Picket ${String(at)}`),
        controller: 1 as const,
        summoningSick: false,
      })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });

  // Driven to the end of the attack declaration rather than reduced once: past
  // the enumeration cap the kernel asks about one creature at a time
  // (`mtg-tb7v`, `mtg-y16d`).
  let state = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the board ended before blockers were declared');
    if (decision.kind === 'declareBlockers') return state;
    // At a priority the first option is the pass, and passing is what walks
    // the step on; the attack declaration itself is already fully driven
    // above, so no other decision kind is expected here.
    const option = decision.options[0];
    if (option === undefined) throw new Error('a decision on the way to blockers was empty');
    state = reduce(state, option).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

function sessionOn(state: GameState): GameSession {
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * What a browser reads off the page.
 *
 * A control counts as shown when every pixel of it is inside the body's own box,
 * which is `tools/rail-split.ts`'s rule: half a button is not a button. The body
 * is an internal scroller either way, so nothing counted as hidden is
 * unreachable — what the numbers answer is how much of the decision a player is
 * looking at.
 */
const MEASURE = `
window.mtgBlockAsk = function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var box = function (node) {
    if (node === null || node === undefined) return null;
    var rect = node.getBoundingClientRect();
    return { x: round(rect.left), y: round(rect.top), w: round(rect.width), h: round(rect.height) };
  };
  var body = document.querySelector('.mtg-prompt .mtg-panel__body');
  var group = document.querySelector('.mtg-choices');
  if (body === null || group === null) return null;
  var frame = body.getBoundingClientRect();
  var controls = group.querySelectorAll('button');
  var shown = 0;
  var tallest = 0;
  for (var c = 0; c < controls.length; c += 1) {
    var r = controls[c].getBoundingClientRect();
    if (r.height > tallest) tallest = r.height;
    if (r.top >= frame.top - 0.5 && r.bottom <= frame.bottom + 0.5) shown += 1;
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    enumerated: Number(document.body.getAttribute('data-mtg-options')),
    panel: box(document.querySelector('.mtg-prompt')),
    head: box(document.querySelector('.mtg-prompt .mtg-panel__head')),
    bodyBox: box(body),
    content: round(body.scrollHeight),
    hidden: round(body.scrollHeight - body.clientHeight),
    scrollbar: round(body.offsetWidth - body.clientWidth),
    controls: controls.length,
    controlsShown: shown,
    tallestControl: round(tallest),
    roster: box(document.querySelector('.mtg-declare__roster')),
    pageOverflow: {
      x: round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      y: round(document.documentElement.scrollHeight - document.documentElement.clientHeight)
    }
  };
};
`;

function page(blockers: number): string {
  const state = blockingState(blockers);
  const session = sessionOn(state);
  const options = session.pending?.options.length ?? 0;
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session,
        // The defending seat, which is the seat being asked.
        viewer: 1,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  const title = `Block ask, ${String(blockers)} untapped creatures`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body data-mtg-options="${String(options)}">${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const blockers of BLOCKER_COUNTS) {
  const file = join(out, `block-ask-${String(blockers)}.html`);
  writeFileSync(file, page(blockers), 'utf8');
  console.log(`wrote ${file}`);
}
