// @vitest-environment jsdom
/**
 * A beat that is the animation rather than a panel interrupting it.
 *
 * `mtg-gt4q`. the playtester, 2026-08-20, watching an opponent kill one of her
 * creatures: "really we should be seeing the card animation of them playing the
 * removal spell, and my card being destroyed and during that animation I have
 * the option to continue."
 *
 * The acceptance criterion is one sentence and this file is four readings of it.
 * A pause that reports something happening to a permanent plays as motion on the
 * board, with the continue offered during it; the panel is what a beat falls
 * back to, not what a beat is.
 *
 * # What can and cannot be asserted here
 *
 * jsdom performs no layout, so nothing in this file may claim a pixel: the
 * Continue is not asserted to be *over* anything, only to be inside the element
 * the sheet positions it against. Which element that is, and where on it, is
 * `src/styles/board/beat.ts`'s statement and `beat-motion.browser.test.ts`'s
 * question. What is structural — and is the whole of the bead — is which
 * presentation a beat got, whether the pause is answerable from it, and whether
 * the sentence survived for a reader who is getting none of the motion.
 *
 * # The three routings, and the one that nobody will see
 *
 * A `death` and a `departure` name permanents and play on the board. The three
 * combat beats name none and keep the panel. And under
 * `prefers-reduced-motion: reduce` every beat keeps the panel, because
 * `src/motion/plan.ts` produces no cues there — a Continue floating over a board
 * that never moved would be a pause with no report in it, which is the one
 * outcome a reduced-motion player must never get. That last case is asserted
 * against a stubbed media query rather than assumed, because it is the arm no
 * one playing the surface will ever look at.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { Beat, GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import { REDUCED_MOTION_QUERY } from '../../src/motion/reduced-motion';
import {
  ASK_ALERT_STATUS_LABEL,
  ASK_PANEL_LABEL,
  askAlertText,
  BEAT_MOTION_STATUS_LABEL,
  beatShowsMotion,
  CONTINUE_LABEL,
  PlayView,
} from '../../src/routes/play/PlayView';
import { beatSentence } from '../../src/routes/play/rail';
import type { SeatNames } from '../../src/routes/play/position';
import { clearPreferences } from '../support/preferences';

afterEach(() => {
  cleanup();
  clearPreferences();
});

const NAMES: SeatNames = ['You', 'Bot'];

/* ----------------------------------------------------------------------
 * Structural node reads. The workspace tsconfig has no `lib: dom`
 * (`src/app/mount.ts` records why), so every DOM fact this file needs is
 * declared here and nowhere else.
 * ---------------------------------------------------------------------- */

interface HostNode {
  readonly textContent?: string | null;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
  querySelector(selector: string): unknown;
}

function nodeOf(value: unknown): HostNode {
  return value as HostNode;
}

function textOf(value: unknown): string {
  return nodeOf(value).textContent ?? '';
}

/** The document, which is where `pass-key.ts` binds its shortcut. */
function documentBody(): Parameters<typeof fireEvent.keyDown>[0] {
  const host = globalThis as { readonly document?: { readonly body?: unknown } };
  const body = host.document?.body;
  if (typeof body !== 'object' || body === null) throw new Error('expected a jsdom document');
  return body as Parameters<typeof fireEvent.keyDown>[0];
}

/* ------------------------------------------------------------------ fixtures */

/**
 * A board with one permanent on each side, which is what a death beat needs: the
 * sentence names the permanent as its controller's, so a one-sided board would
 * leave half of it unexercised.
 */
function twoSides(): { readonly state: GameState; readonly mine: ObjectId } {
  const state = scenario({
    seed: 'test/play/beat-motion',
    battlefield: [
      { card: exampleCard('slc-emberflow-raider'), controller: 0 as PlayerId },
      { card: exampleCard('slc-emberflow-raider'), controller: 1 as PlayerId },
    ],
    hands: [[], []],
  }).state;
  const mine = state.battlefield[0];
  if (mine === undefined) throw new Error('twoSides: the board is empty');
  return { state, mine };
}

function sessionOn(state: GameState): GameSession {
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat(NAMES[0]), humanSeat(NAMES[1])],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * The media query answered the way a player who asked for less motion answers
 * it, for the duration of one call and no longer.
 *
 * Stubbed on the host rather than faked inside the hook, so the path under test
 * is the one the browser takes: `src/motion/reduced-motion.ts` asks
 * `matchMedia`, `useBoardMotion` reports what it said, and `PlayView` routes on
 * that. Restored in a `finally`, because a leaked stub would turn every later
 * file in the same worker into a reduced-motion run.
 */
function underReducedMotion(run: () => void): void {
  const host = globalThis as { matchMedia?: unknown };
  const had = Object.prototype.hasOwnProperty.call(host, 'matchMedia');
  const original = host.matchMedia;
  host.matchMedia = (query: string): unknown => ({
    matches: query === REDUCED_MOTION_QUERY,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  });
  try {
    run();
  } finally {
    if (had) host.matchMedia = original;
    else delete host.matchMedia;
  }
}

/** The table, paused on the beat under test. */
function renderPaused(beat: Beat, state: GameState, onContinue: () => void): void {
  render(
    h(PlayView, {
      session: sessionOn(state),
      viewer: 0,
      names: NAMES,
      onChoose: vi.fn(),
      beat,
      onContinue,
    }),
  );
}

/** The pause control, wherever on the surface it is drawn. */
function continueButton(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('button', { name: CONTINUE_LABEL });
}

function deathBeat(oid: ObjectId): Beat {
  return { kind: 'death', oids: [oid] };
}

/* --------------------------------------------------------------------- tests */

describe('which beats are drawn as motion', () => {
  /**
   * The routing is structural rather than a taste: a beat that names permanents
   * has zone changes in the same batch, and those are what `src/motion/plan.ts`
   * turns into cues. A combat beat names nothing, so there is no movement for a
   * continue to be offered during.
   *
   * Asserted as a table so a sixth beat kind arrives here as a failing row
   * rather than as a silent default — the switch itself is total, and this is
   * the other half of that guard.
   */
  it('is the beats that name permanents, and only those', () => {
    expect(beatShowsMotion({ kind: 'death', oids: [] })).toBe(true);
    expect(beatShowsMotion({ kind: 'departure', departures: [] })).toBe(true);
    expect(beatShowsMotion({ kind: 'attackers' })).toBe(false);
    expect(beatShowsMotion({ kind: 'blockers' })).toBe(false);
    expect(beatShowsMotion({ kind: 'damage' })).toBe(false);
  });
});

describe('a pause that reports something happening to a permanent', () => {
  it('offers the continue on the board, with no panel in front of it', () => {
    const { state, mine } = twoSides();
    renderPaused(deathBeat(mine), state, vi.fn());

    const button = continueButton();
    // On the seam between the two battlefields, which in this environment means
    // one fact: it is inside the element the sheet positions it against. Where
    // on that element, and what it is therefore not covering, is
    // `beat-motion.browser.test.ts`.
    expect(nodeOf(button).closest('.mtg-board__divider')).not.toBeNull();
    expect(nodeOf(button).closest('.mtg-board__lanes')).not.toBeNull();
    // And not in a panel, which is the half of the bead that is a removal. A
    // Continue inside `.mtg-panel` is the old presentation, wherever it is drawn.
    expect(nodeOf(button).closest('.mtg-panel')).toBeNull();
    expect(screen.queryByText('Destroyed'), 'the beat panel is still being drawn').toBeNull();
  });

  /**
   * The motion is pixels and a screen reader gets none of them, so the
   * accessible half of a beat may not be the half that was replaced. The
   * sentence is the panel's own — `beatSentence`, not a second wording of it —
   * in a named region, because `PhaseBar.ts` records what two unnamed regions on
   * one table do to each other.
   */
  it('keeps the sentence as text, in a live region of its own', () => {
    const { state, mine } = twoSides();
    const beat = deathBeat(mine);
    renderPaused(beat, state, vi.fn());

    const region = screen.getByRole('status', { name: BEAT_MOTION_STATUS_LABEL });
    expect(textOf(region)).toBe(beatSentence(beat, state, NAMES));
    expect(textOf(region)).toContain('destroyed');
  });

  it('reports the press once, from the button and from the pass key', () => {
    const { state, mine } = twoSides();
    const onContinue = vi.fn();
    renderPaused(deathBeat(mine), state, onContinue);

    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledTimes(1);
    // The same gesture at the same moment takes the same key it took when this
    // was a panel (`beats.test.ts`), because the binding is the beat's rather
    // than the panel's.
    fireEvent.keyDown(documentBody(), { key: ' ' });
    expect(onContinue).toHaveBeenCalledTimes(2);
  });

  /**
   * The ask column is the thing this beat no longer uses, so it has nothing to
   * announce. An alert saying the answer is behind a disclosure would point at
   * an empty column, and `ask-flyout.ts`'s one rule is that an alert is never
   * false.
   */
  it('says nothing on the shut column, because the answer is not in it', () => {
    const { state, mine } = twoSides();
    renderPaused(deathBeat(mine), state, vi.fn());
    fireEvent.click(screen.getByRole('button', { name: ASK_PANEL_LABEL }));

    expect(askAlertText({ kind: 'board' })).toBeNull();
    expect(screen.queryByRole('status', { name: ASK_ALERT_STATUS_LABEL })).toBeNull();
    // And the pause is still answerable at that width, which is the property the
    // alert exists to guarantee everywhere else.
    expect(nodeOf(continueButton()).closest('.mtg-board__lanes')).not.toBeNull();
  });
});

describe('a pause with nothing to animate', () => {
  /**
   * `attackers` is the game stopping at a step boundary so a still board can be
   * read. Nothing moved, so the panel is not a fallback here in any apologetic
   * sense — it is the only presentation that says anything at all.
   */
  it('falls back to the panel, unchanged', () => {
    renderPaused({ kind: 'attackers' }, twoSides().state, vi.fn());

    expect(screen.getByText('Attackers declared')).toBeTruthy();
    expect(nodeOf(continueButton()).closest('.mtg-panel')).not.toBeNull();
    expect(screen.queryByRole('status', { name: BEAT_MOTION_STATUS_LABEL })).toBeNull();
  });
});

describe('a player who asked for less motion', () => {
  /**
   * The same panel a combat beat gets, and that equality is the point: there is
   * no reduced-motion variant of the on-board presentation to be half-right. A
   * beat routed to the board here would draw one control over a board that never
   * moved, with the report of what happened nowhere on screen.
   */
  it('gets the panel for a beat that would otherwise have played on the board', () => {
    const { state, mine } = twoSides();
    underReducedMotion((): void => {
      const beat = deathBeat(mine);
      renderPaused(beat, state, vi.fn());

      expect(screen.getByText('Destroyed')).toBeTruthy();
      expect(nodeOf(continueButton()).closest('.mtg-panel')).not.toBeNull();
      expect(nodeOf(continueButton()).closest('.mtg-board__lanes')).toBeNull();
      // The sentence is in the panel's own region rather than this lane's, so
      // there is exactly one of it either way.
      expect(screen.queryByRole('status', { name: BEAT_MOTION_STATUS_LABEL })).toBeNull();
      expect(screen.getByText(beatSentence(beat, state, NAMES))).toBeTruthy();
    });
  });
});
