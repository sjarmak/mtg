// @vitest-environment jsdom
/**
 * `mtg-5t05`: the board's staged attack and the ask column's roster used to be
 * two independent pieces of view state for the same declaration —
 * `combat.ts`'s `useAttackStaging` held its own `useState` set, written by a
 * click on a creature's face, while `selection.ts`'s `DeclarationControl` held
 * a separate `Assignment`, written by pressing a roster row. Clicking a
 * creature moved the band ("Attack with 1") without moving the roster ("not
 * attacking"), and each surface's confirm submitted its own idea of what was
 * staged.
 *
 * This drives both input paths against one board and asserts they agree at
 * every step, in both directions.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { botSeat, humanSeat, pendingDecision, scenario, simpleAgent } from '@mtg/kernel';
import type { SeatNames } from '../../src/routes/play/position';
import { PlayView } from '../../src/routes/play/PlayView';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0 as PlayerId;
const BRUISER = exampleCard('slc-ironclad-golem');

/** Three untapped creatures, none of it past the enumeration cap. */
function board(): GameState {
  return scenario({
    seed: 'ui/attack-staging-sync',
    battlefield: Array.from({ length: 3 }, () => ({
      card: BRUISER,
      controller: 0 as PlayerId,
      summoningSick: false,
    })),
    step: 'declareAttackers',
    active: 0,
    turn: 8,
  }).state;
}

function seated(state: GameState): GameSession {
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the scenario left nobody to ask');
  return {
    seats: [humanSeat('You'), botSeat(simpleAgent('Bot'))],
    state,
    events: [],
    result: null,
    pending: decision,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

interface NodeLike {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly querySelectorAll: (selector: string) => ArrayLike<NodeLike> & Iterable<NodeLike>;
}

function bodyNode(): NodeLike {
  const doc = (globalThis as { document?: { body?: NodeLike } }).document;
  const body = doc?.body;
  if (body === undefined) throw new Error('this test needs a jsdom window');
  return body;
}

function nodeOf(value: NodeLike | null, what: string): NodeLike {
  if (value === null) throw new Error(`expected ${what} in the document`);
  return value;
}

function faceFor(oid: ObjectId): NodeLike {
  return nodeOf(
    bodyNode().querySelector(`[data-permanent-key='${oid}'] button.mtg-card`),
    `a face for ${oid}`,
  );
}

function stagedFacesCount(): number {
  return bodyNode().querySelectorAll(".mtg-combat__entry[data-state='staged']").length;
}

function declaredRosterRows(): number {
  return bodyNode().querySelectorAll(".mtg-declare__row[data-declared='true']").length;
}

function confirmNode(): NodeLike {
  return nodeOf(bodyNode().querySelector(".mtg-combat__button[data-kind='confirm']"), 'a confirm');
}

describe('the board click and the ask-column roster stage one attack', () => {
  it('a click on a creature is reflected in the roster', () => {
    const session = seated(board());
    const oids = session.state.battlefield;
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));

    expect(declaredRosterRows(), 'nothing declared yet').toBe(0);
    expect(confirmNode().textContent).toBe('No attacks');

    const first = oids[0];
    if (first === undefined) throw new Error('no creature on this board');
    fireEvent.click(faceFor(first));

    // The board half moved.
    expect(stagedFacesCount(), 'the band staged the clicked creature').toBe(1);
    expect(confirmNode().textContent).toBe('Attack with 1');
    // The defect: the roster used to still read "not attacking" for every row
    // because it read a second, untouched Assignment.
    expect(declaredRosterRows(), 'the roster shows the same creature declared').toBe(1);
  });

  it('a roster press is reflected on the board', () => {
    const session = seated(board());
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose: vi.fn() }));

    const rows = bodyNode().querySelectorAll('.mtg-declare__row');
    const row = rows[1];
    if (row === undefined) throw new Error('the roster drew fewer rows than creatures');
    fireEvent.click(row);

    expect(declaredRosterRows(), 'the roster staged the pressed row').toBe(1);
    // The other direction of the same defect: the board's own staged set never
    // learned about a press that came from the roster.
    expect(stagedFacesCount(), 'the band shows the same creature staged').toBe(1);
    expect(confirmNode().textContent).toBe('Attack with 1');
  });

  it('confirming after a mix of board clicks and roster presses submits both', () => {
    const onChoose = vi.fn();
    const session = seated(board());
    const oids = session.state.battlefield;
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    const first = oids[0];
    const second = oids[1];
    if (first === undefined || second === undefined) throw new Error('need two creatures');
    fireEvent.click(faceFor(first));
    const rows = bodyNode().querySelectorAll('.mtg-declare__row');
    const secondRow = rows[1];
    if (secondRow === undefined) throw new Error('the roster drew fewer rows than creatures');
    fireEvent.click(secondRow);

    expect(stagedFacesCount()).toBe(2);
    expect(declaredRosterRows()).toBe(2);

    fireEvent.click(confirmNode());
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
