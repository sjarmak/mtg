// @vitest-environment jsdom
/**
 * The pace of the table is a setting, and it is a setting the game cannot see.
 *
 * `mtg-kwu`. `src/motion/timing.ts` argues every duration the motion layer
 * spends, and argues them for one player: the one those numbers were tuned
 * against. A player on their thousandth board wipe wants it over with and a
 * player learning what a trigger is wants to watch one land, and both are asking
 * for a multiplier rather than for a different set of constants. So
 * `src/motion/pace.ts` holds a scale, `timing.ts` keeps every number and every
 * reason, and the ratios between those numbers are not the setting's to change.
 *
 * # The four claims
 *
 *  1. **One place holds it.** The scale is one table, and the sheet's rules are
 *     generated from that table rather than written beside it, so a fifth pace
 *     cannot exist in the scale and be missing from the CSS — which is the
 *     failure that would move the control and leave the table where it was.
 *  2. **Both halves move together.** A duration lives in two places at once: in
 *     the plan the runner plays, and in an animation the sheet declares. A pace
 *     that scaled one would leave a 240ms arrival landing under a 400ms travel.
 *  3. **It is reachable from the play route**, which means a control on the
 *     surface a person actually plays on rather than a constant a developer
 *     edits.
 *  4. **It never reaches `GameState`.** The same rule `@mtg/kernel`'s `beats.ts`
 *     holds for the combat pauses: `stateFingerprint` over a game is identical
 *     whatever this is set to, and the choice list the game records is the same
 *     list. That is the acceptance criterion of the bead, and the last two tests
 *     here are the whole of it — one game, played four times at four paces, by
 *     pressing the buttons rather than by reading the code.
 *
 * jsdom runs no animation and performs no layout, so nothing below claims a card
 * took longer to cross the table. What it can say is what the plan asks for and
 * what the shipped sheet declares, which is the whole of what the setting
 * decides; the browser does the rest of it either way.
 */
import { createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Choice, GameEvent, GameSession, GameState } from '@mtg/kernel';
import {
  choose,
  DEFAULT_AUTO_PASS,
  humanSeat,
  pendingDecision,
  scenario,
  stateFingerprint,
} from '@mtg/kernel';
import { PACE_CONTROL_LABEL, PHASE_BAR_STATUS_LABEL } from '../../src/routes/play/PhaseBar';
import { PACE_STORE_KEY, readPace } from '../../src/routes/play/pace-preference';
import { PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { motionPlan } from '../../src/motion/plan';
import {
  DEFAULT_PACE,
  isPace,
  nextPace,
  PACE_ATTRIBUTE,
  PACE_VAR,
  PACE_WORDS,
  PACES,
  paced,
  paceScale,
} from '../../src/motion/pace';
import { BEAT_GAP_MS, MARK_FAST_MS, MARK_MS, MOTION_BUDGET_MS, MOVE_MS } from '../../src/motion/timing';
import { ARRIVAL_CSS } from '../../src/styles/board/arrival';
import { BAND_CSS } from '../../src/styles/board/band';
import { MOTION_CSS } from '../../src/styles/board/motion';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

/** One store serves the whole file, so each test starts on a browser new here. */
beforeEach(() => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
});

function stored(): string | null {
  const host = globalThis as {
    readonly localStorage?: { getItem?: (key: string) => string | null };
  };
  return host.localStorage?.getItem?.(PACE_STORE_KEY) ?? null;
}

function store(value: string): void {
  const host = globalThis as {
    readonly localStorage?: { setItem?: (key: string, value: string) => void };
  };
  host.localStorage?.setItem?.(PACE_STORE_KEY, value);
}

/** The rendered text, reached structurally: this workspace's tsconfig has no `lib: dom`. */
function text(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/** The drawn setting alone; the compact icon and accessible hint are siblings. */
function paceWord(node: unknown): string {
  const word = (node as { querySelector(selector: string): unknown }).querySelector(
    '.mtg-phasebar__pace-text',
  );
  return text(word);
}

describe('the scale', () => {
  it('is one table, and the sheet is generated from it', () => {
    const sheet = uiStyleSheet();
    for (const pace of PACES) {
      // Exactly the text `styles/board/motion.ts` emits. A pace with no rule
      // would fall through to the `var(--mtg-pace, 1)` fallback and play at
      // `normal` while the control said otherwise, which is the most expensive
      // way for this to be wrong: the setting moves and the table does not.
      expect(sheet).toContain(`[${PACE_ATTRIBUTE}='${pace}'] { ${PACE_VAR}: ${String(paceScale(pace))}; }`);
    }
  });

  it('keeps the ratios `timing.ts` argues, at every setting', () => {
    for (const pace of PACES.filter((name) => name !== 'still')) {
      // A tap is noticed, a mark is read, a move is followed: three jobs of
      // three lengths, and a multiplier is not allowed to reorder them.
      expect(paced(MARK_FAST_MS, pace)).toBeLessThan(paced(MARK_MS, pace));
      expect(paced(MARK_MS, pace)).toBeLessThan(paced(MOVE_MS, pace));
      expect(paced(MOTION_BUDGET_MS, pace)).toBeGreaterThan(paced(MOVE_MS, pace));
    }
  });

  it('keeps the fastest setting above the floor two events read as one below', () => {
    // `timing.ts` states two floors, and the fastest setting has to clear both.
    // Under roughly 60ms two starts land inside three frames of each other and
    // the eye reads one event, which is the complaint the whole motion lane
    // exists to answer; under roughly 150ms a movement reads as a jump rather
    // than as travel. This is why `quick` is 0.7 and not the obvious 0.5, and
    // the first draft of it was 0.6, which failed this line at 54ms.
    expect(paced(BEAT_GAP_MS, 'quick')).toBeGreaterThanOrEqual(60);
    expect(paced(MOVE_MS, 'quick')).toBeGreaterThanOrEqual(150);
  });

  it('treats the slowest setting as slower and the default as untouched', () => {
    expect(paced(MOVE_MS, 'normal')).toBe(MOVE_MS);
    expect(paced(MOVE_MS, 'slow')).toBeGreaterThan(MOVE_MS);
    expect(paced(MOVE_MS, 'quick')).toBeLessThan(MOVE_MS);
    expect(DEFAULT_PACE).toBe('normal');
  });

  it('cycles through every setting and back', () => {
    const seen = new Set<string>();
    let at = DEFAULT_PACE;
    for (let step = 0; step < PACES.length; step += 1) {
      seen.add(at);
      at = nextPace(at);
    }
    expect([...seen].sort()).toEqual([...PACES].sort());
    expect(at).toBe(DEFAULT_PACE);
  });

  it('reads back only the four words it writes', () => {
    expect(PACES.every((pace) => isPace(pace))).toBe(true);
    expect(isPace('fast')).toBe(false);
    expect(isPace('')).toBe(false);
    expect(isPace(1)).toBe(false);
  });
});

describe('both halves of a duration', () => {
  /**
   * Every duration the board's three motion sheets declare goes through
   * `paceCss`, checked by the shape of the text rather than site by site.
   *
   * A site-by-site list would be a list to forget to add to. What is actually
   * required is that no bare millisecond survives in these sheets, and a bare
   * millisecond is exactly a `123ms` that is not inside a `calc(`.
   */
  it('leaves no duration in the sheets that the setting cannot reach', () => {
    for (const [name, sheet] of [
      ['arrival', ARRIVAL_CSS],
      ['band', BAND_CSS],
      ['motion', MOTION_CSS],
    ] as const) {
      const bare = [...sheet.matchAll(/(.{6})(\d+)ms/g)].filter((match) => !match[1]?.endsWith('calc('));
      expect(
        bare.map((match) => match[0]),
        `${name} declares a duration the pace cannot scale`,
      ).toEqual([]);
    }
  });

  it('scales the plan the runner plays, cue for cue', () => {
    const events = moveEvents();
    const normal = motionPlan(events, { viewer: 0 });
    const slow = motionPlan(events, { viewer: 0, pace: 'slow' });
    expect(normal.cues.length).toBeGreaterThan(1);

    // The same cues in the same order for the same events: a pace changes how
    // long the rendering takes and never what is rendered.
    expect(slow.cues.map((cue) => cue.key)).toEqual(normal.cues.map((cue) => cue.key));
    for (const [index, cue] of slow.cues.entries()) {
      const at = normal.cues[index];
      if (at === undefined) throw new Error('the two plans disagree about length');
      expect(cue.durationMs).toBe(paced(at.durationMs, 'slow'));
      expect(cue.atMs).toBeGreaterThanOrEqual(at.atMs);
    }
    expect(slow.totalMs).toBeGreaterThan(normal.totalMs);
  });

  it('answers the stillest setting with no plan at all, rather than a fast one', () => {
    // The same answer `motion/reduced-motion.ts` gives the operating system,
    // and for the same reason: a 1ms travel is a card teleporting with extra
    // steps. `reduced` is true because that is what the flag means to every
    // reader of it — `beat-motion.ts` asks it before offering an acknowledgment
    // during a movement, and at this setting there is no movement to be during.
    const still = motionPlan(moveEvents(), { viewer: 0, pace: 'still' });
    expect(still.cues).toEqual([]);
    expect(still.totalMs).toBe(0);
    expect(still.reduced).toBe(true);
    expect(paceScale('still')).toBe(0);
  });

  it('plans the default for a caller that never heard of the setting', () => {
    const events = moveEvents();
    expect(motionPlan(events, { viewer: 0 })).toEqual(motionPlan(events, { viewer: 0, pace: DEFAULT_PACE }));
  });
});

describe('the control on the play route', () => {
  it('draws the current setting and cycles it', () => {
    renderAt(openState());
    const control = (): HTMLElement => screen.getByRole('button', { name: PACE_CONTROL_LABEL });
    expect(paceWord(control())).toBe(PACE_WORDS[DEFAULT_PACE]);

    let expected = DEFAULT_PACE;
    for (let press = 0; press < PACES.length; press += 1) {
      expected = nextPace(expected);
      fireEvent.click(control());
      expect(paceWord(control())).toBe(PACE_WORDS[expected]);
    }
    // All the way round, so no setting is a trap a player cannot leave.
    expect(expected).toBe(DEFAULT_PACE);
  });

  it("says what the press did, in the bar's own live region", () => {
    renderAt(openState());
    fireEvent.click(screen.getByRole('button', { name: PACE_CONTROL_LABEL }));

    const region = screen.getByRole('status', { name: PHASE_BAR_STATUS_LABEL });
    expect(text(region)).toContain('slow');
  });

  it('keeps the answer across a remount, under the key it stores it by', () => {
    renderAt(openState());
    fireEvent.click(screen.getByRole('button', { name: PACE_CONTROL_LABEL }));
    expect(stored()).toBe('slow');
    cleanup();

    renderAt(openState());
    expect(paceWord(screen.getByRole('button', { name: PACE_CONTROL_LABEL }))).toBe(PACE_WORDS.slow);
  });

  it('treats a store holding something else as a first visit', () => {
    store('brisk');
    expect(readPace()).toBe(DEFAULT_PACE);
    renderAt(openState());
    expect(paceWord(screen.getByRole('button', { name: PACE_CONTROL_LABEL }))).toBe(PACE_WORDS[DEFAULT_PACE]);
  });

  it('writes the setting where the sheets can read it', () => {
    const { container } = renderAt(openState());
    const root = container as unknown as {
      querySelectorAll: (selector: string) => ArrayLike<{ getAttribute: (name: string) => string | null }>;
    };
    const carrying = Array.from(root.querySelectorAll(`[${PACE_ATTRIBUTE}]`));
    // One element, because the rules match the attribute alone and inherit down:
    // a second one would be a second answer competing on specificity.
    expect(carrying).toHaveLength(1);
    expect(carrying[0]?.getAttribute(PACE_ATTRIBUTE)).toBe(DEFAULT_PACE);

    fireEvent.click(screen.getByRole('button', { name: PACE_CONTROL_LABEL }));
    expect(carrying[0]?.getAttribute(PACE_ATTRIBUTE)).toBe('slow');
  });
});

describe('what the game records', () => {
  /**
   * The acceptance criterion, played rather than reasoned about: the same game,
   * four times, at four paces, driven by pressing the same button.
   *
   * The fingerprint is the kernel's own answer to "are these two states the
   * same", and the choice list is the other half of a reproduction — seed plus
   * choices is the whole record of a kernel game
   * (`packages/engine/src/determinism.ts`). If a pace could reach either, a
   * replay would depend on how fast the person who recorded it liked their
   * animations.
   */
  it('is the same game whatever the pace is set to', () => {
    const runs = PACES.map((pace) => {
      store(pace);
      const played = playOut();
      cleanup();
      return { pace, ...played };
    });
    const first = runs[0];
    if (first === undefined) throw new Error('no paces to play at');
    expect(first.decisions).toBeGreaterThan(0);
    for (const run of runs.slice(1)) {
      expect(run.fingerprint, `${run.pace} played a different game`).toBe(first.fingerprint);
      expect(run.choices).toEqual(first.choices);
      expect(run.decisions).toBe(first.decisions);
    }
  });

  it('is the same game when the pace is changed in the middle of it', () => {
    store(DEFAULT_PACE);
    const untouched = playOut();
    cleanup();

    store(DEFAULT_PACE);
    const cycled = playOut(() => {
      fireEvent.click(screen.getByRole('button', { name: PACE_CONTROL_LABEL }));
    });
    expect(cycled.fingerprint).toBe(untouched.fingerprint);
    expect(cycled.choices).toEqual(untouched.choices);
  });
});

/* ------------------------------------------------------------------ fixtures */

const NAMES: SeatNames = ['You', 'Bot'];

const MOUNTAIN = basicLand('Mountain', 'XMP', 250);

const BOLT: Card = parseCard({
  kind: 'instant',
  id: 'xmp-shock-arrow',
  name: 'Shock Arrow',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 100 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
});

function openState(): GameState {
  return scenario({
    battlefield: Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[BOLT, BOLT], []],
  }).state;
}

function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * Three movements of three objects: the shortest batch with two full gaps in it,
 * which is what makes a scaled timeline distinguishable from an unscaled one.
 *
 * Written out rather than played, for `motion-plan.test.ts`'s reason: the plan
 * is a pure function of events, and a fixture that has to reach a real board
 * position first would be testing the board.
 */
function moveEvents(): readonly GameEvent[] {
  return [
    { type: 'zoneChanged', oid: 'c1', from: 'library', to: 'hand', owner: 0 },
    { type: 'zoneChanged', oid: 'c2', from: 'hand', to: 'battlefield', owner: 0 },
    { type: 'zoneChanged', oid: 'c3', from: 'battlefield', to: 'graveyard', owner: 1 },
  ];
}

interface Played {
  readonly fingerprint: string;
  readonly choices: readonly Choice[];
  readonly decisions: number;
}

function renderAt(state: GameState): { readonly container: unknown } {
  return render(
    h(PlayView, {
      session: sessionAt(state),
      viewer: 0,
      names: NAMES,
      onChoose: () => undefined,
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
    }),
  );
}

/**
 * A short game, played with the view mounted and rendering at whatever pace the
 * store holds.
 *
 * Six decisions rather than a whole game: the claim is that a rendering choice
 * cannot reach the state, and six of them through the real component is as much
 * evidence of that as six hundred at a fraction of the wall clock. The choice is
 * the first legal one every time, so the run is a function of the fixture alone
 * and two runs can be compared at all. `between` runs while each position is on
 * screen, which is where the mid-game pace change goes.
 */
function playOut(between: () => void = () => undefined): Played {
  let session = sessionAt(openState());
  for (let step = 0; step < 6; step += 1) {
    cleanup();
    render(
      h(PlayView, {
        session,
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
      }),
    );
    between();
    if (session.pending === null) break;
    session = choose(session, 0);
  }
  return {
    fingerprint: stateFingerprint(session.state),
    choices: session.choices,
    decisions: session.decisions,
  };
}
