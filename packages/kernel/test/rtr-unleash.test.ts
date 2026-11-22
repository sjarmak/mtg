/** Native Unleash entry choice and its live blocking restriction. */
import { describe, expect, it } from 'vitest';
import {
  beginTrace,
  counterCount,
  eligibleAttackers,
  eligibleBlockers,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
  toughnessOf,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { creature } from './cards';
import { withCounters } from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';

const REVELER = creature('Runeclaw Bear', 2, 3, {
  keywordAbilities: [{ kind: 'unleash' }],
});
const ATTACKER = creature('Attacker', 2, 2);

function stoppedEntry(controller: 0 | 1 = 0): { readonly state: GameState; readonly oid: ObjectId } {
  const start = scenario({ hands: controller === 0 ? [[REVELER], []] : [[], [REVELER]] }).state;
  const oid = handOidOf(start, controller, REVELER.name);
  return {
    state: moveObject(beginTrace(start), oid, 'battlefield', { controller }).state,
    oid,
  };
}

function answer(state: GameState, accept: boolean): GameState {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'chooseEntryOptionalCounter' }> =>
      candidate.type === 'chooseEntryOptionalCounter' && candidate.accept === accept,
  );
  if (action === undefined) throw new Error(`Unleash did not offer accept=${String(accept)}`);
  return reduce(state, action).state;
}

describe('Unleash entry choice', () => {
  it('asks the entering controller before the creature reaches the battlefield', () => {
    const stopped = stoppedEntry(1);

    expect(stopped.state.objects[stopped.oid]?.zone).toBe('hand');
    expect(stopped.state.battlefield).not.toContain(stopped.oid);
    expect(pendingDecision(stopped.state)).toMatchObject({
      kind: 'entryOptionalCounter',
      player: 1,
      oid: stopped.oid,
      counter: 'plusOnePlusOne',
      count: 1,
      options: [
        { type: 'chooseEntryOptionalCounter', accept: true },
        { type: 'chooseEntryOptionalCounter', accept: false },
      ],
      complete: true,
    });
  });

  it('accepts the counter before entry or declines into the printed body', () => {
    const acceptedStop = stoppedEntry();
    const accepted = answer(acceptedStop.state, true);
    expect(accepted.objects[acceptedStop.oid]?.zone).toBe('battlefield');
    expect(counterCount(accepted.objects[acceptedStop.oid]!.counters, 'plusOnePlusOne')).toBe(1);
    expect([powerOf(accepted, acceptedStop.oid), toughnessOf(accepted, acceptedStop.oid)]).toEqual([3, 4]);

    const declinedStop = stoppedEntry();
    const declined = answer(declinedStop.state, false);
    expect(declined.objects[declinedStop.oid]?.zone).toBe('battlefield');
    expect(counterCount(declined.objects[declinedStop.oid]!.counters, 'plusOnePlusOne')).toBe(0);
    expect([powerOf(declined, declinedStop.oid), toughnessOf(declined, declinedStop.oid)]).toEqual([2, 3]);
  });
});

describe('Unleash combat restriction', () => {
  function combatBoard(): { readonly state: GameState; readonly reveler: ObjectId } {
    const base = scenario({
      battlefield: [
        { card: ATTACKER, controller: 0 },
        { card: REVELER, controller: 1 },
      ],
      active: 0,
    }).state;
    const state = { ...base, turn: { ...base.turn, step: 'declareBlockers' as const } };
    return { state, reveler: oidOf(state, REVELER.name) };
  }

  it('tracks the live +1/+1 counter state without prohibiting attacks', () => {
    const board = combatBoard();
    expect(eligibleBlockers(board.state)).toContain(board.reveler);

    const countered = withCounters(board.state, board.reveler, 'plusOnePlusOne', 1);
    expect(eligibleBlockers(countered)).not.toContain(board.reveler);

    const cleared = withCounters(countered, board.reveler, 'plusOnePlusOne', -1);
    expect(eligibleBlockers(cleared)).toContain(board.reveler);

    const attacking = {
      ...countered,
      turn: { ...countered.turn, active: 1 as const, step: 'declareAttackers' as const },
    };
    expect(eligibleAttackers(attacking)).toContain(board.reveler);
  });
});
