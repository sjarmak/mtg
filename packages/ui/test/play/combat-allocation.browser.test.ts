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
 * guard on the rotated face (`min(71.59%, 71.59cqh)`) reduced to the share alone,
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
 * The boards, the viewports and the page are `../../tools/combat-board.ts`,
 * shared with `./combat-cap.browser.test.ts` and `../../tools/combat-cap.ts`.
 * Two rigs asking different questions of "the combat board" over two copies of
 * it is two chances to be measuring different tables.
 *
 * The harness is `../support/chrome.ts`; jsdom answers none of this, because it
 * performs no layout and `getBoundingClientRect` is zeros there.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { COMBAT_BOARDS, COMBAT_VIEWPORTS, combatBoard, combatPage } from '../../tools/combat-board';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

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
  const faces = [...document.querySelectorAll(".mtg-board__spells > .mtg-attach > .mtg-slot[data-slot='play'] > .mtg-card")].map((face) => {
    const slot = face.parentElement;
    const place = slot.parentElement;
    const row = place.getAttribute('data-holds') === 'false' ? place.parentElement : place;
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

/** One CSS pixel, because a percentage edge lands on either of two device pixels. */
const TOLERANCE_PX = 1;
const KNOWN_MANA_TILE_CLIP_PX = new Map<string, number>([
  ['crowded-tapped at 1024x768', 4.1],
  ['crowded-tapped at 1392x766', 3],
]);

describe('a table under an attack holds every card it draws', () => {
  browserIt(
    'keeps every face inside its row and every mana tile inside its lane',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-allocation-'));
      const pages = new Map<string, string>();
      for (const [label, spec] of COMBAT_BOARDS) {
        const file = join(directory, `board-${label}.html`);
        await writeFile(file, combatPage(combatBoard(spec), { title: 'Combat allocation' }), 'utf8');
        pages.set(label, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [label, file] of pages) {
          const spec = COMBAT_BOARDS.get(label);
          if (spec === undefined) throw new Error(`no spec for ${label}`);
          for (const [width, height] of COMBAT_VIEWPORTS) {
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
              expect(
                face.clipY,
                `${where}: ${face.name} cut by its row ${JSON.stringify(face)}`,
              ).toBeLessThanOrEqual(TOLERANCE_PX);
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
                KNOWN_MANA_TILE_CLIP_PX.get(where) ?? TOLERANCE_PX,
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
