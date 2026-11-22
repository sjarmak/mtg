// @vitest-environment jsdom
/**
 * The take-back, which the kernel has had since `mtg-bz2.13` and the screen has
 * not.
 *
 * `@mtg/kernel`'s `undo.ts` decides the boundary set, `session.ts` does the
 * rewind and writes the refusal, and `use-session.ts` puts both on the handle.
 * Nothing drew a control, so the whole mechanism was reachable only from a test.
 *
 * The load-bearing assertion is the second one: the control calls `undo()` even
 * where `canUndo` is false. A control that refused to call it would swallow the
 * kernel's stated reason and leave a press that does nothing, which is the
 * silence the refusal exists to break — `use-session.ts` puts that reason on the
 * error line, and `LiveGame.ts` draws that line as an alert.
 *
 * jsdom lays nothing out; where the control sits is `styles/views.ts`'s.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { GameSession } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { LiveGame } from '../../src/routes/play/LiveGame';
import { PlayView } from '../../src/routes/play/PlayView';
import { UNDO_LABEL } from '../../src/routes/play/undo';

afterEach(() => {
  cleanup();
});

const NAMES = ['You', 'Bot'] as const;

function prioritySession(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const opened = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
  return opened.pending?.kind === 'mulligan' ? choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS }) : opened;
}

function draw(overrides: { readonly canUndo?: boolean; readonly onUndo?: (() => void) | undefined }): void {
  render(
    h(PlayView, {
      session: prioritySession(),
      viewer: 0,
      names: NAMES,
      onChoose: () => undefined,
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      onYield: () => undefined,
      ...overrides,
    }),
  );
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

describe('the take-back on the play surface', () => {
  it('rewinds on a press while the kernel says it can', () => {
    const onUndo = vi.fn();
    draw({ canUndo: true, onUndo });

    const control = screen.getByRole('button', { name: UNDO_LABEL });
    expect(attr(control, 'data-available')).toBe('true');

    fireEvent.click(control);

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('still presses through where it cannot, so the kernel states the reason', () => {
    const onUndo = vi.fn();
    draw({ canUndo: false, onUndo });

    const control = screen.getByRole('button', { name: UNDO_LABEL });
    expect(attr(control, 'data-available')).toBe('false');
    // Not `disabled`, and not `aria-disabled` either: both are claims that the
    // press does nothing, and the press is what produces the sentence.
    expect(attr(control, 'disabled')).toBe(null);
    expect(attr(control, 'aria-disabled')).toBe(null);

    fireEvent.click(control);

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("carries the kernel's refusal to the alert when it is pressed with nothing to take back", () => {
    // The whole chain rather than the button: `LiveGame` owns the session, so
    // this is the only render in this file where the press reaches a real
    // `undo()` and the real refusal comes back. A fresh game has made no
    // decision since its last boundary, so the kernel refuses and says why.
    const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
    render(h(LiveGame, { config: game.config, report: null }));

    const control = screen.getByRole('button', { name: UNDO_LABEL });
    expect(attr(control, 'data-available')).toBe('false');
    expect(screen.queryByRole('alert'), 'the line is silent until the press').toBe(null);

    fireEvent.click(control);

    const alert = screen.getByRole('alert') as unknown as { readonly textContent: string | null };
    expect(alert.textContent ?? '').not.toBe('');
  });

  it('is not drawn for a caller with nothing listening', () => {
    draw({ canUndo: true });

    expect(screen.queryByRole('button', { name: UNDO_LABEL })).toBe(null);
  });
});
