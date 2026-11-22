// @vitest-environment jsdom
/**
 * That the measured box actually reaches the drawing.
 *
 * `./stack-box.test.ts` checks the arithmetic and
 * `./stack-box.browser.test.ts` checks that the lengths come off the right
 * boxes. Between them sits the wiring -- observe the scrollport, read the room,
 * set the state, redraw -- and neither of those files can see it: the browser
 * rigs in this directory server-render and never mount, so the effect that
 * applies the box has never run in one.
 *
 * jsdom performs no layout, so the room is supplied rather than measured. That
 * is the right trade here: what is under test is that `StripColumns` observes
 * its pane and redraws with what it was told, not what a real engine would tell
 * it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { cleanup, render } from '@testing-library/react';
import { StripColumns } from '../../src/routes/deck/StripColumns';
import { DECK_STACK_BOX } from '../../src/routes/deck/strips';
import type { Group } from '../../src/routes/deck/grouping';
import { STACK_BOX_FROM_PANE, STACK_BOX_SOURCE_PROPERTY } from '../../src/styles/stack-box';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const GROUP: Group<string> = {
  key: 'two',
  label: 'Mana value 2',
  manaValue: 2,
  symbol: '2',
  cards: 4,
  members: ['Ashen Rite'],
};

/**
 * The DOM, reached structurally: this workspace has no `lib: dom`, which is the
 * same reason `../lab/deck-route.test.ts` declares its own `ElementLike`.
 */
interface NodeLike {
  readonly className: string;
  readonly style: { readonly getPropertyValue: (property: string) => string };
  readonly append: (child: NodeLike) => void;
  readonly querySelector: (selector: string) => NodeLike | null;
}

interface DocumentLike {
  readonly createElement: (tag: string) => NodeLike;
  readonly body: NodeLike;
}

function doc(): DocumentLike {
  const { document } = globalThis as unknown as { readonly document: DocumentLike };
  return document;
}

function facts(name: string): {
  key: string;
  name: string;
  manaCost: string;
  colorIdentity: string;
  copies: number;
} {
  return { key: name, name, manaCost: '{1}{W}', colorIdentity: 'W', copies: 4 };
}

/**
 * The pane, with the two things a real one has that jsdom does not: a height,
 * and a declared token.
 */
function paneAround(token: string, scrollportHeight: number): NodeLike {
  const scrollport = doc().createElement('div');
  (scrollport as { className: string }).className = 'mtg-deck__pane-scroll';
  Object.defineProperty(scrollport, 'clientHeight', { value: scrollportHeight });
  doc().body.append(scrollport);
  const host = globalThis as unknown as {
    readonly getComputedStyle: (element: unknown) => { getPropertyValue: (property: string) => string };
  };
  const real = host.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: unknown) => {
    const style = real(element);
    return {
      getPropertyValue: (property: string): string =>
        property === STACK_BOX_SOURCE_PROPERTY && element === scrollport
          ? token
          : style.getPropertyValue(property),
    };
  });
  return scrollport;
}

/** A `ResizeObserver` that fires once on `observe`, which is what the real one does. */
function stubObserver(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe(): void {
        this.callback();
      }
      disconnect(): void {
        // Nothing to release: this one holds no target.
      }
    },
  );
}

function boxOf(container: NodeLike): string | null {
  const region = container.querySelector('.mtg-strips');
  return region === null ? null : region.style.getPropertyValue('--strip-box');
}

/**
 * Rendered *into* the pane rather than beside it, because the hook walks to
 * `parentElement` to find the scrollport. A container passed to `render` is the
 * region's parent, which is exactly the relationship the pane has on the page.
 */
function draw(scrollport: NodeLike): NodeLike {
  const { container } = render(
    h(StripColumns<string>, {
      groups: [GROUP],
      factsOf: facts,
      onSelect: () => undefined,
      label: 'Deck, cards',
    }),
    { container: scrollport as never },
  );
  return container as unknown as NodeLike;
}

describe('a strip region inside a pane that knows its own height', () => {
  it('redraws against the room the pane reported', () => {
    stubObserver();
    const container = draw(paneAround(STACK_BOX_FROM_PANE, 689));
    // 689 less nothing: jsdom lays nothing out, so every offset is zero and the
    // whole scrollport is the room. The subtraction is `./stack-box.test.ts`'s.
    expect(boxOf(container)).toBe('689px');
  });

  it('keeps the constant where the pane declared nothing, whatever height it has', () => {
    stubObserver();
    const container = draw(paneAround('', 689));
    expect(boxOf(container)).toBe(`${String(DECK_STACK_BOX.boxHeight)}px`);
  });

  // Server rendering and every other jsdom suite in this package: the hook has
  // to be a no-op rather than a throw where the observer does not exist.
  it('draws the constant where the environment has no observer at all', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const container = draw(paneAround(STACK_BOX_FROM_PANE, 689));
    expect(boxOf(container)).toBe(`${String(DECK_STACK_BOX.boxHeight)}px`);
  });
});
