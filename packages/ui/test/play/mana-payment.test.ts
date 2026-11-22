// @vitest-environment jsdom
/**
 * Mana as a thing a player does, rather than a thing that happens to them.
 *
 * `mtg-bz2.8` asks for three properties at once: a cost with more than one legal
 * payment presents the choice, auto-pay is optional and overridable, and the
 * pool is inspectable at any time. All three were already true of this surface
 * when the bead was read, and none of them was asserted anywhere — the rail's
 * `Mana` group had a heading in `GROUP_ORDER` and no test, and `poolPips` had
 * two callers and no test that a pool ever reached one.
 *
 * **The shape of the answer matters more than the fact of it.** This lab does
 * not present payment as a dialog over a cost. It presents it the way MTGO does:
 * every untapped source is a legal move in its own right, floating one puts a
 * pip in the pool where both seats can see it, and a cast spends what is
 * floating before it reaches for a land. That makes the override a *move made
 * earlier* rather than a checkbox, so what has to be proved is that making it
 * changes the outcome — that the land the player turned is the land that pays,
 * and the one they left alone stays untapped.
 *
 * Measured on this board, a Plains and an Island paying one generic mana:
 *
 * ```
 * autopay   pool {}      Plains=true  Island=false
 * floated   pool {U:1}   Plains=false Island=true
 * override  pool {}      Plains=false Island=true
 * ```
 *
 * The middle row is the pool being inspectable and the third is the override
 * landing: auto-pay reaches for the Plains, and a player who floats `{U}` first
 * keeps it. Nothing here asserts pixels — the tapped mark is `data-tapped` on
 * the slot, whose winning declaration `tapped-slot.test.ts` owns.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { Action, GameState, ObjectId, SessionView } from '@mtg/kernel';
import { legalActions, pendingDecision, playerOf, reduce, scenario } from '@mtg/kernel';
import type { BoardSeat } from '../../src/board/Board';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];

const PLAINS = basicLand('Plains', 'TST', 250);
const ISLAND = basicLand('Island', 'TST', 251);

/**
 * One generic mana, which is the whole reason this board has a payment choice:
 * a `{W}` would name its land and leave nothing to decide.
 */
const BOLT: Card = parseCard({
  kind: 'sorcery',
  id: 'tst-testing-bolt',
  name: 'Testing Bolt',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 9 },
  manaCost: { generic: 1 },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayer' } }],
});

function opening(): GameState {
  return scenario({
    seed: 'mana-payment/bz2.8',
    battlefield: [
      { card: PLAINS, controller: 0 },
      { card: ISLAND, controller: 0 },
    ],
    hands: [[BOLT], []],
  }).state;
}

function oidOf(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`${name} is not on the battlefield`);
  return found;
}

/** The one cast this board affords, aimed at the other seat. */
function castBolt(state: GameState): Action {
  const spell = playerOf(state, 0).hand[0];
  if (spell === undefined) throw new Error('the hand is empty');
  return { type: 'castSpell', player: 0, oid: spell, targets: [{ kind: 'player', player: 1 }] };
}

/** Tap a named land for a named color, as the rail's own move would. */
function float(state: GameState, land: string, color: 'W' | 'U'): GameState {
  return reduce(state, { type: 'activateManaAbility', player: 0, oid: oidOf(state, land), color }).state;
}

function sessionFor(state: GameState): SessionView {
  return { state, events: [], result: null, pending: pendingDecision(state), choices: [], decisions: 0 };
}

/**
 * The workspace tsconfig carries no `lib: dom`, so a found node has no members
 * here and the ones this file reads are declared rather than imported.
 */
interface NodeLike {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): NodeLike | null;
  querySelectorAll(selector: string): ArrayLike<NodeLike>;
}

function draw(state: GameState): NodeLike {
  const { container } = render(
    h(PlayView, { session: sessionFor(state), viewer: 0 as const, names: NAMES, onChoose: () => undefined }),
  );
  return container as unknown as NodeLike;
}

/** Whether each named land is drawn turned, read off the slot it was dealt. */
function tapMarks(page: NodeLike, state: GameState): Readonly<Record<string, string | null>> {
  const marks: Record<string, string | null> = {};
  for (const name of ['Plains', 'Island']) {
    const slot = page.querySelector(`.mtg-slot[data-permanent-key='${String(oidOf(state, name))}']`);
    if (slot === null) throw new Error(`${name} is on the battlefield and drew no slot`);
    marks[name] = slot.getAttribute('data-tapped');
  }
  return marks;
}

/** The accessible name of a seat's floating pool, or null when it draws none. */
function poolLabel(page: NodeLike, seat: BoardSeat): string | null {
  const pips = page.querySelector(`.mtg-pod[data-seat='${seat}'] .mtg-status__mana`);
  return pips === null ? null : pips.getAttribute('aria-label');
}

/**
 * The rail's mana moves, read off the buttons' words.
 *
 * Their words rather than their `aria-label`: `choice-button.ts` puts the
 * sentence on the label only when the visible text is folded, and a mana move is
 * short enough that it never is, so the label is null and the name a query would
 * match is the text itself.
 */
function manaMoves(): readonly string[] {
  const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
  return within(group)
    .queryAllByRole('button')
    .map((node) => (node as unknown as NodeLike).textContent ?? '')
    .filter((name) => name.startsWith('Tap '));
}

describe('the payment choice, as the rail presents it', () => {
  it('offers every source that could pay, one move each, under Mana', () => {
    draw(opening());
    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    expect(within(group).getByText('Mana')).toBeDefined();
    // Two lands, two colors, one generic mana to pay: the kernel's two options
    // are the two payments, and the rail draws both rather than picking one.
    expect(manaMoves()).toEqual(['Tap Plains for W', 'Tap Island for U']);
  });

  it('stops offering a source once it has turned', () => {
    const floated = float(opening(), 'Island', 'U');
    draw(floated);
    expect(manaMoves()).toEqual(['Tap Plains for W']);
    expect(legalActions(floated).filter((action) => action.type === 'activateManaAbility')).toHaveLength(1);
  });
});

describe('the pool, while it holds something and after it does not', () => {
  it('draws nothing on an empty pool', () => {
    expect(poolLabel(draw(opening()), 'you')).toBeNull();
  });

  it('draws a pip per floating mana, on the seat that floated it', () => {
    const floated = float(opening(), 'Island', 'U');
    const page = draw(floated);
    expect(poolLabel(page, 'you')).toBe('Mana pool: 1 floating');
    expect(poolLabel(page, 'opponent'), 'the other seat floated nothing and drew a pool anyway').toBeNull();
  });

  it('empties as the cast spends it', () => {
    const floated = float(opening(), 'Island', 'U');
    expect(poolLabel(draw(reduce(floated, castBolt(floated)).state), 'you')).toBeNull();
  });
});

describe('auto-pay, and the float that overrides it', () => {
  it('turns a land of its own choosing when the player floats nothing', () => {
    const start = opening();
    const paid = reduce(start, castBolt(start)).state;
    expect(tapMarks(draw(paid), paid)).toEqual({ Plains: 'true', Island: 'false' });
  });

  it('spends what is floating instead, and leaves the other land alone', () => {
    const floated = float(opening(), 'Island', 'U');
    // The whole of the override: auto-pay reaches for the Plains on this board,
    // and the player who floated `{U}` first still has it untapped afterwards.
    expect(tapMarks(draw(floated), floated)).toEqual({ Plains: 'false', Island: 'true' });
    cleanup();
    const paid = reduce(floated, castBolt(floated)).state;
    expect(tapMarks(draw(paid), paid)).toEqual({ Plains: 'false', Island: 'true' });
    expect(playerOf(paid, 0).pool.U).toBe(0);
  });
});
