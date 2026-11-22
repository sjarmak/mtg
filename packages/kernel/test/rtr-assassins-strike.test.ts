import { describe, expect, it } from 'vitest';
import type { Action, ReduceResult } from '@mtg/kernel';
import { legalActions, pendingDecision, scenario, validateAction } from '@mtg/kernel';
import { creature, instant, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const ASSASSINS_STRIKE = sorcery(
  "Assassin's Strike",
  [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    { kind: 'discardCards', count: 1, target: { kind: 'thatCreaturesController' } },
  ],
  { generic: 4, B: 2 },
);

const CONTROL_SHIFT = instant(
  'Control Shift',
  [{ kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } }],
  { B: 1 },
);

const MURDER = instant(
  'Murder Response',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { B: 1 },
);

function castAt(current: ReduceResult, player: 0 | 1, name: string, targetOid: string): ReduceResult {
  const spellOid = handOidOf(current.state, player, name);
  const action = legalActions(current.state).find(
    (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
      candidate.type === 'castSpell' &&
      candidate.oid === spellOid &&
      candidate.targets[0]?.kind === 'permanent' &&
      candidate.targets[0].oid === targetOid,
  );
  if (action === undefined) throw new Error(`${name} was not offered against the creature`);
  expect(validateAction(current.state, action)).toBeNull();
  return apply(current, action);
}

function advanceUntilChoice(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 24; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('priority did not settle');
}

function board(): ReduceResult {
  return scenario({
    active: 0,
    hands: [[ASSASSINS_STRIKE], [creature('Held One', 1, 1), creature('Held Two', 1, 1)]],
    battlefield: [
      { card: creature('Marked Creature', 3, 3), controller: 1 },
      ...lands(SWAMP, 9).map((card) => ({ card, controller: 0 as const })),
    ],
  });
}

describe("RTR #57 Assassin's Strike", () => {
  it('destroys the creature and asks its controller to choose the discard', () => {
    const start = board();
    const targetOid = oidOf(start.state, 'Marked Creature');
    const asked = advanceUntilChoice(castAt(start, 0, ASSASSINS_STRIKE.name, targetOid));
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('the target controller was not asked to discard');

    expect(asked.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(decision.player).toBe(1);
    expect(decision.owner).toBe(1);
    expect(decision.count).toBe(1);
    expect(decision.revealed).toBe(false);

    const chosen = decision.hand[1];
    if (chosen === undefined) throw new Error('the target controller has no second card');
    const done = apply(asked, { type: 'chooseDiscards', player: 1, oids: [chosen] });
    expect(done.state.objects[chosen]?.zone).toBe('graveyard');
    expect(done.state.players[1].hand).toHaveLength(1);
  });

  it('reads the creature current controller after a response changes control', () => {
    const heldOne = creature('Caster Held One', 1, 1);
    const heldTwo = creature('Caster Held Two', 1, 1);
    const start = scenario({
      active: 0,
      hands: [[ASSASSINS_STRIKE, CONTROL_SHIFT, heldOne, heldTwo], [creature('Opponent Held', 1, 1)]],
      battlefield: [
        { card: creature('Changing Creature', 3, 3), controller: 1 },
        ...lands(SWAMP, 10).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    const targetOid = oidOf(start.state, 'Changing Creature');
    const strikeOnStack = castAt(start, 0, ASSASSINS_STRIKE.name, targetOid);
    const responseOnStack = castAt(strikeOnStack, 0, CONTROL_SHIFT.name, targetOid);
    const asked = advanceUntilChoice(responseOnStack);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('the current controller was not asked to discard');

    expect(asked.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(decision.player).toBe(0);
    expect(decision.owner).toBe(0);
    expect(decision.hand.map((oid) => asked.state.objects[oid]?.card.name).sort()).toEqual([
      heldOne.name,
      heldTwo.name,
    ]);
    expect(asked.state.players[1].hand).toHaveLength(1);
  });

  it('still makes the controller discard when indestructible stops only the destruction', () => {
    const start = scenario({
      active: 0,
      hands: [
        [ASSASSINS_STRIKE],
        [creature('Indestructible Held One', 1, 1), creature('Indestructible Held Two', 1, 1)],
      ],
      battlefield: [
        {
          card: creature('Indestructible Target', 3, 3, {
            keywordAbilities: [{ kind: 'indestructible' }],
          }),
          controller: 1,
        },
        ...lands(SWAMP, 9).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    const targetOid = oidOf(start.state, 'Indestructible Target');
    const asked = advanceUntilChoice(castAt(start, 0, ASSASSINS_STRIKE.name, targetOid));
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'handDiscard') throw new Error('indestructible incorrectly stopped the discard');

    expect(asked.state.objects[targetOid]?.zone).toBe('battlefield');
    expect(decision.player).toBe(1);
  });

  it('does as much as possible against an empty hand without inventing a choice', () => {
    const start = scenario({
      active: 0,
      hands: [[ASSASSINS_STRIKE], []],
      battlefield: [
        { card: creature('Empty-Hand Target', 3, 3), controller: 1 },
        ...lands(SWAMP, 9).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    const targetOid = oidOf(start.state, 'Empty-Hand Target');
    const done = advanceUntilChoice(castAt(start, 0, ASSASSINS_STRIKE.name, targetOid));

    expect(done.state.stack).toEqual([]);
    expect(done.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(pendingDecision(done.state)?.kind).not.toBe('handDiscard');
    expect(done.state.players[1].hand).toEqual([]);
  });

  it('fizzles the whole spell when the sole creature target leaves first', () => {
    const start = scenario({
      active: 0,
      hands: [
        [ASSASSINS_STRIKE, MURDER],
        [creature('Safe Held One', 1, 1), creature('Safe Held Two', 1, 1)],
      ],
      battlefield: [
        { card: creature('Departing Creature', 3, 3), controller: 1 },
        ...lands(SWAMP, 10).map((card) => ({ card, controller: 0 as const })),
      ],
    });
    const targetOid = oidOf(start.state, 'Departing Creature');
    const strikeOnStack = castAt(start, 0, ASSASSINS_STRIKE.name, targetOid);
    const responseOnStack = castAt(strikeOnStack, 0, MURDER.name, targetOid);
    const done = advanceUntilChoice(responseOnStack);

    expect(done.state.stack).toEqual([]);
    expect(done.state.objects[targetOid]?.zone).toBe('graveyard');
    expect(pendingDecision(done.state)?.kind).not.toBe('handDiscard');
    expect(done.state.players[1].hand).toHaveLength(2);
  });
});
