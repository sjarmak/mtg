// @vitest-environment node
/**
 * The corner marks during an entrance, which is the quarter second `mtg-9edk`
 * did not measure.
 *
 * `mtg-9edk` took the badges off the card's name by anchoring them to the art
 * window, and `test/board-marks.test.ts` and `tools/corner-marks.ts` hold the
 * settled board to that. `mtg-swr1` is the same defect on a clock: the arrival
 * rule animated the card *and* the badges, and an anchor rectangle is the
 * anchor's box after its transforms, so the row followed the card up once
 * through the anchor and once more through its own copy of the keyframes. Two
 * rises of `ARRIVAL_RISE_REM` is 56px where one is 28, and the badges spent the
 * transient back on the name the fix had just cleared.
 *
 * A transient is exactly the thing a steady-state rig cannot see. `measurePage`
 * settles first — document complete, a drawn face, zero running animations — so
 * every existing browser rig measures the board *after* the entrance is over,
 * which is why every one of them passed while this was true.
 *
 * So this rig fires the animation itself, the way the board does. Both
 * entrances are pure CSS keyed to an element entering the document
 * (`styles/board/arrival.ts` argues why: React reconciles a permanent by kernel
 * object id, so only a card that was not there before gets a new element), and
 * replacing a subtree with a clone of itself is that same event. The animation
 * is then *paused and seeked* rather than sampled on a timer: a rig that
 * measures at whatever moment the read landed is a rig whose verdict moves with
 * machine load, and this one reads the same numbers on a busy machine as an idle
 * one.
 *
 * **Two surfaces, because it was one bug in two places.** The battlefield
 * arrival is what the bead reported. `styles/board/band.ts` had written the same
 * pair of selectors for a card entering the combat seam — deliberately, one
 * motion vocabulary — and inherited the defect with it. A rig that measured only
 * the reported surface would have left the seam broken and green.
 *
 * Motion is emulated as `no-preference`, which is the whole point of the
 * measurement: under `reduce` the sheet runs no animation at all and the row can
 * only ever be reported as fine. The `reduce` arm is the control, and it is
 * measured here too so a green from this file cannot come from the emulation
 * never reaching the page.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { GameSession, ObjectId, PlayerId } from '@mtg/kernel';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import type { BoardProps } from '../../src/board/Board';
import { boardPosition } from '../../src/routes/play/position';
import { PlayView } from '../../src/routes/play/PlayView';
import { ARRIVAL_MS } from '../../src/styles/board/arrival';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** The neutral example set: nothing here is a claim about a card. */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

const VIEWER = 0 as PlayerId;
const FAR = 1 as PlayerId;

function creatures(controller: PlayerId, count: number, sick: boolean) {
  return Array.from({ length: count }, (_unused, index) => ({
    card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
    controller,
    tapped: false,
    summoningSick: sick,
  }));
}

/**
 * Four permanents a side, every creature of the far seat's summoning sick.
 *
 * Four is the crowding `tools/corner-marks.ts` measured a real game reaching and
 * the width at which a board face is largest, so it is where a badge over the
 * name has the least excuse. Sickness is what puts a badge in the row at all:
 * the row's *origin* is the defect, so one badge on a face is enough to locate
 * it, and the hourglass is the badge a newly arrived creature actually wears.
 */
function board(): GameSession {
  const built = scenario({
    seed: 'ui/arrival-marks',
    battlefield: [
      ...creatures(FAR, 3, true),
      { card: LANDS[0], controller: FAR, tapped: false, summoningSick: false },
      ...creatures(VIEWER, 3, false),
      { card: LANDS[1], controller: VIEWER, tapped: false, summoningSick: false },
    ],
    hands: [[SPELLS[0]], [SPELLS[1]]],
    step: 'precombatMain',
    active: VIEWER,
    turn: 8,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: null,
    pending: pendingDecision(built.state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * A block in the seam, which is the one arrangement the combat band ever holds
 * both seats in — and therefore the arrangement `styles/board/band.ts` draws its
 * entrance for.
 *
 * The attack goes through `reduce` rather than being written into the state by
 * hand, so the attackers are tapped because the rules tapped them and the rig
 * measures a rotated face as well as an upright one. Staging is view state and
 * never reaches the kernel (`../../src/board/Battlefield.ts`), so it is written
 * onto the projection here exactly as `../../src/routes/play/table.ts` writes
 * it.
 */
function seam(): BoardProps {
  const built = scenario({
    seed: 'ui/arrival-marks-seam',
    battlefield: [
      ...creatures(FAR, 4, false),
      { card: LANDS[0], controller: FAR, tapped: false, summoningSick: false },
      ...creatures(VIEWER, 3, false),
    ],
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[1], SPELLS[2]],
    ],
    step: 'declareAttackers',
    active: FAR,
    turn: 10,
  });
  const attackers: readonly ObjectId[] = built.state.battlefield
    .filter((oid) => {
      const object = built.state.objects[oid];
      return object !== undefined && object.controller === FAR && object.card.kind === 'creature';
    })
    .slice(0, 2);
  expect(attackers, 'the stated attack has creatures to declare').toHaveLength(2);
  const declared = reduce(built.state, {
    type: 'declareAttackers',
    player: FAR,
    attackers: attackers.map((oid) => ({ oid, defender: VIEWER })),
  });
  const props = boardPosition(declared.state, VIEWER, ['You', 'Bot']);
  const attacking = props.opponent.battlefield.permanents.filter((permanent) => permanent.attacking === true);
  expect(attacking.length, 'attackers to stage a block against').toBeGreaterThan(0);
  // A counter on everything in the seam, and it is what makes the measurement
  // possible rather than decoration: the three facts a card in the band already
  // carries in the drawing — that it is attacking, that it is blocking, what its
  // size was derived from — are all `silent` marks (`../../src/board/Mark.ts`),
  // so a seam built from the kernel alone draws no visible badge at all and
  // there is nothing over the name to measure. A +1/+1 counter on a creature in
  // combat is an ordinary position, and it is the one badge both seats can wear
  // at once.
  const near = props.you.battlefield.permanents.map((permanent, index) => {
    if (permanent.card.kind !== 'creature') return permanent;
    const against = attacking[index % attacking.length];
    if (against === undefined) return permanent;
    return { ...permanent, counters: 1, stagedBlock: against.card.name, stagedBlockKey: against.key };
  });
  const far = props.opponent.battlefield.permanents.map((permanent) =>
    permanent.attacking === true ? { ...permanent, counters: 1 } : permanent,
  );
  return {
    ...props,
    you: { ...props.you, battlefield: { ...props.you.battlefield, permanents: near } },
    opponent: {
      ...props.opponent,
      battlefield: { ...props.opponent.battlefield, permanents: far },
    },
  };
}

function html(title: string, markup: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

function boardPage(game: GameSession): string {
  return html(
    'Arrival marks',
    renderToStaticMarkup(
      h(Shell, {
        mode: 'play',
        onSelectMode: () => undefined,
        children: h(PlayView, {
          session: game,
          viewer: VIEWER,
          names: ['You', 'Bot'],
          onChoose: () => undefined,
          autoPass: DEFAULT_AUTO_PASS,
          onAutoPass: () => undefined,
          onYield: () => undefined,
        }),
      }),
    ),
  );
}

/**
 * The seam in the chrome the play route wraps it in, which is what the band's
 * height share is scoped to (`../../src/styles/board/geometry.ts`). The route's
 * toolbar and rails are left off for the reason
 * `./combat-seat-edge.browser.test.ts` gives: nothing measured here is
 * downstream of them, and the session they need is the one thing a staged block
 * cannot be built from.
 */
function seamPage(props: BoardProps): string {
  return html(
    'Seam marks',
    renderToStaticMarkup(
      h(Shell, {
        mode: 'play',
        onSelectMode: () => undefined,
        children: h(
          'div',
          { className: 'mtg-play' },
          h('div', { className: 'mtg-play__table' }, h(Board, props)),
        ),
      }),
    ),
  );
}

/**
 * The far seat's battlefield slots, spelled as `styles/board/arrival.ts` scopes
 * its rule, and a combat entry, spelled as `styles/board/band.ts` scopes its
 * own.
 *
 * Written out rather than imported because the scope is what is under test: a
 * rig that asked the sheet which selector to fire would pass on a sheet that
 * fired the animation nowhere.
 */
const FAR_SLOT = ".mtg-board__side[data-seat='opponent'] .mtg-zone__body[data-layout='board'] .mtg-slot";
const COMBAT_ENTRY = '.mtg-combat__entry';

/**
 * Where in the transient the row is read.
 *
 * Zero is left out: it is the extreme of the travel and also the frame where the
 * card and its badges are both fully transparent, so an overlap there is
 * invisible on any sheet and a verdict from it says nothing. Every other sample
 * is a moment a player is looking at something, and the last one is the frame
 * the animation ends on.
 */
const SAMPLE_MS: readonly number[] = [1, ARRIVAL_MS / 4, ARRIVAL_MS / 2, (ARRIVAL_MS * 3) / 4, ARRIVAL_MS];

/**
 * Refire the entrance on every matching subtree, hold each animation at one
 * moment, and report what the badges cover.
 *
 * The measurement is `tools/corner-marks.ts`'s, in the unit that complaint was
 * written in: a `Range` over the name's own text node gives one rect per
 * character, a character whose rect meets a badge is a character the player
 * cannot read, and the characters come back as a string so a red says which
 * letters went. Each character is intersected with the name's own box first,
 * because the board face clips the name at `BOARD_NAME_LINES` and a `Range`
 * reports rects for lines that are painted nowhere.
 *
 * `getAnimations` flushes pending style and `getBoundingClientRect` flushes
 * layout, so the seek is applied before anything is read. The first sample that
 * covers a letter is the one reported, because the earliest failing frame is the
 * one worth naming.
 */
function measureExpression(root: string): string {
  return `(function () {
  var round = function (value) { return Math.round(value * 10) / 10; };
  var overlap = function (a, b) {
    var x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return { x: round(Math.max(0, x)), y: round(Math.max(0, y)) };
  };
  var charRects = function (element) {
    var node = element.firstChild;
    if (node === null || node.nodeType !== 3) return [];
    var text = node.nodeValue;
    var rects = [];
    for (var i = 0; i < text.length; i += 1) {
      var range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      rects.push({ ch: text.charAt(i), box: range.getBoundingClientRect() });
    }
    return rects;
  };
  var samples = ${JSON.stringify(SAMPLE_MS)};
  var animated = 0;
  var badgesSeen = 0;
  var readings = [];
  for (var s = 0; s < samples.length; s += 1) {
    var hosts = document.querySelectorAll(${JSON.stringify(root)});
    var covered = [];
    for (var i = 0; i < hosts.length; i += 1) {
      var fresh = hosts[i].cloneNode(true);
      hosts[i].replaceWith(fresh);
      var running = fresh.getAnimations({ subtree: true });
      animated += running.length;
      for (var a = 0; a < running.length; a += 1) {
        running[a].pause();
        running[a].currentTime = samples[s];
      }
      var slots = fresh.matches('.mtg-slot') ? [fresh] : fresh.querySelectorAll('.mtg-slot');
      for (var k = 0; k < slots.length; k += 1) {
        var card = slots[k].querySelector('.mtg-card');
        var row = slots[k].querySelector('.mtg-slot__marks');
        if (card === null || row === null) continue;
        var name = card.querySelector('.mtg-card__name');
        if (name === null) continue;
        var nameBox = name.getBoundingClientRect();
        if (nameBox.height === 0) continue;
        var cardBox = card.getBoundingClientRect();
        var rowBox = row.getBoundingClientRect();
        var drawn = [];
        var badges = row.querySelectorAll('.mtg-mark');
        for (var b = 0; b < badges.length; b += 1) {
          if (badges[b].getAttribute('data-silent') === 'true') continue;
          var badgeBox = badges[b].getBoundingClientRect();
          if (badgeBox.width === 0 && badgeBox.height === 0) continue;
          drawn.push(badgeBox);
        }
        badgesSeen += drawn.length;
        var rects = charRects(name).filter(function (entry) {
          var inside = overlap(entry.box, nameBox);
          return inside.x > 0.5 && inside.y > 0.5;
        });
        for (var c = 0; c < rects.length; c += 1) {
          for (var d = 0; d < drawn.length; d += 1) {
            var lap = overlap(drawn[d], rects[c].box);
            if (lap.x > 0.5 && lap.y > 0.5) { covered.push(rects[c].ch); break; }
          }
        }
        readings.push({
          at: samples[s],
          badges: drawn.length,
          rowTopFromCardTop: round(rowBox.top - cardBox.top),
          nameTopFromCardTop: round(nameBox.top - cardBox.top),
          nameBottomFromCardTop: round(nameBox.bottom - cardBox.top)
        });
      }
    }
    if (covered.length > 0) {
      return {
        animated: animated,
        badgesSeen: badgesSeen,
        at: samples[s],
        covered: covered.length,
        coveredText: covered.join(''),
        readings: readings.slice(-3)
      };
    }
  }
  return {
    animated: animated,
    badgesSeen: badgesSeen,
    at: null,
    covered: 0,
    coveredText: '',
    readings: readings.slice(-3)
  };
})()`;
}

interface Reading {
  readonly animated: number;
  readonly badgesSeen: number;
  readonly at: number | null;
  readonly covered: number;
  readonly coveredText: string;
  readonly readings: readonly Record<string, number>[];
}

/** The three viewports `mtg-swr1` named, largest first. */
const VIEWPORTS: readonly (readonly [number, number])[] = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
];

const SURFACES = [
  { name: 'the battlefield', root: FAR_SLOT },
  { name: 'the combat seam', root: COMBAT_ENTRY },
] as const;

describe('a card entering the table does not put its badges back on its name', () => {
  let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
  let dir = '';
  const file = new Map<string, string>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mtg-arrival-marks-'));
    file.set('the battlefield', join(dir, 'board.html'));
    file.set('the combat seam', join(dir, 'seam.html'));
    await writeFile(file.get('the battlefield') ?? '', boardPage(board()), 'utf8');
    await writeFile(file.get('the combat seam') ?? '', seamPage(seam()), 'utf8');
    try {
      chrome = await launchChrome(join(dir, 'profile'));
    } catch (error) {
      throw new Error(`could not start the browser: ${reason(error)}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (chrome !== null) await shutdownChrome(chrome);
    if (dir !== '') await rm(dir, { recursive: true, force: true });
  }, 60_000);

  for (const surface of SURFACES) {
    browserIt(
      `covers no letter of a card name at any moment of the entrance on ${surface.name}`,
      async () => {
        if (chrome === null) throw new Error('no browser');
        const path = file.get(surface.name) ?? '';
        const failures: string[] = [];
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const read = (await measurePage(
            chrome.client,
            path,
            width,
            height,
            measureExpression(surface.root),
            `${surface.name} at ${where}`,
            undefined,
            false,
          )) as unknown as Reading;
          // Two floors, because a rig that fired nothing and a rig that found no
          // badge both report zero covered letters and would otherwise pass.
          expect(read.animated, `${where}: the entrance fired on no element`).toBeGreaterThan(0);
          expect(read.badgesSeen, `${where}: no badge was drawn to measure`).toBeGreaterThan(0);
          if (read.covered > 0) {
            failures.push(
              `${where}: "${read.coveredText}" (${String(read.covered)}) at ${String(read.at)}ms, ${JSON.stringify(read.readings)}`,
            );
          }
        }
        // Every viewport measured before the verdict: which of the three broke
        // is the first thing a reader wants, and stopping at the first hides it.
        expect(failures, `${surface.name}: letters the badges covered mid-entrance`).toEqual([]);
      },
      180_000,
    );
  }

  browserIt(
    'runs no entrance at all for a viewer who asked for less motion, which is the control',
    async () => {
      if (chrome === null) throw new Error('no browser');
      for (const surface of SURFACES) {
        const read = (await measurePage(
          chrome.client,
          file.get(surface.name) ?? '',
          1440,
          900,
          measureExpression(surface.root),
          `${surface.name} under reduce`,
          undefined,
          true,
        )) as unknown as Reading;
        expect(
          read.animated,
          `${surface.name}: reduce ran an animation, so the emulation is not reaching the sheet`,
        ).toBe(0);
        expect(read.badgesSeen, `${surface.name}: no badge was drawn to measure`).toBeGreaterThan(0);
        expect(read.covered, `${surface.name}: ${read.coveredText}`).toBe(0);
      }
    },
    180_000,
  );
});
