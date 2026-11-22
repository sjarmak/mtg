// @vitest-environment jsdom
/**
 * The top of the library, drawn while the engine says it is public: Oracle of
 * Mul Daya's revealed card, in the command zone's column, a button exactly
 * when the caller says the engine offers a play from there.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Board } from '../src/board/Board';
import type { BoardSide } from '../src/board/Board';
import { LibraryTop } from '../src/board/LibraryTop';
import type { HandCard } from '../src/board/Hand';
import { BOARD_CSS } from '../src/styles/board/index';

afterEach(cleanup);

interface Element {
  readonly className: string;
  readonly textContent: string | null;
  readonly children: ArrayLike<Element>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): Element | null;
}

const asElement = (container: unknown): Element => container as Element;
const press = (node: Element): Parameters<typeof fireEvent.click>[0] =>
  node as unknown as Parameters<typeof fireEvent.click>[0];

const creature = EXAMPLE_CARDS.find((card) => card.kind === 'creature');
if (creature === undefined) throw new Error('the examples hold no creature');

const top: HandCard = { key: 't1', card: creature };

function side(name: string, libraryTop?: BoardSide['libraryTop']): BoardSide {
  return {
    status: { name, life: 20, handCount: 0, libraryCount: 50, graveyardCount: 0 },
    battlefield: { label: `${name} battlefield`, permanents: [] },
    hand: { label: `${name} hand`, cards: [] },
    ...(libraryTop === undefined ? {} : { libraryTop }),
  };
}

describe('library top', () => {
  it('sits in the panel column beside the battlefield, and an ordinary side draws none', () => {
    const { container: rendered } = render(
      h(Board, {
        you: side('You', { label: 'You library top', cards: [top] }),
        opponent: side('Bot'),
        stack: { entries: [] },
      }),
    );
    const container = asElement(rendered);
    const you = container.querySelector(".mtg-board__side[data-seat='you']");
    expect(you?.getAttribute('data-side-panel')).toBe('true');
    expect(you?.hasAttribute('data-command-zone')).toBe(false);
    const children = Array.from(you?.children ?? []).map((child) => child.className);
    expect(children.indexOf('mtg-library-top')).toBe(children.indexOf('mtg-zone') + 1);
    expect(you?.querySelector('.mtg-library-top .mtg-zone__label')?.textContent).toBe('You library top');
    expect(you?.querySelector('.mtg-library-top .mtg-card')).not.toBeNull();
    const opponent = container.querySelector(".mtg-board__side[data-seat='opponent']");
    expect(opponent?.hasAttribute('data-side-panel')).toBe(false);
    expect(opponent?.querySelector('.mtg-library-top')).toBeNull();
    // Takes the commander's place at the top of the panel on a standard table.
    expect(BOARD_CSS).toContain(
      ".mtg-board__side[data-side-panel='true']:not([data-command-zone='true']) > .mtg-library-top { grid-row: 1;",
    );
  });

  it('is a button only while the engine offers the play, and answers the three gestures then', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const onMenu = vi.fn();
    const { container: inert } = render(h(LibraryTop, { label: 'Top', cards: [top], onSelect }));
    expect(asElement(inert).querySelector('button')).toBeNull();
    cleanup();
    const { container } = render(
      h(LibraryTop, { label: 'Top', cards: [{ ...top, playable: true }], onSelect, onActivate, onMenu }),
    );
    const button = asElement(container).querySelector('button');
    if (button === null) throw new Error('a playable top card draws no button');
    fireEvent.click(press(button));
    fireEvent.doubleClick(press(button));
    fireEvent.contextMenu(press(button));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 't1' }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: 't1' }));
    expect(onMenu).toHaveBeenCalledWith(expect.objectContaining({ key: 't1' }));
  });
});
