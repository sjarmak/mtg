/** Niv-Mizzet, Dracogenius's combat and noncombat player-damage trigger. */
import { parseCard } from '@mtg/dsl';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  scenario,
  type Action,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, ISLAND, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

const NIV_MIZZET = parseCard({
  kind: 'creature',
  id: 'rtr-183-niv-mizzet-dracogenius-kernel',
  name: 'Niv-Mizzet, Dracogenius',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 183 },
  manaCost: { generic: 2, U: 2, R: 2 },
  colors: ['U', 'R'],
  supertypes: ['legendary'],
  subtypes: ['Dragon', 'Wizard'],
  power: 5,
  toughness: 5,
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfDealsCombatDamageToPlayer',
      includesNoncombatDamage: true,
      printedSourceReference: 'cardNameBeforeComma',
      optional: true,
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'activated',
      printedSourceReference: 'cardNameBeforeComma',
      cost: { mana: { U: 1, R: 1 } },
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
    },
  ],
});

function activation(from: ReduceResult, target: 0 | 1): Extract<Action, { type: 'activateAbility' }> {
  const source = oidOf(from.state, NIV_MIZZET.name);
  const option = legalActions(from.state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' &&
      action.oid === source &&
      action.abilityIndex === 1 &&
      action.targets[0]?.kind === 'player' &&
      action.targets[0].player === target,
  );
  if (option === undefined) throw new Error('Niv-Mizzet player activation was not offered');
  return option;
}

function untilOptional(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'optionalTrigger') return current;
    if (decision?.kind !== 'priority') throw new Error(`expected priority, got ${decision?.kind ?? 'none'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('optional draw was not offered');
}

describe('Niv-Mizzet, Dracogenius in the kernel', () => {
  it('fires once for its noncombat player damage and lets its controller accept the draw', () => {
    const start = scenario({
      battlefield: [
        { card: NIV_MIZZET, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      libraries: [[creature('Drawn Drake', 2, 2)], []],
    });
    const offered = untilOptional(apply(start, activation(start, 1)));
    const source = oidOf(offered.state, NIV_MIZZET.name);
    expect(
      eventsOfType(offered.events, 'abilityTriggered').filter((event) => event.source === source),
    ).toHaveLength(1);
    const decision = pendingDecision(offered.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('optional draw disappeared');
    const accepted = apply(offered, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: decision.oid,
      accept: true,
    });
    expect(accepted.state.players[0].hand).toHaveLength(1);
    expect(accepted.state.players[1].life).toBe(19);
  });

  it('lets its controller decline without drawing', () => {
    const start = scenario({
      battlefield: [
        { card: NIV_MIZZET, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      libraries: [[creature('Declined Drake', 2, 2)], []],
    });
    const offered = untilOptional(apply(start, activation(start, 1)));
    const decision = pendingDecision(offered.state);
    if (decision?.kind !== 'optionalTrigger') throw new Error('optional draw disappeared');
    const declined = apply(offered, {
      type: 'answerOptionalTrigger',
      player: 0,
      oid: decision.oid,
      accept: false,
    });
    expect(declined.state.players[0].hand).toEqual([]);
    expect(declined.state.players[0].library).toHaveLength(1);
  });

  it('does not trigger when the same activation damages a permanent', () => {
    const target = creature('Training Dummy', 2, 2);
    const start = scenario({
      battlefield: [
        { card: NIV_MIZZET, controller: 0 },
        { card: target, controller: 1 },
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
    });
    const targetOid = oidOf(start.state, target.name);
    const source = oidOf(start.state, NIV_MIZZET.name);
    const option = legalActions(start.state).find(
      (action): action is Extract<Action, { type: 'activateAbility' }> =>
        action.type === 'activateAbility' &&
        action.oid === source &&
        action.abilityIndex === 1 &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === targetOid,
    );
    if (option === undefined) throw new Error('Niv-Mizzet permanent activation was not offered');
    let current = apply(start, option);
    for (let guard = 0; guard < 4 && current.state.stack.length > 0; guard += 1) {
      const decision = pendingDecision(current.state);
      if (decision?.kind !== 'priority') throw new Error('priority was not offered');
      current = apply(current, { type: 'passPriority', player: decision.player });
    }
    expect(eventsOfType(current.events, 'abilityTriggered')).toEqual([]);
    expect(current.state.objects[targetOid]?.damage).toBe(1);
  });
});
