// @vitest-environment jsdom
/**
 * Undo on the surface that holds the game.
 *
 * The kernel side of `mtg-bz2.13` is proved in `packages/kernel/test/undo.test.ts`:
 * which events close a boundary, that a rewind to one lands byte-identically,
 * and that a rewind past one is refused. This file checks the half a person
 * touches, which is `usePlaySession` — the hook owns the session, so it is the
 * one place that can hand a control both the press and the reason the press was
 * refused.
 *
 * Two things are asserted and they are the two that would break silently. The
 * refusal reaches `error` rather than vanishing, because a control that quietly
 * does nothing is the failure the bead was filed against. And undo re-settles
 * under the live auto-pass settings rather than under full control, because a
 * session handed back mid-way through priorities the player asked not to be
 * asked about would be a different surface from every other session this hook
 * hands out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { AutoPassSettings, GameSession } from '@mtg/kernel';
import {
  DEFAULT_AUTO_PASS,
  FULL_CONTROL,
  advance,
  canUndo,
  passIndex,
  serializeEvents,
  stateFingerprint,
} from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { usePlaySession } from '../../src/routes/play/use-session';
import type { PlayConfig, PlaySessionHandle } from '../../src/routes/play/use-session';

afterEach(cleanup);

function config(autoPass: AutoPassSettings): PlayConfig {
  return {
    ...dealMirrorGame(EXAMPLE_CARDS, { seed: 'ui-undo/v0', youName: 'You', opponentName: 'Bot' }).config,
    autoPass,
  };
}

/** One config per hook, held across renders so the deck is dealt once. */
function playing(
  autoPass: AutoPassSettings = FULL_CONTROL,
): ReturnType<typeof renderHook<PlaySessionHandle, unknown>> {
  const dealt = config(autoPass);
  return renderHook(() => usePlaySession(dealt));
}

/** The index of an option that is not a pass, or null when only a pass is on offer. */
function actionIndex(session: GameSession): number | null {
  const decision = session.pending;
  if (decision === null) return null;
  const found = decision.options.findIndex(
    (option) => option.type === 'playLand' || option.type === 'castSpell',
  );
  return found < 0 ? null : found;
}

/**
 * Drives the hook until the player has taken a decision nothing has committed
 * behind, and hands back the session as it stood one press earlier.
 */
function toFirstUndoable(handle: { current: PlaySessionHandle }): GameSession {
  for (let step = 0; step < 400 && handle.current.session.pending !== null; step += 1) {
    const before = handle.current.session;
    const decision = before.pending;
    if (decision === null) break;
    const index = actionIndex(before) ?? passIndex(decision) ?? 0;
    act(() => {
      handle.current.choose(index);
    });
    if (handle.current.canUndo) return before;
  }
  throw new Error('the driven game never reached a position undo was available from');
}

describe('taking a decision back', () => {
  it('lands on the position the game stood in before it', () => {
    const { result } = playing();
    const before = toFirstUndoable(result);

    act(() => {
      result.current.undo();
    });

    expect(result.current.error).toBeNull();
    expect(stateFingerprint(result.current.session.state)).toBe(stateFingerprint(before.state));
    expect(serializeEvents(result.current.session.events)).toBe(serializeEvents(before.events));
    expect(result.current.session.choices).toEqual(before.choices);
  });

  it('offers the press only while something uncommitted is left to take back', () => {
    const { result } = playing();
    toFirstUndoable(result);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.canUndo).toBe(false);
    expect(canUndo(result.current.session)).toBe(false);
  });

  /**
   * A rewind runs at full control, because that is the only way to spend a
   * recording that has auto-passed priorities written into it. What comes back
   * must not be at full control: a session sitting on a priority the player's
   * own stops say not to ask about would be the one session on this surface
   * whose settings are not the live ones. Asserted as a fixed point, which is
   * what "settled" means — running the settings over it again moves nothing.
   */
  it('hands back a session already settled under the live settings', () => {
    const { result } = playing(DEFAULT_AUTO_PASS);
    toFirstUndoable(result);

    act(() => {
      result.current.undo();
    });

    const undone = result.current.session;
    const resettled = advance(undone, { autoPass: DEFAULT_AUTO_PASS });
    expect(resettled.choices).toEqual(undone.choices);
    expect(serializeEvents(resettled.events)).toBe(serializeEvents(undone.events));
  });
});

describe('a refused undo', () => {
  it('says why on the error line instead of doing nothing', () => {
    const { result } = playing();
    const opening = result.current.session;
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.undo();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error).toContain('undo');
    // The game did not move, which is the other half of "refused": a stated
    // reason on a session that quietly rewound would be worse than silence.
    expect(result.current.session).toBe(opening);
  });

  it('names the boundary once one has closed', () => {
    const { result } = playing();
    toFirstUndoable(result);
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.undo();
    });

    const committed = result.current.session.committed;
    expect(committed).not.toBeNull();
    expect(result.current.error).toContain(committed?.reason.why ?? 'nothing');
  });

  it('clears the reason as soon as the game moves again', () => {
    const { result } = playing();
    act(() => {
      result.current.undo();
    });
    expect(result.current.error).not.toBeNull();

    const decision = result.current.session.pending;
    expect(decision).not.toBeNull();
    act(() => {
      result.current.choose(0);
    });
    expect(result.current.error).toBeNull();
  });
});
