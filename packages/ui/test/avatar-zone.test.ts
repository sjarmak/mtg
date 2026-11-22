// @vitest-environment jsdom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { AvatarZone } from '../src/board/AvatarZone';
import { Board } from '../src/board/Board';
import type { BoardSide } from '../src/board/Board';
import type { HandCard } from '../src/board/Hand';

afterEach(cleanup);

interface Element {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): Element | null;
}

const asElement = (container: unknown): Element => container as Element;
const press = (element: Element): Parameters<typeof fireEvent.click>[0] =>
  element as unknown as Parameters<typeof fireEvent.click>[0];

const creature = EXAMPLE_CARDS.find((card) => card.kind === 'creature');
if (creature === undefined) throw new Error('the examples hold no creature');

const avatar: HandCard = { key: 'avatar-0', card: creature };

function side(name: string, avatars?: BoardSide['avatars']): BoardSide {
  return {
    status: { name, life: 24, handCount: 7, libraryCount: 53, graveyardCount: 0 },
    battlefield: { label: `${name} battlefield`, permanents: [] },
    hand: { label: `${name} hand`, cards: [] },
    ...(avatars === undefined ? {} : { avatars }),
  };
}

describe('avatar zone', () => {
  it('draws beside the battlefield without becoming a command zone', () => {
    const { container } = render(
      h(Board, {
        you: side('You', { label: 'You avatar', cards: [avatar] }),
        opponent: side('Bot'),
        stack: { entries: [] },
      }),
    );
    const you = asElement(container).querySelector(".mtg-board__side[data-seat='you']");
    expect(you?.getAttribute('data-side-panel')).toBe('true');
    expect(you?.hasAttribute('data-command-zone')).toBe(false);
    expect(you?.querySelector('.mtg-avatar .mtg-zone__label')?.textContent).toBe('You avatar');
    expect(you?.querySelector('.mtg-command')).toBeNull();
  });

  it('answers the avatar ability through the ordinary card gestures', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const onMenu = vi.fn();
    const { container } = render(
      h(AvatarZone, {
        label: 'You avatar',
        cards: [{ ...avatar, playable: true }],
        onSelect,
        onActivate,
        onMenu,
      }),
    );
    const button = asElement(container).querySelector('button');
    if (button === null) throw new Error('a playable avatar draws no button');
    fireEvent.click(press(button));
    fireEvent.doubleClick(press(button));
    fireEvent.contextMenu(press(button));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: avatar.key }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: avatar.key }));
    expect(onMenu).toHaveBeenCalledWith(expect.objectContaining({ key: avatar.key }));
  });
});
