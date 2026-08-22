// @vitest-environment jsdom
/**
 * Where the mana cost sits on a board face, and why it is not on the title row.
 *
 * `../src/card/anatomy.ts` carries the argument as arithmetic: at the 68.47px
 * face width measured mid-game, the title bar's inner width is 32.47px, a
 * two-pip cost run takes 27.6px, and the name is left 0.87px, which is no name
 * at all. That argument shipped with nothing holding it, on a surface three
 * lanes have since edited. These are the assertions from `ui/board-face`
 * (dropped, tag `salvage/ui-board-face-7737dbd`), ported to what main actually
 * built, which went one step further than the branch did: the cost is not
 * merely positioned out of the title row, it is positioned *inside the art
 * window*, which is `overflow: hidden`, so however short the window gets the
 * pips are clipped by the picture rather than printed over the name below it.
 *
 * jsdom performs no layout, so nothing here can see a pixel. What it can see is
 * the structure and the cascade, which is where both halves of the arrangement
 * are declared. The pixels were measured in Chromium 151 while this file was
 * written, at the 68.47 x 95.64px slot a mid-game battlefield gives one
 * permanent: the name box is 46.47px of a 52.47px title row, and the cost's box
 * is 18.59 x 8.80px sitting wholly inside the 52.47 x 24.06px art window,
 * overlapping neither the title bar nor the type bar. Putting the cost back on
 * the title row there, which is the mutation the first and third tests below
 * fail on, cuts the name box to 24.88px and spends 19.59px of the row on pips.
 *
 * That is a smaller loss than the branch measured, and the difference is not
 * drift: `../src/styles/card.ts` now scales a board pip with the face through
 * `BOARD_PIP_CQW`, so a cost run on the title row is 19.59px rather than the
 * 27.6px of fixed-size pips that left 0.87px of name. The face fights back and
 * still loses 21.59px of the name it has, which is the argument.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Card as DslCard } from '@mtg/dsl';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Card } from '../src/card/Card';
import { GlobalStyles } from '../src/styles/index';

afterEach(cleanup);

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

/** The window, reached structurally; the workspace tsconfig carries no `lib: dom`. */
function windowOf(): WindowLike {
  const candidate = globalThis as Partial<WindowLike>;
  const document = candidate.document;
  if (typeof candidate.getComputedStyle !== 'function' || document === undefined) {
    throw new Error('this test needs a jsdom window');
  }
  return { document, getComputedStyle: candidate.getComputedStyle };
}

function elementAt(selector: string): ElementLike {
  const element = windowOf().document.body.querySelector(selector);
  if (element === null) throw new Error(`nothing rendered matched ${selector}`);
  return element;
}

function styleOf(selector: string): StyleLike {
  const view = windowOf();
  return view.getComputedStyle(elementAt(selector));
}

function creature(): DslCard {
  const card = EXAMPLE_CARDS.find((entry) => entry.kind === 'creature');
  if (card === undefined) throw new Error('the DSL example set has no creature');
  return card;
}

describe('the mana cost on a board face', () => {
  it('leaves the title row, which the name then has to itself', () => {
    render(h(Card, { card: creature(), size: 'board' }));
    // The row is still drawn, and there is not a pip in it.
    expect(elementAt("[data-region='title'] .mtg-card__name")).toBeTruthy();
    expect(windowOf().document.body.querySelector("[data-region='title'] .mtg-pip")).toBeNull();
    // And the cost is still on the face, in a corner of its own.
    expect(elementAt('.mtg-card__corner .mtg-pip')).toBeTruthy();
  });

  it('keeps the cost in the title row at every other size', () => {
    for (const size of ['full', 'compact'] as const) {
      const markup = renderToStaticMarkup(h(Card, { card: creature(), size }));
      expect(markup, `${size} keeps its cost in the title bar`).not.toContain('mtg-card__corner');
      render(h(Card, { card: creature(), size }));
      expect(elementAt("[data-region='title'] .mtg-pip"), `${size} title row pips`).toBeTruthy();
      cleanup();
    }
  });

  it('is positioned into the corner rather than laid out into it', () => {
    // A laid-out cost takes height from the region it is in; a positioned one
    // takes none, which is the whole reason it is out of the flex column.
    render(h('div', null, h(GlobalStyles), h(Card, { card: creature(), size: 'board' })));
    const corner = styleOf('.mtg-card__corner');
    expect(corner.getPropertyValue('position')).toBe('absolute');
    expect(corner.getPropertyValue('inset-block-start')).toBe('2px');
    expect(corner.getPropertyValue('inset-inline-end')).toBe('2px');

    // The containing block is the art window and not the face, which is what
    // makes the clip rather than the offsets the guarantee: a cost pinned two
    // pixels inside a window that keeps shrinking is cut off by the picture,
    // and a cost pinned two pixels inside the face is eventually drawn on the
    // name. That is the second of the two defects `mtg-bc2.129` recorded.
    expect(elementAt(".mtg-art[data-region='art'] > .mtg-card__corner")).toBeTruthy();
    const window_ = styleOf('.mtg-art');
    expect(window_.getPropertyValue('position')).toBe('relative');
    expect(window_.getPropertyValue('overflow')).toBe('hidden');
  });
});
