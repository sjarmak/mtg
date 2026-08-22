// @vitest-environment node
/**
 * The two claims about the motion layer that are made in the stylesheet rather
 * than in the runner, read back out of the shipped sheet.
 *
 * **One object may not wear two motion vocabularies.** `styles/board/arrival.ts`
 * has animated the opponent's plays and the stack since `mtg-81a`, on
 * `translate`, fired by an element entering the document. The layer built here
 * animates the same objects on `transform`, fired by the event stream. Both at
 * once is one card visibly doing two things, and the resolution is a guard
 * rather than a deletion — a board with no runner over it (the replay route, any
 * read-only `Board` render) keeps the script-free arrival. So the guard is the
 * thing to check, and it has to be checked on the assembled sheet: a `:not()`
 * that had been dropped from one of the three selectors would be a defect nobody
 * could see except on the one surface that draws a stack.
 *
 * **Nothing here may touch a layout box.** `styles/board/slot.ts` pairs
 * `aspect-ratio` with `min-height: 0` to make every face on the board one
 * height, and `arrival.ts` records what an animated length does to that pair.
 * The mark is a `box-shadow` and the travel is a `transform`, which is a promise
 * a reader of the keyframes can check and `motion.browser.test.ts` measures.
 *
 * What is asserted here is text. Whether any of it is *drawn* that way is the
 * browser file, and whether the right cue fires is `motion-plan.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVAL_CSS } from '../../src/styles/board/arrival';
import { MOTION_CSS } from '../../src/styles/board/motion';
import { BOARD_CSS } from '../../src/styles/board';
import { uiStyleSheet } from '../../src/styles/index';
import { MARK_FAST_MS, MARK_MS } from '../../src/motion/timing';

/** Everything between `{` and `}` in the mark's keyframes. */
function markKeyframes(): string {
  const start = MOTION_CSS.indexOf('@keyframes mtg-motion-mark');
  expect(start, 'the sheet declares the mark keyframes').toBeGreaterThan(-1);
  const end = MOTION_CSS.indexOf('\n}', start);
  return MOTION_CSS.slice(start, end);
}

/** The properties a declaration block sets, lowercased and in source order. */
function propertiesOf(block: string): readonly string[] {
  return [...block.matchAll(/([a-z-]+)\s*:/g)].map((match) => (match[1] ?? '').toLowerCase());
}

describe('the older arrival stands down where the runner is driving', () => {
  it('guards every selector it animates, in the shipped sheet', () => {
    const rules = ARRIVAL_CSS.split(',').filter((selector) => selector.includes('.mtg-'));
    expect(rules.length, 'the arrival animates something').toBeGreaterThan(0);
    for (const selector of rules) {
      expect(selector, 'an arrival selector unguarded against the runner').toContain(
        ":not([data-motion='on'])",
      );
    }
    expect(uiStyleSheet()).toContain(":not([data-motion='on'])");
  });

  /**
   * Order, because both sheets end up in one cascade and the mark's rules tie
   * with the board's own on specificity — a class and an attribute either way.
   * A tie is settled by position, so the sheet that comes last wins, and this is
   * the assertion that it is this one.
   */
  it('is assembled before the motion sheet rather than after it', () => {
    const arrival = BOARD_CSS.indexOf('mtg-arrive');
    const motion = BOARD_CSS.indexOf('mtg-motion-mark');
    expect(arrival).toBeGreaterThan(-1);
    expect(motion).toBeGreaterThan(arrival);
  });
});

describe('the sheet animates nothing that has a size', () => {
  it('spends the whole mark on box-shadow', () => {
    expect([...new Set(propertiesOf(markKeyframes()))]).toEqual(['box-shadow']);
  });

  /**
   * The plane a departing card is flown on is `position: fixed` and takes no
   * clicks: a card in flight is a picture of something that has already
   * happened, and a click landing on it is a click that missed the board.
   */
  it('keeps the traveling card out of the table it is drawn over', () => {
    expect(MOTION_CSS).toContain('pointer-events: none');
    const layer = MOTION_CSS.slice(MOTION_CSS.indexOf("[data-motion='layer']"));
    expect(propertiesOf(layer.slice(0, layer.indexOf('}')))).toContain('position');
    expect(layer).toContain('position: fixed');
  });

  /** The tokens are the sheet's numbers, read back rather than restated. */
  it('spends the durations the timing file names', () => {
    expect(MOTION_CSS).toContain(`animation: mtg-motion-mark ${String(MARK_MS)}ms`);
    expect(MOTION_CSS).toContain(`animation-duration: ${String(MARK_FAST_MS)}ms`);
  });
});

describe('a player who asked for less motion', () => {
  /**
   * Off, not fast. `styles/base.ts` clamps every animation on the page to 1ms
   * under this query, and 1ms of a rising ring is a single frame of colored
   * edge — a flash, which is precisely what the request is a request against.
   * The plan is already empty before any of this (`motion-plan.test.ts`), so
   * this block is the belt: a stylesheet may not depend on a script having run.
   */
  it('gets no mark at all, rather than a fast one', () => {
    const query = MOTION_CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(query, 'the motion sheet answers the query').toBeGreaterThan(-1);
    const block = MOTION_CSS.slice(query);
    expect(block).toContain('[data-motion-mark]');
    expect(block).toContain('animation: none');
  });
});
