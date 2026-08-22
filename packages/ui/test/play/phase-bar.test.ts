// @vitest-environment jsdom
/**
 * The step bar: the whole turn structure under the viewer's own battlefield,
 * with a stop row per player on every node the kernel can stop at.
 *
 * The playtester, 2026-08-13 (`mtg-bz2.1`): "The phase bar is particularly important.
 * I would make it something like: UNTAP → UPKEEP → DRAW → MAIN 1 → BEGIN COMBAT
 * → ATTACK → BLOCK → DAMAGE → END COMBAT → MAIN 2 → END → CLEANUP. Each relevant
 * node should have three conceptual states … Clicking the phase toggles whether
 * the client pauses there."
 *
 * Five things are checked here and each one is a different kind of claim.
 *
 * **The derivation.** The bar is `STEPS` and its controls are `STOPPABLE_STEPS`,
 * both read from the kernel at render time. The assertions compare the rendered
 * bar to those two exports rather than to a list of thirteen strings, so a step
 * added to the turn structure appears on the bar without anybody editing this
 * file, and a bar that stopped deriving fails here.
 *
 * **The model.** A node's four states are the two halves of `StopSet`, and the
 * pure functions in `src/routes/play/stops.ts` are what read and write them
 * through the kernel's own `toggleStop`. Those are tested as functions, and the
 * widget is tested for emitting what they produce — including the last link,
 * that a stop set the bar emits is one the kernel's own `isStopped` reads as a
 * stop. That last assertion is `mtg-bz2.1`'s acceptance criterion.
 *
 * **The three kinds of mark** (`mtg-rgc.2`). Whose stop a mark is comes from
 * which of a node's two rows it is in, not from its shape, and the combat beat
 * is a third mark in a third place because it is a third mechanism: it asks
 * nothing, records nothing, and is not settable by pressing the node it appears
 * on. The assertions are that each row reads the kernel's own `hasStop` for its
 * side, that a step no stop can be set at draws no row rather than an empty one,
 * and that the pause is never either row's shape and never moves when a node is
 * pressed.
 *
 * **The bar's own control** (`mtg-885`). A two-state toggle that writes
 * `BeatSet`, changes the pause on every combat node, touches no stop, and moves
 * the game's odometer by nothing — the last one being the invariant the whole
 * mechanism rests on, since a recorded game must not be able to tell how fast
 * somebody wanted to watch it.
 *
 * **The placement** (`mtg-rgc.6`). Magic Online draws the turn structure between
 * the lower battlefield and the hand, not on a strip above the table, and all
 * three game captures in `references/` are that arrangement. The assertion is
 * structural — the seat the bar is in and the two zones it sits between — because
 * that is the part jsdom can answer; what the move cost the cards is measured in
 * `../../tools/hand-scale.ts` and reported in `styles/views.ts`.
 *
 * **The accessibility.** A four-state node is not a toggle button, so it carries
 * no `aria-pressed` — and the state is legible as a word in the node's name
 * rather than only as a shape, with a polite live region for the press itself.
 * Every mark on the bar is `aria-hidden` and every one of them is named in the
 * panel's legend.
 *
 * What this file cannot say is whether thirteen nodes *fit*. jsdom performs no
 * layout: it has no viewport and computes no box, so the fit assertions here are
 * the cascade declarations the fit is made of, in the convention `./fit.test.ts`
 * and `./land-tile.test.ts` follow. The measurement is
 * `../../tools/step-bar.ts`, which drives the real page in chrome-headless-shell
 * at three viewports; its numbers are in that file, in `styles/views.ts` and in
 * the commit message.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type {
  AutoPassSettings,
  BeatSet,
  GameSession,
  GameState,
  PlayerId,
  Step,
  TurnSide,
} from '@mtg/kernel';
import {
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_BEATS,
  hasStop,
  humanSeat,
  isStopped,
  NO_BEATS,
  scenario,
  STEPS,
  stepShowsBeat,
  STOPPABLE_STEPS,
} from '@mtg/kernel';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import {
  beatAnnouncement,
  nodeName,
  PHASE_BAR_LABEL,
  WATCH_BEATS_LABEL,
} from '../../src/routes/play/PhaseBar';
import { PlayView } from '../../src/routes/play/PlayView';
import { stepAbbreviation, stepLabel } from '../../src/routes/play/prompt';
import {
  BEAT_MARK,
  cycleStop,
  MARK_LEGEND,
  nextStopState,
  STOP_CYCLE,
  STOP_ROW_MARKS,
  STOP_ROWS,
  STOP_STATE_SIDES,
  STOP_STATE_WORDS,
  stopStateOf,
  withStopState,
} from '../../src/routes/play/stops';
import type { StopState } from '../../src/routes/play/stops';
import { TABLE } from '../../src/styles/board/geometry';
import { uiStyleSheet } from '../../src/styles/index';
import { PHONE_MAX_REM } from '../../src/styles/mobile';

afterEach(cleanup);

const NAMES = ['You', 'Bot'] as const;

/**
 * The two DOM reads this file needs, cast structurally.
 *
 * The workspace tsconfig has no `lib: dom` (see `mount.ts`), so neither
 * `getAttribute` nor `querySelectorAll` is typed on what testing-library hands
 * back; `./autopass.test.ts` and `./click.test.ts` reach the first one the same
 * way.
 */
function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function queryAll(node: unknown, selector: string): readonly unknown[] {
  return [...(node as { querySelectorAll(selector: string): Iterable<unknown> }).querySelectorAll(selector)];
}

function closest(node: unknown, selector: string): unknown {
  return (node as { closest(selector: string): unknown }).closest(selector);
}

/** The element either side of one, which is how `mtg-rgc.6`'s placement is read. */
function sibling(node: unknown, side: 'previousElementSibling' | 'nextElementSibling'): unknown {
  const found = (node as Record<string, unknown>)[side];
  if (found === null || found === undefined) throw new Error(`nothing sits ${side} of the bar`);
  return found;
}

function dealt(): ReturnType<typeof dealMirrorGame> {
  return dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
}

/** The bar, found the way a screen reader finds it. */
function bar(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: PHASE_BAR_LABEL });
}

/** Every node in the order it is drawn, whether or not it is a control. */
function nodes(): readonly unknown[] {
  return queryAll(bar(), '.mtg-phasebar__node');
}

/** One node, by the step it stands for. */
function nodeFor(step: Step): unknown {
  const found = nodes().find((node) => attr(node, 'data-step') === step);
  if (found === undefined) throw new Error(`the bar has no node for ${step}`);
  return found;
}

function stateOfNode(step: Step): string | null {
  return attr(nodeFor(step), 'data-stop');
}

/** A node pressed, found by the accessible name it currently carries. */
function press(step: Step): void {
  fireEvent.click(nodeFor(step) as Parameters<typeof fireEvent.click>[0]);
}

/** The two stop rows of one node, in the order they are drawn, top to bottom. */
function rowsOf(step: Step): readonly unknown[] {
  return queryAll(nodeFor(step), '.mtg-phasebar__pip');
}

/** One row of one node, by the side of the table it stands for. */
function rowOf(step: Step, side: TurnSide): unknown {
  const found = rowsOf(step).find((row) => attr(row, 'data-row') === side);
  if (found === undefined) throw new Error(`the ${step} node has no ${side} row`);
  return found;
}

/** The pause mark on one node, or null when the game does not pause there. */
function beatMarkOf(step: Step): unknown {
  return queryAll(nodeFor(step), '.mtg-phasebar__beat')[0] ?? null;
}

/** The bar's own control (`mtg-885`), or null for a caller that does not own it. */
function beatsToggle(): ReturnType<typeof screen.queryByRole> {
  return screen.queryByRole('button', { name: WATCH_BEATS_LABEL });
}

/** The game's odometer, which is what says a press recorded nothing. */
function odometer(): string {
  return textOf(screen.getByText(/choices made/));
}

/**
 * A finished game, which is the one position that draws no bar but still has a
 * turn to name (`mtg-a1d6`, `mtg-rgc.13`). Built as a session rather than played
 * to a result, the way `./rail-split.test.ts` builds its ended one.
 */
function endedSession(): GameSession {
  const built = scenario({
    seed: 'test/phase-bar/over',
    battlefield: [],
    hands: [[], []],
    active: 0,
    turn: 3,
  });
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state: built.state,
    events: built.events,
    result: { winner: 0 as PlayerId, loser: 1 as PlayerId, reason: 'lifeZero', endedOnTurn: 3 },
    beat: null,
    pending: null,
    choices: [],
    decisions: 12,
    committed: null,
  };
}

/** A view a caller owns the settings of, which is the only way the bar is drawn. */
function settableView(extra: Record<string, unknown> = {}): ReturnType<typeof h> {
  const game = dealt();
  return h(PlayView, {
    session: createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS }),
    viewer: 0,
    names: NAMES,
    onChoose: vi.fn(),
    autoPass: DEFAULT_AUTO_PASS,
    onAutoPass: vi.fn(),
    onYield: vi.fn(),
    ...extra,
  });
}

describe('the bar is the kernel turn structure', () => {
  it('draws one node per step, in the order the kernel states them', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expect(nodes().map((node) => attr(node, 'data-step'))).toEqual([...STEPS]);
  });

  /**
   * The playtester's sketch has twelve nodes and the kernel has thirteen steps. The
   * extra one is first-strike damage, which is real and conditionally entered
   * (`combat.ts`'s `combatNeedsFirstStrikeStep`), and it is drawn — a step the
   * kernel can stop at that the only stops surface omitted would be a stop a
   * player cannot set. Hand-writing her twelve would also have been a third list
   * free to drift from `STEPS` and from `STOPPABLE_STEPS` alike.
   */
  it('draws the conditional combat step too, and says in words that it is conditional', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const node = nodeFor('firstStrikeDamage');
    expect(attr(node, 'data-stoppable')).toBe('true');
    expect(attr(node, 'data-conditional')).toBe('true');
    expect(attr(node, 'aria-label')).toContain('first or double strike');
    // Every other node is entered every turn, and none of them claims otherwise.
    for (const step of STEPS.filter((candidate) => candidate !== 'firstStrikeDamage')) {
      expect(attr(nodeFor(step), 'data-conditional')).toBe('false');
    }
  });

  /**
   * Untap and cleanup are the two steps `enterStep` never grants priority in, so
   * a stop on either would be a control that does nothing whichever way it is
   * set — `autopass.ts` calls offering it worse than omitting it. They are still
   * drawn, because the game really does pass through them and a bar that could
   * not say where the game is would be lying about the position.
   */
  it('makes a control of every step priority can be held in, and only those', () => {
    render(h(PlayRoute, { config: dealt().config }));
    // By selector rather than by role: since `mtg-885` the bar also holds a
    // button that is not a step, and this claim is about the steps.
    const controls = queryAll(bar(), 'button.mtg-phasebar__node');
    expect(controls.length).toBe(STOPPABLE_STEPS.length);
    expect(controls.map((control) => attr(control, 'data-step'))).toEqual([...STOPPABLE_STEPS]);
    for (const step of ['untap', 'cleanup'] as const) {
      expect(attr(nodeFor(step), 'data-stoppable')).toBe('false');
      expect(
        within(bar()).queryByRole('button', { name: new RegExp(`^${stepAbbreviation(step)},`) }),
      ).toBeNull();
    }
  });

  it('marks the step the game is in, and marks exactly one', () => {
    const game = dealt();
    const session = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
    render(
      h(PlayView, {
        session,
        viewer: 0,
        names: NAMES,
        onChoose: vi.fn(),
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: vi.fn(),
        onYield: vi.fn(),
      }),
    );
    const current = nodes().filter((node) => attr(node, 'aria-current') === 'step');
    expect(current.length).toBe(1);
    expect(attr(current[0], 'data-step')).toBe(session.state.turn.step);
  });

  /**
   * `mtg-rgc.6`: Magic Online draws the turn structure under the lower
   * battlefield and over the hand, and all three game captures in `references/`
   * are that arrangement. The claim is structural rather than pixel-wise — jsdom
   * lays nothing out — so it is asserted as the two siblings the bar sits
   * between and the band it sits in. A test that only said "not in the strip"
   * would pass with the bar anywhere on the page.
   */
  it('is in the near band, between that battlefield and that hand', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const band = closest(bar(), '.mtg-board__side');
    expect(band, 'the bar is outside both seats').not.toBeNull();
    expect(attr(band, 'data-seat'), 'the bar is on the wrong seat').toBe('you');
    const above = sibling(bar(), 'previousElementSibling');
    const below = sibling(bar(), 'nextElementSibling');
    // The zone rather than the spell row inside it, because the row is only
    // drawn when the seat holds something: a battlefield with nothing on it says
    // `no permanents` in the zone's own words now that it draws no placeholders
    // (`../../src/board/Battlefield.ts`), and on turn one that is every game.
    // The claim being made is "the bar is under the battlefield", and the zone
    // is what that names.
    expect(attr(above, 'aria-label'), 'the bar is not under a battlefield').toBe('your battlefield');
    expect(attr(below, 'data-tone'), 'the bar is not over the hand').toBe('rail');
    expect(closest(bar(), '.mtg-toolbar'), 'the bar is back on the strip').toBeNull();
    expect(closest(bar(), '.mtg-board__rail'), 'the bar is in the rail').toBeNull();
  });

  /**
   * A caller that owns no settings gets no bar rather than a row of nodes that
   * answer to nobody — the same rule `toolbar.ts` already applied to the
   * disclosure. `../board.test.ts`-style read-only renders of `PlayView` are
   * exactly that caller.
   */
  it('is absent for a caller that owns no settings', () => {
    const game = dealt();
    render(
      h(PlayView, {
        session: createSession(game.config.setup, game.config.seats),
        viewer: 0,
        names: NAMES,
        onChoose: vi.fn(),
      }),
    );
    expect(screen.queryByRole('group', { name: PHASE_BAR_LABEL })).toBeNull();
  });
});

/**
 * `mtg-rgc.13`: the turn text at the left-hand end of the bar, and nowhere else.
 *
 * Magic Online writes `Turn 18: BswizzM…` at the left-hand end of the step bar
 * and says nothing about the turn anywhere else; all three captures in
 * `references/` are that one row. `mtg-rgc.6` moved the bar under the near
 * battlefield and `0e33a265` moved the badge into the ask column, which left one
 * fact in two columns. These assertions are the two halves of putting it back
 * together: the head is on the bar, and the fallback fires only when there is no
 * bar to put it on.
 */
describe('the turn rides at the left-hand end of the bar', () => {
  it('is the first thing on the bar, ahead of the thirteen steps', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const head = (bar() as Record<string, unknown>)['firstElementChild'];
    expect(head, 'the bar draws nothing before its steps').not.toBeNull();
    expect(attr(head, 'class')).toContain('mtg-turnstops');
    expect(textOf(head)).toMatch(/^Turn \d/);
    // And the steps follow it rather than wrap it, so the bar is one row of two
    // items and not a badge with a bar inside it.
    expect(attr(sibling(head, 'nextElementSibling'), 'class')).toContain('mtg-phasebar__steps');
  });

  it('leaves game details holding the odometer and nothing about the turn', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const meta = screen.getByText(/choices made/);
    const details = closest(meta, '.mtg-play-meta');
    expect(details, 'the odometer left game details').not.toBeNull();
    expect(queryAll(details, '.mtg-badge').length, 'the turn is drawn twice').toBe(0);
  });

  /**
   * A finished game draws no bar (`mtg-a1d6`), so the turn has to land
   * somewhere: it goes back to game details as a plain badge carrying the whole
   * sentence. Dropping it there instead would leave a finished game saying less
   * about where it ended than it said while it ran.
   */
  it('goes back to game details as a badge when the game is over', () => {
    render(
      h(PlayView, {
        session: endedSession(),
        viewer: 0,
        names: NAMES,
        onChoose: vi.fn(),
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: vi.fn(),
        onYield: vi.fn(),
      }),
    );
    expect(screen.queryByRole('group', { name: PHASE_BAR_LABEL })).toBeNull();
    const badge = queryAll(closest(screen.getByText(/choices made/), '.mtg-play-meta'), '.mtg-badge');
    expect(badge.length, 'a finished game says nothing about where it ended').toBe(1);
    expect(textOf(badge[0])).toMatch(/^Turn \d/);
  });

  /**
   * Half the panel is the two yields, so a caller with settings but no yield
   * gets the turn as a plain badge on the bar rather than a disclosure with one
   * dead half. `@mtg/netplay` is that caller.
   */
  it('is a plain badge, not a disclosure, for a caller that owns no yield', () => {
    render(settableView({ onYield: undefined }));
    const head = (bar() as Record<string, unknown>)['firstElementChild'];
    expect(attr(head, 'class')).toBe('mtg-badge');
    expect(textOf(head)).toMatch(/^Turn \d/);
    expect(screen.queryByRole('button', { name: /^Turn \d/ })).toBeNull();
  });
});

describe('the four-state cycle', () => {
  it('reads the default stop set off the kernel, one node at a time', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const step of STOPPABLE_STEPS) {
      expect(stateOfNode(step), `${step} does not read its default`).toBe(
        stopStateOf(DEFAULT_AUTO_PASS, step),
      );
    }
    // The two the defaults name on each side, spelled out, so the loop above
    // cannot pass by comparing nothing to nothing.
    expect(stateOfNode('precombatMain')).toBe('yourTurn');
    expect(stateOfNode('declareBlockers')).toBe('theirTurn');
    expect(stateOfNode('upkeep')).toBe('none');
  });

  /**
   * The order and the whole of it: none → own turn → opponent's turn → both →
   * none. The fourth state is the one the playtester's three marks do not cover and
   * the model does, and a UI that cannot reach a representable state is a bug.
   * The fourth press is also what makes every press recoverable without a
   * modifier key.
   */
  it('walks all four states and comes back to where it started', () => {
    render(h(PlayRoute, { config: dealt().config }));
    expect(stateOfNode('upkeep')).toBe('none');
    for (const expected of ['yourTurn', 'theirTurn', 'both', 'none'] as const) {
      press('upkeep');
      expect(stateOfNode('upkeep')).toBe(expected);
    }
  });

  it('touches one step and no other', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const before = STEPS.map((step) => stateOfNode(step));
    press('upkeep');
    const after = STEPS.map((step) => stateOfNode(step));
    const moved = STEPS.filter((_step, index) => before[index] !== after[index]);
    expect(moved).toEqual(['upkeep']);
  });

  it('stays where it was put across a re-render of the rest of the strip', () => {
    render(h(PlayRoute, { config: dealt().config }));
    // The end step defaults to a stop on the opponent's turn, so one press is
    // the state that names both sides.
    press('end');
    expect(stateOfNode('end')).toBe('both');
    const keep = screen.queryByRole('button', { name: 'Keep this hand' });
    if (keep !== null) fireEvent.click(keep);
    expect(stateOfNode('end')).toBe('both');
  });
});

/*
 * The pure half, which is where the model lives.
 *
 * Every one of these goes through the kernel's `hasStop` and `toggleStop`, so
 * none of them is a second implementation of a stop set; what they add is the
 * mapping from a pair of booleans onto one control's four positions.
 */
describe('the stop cycle as a function', () => {
  const settings = DEFAULT_AUTO_PASS;

  it('reads each of the four states off a stop set', () => {
    expect(stopStateOf(settings, 'upkeep')).toBe('none');
    expect(stopStateOf(settings, 'precombatMain')).toBe('yourTurn');
    expect(stopStateOf(settings, 'end')).toBe('theirTurn');
    expect(stopStateOf(withStopState(settings, 'end', 'both'), 'end')).toBe('both');
  });

  it('cycles in the stated order and wraps', () => {
    expect(STOP_CYCLE).toEqual(['none', 'yourTurn', 'theirTurn', 'both']);
    expect(STOP_CYCLE.map(nextStopState)).toEqual(['yourTurn', 'theirTurn', 'both', 'none']);
  });

  it('writes exactly the two sides a state names', () => {
    for (const state of STOP_CYCLE) {
      const next = withStopState(settings, 'upkeep', state);
      expect(hasStop(next.stops, 'yourTurn', 'upkeep')).toBe(state === 'yourTurn' || state === 'both');
      expect(hasStop(next.stops, 'theirTurn', 'upkeep')).toBe(state === 'theirTurn' || state === 'both');
    }
  });

  it('leaves the settings it was given untouched, and the rest of the set with them', () => {
    const next = cycleStop(settings, 'upkeep');
    expect(stopStateOf(settings, 'upkeep')).toBe('none');
    expect(next.enabled).toBe(settings.enabled);
    expect(next.passUnstopped).toBe(settings.passUnstopped);
    for (const step of STOPPABLE_STEPS.filter((candidate) => candidate !== 'upkeep')) {
      expect(stopStateOf(next, step)).toBe(stopStateOf(settings, step));
    }
  });
});

/**
 * The bead's acceptance criterion, end to end: "a set stop actually causes the
 * client to take priority at that step rather than auto-passing".
 *
 * The bar emits settings; the kernel decides. So the assertion is that the
 * settings a press produces are settings `isStopped` reads as a stop at that
 * step on that side of the table — the same function `settledChoice` and
 * `unstoppedPassChoice` both gate on before they pass a priority for anyone.
 */
describe('a set stop is a stop the kernel reads', () => {
  it('turns two presses on a node into a stop at that step on the opponent turn', () => {
    const game = dealt();
    const session = createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
    const onAutoPass = vi.fn();
    render(
      h(PlayView, {
        session,
        viewer: 0,
        names: NAMES,
        onChoose: vi.fn(),
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass,
        onYield: vi.fn(),
      }),
    );

    // The opponent's upkeep, which the default set passes through: the seat
    // being asked is 0 and the turn belongs to 1.
    const theirUpkeep: GameState = {
      ...session.state,
      turn: { ...session.state.turn, step: 'upkeep', active: 1 },
    };
    expect(isStopped(theirUpkeep, 0, DEFAULT_AUTO_PASS.stops)).toBe(false);

    press('upkeep');
    const first = onAutoPass.mock.calls[0]?.[0] as AutoPassSettings | undefined;
    if (first === undefined) throw new Error('a press emitted no settings');
    // One press is a stop on the player's own turn, so the opponent's upkeep is
    // still passed; the second press is the one that names their side.
    expect(isStopped(theirUpkeep, 0, first.stops)).toBe(false);
    expect(isStopped({ ...theirUpkeep, turn: { ...theirUpkeep.turn, active: 0 } }, 0, first.stops)).toBe(
      true,
    );

    const second = cycleStop(first, 'upkeep');
    expect(isStopped(theirUpkeep, 0, second.stops)).toBe(true);
  });
});

describe('the state is legible without the shapes', () => {
  it('carries the state as a word in every node accessible name', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const step of STOPPABLE_STEPS) {
      const state = stateOfNode(step) as StopState;
      expect(attr(nodeFor(step), 'aria-label')).toBe(nodeName(step, state));
      expect(attr(nodeFor(step), 'aria-label')).toContain(STOP_STATE_WORDS[state]);
    }
  });

  /**
   * WCAG 2.5.3: the visible label has to be in the accessible name, or a voice
   * user saying "click main 1" is talking to a control that is not called that.
   * The bar's visible word is the short one and the name starts with it; where
   * the board header words a step differently, the name carries that too, so
   * nothing here is a second vocabulary for a step.
   */
  it('starts every name with the word drawn on the node, and keeps the header word too', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const step of STOPPABLE_STEPS) {
      const name = attr(nodeFor(step), 'aria-label') ?? '';
      const visible = textOf(nodeFor(step));
      expect(visible).toContain(stepAbbreviation(step));
      expect(name.toLowerCase().startsWith(stepAbbreviation(step).toLowerCase())).toBe(true);
      const short = stepAbbreviation(step).toLowerCase();
      const long = stepLabel(step).toLowerCase();
      if (!long.includes(short)) expect(name.toLowerCase()).toContain(long);
    }
  });

  /**
   * A four-state control is not a toggle button. `aria-pressed` has two states
   * and a third, `mixed`, that means partially pressed — none of which is "this
   * step stops on the opponent's turn". Claiming it would be a control that
   * announces itself wrongly three times out of four.
   */
  it('claims no pressed state, because a node is not a toggle', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const node of nodes()) {
      expect(attr(node, 'aria-pressed')).toBeNull();
      expect(attr(node, 'aria-checked')).toBeNull();
    }
  });

  it('hides every mark from the accessibility tree, because a shape is not a name', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const marks = [
      ...queryAll(bar(), '.mtg-phasebar__pip'),
      ...queryAll(bar(), '.mtg-phasebar__beat'),
      ...queryAll(bar(), '.mtg-phasebar__beats-mark'),
    ];
    expect(marks.length, 'the bar drew no marks at all').toBeGreaterThan(0);
    for (const mark of marks) expect(attr(mark, 'aria-hidden')).toBe('true');
    // Drawn, though: the shapes are how the bar is read across the strip, and
    // they are the ones the panel's legend names.
    expect(textOf(nodeFor('precombatMain'))).toContain(STOP_ROW_MARKS.yourTurn.set);
    expect(textOf(nodeFor('declareBlockers'))).toContain(STOP_ROW_MARKS.theirTurn.set);
    expect(textOf(nodeFor('upkeep'))).toContain(STOP_ROW_MARKS.yourTurn.unset);
  });

  /**
   * The live region is the other half of the answer to having no role for this.
   * A name that changes under the ring is announced by some screen readers and
   * not others; a polite status region is announced by all of them. It says
   * nothing until something happens, because a region with text in it on first
   * render narrates the interface rather than a change to it.
   */
  it('announces what a press did, and says nothing before one', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const status = within(bar()).getByRole('status');
    expect(textOf(status)).toBe('');
    press('upkeep');
    expect(textOf(within(bar()).getByRole('status'))).toBe('Upkeep: stop on own turn.');
    press('upkeep');
    expect(textOf(within(bar()).getByRole('status'))).toBe("Upkeep: stop on opponent's turn.");
  });
});

/**
 * `mtg-rgc.2`'s own acceptance criterion: three kinds of mark, and none of them
 * a state of either of the others.
 *
 * The four-state cycle survives as the *press* and stops being the *reading*.
 * Whose stop a mark is now comes from which of a node's two rows it sits in —
 * Magic Online's encoding, and it maps onto `StopSet`'s two halves exactly — and
 * the combat beat takes neither row, because it belongs to neither player and is
 * not settable by pressing the node it appears on. `@mtg/kernel`'s `beats.ts`
 * calls conflating the two mechanisms the thing that would break both.
 */
describe('three kinds of mark, in three places', () => {
  it('draws a row per player on every step a stop can be set at, opponent above', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const step of STOPPABLE_STEPS) {
      expect(
        rowsOf(step).map((row) => attr(row, 'data-row')),
        `${step} rows`,
      ).toEqual([...STOP_ROWS]);
    }
    // The order is the mat's: `board/Board.ts` draws the opponent's side at the
    // top and the viewer's at the bottom, and a bar that reversed them would ask
    // one player to hold two opposite conventions on one screen.
    expect(STOP_ROWS).toEqual(['theirTurn', 'yourTurn']);
  });

  it('draws no row at all on a step no stop can be set at', () => {
    render(h(PlayRoute, { config: dealt().config }));
    // Distinct from a hollow row, and the distinction is the point: hollow says
    // "no stop here yet", absent says "no stop can go here".
    for (const step of ['untap', 'cleanup'] as const) expect(rowsOf(step)).toHaveLength(0);
  });

  it('fills each row from the kernel own two sets, and marks it with the filled shape', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const step of STOPPABLE_STEPS) {
      for (const side of STOP_ROWS) {
        const set = hasStop(DEFAULT_AUTO_PASS.stops, side, step);
        const row = rowOf(step, side);
        expect(attr(row, 'data-set'), `${step} ${side}`).toBe(String(set));
        expect(textOf(row)).toBe(set ? STOP_ROW_MARKS[side].set : STOP_ROW_MARKS[side].unset);
      }
    }
    // The defaults spelled out, so the loop cannot pass by comparing nothing to
    // nothing: the player's own main phase, and the opponent's declare blockers.
    expect(attr(rowOf('precombatMain', 'yourTurn'), 'data-set')).toBe('true');
    expect(attr(rowOf('precombatMain', 'theirTurn'), 'data-set')).toBe('false');
    expect(attr(rowOf('declareBlockers', 'theirTurn'), 'data-set')).toBe('true');
  });

  it('moves exactly the rows the cycle names, one press at a time', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const expected of STOP_CYCLE.slice(1).concat('none')) {
      press('upkeep');
      for (const side of STOP_ROWS) {
        expect(attr(rowOf('upkeep', side), 'data-set'), `${expected} ${side}`).toBe(
          String(STOP_STATE_SIDES[expected].includes(side)),
        );
      }
    }
  });

  it('puts the pause on the combat steps and nowhere else, and in neither row', () => {
    render(h(PlayRoute, { config: dealt().config }));
    for (const step of STEPS) {
      const shows = stepShowsBeat(step, DEFAULT_BEATS);
      expect(beatMarkOf(step) === null, `${step} pause mark`).toBe(!shows);
      if (!shows) continue;
      expect(textOf(beatMarkOf(step))).toBe(BEAT_MARK);
      // The third mark is a third mark: it is not one of the two rows, and it is
      // not either row's shape. A fifth position in a four-state cycle is what
      // `mtg-0sn`'s lane refused to ship and this is the alternative.
      for (const side of STOP_ROWS) {
        expect(textOf(rowOf(step, side))).not.toBe(BEAT_MARK);
      }
      expect(BEAT_MARK).not.toBe(STOP_ROW_MARKS.yourTurn.set);
      expect(BEAT_MARK).not.toBe(STOP_ROW_MARKS.theirTurn.set);
    }
  });

  it('leaves the pause exactly where it was when a node is pressed', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const before = STEPS.map((step) => beatMarkOf(step) !== null);
    for (const _press of STOP_CYCLE) press('combatDamage');
    expect(STEPS.map((step) => beatMarkOf(step) !== null)).toEqual(before);
  });

  it('names every mark it draws, in the legend the panel prints', () => {
    // The marks are `aria-hidden`, so a sighted player who has never been told
    // what a filled triangle in the upper row means has one place to read it.
    // Both stop shapes, both hollows and the pause are covered by that list.
    const legend = MARK_LEGEND.map((entry) => entry.mark).join('');
    for (const mark of [
      STOP_ROW_MARKS.theirTurn.set,
      STOP_ROW_MARKS.yourTurn.set,
      STOP_ROW_MARKS.theirTurn.unset,
      STOP_ROW_MARKS.yourTurn.unset,
      BEAT_MARK,
    ]) {
      expect(legend, `${mark} is drawn on the bar and named nowhere`).toContain(mark);
    }
  });
});

/**
 * The control at the end of the bar (`mtg-885`).
 *
 * The bead's own constraint: the pause is not a stop and must not fold into
 * `StopSet`. So this is a second setting on the same strip, a plain two-state
 * toggle that writes `BeatSet`, and the assertions below are that it changes the
 * pause, that it changes nothing else, and that the game's record does not
 * notice it happened.
 */
describe('the combat beats toggle', () => {
  it('is on the bar, pressed, and says what it is in a word', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const toggle = beatsToggle();
    expect(toggle, 'the bar has no beats control').not.toBeNull();
    expect(closest(toggle, '.mtg-phasebar'), 'the toggle left the bar').not.toBeNull();
    // Two states, so `aria-pressed` is right here and wrong on a node.
    expect(attr(toggle, 'aria-pressed')).toBe('true');
    // WCAG 2.5.3: the drawn word is inside the spoken name.
    expect(WATCH_BEATS_LABEL).toContain(textOf(toggle).trim().replace(BEAT_MARK, ''));
  });

  it('takes the pause off every combat node, and puts it back', () => {
    render(h(PlayRoute, { config: dealt().config }));
    // Four nodes for three beats: the damage beat is shown in both damage
    // steps, because `combatNeedsFirstStrikeStep` decides which of them a given
    // combat enters and the bar has a step rather than a position.
    const combat = STEPS.filter((step) => stepShowsBeat(step, DEFAULT_BEATS));
    expect(combat).toEqual(['declareAttackers', 'declareBlockers', 'firstStrikeDamage', 'combatDamage']);

    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(attr(beatsToggle(), 'aria-pressed')).toBe('false');
    for (const step of combat) {
      expect(beatMarkOf(step), `${step} still claims a pause`).toBeNull();
      expect(attr(nodeFor(step), 'aria-label')).not.toContain('pauses to show combat');
      expect(attr(nodeFor(step), 'data-beat')).toBe('false');
    }

    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(attr(beatsToggle(), 'aria-pressed')).toBe('true');
    for (const step of combat) expect(beatMarkOf(step)).not.toBeNull();
  });

  it('touches no stop, because a pause is not one', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const before = STEPS.map((step) => stateOfNode(step));
    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(STEPS.map((step) => stateOfNode(step))).toEqual(before);
  });

  /**
   * The invariant the whole mechanism rests on: a beat records nothing, so
   * switching it can add nothing to the choice list. If it could, the game's
   * record would depend on how fast somebody wanted to watch it, and
   * `replaySession` would stop reproducing a played game byte for byte.
   */
  it('records nothing, so the game odometer does not move', () => {
    render(h(PlayRoute, { config: dealt().config }));
    const before = odometer();
    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(odometer()).toBe(before);
    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(odometer()).toBe(before);
  });

  it('says what it did, in the bar own live region', () => {
    render(h(PlayRoute, { config: dealt().config }));
    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(textOf(within(bar()).getByRole('status'))).toBe(beatAnnouncement(false));
    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    expect(textOf(within(bar()).getByRole('status'))).toBe(beatAnnouncement(true));
  });

  /**
   * The same rule the bar itself answers to: a control nobody is listening to is
   * a screen lying about what it controls. `@mtg/netplay` sets no beats — one
   * player's pause is the other player's wait — so a remote seat gets the bar
   * and no toggle.
   */
  it('is absent for a caller that does not own the pause', () => {
    render(settableView());
    expect(bar()).toBeTruthy();
    expect(beatsToggle()).toBeNull();
  });

  it('is drawn for a caller that owns it, and reads the set it was handed', () => {
    render(settableView({ beats: NO_BEATS, onBeats: vi.fn() }));
    expect(attr(beatsToggle(), 'aria-pressed')).toBe('false');
    for (const step of STEPS) expect(beatMarkOf(step)).toBeNull();
  });

  it('hands back a beat set rather than a stop set', () => {
    const onBeats = vi.fn();
    render(settableView({ beats: DEFAULT_BEATS, onBeats }));
    fireEvent.click(beatsToggle() as Parameters<typeof fireEvent.click>[0]);
    const emitted = onBeats.mock.calls[0]?.[0] as BeatSet | undefined;
    if (emitted === undefined) throw new Error('the toggle emitted nothing');
    expect(emitted.size).toBe(0);
    expect([...DEFAULT_BEATS].every((beat) => !emitted.has(beat))).toBe(true);
  });
});

/*
 * What the sheet has to declare for thirteen nodes to fit a strip.
 *
 * jsdom lays nothing out, so none of this is a pixel: it is the declarations the
 * fit is made of, in the convention `./fit.test.ts` states at length. The
 * measured boxes are in `../../tools/step-bar.ts`, which drives the real page in
 * chrome-headless-shell at three viewports, and the numbers it reported are in
 * that file and in the commit message.
 */
describe('the bar takes the lane width and only its own height', () => {
  const SHEET = uiStyleSheet();

  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(SHEET);
    if (found === null) throw new Error(`the sheet has no rule for ${selector}`);
    return found[1] ?? '';
  }

  /**
   * `mtg-rgc.6` reversed the first of these. On the strip the bar was one item
   * on a flex *row* and needed a zero basis so the row never wrapped it; in the
   * near band it is one item in a flex *column*, where `flex: 1 1 0` would make
   * it grow down the lane and eat the battlefield it is supposed to sit under.
   * `flex: none` is what holds it at the height of its own thirteen nodes.
   */
  it('holds the bar at its own height and lets its columns shrink', () => {
    expect(rule('.mtg-phasebar')).toContain('flex: none');
    expect(rule('.mtg-phasebar')).not.toContain('flex: 1 1 0');
    // The inner strip keeps the zero basis and the zero minimum, which is what
    // lets the thirteen columns share the lane's width and shrink inside it.
    expect(rule('.mtg-phasebar__steps')).toContain('flex: 1 1 0');
    expect(rule('.mtg-phasebar__steps')).toContain('min-width: 0');
  });

  /**
   * And the gap the third child would otherwise cost. The band is a flex column
   * with one gap between every pair of children, so a bar between the
   * battlefield and the hand adds a second one; Magic Online draws the bar hard
   * against the bottom edge of the board panel, and at 1280x800 4px is a
   * battlefield face's worth of the lane.
   */
  it('sits flush under the battlefield rather than a gap below it', () => {
    // The scope is read off the sheet's own constant rather than typed: since
    // `mtg-ryix` the mat's rules are emitted under `TABLE`, which is the play
    // route and the replay viewer, and a test that spelled one of them would go
    // red on a change that moved neither this rule nor this bar.
    const flush = rule(`${TABLE} .mtg-board__side > .mtg-phasebar`);
    expect(flush).toContain('margin-block-start: calc(-1 * var(--mtg-space-1))');
  });

  /**
   * The bar is the one block on the mat that is neither a well nor a card, and
   * the faintest ink on the sheet is what an unset step name is drawn in.
   * `styles/board/band.ts` values that token against a well and not against a
   * band, so the bar states its own ground rather than inheriting the seat's.
   */
  it('draws itself on the mat rather than on the band it sits in', () => {
    expect(rule('.mtg-phasebar')).toContain('background: var(--mtg-mat)');
  });

  /**
   * `mtg-rgc.2`'s width answer, and the reason it is not the one that shipped
   * before: the shortfall used to go sideways, and at 1280x800 on a sealed game
   * that put three of thirteen nodes off the right-hand edge. A bar whose whole
   * job is "where you will next be asked, and where your opponent will be"
   * cannot answer with three nodes scrolled out of sight. So the columns give
   * before the bar does, and the words give last.
   *
   * Equal columns is what that used to mean and `mtg-1i9` is what it cost.
   * Measured over `../../tools/step-bar.ts` in chrome-headless-shell 151, the
   * thirteen labels want 779px; equal thirteenths of the 863px the row has at
   * 1440x900 gave `Begin combat` 65 of the 92 it wanted while `End` used 25 of
   * its 65, and three names were cut on a row with 84px to spare. The two
   * narrow viewports are genuinely short - 718 and 495 against 779 - and cut
   * six and twelve.
   *
   * A content basis alone is worse, not better: it takes the same *share* off
   * every column, so 1280x800 went from six names cut to thirteen. The basis
   * and the wrap are one change. After both: 0, 0 and 0 cut, on one line at
   * 1440x900 and two at the others.
   */
  it('sizes each step by its own word and wraps rather than clipping', () => {
    expect(rule('.mtg-phasebar__node')).toContain('flex: 1 1 auto');
    expect(rule('.mtg-phasebar__steps')).toContain('flex-wrap: wrap');
    // The ellipsis stays, because a second line is the answer to a short row
    // and not to a long word: an unwrappable name still has to end somewhere.
    expect(rule('.mtg-phasebar__text')).toContain('text-overflow: ellipsis');
    expect(rule('.mtg-phasebar__text')).toContain('overflow: hidden');
    // A flex item will not shrink below its content without this, so the
    // ellipsis would never fire and the bar would overflow instead.
    expect(rule('.mtg-phasebar__name')).toContain('min-width: 0');
    // And a floor under a column, because thirteen ellipses say nothing.
    expect(/min-width: ([\d.]+)rem/.exec(rule('.mtg-phasebar__node'))?.[1]).toBeDefined();
  });

  /** The one thing on the bar that must keep its size: a control clipped to an ellipsis is unidentifiable. */
  it('holds the beats control at its own width while the steps give', () => {
    expect(rule('.mtg-phasebar__beats')).toContain('flex: none');
  });

  /**
   * The rule that made the spacer stop growing beside the bar is gone with the
   * bar, and its absence is asserted rather than left to be noticed: an inert
   * sibling selector for an element that is no longer a sibling is the kind of
   * declaration that survives three more layout changes.
   */
  it('leaves the strip spacer alone, now that the bar is not on the strip', () => {
    expect(SHEET).not.toContain('.mtg-phasebar ~ .mtg-toolbar__spacer');
    expect(rule('.mtg-toolbar__spacer')).toContain('flex: 1');
  });

  /**
   * The rows are shapes, not type, and every pixel of them comes off the
   * battlefield. Drawn from the type scale they stood the node 12px taller for
   * no gain in legibility.
   */
  it('draws the stop rows smaller than the smallest type on the sheet', () => {
    const pip = /font-size: ([\d.]+)rem/.exec(rule('.mtg-phasebar__pip'))?.[1];
    expect(pip, 'the stop rows state no size').toBeDefined();
    expect(Number(pip) * 16).toBeLessThan(12);
    // Fill carries the meaning; color reinforces it. WCAG 1.4.1 — with the
    // palette removed the two marks are still two different shapes, which is
    // what `STOP_ROW_MARKS` states and this checks the sheet does not undo.
    expect(rule('.mtg-phasebar__pip')).not.toContain('content:');
  });

  /** The badge clips too, and the clipping lands on the words rather than the marker. */
  it('caps the turn badge and clips its label rather than its disclosure marker', () => {
    expect(rule('.mtg-turnstops__head')).toContain('max-width');
    expect(rule('.mtg-turnstops__label')).toContain('text-overflow: ellipsis');
    expect(rule('.mtg-turnstops__head::after')).toContain('flex: none');
  });

  /**
   * `mtg-rgc.13`: the head is the one item on the bar that keeps its size, for
   * the reason the beats control does — a turn clipped to an ellipsis is a fact
   * nobody can read — and it is capped, because the row it shares is short of
   * width at two of the three viewports this table is measured at and a seat
   * name is arbitrarily long.
   */
  it('holds the turn at its own width and caps what it may take', () => {
    const head = rule('.mtg-phasebar > .mtg-turnstops, .mtg-phasebar > .mtg-badge');
    expect(head).toContain('flex: none');
    const cap = /max-width: ([\d.]+)rem/.exec(
      rule('.mtg-phasebar > .mtg-turnstops .mtg-turnstops__head,\n.mtg-phasebar > .mtg-badge'),
    )?.[1];
    expect(cap, 'the head on the bar states no cap').toBeDefined();
    // Under the 12rem the badge took on the strip, which is the whole point:
    // the thirteen labels want 779px and the widest lane gives 863.
    expect(Number(cap)).toBeLessThan(12);
  });

  /**
   * And a phone states its own cap, because that is the one layout where the
   * lanes cannot grow to pay for a wrapped line. `styles/mobile.ts` carries the
   * sweep: up to 3.5rem the turn costs the bar nothing at 390x844, and 4rem
   * costs a whole line, 13.9px of which comes off the opponent's battlefield.
   */
  it('states a second, narrower cap inside the phone block', () => {
    const caps = [...SHEET.matchAll(/\.mtg-phasebar > \.mtg-badge \{ max-width: ([\d.]+)rem; \}/g)];
    expect(caps, 'the sheet caps the head once, so a phone takes the desktop number').toHaveLength(2);
    const desktop = Number(caps[0]?.[1]);
    const phone = Number(caps[1]?.[1]);
    expect(phone, 'the phone cap is not narrower than the desktop one').toBeLessThan(desktop);
    // 3.5rem is 56px and `Turn 18:` is 43.8px in this face, so the turn and its
    // number survive the ellipsis on a phone as well.
    expect(phone * 16).toBeGreaterThanOrEqual(48);
    const media = SHEET.indexOf(`@media (max-width: ${String(PHONE_MAX_REM)}rem)`);
    expect(media, 'the sheet has no phone block').toBeGreaterThan(-1);
    expect(caps[1]?.index ?? -1, 'the narrower cap is outside the phone block').toBeGreaterThan(media);
  });

  /**
   * And the panel opens *up*. The head moved between a battlefield and a hand,
   * and `inset-block-start` dropped the panel straight onto the hand — the
   * surface the setting is about, since the instant a stop exists to hold up is
   * a card in it. `styles/views.ts` argues the direction and what it costs; this
   * is the assertion that the sheet still says it, since the two properties are
   * one word apart.
   */
  it('opens the stops panel upward, off the top edge of the bar', () => {
    const panel = rule('.mtg-turnstops__panel');
    expect(panel).toContain('inset-block-end: calc(100% + var(--mtg-space-1))');
    expect(panel, 'the panel opens down over the hand again').not.toContain('inset-block-start');
  });

  /** WCAG 2.5.8: a node is a button, and no compaction may take one under 24px. */
  it('floors a node at a real target size', () => {
    const floor = /min-height: ([\d.]+)rem/.exec(rule('.mtg-phasebar__node'))?.[1];
    expect(floor, 'a node states no floor').toBeDefined();
    expect(Number(floor) * 16).toBeGreaterThanOrEqual(24);
  });

  /**
   * Where the game *is* has to beat how a node is *set*, so the current-step
   * rule comes after the stop-state rules rather than before them. They tie on
   * specificity, which makes the order the whole of it.
   */
  it('draws the current step over the set state, by cascade order', () => {
    const current = SHEET.indexOf(".mtg-phasebar__node[aria-current='step']");
    const set = SHEET.indexOf(".mtg-phasebar__node:not([data-stop='none'])");
    expect(set).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(set);
  });

  /**
   * Clipped rather than `display: none`, which would take the live region out of
   * the accessibility tree and announce nothing at all.
   */
  it('keeps the live region in the tree while keeping it off the strip', () => {
    const status = rule('.mtg-phasebar__status');
    expect(status).toContain('clip-path: inset(50%)');
    expect(status).not.toContain('display: none');
  });
});
