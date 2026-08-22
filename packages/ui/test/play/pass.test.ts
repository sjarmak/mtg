// @vitest-environment jsdom
/**
 * The pass, in one place.
 *
 * The playtester, 2026-08-13, after playing the lab: "the 'pass' button should always
 * be in the same spot maybe in the upper right area of your hand or something".
 * It was one option among the enumerated ones, so it moved down the rail as the
 * option list grew and shrank, and a move you make on most priorities of most
 * turns is the worst one to have to hunt for.
 *
 * What is asserted here is the coupling rather than the pixel. The fixed button
 * is not a shortcut the surface invented: it submits an index the kernel put in
 * `decision.options`, it is the index `passIndex` finds and the callback the
 * pass key already runs, and on a decision the kernel enumerated no pass for it
 * is drawn disabled rather than dropped — a control whose whole promise is that
 * it stays put cannot leave the screen when the answer is no.
 *
 * # The list entry is gone, and this file used to argue for it
 *
 * It did, at length, on 2026-08-13: the rail is the complete enumeration, a
 * fourth door onto one index is the pattern the surface already runs on, and
 * deleting the entry would leave a priority whose only legal move is the pass
 * drawing an empty list. the playtester played the lab on 2026-08-20, saw the entry
 * beside the fixed button, and ruled the other way: "it's kind of like pass
 * though since you're allowing certain things to happen like passing through
 * combat it's just odd for that to show up as a separate pass button", and then
 * "get rid of the list entry".
 *
 * She is describing what the argument above did not weigh. Two controls that
 * take the same index are only one option to a reader who already knows they are
 * one option; to a player they are two buttons, and a fixed control's whole
 * promise is that there is one of it. Every prediction in the old argument still
 * holds and each has an answer now: the enumeration is complete over the
 * *column* rather than over the list (`../../src/routes/play/rail.ts`'s contract
 * bullet 2), the pass keeps its own index and its own key, and the empty list is
 * a stated sentence rather than a blank box (`ONLY_PASS_NOTE`).
 *
 * The wording went with the entry. The fixed button says `Pass` whatever the
 * stack holds; the contextual `Let it resolve` now lives only on the stack
 * object itself (`../../src/board/StackZone.ts`), which is a control about that
 * object and has room to say so. A fixed control whose word changes under the
 * cursor is half of the thing being fixed here.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Choice, GameSession } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS, passIndex } from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { LEGAL_MOVES_LABEL, PASS_LABEL, PlayView } from '../../src/routes/play/PlayView';

afterEach(cleanup);

const NAMES = ['You', 'Bot'] as const;

function dealt(): ReturnType<typeof dealMirrorGame> {
  return dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
}

/** The position the surface opens on: CR 103.4's mulligan, which has no pass. */
function openingSession(): GameSession {
  const game = dealt();
  return createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
}

/** The same position with the opening hand kept, which is a priority. */
function prioritySession(): GameSession {
  const opened = openingSession();
  return opened.pending?.kind === 'mulligan' ? choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS }) : opened;
}

/** The two node reads this file needs, cast structurally: no `lib: dom` here. */
function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function closest(node: unknown, selector: string): unknown {
  return (node as { closest(selector: string): unknown }).closest(selector);
}

/**
 * The fixed button, found by role and then narrowed to its own home.
 *
 * The narrowing is kept now that the list entry is gone, and the assertion under
 * it — exactly one — is what makes this helper the guard against the entry
 * coming back. The stack object's own resolve press carries a different name
 * (`../../src/board/StackZone.ts`), so it is not what this would catch.
 */
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

function renderAt(session: GameSession, onChoose: (choice: Choice) => void): void {
  render(h(PlayView, { session, viewer: 0, names: NAMES, onChoose }));
}

describe('the fixed pass button', () => {
  it('has a home of its own, outside the list that changes size', () => {
    renderAt(prioritySession(), () => undefined);
    const button = passButton();
    expect(closest(button, '.mtg-choices'), 'the fixed pass is inside the move list').toBeNull();
    // Under the table rather than in the rail: the rail is the column whose
    // contents move, which is the whole complaint.
    expect(closest(button, '.mtg-board__rail')).toBeNull();
    expect(closest(button, '.mtg-play__table')).not.toBeNull();
  });

  it('submits the index the kernel enumerated, not one the surface built', () => {
    const session = prioritySession();
    const decision = session.pending;
    if (decision === null) throw new Error('the fixture settled to a finished game');
    const wanted = passIndex(decision);
    expect(wanted, 'the fixture is not on a priority').not.toBeNull();
    const submitted: Choice[] = [];
    renderAt(session, (index) => submitted.push(index));

    fireEvent.click(passButton());

    expect(submitted).toEqual([wanted]);
  });

  it('is drawn disabled, in the same spot, when the kernel offered no pass', () => {
    const session = openingSession();
    expect(session.pending?.kind).toBe('mulligan');
    const submitted: Choice[] = [];
    renderAt(session, (index) => submitted.push(index));

    const button = passButton();
    expect(attr(button, 'disabled'), 'a pass is offered on the opening hand').not.toBeNull();
    fireEvent.click(button);
    expect(submitted, 'a disabled pass submitted a choice').toEqual([]);
  });

  it('is the only pass on the surface: the list draws every other move and not this one', () => {
    const session = prioritySession();
    const decision = session.pending;
    if (decision === null) throw new Error('the fixture settled to a finished game');
    const wanted = passIndex(decision);
    expect(wanted, 'the fixture is not on a priority').not.toBeNull();
    renderAt(session, () => undefined);

    const rail = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    expect(
      within(rail).queryByRole('button', { name: PASS_LABEL }),
      'the list drew a pass entry beside the fixed button',
    ).toBeNull();
    // And it dropped exactly one move, so nothing else left the list with it.
    expect(within(rail).getAllByRole('button')).toHaveLength(decision.options.length - 1);
  });
});
