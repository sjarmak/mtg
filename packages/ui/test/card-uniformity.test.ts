// @vitest-environment jsdom
/**
 * Every card in a row is the same height, and every title fits the bar it is
 * printed in.
 *
 * The playtester, 2026-08-13: "some of the cards end up taller than the others but I
 * want them uniform, and need to make sure that titles fit on the card and dont
 * wrap over extra letters".
 *
 * **What this file proves, and what it does not.** Both halves of that sentence
 * are geometry, and jsdom performs no layout at all: `getBoundingClientRect`
 * returns zeros, container queries are not evaluated, and `scrollWidth` is
 * `clientWidth` by construction. So no test in this suite can measure a card's
 * height or catch a clipped title, and one written as though it could would be
 * green on a face that had regressed completely.
 *
 * What is checkable here is the *declaration* — the pair of properties whose
 * absence caused the defect, on the element that was missing them. That is a
 * real gate rather than a consolation: the board face had carried
 * `aspect-ratio: 63 / 88` and `max-height: 100%` for lanes without ever holding
 * to either, because a box with a preferred aspect ratio takes its content as
 * its automatic minimum size (CSS Sizing 4) and a minimum beats a maximum. The
 * ratio without `min-height: 0` beside it is exactly the state that shipped, and
 * this file fails on it.
 *
 * The measurements are in a real browser, and both tools are committed so the
 * numbers can be taken again rather than trusted:
 *
 *     npx tsx packages/ui/tools/card-uniformity.ts out/card-uniformity \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *     npx tsx packages/ui/tools/face-census.ts out/verify \
 *       packages/setgen/fixtures/sets/tideglass-reach.set.json
 *
 * Read in chrome-headless-shell 151 over the flagship set at 1280x800, 1440x900
 * and 1600x1000, with four, eight and twelve permanents a side. Before: one
 * seat's row of twelve came out at three heights, 138.2, 144.6 and 155.4, whose
 * trims read 0.629, 0.676 and 0.707 against the 0.716 the printed trim allows.
 * After: every face in every row is one height to within a tenth of a pixel and
 * every trim is 0.716. Titles, over the same eighteen rows: 6 of 8 names cut at
 * four permanents a side and 8 of 16 at eight, now none of either at any of the
 * three viewports; what was left was the twelve-a-side boards, filed as
 * `mtg-0sq`.
 *
 * **`mtg-0sq` is where the board name's floor came from**, and the numbers below
 * are the ones this file's later assertions are argued from. Read again over the
 * same two tools at 1024x768, 1280x800 and 1440x900 with four, eight and twelve
 * permanents a side — 144 faces — before and after `styles/card.ts`'s
 * `BOARD_TEXT_FLOOR_REM`: 82 names cut, then 66, with no face gaining a cut, no
 * seat changing height count and every trim still 0.716. It works from about a
 * 55px face up (a 55px row went 12 of 12 cut to 8, 56.9px went 12 to 7, 61.5px
 * went 7 of 8 to 4, 68.3px went 3 of 8 to 1, 69px went 3 of 12 to 1) and does
 * nothing at 48px, which is `board/fit.ts`'s `MIN_SLOT_WIDTH_REM` floor: 22
 * characters in three lines of that face's 28px bar is 6.6px type, and
 * `card/anatomy.ts` already states where that ends. A row that crowded needs a
 * layout answer, filed as `mtg-0sq.1`.
 */
import { describe, expect, it } from 'vitest';
import { CARD_TRIM_MM, NAME_FIT_STEPS, nameFitScale } from '../src/card/anatomy';
import { cssNumber } from '../src/styles/number';
import { uiStyleSheet } from '../src/styles/index';

const SHEET = uiStyleSheet();

/**
 * The three numbers the board face's name floor is argued against. The root size
 * is the browser default the sheet never re-values; `--mtg-text-xs` is read out
 * of the sheet rather than restated, so a re-valued type scale moves the
 * assertion with it; and 9px is the smallest size anything in the sheet is set
 * at, which is `BOARD_RULES_CQW`'s clamp floor and the end of the scale rather
 * than a number chosen here.
 */
const ROOT_PX = 16;
const SMALLEST_TYPE_PX = 9;

function tokenRem(name: string): number {
  const found = new RegExp(`--mtg-${name}: ([\\d.]+)rem;`).exec(SHEET);
  if (found === null) throw new Error(`the sheet values no --mtg-${name}`);
  return Number(found[1]);
}

const TEXT_XS_REM = tokenRem('text-xs');

/** Every declaration block the sheet writes for a selector, joined. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...SHEET.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))];
  if (found.length === 0) throw new Error(`the sheet declares nothing for ${selector}`);
  return found.map((match) => match[1] ?? '').join('\n');
}

describe('a face in a slot is the trim, not its content', () => {
  /**
   * The pair, on the element that draws every permanent and every card in hand.
   * `styles/card.ts`'s `FACE_TRIM` is the same pair one size up and already had
   * both halves; this is the size that had one.
   */
  it('pins the board face to the printed trim with the ratio and a zero minimum', () => {
    const face = declarations('.mtg-slot > .mtg-card');
    expect(face).toContain(
      `aspect-ratio: ${cssNumber(CARD_TRIM_MM.width)} / ${cssNumber(CARD_TRIM_MM.height)}`,
    );
    expect(face, 'the ratio alone is overruled by the content-based minimum').toContain('min-height: 0');
  });

  /**
   * And what pays when a name takes a second line: the picture, because it is
   * the only region on that face that can give. If a bar ever grew instead, the
   * face would be back to choosing between overflowing and getting taller.
   */
  it('leaves the art window the only region on a board face that gives', () => {
    expect(declarations(".mtg-card[data-size='board'] > *")).toContain('flex: none');
    expect(declarations(".mtg-card[data-size='board'] > [data-region='art']")).toContain(
      'flex: 1 1 auto; min-height: 0',
    );
  });
});

describe('a title shrinks to fit before it is ever cut', () => {
  /**
   * One rule per rung, setting a channel rather than a size. The three faces
   * each size the name off a different token, so a ladder that named one of them
   * would either outrank the other two on specificity or have to be written three
   * times; `styles/card.ts`'s `NAME_FIT_RULES` has the argument.
   */
  it('publishes a scale for every step of the ladder', () => {
    NAME_FIT_STEPS.forEach((scale, step) => {
      expect(SHEET, `no rule for name step ${String(step)}`).toContain(
        `.mtg-card__name[data-fit='${cssNumber(step)}'] { --name-scale: ${cssNumber(scale)}; }`,
      );
    });
    expect(nameFitScale(0), 'the first rung is full size').toBe(1);
    expect(() => nameFitScale(NAME_FIT_STEPS.length), 'a step off the ladder').toThrow(/no name fit step/);
  });

  /**
   * Every face that draws a name multiplies its own token by the channel. Named
   * one at a time rather than counted, because a face added to this list without
   * the multiplier would be a face whose long names go back to being cut, and a
   * count cannot tell which one is missing.
   */
  it('takes the scale on all three faces that draw a name', () => {
    expect(declarations('.mtg-card__name'), 'the full face').toContain(
      'font-size: calc(var(--mtg-text-sm) * var(--name-scale, 1))',
    );
    expect(SHEET, 'the compact face in a container query').toContain(
      '.mtg-card__name { font-size: calc(var(--mtg-text-xs) * var(--name-scale, 1)); }',
    );
    const board = declarations(".mtg-card[data-size='board'] .mtg-card__name");
    // The board's size is a clamp of three terms and the ladder scales all
    // three. The floor is the one that matters: under about a 130px face the
    // proportional term loses to it, and an unscaled floor is a name that stops
    // tracking the bar it has to fit.
    expect((board.match(/var\(--name-scale, 1\)/g) ?? []).length, 'every term of the clamp').toBe(3);
  });

  /**
   * `mtg-0sq`: the ladder is calibrated on the full face's title bar, so it has
   * nothing to say about a 22-character name on a 48px thumbnail — that name is
   * step 0, told to shrink by nothing, and set at `--mtg-text-xs` in a bar four
   * characters wide. So the board face's clamp has an absolute floor under the
   * ladder's, and it is `min()` rather than a replacement so a name that the
   * ladder has *already* taken below it is left where it is.
   *
   * jsdom evaluates no container query and resolves no `clamp`, so what is
   * checkable here is the arithmetic and the declaration. The browser numbers
   * are in `styles/card.ts`'s `BOARD_TEXT_FLOOR_REM` and were read over
   * `tools/card-uniformity.ts`.
   */
  it('floors the board name under the ladder rather than on it', () => {
    const board = declarations(".mtg-card[data-size='board'] .mtg-card__name");
    const floor = /clamp\(\s*min\(([\d.]+)rem, calc\(var\(--mtg-text-xs\) \* var\(--name-scale, 1\)\)\)/.exec(
      board,
    );
    expect(floor, 'the board name has no absolute floor under its ladder').not.toBeNull();

    // Under `--mtg-text-xs`, or the floor is the ladder's floor again and the
    // rule does nothing; at or above the smallest size the sheet sets anywhere,
    // or it is the 7px type `anatomy.ts` rules out.
    const rem = Number(floor?.[1]);
    expect(rem, 'the floor is not below --mtg-text-xs').toBeLessThan(TEXT_XS_REM);
    expect(rem * ROOT_PX, 'the floor is under the smallest type in the sheet').toBeGreaterThanOrEqual(
      SMALLEST_TYPE_PX,
    );

    // And `min()` rather than the bare value, which is the half that makes this
    // a one-way change: the ladder's own floor at step 4 is 0.7 of
    // `--mtg-text-xs`, which is below the constant, and taking the larger of the
    // two would set the set's longest names *bigger* than they are today.
    expect(nameFitScale(NAME_FIT_STEPS.length - 1) * TEXT_XS_REM * ROOT_PX).toBeLessThan(SMALLEST_TYPE_PX);
  });

  /**
   * The full face takes one line and is ellipsized only past the ladder's floor;
   * the board face wraps to a bounded number of whole lines instead, because a
   * name breaks between words and no size a player can read fits three words of a
   * board thumbnail on one line. Both budgets are counted in line boxes, so what
   * is dropped is a line rather than the top half of one.
   */
  it('keeps the full face on one line and gives the board a bounded wrap', () => {
    const full = declarations('.mtg-card__name');
    expect(full).toContain('white-space: nowrap');
    expect(full).toContain('text-overflow: ellipsis');

    // The name is the only thing that wraps on a board face now, and the budget
    // rides in the same rule. The type line lost its second line to the art
    // window (`styles/card.ts`, `BOARD_NAME_LINES`), so it keeps the ellipsis
    // `.mtg-card__name`'s own rule above declares for the full face — which is
    // the printed face's rule and is checked from the other end below.
    const wrap = declarations(".mtg-card[data-size='board'] .mtg-card__name");
    expect(wrap).toContain('white-space: normal');
    expect(wrap).toMatch(/-webkit-line-clamp: \d+/);
    expect(SHEET, 'the board type line took a wrap budget back').not.toContain(
      ".mtg-card[data-size='board'] .mtg-card__type { max-height",
    );
  });
});

/**
 * The zoom, which overrules both ladders because it exists to be read.
 *
 * It is a `full` face at 20rem instead of 15.25rem, and the extra width lands
 * entirely on the name — the cost run and the paddings beside it are fixed — so
 * a name the ladder shrank fits there at full size. The rule beside it in
 * `styles/card.ts` does the same for the rules box and carries the arithmetic.
 */
describe('the hover zoom sets both ladders back', () => {
  it('reads the whole card at full size', () => {
    expect(declarations('.mtg-zoom > .mtg-card .mtg-card__text')).toContain('font-size: var(--mtg-text-sm)');
    expect(declarations('.mtg-zoom > .mtg-card .mtg-card__name')).toContain('--name-scale: 1');
  });
});
