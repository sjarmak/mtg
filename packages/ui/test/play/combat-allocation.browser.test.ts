// @vitest-environment node
/**
 * The table under an attack, which is the state the other allocation rig never
 * enters.
 *
 * `./table-allocation.browser.test.ts` measures a board at rest: its scenario is
 * built at `precombatMain` with no attack declared, so `data-combat` is `false`
 * on every page it renders and every claim it makes is a claim about the rest
 * layout. That matters because the two layouts are different rules rather than
 * one rule under different numbers. Off combat the spells row is a size query
 * container and the face is the largest card the row can hold on both axes; in
 * combat the container is deliberately absent, because size containment would
 * take the row's content out of its flex basis and change how the seam divides
 * the table (`src/styles/board/hand.ts` argues that at length), and what bounds
 * the face instead is a viewport arithmetic plus the slot's own height cap.
 *
 * So the combat board is held by a different pair of guards, and this file is
 * the measurement of that pair. `mtg-qun5` is why it exists: two captures from
 * 2026-08-16 (`references/UI_issues/`) show the viewer's own permanents drawn as
 * a horizontal slice with the first characters of every rotated line cut off,
 * both of them mid-combat, and the rig that was supposed to cover the tapped
 * clip could not have seen them because it never opens the seam.
 *
 * **The claim is containment, and it is asserted as boxes.** No part of a card's
 * ink falls outside the row it sits in, on either axis, at any of the board
 * states below. Nothing here pins a size: a face may be any size the two layouts
 * decide, and this file only says the row it is drawn in holds it. The one size
 * it reads is the face's own chrome, measured off that face rather than stated,
 * and it is a floor CSS cannot go under rather than a preference: it excludes a
 * slot too short to hold a card's own frame from the block-axis question.
 *
 * Measured in chrome-headless-shell over the two captured board states plus a
 * crowded one, at six viewports each. With `src/styles/board/slot.ts`'s height
 * guard on the rotated face (`min(71.59%, 100cqh)`) reduced to the share alone,
 * which is what the tree drew before `6141773`:
 *
 * | board                  | viewport | clipY | overhangY |
 * | ---------------------- | -------- | ----- | --------- |
 * | two tapped, far attacks | 1440x560 |   6.3 |      11.3 |
 * | twelve a side, tapped   | 1024x768 |   0   |       3.2 |
 * | twelve a side, tapped   | 1440x560 |  19.2 |      23.7 |
 *
 * With the guard, every one of those is 0, and so is every other cell.
 *
 * The harness is `../support/chrome.ts`; jsdom answers none of this, because it
 * performs no layout and `getBoundingClientRect` is zeros there.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/**
 * The neutral example set, for the reason its neighbor states: the claims here
 * are the sizes of boxes and none of them is about a card, so this file exports
 * with the rest of the lab.
 */
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

interface BoardSpec {
  readonly nearSpells: number;
  readonly nearLands: number;
  readonly farSpells: number;
  readonly farLands: number;
  /** Whether the near seat's permanents are turned, which is what rotates a face. */
  readonly nearTapped: boolean;
  /** Which seat declares, and how many creatures it declares with. */
  readonly attacker: 'near' | 'far';
  readonly attackers: number;
}

/**
 * A stated mid-combat position: the board is built one step early and the attack
 * is declared through `reduce`, so the seam holds what the kernel put there
 * rather than a hand-written `combat.attacks` the projection was never asked to
 * agree with.
 */
function board(spec: BoardSpec): GameSession {
  const attackerSeat: PlayerId = spec.attacker === 'near' ? 0 : 1;
  const battlefield = [
    ...Array.from({ length: spec.nearSpells }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller: 0 as PlayerId,
      tapped: spec.nearTapped,
      summoningSick: false,
    })),
    ...Array.from({ length: spec.nearLands }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller: 0 as PlayerId,
      tapped: index % 2 === 1,
      summoningSick: false,
    })),
    ...Array.from({ length: spec.farSpells }, (_unused, index) => ({
      card: SPELLS[(index + 2) % SPELLS.length] ?? SPELLS[0],
      controller: 1 as PlayerId,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: spec.farLands }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller: 1 as PlayerId,
      tapped: index % 2 === 0,
      summoningSick: false,
    })),
  ];
  const built = scenario({
    seed: 'ui/combat-allocation',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[1], SPELLS[2], LANDS[2], SPELLS[3]],
    ],
    step: 'declareAttackers',
    active: attackerSeat,
    turn: 10,
  });
  const attackers: readonly ObjectId[] = built.state.battlefield
    .filter((oid) => {
      const object = built.state.objects[oid];
      return object !== undefined && object.controller === attackerSeat && object.card.kind === 'creature';
    })
    .slice(0, spec.attackers);
  expect(attackers, 'the stated attack has creatures to declare').toHaveLength(spec.attackers);
  const declared = reduce(built.state, {
    type: 'declareAttackers',
    player: attackerSeat,
    attackers: attackers.map((oid) => ({ oid, defender: (attackerSeat === 0 ? 1 : 0) as PlayerId })),
  });
  const state: GameState = declared.state;
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [...built.events, ...declared.events],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function page(game: GameSession): string {
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Combat allocation</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Every face against its slot and its row, every mana tile against the lane that
 * holds it, and the two facts that say the page really is mid-combat.
 *
 * The tiles are measured against the *lane* rather than against their own band:
 * the band is `flex: none` and keeps its height whatever happens, so a lane with
 * no room for it overflows instead of squashing it, and the cut the second
 * capture shows is the lane's clip rather than the band's.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const faces = [...document.querySelectorAll(".mtg-board__spells > .mtg-slot[data-slot='play'] > .mtg-card")].map((face) => {
    const slot = face.parentElement;
    const row = slot.parentElement;
    const faceBox = face.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const name = face.querySelector('.mtg-card__name');
    const style = getComputedStyle(face);
    const chrome =
      parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    return {
      name: name === null ? '' : name.textContent,
      seat: slot.closest('.mtg-board__side').getAttribute('data-seat'),
      tapped: slot.getAttribute('data-tapped') === 'true',
      face: [round(faceBox.width), round(faceBox.height)],
      chrome: round(chrome),
      slot: [round(slotBox.width), round(slotBox.height)],
      row: [round(rowBox.width), round(rowBox.height)],
      overhangY: round(Math.max(0, slotBox.top - faceBox.top, faceBox.bottom - slotBox.bottom)),
      overhangX: round(Math.max(0, slotBox.left - faceBox.left, faceBox.right - slotBox.right)),
      clipY: round(Math.max(0, rowBox.top - faceBox.top, faceBox.bottom - rowBox.bottom)),
    };
  });
  const tiles = [...document.querySelectorAll(".mtg-board__side[data-seat='you'] .mtg-lands > .mtg-slot")].map((tile) => {
    const lane = tile.closest('.mtg-zone__body');
    const tileBox = tile.getBoundingClientRect();
    const laneBox = lane.getBoundingClientRect();
    return {
      box: [round(tileBox.width), round(tileBox.height)],
      clipY: round(Math.max(0, laneBox.top - tileBox.top, tileBox.bottom - laneBox.bottom)),
    };
  });
  const divider = document.querySelector('.mtg-board__divider');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    entries: document.querySelectorAll('.mtg-combat__entry').length,
    faces,
    tiles,
  };
})()`;

interface FaceReading {
  readonly name: string;
  readonly seat: string;
  readonly tapped: boolean;
  readonly face: readonly [number, number];
  /** Border plus padding across the face, read off the element rather than stated. */
  readonly chrome: number;
  readonly slot: readonly [number, number];
  readonly row: readonly [number, number];
  readonly overhangY: number;
  readonly overhangX: number;
  readonly clipY: number;
}

interface TileReading {
  readonly box: readonly [number, number];
  readonly clipY: number;
}

/**
 * The two positions the captures show, plus a crowded one.
 *
 * `far-attacks-tapped` is `view_issue3.png`: the near seat holds two turned
 * creatures and five lands while the opponent declares one attacker, which is
 * the state whose rotated names came out cut. `near-attacks` is
 * `view_issue2.png`, where the viewer's own creatures have all left the row for
 * the seam and the lane is left holding an empty row over a mana band. The
 * upright pair is the control for the tapped one: a quarter turn is what makes
 * the face's width the row's height problem, so the same board untapped says
 * whether a finding is about rotation or about the row.
 */
const BOARDS: ReadonlyMap<string, BoardSpec> = new Map([
  [
    'far-attacks-tapped',
    {
      nearSpells: 2,
      nearLands: 5,
      farSpells: 2,
      farLands: 4,
      nearTapped: true,
      attacker: 'far',
      attackers: 1,
    },
  ],
  [
    'far-attacks-upright',
    {
      nearSpells: 2,
      nearLands: 5,
      farSpells: 2,
      farLands: 4,
      nearTapped: false,
      attacker: 'far',
      attackers: 1,
    },
  ],
  [
    'near-attacks',
    {
      nearSpells: 4,
      nearLands: 6,
      farSpells: 4,
      farLands: 4,
      nearTapped: false,
      attacker: 'near',
      attackers: 4,
    },
  ],
  [
    'crowded-tapped',
    {
      nearSpells: 12,
      nearLands: 8,
      farSpells: 12,
      farLands: 8,
      nearTapped: true,
      attacker: 'far',
      attackers: 4,
    },
  ],
]);

/**
 * The four viewports its neighbor states, plus the width the 2026-08-16 captures
 * came from and the short table that squashes a slot on the block axis. 1440x560
 * is where the removed guard shows the largest cut, and it is the cell that
 * makes this file a gate rather than a description.
 */
const VIEWPORTS = [
  [1440, 900],
  [1394, 824],
  [1280, 800],
  [1024, 768],
  [1392, 766],
  [1440, 560],
] as const;

/** One CSS pixel, because a percentage edge lands on either of two device pixels. */
const TOLERANCE_PX = 1;

describe('a table under an attack holds every card it draws', () => {
  browserIt(
    'keeps every face inside its row and every mana tile inside its lane',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-allocation-'));
      const pages = new Map<string, string>();
      for (const [label, spec] of BOARDS) {
        const file = join(directory, `board-${label}.html`);
        await writeFile(file, page(board(spec)), 'utf8');
        pages.set(label, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [label, file] of pages) {
          const spec = BOARDS.get(label);
          if (spec === undefined) throw new Error(`no spec for ${label}`);
          for (const [width, height] of VIEWPORTS) {
            const where = `${label} at ${String(width)}x${String(height)}`;
            const result = await measurePage(
              chrome.client,
              file,
              width,
              height,
              MEASURE,
              'combat allocation',
            );
            expect(result['viewport']).toEqual([width, height]);

            // The page is mid-combat, said twice: the seam is open and it holds
            // the attack that was declared. Without this the containment claims
            // below would pass on a board at rest, which is the state the other
            // rig already measures and the one these captures are not.
            expect(result['combat'], `${where} seam`).toBe('true');
            expect(result['entries'], `${where} attackers in the seam`).toBe(spec.attackers);

            const faces = result['faces'] as readonly FaceReading[];
            const near = spec.nearSpells - (spec.attacker === 'near' ? spec.attackers : 0);
            const far = spec.farSpells - (spec.attacker === 'far' ? spec.attackers : 0);
            expect(faces, `${where} face count`).toHaveLength(near + far);

            for (const face of faces) {
              expect(
                face.overhangX,
                `${where}: ${face.name} outside its slot horizontally`,
              ).toBeLessThanOrEqual(TOLERANCE_PX);
              expect(face.clipY, `${where}: ${face.name} cut by its row`).toBeLessThanOrEqual(TOLERANCE_PX);
              // A slot shorter than the face's own two bands is a table with no
              // cards on it in any readable sense, so the block axis is not
              // asked of it. The chrome is read off the face because it is a
              // share of the face's width rather than a number this file can
              // state (`./table-allocation.browser.test.ts` carries the
              // arithmetic), and no slot in this rig is under it today.
              if (face.slot[1] >= face.chrome) {
                expect(
                  face.overhangY,
                  `${where}: ${face.name} outside its slot vertically`,
                ).toBeLessThanOrEqual(TOLERANCE_PX);
              }
            }

            // And the mana base, which is the second capture's symptom: a lane
            // with no room left drew its land tiles cut off at the phase bar.
            const tiles = result['tiles'] as readonly TileReading[];
            expect(tiles, `${where} mana tiles`).toHaveLength(spec.nearLands);
            for (const [index, tile] of tiles.entries()) {
              expect(tile.clipY, `${where}: mana tile ${String(index)} cut by its lane`).toBeLessThanOrEqual(
                TOLERANCE_PX,
              );
            }
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
          `combat allocation Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    // Twenty-four measurements at about 70ms each on a quiet box; the budget is
    // its neighbor's, for the reason the root config states about load.
    60_000,
  );
});
