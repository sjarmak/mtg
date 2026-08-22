// @vitest-environment jsdom
/**
 * Panels, the focus ring, and the keystroke that stopped working.
 *
 * Two bugs found in a browser on the flagship set on 2026-08-13, filed apart
 * and fixed together because they are one cause: this route opens panels over
 * the board and had no rule about where the focus ring goes afterwards.
 *
 * **`mtg-s9p`** — "Space stops passing priority after any panel header click,
 * with no feedback." Measured there: after clicking the "your graveyard" header,
 * five consecutive Space presses left "choices made" at 58 and the panel toggled
 * open and shut five times. `document.activeElement` was that header. The three
 * disclosures on this route — the graveyard browser, the game log and the turn
 * badge — are all buttons, and `pass-key.ts` refuses to fire from inside a
 * control because the browser already activates a focused button on both keys.
 * That refusal is right; the ring being parked on a control nobody was using is
 * the bug, so a *pointer* press hands it back to the table and a keyboard press
 * does not. The two halves are asserted separately below, because a fix that
 * took the ring off a keyboard user would be a worse bug than the one it closed.
 *
 * The second half of that bead is that a shortcut which cannot fire should not
 * fail silently, and after the focus fix exactly one such press is left: a
 * decision the kernel enumerated no pass for. It now says so where the pass is.
 *
 * **`mtg-5jl`** — "The turn-stops panel never closes and covers the opponent's
 * status row." It had two exits already, and the bead is right that neither was
 * reachable: the badge is a toggle that reads as a status label, and the Escape
 * handler was on the disclosure's own element, so it stopped receiving the key
 * the moment the player clicked the board. What is asserted here is the exits —
 * a labeled close control, Escape from anywhere, and a press outside — plus
 * where the ring lands after each. That the panel covers the opponent's status
 * row is a geometric claim jsdom cannot check, because jsdom performs no layout;
 * `../../tools/turn-stops-panel.ts` is that measurement.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_CARDS, basicLand, parseCard } from '@mtg/dsl';
import type { Choice, GameSession, GameState } from '@mtg/kernel';
import {
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  humanSeat,
  passIndex,
  pendingDecision,
  scenario,
} from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { NO_PASS_NOTE } from '../../src/routes/play/pass-key';
import { PASS_KEY_STATUS_LABEL, PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';
import { TURN_STOPS_CLOSE_LABEL } from '../../src/routes/play/TurnStops';

afterEach(cleanup);

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

/**
 * A priority with something in the viewer's graveyard.
 *
 * The graveyard browser draws a plain `div` for an empty zone and a `button`
 * only when there is something to open, so the control this bead is about does
 * not exist on a freshly dealt table. One card in it is the whole fixture.
 */
function graveyardState(): GameState {
  return scenario({
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[BOLT], []],
    graveyards: [[BOLT], []],
  }).state;
}

function sessionAt(state: GameState): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events: [],
    result: null,
    beat: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    committed: null,
  };
}

/** The opening mulligan, which is the position with no pass in its enumeration. */
function mulliganSession(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  return createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
}

/**
 * The whole strip, because the turn badge is a disclosure only for a caller that
 * owns the settings; without them the toolbar draws a plain span.
 */
function renderTable(session: GameSession, onChoose: (choice: Choice) => void): ReturnType<typeof render> {
  return render(
    h(PlayView, {
      session,
      viewer: 0,
      names: NAMES,
      onChoose,
      autoPass: DEFAULT_AUTO_PASS,
      onAutoPass: () => undefined,
      onYield: () => undefined,
    }),
  );
}

/** The DOM reads this file needs, cast structurally: no `lib: dom` here. */
function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function focus(node: unknown): void {
  (node as { focus(): void }).focus();
}

/** Whatever holds the focus ring, reached the way `focus.ts` reaches it. */
function activeElement(): unknown {
  const host = globalThis as { readonly document?: { readonly activeElement?: unknown } };
  return host.document?.activeElement ?? null;
}

function documentBody(): Parameters<typeof fireEvent.keyDown>[0] {
  const host = globalThis as { readonly document?: { readonly body?: unknown } };
  const body = host.document?.body;
  if (typeof body !== 'object' || body === null) throw new Error('expected a jsdom document');
  return body as Parameters<typeof fireEvent.keyDown>[0];
}

function query(container: unknown, selector: string): unknown {
  return (container as { querySelector(selector: string): unknown }).querySelector(selector);
}

/** The turn indicator, found by the sentence it draws. */
function turnHead(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('button', { name: /^Turn \d/ });
}

/** The panel's own live region, which is empty until the key has something to say. */
function keyNote(): string {
  return textOf(screen.getByRole('status', { name: PASS_KEY_STATUS_LABEL }));
}

/**
 * A pointer press, which is the gesture the bug was reported from.
 *
 * `detail` is the click count, and it is what separates the two presses this
 * route now treats differently: a click synthesized from Enter or Space on a
 * focused button carries `detail === 0` in every browser, and a real one does
 * not. `fireEvent.click` defaults to 0, so a test that means the mouse has to
 * say so.
 */
function pointerClick(node: unknown): void {
  fireEvent.click(node as Parameters<typeof fireEvent.click>[0], { detail: 1 });
}

describe('a panel header does not swallow the pass key', () => {
  it('hands the ring back to the table after a pointer press on the graveyard header', () => {
    const session = sessionAt(graveyardState());
    const decision = session.pending;
    if (decision === null) throw new Error('the fixture settled to a finished game');
    const onChoose = vi.fn();
    const { container } = renderTable(session, onChoose);

    // The browser puts the ring on a button it is clicked on, which is the whole
    // of how the bug arose: the player was reading, not navigating.
    const head = screen.getByRole('button', { name: /^your graveyard/ });
    focus(head);
    pointerClick(head);

    expect(attr(head, 'aria-expanded'), 'the press no longer opens the panel').toBe('true');
    expect(activeElement(), 'the ring was left on the header').toBe(query(container, '.mtg-play'));

    fireEvent.keyDown(activeElement() as Parameters<typeof fireEvent.keyDown>[0], { key: ' ' });
    expect(onChoose.mock.calls).toEqual([[passIndex(decision)]]);
  });

  it('does the same for the game log, which is a button whether or not it has entries', () => {
    const session = sessionAt(graveyardState());
    const decision = session.pending;
    if (decision === null) throw new Error('the fixture settled to a finished game');
    const onChoose = vi.fn();
    const { container } = renderTable(session, onChoose);

    const head = screen.getByRole('button', { name: /^Game log/ });
    focus(head);
    pointerClick(head);

    expect(activeElement()).toBe(query(container, '.mtg-play'));
    fireEvent.keyDown(activeElement() as Parameters<typeof fireEvent.keyDown>[0], { key: ' ' });
    expect(onChoose.mock.calls).toEqual([[passIndex(decision)]]);
  });

  it('does the same for the turn badge, which is the third disclosure', () => {
    const session = sessionAt(graveyardState());
    const onChoose = vi.fn();
    const { container } = renderTable(session, onChoose);

    focus(turnHead());
    pointerClick(turnHead());

    expect(attr(turnHead(), 'aria-expanded')).toBe('true');
    expect(activeElement()).toBe(query(container, '.mtg-play'));
  });

  it('leaves the ring on the header when the press came from the keyboard', () => {
    const session = sessionAt(graveyardState());
    const onChoose = vi.fn();
    renderTable(session, onChoose);

    // A click with no click count is one the browser synthesized from Enter or
    // Space on a focused control. That player is reading with the keyboard and
    // needs the ring where they put it; taking it away would leave them unable
    // to reach what they just opened.
    const head = screen.getByRole('button', { name: /^your graveyard/ });
    focus(head);
    fireEvent.click(head);

    expect(attr(head, 'aria-expanded')).toBe('true');
    expect(activeElement()).toBe(head);
    // And the key still belongs to the control it is sitting on, so one press
    // stays one action.
    fireEvent.keyDown(head, { key: ' ' });
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('leaves a pointer press on an ordinary control alone', () => {
    const session = sessionAt(graveyardState());
    const onChoose = vi.fn();
    const { container } = renderTable(session, onChoose);
    pointerClick(turnHead());

    const control = screen.getByRole('button', { name: 'Full control' });
    focus(control);
    pointerClick(control);

    // Nothing here is a disclosure, so nothing about the ring changes: a player
    // pressing settings in a row of settings is exactly where they mean to be.
    expect(activeElement()).toBe(control);
    expect(activeElement()).not.toBe(query(container, '.mtg-play'));
  });
});

describe('a pass key with no pass to take', () => {
  it('says so where the pass is, rather than doing nothing', () => {
    const session = mulliganSession();
    expect(session.pending?.kind, 'the fixture is not on the opening mulligan').toBe('mulligan');
    const onChoose = vi.fn();
    renderTable(session, onChoose);
    expect(keyNote(), 'the note is drawn before anybody pressed anything').toBe('');

    fireEvent.keyDown(documentBody(), { key: ' ' });

    expect(onChoose, 'a decision with no pass submitted one').not.toHaveBeenCalled();
    expect(keyNote()).toBe(NO_PASS_NOTE);
    // It names the list the moves are in, which is the half a player can act on.
    expect(keyNote()).toContain('Legal moves');
  });

  it('drops the note when the game moves to a decision that has a pass', () => {
    const session = mulliganSession();
    const { rerender } = renderTable(session, () => undefined);
    fireEvent.keyDown(documentBody(), { key: ' ' });
    expect(keyNote()).toBe(NO_PASS_NOTE);

    const kept = choose(session, 0, { autoPass: DEFAULT_AUTO_PASS });
    expect(kept.decisions).toBeGreaterThan(session.decisions);
    rerender(
      h(PlayView, {
        session: kept,
        viewer: 0,
        names: NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    );

    expect(keyNote(), 'a note outlived the decision it was about').toBe('');
  });
});

describe('the turn-stops panel can be dismissed', () => {
  function open(): void {
    if (attr(turnHead(), 'aria-expanded') === 'false') pointerClick(turnHead());
    expect(attr(turnHead(), 'aria-expanded')).toBe('true');
  }

  function isOpen(): boolean {
    return attr(turnHead(), 'aria-expanded') === 'true';
  }

  it('carries a close control the eye can find, and hands the ring back to the badge', () => {
    renderTable(sessionAt(graveyardState()), vi.fn());
    open();

    const close = screen.getByRole('button', { name: TURN_STOPS_CLOSE_LABEL });
    // The accessible name says what is being closed and still contains the word
    // it draws, so a speech user can ask for what they can see.
    expect(textOf(close)).toBe('Close');
    expect(TURN_STOPS_CLOSE_LABEL).toContain('Close');

    fireEvent.click(close);
    expect(isOpen()).toBe(false);
    expect(activeElement(), 'the ring fell to the body when the panel left').toBe(turnHead());
  });

  it('closes on escape pressed from the board, not only from inside itself', () => {
    const { container } = renderTable(sessionAt(graveyardState()), vi.fn());
    open();
    // What the bead did next: click the board, which is where the panel is in
    // the way. The old handler was on the disclosure's own element, so from here
    // the key never reached it.
    focus(query(container, '.mtg-play'));

    fireEvent.keyDown(documentBody(), { key: 'Escape' });

    expect(isOpen()).toBe(false);
    expect(activeElement()).toBe(turnHead());
  });

  it('closes on a pointer press outside it, and does not chase the ring', () => {
    const { container } = renderTable(sessionAt(graveyardState()), vi.fn());
    open();
    const board = query(container, '.mtg-board');
    expect(board).not.toBeNull();

    fireEvent.pointerDown(board as Parameters<typeof fireEvent.pointerDown>[0]);

    expect(isOpen()).toBe(false);
    // The press is on its way to whatever it landed on. Pulling the ring back to
    // the badge mid-gesture would fight the click that follows it.
    expect(activeElement()).not.toBe(turnHead());
  });

  it('stays open for a press on its own controls', () => {
    renderTable(sessionAt(graveyardState()), vi.fn());
    open();
    const control = screen.getByRole('button', { name: 'Full control' });

    fireEvent.pointerDown(control);
    fireEvent.click(control, { detail: 1 });

    expect(isOpen(), 'setting a stop closed the panel it was set from').toBe(true);
  });

  it('leaves the first escape to a picker open in front of it', () => {
    const { container } = renderTable(sessionAt(graveyardState()), vi.fn());
    open();
    // A castable card in hand opens the staged cast, which is the panel
    // `PlayView`'s own Escape handler answers for.
    const hand = screen.getByRole('region', { name: 'your hand' });
    const face = within(hand).getAllByRole('button', { pressed: false })[0];
    if (face === undefined) throw new Error('the fixture put no pressable card in hand');
    pointerClick(face);
    expect(query(container, '.mtg-cast'), 'the fixture opened no staged cast').not.toBeNull();

    // One press closes one thing. `dismiss.ts` listens on the document, which
    // React reaches only after the handler on `.mtg-play` has had the event and
    // stopped it, so the panel a player is looking at answers first.
    fireEvent.keyDown(face, { key: 'Escape' });
    expect(query(container, '.mtg-cast')).toBeNull();
    expect(isOpen(), 'the stops panel took an escape that was not aimed at it').toBe(true);

    fireEvent.keyDown(documentBody(), { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('stays open for a press on the badge, which has its own toggle to run', () => {
    renderTable(sessionAt(graveyardState()), vi.fn());
    open();

    // One gesture, one close. An outside rule that counted the opener as outside
    // would close the panel on the press and reopen it on the click.
    fireEvent.pointerDown(turnHead());
    pointerClick(turnHead());

    expect(isOpen()).toBe(false);
  });
});
