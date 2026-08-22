// @vitest-environment jsdom
/**
 * What the combat band is allowed to charge the rest of the table.
 *
 * The playtester, 2026-08-14, in the middle of a game: "now I've just gone to combat
 * and my hand is huge and the actual card I want to attack with is super small
 * and hidden behind a scrolling view that is a really narrow view of the board".
 * The narrow view was the seam: `../../src/board/CombatZone.ts` opens the band
 * when it has anything to hold and it counts the confirm control, so the band
 * was a quarter of the lanes column from the first instant of the declare step,
 * holding two buttons. Measured over `../../tools/board-budget.ts` against the
 * flagship set at the median board the simulator reaches, at 1280x800: the same
 * position at rest drew a 155.5px battlefield row and an 82.6px face with rules
 * text on it, and at the declare step drew a 66.8px row and a 40.4px face with
 * none — and the opponent's cards came out larger than the viewer's.
 *
 * **Not one assertion here is about a pixel, and that is the point of the file
 * rather than a limitation of it.** jsdom performs no layout, so
 * `getBoundingClientRect` is all zeros and no test in this checkout can say what
 * the band measured. What a test *can* hold is the shape of the three rules the
 * measurement bought, each of which would regress silently: the share is gated
 * on the band holding a card, and the two lanes' flex weights are gated the same
 * way. Delete any one of those three `:has()` guards and every number above
 * comes back with the sheet still looking reasonable. The pixels live in
 * `../../tools/board-budget.ts`, run in chrome-headless-shell 151 at 1440x900,
 * 1280x800, 1024x768 and 810x1080, and the readings are quoted in
 * `../../src/styles/board/band.ts`.
 */
import { describe, expect, it } from 'vitest';
import { uiStyleSheet } from '../../src/styles/index';

/**
 * The sheet with its at-rule blocks taken out, so a selector found in here
 * applies at every viewport.
 *
 * Only a top-level brace sits at column zero, which is what makes the removal a
 * line match rather than a parser. The reason it is needed: `mtg-l4w0` gave the
 * two lanes a second pair of weights under `SHORT_VIEWPORT_QUERY`, because a
 * phone in landscape is in the condition below for the whole game rather than
 * for one step. That pair is gated by where it sits, and this file is about the
 * pair that is gated by what it selects; `./hand-scale.test.ts` holds the other
 * one and asserts that those two are the only two.
 */
const UNCONDITIONAL = uiStyleSheet().replace(/^@media[^\n]*\{\n[\s\S]*?\n\}$/gm, '');

/** Every rule in the sheet that states a height for the open seam. */
function seamHeightRules(): readonly string[] {
  return UNCONDITIONAL.split('\n}')
    .map((block) => block.trim())
    .filter((block) => block.includes("data-combat='true']") && /height:\s*\d/.test(block));
}

/** The selector of the one rule that carries a declaration, by a marker in it. */
function selectorCarrying(declaration: string): string {
  const found = UNCONDITIONAL.split('\n}')
    .map((block) => block.trim())
    .filter((block) => block.includes(declaration))
    .filter((block) => block.includes('.mtg-board__side'));
  const one = found[0];
  if (one === undefined || found.length !== 1) {
    throw new Error(
      `${String(found.length)} rules on a lane carry ${declaration}, so there is no one selector`,
    );
  }
  const selector = one.split('{')[0];
  if (selector === undefined) throw new Error(`the rule carrying ${declaration} has no selector`);
  return selector.trim();
}

describe('the seam charges for cards rather than for the step', () => {
  /**
   * The whole of the fix, and the one line of it a later edit could undo without
   * looking wrong: a share of the column spent on a band that is holding a card,
   * and no share at all on a band holding controls.
   */
  it('states the band a share of the column only when an entry is in it', () => {
    const rules = seamHeightRules();
    expect(rules.length, 'the open seam should state exactly one height').toBe(1);
    const rule = rules[0];
    if (rule === undefined) throw new Error('no rule states the open seam a height');
    expect(rule, 'the share is charged whether or not the band holds anything').toContain(
      ':has(.mtg-combat__entry)',
    );
    expect(rule, 'the share is a share of the lanes column, not a count of pixels').toMatch(
      /height:\s*\d+(\.\d+)?%/,
    );
  });

  /**
   * And the two weights that decide which half pays for it. With an even split
   * the viewer's own row came out smaller than the opponent's at 1440x900 and
   * 1280x800 — 93.5px against 108.2 — which is the inversion `mtg-d6s` spent a
   * bead removing, reached down a different road. Both weights are scoped to a
   * band with a card in it, so a resting board keeps the even split `./fit.ts`
   * argues for on a table with room on it.
   */
  it('tilts the two lanes only while the band holds a card', () => {
    const near = selectorCarrying('flex-grow:');
    expect(near).toContain(':has(.mtg-combat__entry)');
    expect(near).toContain("[data-seat='you']");

    const far = selectorCarrying('flex-shrink:');
    expect(far).toContain(':has(.mtg-combat__entry)');
    expect(far).toContain("[data-seat='opponent']");
  });
});
