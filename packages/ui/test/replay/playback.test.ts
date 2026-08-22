// @vitest-environment jsdom
/**
 * Playback: the timer, the pacing rule, and the keys.
 *
 * Everything here runs on fake timers, because the assertion is about *when*
 * the cursor moves and a real wait would measure the machine instead. The
 * cursor readout is the transport's `step N of M`, the same handle the
 * transport tests use, so a test never reads playback state out of the
 * component — only out of what a watcher can see.
 */
import { createElement as h, useState } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReplayViewer } from '../../src/routes/replay/ReplayViewer';
import { LANDMARK_BEATS, dwellMillis, speedById } from '../../src/routes/replay/steps';
import type { EventLog, ReplayGameLog, ReplayStep } from '../../src/routes/replay/read-log';
import { fixtureLog } from './support/log-fixture';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LOG: EventLog = fixtureLog();

function gameAt(index: number): ReplayGameLog {
  const game = LOG.games[index];
  if (game === undefined) throw new Error(`the fixture has no game ${index}`);
  return game;
}

function stepAt(seq: number): ReplayStep {
  const step = gameAt(0).steps[seq];
  if (step === undefined) throw new Error(`the fixture has no step ${seq}`);
  return step;
}

function Harness(props: { readonly initial: Readonly<Record<string, string>> }): ReactElement {
  const [params, setParams] = useState<Readonly<Record<string, string>>>(props.initial);
  return h(ReplayViewer, {
    state: { status: 'ready', log: LOG },
    route: { mode: 'replay', params },
    onSetParams: (next) => {
      setParams((current) => ({ ...current, ...next }));
    },
  });
}

interface Mounted {
  readonly container: Element;
}

function mount(initial: Readonly<Record<string, string>> = {}): Mounted {
  vi.useFakeTimers();
  const view = render(h(Harness, { initial }));
  return { container: view.container };
}

function expectAtStep(seq: number): void {
  expect(screen.getByText(`step ${seq + 1}`)).toBeTruthy();
}

function advance(millis: number): void {
  act(() => {
    vi.advanceTimersByTime(millis);
  });
}

/** How long the frame now on screen is held at the given speed. */
function dwellAt(seq: number, speedId: string): number {
  return dwellMillis(stepAt(seq), speedById(speedId));
}

function click(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

function press(target: Element, key: string): void {
  fireEvent.keyDown(target, { key, bubbles: true });
}

/**
 * What the one toggle currently reads, which is the whole of what a watcher
 * can see about playback state. The package has no `lib: dom`, so this is a
 * query rather than a property read off the element.
 */
function playLabel(): string {
  if (screen.queryByRole('button', { name: 'Pause' }) !== null) return 'Pause';
  if (screen.queryByRole('button', { name: 'Play' }) !== null) return 'Play';
  throw new Error('the transport draws no play control');
}

describe('dwellMillis', () => {
  it('rests twice as long on a frame that dealt damage or cast a spell', () => {
    const speed = speedById('1');
    const found = gameAt(0).steps.find((step) =>
      step.events.some((event) => event.type === 'damageDealt' || event.type === 'spellCast'),
    );
    if (found === undefined) throw new Error('the fixture records no landmark frame');
    expect(dwellMillis(found, speed)).toBe(speed.millis * LANDMARK_BEATS);
  });

  it('holds an ordinary frame for exactly the speed', () => {
    const speed = speedById('1');
    const ordinary = gameAt(0).steps.find(
      (step) =>
        step.events.length > 0 &&
        !step.events.some(
          (event) =>
            event.type === 'damageDealt' ||
            event.type === 'spellCast' ||
            event.type === 'attackersDeclared' ||
            event.type === 'blockersDeclared' ||
            event.type === 'permanentDestroyed' ||
            event.type === 'permanentSacrificed' ||
            event.type === 'tokenCreated' ||
            event.type === 'playerLost' ||
            event.type === 'gameEnded',
        ),
    );
    if (ordinary === undefined) throw new Error('the fixture records no ordinary frame');
    expect(dwellMillis(ordinary, speed)).toBe(speed.millis);
  });

  it('records no frame without events, which is why there is no third case', () => {
    expect(gameAt(0).steps.every((step) => step.events.length > 0)).toBe(true);
  });
});

describe('ReplayViewer playback', () => {
  it('advances the cursor frame by frame while playing', () => {
    mount({ seq: '10' });
    click('Play');
    advance(dwellAt(10, '1'));
    expectAtStep(11);
    advance(dwellAt(11, '1'));
    expectAtStep(12);
  });

  it('stops when paused and leaves the cursor where it was', () => {
    mount({ seq: '10' });
    click('Play');
    advance(dwellAt(10, '1'));
    expectAtStep(11);
    click('Pause');
    advance(60_000);
    expectAtStep(11);
  });

  it('runs the speed setting into the interval', () => {
    mount({ seq: '10' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Speed' }), { target: { value: '4' } });
    click('Play');
    const fast = dwellAt(10, '4');
    expect(fast).toBeLessThan(dwellAt(10, '1'));
    advance(fast - 1);
    expectAtStep(10);
    advance(1);
    expectAtStep(11);
  });

  it('stops on its own at the end of the log and reports itself paused', () => {
    const last = gameAt(0).steps.length - 1;
    mount({ seq: String(last - 1) });
    click('Play');
    expect(playLabel()).toBe('Pause');
    advance(dwellAt(last - 1, '1'));
    expectAtStep(last);
    // Back to Play: the game is over rather than paused midway.
    expect(playLabel()).toBe('Play');
    advance(60_000);
    expectAtStep(last);
  });

  it('refuses to start playing from the last frame', () => {
    const last = gameAt(0).steps.length - 1;
    mount({ seq: String(last) });
    press(screen.getByText(`step ${last + 1}`), ' ');
    expect(playLabel()).toBe('Play');
    advance(60_000);
    expectAtStep(last);
  });

  it('pauses when the watcher steps by hand', () => {
    mount({ seq: '10' });
    click('Play');
    click('Next');
    expectAtStep(11);
    expect(playLabel()).toBe('Play');
    advance(60_000);
    expectAtStep(11);
  });
});

describe('ReplayViewer keyboard', () => {
  it('toggles playback with the space bar', () => {
    const view = mount({ seq: '10' });
    press(view.container, ' ');
    expect(playLabel()).toBe('Pause');
    advance(dwellAt(10, '1'));
    expectAtStep(11);
    press(view.container, ' ');
    expect(playLabel()).toBe('Play');
    advance(60_000);
    expectAtStep(11);
  });

  it('steps both ways with the arrow keys', () => {
    const view = mount({ seq: '10' });
    press(view.container, 'ArrowRight');
    expectAtStep(11);
    press(view.container, 'ArrowRight');
    expectAtStep(12);
    press(view.container, 'ArrowLeft');
    expectAtStep(11);
  });

  it('pauses playback when an arrow key steps', () => {
    const view = mount({ seq: '10' });
    press(view.container, ' ');
    press(view.container, 'ArrowRight');
    expectAtStep(11);
    expect(playLabel()).toBe('Play');
    advance(60_000);
    expectAtStep(11);
  });

  it('leaves the keys to a control that answers them itself', () => {
    mount({ seq: '10' });
    const speed = screen.getByRole('combobox', { name: 'Speed' });
    press(speed, ' ');
    press(speed, 'ArrowRight');
    expect(playLabel()).toBe('Play');
    expectAtStep(10);
  });
});
