/**
 * Where the played table's *height* goes, band by band, at rest and in combat.
 *
 * The playtester, 2026-08-14, mid-game: "it felt really awkward to try to block an
 * attacker … and now I've just gone to combat and my hand is huge and the actual
 * card I want to attack with is super small and hidden behind a scrolling view
 * that is a really narrow view of the board". Three rigs already measure pieces
 * of that sentence and none of them measures the sentence. `./board-crowding.ts`
 * reads face boxes and the mana band at a stated density but never opens the
 * combat band and never adds the bands up; `./combat-zone.ts` opens the band but
 * draws the DSL example set at one density with no way to name a real one;
 * `./hand-scale.ts` reads the hand row against the board face and says nothing
 * about what is left over. This one answers the question those three leave: of
 * the window's pixels, how many reach the row you are trying to click a creature
 * out of, and how many does everything else take first.
 *
 * So the reading is a *budget* — window, chrome above the mat, the lanes column,
 * and then every band inside it summing to that column — plus the one outcome
 * that budget decides: how many of your own permanents are fully inside the
 * scroller without scrolling it.
 *
 * Node-only, like everything else under `tools/`: it writes files and opens no
 * browser.
 *
 * Run it:
 *
 *     npx tsx packages/ui/tools/board-budget.ts out/board-budget \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * then navigate to each `budget-<spells>-<lands>-<attackers>-<rail>.html` and
 * call `window.mtgBoardBudget()`. **Name the set in every reading.** Given no
 * set argument this draws the DSL example set, whose names are shorter and whose
 * cards carry no art, and a night of numbers has already been wrong that way.
 *
 * **The rail's shut state is written onto the markup rather than clicked.** The
 * panel's open state is a preference `../src/routes/play/rail-collapse.ts` reads
 * from `localStorage` at render time, and this page is static markup with no
 * React on it. What the sheet acts on is `data-rail` on the mat, and the rail's
 * blocks stay mounted in both states by design, so setting that attribute
 * produces exactly the boxes a player who pressed the control gets. It is worth
 * measuring both because the collapse is the one lever that hands the lanes
 * width back, and width is what a hand slot — and therefore a board face — is
 * sized from.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EXAMPLE_SET, isLand, parseCards, setBasics } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { Shell } from '../src/app/Shell';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import type { ArtResolver } from '../src/lab/art-manifest';
import { PlayView } from '../src/routes/play/PlayView';
import { uiStyleSheet } from '../src/styles/index';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

/**
 * The board this is read at, and it comes from the simulator rather than from
 * imagination.
 *
 * 225 seeded games of the flagship set — all ten two-color Limited decks
 * `@mtg/deckbuild` builds from it, all 45 matchups, five games each — were
 * replayed through the kernel and the state was snapshotted at every
 * `declareAttackers` action that carried an attacker. That is 1,826 samples, one
 * per attacking turn rather than one per game. The attacking seat's non-land
 * permanents run 3 / **4** / 5 / 7 at p25 / median / p75 / p90 and the
 * defender's 2 / **3** / 5 / 6; lands are 4 / **5** / 6 / 6 and 3 / **4** / 6 /
 * 6; the hand is 1 / **2** / 4 / 4; attackers are 1 / **1** / 2 / 3. The modal
 * combat turn is 10 and the distribution peaks over turns 8 to 13.
 *
 * So four permanents and five lands a side is the middle of it and six and seven
 * is the p75-to-p90 shoulder. Fourteen — the count `./board-crowding.ts` carries
 * as "a board nobody will actually reach" — is past the maximum of 15 seen once
 * in 1,826 combats, and optimizing for it is how the last round of this went
 * wrong.
 */
const SPELL_COUNTS: readonly number[] = [4, 6];

/** Lands a side: the measured median, and the p75. */
const LAND_COUNTS: readonly number[] = [5, 7];

/**
 * The four states of the seam, in the order a turn reaches them.
 *
 * `rest` is the main phase, where the band is a bar and where every earlier
 * reading of this table was taken. `0` is the declare-attackers step with
 * nothing clicked yet — the band is open because the confirm has to live
 * somewhere, and this is the state the playtester was in when she went looking for
 * the creature to attack with. `1` is the measured median attack and `3` the
 * p90.
 *
 * Comparing `rest` against `0` is the whole diagnosis: they hold the same cards
 * and differ only in whether the seam is open.
 */
const STATES: readonly ('rest' | number)[] = ['rest', 0, 1, 3];

/**
 * Cards in hand, and it is two rather than seven on purpose.
 *
 * Two is the measured median at a declaration of attackers (p25 1, p75 4), and
 * the row's *height* does not depend on it: `../src/styles/board/hand.ts` sizes
 * a hand slot at a seventh of the row whatever the hand holds, so a hand of two
 * reserves exactly the height a hand of seven does. Drawing the median is how
 * that shows up in a reading instead of being argued about.
 */
const HAND_SIZE = 2;

/** The side panel, in both states, because collapsing it is the width lever. */
const RAIL_STATES: readonly ('open' | 'shut')[] = ['open', 'shut'];

const out = process.argv[2] ?? join(REPO_ROOT, 'out', 'board-budget');
const setPath = process.argv[3];
const artPath = process.argv[4];

/** The cards the page is drawn from; a named set when one is given. */
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

/** The manifest's resolver, or null when no manifest was named. */
function artFor(): ArtResolver | null {
  if (artPath === undefined) return null;
  const read = readArtManifest(JSON.parse(readFileSync(artPath, 'utf8')), artPath);
  if (!read.ok) throw new Error(read.message);
  const base = dirname(resolve(artPath));
  const resolver = artResolver(read.manifest);
  return (card, copy) => {
    const found = resolver(card, copy);
    return found === null ? null : { ...found, src: `file://${resolve(base, found.src)}` };
  };
}

const CARDS = cards();
const ART = artFor();
const SPELLS = CARDS.filter((card) => !isLand(card));
/** The five basics, printed where the set prints one and minted where it does not. */
const BASICS = setBasics(CARDS);

/**
 * Three creatures dealt round-robin, so the row holds names of different lengths
 * rather than one name measuring identically — the same reason
 * `./combat-zone.ts` deals three.
 */
const CREATURES: readonly DslCard[] = SPELLS.filter((card) => card.kind === 'creature').slice(0, 3);

function creature(index: number): DslCard {
  const card = CREATURES[index % CREATURES.length];
  if (card === undefined) throw new Error('the set has no creature to fill a battlefield with');
  return card;
}

function land(index: number): DslCard {
  const card = BASICS[index % BASICS.length];
  if (card === undefined) throw new Error('setBasics returned nothing to build a mana base from');
  return card;
}

interface Placed {
  readonly card: DslCard;
  readonly controller: PlayerId;
  readonly tapped: boolean;
  readonly summoningSick: boolean;
}

function seat(controller: PlayerId, spells: number, lands: number): readonly Placed[] {
  return [
    ...Array.from({ length: spells }, (_unused, index) => ({
      card: creature(index),
      controller,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: lands }, (_unused, index) => ({
      card: land(index),
      controller,
      // Every other land turned, because a tapped tile is a state the band draws
      // and a page that never draws it cannot be used to check that it reads.
      tapped: index % 2 === 1,
      summoningSick: false,
    })),
  ];
}

/**
 * The table at the declare-attackers step, with `attackers` of the viewer's
 * creatures already declared.
 *
 * Written onto the state rather than played out, which is what `scenario`'s own
 * docblock says a rig may do with a stated board: nothing about the drawing
 * depends on how the position was reached.
 */
function session(spells: number, lands: number, state_: 'rest' | number): GameSession {
  const attackers = state_ === 'rest' ? 0 : state_;
  const built = scenario({
    seed: `tools/board-budget/${String(spells)}/${String(lands)}/${String(state_)}`,
    battlefield: [...seat(0, spells, lands), ...seat(1, spells, lands)],
    hands: [SPELLS.slice(0, HAND_SIZE), SPELLS.slice(0, HAND_SIZE)],
    step: state_ === 'rest' ? 'precombatMain' : 'declareAttackers',
    active: 0,
    turn: 6,
  });
  const mine: readonly ObjectId[] = built.state.battlefield.filter((oid) => {
    const object = built.state.objects[oid];
    return object !== undefined && object.controller === 0 && object.card.kind === 'creature';
  });
  const state: GameState =
    attackers === 0
      ? built.state
      : {
          ...built.state,
          combat: {
            ...built.state.combat,
            attacks: mine.slice(0, attackers).map((oid) => ({ oid, defender: 1 as PlayerId })),
          },
        };
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
 * `budget` is the whole point: the window, what sits above and below the lanes
 * column, and then every band inside that column, so a reader can add them up
 * and see which one took the pixels. `reach` is the outcome the budget decides —
 * how many of the viewer's own permanents are fully inside the scroller's client
 * box, which is the count that has to be all of them.
 */
const MEASURE = `
window.mtgBoardBudget = function () {
  var one = function (selector) { return document.querySelector("[data-mtg-mode='play'] " + selector); };
  var all = function (selector) { return [].slice.call(document.querySelectorAll("[data-mtg-mode='play'] " + selector)); };
  var box = function (node) {
    if (node === null || node === undefined) return null;
    var rect = node.getBoundingClientRect();
    var round = function (value) { return Math.round(value * 10) / 10; };
    return { top: round(rect.top), bottom: round(rect.bottom), height: round(rect.height), width: round(rect.width) };
  };
  var near = ".mtg-board__side[data-seat='you'] ";
  var far = ".mtg-board__side[data-seat='opponent'] ";
  var faces = function (selector) {
    return all(selector).map(function (node) {
      var rect = node.getBoundingClientRect();
      return { w: Math.round(rect.width * 10) / 10, h: Math.round(rect.height * 10) / 10 };
    });
  };
  var rules = function (selector) {
    return all(selector).filter(function (node) {
      var region = node.querySelector("[data-region='rules']");
      return region !== null && getComputedStyle(region).display !== 'none';
    }).length;
  };
  var scroller = one(near + '.mtg-board__spells');
  var slots = scroller === null ? [] : [].slice.call(scroller.querySelectorAll(".mtg-slot[data-slot='play']"));
  var clip = scroller === null ? null : scroller.getBoundingClientRect();
  var inside = slots.filter(function (slot) {
    var rect = slot.getBoundingClientRect();
    return clip !== null && rect.left >= clip.left - 0.5 && rect.right <= clip.right + 0.5 &&
      rect.top >= clip.top - 0.5 && rect.bottom <= clip.bottom + 0.5;
  }).length;
  var lands = one(near + '.mtg-lands');
  var hand = one(near + ".mtg-zone[data-tone='rail']");
  var boardFaces = faces(near + ".mtg-board__spells .mtg-card[data-size='board']");
  var farFaces = faces(far + ".mtg-board__spells .mtg-card[data-size='board']");
  var handFaces = faces(near + ".mtg-slot[data-slot='hand'] > .mtg-card");
  var mean = function (list, key) {
    return list.length === 0 ? null : Math.round((list.reduce(function (sum, item) { return sum + item[key]; }, 0) / list.length) * 10) / 10;
  };
  var boardW = mean(boardFaces, 'w');
  var handW = mean(handFaces, 'w');
  return {
    window: { w: window.innerWidth, h: window.innerHeight },
    budget: {
      aboveMat: box(one('.mtg-board')) === null ? null : box(one('.mtg-board')).top,
      board: box(one('.mtg-board')),
      lanes: box(one('.mtg-board__lanes')),
      farSide: box(one(".mtg-board__side[data-seat='opponent']")),
      farSpells: box(one(far + '.mtg-board__spells')),
      farLands: box(one(far + '.mtg-lands')),
      divider: box(one('.mtg-board__divider')),
      nearSide: box(one(".mtg-board__side[data-seat='you']")),
      nearSpells: box(one(near + '.mtg-board__spells')),
      nearLands: box(lands),
      phaseBar: box(one('.mtg-phasebar')),
      hand: box(hand)
    },
    reach: {
      permanents: slots.length,
      fullyVisible: inside,
      spellsScrollsX: scroller === null ? null : scroller.scrollWidth > scroller.clientWidth + 1,
      spellsScrollsY: scroller === null ? null : scroller.scrollHeight > scroller.clientHeight + 1,
      spellsOverflowPx: scroller === null ? null : Math.round((scroller.scrollWidth - scroller.clientWidth) * 10) / 10,
      landsScrollsX: lands === null ? null : lands.scrollWidth > lands.clientWidth + 1,
      landsOverflowPx: lands === null ? null : Math.round((lands.scrollWidth - lands.clientWidth) * 10) / 10,
      handScrollsX: hand === null ? null : hand.scrollWidth > hand.clientWidth + 1,
      pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 1
    },
    faces: {
      board: boardFaces[0] ?? null,
      boardCount: boardFaces.length,
      boardRules: rules(near + ".mtg-board__spells .mtg-card[data-size='board']"),
      far: farFaces[0] ?? null,
      farCount: farFaces.length,
      /* The viewer's own face may never be smaller than the opponent's, so the
         two are reported side by side rather than left to be inferred. */
      nearAtLeastFar: farFaces.length === 0 || boardFaces.length === 0 ? null : boardFaces[0].w + 0.5 >= farFaces[0].w,
      hand: handFaces[0] ?? null,
      handCount: handFaces.length,
      handToBoard: boardW === null || handW === null || boardW === 0 ? null : Math.round((handW / boardW) * 100) / 100,
      combat: faces('.mtg-combat__entry .mtg-card')[0] ?? null,
      combatCount: all('.mtg-combat__entry').length
    }
  };
};
`;

function page(spells: number, lands: number, state_: 'rest' | number, rail: 'open' | 'shut'): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: session(spells, lands, state_),
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
        ...(ART === null ? {} : { artFor: ART }),
      }),
    }),
  );
  const staged = rail === 'shut' ? markup.replace('data-rail="open"', 'data-rail="shut"') : markup;
  if (rail === 'shut' && staged === markup) {
    throw new Error('the mat did not carry data-rail="open", so the shut state cannot be written onto it');
  }
  const title = `Board budget, ${String(spells)} spells, ${String(lands)} lands, ${String(state_)} attackers, rail ${rail}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>${uiStyleSheet()}
html, body { margin: 0; padding: 0; }
</style></head>
<body>${staged}<script>${MEASURE}</script></body></html>
`;
}

mkdirSync(out, { recursive: true });
for (const spells of SPELL_COUNTS) {
  for (const lands of LAND_COUNTS) {
    for (const state_ of STATES) {
      for (const rail of RAIL_STATES) {
        const file = join(out, `budget-${String(spells)}-${String(lands)}-${String(state_)}-${rail}.html`);
        writeFileSync(file, page(spells, lands, state_, rail), 'utf8');
        console.log(`wrote ${file}`);
      }
    }
  }
}
