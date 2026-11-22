// @vitest-environment node
/**
 * How big a battlefield card is allowed to be mid-combat, held to the number.
 *
 * `mtg-zhbz`. Off combat the spells row is a size container and the face is the
 * largest card that fits it on both axes (`6141773`). In combat the container is
 * deliberately absent, because size containment zeroes a flex base size and
 * `../../src/styles/board/band.ts` gives the near lane a different grow factor,
 * so containing the row there would change how the seam divides the table. What
 * bounds the face instead is a subtraction from the viewport:
 *
 *     --board-face-max: clamp(4.5rem, calc((100vh - 29.875rem) / 4), 10rem)
 *
 * declared on the combat row at `min-width: 901px`, in
 * `../../src/styles/board/hand.ts`.
 *
 * **Nothing held that rule.** Deleting the whole `@media` block from the sheet
 * on 2026-08-27 left `./combat-allocation.browser.test.ts` green, and left both
 * the `browser` project and `--project unit packages/ui/test` byte-identical to
 * baseline. The bead's 2026-08-16 note had credited that file with catching it;
 * it does not, because its claims are containment claims and the deletion clips
 * nothing. This file is the missing half.
 *
 * # The numbers, and where they come from
 *
 * `clamp` at 16px per rem, so the arithmetic is `(viewportHeight - 478) / 4`
 * bounded to [72, 160]:
 *
 * | viewport | arithmetic | drawn | which bound is doing it            |
 * | -------- | ---------- | ----- | ---------------------------------- |
 * | 1440x900 |      105.5 | 105.5 | the subtraction                    |
 * | 1394x824 |       86.5 |  86.5 | the subtraction                    |
 * | 1280x800 |       80.5 |  80.5 | the subtraction                    |
 * | 1024x768 |       72.5 |  72.0 | neither: the row's own basis is 72 |
 * | 1392x766 |       72.0 |  72.0 | the two agree exactly              |
 * | 1440x560 |       20.5 |  72.0 | the 4.5rem floor                   |
 *
 * The pinned column is `drawn`, because that is what a player sees and it is
 * what a change to the constant moves. With the rule deleted the same six cells
 * read 124.0, 117.4, 92.0, 72.0, 92.0 and 89.8, so five of the six go red; the
 * 1024x768 cell is the one the ceiling was never deciding.
 *
 * # What this file does not claim
 *
 * It does not claim 29.875 is the best number. `../../tools/combat-cap.ts` swept
 * ten ceilings across these boards and viewports and found no arm that wins:
 * nothing clips at any of them, and the number trades card size on a sparse
 * board against how many permanents are reachable without scrolling on a crowded
 * one. That report is in the tool's docblock. This file holds the number the
 * sheet ships so that moving it is a decision somebody makes rather than a
 * regression nobody sees.
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
 * The widest card drawn on either battlefield row, rotation-normalized.
 *
 * A tapped slot is square with the card's height for a side, so a turned card's
 * width is its bounding box's *height*; comparing that to an upright card's box
 * width would compare a height to a width and report the ceiling as broken on
 * every board that has one of each.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  let widest = 0;
  let faces = 0;
  for (const slot of document.querySelectorAll(".mtg-board__spells > .mtg-attach > .mtg-slot[data-slot='play']")) {
    const face = slot.querySelector(':scope > .mtg-card');
    if (face === null) continue;
    faces += 1;
    const box = face.getBoundingClientRect();
    widest = Math.max(widest, slot.getAttribute('data-tapped') === 'true' ? box.height : box.width);
  }
  const divider = document.querySelector('.mtg-board__divider');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    faces,
    widest: round(widest),
  };
})()`;

/**
 * The widest face the combat ceiling allows at each viewport, in CSS px.
 *
 * Written out rather than derived from `COMBAT_BOARD_VERTICAL_CHROME_REM`: a
 * test that recomputes the constant it is holding moves with it and holds
 * nothing. The docblock above has the arithmetic behind each cell.
 */
const CEILING_PX: ReadonlyMap<string, number> = new Map([
  ['1440x900', 105.5],
  ['1394x824', 86.5],
  ['1280x800', 80.5],
  ['1024x768', 72],
  ['1392x766', 72],
  ['1440x560', 72],
]);

/** One CSS pixel, because a percentage edge lands on either of two device pixels. */
const TOLERANCE_PX = 1;

describe('the combat board draws the card its ceiling allows', () => {
  browserIt(
    'holds the widest face to (100vh - 29.875rem) / 4, floored and capped',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-cap-'));
      const pages = new Map<string, string>();
      for (const [label, spec] of COMBAT_BOARDS) {
        const file = join(directory, `board-${label}.html`);
        await writeFile(file, combatPage(combatBoard(spec), { title: 'Combat cap' }), 'utf8');
        pages.set(label, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of COMBAT_VIEWPORTS) {
          const viewport = `${String(width)}x${String(height)}`;
          const ceiling = CEILING_PX.get(viewport);
          expect(ceiling, `no stated ceiling for ${viewport}`).toBeDefined();
          if (ceiling === undefined) continue;
          // The widest card anywhere on the table, not per board: the ceiling is
          // one declaration over both rows, and a board whose row is too crowded
          // to reach it would report a smaller face that says nothing about the
          // rule.
          let widest = 0;
          let widestAt = '';
          for (const [label, file] of pages) {
            const result = await measurePage(chrome.client, file, width, height, MEASURE, 'combat cap');
            expect(result['viewport']).toEqual([width, height]);
            // Said out loud, because every claim below is a claim about the
            // combat layout and the rest layout is a different rule that would
            // pass a weaker version of it.
            expect(result['combat'], `${label} at ${viewport} seam`).toBe('true');
            expect(result['faces'], `${label} at ${viewport} has cards to measure`).toBeGreaterThan(0);
            const face = Number(result['widest']);
            if (face > widest) {
              widest = face;
              widestAt = label;
            }
          }
          expect(
            widest,
            `at ${viewport} the widest combat face is ${String(widest)}px on ${widestAt}, and the ceiling is ${String(ceiling)}px`,
          ).toBeGreaterThanOrEqual(ceiling - TOLERANCE_PX);
          expect(
            widest,
            `at ${viewport} the widest combat face is ${String(widest)}px on ${widestAt}, over the ${String(ceiling)}px ceiling`,
          ).toBeLessThanOrEqual(ceiling + TOLERANCE_PX);
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
          `combat cap Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    // Twenty-four measurements at about 70ms each on a quiet box; the budget is
    // its neighbor's, for the reason the root config states about load.
    60_000,
  );
});
