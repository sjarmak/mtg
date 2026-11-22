// @vitest-environment jsdom
/**
 * The command zone, drawn: a seat's commander on the right-hand side of its
 * battlefield, castable from there, with the tax ledger under it.
 *
 * Three properties. The panel sits in the side after the battlefield and before
 * the hand, and the side says so with an attribute the command sheet lays the
 * grid out on; a standard side carries neither. The ledger reads the engine's
 * count rather than keeping one. And the card is a button exactly when the
 * caller says the engine offers a cast, the hand's own rule.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { Board } from '../src/board/Board';
import type { BoardSide } from '../src/board/Board';
import { CommandZone, commanderTaxText } from '../src/board/CommandZone';
import type { CommanderCard } from '../src/board/CommandZone';
import { BOARD_CSS } from '../src/styles/board/index';

afterEach(cleanup);

/** The workspace tsconfig has no `lib: dom`; this is the slice of an element the test reads. */
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

const general: CommanderCard = { key: 'c1', card: creature, casts: 1, cost: '{2}{W}{G}' };

function side(name: string, commandZone?: BoardSide['commandZone']): BoardSide {
  return {
    status: { name, life: 40, handCount: 0, libraryCount: 90, graveyardCount: 0 },
    battlefield: { label: `${name} battlefield`, permanents: [] },
    hand: { label: `${name} hand`, cards: [] },
    ...(commandZone === undefined ? {} : { commandZone }),
  };
}

describe('command zone', () => {
  it('sits on the right-hand side of the battlefield, and a standard side draws none', () => {
    const { container: rendered } = render(
      h(Board, {
        you: side('You', { label: 'You command zone', commanders: [general] }),
        opponent: side('Bot'),
        stack: { entries: [] },
      }),
    );
    const container = asElement(rendered);
    const you = container.querySelector(".mtg-board__side[data-seat='you']");
    expect(you?.getAttribute('data-command-zone')).toBe('true');
    const children = Array.from(you?.children ?? []).map((child) => child.className);
    expect(children.indexOf('mtg-command')).toBe(children.indexOf('mtg-zone') + 1);
    expect(you?.querySelector('.mtg-command .mtg-zone__label')?.textContent).toBe('You command zone');
    const opponent = container.querySelector(".mtg-board__side[data-seat='opponent']");
    expect(opponent?.hasAttribute('data-command-zone')).toBe(false);
    expect(opponent?.querySelector('.mtg-command')).toBeNull();
    expect(you?.getAttribute('data-side-panel')).toBe('true');
    expect(opponent?.hasAttribute('data-side-panel')).toBe(false);
    expect(BOARD_CSS).toContain(".mtg-board__side[data-side-panel='true'] {\n  display: grid;");
  });

  it('reads the engine’s cast count into the ledger and prints the taxed cost of the next cast', () => {
    expect(commanderTaxText(0)).toBe('not yet cast');
    expect(commanderTaxText(2)).toBe('cast 2× · tax {4}');
    const { container } = render(h(CommandZone, { label: 'You command zone', commanders: [general] }));
    const ledger = asElement(container).querySelector('.mtg-command__ledger');
    expect(ledger?.getAttribute('data-casts')).toBe('1');
    expect(ledger?.querySelector('.mtg-command__casts')?.textContent).toContain('cast 1×');
    expect(ledger?.querySelector('.mtg-command__cost')?.getAttribute('aria-label')).toBe(
      'Next cast costs {2}{W}{G}',
    );
  });

  it('is a button only while the engine offers the cast, and answers the three gestures then', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const onMenu = vi.fn();
    const { container: inert } = render(h(CommandZone, { label: 'Zone', commanders: [general], onSelect }));
    expect(asElement(inert).querySelector('button')).toBeNull();
    cleanup();
    const { container } = render(
      h(CommandZone, {
        label: 'Zone',
        commanders: [{ ...general, playable: true }],
        onSelect,
        onActivate,
        onMenu,
      }),
    );
    const button = asElement(container).querySelector('button');
    if (button === null) throw new Error('a castable commander draws no button');
    fireEvent.click(press(button));
    fireEvent.doubleClick(press(button));
    fireEvent.contextMenu(press(button));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'c1' }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: 'c1' }));
    expect(onMenu).toHaveBeenCalledWith(expect.objectContaining({ key: 'c1' }));
  });

  it('draws its empty sentence once the commander has left the zone', () => {
    const { container } = render(h(CommandZone, { label: 'Zone', commanders: [] }));
    expect(asElement(container).querySelector('.mtg-zone__empty')?.textContent).toBe('commander in play');
    cleanup();
    const { container: taxed } = render(h(CommandZone, { label: 'Zone', commanders: [], tally: 1 }));
    expect(asElement(taxed).querySelector('.mtg-zone__empty')?.textContent).toBe(
      'commander in play · cast 1× · tax {2}',
    );
  });
});
