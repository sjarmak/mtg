// @vitest-environment jsdom
/**
 * The pass's second gesture: hold it, or open its menu, and the yield options
 * are there.
 *
 * `mtg-nxh`, which is the last row of `mtg-bz2.14`'s gesture table that reached
 * nothing on either input model. A yield was reachable only through the turn
 * badge's disclosure in the toolbar — a different control, at the other end of
 * the screen from the button the player is already holding.
 *
 * The bead left one question open: what the options are when they are opened
 * from the pass rather than from the badge. They are the badge's own, which is
 * why `../../src/routes/play/yields.ts` exists — one list, read by both, so a
 * boundary cannot be offered in one place and missing from the other.
 *
 * This file is `./touch.test.ts`'s shape, and for its reason: the load-bearing
 * assertions are the negative ones. A gesture that opens a panel is easy; a
 * gesture that does not also pass priority, does not arm for a mouse, and does
 * not exist at all for a caller with no yield to offer is the whole of what
 * makes it safe to put a second meaning on the one control whose promise is that
 * it never changes.
 *
 * jsdom lays nothing out, so nothing here is about where the panel is drawn.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Choice, GameSession, YieldBoundary } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { LONG_PRESS_MS } from '../../src/card/press';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { PASS_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { PASS_YIELDS_LABEL } from '../../src/routes/play/pass';
import { YIELDS } from '../../src/routes/play/yields';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const NAMES = ['You', 'Bot'] as const;

/** The opening hand kept, which is a priority and therefore has a pass. */
function prioritySession(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  const opened = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
  return opened.pending?.kind === 'mulligan' ? choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS }) : opened;
}

function closest(node: unknown, selector: string): unknown {
  return (node as { closest(selector: string): unknown }).closest(selector);
}

/** The document's body, structurally, so Escape can be pressed from off the panel. */
function documentBody(): Parameters<typeof fireEvent.keyDown>[0] {
  const host = globalThis as { readonly document?: { readonly body?: unknown } };
  const body = host.document?.body;
  if (typeof body !== 'object' || body === null) throw new Error('expected a jsdom document');
  return body as Parameters<typeof fireEvent.keyDown>[0];
}

/** One attribute, read structurally: this workspace has no `lib: dom`. */
function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function passButton(): ReturnType<typeof screen.getAllByRole>[number] {
  const fixed = screen
    .getAllByRole('button', { name: PASS_LABEL })
    .filter((node) => closest(node, '.mtg-play__pass') !== null);
  const only = fixed[0];
  if (only === undefined || fixed.length !== 1) {
    throw new Error(`expected exactly one fixed pass button, found ${String(fixed.length)}`);
  }
  return only;
}

function yieldPanel(): ReturnType<typeof screen.queryByRole> {
  return screen.queryByRole('group', { name: PASS_YIELDS_LABEL });
}

interface Rendered {
  readonly onChoose: ReturnType<typeof vi.fn>;
  readonly onYield: ReturnType<typeof vi.fn>;
}

/** The play surface with a yield to offer, which is what a live game passes. */
function view(withYield = true): Rendered {
  const onChoose = vi.fn<(choice: Choice) => void>();
  const onYield = vi.fn<(boundary: YieldBoundary) => void>();
  render(
    h(PlayView, {
      session: prioritySession(),
      viewer: 0,
      names: NAMES,
      onChoose,
      ...(withYield ? { onYield } : {}),
    }),
  );
  return { onChoose, onYield };
}

/** One press, as a browser delivers it: down, the hold, up, then the click. */
function pressOn(node: Element, type: string, holdMs: number): void {
  const shared = { pointerId: 1, pointerType: type, clientX: 40, clientY: 40 };
  fireEvent.pointerDown(node, shared);
  act(() => void vi.advanceTimersByTime(holdMs));
  fireEvent.pointerUp(node, shared);
  fireEvent.click(node, { detail: 1 });
}

describe('a long press on the fixed pass', () => {
  it('opens the yield options, and they are the ones the turn badge offers', () => {
    view();
    expect(yieldPanel(), 'the panel is drawn before the gesture').toBeNull();
    pressOn(passButton(), 'touch', LONG_PRESS_MS);
    const panel = yieldPanel();
    expect(panel, 'the hold opened nothing').not.toBeNull();
    // The badge's own list, read from the one module both draw from, so this
    // fails the day the two lists stop agreeing rather than the day somebody
    // notices a missing boundary in a game.
    for (const yielded of YIELDS) {
      expect(screen.queryByRole('button', { name: yielded.label })).not.toBeNull();
    }
  });

  it('takes the yield it was asked for, and closes', () => {
    const { onYield, onChoose } = view();
    pressOn(passButton(), 'touch', LONG_PRESS_MS);
    const first = YIELDS[0];
    if (first === undefined) throw new Error('the yield list is empty');
    fireEvent.click(screen.getByRole('button', { name: first.label }));
    expect(onYield).toHaveBeenCalledWith(first.boundary);
    expect(yieldPanel(), 'the panel stayed open after answering it').toBeNull();
    // And it is a yield rather than a pass: taking one submits no index.
    expect(onChoose).not.toHaveBeenCalled();
  });

  /**
   * The one that matters most. A hold that both opened the options and passed
   * priority would spend the window the player was still deciding about, which
   * is exactly the double-acting `../../src/card/press.ts` claims the following
   * click to prevent on a card face.
   */
  it('does not also pass', () => {
    const { onChoose } = view();
    pressOn(passButton(), 'touch', LONG_PRESS_MS);
    expect(onChoose, 'the hold passed priority as well as opening the panel').not.toHaveBeenCalled();
  });

  it('leaves an ordinary tap the pass it always was', () => {
    const { onChoose } = view();
    pressOn(passButton(), 'touch', 0);
    expect(yieldPanel(), 'a tap opened the yield panel').toBeNull();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  /**
   * The model clamp `press.ts` writes down: a mouse arms nothing, so a slow
   * click on the pass is a pass. The mouse reaches the same options through the
   * context menu, which is the gesture below.
   */
  it('arms nothing for a mouse, so a held click still passes', () => {
    const { onChoose } = view();
    pressOn(passButton(), 'mouse', LONG_PRESS_MS);
    expect(yieldPanel(), 'a held mouse press opened the yield panel').toBeNull();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

describe('the pointer opening, and the exits', () => {
  it('opens on the context menu, which is what opens a card menu one column over', () => {
    view();
    fireEvent.contextMenu(passButton());
    expect(yieldPanel()).not.toBeNull();
  });

  it('closes on Escape from anywhere', () => {
    view();
    fireEvent.contextMenu(passButton());
    fireEvent.keyDown(documentBody(), { key: 'Escape' });
    expect(yieldPanel()).toBeNull();
  });

  it('says it has a popup, and whether the popup is open', () => {
    view();
    expect(attr(passButton(), 'aria-haspopup')).toBe('true');
    expect(attr(passButton(), 'aria-expanded')).toBe('false');
    fireEvent.contextMenu(passButton());
    expect(attr(passButton(), 'aria-expanded')).toBe('true');
  });
});

describe('a surface with no yield to offer', () => {
  /**
   * A replay frame or a read-only render passes no `onYield`, and gets the
   * button it always had: no second gesture, no popup promised, and a hold that
   * is an ordinary press.
   */
  it('draws the button it always had', () => {
    const { onChoose } = view(false);
    expect(attr(passButton(), 'aria-haspopup')).toBeNull();
    pressOn(passButton(), 'touch', LONG_PRESS_MS);
    expect(yieldPanel()).toBeNull();
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
