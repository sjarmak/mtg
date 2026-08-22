/**
 * The table mid-combat, as static HTML a browser can measure.
 *
 * It answers a second question at the same time, because it is the same page:
 * **is the dotted underline under a modified power and toughness actually drawn
 * at board size?** The derived-size badge came down on the playtester's word that the
 * underline is sufficient, so the underline is now the only thing a sighted
 * player sees, and it is selected through a `:has()` test on a mark that is
 * itself invisible (`styles/board/attach.ts`). Every step of that is a place it
 * could be true in the sheet and absent on the glass. One creature a side
 * carries two +1/+1 counters for exactly this.
 *
 * Three claims about the combat band are geometry, and jsdom answers none of
 * them: `getBoundingClientRect` is all zeros there, so a vitest test can say the
 * sheet declares a share of the column and cannot say what the band came out at,
 * what it cost the two rows, or whether a band full of *rotated* attackers
 * overhangs its neighbors. That last one is `mtg-bm1` — `flex-shrink` is a
 * main-axis operation, so a crowded row takes width off a square tapped slot and
 * cannot take height off it, and a card drawn off the height then paints over
 * the card beside it. Attacking taps, so the band is exactly where that returns.
 *
 * The same arrangement as `./tap-rotation.ts` and `./board-crowding.ts`, and
 * Node-only like both: it writes a file and opens no browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/combat-zone.ts out/verify
 *
 * then navigate to `combat-<attackers>.html` and call `window.mtgCombatZone()`.
 * The cards are the DSL example set's, exactly as in `./tap-rotation.ts`, and
 * **every reading has to say so**: a real set's names are longer and its cards
 * carry art, so a number taken here is a number about these fixtures.
 *
 * `combat-staged.html` draws the same creatures as proposals rather than
 * declarations, which is `mtg-bz2.5`'s other state and the one drawn *smaller* —
 * worth its own page because a shorter card in a stretched band is where a slot
 * and the face inside it come apart.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'verify');

/**
 * How many attackers each page puts in the band, against six permanents a side.
 *
 * One is the ordinary case. Three is a real attack. Six is every creature the
 * seat has, which is the band at its widest and the two rows at their emptiest —
 * the state where the share the band takes is most visible and where a row that
 * over-shrank would show it.
 */
const ATTACKER_COUNTS: readonly number[] = [1, 3, 6];

/** Permanents a side, so the band's cost to the rows is measured against a real board. */
const PERMANENTS = 6;
const LANDS = 5;

/**
 * Three creatures dealt round-robin, so the band holds faces of different names
 * and lengths rather than six copies of one card measuring identically.
 */
const CREATURES: readonly DslCard[] = [
  exampleCard('slc-emberflow-raider'),
  exampleCard('slc-thornhide-guardian'),
  exampleCard('slc-windrider-drake'),
];
const LAND = exampleCard('slc-mountain');

function creature(index: number): DslCard {
  const card = CREATURES[index % CREATURES.length];
  if (card === undefined) throw new Error('no creature');
  return card;
}

interface Placed {
  readonly card: DslCard;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
}

function side(controller: PlayerId, tapped: boolean): readonly Placed[] {
  return [
    ...Array.from({ length: PERMANENTS }, (_unused, index) => ({
      card: creature(index),
      controller,
      // Half of them turned, because a row of attackers is a row of tapped
      // cards and the untapped neighbor is what an overhang lands on.
      tapped: tapped && index % 2 === 0,
      summoningSick: false,
    })),
    ...Array.from({ length: LANDS }, () => ({
      card: LAND,
      controller,
      tapped: false,
      summoningSick: false,
    })),
  ];
}

/**
 * Two +1/+1 counters on the last creature each seat controls.
 *
 * The last rather than the first, so the modified creature is one the band never
 * takes: the underline has to be readable in a *row*, at the size a row gives a
 * face, on both seats at once. Counters rather than a lord, because they are the
 * case the ask did not name — the playtester wrote "from static effects" and the
 * badge said the same sentence for both — and because a creature under counters
 * is the one whose printed pair is furthest from what it is now.
 */
function pumped(state: GameState): GameState {
  const objects = { ...state.objects };
  for (const controller of [0, 1] as const) {
    const mine = state.battlefield.filter((oid) => {
      const object = state.objects[oid];
      return object !== undefined && object.controller === controller && object.card.kind === 'creature';
    });
    const last = mine[mine.length - 1];
    const object = last === undefined ? undefined : state.objects[last];
    if (last === undefined || object === undefined) continue;
    objects[last] = { ...object, counters: { ...object.counters, plusOnePlusOne: 2 } };
  }
  return { ...state, objects };
}

/**
 * A position with the attack already declared.
 *
 * `scenario` deals a board and no combat, so the attacks are written onto the
 * state the way a rig writes a position rather than played out — the same thing
 * `scenario`'s own docblock says about a stated board of tokens. Nothing about
 * the drawing depends on how the state was reached.
 */
function combatSession(attackers: number, staged: boolean): GameSession {
  const built = scenario({
    seed: 'tools/combat-zone',
    battlefield: [...side(0, true), ...side(1, false)],
    hands: [[creature(0)], []],
    step: 'declareAttackers',
    active: 0,
    turn: 5,
  });
  const mine: readonly ObjectId[] = built.state.battlefield.filter((oid) => {
    const object = built.state.objects[oid];
    return object !== undefined && object.controller === 0 && object.card.kind === 'creature';
  });
  const chosen = mine.slice(0, attackers);
  const attacked: GameState = staged
    ? built.state
    : {
        ...built.state,
        combat: {
          ...built.state.combat,
          attacks: chosen.map((oid) => ({ oid, defender: 1 as PlayerId })),
        },
      };
  const state = pumped(attacked);
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
 * `bandShare` is the design claim — the band takes a share of the lanes column
 * rather than a count of pixels — and `rowHeights` is what that share cost the
 * two seats. `overhang` and `overlappingPairs` are `mtg-bm1`'s two numbers,
 * asked of the band this time: the furthest any face reaches past its own slot,
 * and how many faces in the band paint over each other.
 */
const MEASURE = `
window.mtgCombatZone = function () {
  var box = function (el) {
    if (el === null) return null;
    var r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10
    };
  };
  var qa = function (selector) { return [].slice.call(document.querySelectorAll(selector)); };
  var lanes = box(document.querySelector('.mtg-board__lanes'));
  var band = box(document.querySelector('.mtg-board__divider'));
  var entries = qa('.mtg-combat__entry').map(function (entry) {
    var slot = entry.querySelector(".mtg-slot[data-slot='play']");
    var card = entry.querySelector('.mtg-card');
    var slotBox = slot === null ? null : slot.getBoundingClientRect();
    var cardBox = card === null ? null : card.getBoundingClientRect();
    return {
      seat: entry.getAttribute('data-seat'),
      state: entry.getAttribute('data-state'),
      tapped: slot === null ? null : slot.getAttribute('data-tapped') === 'true',
      slot: box(slot),
      card: box(card),
      overhang: slotBox === null || cardBox === null ? null :
        Math.round(Math.max(0, slotBox.left - cardBox.left, cardBox.right - slotBox.right) * 10) / 10
    };
  });
  var pairs = function (selector) {
    var overlaps = 0;
    var faces = qa(selector);
    for (var a = 0; a < faces.length; a += 1) {
      for (var b = a + 1; b < faces.length; b += 1) {
        var one = faces[a].getBoundingClientRect();
        var two = faces[b].getBoundingClientRect();
        if (one.width === 0 || two.width === 0) continue;
        if (one.left < two.right - 0.5 && two.left < one.right - 0.5 &&
            one.top < two.bottom - 0.5 && two.top < one.bottom - 0.5) overlaps += 1;
      }
    }
    return overlaps;
  };
  var faceHeights = function (seat) {
    var found = qa(".mtg-board__side[data-seat='" + seat + "'] .mtg-board__spells .mtg-card[data-size='board']");
    var heights = found.map(function (el) { return Math.round(el.getBoundingClientRect().height * 10) / 10; });
    var unique = heights.filter(function (h, i) { return heights.indexOf(h) === i; });
    return { count: heights.length, heights: unique.sort(), spread: unique.length === 0 ? 0 :
      Math.round((Math.max.apply(null, unique) - Math.min.apply(null, unique)) * 10) / 10 };
  };
  var derived = qa('.mtg-slot__marks:has(.mtg-mark[data-mark="derived"])').map(function (marks) {
    var slot = marks.parentElement;
    var seat = slot === null ? null : slot.closest('.mtg-board__side');
    var pt = slot === null ? null : slot.querySelector('.mtg-card__pt');
    var mark = marks.querySelector('.mtg-mark[data-mark="derived"]');
    var markBox = mark === null ? null : mark.getBoundingClientRect();
    var style = pt === null ? null : getComputedStyle(pt);
    var face = slot === null ? null : slot.querySelector('.mtg-card');
    return {
      seat: seat === null ? null : seat.getAttribute('data-seat'),
      text: pt === null ? null : pt.textContent,
      faceH: face === null ? null : Math.round(face.getBoundingClientRect().height * 10) / 10,
      fontPx: style === null ? null : style.fontSize,
      line: style === null ? null : style.textDecorationLine,
      style: style === null ? null : style.textDecorationStyle,
      color: style === null ? null : style.textDecorationColor,
      thickness: style === null ? null : style.textDecorationThickness,
      ptBox: box(pt),
      markBox: markBox === null ? null :
        { w: Math.round(markBox.width * 10) / 10, h: Math.round(markBox.height * 10) / 10 },
      markText: mark === null ? null : mark.textContent,
      markLabel: mark === null ? null : mark.getAttribute('aria-label')
    };
  });
  var controls = qa('.mtg-combat__button').map(function (button) {
    var r = button.getBoundingClientRect();
    var band = document.querySelector('.mtg-board__divider').getBoundingClientRect();
    return {
      text: button.textContent,
      label: button.getAttribute('aria-label'),
      disabled: button.disabled === true,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      // Inside the band's own box, which is the claim the scroller split is
      // about: a control drawn past this edge went out with the attackers.
      insideBand: r.left >= band.left - 0.5 && r.right <= band.right + 0.5
    };
  });
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    coarse: matchMedia('(pointer: coarse)').matches,
    lanes: lanes,
    controls: controls,
    derived: derived,
    band: band,
    bandShare: lanes === null || band === null ? null : Math.round((band.h / lanes.h) * 1000) / 10,
    entries: entries,
    worstOverhang: entries.reduce(function (worst, entry) {
      return entry.overhang === null ? worst : Math.max(worst, entry.overhang);
    }, 0),
    bandPairs: pairs('.mtg-combat__entry .mtg-card'),
    tablePairs: pairs(".mtg-slot[data-slot='play'] .mtg-card"),
    near: faceHeights('you'),
    far: faceHeights('opponent'),
    emptyPlaces: qa(".mtg-slot[data-slot='play'][data-empty='true']").length,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pageOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight
  };
};
`;

function page(attackers: number, staged: boolean): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: combatSession(attackers, staged),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
      }),
    }),
  );
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>The combat band</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${markup}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const attackers of ATTACKER_COUNTS) {
  const file = join(out, `combat-${String(attackers)}.html`);
  writeFileSync(file, page(attackers, false), 'utf8');
  console.log(
    `wrote ${file}: ${String(attackers)} declared of ${String(PERMANENTS)} a side, from the DSL example set`,
  );
}
const stagedFile = join(out, 'combat-staged.html');
writeFileSync(stagedFile, page(0, true), 'utf8');
console.log(`wrote ${stagedFile}: nothing declared, the band open for one, from the DSL example set`);
