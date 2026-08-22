// @vitest-environment jsdom
/**
 * Attacking with more creatures than the enumeration can list.
 *
 * `mtg-dwd`. A deck of big creatures makes a board of big creatures, and at ten
 * eligible attackers `@mtg/kernel`'s `attackerDecision` stops being able to list
 * every declaration: the power set is 1024 and `enumerate.ts` caps at 512, so
 * half of them have no index, and at twelve it is 512 of 4096. Worse than the
 * count, and the reason a bigger cap is not the fix: `subsets` grows the lattice
 * one creature at a time, so the 512 were every subset of the first nine
 * creatures and the tenth onward appeared in no option but the
 * attack-with-everything the kernel appended.
 *
 * Since `mtg-tb7v` stage 2 the kernel asks such a board one creature at a time
 * instead, so the option list is two moves wide and no set of six has an index
 * either. Nothing about this surface changed: it stages a set and submits a
 * `Choice`, which is an index when one names the set and the declaration itself
 * when none does.
 *
 * The board's confirm used to look the staged set up in that list and draw
 * itself disabled when it found nothing, which on a twelve-creature board is
 * most of the sets a player can build by clicking. It submits a `Choice` now, so
 * the declaration goes over as itself where no index names it — the same answer
 * `mtg-y1t.2` gave the block half, reached here through the same
 * `validateAction` guard and the same `chooseAction` door.
 *
 * Two surfaces are checked because a player has two ways to declare, and both
 * have to reach the same set: the band, by clicking creatures and confirming,
 * and the ask column's roster, which `declare.ts` already built out of
 * `decision.eligible` rather than out of the truncated list.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { exampleCard } from '@mtg/dsl';
import type { Action, Choice, GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  asksInSteps,
  botSeat,
  choose,
  DEFAULT_ENUMERATION_CAP,
  humanSeat,
  pendingDecision,
  scenario,
  simpleAgent,
} from '@mtg/kernel';
import { attackChoice } from '../../src/routes/play/combat';
import { declarationChoice, declarationPlan } from '../../src/routes/play/declare';
import type { SeatNames } from '../../src/routes/play/position';
import { PlayView } from '../../src/routes/play/PlayView';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];
const VIEWER = 0 as PlayerId;
const BRUISER = exampleCard('slc-ironclad-golem');

/**
 * The widest board whose whole declaration space the enumeration still lists.
 *
 * `subsets` grows the lattice one creature at a time, so n creatures against one
 * defender is 2^n declarations and the list comes back whole while that is at
 * most the cap — nine creatures at the shipped 512. Written against
 * `DEFAULT_ENUMERATION_CAP` rather than as the nine it happens to be, because
 * the cap is one global constant over every enumeration in the kernel: a
 * literal here pins the constant, and what this file is about is the boundary,
 * not the number standing on it.
 */
const LISTED_BOARD = Math.floor(Math.log2(DEFAULT_ENUMERATION_CAP));

/** The board this bead is about: more creatures than the enumeration can list. */
function crowd(count: number): GameState {
  return scenario({
    seed: 'ui/attack-cap',
    battlefield: Array.from({ length: count }, () => ({
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

/**
 * The node members this file reads, checked at runtime rather than imported: the
 * workspace tsconfig carries no `lib: dom` (`AGENTS.md`), so `document` is not a
 * known global and `HTMLElement` holds none of these.
 */
interface NodeLike {
  readonly getAttribute: (name: string) => string | null;
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

function attackersOf(action: Action): readonly ObjectId[] {
  if (action.type !== 'declareAttackers') throw new Error('that is not an attack declaration');
  return action.attackers.map((attack) => attack.oid);
}

describe('a board past the enumeration cap', () => {
  it('declares a set no index names, by clicking and confirming', () => {
    const session = seated(crowd(12));
    const board = session.state.battlefield;
    const decision = session.pending;
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack to declare');
    // The premise, restated where a reader of this test can see it: the kernel
    // is asking one creature at a time, and the set below answers twelve
    // questions at once, so no option names it.
    expect(decision.eligible.length).toBe(12);
    expect(asksInSteps(decision)).toBe(true);
    const wanted = board.filter((_, index) => index % 2 === 0);

    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: VIEWER, names: NAMES, onChoose }));

    // Re-queried per click rather than captured: staging reparents the card into
    // the band, so a node held from before the click is detached.
    const faceFor = (oid: ObjectId): NodeLike =>
      nodeOf(bodyNode().querySelector(`[data-permanent-key='${oid}'] button.mtg-card`), `a face for ${oid}`);
    for (const oid of wanted) fireEvent.click(faceFor(oid));

    expect(
      bodyNode().querySelectorAll(".mtg-combat__entry[data-state='staged']"),
      'six creatures staged in the band',
    ).toHaveLength(6);
    expect(onChoose).not.toHaveBeenCalled();

    const confirm = nodeOf(bodyNode().querySelector(".mtg-combat__button[data-kind='confirm']"), 'a confirm');
    // Live rather than disabled, which is the whole of the defect: this exact
    // press was refused with "the kernel did not enumerate this set".
    expect(confirm.getAttribute('disabled')).toBeNull();
    fireEvent.click(confirm);

    expect(onChoose).toHaveBeenCalledTimes(1);
    const choice = onChoose.mock.calls[0]?.[0] as Choice;
    // The declaration itself, because no integer names this set. An index here
    // would be an index into a list that does not contain what was staged.
    expect(typeof choice).not.toBe('number');
    expect(attackersOf(choice as Action)).toEqual(wanted);
  });

  it('is a move the kernel takes, not merely one the surface offered', () => {
    const session = seated(crowd(12));
    const wanted = session.state.battlefield.filter((_, index) => index % 2 === 0);
    const decision = session.pending;
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack to declare');
    const choice = attackChoice(session.state, decision, new Set(wanted.map(String)));
    if (choice === null || typeof choice === 'number') throw new Error('this set should have no index');

    const applied = choose(session, choice);

    expect(applied.state.combat.attacks.map((attack) => attack.oid)).toEqual(wanted);
    // Recorded as the declaration, which is what a replay of this game spends.
    expect(applied.choices).toEqual([choice]);
  });

  it('keeps recording an integer on a board the enumeration still lists', () => {
    // The invisibility half. Nine creatures is 512 subsets at the shipped cap,
    // which fits, so the decision is the flat list it always was and both ends
    // of it record the integer they always did. Attack with everything is the
    // last subset the lattice reaches, which is what makes it the last index.
    const session = seated(crowd(LISTED_BOARD));
    const decision = session.pending;
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack to declare');

    const listed = 2 ** LISTED_BOARD;
    expect(asksInSteps(decision)).toBe(false);
    expect(decision.options.length).toBe(listed);
    expect(attackChoice(session.state, decision, new Set(decision.eligible.map(String)))).toBe(listed - 1);
    expect(attackChoice(session.state, decision, new Set())).toBe(0);
  });

  it('reaches the same set through the roster in the ask column', () => {
    // The other door, and the reason this bead's fix is one file rather than
    // two: `declare.ts` builds a creature's candidates out of `eligible`, which
    // is linear in the board, and submits a `Choice` for exactly this reason.
    const session = seated(crowd(12));
    const decision = session.pending;
    if (decision === null || decision.kind !== 'declareAttackers') throw new Error('no attack to declare');
    const plan = declarationPlan(session.state, NAMES, decision);
    if (plan === null) throw new Error('the roster refused a board it should hold');
    const wanted = session.state.battlefield.filter((_, index) => index % 2 === 0);

    expect(plan.subjects.map((subject) => subject.oid)).toEqual([...decision.eligible]);

    const assignment = new Map(wanted.map((oid) => [oid, 'player:1']));
    const choice = declarationChoice(session.state, plan, assignment);
    if (choice === null || typeof choice === 'number') throw new Error('this set should have no index');

    expect(attackersOf(choice)).toEqual(wanted);
  });
});
