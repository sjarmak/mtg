import { describe, expect, it } from 'vitest';
import type { AbilityInput } from '@mtg/dsl';
import {
  actionKey,
  counterCount,
  eventsOfType,
  legalActions,
  pendingDecision,
  reduce,
  sameAction,
  scenario,
  serializeEvents,
  stateFingerprint,
  validateAction,
  type Action,
  type GameState,
  onlyObject,
} from '@mtg/kernel';
import { artifact, creature, instant, MOUNTAIN, planeswalker } from './cards';
import { controlledBy as controlChange, copies, withContinuous } from './continuous-helpers';
import { apply, oidOf } from './helpers';

const PLUS: AbilityInput = {
  kind: 'activated',
  loyaltyCost: 1,
  cost: { mana: {} },
  effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
};

const ZERO: AbilityInput = {
  kind: 'activated',
  loyaltyCost: 0,
  cost: { mana: {} },
  effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
};

const MINUS: AbilityInput = {
  kind: 'activated',
  loyaltyCost: -3,
  cost: { mana: {} },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
};

function walker() {
  return planeswalker('Ajani Testbound', 3, [PLUS, ZERO, MINUS]);
}

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> => action.type === 'activateAbility',
  );
}

function loyalty(state: GameState, oid: string): number {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`missing ${oid}`);
  return counterCount(object.counters, 'loyalty');
}

describe('loyalty activation', () => {
  it('starts with printed loyalty, pays before the stack, and limits this permanent once per turn', () => {
    const start = scenario({ battlefield: [{ card: walker(), controller: 0, summoningSick: true }] });
    const oid = oidOf(start.state, 'Ajani Testbound');
    expect(loyalty(start.state, oid)).toBe(3);
    expect(activations(start.state).some((action) => action.abilityIndex === 0)).toBe(true);

    const chosen = activations(start.state).find((action) => action.abilityIndex === 0);
    if (chosen === undefined) throw new Error('missing +1 activation');
    const paid = apply(start, chosen);
    expect(loyalty(paid.state, oid)).toBe(4);
    expect(paid.state.stack.at(-1)?.ability).toEqual({ sourceOid: oid, index: 0 });
    expect(activations(paid.state)).toHaveLength(0);
  });

  it('requires own main phase, priority, and an empty stack, but never checks summoning sickness', () => {
    const theirs = scenario({ active: 1, battlefield: [{ card: walker(), controller: 0 }] });
    expect(activations(theirs.state)).toHaveLength(0);

    const combat = scenario({
      battlefield: [
        { card: walker(), controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      step: 'beginCombat',
    });
    expect(activations(combat.state)).toHaveLength(0);

    const instantCard = instant('Interrupting Spark', [
      { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
    ]);
    const withSpell = scenario({
      battlefield: [
        { card: walker(), controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[instantCard], []],
    });
    const cast = legalActions(withSpell.state).find((action) => action.type === 'castSpell');
    if (cast === undefined) throw new Error('missing cast');
    expect(activations(apply(withSpell, cast).state)).toHaveLength(0);
  });

  it('requires enough counters for a negative cost and lets a zero-loyalty source die while its ability remains', () => {
    const low = scenario({ battlefield: [{ card: walker(), controller: 0, loyalty: 2 }] });
    expect(activations(low.state).some((action) => action.abilityIndex === 2)).toBe(false);

    const start = scenario({ battlefield: [{ card: walker(), controller: 0 }] });
    const oid = oidOf(start.state, 'Ajani Testbound');
    const minus = activations(start.state).find(
      (action) => action.abilityIndex === 2 && action.targets[0]?.kind === 'player',
    );
    if (minus === undefined) throw new Error('missing -3 activation');
    const paid = apply(start, minus);
    expect(paid.state.objects[oid]?.zone).toBe('graveyard');
    expect(paid.state.stack.at(-1)?.ability).toEqual({ sourceOid: oid, index: 2 });
  });

  it('keeps the once-per-turn marker on the permanent across control changes', () => {
    const start = scenario({ battlefield: [{ card: walker(), controller: 0 }] });
    const plus = activations(start.state).find((action) => action.abilityIndex === 0);
    if (plus === undefined) throw new Error('missing +1 activation');
    const paid = apply(start, plus);
    const oid = plus.oid;
    const changed: GameState = {
      ...paid.state,
      objects: { ...paid.state.objects, [oid]: { ...paid.state.objects[oid]!, controller: 1 } },
      turn: { ...paid.state.turn, active: 1, priority: 1 },
      stack: [],
    };
    expect(activations(changed)).toHaveLength(0);
  });
});

describe('loyalty entry, copying, and legend state', () => {
  it('gives a newly entering copy printed starting loyalty instead of copying the source counters', () => {
    const blank = artifact('Planar Double', { generic: 1 });
    const start = scenario({
      battlefield: [
        { card: walker(), controller: 0, loyalty: 7 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[blank], []],
    });
    const source = oidOf(start.state, 'Ajani Testbound');
    const copyOid = start.state.players[0].hand.find(
      (oid) => start.state.objects[oid]?.card.name === 'Planar Double',
    );
    if (copyOid === undefined) throw new Error('missing copy spell');
    let current = { ...start, state: withContinuous(start.state, [copies(onlyObject(copyOid), source)]) };
    const cast = legalActions(current.state).find(
      (action) => action.type === 'castSpell' && action.oid === copyOid,
    );
    if (cast === undefined) throw new Error('missing copy cast');
    current = apply(current, cast);
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(current.state.objects[copyOid]?.zone).toBe('battlefield');
    expect(loyalty(current.state, source)).toBe(7);
    expect(loyalty(current.state, copyOid)).toBe(3);
  });

  it('does not reset an existing walker counters when control changes', () => {
    const start = scenario({ battlefield: [{ card: walker(), controller: 0, loyalty: 7 }] });
    const oid = oidOf(start.state, 'Ajani Testbound');
    const changed = withContinuous(start.state, [controlChange(onlyObject(oid), 1)]);
    expect(loyalty(changed, oid)).toBe(7);
  });

  it('uses the ordinary current legendary-permanent state-based action', () => {
    const card = walker();
    const start = scenario({
      battlefield: [
        { card, controller: 0, loyalty: 2 },
        { card, controller: 0, loyalty: 5 },
      ],
    });
    const decision = pendingDecision(start.state);
    expect(decision?.kind).toBe('legendRule');
    if (decision?.kind !== 'legendRule') throw new Error('missing legend choice');
    const kept = decision.candidates[1];
    if (kept === undefined) throw new Error('missing second walker');
    const answered = reduce(start.state, { type: 'keepLegend', player: 0, oid: kept });
    expect(answered.state.battlefield).toContain(kept);
    expect(loyalty(answered.state, kept)).toBe(5);
    expect(answered.state.players[0].graveyard).toHaveLength(1);
  });
});

describe('planeswalker damage and combat', () => {
  it('offers any-target damage at friendly and opposing planeswalkers and removes loyalty instead of marking damage', () => {
    const bolt = instant('Planar Bolt', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }]);
    const start = scenario({
      battlefield: [
        { card: walker(), controller: 0 },
        { card: planeswalker('Jace Testbound', 4, [PLUS]), controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    });
    const walkers = start.state.battlefield.filter(
      (oid) => start.state.objects[oid]?.card.kind === 'planeswalker',
    );
    const casts = legalActions(start.state).filter((action) => action.type === 'castSpell');
    for (const oid of walkers) {
      expect(
        casts.some((action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === oid),
      ).toBe(true);
    }
    const target = walkers[1];
    const cast = casts.find(
      (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === target,
    );
    if (cast === undefined || target === undefined) throw new Error('missing walker target');
    let result = apply(start, cast);
    result = apply(result, { type: 'passPriority', player: 0 });
    result = apply(result, { type: 'passPriority', player: 1 });
    expect(loyalty(result.state, target)).toBe(2);
    expect(result.state.objects[target]?.damage).toBe(0);
    expect(eventsOfType(result.events, 'damageDealt').at(-1)?.target).toEqual({
      kind: 'permanent',
      oid: target,
    });
  });

  it('declares attackers at an opposing planeswalker and records that defender through combat damage', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Attacker', 2, 2), controller: 0 },
        { card: planeswalker('Jace Testbound', 4, [PLUS]), controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, 'Attacker');
    const defender = oidOf(start.state, 'Jace Testbound');
    const decision = pendingDecision(start.state);
    expect(decision?.kind).toBe('declareAttackers');
    if (decision?.kind !== 'declareAttackers') throw new Error('missing attacker decision');
    const action = decision.options.find(
      (option) =>
        option.type === 'declareAttackers' &&
        option.attackers.some(
          (entry) =>
            entry.oid === attacker &&
            typeof entry.defender !== 'number' &&
            entry.defender.kind === 'planeswalker' &&
            entry.defender.oid === defender,
        ),
    );
    expect(action).toBeDefined();
    if (action === undefined) return;
    expect(validateAction(start.state, action)).toBeNull();
    const declared = reduce(start.state, action);
    const replayed = reduce(structuredClone(start.state), structuredClone(action));
    expect(sameAction(action, structuredClone(action))).toBe(true);
    expect(actionKey(action)).toContain('planeswalker');
    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(declared.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(declared.events));
    expect(eventsOfType(declared.events, 'attackersDeclared')[0]?.attacks).toEqual([
      { oid: attacker, defender: { kind: 'planeswalker', oid: defender } },
    ]);
  });

  it('an unblocked attacker reduces only the chosen walker and not its controller or sibling', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Attacker', 2, 2), controller: 0 },
        { card: planeswalker('Jace Testbound', 4, [PLUS]), controller: 1 },
        { card: planeswalker('Liliana Testbound', 5, [PLUS]), controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, 'Attacker');
    const jace = oidOf(start.state, 'Jace Testbound');
    const liliana = oidOf(start.state, 'Liliana Testbound');
    const decision = pendingDecision(start.state);
    if (decision?.kind !== 'declareAttackers') throw new Error('missing attacker decision');
    const attack = decision.options.find(
      (option) =>
        option.type === 'declareAttackers' &&
        option.attackers.length === 1 &&
        option.attackers[0]?.oid === attacker &&
        typeof option.attackers[0].defender !== 'number' &&
        option.attackers[0].defender.oid === jace,
    );
    if (attack === undefined) throw new Error('missing attack at Jace');
    let current = reduce(start.state, attack);
    for (let guard = 0; guard < 20 && loyalty(current.state, jace) === 4; guard += 1) {
      const owed = pendingDecision(current.state);
      if (owed === null) break;
      if (owed.kind === 'priority') {
        current = reduce(current.state, { type: 'passPriority', player: owed.player });
      } else if (owed.kind === 'declareBlockers') {
        current = reduce(current.state, { type: 'declareBlockers', player: owed.player, blocks: [] });
      } else {
        throw new Error(`unexpected ${owed.kind}`);
      }
    }
    expect(loyalty(current.state, jace)).toBe(2);
    expect(loyalty(current.state, liliana)).toBe(5);
    expect(current.state.players[1].life).toBe(20);
    expect(eventsOfType(current.events, 'damageDealt').at(-1)?.target).toEqual({
      kind: 'permanent',
      oid: jace,
    });
  });
});
