// @vitest-environment jsdom
/**
 * A shut ask column can still answer the game.
 *
 * `mtg-li0o`. the playtester, 2026-08-20, after playing: "I want to not have to
 * expand the panel to be able to click through the actions, or if that doesnt
 * work well then at least get an alert." She named combat and spells being cast,
 * and then the sharpest case: "for example it'll say something of mine is
 * destroyed and I'll need to open the panel and click continue." And on combat
 * in particular: "I dont want to have to open up the panel to click through my
 * creature going through attacks either."
 *
 * The premise held. `src/styles/board/rail.ts` narrows the column to 5rem and
 * hides `.mtg-board__pods > .mtg-panel` in it, and all four panels the column
 * can draw are `.mtg-panel`. A shut column could pass priority and do nothing
 * else: every target, every blocker assignment, every damage order and every
 * acknowledgment of a paused game was behind a press on the disclosure.
 *
 * # What is asserted
 *
 * **The load-bearing test is the combat walk**, and it is the acceptance test
 * for the bead. It parks a board at `beginCombat`, shuts the column once, and
 * plays the combat out — begin-combat priority, declare attackers, declare
 * blockers, the damage order, first strike damage, combat damage, end of combat
 * — pressing only what is on screen. The disclosure is asserted still shut at
 * the end, so a stop that quietly needed the column open fails rather than
 * passing on a driver that opened it. The stops it visited are asserted too: a
 * walk that fell out of combat early would otherwise pass by reaching nothing.
 *
 * Everything else is a property that walk would not name: which of the two homes
 * the panel is in, that the flyout submits the same indices the column did, that
 * the strip says what is owed whether or not the flyout is on screen, that
 * Escape puts it away and the next decision brings it back, and that the fixed
 * pass never moved.
 *
 * # The opening hand
 *
 * `mtg-0e9p`. the playtester, 2026-08-22, sideways on a phone: "If the only option is
 * keep or mulligan you shouldn't need to click into 'waiting' it should just
 * show you a keep or mulligan button option immediately." That is the one ask
 * that arrives already drawn, and the four tests for it are the four halves of
 * that being a narrowing rather than a reversal: the hand is on screen with no
 * press, the press still puts it away, the priority that follows the keep is
 * shut like every other ask, and an open column still draws it in the column.
 *
 * The beat gets one test and no more, on purpose. `mtg-gt4q` replaces that
 * panel's presentation with the motion of the spell that caused it, and this
 * lane's job is that whatever occupies the slot is reachable, so what is checked
 * is the reachability and the sentence on the strip rather than the panel.
 */
import { createElement as h, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_CARDS, parseCard } from '@mtg/dsl';
import type { Beat, Choice, GameSession, GameState, PlayerId } from '@mtg/kernel';
import { choose, createSession, FULL_CONTROL, humanSeat, pendingDecision, scenario } from '@mtg/kernel';
import {
  ASK_ALERT_STATUS_LABEL,
  ASK_FLYOUT_LABEL,
  ASK_PANEL_LABEL,
  askAlertText,
  CONTINUE_LABEL,
  LEGAL_MOVES_LABEL,
  PASS_LABEL,
  PlayView,
} from '../../src/routes/play/PlayView';
import { askAlert } from '../../src/routes/play/ask-flyout';
import { declarationWords } from '../../src/routes/play/declare';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { buildPrompt } from '../../src/routes/play/prompt';
import type { SeatNames } from '../../src/routes/play/position';
import { clearPreferences } from '../support/preferences';

afterEach(() => {
  cleanup();
  clearPreferences();
});

const SEATS: SeatNames = ['You', 'Bot'];
/** Full control, so the walk is asked about every priority a combat holds. */
const OPTIONS = { autoPass: FULL_CONTROL };

/* -------------------------------------------------------------------------
 * Structural node reads. The workspace tsconfig has no `lib: dom`
 * (`src/app/mount.ts` records why), so every DOM fact this file needs is
 * declared here and nowhere else.
 * ---------------------------------------------------------------------- */

interface HostNode {
  readonly textContent?: string | null;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

function nodeOf(value: unknown): HostNode {
  return value as HostNode;
}

function attr(value: unknown, name: string): string | null {
  return nodeOf(value).getAttribute(name);
}

function textOf(value: unknown): string {
  return nodeOf(value).textContent ?? '';
}

function click(value: unknown): void {
  fireEvent.click(value as Parameters<typeof fireEvent.click>[0]);
}

/* ------------------------------------------------------------------ fixtures */

let minted = 0;

/** A creature invented for this file, so no set's own card name is borrowed. */
function creature(name: string, firstStrike = false): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `slc-flyout-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'SLC', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
    ...(firstStrike ? { keywords: ['firstStrike' as const] } : {}),
  });
}

/**
 * A board on the brink of a combat, holding everything a combat can ask for.
 *
 * Two attackers, one of them first striking so the game runs both damage steps
 * rather than collapsing them into one, and three blockers so an attacker can be
 * blocked twice and the game reaches `orderBlockers` — the decision the shut
 * column handled worst, because CR 509.2 enumerates no pass in it, so the strip's
 * one live control was a button the kernel had disabled.
 */
function combatState(): GameState {
  return scenario({
    seed: 'test/play/ask-flyout',
    battlefield: [
      { card: creature('Vanguard Pikebearer', true), controller: 0, summoningSick: false },
      { card: creature('Column Runner'), controller: 0, summoningSick: false },
      { card: creature('Gate Watcher'), controller: 1, summoningSick: false },
      { card: creature('Gate Watcher'), controller: 1, summoningSick: false },
      { card: creature('Ledger Warden'), controller: 1, summoningSick: false },
    ],
    active: 0,
    turn: 6,
    step: 'beginCombat',
  }).state;
}

function sessionOn(state: GameState): GameSession {
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat(SEATS[0]), humanSeat(SEATS[1])],
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

/** One stop on the walk: the step the game was on, and what it asked for. */
interface Stop {
  readonly step: string;
  readonly kind: string;
}

/**
 * A live table: the session in React state, the viewer following whoever owes
 * the decision, and the column's own open/shut state kept across every move.
 *
 * That last part is why this is a component rather than a `rerender` loop.
 * `ask-collapse.ts` holds the width in `PlayView`'s state, so the column is shut
 * *once*, at the start, and the walk after it is honest about never reopening it.
 */
function Table(props: { readonly start: GameSession; readonly stops?: Stop[] }): ReactElement {
  const [session, setSession] = useState(props.start);
  const viewer: PlayerId = session.pending === null ? 0 : session.pending.player;
  const record = props.stops;
  useEffect((): void => {
    if (record === undefined || session.pending === null) return;
    record.push({ step: session.state.turn.step, kind: session.pending.kind });
  }, [record, session]);
  return h(PlayView, {
    session,
    viewer,
    names: SEATS,
    onChoose: (choice: Choice): void => {
      setSession((was) => choose(was, choice, OPTIONS));
    },
  });
}

let container: unknown = null;

function openTable(start: GameSession, stops?: Stop[]): void {
  const view = render(h(Table, stops === undefined ? { start } : { start, stops }));
  container = view.container;
}

/** The same table with the column already shut, which is every test but two. */
function shutTable(start: GameSession, stops?: Stop[]): void {
  openTable(start, stops);
  click(disclosure());
  expect(attr(disclosure(), 'aria-expanded'), 'the column did not shut').toBe('false');
}

/**
 * A table stopped on a beat, with the column shut, rendered into `container`.
 *
 * The strip is a plain element rather than a role, so `alertButton` reads it off
 * the rendered container and a test that renders its own table has to say so.
 */
function pauseShut(): void {
  const beat: Beat = { kind: 'attackers' };
  const start = sessionOn(combatState());
  // Held in a variable rather than spread inline: `PlayView` takes the narrower
  // `SessionView`, and an object literal handed straight to it is
  // excess-property-checked against a type that has no `beat`.
  const paused: GameSession = { ...start, pending: null, beat };
  const view = render(
    h(PlayView, {
      session: paused,
      viewer: 0,
      names: SEATS,
      beat,
      onChoose: vi.fn(),
      onContinue: vi.fn(),
    }),
  );
  container = view.container;
  click(disclosure());
}

/**
 * The body run as though the primary input were a finger.
 *
 * `../../src/routes/play/pointer.ts` asks the host for `(pointer: coarse)` and
 * jsdom answers no to every query it is given, which is the keyboard arm and is
 * what every other test in this file gets. Only that one query is answered yes
 * here; the column's own width query keeps jsdom's answer, so these tables start
 * open and are shut by the same press as the rest.
 */
function withCoarsePointer(body: () => void): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string): { matches: boolean; addEventListener: () => void; removeEventListener: () => void } => ({
      matches: query.includes('pointer: coarse'),
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    }),
  );
  try {
    body();
  } finally {
    vi.unstubAllGlobals();
  }
}

/* ------------------------------------------------------------------- queries */

function disclosure(): unknown {
  return screen.getByRole('button', { name: ASK_PANEL_LABEL });
}

function flyout(): unknown {
  return screen.getByRole('region', { name: ASK_FLYOUT_LABEL });
}

function noFlyout(): void {
  expect(screen.queryByRole('region', { name: ASK_FLYOUT_LABEL })).toBeNull();
}

function moves(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
}

function moveButtons(): readonly ReturnType<typeof screen.getByRole>[] {
  const group = screen.queryByRole('group', { name: LEGAL_MOVES_LABEL });
  return group === null ? [] : within(group).queryAllByRole('button');
}

function all(selector: string): readonly unknown[] {
  return Array.from(nodeOf(container).querySelectorAll(selector));
}

/** The strip's alert button, which carries the whole sentence as its name. */
function alertButton(): unknown {
  const found = nodeOf(container).querySelector('.mtg-ask-alert__button');
  if (found === null) throw new Error('the strip drew no alert');
  return found;
}

function announced(): string {
  return textOf(screen.getByRole('status', { name: ASK_ALERT_STATUS_LABEL }));
}

/** The alert pressed, which is the only thing that draws the flyout. */
function showFlyout(): void {
  click(alertButton());
}

function escape(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: ASK_PANEL_LABEL }), { key: 'Escape' });
}

/* -------------------------------------------------------------------- driver */

/**
 * The boldest move on screen, pressed, and nothing else touched.
 *
 * Modeled on `beats.test.ts`'s driver for the reason that file states: taking
 * the first option forever is "attack with nothing", and this bead is about
 * attacking. A declaration and a damage order are the same gesture one mechanism
 * along — say something about every creature, then confirm — and both mark a row
 * `data-declared`, so one loop drives both. An ordinary list's boldest move is
 * its last entry. A position whose only legal move is the pass draws no entry at
 * all, and the fixed button on the strip is the move.
 */
function pressBoldestMove(): void {
  for (let presses = 0; presses < 80; presses += 1) {
    // The follow-up question first: a roster row that opens one replaces the
    // roster, so answering it is what gets back to the rest of the creatures.
    // Its first answer is a real candidate; the decline is drawn last.
    const asked = all(".mtg-declare__answer[data-declared='false']")[0];
    if (asked !== undefined) {
      click(asked);
      continue;
    }
    const idle = all(".mtg-declare__row[data-declared='false']")[0];
    if (idle === undefined) break;
    click(idle);
  }
  const entries = moveButtons();
  if (entries.length === 0) {
    click(screen.getByRole('button', { name: PASS_LABEL }));
    return;
  }
  // A roster's confirm is the group's first button (`declare-panel.ts` says why
  // it is first); an ordinary list's boldest move is its last.
  const roster = all('.mtg-declare__row')[0];
  const target = roster === undefined ? entries.at(-1) : entries[0];
  if (target === undefined) throw new Error('the move list drew nothing to press');
  click(target);
}

/* --------------------------------------------------------------------- tests */

describe('the ask column, open, is the column it always was', () => {
  it('draws the panel in the column and nothing over the board', () => {
    openTable(sessionOn(combatState()));
    expect(nodeOf(moves()).closest('.mtg-board__pods'), 'the panel left the column').not.toBeNull();
    noFlyout();
    expect(nodeOf(container).querySelector('.mtg-ask-alert')).toBeNull();
  });
});

describe('the ask column, shut, keeps every move reachable', () => {
  it('moves the panel into a flyout and leaves no second copy behind', () => {
    shutTable(sessionOn(combatState()));
    // Nothing over the board until it is asked for: the strip says what is owed
    // and the panel arrives on a press, which is the whole of her second reading.
    noFlyout();
    showFlyout();
    expect(nodeOf(moves()).closest('.mtg-ask-flyout'), 'the panel is not in the flyout').not.toBeNull();
    // One list, not one drawn and one hidden: jsdom applies no stylesheet, so a
    // panel left in the column and hidden by CSS would be a second `Legal moves`
    // group here and a second one for a screen reader in a browser.
    expect(screen.queryAllByRole('group', { name: LEGAL_MOVES_LABEL })).toHaveLength(1);
    expect(nodeOf(flyout()).closest('.mtg-board__lanes'), 'the flyout is not on the board').not.toBeNull();
  });

  it('offers every move the open column offered, and each submits its own index', () => {
    const state = combatState();
    const session = sessionOn(state);
    const decision = session.pending;
    if (decision === null) throw new Error('the board left nobody to ask');
    const prompt = buildPrompt(state, decision, SEATS);

    openTable(session);
    const opened = moveButtons().map((node) => attr(node, 'aria-label') ?? textOf(node));
    cleanup();

    shutTable(session);
    showFlyout();
    const flown = moveButtons().map((node) => attr(node, 'aria-label') ?? textOf(node));
    expect(flown).toEqual(opened);
    // And the enumeration is whole: the list is every legal move but the pass,
    // which has a fixed home of its own (`pass.test.ts`).
    expect(flown).toHaveLength(prompt.choices.length - 1);
  });

  it('draws nothing over the board again once the column is opened', () => {
    shutTable(sessionOn(combatState()));
    click(disclosure());
    noFlyout();
    expect(nodeOf(container).querySelector('.mtg-ask-alert')).toBeNull();
    expect(nodeOf(moves()).closest('.mtg-board__pods')).not.toBeNull();
  });
});

describe('the strip says what is owed', () => {
  it('names the seat and the size of the enumeration', () => {
    const state = combatState();
    const session = sessionOn(state);
    const decision = session.pending;
    if (decision === null) throw new Error('the board left nobody to ask');
    shutTable(session);

    const said = askAlertText({ kind: 'decision', count: decision.options.length });
    expect(attr(alertButton(), 'aria-label')).toBe(said);
    expect(announced()).toBe(said);
    // The count is the kernel's, not the list's. The list draws one fewer,
    // because the pass is the button under it rather than an entry in it, so the
    // number and the controls on screen still agree.
    expect(said).toContain(String(decision.options.length));
    showFlyout();
    expect(moveButtons()).toHaveLength(decision.options.length - 1);
  });

  it('tells a paused game apart from a set of moves', () => {
    // A count is the right answer to "there are moves you could make" and the
    // wrong answer to "the game is waiting on one press", so the two sentences
    // are different sentences rather than one with a number in it.
    const halted = askAlertText({ kind: 'halt' });
    const asked = askAlertText({ kind: 'decision', count: 12 });
    expect(halted).not.toBeNull();
    expect(halted).not.toContain('legal move');
    expect(asked).toContain('12 legal moves');
    expect(askAlertText({ kind: 'decision', count: 1 })).toContain('1 legal move.');
    // A seat that owes nothing is told nothing.
    expect(askAlertText({ kind: 'idle' })).toBeNull();
  });

  it('names a control for a finger instead of a key a phone does not have', () => {
    // The playtester, 2026-08-22, playing sideways on a phone: "There should be an
    // easy way to continue passing priority since pressing space isn't an option
    // on mobile easily." The space key is real and `pass-key.ts` continues a beat
    // with it; it is the halt's only advice in a shut column, and it is advice a
    // phone cannot take.
    const keyboard = askAlertText({ kind: 'halt' });
    const finger = askAlertText({ kind: 'halt' }, true);
    expect(keyboard).toContain('space key');
    expect(finger).not.toContain('space');
    expect(finger).toContain(CONTINUE_LABEL);
    // Both arms still say the same thing about the game, which is the half of
    // this sentence that is not about the input.
    expect(keyboard).toContain('paused');
    expect(finger).toContain('paused');
    // And the two words the 5rem strip has room for move with it, so the strip
    // is never printing a shortcut beside a name that does not mention one.
    const words = (coarse: boolean): string => {
      const drawn = render(
        h(
          'div',
          null,
          askAlert({ kind: 'halt' }, false, () => undefined, coarse),
        ),
      );
      const detail = nodeOf(drawn.container).querySelector('.mtg-ask-alert__detail');
      const text = detail === null ? '' : textOf(detail);
      cleanup();
      return text;
    };
    // The keyboard arm is pinned by its sentence above rather than by its own two
    // words: the export census reads every capitalized word a public test types
    // as a card name somebody has to have looked at, and the shortcut's label is
    // two of them. What is asserted here is that the arms differ and that the
    // one a finger gets names the control in front of it.
    expect(words(true)).toBe(CONTINUE_LABEL);
    expect(words(false)).not.toBe(words(true));
    expect(words(false)).not.toBe('');
  });

  it('does not change what any other slot says when the pointer is a finger', () => {
    // The pointer decides one sentence on this strip. A count is a count on
    // either input, and a finished game is finished on either.
    for (const slot of [
      { kind: 'decision', count: 7 },
      { kind: 'report' },
      { kind: 'idle' },
      { kind: 'board' },
    ] as const) {
      expect(askAlertText(slot, true)).toBe(askAlertText(slot));
    }
  });
});

describe('a flyout that was dismissed comes back', () => {
  it('goes away on Escape and leaves the alert as the way in', () => {
    shutTable(sessionOn(combatState()));
    showFlyout();
    escape();
    noFlyout();
    // The alert is the half of this that stands on its own: it is what she asked
    // for as the fallback, and it is the door back.
    showFlyout();
    expect(flyout()).toBeDefined();
  });

  it('does not survive into the next decision', () => {
    const stops: Stop[] = [];
    shutTable(sessionOn(combatState()), stops);
    showFlyout();
    expect(flyout()).toBeDefined();
    // Being open is scoped to the ask it was opened for. Answering this one
    // produces the next, and a panel that carried over would be the last
    // question's panel standing in front of a board that has already moved.
    click(screen.getByRole('button', { name: PASS_LABEL }));
    expect(stops.length, 'the game did not move on').toBeGreaterThan(1);
    noFlyout();
    expect(attr(alertButton(), 'aria-expanded')).toBe('false');
  });

  it('opens and closes a paused game like any other ask, and the alert stays the way back', () => {
    // A halt used to be the one undismissible slot, because it opened itself and
    // Escape would have left a stopped game with nothing on screen to continue
    // it with. On a keyboard nothing opens itself and the alert is always on the
    // strip, so the narrowing has nothing left to protect: the one move in a beat
    // is one press away in exactly the way twelve legal moves are. The test below
    // is the other input, where the shortcut that makes the press optional is not
    // there to be pressed.
    pauseShut();
    noFlyout();
    click(alertButton());
    const box = screen.getByRole('region', { name: ASK_FLYOUT_LABEL });
    expect(within(box).getByRole('button', { name: CONTINUE_LABEL })).toBeDefined();
    fireEvent.keyDown(disclosure(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: ASK_FLYOUT_LABEL })).toBeNull();
    click(alertButton());
    expect(
      within(screen.getByRole('region', { name: ASK_FLYOUT_LABEL })).getByRole('button', {
        name: CONTINUE_LABEL,
      }),
    ).toBeDefined();
  });

  it('draws a paused game for a finger without waiting to be asked', () => {
    // The playtester, 2026-08-22, playing sideways on a phone: "There should be an
    // easy way to continue passing priority since pressing space isn't an option
    // on mobile easily." A halt has one move in it, `passIndex` finds no pass in
    // a pause so the fixed button is drawn disabled, and the board under the box
    // is stopped. On a keyboard `pass-key.ts` binds space to this same Continue,
    // which is why the arm above still waits for the press.
    withCoarsePointer(() => {
      pauseShut();
      const box = screen.getByRole('region', { name: ASK_FLYOUT_LABEL });
      const go = within(box).getByRole('button', { name: CONTINUE_LABEL });
      expect(attr(go, 'disabled'), 'the one move in the beat is disabled').toBeNull();
      // The fixed pass is the control she would have reached for first, and it
      // is dead here, which is the whole reason this one is drawn.
      expect(attr(screen.getByRole('button', { name: PASS_LABEL }), 'disabled')).not.toBeNull();
      // Still a stance and not a command: the alert puts it away and brings it
      // back, exactly as it does on the other arm.
      expect(attr(alertButton(), 'aria-expanded')).toBe('true');
      click(alertButton());
      noFlyout();
      click(alertButton());
      expect(screen.getByRole('region', { name: ASK_FLYOUT_LABEL })).toBeDefined();
    });
  });

  it('leaves an ordinary priority window shut for a finger too', () => {
    // The pointer opens the halt and nothing else. A live board with a set of
    // moves on it is the always-up menu she objected to on 2026-08-20, and it is
    // just as unwelcome on a phone, where the board is smallest.
    withCoarsePointer(() => {
      shutTable(sessionOn(combatState()));
      noFlyout();
      expect(attr(alertButton(), 'aria-expanded')).toBe('false');
    });
  });
});

describe('the fixed pass is where it always was', () => {
  it('is on the strip in both states, and outside the list in both', () => {
    openTable(sessionOn(combatState()));
    const whenOpen = screen.getByRole('button', { name: PASS_LABEL });
    expect(nodeOf(whenOpen).closest('.mtg-choices')).toBeNull();
    expect(nodeOf(whenOpen).closest('.mtg-ask-flyout'), 'the pass moved into the flyout').toBeNull();
    click(disclosure());
    const whenShut = screen.getByRole('button', { name: PASS_LABEL });
    expect(nodeOf(whenShut).closest('.mtg-choices')).toBeNull();
    expect(nodeOf(whenShut).closest('.mtg-ask-flyout'), 'the pass moved into the flyout').toBeNull();
    expect(nodeOf(whenShut).closest('.mtg-board__pods')).not.toBeNull();
  });
});

describe('a whole combat, played with the column shut', () => {
  /*
   * One walk rather than two, and the per-stop assertions ride along inside it.
   * Each pass through this loop is a full jsdom render of the table, so a second
   * walk was a second 1.3 seconds against the unit project's 5-second default
   * for a claim the first loop was already standing in front of.
   */
  it('answers every stop from begin combat to end of combat without opening it', () => {
    const stops: Stop[] = [];
    shutTable(sessionOn(combatState()), stops);
    let orders = 0;

    for (let moveNumber = 0; moveNumber < 60; moveNumber += 1) {
      const at = stops.at(-1);
      if (at === undefined || at.step === 'postcombatMain') break;
      // The strip is what says a question is owed now that the panel is absent
      // until it is asked for, so the strip is what this loop reads to know
      // whether there is still a combat to walk.
      if (nodeOf(container).querySelector('.mtg-ask-alert__button') === null) break;

      // Every stop says what is owed on the strip and draws its ask over the
      // board on a press, and the answer is then a press on something the flyout
      // or the strip is showing. The press is the point: the panel is absent at
      // every stop until this line asks for it.
      noFlyout();
      showFlyout();
      if (screen.queryByRole('group', { name: LEGAL_MOVES_LABEL }) === null) break;
      expect(nodeOf(moves()).closest('.mtg-ask-flyout'), `${at.step} drew no flyout`).not.toBeNull();
      expect(attr(alertButton(), 'aria-label'), `${at.step} said nothing on the strip`).not.toBeNull();

      if (at.kind === 'declareAttackers') {
        const roster = screen.getByRole('group', { name: declarationWords('declareAttackers').roster });
        expect(
          nodeOf(roster).closest('.mtg-ask-flyout'),
          'the attackers roster is off screen',
        ).not.toBeNull();
      }
      if (at.kind === 'orderBlockers') {
        // The decision the shut column handled worst: CR 509.2 enumerates no
        // pass, so `passIndex` is null and the fixed button is drawn disabled.
        // Before this bead the strip's only other control was the disclosure.
        orders += 1;
        const rows = all('.mtg-declare__row');
        expect(rows.length, 'the order drew no blockers to place').toBeGreaterThan(1);
        for (const row of rows) {
          expect(nodeOf(row).closest('.mtg-ask-flyout'), 'a blocker row is off screen').not.toBeNull();
        }
        expect(attr(screen.getByRole('button', { name: PASS_LABEL }), 'disabled')).not.toBeNull();
      }

      pressBoldestMove();
    }

    // The column was never opened. Asserted rather than assumed, because a
    // driver that pressed the disclosure would make the whole test vacuous.
    expect(attr(disclosure(), 'aria-expanded')).toBe('false');
    expect(orders, 'the walk never reached a damage assignment order').toBeGreaterThan(0);

    // And the walk really did go through a combat, rather than falling out of
    // one at the first stop and passing by having reached nothing.
    const visited = stops.map((stop) => `${stop.step}/${stop.kind}`);
    for (const wanted of [
      'beginCombat/priority',
      'declareAttackers/declareAttackers',
      'declareBlockers/declareBlockers',
      'declareBlockers/orderBlockers',
      'firstStrikeDamage/priority',
      'combatDamage/priority',
      'endCombat/priority',
    ]) {
      expect(visited, `the walk never reached ${wanted}`).toContain(wanted);
    }
  });
});

describe('the opening hand arrives without a press', () => {
  /**
   * A real deal rather than a scenario, because the mulligan is a position no
   * `scenario` spec reaches: it is what `createSession` stops at before the
   * first turn, and the whole claim here is about that stop.
   */
  function openingSession(): GameSession {
    const game = dealMirrorGame(EXAMPLE_CARDS, { youName: SEATS[0], opponentName: SEATS[1] });
    const session = createSession(game.config.setup, game.config.seats, OPTIONS);
    if (session.pending?.kind !== 'mulligan') throw new Error('the deal did not stop at the opening hand');
    return session;
  }

  function moveLabels(): readonly string[] {
    return moveButtons().map((node) => attr(node, 'aria-label') ?? textOf(node));
  }

  it('draws keep and mulligan over an empty board with nothing pressed', () => {
    const session = openingSession();
    const decision = session.pending;
    if (decision === null) throw new Error('the deal left nobody to ask');
    // The two labels are read off the enumeration rather than typed, so this
    // asserts what the kernel offered instead of what a test author remembered.
    const prompt = buildPrompt(session.state, decision, SEATS);
    expect(prompt.choices.map((choice) => choice.kind).toSorted()).toEqual(['keepHand', 'mulligan']);

    shutTable(session);
    // No `showFlyout()`. That is the test: every other ask in this file needs
    // that line and this one must not.
    expect(nodeOf(moves()).closest('.mtg-ask-flyout'), 'the opening hand waited for a press').not.toBeNull();
    const said = moveLabels().join(' | ');
    for (const choice of prompt.choices) {
      expect(said, `the flyout drew no ${choice.kind}`).toContain(choice.label);
    }
    // And the strip agrees with the box, which is what makes the alert a
    // disclosure rather than a second control saying something else.
    expect(attr(alertButton(), 'aria-expanded')).toBe('true');
  });

  it('still closes on a press and on Escape, and the alert is still the way back', () => {
    shutTable(openingSession());
    // Opening itself is a stance, not a command: it says where the toggle starts
    // from. A box that could not be put away would be the always-up menu.
    click(alertButton());
    noFlyout();
    showFlyout();
    escape();
    noFlyout();
    expect(attr(alertButton(), 'aria-expanded')).toBe('false');
    showFlyout();
    expect(flyout()).toBeDefined();
  });

  it('leaves the priority that follows the keep shut, like every other ask', () => {
    const stops: Stop[] = [];
    const session = openingSession();
    const decision = session.pending;
    if (decision === null) throw new Error('the deal left nobody to ask');
    const kept = buildPrompt(session.state, decision, SEATS).choices.find(
      (choice) => choice.kind === 'keepHand',
    );
    if (kept === undefined) throw new Error('the opening hand offered no keep');
    shutTable(session, stops);
    const keep = moveButtons().find((node) =>
      (attr(node, 'aria-label') ?? textOf(node)).includes(kept.label),
    );
    if (keep === undefined) throw new Error('the flyout drew no keep');
    click(keep);
    expect(stops.length, 'the game did not move on').toBeGreaterThan(1);
    expect(stops.at(-1)?.kind, 'the game is still at the opening hand').not.toBe('mulligan');
    // The narrowing is one decision kind wide. A rule written on the size of the
    // enumeration would fire here too, over a board that is now being played.
    noFlyout();
    expect(attr(alertButton(), 'aria-expanded')).toBe('false');
  });

  it('is drawn in the column, not over the board, when the column is open', () => {
    openTable(openingSession());
    noFlyout();
    expect(nodeOf(moves()).closest('.mtg-board__pods'), 'the panel left the open column').not.toBeNull();
    expect(nodeOf(container).querySelector('.mtg-ask-alert')).toBeNull();
  });
});
