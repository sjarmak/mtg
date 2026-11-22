// @vitest-environment jsdom
/**
 * The two cells above every Play section, and what a dark one says.
 *
 * `mtg-a982g.1`. The rule is `../../src/routes/play/availability.ts`'s; this
 * pins how a cell draws it: a disabled button with the sentence beside it,
 * never a missing column, and the open column's body beneath.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  OPPONENT_BOT_LABEL,
  OPPONENT_CHOICE_LABEL,
  OPPONENT_LAN_LABEL,
  OpponentChoice,
} from '../../src/routes/play/OpponentChoice';
import type { OpponentChoiceProps } from '../../src/routes/play/OpponentChoice';
import { COMMANDER_UNAVAILABLE_REASON } from '../../src/routes/play/availability';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const NO_LAB = 'No lab is listening here.';

/** The attribute a node carries, without the DOM lib. */
function attr(node: unknown, name: string): string | null {
  return (node as { readonly getAttribute: (name: string) => string | null }).getAttribute(name);
}

function choice(overrides: Partial<OpponentChoiceProps> = {}): OpponentChoiceProps {
  return {
    setKind: 'kernel',
    format: 'constructed',
    opponent: 'bot',
    facts: { lan: { status: 'unavailable', reason: NO_LAB } },
    onOpponent: vi.fn(),
    bot: h('p', null, 'the bot body'),
    lan: h('p', null, 'the network body'),
    ...overrides,
  };
}

describe('the two columns', () => {
  it('draws both cells, labeled, with the open one pressed', () => {
    render(h(OpponentChoice, choice()));
    const group = screen.getByRole('group', { name: OPPONENT_CHOICE_LABEL });
    const bot = within(group).getByRole('button', { name: OPPONENT_BOT_LABEL });
    const lan = within(group).getByRole('button', { name: OPPONENT_LAN_LABEL });
    expect(attr(bot, 'aria-pressed')).toBe('true');
    expect(attr(lan, 'aria-pressed')).toBe('false');
  });

  it('draws a cell it cannot deal as a disabled button with the reason beside it', () => {
    render(h(OpponentChoice, choice()));
    const lan = screen.getByRole('button', { name: OPPONENT_LAN_LABEL }) as unknown as {
      readonly disabled: boolean;
      readonly parentElement: { readonly textContent: string | null };
    };
    expect(lan.disabled).toBe(true);
    expect(lan.parentElement.textContent).toContain(NO_LAB);
    expect(
      (screen.getByRole('button', { name: OPPONENT_BOT_LABEL }) as unknown as { disabled: boolean }).disabled,
    ).toBe(false);
  });

  it('darkens both cells for Commander and says why once per cell', () => {
    render(h(OpponentChoice, choice({ format: 'commander', facts: { lan: { status: 'ready' } } })));
    expect(screen.getAllByText(COMMANDER_UNAVAILABLE_REASON)).toHaveLength(2);
    expect(screen.queryByText('the bot body')).toBeNull();
  });

  it('tells the page which column was pressed', () => {
    const onOpponent = vi.fn();
    render(h(OpponentChoice, choice({ onOpponent, facts: { lan: { status: 'ready' } } })));
    fireEvent.click(screen.getByRole('button', { name: OPPONENT_LAN_LABEL }));
    expect(onOpponent).toHaveBeenCalledWith('lan');
  });
});

describe('the open column', () => {
  it('draws the body of the open column and not the other', () => {
    render(h(OpponentChoice, choice()));
    expect(screen.getByText('the bot body')).toBeTruthy();
    expect(screen.queryByText('the network body')).toBeNull();
  });

  it('draws the network body once that column is open and can deal', () => {
    render(h(OpponentChoice, choice({ opponent: 'lan', facts: { lan: { status: 'ready' } } })));
    expect(screen.getByText('the network body')).toBeTruthy();
    expect(screen.queryByText('the bot body')).toBeNull();
  });

  it('keeps the body and drops the cells while a game is on', () => {
    render(h(OpponentChoice, choice({ playing: true })));
    expect(screen.getByText('the bot body')).toBeTruthy();
    expect(screen.queryByRole('group', { name: OPPONENT_CHOICE_LABEL })).toBeNull();
  });
});

describe('the sheet', () => {
  it('lays the two cells out and knows the reason line', () => {
    const sheet = uiStyleSheet();
    expect(sheet).toContain('.mtg-opponents {');
    expect(sheet).toContain('.mtg-opponents__cell {');
  });
});
