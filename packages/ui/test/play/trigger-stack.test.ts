// @vitest-environment jsdom
/**
 * A triggered ability as an object on the table, and the window to answer it.
 *
 * `mtg-bz2.10` asks for two things. A trigger must be a stack object a player
 * can respond to, and two simultaneous triggers under one controller must
 * present an ordering choice. The first is true of this surface and was asserted
 * nowhere end to end: `stack.test.ts` proves an ability entry is *named* as one,
 * but it hands `StackZone` a literal with `ability: true` on it, so nothing
 * checked that a trigger the kernel actually fires arrives as an entry, keeps
 * the name of the permanent that printed it after that permanent is in the
 * graveyard, and holds the game open while the other seat decides what to do.
 *
 * **The second is a kernel decision this lab does not have.**
 * `@mtg/kernel`'s `triggers.ts` orders simultaneous triggers by APNAP and then
 * deterministically within one controller, and says in as many words that
 * asking instead "is a fifth `AwaitKind` and a `Decision` variant, which is its
 * own bead". So what is assertable here is what the surface does with the order
 * it is given rather than a choice nobody is offered: both triggers are separate
 * objects, both are drawn, and the strip says which of them resolves next. That
 * is the half a player can act on today, and pinning it is what makes the
 * ordering choice a visible change to this file when it lands rather than a
 * silent one.
 *
 * Measured on one sweeper killing two 2/2 wardens under one controller:
 *
 * ```
 * stack=[Emberwash]                                  life 20
 * stack=[Grove Warden(ability) | Fen Warden(ability)] life 20
 * stack=[Grove Warden(ability)]                       life 23
 * stack=[]                                            life 25
 * ```
 *
 * Fen Warden's trigger is on top and resolves first, which is the order the
 * strip draws and the order the numbers say.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { Action, GameState, ObjectId, PlayerId, SessionView } from '@mtg/kernel';
import { pendingDecision, reduce, scenario } from '@mtg/kernel';
import { RESOLVES_NEXT, WAITING } from '../../src/board/StackZone';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];

/** A 2/2 that thanks you for dying. The life totals differ so the two are told apart. */
function warden(name: string, collectorNumber: number, life: number): Card {
  return parseCard({
    kind: 'creature',
    id: `xmp-${String(collectorNumber)}`,
    name,
    rarity: 'common',
    set: { code: 'XMP', collectorNumber },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'gainLife', amount: life, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

const GROVE = warden('Grove Warden', 60, 2);
const FEN = warden('Fen Warden', 61, 3);

/** Three damage to every creature, which kills both wardens in one resolution. */
const EMBERWASH: Card = parseCard({
  kind: 'sorcery',
  id: 'xmp-emberwash',
  name: 'Emberwash',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 62 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: 3,
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
});

/** What the other seat holds, so "can be responded to" is a move rather than a claim. */
const ARROW: Card = parseCard({
  kind: 'instant',
  id: 'xmp-shock-arrow',
  name: 'Shock Arrow',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 63 },
  manaCost: { R: 1 },
  colors: ['R'],
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
});

const MOUNTAIN = basicLand('Mountain', 'XMP', 250);

function opening(wardens: readonly Card[]): GameState {
  return scenario({
    seed: 'ui/trigger-stack',
    battlefield: [
      ...wardens.map((card) => ({ card, controller: 0 as const })),
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 1 },
    ],
    hands: [[EMBERWASH], [ARROW]],
  }).state;
}

function step(state: GameState, action: Action): GameState {
  return reduce(state, action).state;
}

/** Cast the sweeper and pass until the triggers are the whole stack. */
function afterTheSweep(wardens: readonly Card[]): GameState {
  const board = opening(wardens);
  const sweeper = board.players[0].hand[0];
  if (sweeper === undefined) throw new Error('no sweeper in hand');
  let state = step(board, { type: 'castSpell', player: 0, oid: sweeper, targets: [null] });
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(state, 512);
    if (decision === null) throw new Error('the game ended before the triggers fired');
    if (decision.kind !== 'priority') throw new Error(`unexpected ${decision.kind} stop`);
    if (state.stack.every((entry) => entry.ability !== null) && state.stack.length > 0) return state;
    state = step(state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the triggers never reached the stack');
}

function sessionFor(state: GameState): SessionView {
  return { state, events: [], result: null, pending: pendingDecision(state, 512), choices: [], decisions: 0 };
}

function draw(state: GameState, viewer: 0 | 1 = 0): void {
  render(h(PlayView, { session: sessionFor(state), viewer, names: NAMES, onChoose: () => undefined }));
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/** Every row of the stack strip, top of the stack first. */
function stackRows(): readonly string[] {
  return within(screen.getByLabelText('Stack'))
    .getAllByRole('listitem')
    .map((row) => textOf(row));
}

/**
 * The rail's moves, by accessible name.
 *
 * The label where there is one and the words otherwise: `choice-button.ts` moves
 * the sentence onto `aria-label` exactly when the visible text is folded, and a
 * cast aimed at a seat folds down to the seat's name alone. Reading the text
 * would therefore look for `Shock Arrow` on a button that says `Bot`.
 */
function moves(): readonly string[] {
  const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
  return within(group)
    .queryAllByRole('button')
    .map(
      (node) =>
        (node as unknown as { getAttribute(name: string): string | null }).getAttribute('aria-label') ??
        textOf(node),
    );
}

function whoHasPriority(state: GameState): PlayerId {
  const decision = pendingDecision(state, 512);
  if (decision === null || decision.kind !== 'priority') throw new Error('nobody holds priority');
  return decision.player;
}

function oidOf(state: GameState, name: string): ObjectId {
  const found = Object.entries(state.objects).find(([, object]) => object.card.name === name);
  if (found === undefined) throw new Error(`no object named ${name}`);
  return found[0];
}

describe('a trigger on the stack', () => {
  it('is an object of its own, named for the permanent that printed it', () => {
    const state = afterTheSweep([GROVE]);
    expect(state.stack).toHaveLength(1);
    draw(state);
    const rows = stackRows();
    expect(rows).toHaveLength(1);
    // The warden is in the graveyard by now, which is the whole reason the entry
    // has to carry a name at all: an ability on the stack has no card of its own
    // (CR 113.7a) and `stackItems` borrows the source's.
    expect(state.battlefield).not.toContain(oidOf(state, GROVE.name));
    expect(rows[0]).toContain(GROVE.name);
    expect(rows[0]).toContain('ability');
    expect(rows[0]).toContain(RESOLVES_NEXT);
  });

  it('holds the game open for the other seat, who may answer it', () => {
    const state = afterTheSweep([GROVE]);
    // The active player answers their own trigger first (CR 117.3c), so the
    // window the other seat gets is one pass later, and the trigger is still
    // there when it opens.
    expect(whoHasPriority(state)).toBe(0);
    const responding = step(state, { type: 'passPriority', player: 0 });
    expect(responding.stack).toHaveLength(1);
    expect(whoHasPriority(responding)).toBe(1);
    // A real move rather than only the pass: this is the response the acceptance
    // asks for, not a claim about one.
    draw(responding, 1);
    expect(moves().some((move) => move.includes(ARROW.name))).toBe(true);
    expect(screen.getByLabelText('Stack')).toBeDefined();
  });

  it('leaves the stack when it resolves, and pays what it printed', () => {
    const state = afterTheSweep([GROVE]);
    let settled = state;
    for (let guard = 0; guard < 4 && settled.stack.length > 0; guard += 1) {
      settled = step(settled, { type: 'passPriority', player: whoHasPriority(settled) });
    }
    expect(settled.stack).toHaveLength(0);
    expect(settled.players[0].life).toBe(state.players[0].life + 2);
    draw(settled);
    expect(screen.queryByLabelText('Stack')).toBeNull();
  });
});

describe('two triggers that fired at the same moment', () => {
  it('are two objects rather than one, both drawn', () => {
    const state = afterTheSweep([GROVE, FEN]);
    expect(state.stack).toHaveLength(2);
    draw(state);
    const rows = stackRows();
    expect(rows).toHaveLength(2);
    expect(rows.join(' ')).toContain(GROVE.name);
    expect(rows.join(' ')).toContain(FEN.name);
  });

  it('say which of them resolves next, in the order the kernel stacked them', () => {
    const state = afterTheSweep([GROVE, FEN]);
    draw(state);
    const rows = stackRows();
    // The kernel orders within one controller by the order the events were
    // emitted and then by printed ability order, so the second warden's trigger
    // is on top. Whichever it is, the strip's first row is the one that says so.
    expect(rows[0]).toContain(RESOLVES_NEXT);
    expect(rows[1]).toContain(WAITING);
    const top = state.stack[state.stack.length - 1];
    if (top === undefined || top.ability === null) throw new Error('the stack top is not an ability');
    expect(rows[0]).toContain(state.objects[top.ability.sourceOid]?.card.name ?? '');
  });

  it('resolve one at a time, top first, and the strip shrinks with them', () => {
    const state = afterTheSweep([GROVE, FEN]);
    const after = step(step(state, { type: 'passPriority', player: whoHasPriority(state) }), {
      type: 'passPriority',
      player: 1,
    });
    // Fen Warden is on top and pays 3, so the first resolution is +3 and the
    // remaining entry is Grove Warden's, still owed.
    expect(after.stack).toHaveLength(1);
    expect(after.players[0].life).toBe(state.players[0].life + 3);
    draw(after);
    const rows = stackRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(GROVE.name);
  });
});
