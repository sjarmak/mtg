// @vitest-environment jsdom
/**
 * A tapped permanent stays inside the slot it was dealt.
 *
 * `mtg-bm1`: an attack declaration turned the near row into a barcode. The
 * rotated faces were drawn as wide as their slots were *tall*, and a battlefield
 * row shrinks — `../../src/styles/board/fit.ts` gives a slot a flex-shrink of 1
 * so a crowded row narrows its cards instead of scrolling — so every tapped slot
 * on a full row was narrower than it was tall and the card painted the
 * difference onto the permanents either side of it. Measured in
 * chrome-headless-shell 151 on an *uncrowded* row, six permanents a side: 22.3px
 * of overhang and 5 overlapping face pairs at 1440x900, 33.4px and 10 pairs at
 * 1024x768.
 *
 * **What this file proves and what it cannot.** jsdom performs no layout:
 * `getBoundingClientRect` is all zeros here and no percentage resolves against
 * anything, which is precisely why a defect this loud shipped with a green
 * suite. What jsdom does have is a selector engine and a cascade over the
 * emitted sheet, so what is checkable without a browser is *which declaration
 * wins* — and that is the whole shape of this bug, because the rule that broke
 * it was one that won the cascade. So this file asserts the winning box for a
 * tapped board face, for a tapped land tile, and for the badges over the corner,
 * and it asserts nothing about pixels.
 *
 * **`../../tools/tap-rotation.ts` is what proves the rest**, driven over CDP in
 * chrome-headless-shell at three viewports with the tapped permanents
 * alternating and again at the first, a middle and the last place in the row. It
 * reports `insideSlot` as a count of faces whose box is inside their own slot's,
 * the worst overhang in CSS px, and the overlapping face pairs, per row. Before
 * this change it read 0 of 6 at every viewport; after it, 6 of 6 with 0px of
 * overhang and no overlapping pair anywhere.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BASIC_LANDS, EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Battlefield } from '../../src/board/Battlefield';
import { CARD_TRIM_MM } from '../../src/card/anatomy';
import { cssNumber } from '../../src/styles/number';
import { ROUTE_SCOPE_ATTRIBUTE } from '../../src/styles/tokens';
import { GlobalStyles, uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

/**
 * What a rendered node and a computed style are, structurally.
 *
 * The workspace tsconfig carries no `lib: dom` (AGENTS.md, "two constraints that
 * fail silently"), so these members have to be declared rather than imported;
 * `../board.test.ts` narrows the same two shapes for the same reason.
 */
interface StyleLike {
  readonly getPropertyValue: (property: string) => string;
}

interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
}

interface WindowLike {
  readonly document: { readonly body: ElementLike };
  readonly getComputedStyle: (element: ElementLike) => StyleLike;
}

/** The computed style of the one element matching `selector`, under the mounted sheet. */
function styleOf(selector: string): StyleLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  const element = document.body.querySelector(selector);
  if (element === null) throw new Error(`nothing rendered matched ${selector}`);
  return candidate.getComputedStyle(element);
}

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return card;
}

function land(): DslCard {
  const card = BASIC_LANDS[0];
  if (card === undefined) throw new Error('the DSL example set has no basic lands');
  return card;
}

/**
 * A tapped creature and a tapped land in one row, under the played table's own
 * scope and in the viewer's seat.
 *
 * The zone markup is the real `Battlefield`'s rather than a hand-written stand-in,
 * because half the rules under test are keyed on class names that component owns
 * (`.mtg-board__spells`, `.mtg-lands`) and a fixture that drifted from it would
 * assert about a row nobody draws. What is wrapped by hand is only what a
 * battlefield never draws for itself: the route scope, which `../../src/app/`
 * puts on the shell, and the seat, which `../../src/board/Board.ts` puts on the
 * lane. The near seat rather than the far one because its cap is the
 * unqualified one: `../../src/styles/board/hand.ts` sizes a board face against a
 * hand card at both seats now (`mtg-d6s`), and the far seat's declaration only
 * corrects which row's width that share is measured from.
 */
function playedRow(): void {
  render(
    h(
      'div',
      { [ROUTE_SCOPE_ATTRIBUTE]: 'play' },
      h(GlobalStyles),
      h(
        'div',
        { className: 'mtg-board__side', 'data-seat': 'you' },
        h(Battlefield, {
          label: 'Battlefield',
          permanents: [
            { key: 'p1', card: creature(), tapped: false },
            { key: 'p2', card: creature(), tapped: true, attacking: true },
            { key: 'l1', card: land(), tapped: true },
          ],
        }),
      ),
    ),
  );
}

/**
 * The face's width, which is 63/88 of its slot's on a square slot and the slot's
 * own height wherever the block-axis cap took the square away.
 *
 * Both terms, because either alone is a bug: the share alone is what let a
 * squashed slot keep a width it no longer had the height for, and the height
 * alone would shrink an unsquashed face to 88/63 of what the row settled.
 */
const TAPPED_FACE_WIDTH = `min(${cssNumber((CARD_TRIM_MM.width / CARD_TRIM_MM.height) * 100)}%, 100cqh)`;

const SPELL_FACE = ".mtg-board__spells > .mtg-slot[data-tapped='true'] > .mtg-card";

describe('a tapped permanent on the played table', () => {
  it('takes its size from the width of its slot, which is the axis the row settled', () => {
    // The fix, and the one assertion that goes red if `mtg-bm1` comes back: a
    // percentage of the slot's width resolves against whatever width the row
    // left, while the `height: 100%` this replaces resolved against a cross size
    // flex-shrink never touched. The card is turned a quarter, so its own width
    // is what ends up on the vertical axis and its own height is what lies along
    // the row — hence 63/88 of the slot, which lays the rotated card into the
    // slot's width exactly.
    //
    // The `100cqh` beside it is `mtg-5f9`: a slot the block-axis cap squashed is
    // no longer square, and a face still drawn from its width hangs out of the
    // top of it and has its leading edge cut by the row, which is the rotated
    // `...dgeland Barracuda` in `references/UI_issues/view_issue3.png`. On an
    // unsquashed slot the term is exactly non-binding, so it costs the tall
    // tables nothing.
    playedRow();
    const face = styleOf(SPELL_FACE);
    expect(face.getPropertyValue('width')).toBe(TAPPED_FACE_WIDTH);
    expect(face.getPropertyValue('height')).toBe('auto');
    expect(face.getPropertyValue('rotate')).toBe('90deg');
  });

  it('makes the slot a size container, or the height term resolves against an ancestor', () => {
    // `100cqh` without `container-type: size` on the slot is not a smaller
    // number, it is a different element's height — the nearest ancestor query
    // container, which is the whole row. The width rule and this one are one
    // change and neither is worth anything alone.
    playedRow();
    expect(
      styleOf(".mtg-board__spells > .mtg-slot[data-tapped='true']").getPropertyValue('container-type'),
    ).toBe('size');
  });

  it('is turned rather than shrunk, so nothing scales it down', () => {
    // The half of `mtg-yi5` that must not be undone in the course of fixing
    // this one: a tapped face used to be scaled by 63/88 to fit the width it
    // already had, and came out with a name box eleven pixels wide.
    playedRow();
    expect(styleOf(SPELL_FACE).getPropertyValue('scale')).not.toMatch(/^[\d.]+$/);
  });

  it('keeps the square reserved on the slot, so the turned card is full size', () => {
    // The other half of the geometry. The card fits whatever width the slot has;
    // the square is what makes that width the height an upright face would have
    // had, so a tapped permanent is its untapped neighbor turned rather than a
    // smaller copy of it.
    playedRow();
    const slot = styleOf(".mtg-board__spells > .mtg-slot[data-tapped='true']");
    expect(slot.getPropertyValue('aspect-ratio')).toBe('1 / 1');
  });

  it('keeps the settled square from shrinking on the row axis', () => {
    // The browser test proves the pixel equivalence after the short-table and
    // crowded-row caps settle. This cascade assertion protects the other half:
    // flex layout must not shrink only the tapped slot's wider row-axis box.
    playedRow();
    const slot = styleOf(".mtg-board__spells > .mtg-slot[data-tapped='true']");
    expect(slot.getPropertyValue('flex-shrink')).toBe('0');
    expect(slot.getPropertyValue('aspect-ratio')).toBe('1 / 1');
  });

  it('leaves the mana base alone, which sizes a tapped tile its own way', () => {
    // `../../src/styles/board/lands.ts` reserves nothing for a tile's rotation
    // and scales the tile instead, on a stated argument about the band's height,
    // and it wins over the rules above by sitting later in the cascade
    // (`../../src/styles/board/index.ts`). A fix for the card row that reached
    // the land row would silently re-decide that.
    playedRow();
    const tile = styleOf(".mtg-lands > .mtg-slot[data-tapped='true'] > .mtg-card");
    expect(tile.getPropertyValue('width')).toBe('100%');
    expect(tile.getPropertyValue('height')).toBe('100%');
  });

  /**
   * `mtg-d6s`: a floor on the slot is not a floor on the card, and the square is
   * where the two come apart. `../../src/styles/board/fit.ts` floors a slot at
   * `MIN_SLOT_WIDTH_REM` so a crowded row narrows rather than scrolls, and a
   * tapped slot is square with the card laid across it — so 48px of slot is 34px
   * of card there against 48px of card in an upright one, and a row that reaches
   * the floor stops shrinking its upright slots while its tapped ones keep
   * going. Nothing reached it until a board face got smaller; measured over
   * `../../tools/tap-rotation.ts` at 1024x768 with twelve a side, it then drew
   * one permanent 48 x 67 upright and 40.2 x 56.1 tapped.
   */
  it('reaches the width floor holding the same card an upright slot does', () => {
    playedRow();
    const upright = styleOf(".mtg-board__spells > .mtg-slot:not([data-tapped='true'])");
    const tapped = styleOf(".mtg-board__spells > .mtg-slot[data-tapped='true']");
    const px = (style: { readonly getPropertyValue: (name: string) => string }): number =>
      Number(style.getPropertyValue('min-width').replace('px', ''));
    expect(px(upright), 'an upright slot declares no width floor to turn').toBeGreaterThan(0);
    expect(px(tapped), 'a tapped slot taking the floor as written bottoms out at a smaller card').toBeCloseTo(
      (px(upright) * CARD_TRIM_MM.height) / CARD_TRIM_MM.width,
      3,
    );
  });

  /**
   * This one proves no pixel, and it cannot: jsdom performs no layout, so
   * `getBoundingClientRect` is all zeros and no test in this file can say where
   * a badge landed. It also cannot read the sheet through `getComputedStyle`
   * any more, because both branches below sit inside `@supports` and jsdom's
   * cascade does not enter one. What it checks is that the sheet still declares
   * both branches and that neither is the other's leftovers.
   *
   * The pixels are in `packages/ui/tools/corner-marks.ts`, driven in
   * chrome-headless-shell 151 over the flagship set: with the badges anchored to
   * the picture, a tapped board of eight a side at 1440x900 goes from 98 covered
   * letters across sixteen faces to none.
   */
  it('anchors the corner badges to the picture, and keeps the old pull for a browser that cannot', () => {
    const sheet = uiStyleSheet();
    // The badges no longer care that the card turned: an anchor rectangle is the
    // anchor's box in the containing block's own axes, so a rotated window hands
    // back an upright box and the row lands on the near corner of the picture.
    expect(sheet).toContain('@supports (anchor-scope: --mtg-art-anchor) {');
    expect(sheet).toContain('position-anchor: --mtg-art-anchor;');
    expect(sheet).toContain('inset-block-start: anchor(start); inset-inline-start: anchor(start);');
    // And the arithmetic that browser needs instead, which is what every browser
    // drew before `mtg-9edk`: half the slot's height less half the card's, spent
    // across two axes because a percentage inset resolves against the containing
    // block's height and a percentage margin against its width. Left as one
    // number the badge drifts off the card by exactly what the row shrank the
    // slot — 4.4px at 1440x900 and 21px at 1024x768, measured.
    expect(sheet).toContain('@supports not (anchor-scope: --mtg-art-anchor) {');
    expect(sheet).toMatch(
      /@supports not \(anchor-scope: --mtg-art-anchor\) \{[\s\S]*?inset-block-start: 50%;\s*\n\s*margin-block-start: calc\(var\(--mtg-space-1\) - [\d.]+%\);/,
    );
  });

  it('holds the badges to the picture they sit on rather than to the slot', () => {
    // The half of the fix a name-length or a rotation cannot undo. A quarter
    // turn puts the card's short side along the row, so the window a tapped
    // permanent shows is 44.5px across at 1440x900 four a side where the upright
    // one is 83.2 — and an unbounded row of 61.2px ran 12.7px past it and back
    // onto the name. The row is held to the anchor's own width and wraps inside
    // it, which costs a second line of badges over the one region with nothing
    // under it.
    expect(uiStyleSheet()).toContain('max-width: anchor-size(width); flex-wrap: wrap;');
  });
});
