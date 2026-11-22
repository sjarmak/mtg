/** Native combat legality for M13's conditional-combat cluster. */
import { describe, expect, it } from 'vitest';
import {
  beginTrace,
  collectTriggers,
  counterCount,
  eligibleAttackers,
  eligibleBlockers,
  getObject,
  pendingDecision,
  putTriggersOnStack,
  reduce,
  resolveTop,
  satisfyMustBeBlocked,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Trace,
} from '@mtg/kernel';
import { creature, planeswalker } from './cards';
import { withCounters } from './continuous-helpers';
import { oidOf } from './helpers';

const WAR_FALCON = creature('War Falcon', 2, 1, {
  keywords: ['flying'],
  subtypes: ['Bird'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: { kind: 'controlsNoneOfSubtypes', subtypes: ['Knight', 'Soldier'] },
      modification: { kind: 'cantAttack' },
    },
  ],
});

const SLUMBERING_RESTRICTION = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  enabledWhile: {
    kind: 'selfCounterCountBelow' as const,
    counter: 'plusOnePlusOne' as const,
    fewerThan: 5,
  },
  modification: { kind: 'cantAttackOrBlock' as const },
};

const SLUMBERING_TRIGGER = {
  kind: 'triggered' as const,
  condition: 'creatureAttacksYouOrPlaneswalkerYouControl' as const,
  effects: [
    {
      kind: 'putCounters' as const,
      counter: 'plusOnePlusOne' as const,
      count: 1,
      target: { kind: 'selfCreature' as const },
    },
  ],
};

const SLUMBERING_DRAGON = creature('Slumbering Dragon', 3, 3, {
  keywords: ['flying'],
  subtypes: ['Dragon'],
  abilities: [SLUMBERING_RESTRICTION, SLUMBERING_TRIGGER],
});

const SLUMBERING_SHELL = creature('Slumbering Shell', 3, 3, {
  abilities: [SLUMBERING_RESTRICTION],
});

const AGGRESSOR_DRAGON = creature('Aggressor Dragon', 3, 3, {
  abilities: [SLUMBERING_TRIGGER],
});

const MOGG = creature('Mogg Flunkies', 3, 3, {
  subtypes: ['Goblin'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttackOrBlockAlone' },
    },
  ],
});

const FLYING_MOGG = creature('Flying Flunkies', 2, 2, {
  keywords: ['flying'],
  abilities: MOGG.abilities,
});

const FORCED_MOGG = creature('Compelled Flunkies', 3, 3, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'cantAttackOrBlockAlone' },
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'attacksEachCombatIfAble' },
    },
  ],
});

const LURE = creature('Mogg Lure', 2, 2, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'mustBeBlockedIfAble' },
    },
  ],
});

const FLYING_LURE = creature('Flying Lure', 2, 2, {
  keywords: ['flying'],
  abilities: LURE.abilities,
});

const MENACE_LURE = creature('Menace Lure', 2, 2, {
  keywords: ['menace'],
  abilities: LURE.abilities,
});

const KNIGHT = creature('Falcon Knight', 2, 2, { subtypes: ['Knight'] });
const SOLDIER = creature('Falcon Soldier', 2, 2, { subtypes: ['Soldier'] });
const BEAR = creature('Combat Bear', 2, 2);
const OTHER_BEAR = creature('Other Combat Bear', 2, 2);
const WALKER = planeswalker('Dragon Walker', 4, []);

function swing(player: 0 | 1, ...attackers: readonly ObjectId[]): Action {
  const defender = player === 0 ? 1 : 0;
  return {
    type: 'declareAttackers',
    player,
    attackers: attackers.map((oid) => ({ oid, defender })),
  };
}

function toBlockers(start: GameState, attackers: readonly ObjectId[]): GameState {
  let current: ReduceResult = reduce(start, swing(0, ...attackers));
  for (let guard = 0; guard < 12; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind === 'declareBlockers') return current.state;
    if (decision?.kind !== 'priority') throw new Error('combat did not reach blockers');
    current = reduce(current.state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('combat did not reach blockers');
}

describe('War Falcon', () => {
  it('is restricted with no matching subtype or only an opposing one', () => {
    for (const battlefield of [
      [{ card: WAR_FALCON, controller: 0 as const }],
      [
        { card: WAR_FALCON, controller: 0 as const },
        { card: KNIGHT, controller: 1 as const },
      ],
    ]) {
      const state = scenario({ battlefield, active: 0, step: 'declareAttackers' }).state;
      expect(eligibleAttackers(state)).not.toContain(oidOf(state, WAR_FALCON.name));
    }
  });

  it('can attack with either a Knight or a Soldier under its current controller', () => {
    for (const escort of [KNIGHT, SOLDIER]) {
      const state = scenario({
        battlefield: [
          { card: WAR_FALCON, controller: 0 },
          { card: escort, controller: 0 },
        ],
        active: 0,
        step: 'declareAttackers',
      }).state;
      expect(eligibleAttackers(state)).toContain(oidOf(state, WAR_FALCON.name));
    }
  });
});

describe('Slumbering Dragon', () => {
  it('cannot attack or block at four counters and can do both at five', () => {
    const attacking = scenario({
      battlefield: [{ card: SLUMBERING_SHELL, controller: 0 }],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(attacking, SLUMBERING_SHELL.name);
    expect(eligibleAttackers(withCounters(attacking, attacker, 'plusOnePlusOne', 4))).not.toContain(attacker);
    expect(eligibleAttackers(withCounters(attacking, attacker, 'plusOnePlusOne', 5))).toContain(attacker);

    const defending = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: SLUMBERING_SHELL, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const dragon = oidOf(defending, SLUMBERING_SHELL.name);
    expect(eligibleBlockers(withCounters(defending, dragon, 'plusOnePlusOne', 4))).not.toContain(dragon);
    expect(eligibleBlockers(withCounters(defending, dragon, 'plusOnePlusOne', 5))).toContain(dragon);
  });

  it('fires once per creature attacking its controller or their planeswalker', () => {
    const state = scenario({
      battlefield: [
        { card: SLUMBERING_DRAGON, controller: 0 },
        { card: WALKER, controller: 0 },
        { card: BEAR, controller: 1 },
        { card: OTHER_BEAR, controller: 1 },
        { card: AGGRESSOR_DRAGON, controller: 1 },
      ],
    }).state;
    const dragon = oidOf(state, SLUMBERING_DRAGON.name);
    const walker = oidOf(state, WALKER.name);
    const attacks = [
      { oid: oidOf(state, BEAR.name), defender: 0 as const },
      {
        oid: oidOf(state, OTHER_BEAR.name),
        defender: { kind: 'planeswalker' as const, oid: walker },
      },
    ];
    const event = { type: 'attackersDeclared' as const, player: 1 as const, attacks };
    const trace: Trace = { state, events: [event], eventStates: [state] };
    const fired = collectTriggers(trace, 0);

    expect(fired.map((trigger) => [trigger.sourceOid, trigger.condition])).toEqual([
      [dragon, 'creatureAttacksYouOrPlaneswalkerYouControl'],
      [dragon, 'creatureAttacksYouOrPlaneswalkerYouControl'],
    ]);
    let resolved = putTriggersOnStack(beginTrace(state), fired);
    resolved = resolveTop(resolved);
    resolved = resolveTop(resolved);
    expect(counterCount(getObject(resolved.state, dragon).counters, 'plusOnePlusOne')).toBe(2);
  });
});

describe('Mogg Flunkies', () => {
  it('rejects a solo attack but accepts an accompanied attack and two Flunkies', () => {
    const state = scenario({
      battlefield: [
        { card: MOGG, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const mogg = oidOf(state, MOGG.name);
    const bear = oidOf(state, BEAR.name);
    expect(validateAction(state, swing(0, mogg))).toMatch(/alone/i);
    expect(validateAction(state, swing(0, mogg, bear))).toBeNull();

    const twins = scenario({
      battlefield: [
        { card: MOGG, controller: 0 },
        { card: MOGG, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    expect(validateAction(twins, swing(0, ...twins.battlefield))).toBeNull();
  });

  it('keeps incremental attack options complete without offering a dead end', () => {
    const start = scenario({
      battlefield: [
        { card: MOGG, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const mogg = oidOf(start, MOGG.name);
    const first = pendingDecision(start, 2);
    if (first?.kind !== 'declareAttackers') throw new Error('expected attacker decision');
    const attackMogg = first.options.find(
      (action) =>
        action.type === 'declareAttackers' && action.attackers.some((attack) => attack.oid === mogg),
    );
    if (attackMogg === undefined) throw new Error('Mogg attack prefix was not offered');
    const afterPrefix = reduce(start, attackMogg).state;
    expect(afterPrefix.combat.attacks.map((attack) => attack.oid)).toEqual([mogg]);
    expect(afterPrefix.combat.attacksSettled).toBe(1);
    const bear = oidOf(afterPrefix, BEAR.name);
    const second = pendingDecision(afterPrefix, 2);
    if (second?.kind !== 'declareAttackers') throw new Error('expected second attacker decision');
    expect(second.options).toEqual([
      {
        type: 'declareAttackers',
        player: 0,
        attackers: [
          { oid: mogg, defender: 1 },
          { oid: bear, defender: 1 },
        ],
      },
    ]);
  });

  it('rejects a sole blocking Flunkies but accepts a companion on another attacker', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: OTHER_BEAR, controller: 0 },
        { card: MOGG, controller: 1 },
        { card: KNIGHT, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const bear = oidOf(start, BEAR.name);
    const other = oidOf(start, OTHER_BEAR.name);
    const blockers = toBlockers(start, [bear, other]);
    const mogg = oidOf(blockers, MOGG.name);
    const knight = oidOf(blockers, KNIGHT.name);
    expect(
      validateAction(blockers, {
        type: 'declareBlockers',
        player: 1,
        blocks: [{ blocker: mogg, attacker: bear }],
      }),
    ).toMatch(/alone/i);
    expect(
      validateAction(blockers, {
        type: 'declareBlockers',
        player: 1,
        blocks: [
          { blocker: mogg, attacker: bear },
          { blocker: knight, attacker: other },
        ],
      }),
    ).toBeNull();
  });

  it('enumerates every full block legally and keeps an incremental Mogg prefix completable', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: OTHER_BEAR, controller: 0 },
        { card: MOGG, controller: 1 },
        { card: KNIGHT, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const bear = oidOf(start, BEAR.name);
    const other = oidOf(start, OTHER_BEAR.name);
    const blockState = toBlockers(start, [bear, other]);
    const mogg = oidOf(blockState, MOGG.name);
    const knight = oidOf(blockState, KNIGHT.name);
    const full = pendingDecision(blockState, 512);
    if (full?.kind !== 'declareBlockers') throw new Error('expected full blocker decision');
    expect(
      full.options.some(
        (action) =>
          action.type === 'declareBlockers' &&
          action.blocks.length === 1 &&
          action.blocks[0]?.blocker === mogg,
      ),
    ).toBe(false);
    expect(
      full.options.some(
        (action) =>
          action.type === 'declareBlockers' &&
          action.blocks.some((block) => block.blocker === mogg) &&
          action.blocks.some((block) => block.blocker === knight),
      ),
    ).toBe(true);

    const first = pendingDecision(blockState, 2);
    if (first?.kind !== 'declareBlockers') throw new Error('expected incremental blocker decision');
    const moggPrefix = first.options.find(
      (action) => action.type === 'declareBlockers' && action.blocks.some((block) => block.blocker === mogg),
    );
    if (moggPrefix === undefined) throw new Error('Mogg block prefix was not offered');
    const afterPrefix = reduce(blockState, moggPrefix).state;
    const second = pendingDecision(afterPrefix, 2);
    if (second?.kind !== 'declareBlockers') throw new Error('expected companion blocker decision');
    expect(second.options.length).toBeGreaterThan(0);
    expect(
      second.options.every(
        (action) =>
          action.type === 'declareBlockers' && action.blocks.some((block) => block.blocker === knight),
      ),
    ).toBe(true);
  });

  it('treats a compelled solo Flunkies as unable and a lone Flunkies as unable to satisfy lure', () => {
    const attackState = scenario({
      battlefield: [{ card: FORCED_MOGG, controller: 0 }],
      active: 0,
      step: 'declareAttackers',
    }).state;
    expect(validateAction(attackState, swing(0))).toBeNull();
    const attackDecision = pendingDecision(attackState);
    if (attackDecision?.kind !== 'declareAttackers') throw new Error('expected attacker decision');
    expect(attackDecision.options).toEqual([swing(0)]);

    const blockStart = scenario({
      battlefield: [
        { card: LURE, controller: 0 },
        { card: MOGG, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const lure = oidOf(blockStart, LURE.name);
    const blockState = toBlockers(blockStart, [lure]);
    expect(satisfyMustBeBlocked(blockState, [])).toEqual([]);
    const loneMogg = oidOf(blockState, MOGG.name);
    expect(satisfyMustBeBlocked(blockState, [{ blocker: loneMogg, attacker: lure }])).toEqual([]);
    expect(validateAction(blockState, { type: 'declareBlockers', player: 1, blocks: [] })).toBeNull();
  });

  it('completes constructed solo-Mogg blocks with a companion before returning them', () => {
    for (const attackerCard of [BEAR, LURE]) {
      const start = scenario({
        battlefield: [
          { card: attackerCard, controller: 0 },
          { card: MOGG, controller: 1 },
          { card: KNIGHT, controller: 1 },
        ],
        active: 0,
        step: 'declareAttackers',
      }).state;
      const attacker = oidOf(start, attackerCard.name);
      const blockState = toBlockers(start, [attacker]);
      const mogg = oidOf(blockState, MOGG.name);
      const knight = oidOf(blockState, KNIGHT.name);
      const repaired = satisfyMustBeBlocked(blockState, [{ blocker: mogg, attacker }]);
      expect(repaired).toEqual([
        { blocker: mogg, attacker },
        { blocker: knight, attacker },
      ]);
      expect(validateAction(blockState, { type: 'declareBlockers', player: 1, blocks: repaired })).toBeNull();
    }
  });

  it('maximizes simultaneous flying and menace requirements before accepting a cohort', () => {
    const start = scenario({
      battlefield: [
        { card: FLYING_LURE, controller: 0 },
        { card: MENACE_LURE, controller: 0 },
        { card: FLYING_MOGG, controller: 1 },
        { card: BEAR, controller: 1 },
        { card: OTHER_BEAR, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const flyingLure = oidOf(start, FLYING_LURE.name);
    const menaceLure = oidOf(start, MENACE_LURE.name);
    const blockState = toBlockers(start, [flyingLure, menaceLure]);
    const mogg = oidOf(blockState, FLYING_MOGG.name);
    const groundOne = oidOf(blockState, BEAR.name);
    const groundTwo = oidOf(blockState, OTHER_BEAR.name);
    const under = [
      { blocker: mogg, attacker: menaceLure },
      { blocker: groundOne, attacker: menaceLure },
    ];
    const full = [
      { blocker: mogg, attacker: flyingLure },
      { blocker: groundOne, attacker: menaceLure },
      { blocker: groundTwo, attacker: menaceLure },
    ];

    expect(validateAction(blockState, { type: 'declareBlockers', player: 1, blocks: under })).toBe(
      'not as many creatures able to block a must-be-blocked attacker are blocking it as jointly possible',
    );
    expect(validateAction(blockState, { type: 'declareBlockers', player: 1, blocks: full })).toBeNull();

    const whole = pendingDecision(blockState, 512);
    if (whole?.kind !== 'declareBlockers') throw new Error('expected full blocker decision');
    expect(
      whole.options.some(
        (action) =>
          action.type === 'declareBlockers' && JSON.stringify(action.blocks) === JSON.stringify(under),
      ),
    ).toBe(false);
    expect(
      whole.options.some(
        (action) =>
          action.type === 'declareBlockers' && JSON.stringify(action.blocks) === JSON.stringify(full),
      ),
    ).toBe(true);

    let stepped = blockState;
    for (const prefix of [full.slice(0, 1), full.slice(0, 2), full]) {
      const decision = pendingDecision(stepped, 2);
      if (decision?.kind !== 'declareBlockers') throw new Error('expected stepped blocker decision');
      const option = decision.options.find(
        (action) =>
          action.type === 'declareBlockers' && JSON.stringify(action.blocks) === JSON.stringify(prefix),
      );
      if (option === undefined) throw new Error('expected exact block prefix');
      stepped = reduce(stepped, option).state;
    }
    expect(pendingDecision(stepped)?.kind).not.toBe('declareBlockers');
  });
});
