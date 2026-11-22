// @vitest-environment jsdom
/**
 * The config a game is dealt from is read once, and every path reads that one.
 *
 * `mtg-zwbq`. `usePlaySession` opens its session in a lazy state initializer, so
 * a caller whose config arrives asynchronously keeps the game built from the
 * first value it was handed. That is the decision the hook makes and it is the
 * right one — re-dealing under a player mid-game throws away the choices they
 * have made and says nothing on screen — but until this bead it was only half
 * true: the session ignored a later config while `restart` and `undo` read the
 * live prop, so the same interface played one game through twelve controls and
 * started a different one through the thirteenth.
 *
 * Three claims, and the third is the one that was false:
 *
 *  1. A render carrying a different config does not move the session.
 *  2. It does not move the opening settings either, which seed from the config
 *     the same way and are the player's to change afterwards.
 *  3. `restart` deals the game that was opened. Asserted against both answers
 *     rather than against one, because "not the second config" is only worth
 *     something beside a run proving the second config was distinguishable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { FULL_CONTROL, DEFAULT_AUTO_PASS, stateFingerprint } from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { usePlaySession } from '../../src/routes/play/use-session';
import type { PlayConfig, PlaySessionHandle } from '../../src/routes/play/use-session';

afterEach(cleanup);

/** Two games that differ in the one thing a fingerprint can see: the shuffle. */
function config(seed: string): PlayConfig {
  return dealMirrorGame(EXAMPLE_CARDS, { seed, youName: 'You', opponentName: 'Bot' }).config;
}

const FIRST = 'ui-session-config/first';
const SECOND = 'ui-session-config/second';

function opened(
  initial: PlayConfig,
): ReturnType<typeof renderHook<PlaySessionHandle, { readonly config: PlayConfig }>> {
  return renderHook(({ config: held }: { readonly config: PlayConfig }) => usePlaySession(held), {
    initialProps: { config: initial },
  });
}

describe('the session is dealt from the config it was mounted with', () => {
  it('two seeds deal two games, so the rest of this file can tell them apart', () => {
    const first = opened(config(FIRST));
    const second = opened(config(SECOND));
    expect(stateFingerprint(first.result.current.session.state)).not.toBe(
      stateFingerprint(second.result.current.session.state),
    );
  });

  it('holds the game across a render carrying a different config', () => {
    const { result, rerender } = opened(config(FIRST));
    const before = stateFingerprint(result.current.session.state);
    const viewer = result.current.viewer;

    rerender({ config: config(SECOND) });

    expect(stateFingerprint(result.current.session.state)).toBe(before);
    expect(result.current.viewer).toBe(viewer);
  });

  it('holds the opening settings across it too', () => {
    const { result, rerender } = opened({ ...config(FIRST), autoPass: DEFAULT_AUTO_PASS });
    expect(result.current.autoPass).toEqual(DEFAULT_AUTO_PASS);

    rerender({ config: { ...config(SECOND), autoPass: FULL_CONTROL } });

    expect(result.current.autoPass).toEqual(DEFAULT_AUTO_PASS);

    // And the player's own change still lands, which is what makes the line
    // above a mount-time seed rather than a frozen setting.
    act(() => {
      result.current.setAutoPass(FULL_CONTROL);
    });
    expect(result.current.autoPass).toEqual(FULL_CONTROL);
  });

  it('restarts the game that was opened, not the one the last render passed', () => {
    const { result, rerender } = opened(config(FIRST));
    const dealt = stateFingerprint(result.current.session.state);

    rerender({ config: config(SECOND) });
    act(() => {
      result.current.restart();
    });

    expect(stateFingerprint(result.current.session.state)).toBe(dealt);
  });
});
