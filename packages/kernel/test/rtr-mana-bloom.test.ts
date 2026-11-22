/** Mana Bloom's deterministic counter payment, turn limit, and empty upkeep trigger. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  counterCount,
  legalActions,
  moveObject,
  placeCounters,
  playerOf,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  type Action,
  type GameState,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { MANA_BLOOM } from '../../dsl/test/rtr-mana-bloom.test';
import { handOidOf, oidOf } from './helpers';

const CARD = parseCard(MANA_BLOOM);

function manaActions(state: GameState, oid: string) {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateManaAbility' }> =>
      action.type === 'activateManaAbility' && action.oid === oid,
  );
}

function upkeepTriggers(state: GameState, active: 0 | 1) {
  const event = { type: 'stepBegan', turn: state.turn.number, step: 'upkeep', active } as const;
  const trace: Trace = { state, events: [event], eventStates: [state] };
  return collectTriggers(trace, 0);
}

describe('Mana Bloom in the kernel', () => {
  it('enters with the announced X charge counters, including zero', () => {
    const enterWith = (chosenX: number) => {
      const start = scenario({ hands: [[CARD], []] });
      const oid = handOidOf(start.state, 0, CARD.name);
      return moveObject(beginTrace(start.state), oid, 'battlefield', { chosenX });
    };

    expect(counterCount(enterWith(0).state.objects.o0!.counters, 'charge')).toBe(0);
    expect(counterCount(enterWith(3).state.objects.o0!.counters, 'charge')).toBe(3);
  });

  it('pays one charge counter without the stack and allows only one activation each turn', () => {
    const start = scenario({ battlefield: [{ card: CARD, controller: 0 }] });
    const oid = oidOf(start.state, CARD.name);
    const charged = placeCounters(start, oid, 'charge', 2);
    expect(
      manaActions(charged.state, oid)
        .map((action) => action.color)
        .sort(),
    ).toEqual(['B', 'G', 'R', 'U', 'W']);

    const blue = reduce(charged.state, { type: 'activateManaAbility', player: 0, oid, color: 'U' });
    expect(counterCount(blue.state.objects[oid]!.counters, 'charge')).toBe(1);
    expect(playerOf(blue.state, 0).pool.U).toBe(1);
    expect(blue.state.stack).toEqual([]);
    expect(manaActions(blue.state, oid)).toEqual([]);

    const nextTurn = { ...blue.state, turn: { ...blue.state.turn, number: blue.state.turn.number + 1 } };
    expect(manaActions(nextTurn, oid)).toHaveLength(5);
  });

  it('offers no mana activation without a charge counter', () => {
    const start = scenario({ battlefield: [{ card: CARD, controller: 0 }] });
    expect(manaActions(start.state, oidOf(start.state, CARD.name))).toEqual([]);
  });

  it('returns itself only from an empty source at its controller upkeep', () => {
    const empty = scenario({ battlefield: [{ card: CARD, controller: 0 }] });
    const oid = oidOf(empty.state, CARD.name);
    const triggers = upkeepTriggers(empty.state, 0);
    expect(triggers).toHaveLength(1);
    const resolved = resolveTop(putTriggersOnStack(beginTrace(empty.state), triggers));
    expect(resolved.state.objects[oid]?.zone).toBe('hand');

    const chargedStart = scenario({ battlefield: [{ card: CARD, controller: 0 }] });
    const chargedOid = oidOf(chargedStart.state, CARD.name);
    const charged = placeCounters(chargedStart, chargedOid, 'charge', 1);
    expect(upkeepTriggers(charged.state, 0)).toEqual([]);
  });

  it("returns to its owner's hand under another player's control", () => {
    const start = scenario({ hands: [[CARD], []] });
    const oid = handOidOf(start.state, 0, CARD.name);
    const controlled = moveObject(beginTrace(start.state), oid, 'battlefield', { controller: 1 });
    const triggers = upkeepTriggers(controlled.state, 1);
    const resolved = resolveTop(putTriggersOnStack(controlled, triggers));

    expect(resolved.state.objects[oid]?.owner).toBe(0);
    expect(resolved.state.objects[oid]?.zone).toBe('hand');
    expect(playerOf(resolved.state, 0).hand).toContain(oid);
  });

  it('does not follow a departed source out of its new zone', () => {
    const start = scenario({ battlefield: [{ card: CARD, controller: 0 }] });
    const oid = oidOf(start.state, CARD.name);
    const stacked = putTriggersOnStack(beginTrace(start.state), upkeepTriggers(start.state, 0));
    const departed = moveObject(stacked, oid, 'graveyard');
    const resolved = resolveTop(departed);

    expect(resolved.state.objects[oid]?.zone).toBe('graveyard');
  });
});
