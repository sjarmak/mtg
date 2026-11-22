/** Native variable-loyalty and target-relative sweep execution for Chandra. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  abilityObjectId,
  beginTrace,
  counterCount,
  eventsOfType,
  legalActions,
  moveObject,
  objectFilter,
  pendingDecision,
  scenario,
  stateFingerprint,
  validateAction,
  type Action,
  type ControlEffect,
  type GameState,
  type ReplacementEffect,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { apply, damageOn, oidOf } from './helpers';

const CHANDRA = parseCard({
  kind: 'planeswalker',
  id: 'm11-127-chandra-nalaar-kernel',
  name: 'Chandra Nalaar',
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 127 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  supertypes: ['legendary'],
  subtypes: ['Chandra'],
  startingLoyalty: 6,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayerOrPlaneswalker' } }],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: { kind: 'removeChosenX' },
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'chosenX' },
          target: { kind: 'targetCreature' },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -8,
      effects: [
        {
          kind: 'dealDamage',
          amount: 10,
          target: { kind: 'targetPlayerOrPlaneswalker' },
          scope: 'targetAndPermanentsItsPlayerControls',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
} as CardInput);

const TARGET = creature('Chandra Target', 2, 20);
const SPARED = creature('Chandra Spared', 2, 20);
const TARGET_WALKER = planeswalker('Chandra Target Walker', 12, [
  {
    kind: 'activated',
    cost: { mana: {} },
    loyaltyCost: 0,
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
]);

function activations(
  state: GameState,
  abilityIndex: number,
): readonly Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.abilityIndex === abilityIndex,
  );
}

function loyalty(state: GameState, oid: string): number {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`missing ${oid}`);
  return counterCount(object.counters, 'loyalty');
}

function passStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`stack paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  return current;
}

describe('Chandra Nalaar variable loyalty', () => {
  it('offers every affordable X, pays it before priority, and resolves the retained amount', () => {
    const start = scenario({
      battlefield: [
        { card: CHANDRA, controller: 0 },
        { card: TARGET, controller: 1 },
      ],
    });
    const walker = oidOf(start.state, CHANDRA.name);
    const target = oidOf(start.state, TARGET.name);
    const options = activations(start.state, 1);
    expect(options.map((action) => action.x)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const illegal: Extract<Action, { type: 'activateAbility' }> = {
      ...options[0]!,
      x: 7,
    };
    expect(validateAction(start.state, illegal)).toContain('loyalty');

    const chosen = options.find((action) => action.x === 3);
    if (chosen === undefined) throw new Error('Chandra offered no -3 activation');
    const paid = apply(start, chosen);
    expect(loyalty(paid.state, walker)).toBe(3);
    expect(paid.state.stack.at(-1)?.x).toBe(3);
    const resolved = passStack(paid);
    expect(damageOn(resolved.state, target)).toBe(3);
  });
});

describe('Chandra Nalaar target-relative ultimate', () => {
  it('damages the target player and creatures that player controls in one resolution', () => {
    const start = scenario({
      battlefield: [
        { card: CHANDRA, controller: 0, loyalty: 12 },
        { card: TARGET, controller: 1 },
        { card: SPARED, controller: 0 },
      ],
    });
    const target = oidOf(start.state, TARGET.name);
    const spared = oidOf(start.state, SPARED.name);
    const chosen = activations(start.state, 2).find(
      (action) => action.targets[0]?.kind === 'player' && action.targets[0].player === 1,
    );
    if (chosen === undefined) throw new Error('Chandra offered no player-targeted ultimate');
    const resolved = passStack(apply(start, chosen));
    expect(resolved.state.players[1].life).toBe(10);
    expect(damageOn(resolved.state, target)).toBe(10);
    expect(damageOn(resolved.state, spared)).toBe(0);
  });

  it("reads a planeswalker target's controller without damaging unrelated creatures", () => {
    const start = scenario({
      battlefield: [
        { card: CHANDRA, controller: 0, loyalty: 12 },
        { card: TARGET_WALKER, controller: 1 },
        { card: TARGET, controller: 1 },
        { card: SPARED, controller: 0 },
      ],
    });
    const targetWalker = oidOf(start.state, TARGET_WALKER.name);
    const target = oidOf(start.state, TARGET.name);
    const spared = oidOf(start.state, SPARED.name);
    const chosen = activations(start.state, 2).find(
      (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === targetWalker,
    );
    if (chosen === undefined) throw new Error('Chandra offered no planeswalker-targeted ultimate');
    const resolved = passStack(apply(start, chosen));
    expect(loyalty(resolved.state, targetWalker)).toBe(2);
    expect(damageOn(resolved.state, target)).toBe(10);
    expect(damageOn(resolved.state, spared)).toBe(0);
  });

  it("reads the planeswalker's current controller when the ability resolves", () => {
    const start = scenario({
      battlefield: [
        { card: CHANDRA, controller: 0, loyalty: 12 },
        { card: TARGET_WALKER, controller: 1 },
        { card: TARGET, controller: 1 },
        { card: SPARED, controller: 0 },
      ],
    });
    const targetWalker = oidOf(start.state, TARGET_WALKER.name);
    const target = oidOf(start.state, TARGET.name);
    const nowControlled = oidOf(start.state, SPARED.name);
    const chosen = activations(start.state, 2).find(
      (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === targetWalker,
    );
    if (chosen === undefined) throw new Error('Chandra offered no planeswalker-targeted ultimate');
    const paid = apply(start, chosen);
    const control: ControlEffect = {
      id: 'chandra-target-control',
      kind: 'control',
      layer: '2',
      affects: objectFilter({ oids: [targetWalker] }),
      controller: 0,
      duration: 'permanent',
      timestamp: paid.state.nextId,
      sourceOid: targetWalker,
      enabledWhile: null,
    };
    const resolved = passStack({
      ...paid,
      state: { ...paid.state, continuous: [...paid.state.continuous, control] },
    });
    expect(damageOn(resolved.state, nowControlled)).toBe(10);
    expect(damageOn(resolved.state, target)).toBe(0);
  });

  it('uses the ordinary damage replacement pipeline for every member of the batch', () => {
    const start = scenario({
      battlefield: [
        { card: CHANDRA, controller: 0, loyalty: 12 },
        { card: TARGET, controller: 1 },
      ],
    });
    const chandra = oidOf(start.state, CHANDRA.name);
    const target = oidOf(start.state, TARGET.name);
    const shield: ReplacementEffect = {
      id: 'chandra-target-shield',
      sourceOid: target,
      controller: 1,
      timestamp: start.state.nextId,
      duration: 'permanent',
      selfReplacement: false,
      trigger: {
        kind: 'damage',
        toPlayer: null,
        toPermanent: target,
        toController: null,
        toPermanentCardType: null,
        fromSource: null,
        fromSpellSource: null,
        combatOnly: false,
      },
      modification: { kind: 'preventDamage', amount: 'all' },
    };
    const protectedState = { ...start.state, replacements: [...start.state.replacements, shield] };
    const chosen = activations(protectedState, 2).find(
      (action) => action.targets[0]?.kind === 'player' && action.targets[0].player === 1,
    );
    if (chosen === undefined) throw new Error('Chandra offered no player-targeted ultimate');
    const resolved = passStack(apply({ state: protectedState, events: [] }, chosen));
    expect(resolved.state.players[1].life).toBe(10);
    expect(damageOn(resolved.state, target)).toBe(0);
    expect(eventsOfType(resolved.events, 'damagePrevented')).toEqual([
      expect.objectContaining({ sourceOid: chandra, target: { kind: 'permanent', oid: target }, amount: 10 }),
    ]);
  });

  it('fizzles after its sole planeswalker target leaves, sparing the linked group', () => {
    const start = scenario({
      battlefield: [
        { card: CHANDRA, controller: 0, loyalty: 12 },
        { card: TARGET_WALKER, controller: 1 },
        { card: TARGET, controller: 1 },
      ],
    });
    const walker = oidOf(start.state, TARGET_WALKER.name);
    const target = oidOf(start.state, TARGET.name);
    const chosen = activations(start.state, 2).find(
      (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === walker,
    );
    if (chosen === undefined) throw new Error('Chandra offered no planeswalker-targeted ultimate');
    const paid = apply(start, chosen);
    const gone = moveObject(beginTrace(paid.state), walker, 'graveyard');
    const resolved = passStack({ state: gone.state, events: [...paid.events, ...gone.events] });
    expect(damageOn(resolved.state, target)).toBe(0);
    expect(eventsOfType(resolved.events, 'effectSkipped')).toEqual([
      expect.objectContaining({ why: 'target is no longer legal' }),
    ]);
  });

  it('lets copied ultimates resolve independently and replay deterministically', () => {
    const copiedState = (): {
      readonly state: GameState;
      readonly target: string;
      readonly walker: string;
    } => {
      const start = scenario({
        battlefield: [
          { card: CHANDRA, controller: 0, loyalty: 12 },
          { card: TARGET_WALKER, controller: 1, loyalty: 30 },
          { card: TARGET, controller: 1 },
        ],
      });
      const walker = oidOf(start.state, TARGET_WALKER.name);
      const target = oidOf(start.state, TARGET.name);
      const chosen = activations(start.state, 2).find(
        (action) => action.targets[0]?.kind === 'permanent' && action.targets[0].oid === walker,
      );
      if (chosen === undefined) throw new Error('Chandra offered no planeswalker-targeted ultimate');
      const paid = apply(start, chosen);
      const entry = paid.state.stack.at(-1);
      if (entry === undefined) throw new Error('Chandra ultimate never reached the stack');
      return {
        target,
        walker,
        state: {
          ...paid.state,
          nextId: paid.state.nextId + 1,
          stack: [...paid.state.stack, { ...entry, oid: abilityObjectId(paid.state.nextId) }],
        },
      };
    };
    const firstStart = copiedState();
    const secondStart = copiedState();
    const first = passStack({ state: firstStart.state, events: [] });
    const second = passStack({ state: secondStart.state, events: [] });
    expect(first.state.objects[firstStart.target]?.zone).toBe('graveyard');
    expect(
      eventsOfType(first.events, 'damageDealt')
        .filter((event) => event.target.kind === 'permanent' && event.target.oid === firstStart.target)
        .map((event) => event.amount),
    ).toEqual([10, 10]);
    expect(loyalty(first.state, firstStart.walker)).toBe(10);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });
});
