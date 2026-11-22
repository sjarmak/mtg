// @vitest-environment jsdom
/**
 * The game log's disclosure survives the game it was pressed in.
 *
 * `mtg-rgc.8`. The 2026-08-22 pass made the log open by default and left the
 * press unremembered, so a player who shut it got it back open on the next deal,
 * every deal. What is checked here is the three states the preference has, in
 * the terms the panel speaks: an unanswered player gets the shipped default, a
 * player who pressed gets what they pressed after a full remount, and a store
 * that cannot keep the answer is a first visit rather than an error.
 *
 * Rendered through `PlayRoute` rather than against the hook, because the bug
 * this can plausibly ship is not the hook returning the wrong boolean — it is
 * the boolean never reaching the panel, which only a rendered log can catch.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { FULL_CONTROL } from '@mtg/kernel';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { twoHumanMirror } from '../support/two-human';
import { GAME_LOG_LABEL, OPEN_BY_DEFAULT } from '../../src/log/GameLog';
import { LOG_OPEN_KEY } from '../../src/routes/play/log-open';

afterEach(cleanup);

interface StoreLike {
  readonly clear?: () => void;
  readonly getItem?: (key: string) => string | null;
  readonly setItem?: (key: string, value: string) => void;
}

function store(): StoreLike | undefined {
  return (globalThis as { readonly localStorage?: StoreLike }).localStorage;
}

/** jsdom keeps one store for the whole file, so each test starts on a fresh browser. */
beforeEach(() => {
  store()?.clear?.();
});

/** The head, which is the one control that names the log and reports its state. */
function head(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL}, \\d+ entr`) });
}

function expanded(): string | null {
  const node = head() as unknown as { readonly getAttribute: (name: string) => string | null };
  return node.getAttribute('aria-expanded');
}

function deal(): void {
  const game = twoHumanMirror(EXAMPLE_CARDS);
  render(h(PlayRoute, { config: { ...game, autoPass: FULL_CONTROL } }));
}

describe('the game log remembers whether it was open', () => {
  it('opens a first visit on the shipped default', () => {
    deal();
    expect(OPEN_BY_DEFAULT).toBe(true);
    expect(expanded()).toBe('true');
  });

  it('gives a player who shut it a shut log on the next game', () => {
    deal();
    fireEvent.click(head());
    expect(expanded()).toBe('false');
    cleanup();

    deal();
    expect(expanded()).toBe('false');
  });

  it('gives it back to a player who opened it again, which is the half a one-way write would fail', () => {
    deal();
    fireEvent.click(head());
    fireEvent.click(head());
    expect(expanded()).toBe('true');
    // Asserted on the store as well as on the next game, because a log that was
    // never written stays open too: only the recorded 'open' tells a player who
    // said so apart from a player who never said anything.
    expect(store()?.getItem?.(LOG_OPEN_KEY)).toBe('open');
    cleanup();

    deal();
    expect(expanded()).toBe('true');
  });

  it("writes the press under this surface's own key and nobody else's", () => {
    deal();
    fireEvent.click(head());
    expect(store()?.getItem?.(LOG_OPEN_KEY)).toBe('shut');
  });

  it('reads an unrecognized stored value as a player who has not answered', () => {
    store()?.setItem?.(LOG_OPEN_KEY, 'maybe');
    deal();
    expect(expanded()).toBe('true');
  });
});
