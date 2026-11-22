// @vitest-environment jsdom
import { createElement as h } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { LiveGame } from '../../src/routes/play/LiveGame';
import {
  BEGIN_LABEL,
  OpeningRollBeat,
  REARM_MS,
  REROLL_PAUSE_MS,
  ROLL_LABEL,
  ROLL_MS,
  ROLL_SETTLE_GRACE_MS,
  SKIP_ROLL_LABEL,
  TUMBLE_START,
} from '../../src/routes/play/OpeningRoll';
import type { OpeningRoll } from '../../src/routes/play/opening-roll';

const NAMES = ['You', 'Bot'] as const;

interface HostNode {
  readonly textContent?: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

function nodeOf(value: unknown): HostNode {
  return value as HostNode;
}

function textOf(value: unknown): string {
  return nodeOf(value).textContent ?? '';
}

function transformOf(value: unknown): string {
  const style = nodeOf(value).getAttribute('style') ?? '';
  const match = /(?:^|;)\s*transform:\s*([^;]+)/.exec(style);
  return match?.[1]?.trim() ?? '';
}

function all(root: unknown, selector: string): unknown[] {
  return Array.from(nodeOf(root).querySelectorAll(selector));
}

function fireTransitionEnd(value: unknown, propertyName: string): void {
  fireEvent.transitionEnd(value as Parameters<typeof fireEvent.transitionEnd>[0], { propertyName });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function spinTransforms(root: unknown): string[] {
  return all(root, '.mtg-d20__spin').map(transformOf);
}

function tints(root: unknown): string[] {
  return all(root, '.mtg-d20-stage').map((stage) => nodeOf(stage).getAttribute('data-tint') ?? '');
}

describe('OpeningRollBeat', () => {
  it('tumbles both dice on the press, settles on the seeded faces, and hands the game on', () => {
    const roll: OpeningRoll = { rounds: [[17, 4]], winner: 0 };
    const onDone = vi.fn();
    const { container } = render(h(OpeningRollBeat, { roll, names: NAMES, viewer: 0, onDone }));
    expect(screen.getByRole('dialog', { name: 'Who plays first' })).toBeTruthy();
    expect(tints(container)).toEqual(['pink', 'purple']);
    expect(spinTransforms(container)).toEqual([TUMBLE_START, TUMBLE_START]);

    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    expect(textOf(screen.getByRole('status'))).toBe('Rolling.');
    expect(spinTransforms(container)).toEqual(['none', 'none']);
    expect(screen.getByRole('button', { name: SKIP_ROLL_LABEL })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(ROLL_MS + ROLL_SETTLE_GRACE_MS);
    });
    expect(textOf(screen.getByRole('status'))).toBe('You won the die roll 17 to 4 and play first.');
    const bodies = all(container, '.mtg-d20').map(transformOf);
    expect(bodies[0]).toContain('matrix3d(');
    expect(bodies[0]).not.toBe(bodies[1]);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: BEGIN_LABEL }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('settles on the transition end without waiting out the fallback timer', () => {
    const roll: OpeningRoll = { rounds: [[3, 12]], winner: 1 };
    const { container } = render(h(OpeningRollBeat, { roll, names: NAMES, viewer: 0, onDone: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    const spin = all(container, '.mtg-d20__spin')[0];
    fireTransitionEnd(spin, 'opacity');
    expect(textOf(screen.getByRole('status'))).toBe('Rolling.');
    fireTransitionEnd(spin, 'transform');
    expect(textOf(screen.getByRole('status'))).toBe('Bot won the die roll 12 to 3 and plays first.');
  });

  it('rolls a tie again on its own and narrates the tie between', () => {
    const roll: OpeningRoll = {
      rounds: [
        [9, 9],
        [2, 14],
      ],
      winner: 1,
    };
    const { container } = render(h(OpeningRollBeat, { roll, names: NAMES, viewer: 0, onDone: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    act(() => {
      vi.advanceTimersByTime(ROLL_MS + ROLL_SETTLE_GRACE_MS);
    });
    expect(textOf(screen.getByRole('status'))).toBe('Tied at 9. Rolling again.');
    expect(screen.queryByRole('button', { name: BEGIN_LABEL })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(REROLL_PAUSE_MS);
    });
    expect(spinTransforms(container)).toEqual([TUMBLE_START, TUMBLE_START]);
    act(() => {
      vi.advanceTimersByTime(REARM_MS);
    });
    expect(spinTransforms(container)).toEqual(['none', 'none']);
    act(() => {
      vi.advanceTimersByTime(ROLL_MS + ROLL_SETTLE_GRACE_MS);
    });
    expect(textOf(screen.getByRole('status'))).toBe(
      'Bot won the die roll 14 to 2 after one tie and plays first.',
    );
    expect(screen.getByRole('button', { name: BEGIN_LABEL })).toBeTruthy();
  });

  it('skips straight to the final faces on a tap while rolling', () => {
    const roll: OpeningRoll = {
      rounds: [
        [5, 5],
        [20, 1],
      ],
      winner: 0,
    };
    render(h(OpeningRollBeat, { roll, names: NAMES, viewer: 0, onDone: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(textOf(screen.getByRole('status'))).toBe(
      'You won the die roll 20 to 1 after one tie and play first.',
    );
    expect(screen.getByRole('button', { name: BEGIN_LABEL })).toBeTruthy();
  });

  it('seats the viewer on the purple die whichever seat they hold', () => {
    const roll: OpeningRoll = { rounds: [[6, 15]], winner: 1 };
    const { container } = render(
      h(OpeningRollBeat, { roll, names: ['Bot', 'You'], viewer: 1, onDone: vi.fn() }),
    );
    expect(tints(container)).toEqual(['pink', 'purple']);
    const seats = all(container, '.mtg-opening-roll__seat');
    expect(seats.map((seat) => textOf(nodeOf(seat).querySelector('.mtg-opening-roll__name')))).toEqual([
      'Bot',
      'You',
    ]);
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(textOf(screen.getByRole('status'))).toBe('You won the die roll 15 to 6 and play first.');
  });
});

describe('LiveGame with an opening roll', () => {
  it('opens on the roll, then the table, with the roll said above it through turn one', () => {
    const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
    const roll = game.config.openingRoll;
    expect(roll).toBeDefined();
    expect(game.config.setup.startingPlayer).toBe(roll?.winner);
    render(h(LiveGame, { config: game.config, report: null }));
    expect(screen.getByRole('dialog', { name: 'Who plays first' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ROLL_LABEL }));
    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: BEGIN_LABEL }));
    expect(screen.queryByRole('dialog', { name: 'Who plays first' })).toBeNull();
    expect(nodeOf(screen.getByText(/won the die roll \d+ to \d+/)).getAttribute('class')).toBe(
      'mtg-page-note',
    );
  });

  it('skips the beat for a resumed recording', () => {
    const fresh = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
    const resumed = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot', choices: [0] });
    expect(resumed.config.openingRoll).toEqual(fresh.config.openingRoll);
    render(h(LiveGame, { config: resumed.config, report: null }));
    expect(screen.queryByRole('dialog', { name: 'Who plays first' })).toBeNull();
  });
});
