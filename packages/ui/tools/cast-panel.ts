/**
 * The staged cast at each of its stages, as static HTML a browser can measure.
 *
 * The panel is taller than the picker whose box it borrows — a step strip, the
 * aims a finished cast lists, and a row of two controls, on top of the list of
 * answers — and "taller" is a geometric claim that jsdom cannot check, because
 * jsdom performs no layout. `styles/board/picker.ts` carries the numbers that
 * put the picker in the rail's column at three viewports; this is what lets the
 * same numbers be taken for the panel rather than assumed to carry over.
 *
 * **It composes `PlayView`'s body with exactly one substitution.** The panel is
 * opened by React state that nothing outside the component can set, so the page
 * is built from the same `playToolbar`, `playTable` and `passButton` that view
 * composes, handed a selection whose `pickerFor` returns the cast panel for one
 * named card. The markup, the class names and the sheet are therefore the
 * shipped ones; what the page does not exercise is the click that opens the
 * panel, which `test/play/cast.test.ts` holds in jsdom.
 *
 * The same arrangement as `land-variants.ts` and `board-crowding.ts`, and
 * Node-only like both: it writes files and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/cast-panel.ts out/verify
 *
 * Then load each page in chrome-headless-shell over CDP and call
 * `window.mtgCastPanel()`, which returns the panel's box, every card slot's box,
 * and the slots it overlaps.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { GameState, ObjectId } from '@mtg/kernel';
import { pendingDecision, scenario } from '@mtg/kernel';
import { GameLog } from '../src/log/GameLog';
import { Shell } from '../src/app/Shell';
import { castPlansFor, castStage } from '../src/routes/play/cast';
import type { CastPick } from '../src/routes/play/cast';
import { castPanel } from '../src/routes/play/cast-panel';
import { passButton } from '../src/routes/play/pass';
import { boardPosition } from '../src/routes/play/position';
import type { SeatNames } from '../src/routes/play/position';
import { buildPrompt, choicesByObject } from '../src/routes/play/prompt';
import { promptPanel } from '../src/routes/play/rail';
import { railToggle } from '../src/routes/play/rail-collapse';
import { playTable } from '../src/routes/play/table';
import { NO_STAGING } from '../src/routes/play/combat';
import { playToolbar } from '../src/routes/play/toolbar';
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
 * A busy enough priority to be worth measuring against.
 *
 * A full hand and a board on both sides, so the rail behind the panel is a long
 * move list rather than a pass and a concession — the question the measurement
 * answers is what the panel covers, and it can only cover something that is
 * there.
 */
function skirmish(): GameState {
  return scenario({
    seed: 'tools/cast-panel',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: RAIDER, controller: 0, summoningSick: false },
      { card: DRAKE, controller: 1 },
      { card: GUARDIAN, controller: 1, summoningSick: false },
    ],
    hands: [[MOUNTAIN, RAIDER, LASH, GUARDIAN], []],
  }).state;
}

function lashOid(state: GameState): ObjectId {
  const found = state.players[0].hand.find((oid) => state.objects[oid]?.card.name === 'Lightning Lash');
  if (found === undefined) throw new Error('the scenario put no Lightning Lash in hand');
  return found;
}

/**
 * `PlayView`'s body with the panel forced open on one card at one stage.
 *
 * Everything but `pickerFor` is what that view builds, in the order it builds
 * it, so the page is the shipped table with one panel drawn in it.
 */
function table(picks: readonly CastPick[]): string {
  const state = skirmish();
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  const oid = lashOid(state);
  const plan = castPlansFor(state, decision).get(oid);
  if (plan === undefined) throw new Error('the scenario offers no staged cast for the Lash');
  const stage = castStage(state, NAMES, plan, picks);
  if (stage === null) throw new Error('those picks name no enumerated cast');

  const prompt = buildPrompt(state, decision, NAMES);
  const panel = castPanel({
    plan,
    stage,
    onPick: () => undefined,
    onBack: picks.length === 0 ? null : () => undefined,
    onCancel: () => undefined,
    onChoose: () => undefined,
  });
  const rendered = playTable({
    // A rig owns no session, so nothing is being declared and nothing can be
    // staged (`../src/routes/play/combat.ts`).
    staging: NO_STAGING,
    combat: null,
    position: boardPosition(state, 0, NAMES, null),
    playable: new Set(state.players[0].hand),
    byObject: choicesByObject(prompt),
    selection: {
      openKey: oid,
      select: () => undefined,
      activate: () => undefined,
      openMenu: () => undefined,
      dismiss: () => undefined,
      pickerFor: (key: string): ReactNode => (key === oid ? panel : null),
      // A priority is not a combat declaration, so nothing is being assembled.
      declaration: null,
      ordering: null,
      targeting: null,
    },
    // Two columns since `mtg-rgc.4`: the ask between the pods, the history in
    // the rail. `../src/styles/board/rail.ts` argues the split.
    prompt: promptPanel(prompt, () => undefined, 0),
    // No stop set on this page, so no step bar (`../src/routes/play/toolbar.ts`
    // draws one only for a caller that owns the settings). The panel this tool
    // measures hangs off the picker, not off the bar.
    steps: null,
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
  // Nothing dealt this page, so no strip: the turn text this rig used to put
  // here rides on the bar now, and this page draws no bar (`mtg-rgc.13`).
  const toolbar = playToolbar(null);
  return renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-play' },
        toolbar,
        h(
          'div',
          { className: 'mtg-play__table' },
          rendered,
          passButton(0, () => undefined),
        ),
      ),
    }),
  );
}

/**
 * What a browser reads off the page: where the panel is, where every card is,
 * and whether the first crosses any of the second.
 *
 * Boxes rather than a verdict, because the claim being checked has two halves
 * that fail differently — a panel that reaches into the column the cards are
 * drawn in covers the card you are casting, and a panel taller than the window
 * has controls nobody can press.
 */
const MEASURE = `
window.mtgCastPanel = function () {
  var box = function (node) {
    var r = node.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  };
  var hits = function (a, b) {
    return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  };
  var panel = document.querySelector('.mtg-cast');
  if (panel === null) return { panel: null };
  var mine = box(panel);
  var slots = [];
  var covered = [];
  var all = document.querySelectorAll('.mtg-slot');
  for (var i = 0; i < all.length; i += 1) {
    var b = box(all[i]);
    slots.push(b);
    if (hits(mine, b)) covered.push({ slot: all[i].getAttribute('data-slot'), box: b });
  }
  var rail = document.querySelector('.mtg-board__rail');
  var moves = document.querySelectorAll('.mtg-choices .mtg-choice');
  var coveredMoves = 0;
  for (var j = 0; j < moves.length; j += 1) {
    if (hits(mine, box(moves[j]))) coveredMoves += 1;
  }
  return {
    viewport: [window.innerWidth, window.innerHeight],
    panel: mine,
    scrolls: panel.scrollHeight > panel.clientHeight,
    rail: rail === null ? null : box(rail),
    slots: slots.length,
    coveredSlots: covered,
    moves: moves.length,
    coveredMoves: coveredMoves,
    documentScrollsSideways: document.documentElement.scrollWidth > window.innerWidth
  };
};
`;

function page(title: string, markup: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

const STAGES: readonly { readonly name: string; readonly picks: readonly CastPick[] }[] = [
  { name: 'cast-targets', picks: [] },
  { name: 'cast-payment', picks: [{ kind: 'target', slot: 0, target: { kind: 'player', player: 1 } }] },
];

mkdirSync(out, { recursive: true });
for (const stage of STAGES) {
  const file = join(out, `${stage.name}.html`);
  writeFileSync(file, page(stage.name, table(stage.picks)), 'utf8');
  console.log(`wrote ${file}`);
}
