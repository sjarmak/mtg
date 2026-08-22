// @vitest-environment jsdom
/**
 * The hand rail gives its cards room on the inline axis as well as the block one.
 *
 * `mtg-3oy`: the playtester, playing the lab, "for some reason the leftmost card in
 * your hand sometimes has the left border cut off". The rail's body is a scroll
 * container and it carried block padding only, so the first slot's inline-start
 * edge sat flush against the padding box and everything a hand card paints
 * outside its border box was cut there — the castable ring, the selection
 * outline, the focus ring, and the growth of the 1.03 hover scale. Measured in
 * chrome-headless-shell 151.0.7922.47 over the flagship set at 1440x900,
 * 1280x800, 1024x768 and 810x1080, at hand sizes on both sides of the seven-card
 * scroll threshold: the first card's offset from the clip edge was 0.00px in all
 * 24 cells, and is 4.00px in all 24 after.
 *
 * *Sometimes* was the paint state rather than the layout. A card with no move on
 * it paints nothing outside its border box, so it is cut and looks perfect;
 * measured on one hand of five, the leftmost card lost 2px of amber ring over
 * 3px of seam when castable, 2px of accent outline at 2px of offset when
 * selected or focused, and 1.86px of the card's own border under the hover
 * scale, while an inert card in the same slot lost nothing visible.
 *
 * **What this file proves and what it cannot.** jsdom performs no layout:
 * `getBoundingClientRect` is all zeros here, no percentage resolves and no
 * custom property is substituted, so no test in this suite can see a clipped
 * pixel. What jsdom has is a cascade over the emitted sheet, so what is
 * checkable is *which declarations win* — and the two that matter are a pair
 * that has to stay a pair. `../../tools/hand-edge.ts` is what proves the rest,
 * driven over CDP at the four viewports above.
 *
 * **Why the pair.** A bare `padding-inline` would take 8px off the row's content
 * box, and `../../src/styles/board/hand.ts` sizes every hand face *and* every
 * battlefield face from that row's width — a seventh of 8px is 1.14px off a hand
 * face, which moves the published hand-to-board ratios. The equal negative
 * margin puts the row's border box back into the inline padding the zone was
 * already holding, so the content box is untouched: `../../tools/hand-scale.ts`,
 * `../../tools/card-uniformity.ts` and `../../tools/tap-rotation.ts` all read
 * byte-identical across 32 readings at four viewports, before and after.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card as DslCard } from '@mtg/dsl';
import { Hand } from '../../src/board/Hand';
import { ROUTE_SCOPE_ATTRIBUTE } from '../../src/styles/tokens';
import { GlobalStyles, uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

/**
 * What a rendered node and a computed style are, structurally.
 *
 * The workspace tsconfig carries no `lib: dom` (AGENTS.md, "two constraints that
 * fail silently"), so these members are declared rather than imported, the way
 * `./tapped-slot.test.ts` declares the same two shapes.
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

function anyCard(): DslCard {
  const card = EXAMPLE_CARDS[0];
  if (card === undefined) throw new Error('the DSL example set is empty');
  return card;
}

/**
 * A hand of one in a rail of seven, optionally under the played table's scope.
 *
 * The markup is the real `Hand`'s rather than a stand-in, because every rule
 * under test is keyed on the layout attribute that component sets. What is
 * wrapped by hand is only what a hand never draws for itself: the route scope,
 * which `../../src/app/` puts on the shell, and the seat, which
 * `../../src/board/Board.ts` puts on the lane.
 */
function railBody(scoped: boolean): void {
  const hand = h(
    'div',
    { className: 'mtg-board__side', 'data-seat': 'you' },
    h(Hand, { label: 'Hand', cards: [{ key: 'a', card: anyCard(), playable: true }], slots: 7 }),
  );
  render(h('div', scoped ? { [ROUTE_SCOPE_ATTRIBUTE]: 'play' } : {}, h(GlobalStyles), hand));
}

const STEP = 'var(--mtg-space-1)';
const RAIL_BODY = ".mtg-zone__body[data-layout='rail']";

/**
 * Every rule in the shipped sheet whose selector names the zone body, paired
 * with its declaration block.
 *
 * Read off the sheet's text rather than off jsdom's cascade, and that is the
 * point of the check it feeds: jsdom's model keeps `padding-inline` in a slot of
 * its own, so a later `padding` shorthand would take the inline padding away in
 * a browser and leave every computed-style assertion here green.
 */
function zoneBodyRules(): readonly string[] {
  const sheet = uiStyleSheet();
  const blocks = sheet.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  return blocks.filter((block) => {
    const selector = block.slice(0, block.indexOf('{'));
    return selector.includes('.mtg-zone__body');
  });
}

describe('the hand rail as a scroll container', () => {
  it('pads the inline axis by the step it pads the block axis by', () => {
    // The fix, and the assertion that goes red if `mtg-3oy` comes back. The
    // block padding was `../../src/styles/board/zone.ts`'s room for the hover
    // scale; the inline axis needed the same room and had none, so the ring, the
    // outline and the focus ring were all cut at the first slot.
    railBody(true);
    const body = styleOf(RAIL_BODY);
    expect(body.getPropertyValue('padding-block')).toBe(STEP);
    expect(body.getPropertyValue('padding-inline')).toBe(STEP);
  });

  it('pays that padding back as margin, so the row is the width it always was', () => {
    // The half that makes the fix free. Without it the row's content box loses
    // 8px, and `../../src/styles/board/hand.ts` sizes both hands and both
    // battlefields as a seventh of that row.
    railBody(true);
    expect(styleOf(RAIL_BODY).getPropertyValue('margin-inline')).toBe(`calc(-1 * ${STEP})`);
  });

  it('is still the row that scrolls rather than the grid that wraps', () => {
    // The rule this pair was added to, unchanged: a hand that broke onto a
    // second row stopped reading as a hand.
    railBody(true);
    const body = styleOf(RAIL_BODY);
    expect(body.getPropertyValue('flex-wrap')).toBe('nowrap');
    expect(body.getPropertyValue('overflow-x')).toBe('auto');
  });

  it('gives a rail off the play route the same room as one on it', () => {
    // The rule is the rail's rather than the play route's, so a hand read as a
    // still frame clips its cards the same way a played one does.
    railBody(false);
    const body = styleOf(RAIL_BODY);
    expect(body.getPropertyValue('padding-inline')).toBe(STEP);
    expect(body.getPropertyValue('margin-inline')).toBe(`calc(-1 * ${STEP})`);
  });

  it('is never handed a padding or margin shorthand by a later rule', () => {
    // The guard jsdom cannot give. `../../src/styles/board/fit.ts` restates this
    // body's block padding one sheet later at equal specificity, so source order
    // decides, and a `padding` or `margin` shorthand written there would reset
    // the inline half in a browser while every computed-style assertion above
    // stayed green — cssstyle keeps `padding-inline` in a slot the shorthand
    // does not reach.
    const rules = zoneBodyRules();
    expect(rules.length, 'the sheet should carry rules for this body at all').toBeGreaterThan(1);
    for (const rule of rules) {
      const body = rule.slice(rule.indexOf('{'));
      expect(body, `a shorthand here would silently undo mtg-3oy:\n${rule}`).not.toMatch(
        /(^|[;{]\s*)(padding|margin)\s*:/,
      );
    }
  });
});
