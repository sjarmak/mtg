// @vitest-environment jsdom
/**
 * The battlefield row gives its permanents room on the inline axis, at both of
 * the boxes that clip them.
 *
 * `mtg-e3n`, and `./hand-edge.test.ts` is the same defect one zone over. A
 * scroll container clips at its padding box; a permanent paints several marks
 * outside its own border box — `../../src/styles/board/slot.ts`'s castable ring
 * (2px of amber over 3px of seam, plus a 14px halo),
 * `../../src/styles/card.ts`'s selection outline and
 * `../../src/styles/base.ts`'s focus ring (2px at 2px of offset each), and the
 * growth of the 1.03 hover scale — so whatever the row does not reserve, the
 * first and last permanents lose. A permanent wearing none of those marks is
 * perfect at zero clearance, which is why the defect reads as intermittent and
 * why it was reported as *sometimes*.
 *
 * **Why this is two rules where the hand needed one.**
 * `../../src/styles/board/fit.ts` makes `.mtg-board__spells` a scroll container
 * *inside* `.mtg-zone__body[data-layout='board']`, which it also makes one. The
 * hand's remedy is a padding paid for by an equal negative margin, and a
 * negative margin only bleeds into ground the parent is already holding — the
 * body holds none inline, so the pair on the row alone would have moved the
 * clip from one box to the next and cut exactly as much. Both boxes take the
 * pair; the outer one bleeds into the zone's own inline padding, which is why
 * the assertion that the zone keeps more than a step of it is in this file.
 *
 * **What this file proves and what it cannot.** jsdom performs no layout:
 * `getBoundingClientRect` is all zeros here, no percentage resolves and no
 * custom property is substituted, so no test in this suite can see a clipped
 * pixel. What jsdom has is a cascade over the emitted sheet, so what is
 * checkable is which declarations win. `../../tools/board-edge.ts` is what
 * proves the rest, driven over CDP in chrome-headless-shell 151.0.7922.47 over
 * the flagship set at 1440x900, 1280x800, 1024x768 and 810x1080 by 4, 8 and
 * 12 permanents a side: the first permanent's offset from the nearest clip edge
 * was 0.00px in all 24 cells at both seats, and is 4.00px in all 24 after.
 *
 * **And the price, which had to be nothing.**
 * `../../src/styles/board/hand.ts` sizes every battlefield face as a share of
 * this row's *content* box, and a bare `padding-inline` would have taken 8px
 * off the row and 1.14px off every permanent on the table. What that trades
 * against is `../../src/styles/card.ts`'s `BOARD_RULES_MIN_REM`, which drops
 * the rules box when the face's own content box reaches 4rem — an 80.00px face
 * against the 82.61px one a 1280x800 board draws at four a side, so 2.61px of
 * headroom rather than the fifth of a pixel this bead was filed with. Measured
 * before and after:
 * every face box at all four viewports by all three densities at both seats is
 * identical to the hundredth of a pixel, and 32 readings of
 * `../../tools/hand-scale.ts`, `../../tools/card-uniformity.ts` and
 * `../../tools/tap-rotation.ts` are byte-identical across the change.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Battlefield } from '../../src/board/Battlefield';
import { TABLE } from '../../src/styles/board/geometry';
import { ROUTE_SCOPE_ATTRIBUTE } from '../../src/styles/tokens';
import { GlobalStyles, uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

/**
 * What a rendered node and a computed style are, structurally.
 *
 * The workspace tsconfig carries no `lib: dom` (AGENTS.md, "two constraints
 * that fail silently"), so these members are declared rather than imported, the
 * way `./hand-edge.test.ts` and `./tapped-slot.test.ts` declare the same two
 * shapes.
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

/**
 * A battlefield of one permanent, optionally under the played table's scope.
 *
 * The markup is the real `Battlefield`'s rather than a stand-in, because both
 * rules under test are keyed on the layout attribute that component sets. What
 * is wrapped by hand is only what a battlefield never draws for itself: the
 * route scope, which `../../src/app/` puts on the shell.
 */
function battlefield(scoped: boolean): void {
  const zone = h(Battlefield, {
    label: 'Battlefield',
    permanents: [{ key: 'p1', card: creature() }],
  });
  render(h('div', scoped ? { [ROUTE_SCOPE_ATTRIBUTE]: 'play' } : {}, h(GlobalStyles), zone));
}

const STEP = 'var(--mtg-space-1)';
const BODY = ".mtg-zone__body[data-layout='board']";
const ROW = '.mtg-board__spells';

/**
 * Every rule in the shipped sheet whose selector names one of the two clipping
 * boxes, paired with its declaration block.
 *
 * Read off the sheet's text rather than off jsdom's cascade, and that is the
 * point of the check it feeds: jsdom's model keeps `padding-inline` in a slot
 * of its own, so a later `padding` shorthand would take the inline padding away
 * in a browser and leave every computed-style assertion here green.
 */
/** The declaration block of the one rule matching `selector`, as the sheet states it. */
function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(uiStyleSheet());
  if (found === null) throw new Error(`the sheet carries no rule for ${selector}`);
  return found[1] ?? '';
}

function clipBoxRules(): readonly string[] {
  const sheet = uiStyleSheet();
  const blocks = sheet.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  return blocks.filter((block) => {
    const selector = block.slice(0, block.indexOf('{'));
    return selector.includes('.mtg-board__spells') || selector.includes('.mtg-zone__body');
  });
}

describe('the battlefield row as a scroll container', () => {
  it('pads the inline axis of the row the permanents sit in', () => {
    // The inner half of the fix, and the assertion that goes red if the ring,
    // the outline and the focus ring start being cut at the first permanent
    // again.
    battlefield(true);
    const row = styleOf(ROW);
    expect(row.getPropertyValue('padding-inline')).toBe(STEP);
    expect(row.getPropertyValue('margin-inline')).toBe(`calc(-1 * ${STEP})`);
  });

  it('pads the body the row is nested in, or the clip only moves out one box', () => {
    // The outer half, and the whole reason this bead exists rather than being
    // the hand's fix applied twice. `../../src/styles/board/fit.ts` makes this
    // body a scroll container too, so a row that grew into a body holding no
    // inline padding would be cut at exactly the same place by the parent.
    battlefield(true);
    const body = styleOf(BODY);
    expect(body.getPropertyValue('padding-inline')).toBe(STEP);
    expect(body.getPropertyValue('margin-inline')).toBe(`calc(-1 * ${STEP})`);
  });

  it('leaves the zone enough inline padding that the bleed stays off its keyline', () => {
    // What bounds the fix. The body's negative margin spends the zone's own
    // inline padding, and a zone holding only one step of it would let the row
    // paint over the keyline that makes a well a well. One step is spent and
    // the play route's zone declares two, so half of it survives.
    //
    // Read off the sheet rather than off a computed style: the zone states its
    // padding as a shorthand whose values are custom properties, and cssstyle
    // gives back `0` for `padding-left` rather than substituting anything.
    const zone = ruleFor(`${TABLE} .mtg-zone`);
    const inline = /padding:[^;]*\s(var\(--mtg-space-\d\));/.exec(zone)?.[1];
    expect(inline, 'the play-route zone stopped stating an inline padding step').toBeDefined();
    expect(inline).toBe('var(--mtg-space-2)');
    expect(inline, 'the zone now holds no more than the step this fix spends').not.toBe(STEP);
  });

  it('reserves nothing off the played table, where nothing clips', () => {
    // The scope is the clip's rather than a preference.
    // `../../src/styles/board/lands.ts` leaves this row wrapping with visible
    // overflow off the play route, so there is no padding box to be cut at and
    // room reserved there would be room taken from a still frame for nothing.
    battlefield(false);
    expect(styleOf(ROW).getPropertyValue('padding-inline')).toBe('');
    expect(styleOf(BODY).getPropertyValue('padding-inline')).toBe('');
  });

  it('is never handed a padding or margin shorthand by a later rule', () => {
    // The guard jsdom cannot give. `../../src/styles/board/fit.ts` restates
    // both of these boxes' block padding one sheet later at equal specificity,
    // so source order decides, and a `padding` or `margin` shorthand written
    // there would reset the inline half in a browser while every computed-style
    // assertion above stayed green — cssstyle keeps `padding-inline` in a slot
    // the shorthand does not reach.
    const rules = clipBoxRules();
    expect(rules.length, 'the sheet should carry rules for these boxes at all').toBeGreaterThan(1);
    for (const rule of rules) {
      const body = rule.slice(rule.indexOf('{'));
      expect(body, `a shorthand here would silently undo mtg-e3n:\n${rule}`).not.toMatch(
        /(^|[;{]\s*)(padding|margin)\s*:/,
      );
    }
  });
});
