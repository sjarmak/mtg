// @vitest-environment node
/**
 * The two approved small-hand policies compose without widening either one.
 *
 * Sparse combat is a labeled 56px thumbnail rail (`mtg-645p`). Crowding may
 * narrow that rail to the approved 48px crowded/phone size (`mtg-0sq.1`), but
 * it may never restore the ordinary full-size hand. In both cases the smallest
 * battlefield face remains larger than the hand by the deliberate 56/72 upper
 * bound. jsdom answers none of this: it performs no layout and every rect is
 * zero.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { COMBAT_BOARDS, COMBAT_VIEWPORTS, combatBoard, combatPage } from '../../tools/combat-board';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/**
 * The crowded board and its control, both mid-combat.
 *
 * `crowded-tapped` puts twelve distinct permanents a side on the table, eight in
 * a spells row after combat has lifted attackers, and `far-attacks-upright`
 * puts two. The fixture gives every spell a distinct identity so the product's
 * ten-place pile threshold cannot erase the density this geometry gate states.
 */
const CROWDED = 'crowded-tapped';
const SPARSE = 'far-attacks-upright';

/**
 * The hand face the combat cap allows, in CSS px.
 *
 * `COMBAT_HAND_FACE_MAX_REM` is 3.5 and a rem is 16px here. Written out rather
 * than imported and multiplied, for the reason `./combat-cap.browser.test.ts`
 * writes its own table out: a test that recomputes the constant it is holding
 * moves with it and holds nothing.
 *
 * One number for all six viewports, and that is a measurement rather than an
 * assumption — the cap is the binding term on every one of them, which is what
 * makes the sparse board draw 56 at 1440x900 and at 1440x560 alike.
 */
const COMBAT_HAND_PX = 56;

/** One CSS pixel, because a percentage edge lands on either of two device pixels. */
const TOLERANCE_PX = 1;

const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const board = document.querySelector('.mtg-board');
  const side = document.querySelector(".mtg-board__side[data-seat='you']");
  let hand = 0;
  let held = 0;
  for (const slot of side.querySelectorAll(".mtg-slot[data-slot='hand']:not([data-empty='true'])")) {
    held += 1;
    hand = Math.max(hand, slot.getBoundingClientRect().width);
  }
  const battlefield = [...side.querySelectorAll(".mtg-board__spells .mtg-card[data-size='board']")].map((face) => {
    const slot = face.closest(".mtg-slot[data-slot='play']");
    const box = face.getBoundingClientRect();
    return slot?.getAttribute('data-tapped') === 'true' ? box.height : box.width;
  });
  const handHead = side.querySelector(".mtg-zone[data-tone='rail'] > .mtg-zone__head");
  const divider = document.querySelector('.mtg-board__divider');
  return {
    cap: getComputedStyle(board).getPropertyValue('--hand-face-cap').trim(),
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    represented: [...document.querySelectorAll('.mtg-board__spells')].map((row) =>
      [...row.children].reduce((count, place) => {
        const badge = place.querySelector('.mtg-permanent-pile__count');
        return count + (badge === null ? 1 : Number(badge.textContent));
      }, 0)
    ),
    held,
    hand: round(hand),
    board: round(Math.min(...battlefield)),
    handLabel: handHead === null ? null : {
      display: getComputedStyle(handHead).display,
      text: handHead.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    },
  };
})()`;

interface Reading {
  readonly cap: string;
  readonly combat: string | null;
  readonly represented: readonly number[];
  readonly held: number;
  readonly hand: number;
  readonly board: number;
  readonly handLabel: { readonly display: string; readonly text: string } | null;
}

describe('combat and crowding compose as thumbnail-hand policies', () => {
  browserIt(
    'holds the hand to COMBAT_HAND_FACE_MAX_REM on a board with eight permanents on it',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-crowded-combat-'));
      const pages = new Map<string, string>();
      for (const label of [CROWDED, SPARSE]) {
        const spec = COMBAT_BOARDS.get(label);
        if (spec === undefined) throw new Error(`the combat fixture has no ${label} board`);
        const file = join(directory, `${label}.html`);
        await writeFile(file, combatPage(combatBoard(spec), { title: 'Crowded combat cap' }), 'utf8');
        pages.set(label, file);
      }
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        const launched = await launchChrome(join(directory, 'chrome'));
        chrome = launched;
        for (const [width, height] of COMBAT_VIEWPORTS) {
          const at = `${String(width)}x${String(height)}`;
          const read = async (label: string): Promise<Reading> =>
            (await measurePage(
              launched.client,
              pages.get(label) ?? '',
              width,
              height,
              MEASURE,
              `crowded combat cap ${label}`,
            )) as unknown as Reading;
          const crowded = await read(CROWDED);
          const sparse = await read(SPARSE);
          const detail = `${at} ${JSON.stringify({ crowded, sparse })}`;

          // The two boards differ in one thing, and both are in combat. Without
          // this the rest could pass on two identical tables.
          expect(crowded.combat, `crowded in combat ${detail}`).toBe('true');
          expect(sparse.combat, `sparse in combat ${detail}`).toBe('true');
          expect(
            Math.max(...crowded.represented),
            `crowded represented permanents ${detail}`,
          ).toBeGreaterThanOrEqual(8);
          expect(Math.max(...sparse.represented), `sparse represented permanents ${detail}`).toBeLessThan(8);
          expect(crowded.held, `crowded hand held ${detail}`).toBeGreaterThan(0);

          // Sparse combat is exactly the 56px decision. Crowding may choose the
          // stricter 48px decision, but may never make the hand larger.
          expect(Math.abs(sparse.hand - COMBAT_HAND_PX), `sparse hand ${detail}`).toBeLessThanOrEqual(
            TOLERANCE_PX,
          );
          expect(crowded.hand, `crowded hand does not widen combat ${detail}`).toBeLessThanOrEqual(
            COMBAT_HAND_PX + TOLERANCE_PX,
          );
          for (const [label, reading] of [
            ['crowded', crowded],
            ['sparse', sparse],
          ] as const) {
            expect(
              reading.board,
              `${label} battlefield is larger than its thumbnail hand ${detail}`,
            ).toBeGreaterThan(reading.hand);
            expect(
              reading.hand / reading.board,
              `${label} combat hand deliberately occupies less than 56/72 of the smallest battlefield face ${detail}`,
            ).toBeLessThanOrEqual(COMBAT_HAND_PX / 72 + 0.01);
            expect(reading.handLabel?.display, `${label} thumbnail label is drawn ${detail}`).not.toBe(
              'none',
            );
            expect(reading.handLabel?.text, `${label} thumbnail label names the mode ${detail}`).toContain(
              'thumbnail',
            );
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
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
      if (bodyError !== undefined) {
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            `crowded combat cap Chrome run or cleanup failed: ${reason(bodyError)}`,
          );
        }
        throw bodyError;
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, 'crowded combat cap cleanup failed');
      }
    },
    120_000,
  );
});
