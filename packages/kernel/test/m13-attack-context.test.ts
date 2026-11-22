import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  advanceToStep,
  eventsOfType,
  pendingDecision,
  reduce,
  scenario,
  simpleAgent,
  validateAction,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { creature, enchantment, instant, ISLAND, planeswalker } from './cards';
import { handOidOf, oidOf } from './helpers';

const ODRIC = creature('Odric, Master Tactician', 3, 4, {
  keywords: ['firstStrike'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAndThreeOthersAttack',
      effects: [{ kind: 'chooseBlockersThisCombat' }],
    },
  ],
});
const SOLDIER = creature('Odric Soldier', 2, 2);
const SECOND = creature('Second Soldier', 2, 2);
const THIRD = creature('Third Soldier', 2, 2);
const DEFENDER = creature('Defending Bear', 2, 2);
const OTHER_DEFENDER = creature('Other Defending Bear', 2, 2);
const DOMINANT_DEFENDER = creature('Dominant Defending Bear', 6, 6);
const PALACE_GUARD = creature('Palace Guard', 1, 4, {
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'canBlockAnyNumber' },
    },
  ],
});
const WALKER = planeswalker('Defending Walker', 4, []);
const SIEGE = parseCard({
  kind: 'battle',
  id: 'tst-defended-siege',
  name: 'Defended Siege',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 12 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  subtypes: ['Siege'],
  defense: 4,
  backFace: {
    kind: 'creature',
    name: 'Conquered Siege',
    colors: ['R'],
    subtypes: ['Warrior'],
    keywords: [],
    power: 4,
    toughness: 4,
  },
});
const UNSUMMON = instant('Unsummon', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }], {
  U: 1,
});

const BLOOD_RECKONING = enchantment('Blood Reckoning', { generic: 3, B: 1 }, [
  {
    kind: 'triggered',
    condition: 'creatureAttacksYouOrPlaneswalkerYouControl',
    effects: [{ kind: 'loseLife', amount: 1, target: { kind: 'triggeringPlayer' } }],
  },
]);

const NEFAROX = creature('Nefarox, Overlord of Grixis', 5, 5, {
  keywords: ['flying'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacksAlone',
      effects: [
        {
          kind: 'sacrificePermanent',
          target: { kind: 'triggeringPlayer' },
          filter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
});

function passPriority(result: ReduceResult, stop: (state: GameState) => boolean): ReduceResult {
  let current = result;
  for (let guard = 0; guard < 40; guard += 1) {
    if (stop(current.state)) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`unexpected ${decision?.kind ?? 'no'} decision`);
    current = reduce(current.state, { type: 'passPriority', player: decision.player });
  }
  throw new Error('priority loop did not reach its stop');
}

describe('retained attackers-declared context', () => {
  it('fires Blood Reckoning once per attacker and retains the attacking controller', () => {
    const start = scenario({
      battlefield: [
        { card: BLOOD_RECKONING, controller: 0 },
        { card: WALKER, controller: 0 },
        { card: SOLDIER, controller: 1 },
        { card: SECOND, controller: 1 },
      ],
      active: 1,
      step: 'declareAttackers',
    }).state;
    const walker = oidOf(start, WALKER.name);
    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 1,
      attackers: [
        { oid: oidOf(start, SOLDIER.name), defender: 0 },
        { oid: oidOf(start, SECOND.name), defender: { kind: 'planeswalker', oid: walker } },
      ],
    });
    expect(eventsOfType(declared.events, 'abilityTriggered')).toHaveLength(2);
    expect(declared.state.stack.map((entry) => entry.triggerContext)).toEqual([
      { kind: 'creatureAttacksYouOrPlaneswalkerYouControl', triggeringPlayer: 1 },
      { kind: 'creatureAttacksYouOrPlaneswalkerYouControl', triggeringPlayer: 1 },
    ]);
    const resolved = passPriority(declared, (state) => state.stack.length === 0);
    expect(resolved.state.players[1]?.life).toBe(18);
  });

  it('retains the planeswalker controller as Nefarox defending player and asks that player to sacrifice', () => {
    const start = scenario({
      battlefield: [
        { card: WALKER, controller: 0 },
        { card: DEFENDER, controller: 0 },
        { card: OTHER_DEFENDER, controller: 0 },
        { card: NEFAROX, controller: 1 },
      ],
      active: 1,
      step: 'declareAttackers',
    }).state;
    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 1,
      attackers: [
        {
          oid: oidOf(start, NEFAROX.name),
          defender: { kind: 'planeswalker', oid: oidOf(start, WALKER.name) },
        },
      ],
    });
    expect(declared.state.stack[0]?.triggerContext).toEqual({
      kind: 'selfAttacksAlone',
      triggeringPlayer: 0,
    });
    const asking = passPriority(declared, (state) => pendingDecision(state)?.kind === 'permanentSacrifice');
    const decision = pendingDecision(asking.state);
    if (decision?.kind !== 'permanentSacrifice') throw new Error('defending player was not asked');
    expect(decision.player).toBe(0);
    expect(decision.permanents).toEqual([
      oidOf(asking.state, DEFENDER.name),
      oidOf(asking.state, OTHER_DEFENDER.name),
    ]);
    const done = reduce(asking.state, {
      type: 'sacrificePermanent',
      player: 0,
      oid: oidOf(asking.state, DEFENDER.name),
    });
    expect(eventsOfType(done.events, 'permanentSacrificed')).toHaveLength(1);
  });

  it('retains a Battle protector rather than its controller as Nefarox defending player', () => {
    const start = scenario({
      battlefield: [
        { card: SIEGE, controller: 1, protector: 0 },
        { card: DEFENDER, controller: 0 },
        { card: NEFAROX, controller: 1 },
      ],
      active: 1,
      step: 'declareAttackers',
    }).state;
    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 1,
      attackers: [
        {
          oid: oidOf(start, NEFAROX.name),
          defender: { kind: 'battle', oid: oidOf(start, SIEGE.name) },
        },
      ],
    });

    expect(declared.state.stack[0]?.triggerContext).toEqual({
      kind: 'selfAttacksAlone',
      triggeringPlayer: 0,
    });
  });

  it('does not fire either source predicate at the wrong attacker count', () => {
    const start = scenario({
      battlefield: [
        { card: ODRIC, controller: 0 },
        { card: NEFAROX, controller: 0 },
        { card: SOLDIER, controller: 0 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [
        { oid: oidOf(start, ODRIC.name), defender: 1 },
        { oid: oidOf(start, NEFAROX.name), defender: 1 },
      ],
    });
    expect(eventsOfType(declared.events, 'abilityTriggered')).toEqual([]);
  });
});

describe('Odric block-declaration authority', () => {
  it('makes the simple agent decline a voluntary block that helps the defending side', () => {
    const start = scenario({
      battlefield: [
        { card: ODRIC, controller: 0 },
        { card: SOLDIER, controller: 0 },
        { card: SECOND, controller: 0 },
        { card: THIRD, controller: 0 },
        { card: DOMINANT_DEFENDER, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacks = [ODRIC, SOLDIER, SECOND, THIRD].map((card) => ({
      oid: oidOf(start, card.name),
      defender: 1 as const,
    }));
    const declared = reduce(start, { type: 'declareAttackers', player: 0, attackers: attacks });
    const resolved = passPriority(declared, (state) => state.stack.length === 0);
    const blockers = passPriority(resolved, (state) => pendingDecision(state)?.kind === 'declareBlockers');
    const decision = pendingDecision(blockers.state);
    if (decision?.kind !== 'declareBlockers') throw new Error('block declaration was not pending');
    expect(
      simpleAgent('authority').decide({
        state: observeState(blockers.state, 0, 'test/m13-attack-context.test.ts:246'),
        player: 0,
        decision,
      }),
    ).toEqual({
      type: 'declareBlockers',
      player: 0,
      blocks: [],
    });
  });

  it('retains the triggering controller after Odric leaves the battlefield', () => {
    const start = scenario({
      battlefield: [
        { card: ODRIC, controller: 0 },
        { card: SOLDIER, controller: 0 },
        { card: SECOND, controller: 0 },
        { card: THIRD, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: DEFENDER, controller: 1 },
      ],
      hands: [[UNSUMMON], []],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const odric = oidOf(start, ODRIC.name);
    const attacks = [ODRIC, SOLDIER, SECOND, THIRD].map((card) => ({
      oid: oidOf(start, card.name),
      defender: 1 as const,
    }));
    const declared = reduce(start, { type: 'declareAttackers', player: 0, attackers: attacks });
    const responded = reduce(declared.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(declared.state, 0, UNSUMMON.name),
      targets: [{ kind: 'permanent', oid: odric }],
    });
    const departed = passPriority(responded, (state) => state.objects[odric]?.zone === 'hand');
    const resolved = passPriority(departed, (state) => state.stack.length === 0);
    expect(resolved.state.combat.blockDeclarationAuthority).toBe(0);
    const blockers = passPriority(resolved, (state) => pendingDecision(state)?.kind === 'declareBlockers');
    expect(pendingDecision(blockers.state)).toEqual(
      expect.objectContaining({ kind: 'declareBlockers', player: 0 }),
    );
  });

  it('lets Odric submit the defending creatures legal blocks for only this combat', () => {
    const start = scenario({
      battlefield: [
        { card: ODRIC, controller: 0 },
        { card: SOLDIER, controller: 0 },
        { card: SECOND, controller: 0 },
        { card: THIRD, controller: 0 },
        { card: DEFENDER, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacks = [ODRIC, SOLDIER, SECOND, THIRD].map((card) => ({
      oid: oidOf(start, card.name),
      defender: 1 as const,
    }));
    const declared = reduce(start, { type: 'declareAttackers', player: 0, attackers: attacks });
    const odric = oidOf(declared.state, ODRIC.name);
    const source = declared.state.objects[odric];
    if (source === undefined) throw new Error('Odric source vanished');
    const changedController: ReduceResult = {
      ...declared,
      state: {
        ...declared.state,
        objects: { ...declared.state.objects, [odric]: { ...source, controller: 1 } },
      },
    };
    const resolved = passPriority(changedController, (state) => state.stack.length === 0);
    expect(resolved.state.combat.blockDeclarationAuthority).toBe(0);
    const blockers = passPriority(resolved, (state) => pendingDecision(state)?.kind === 'declareBlockers');
    const decision = pendingDecision(blockers.state);
    if (decision?.kind !== 'declareBlockers') throw new Error('block declaration was not pending');
    expect(decision.player).toBe(0);
    expect(decision.eligible).toEqual([oidOf(blockers.state, DEFENDER.name)]);
    const legal = {
      type: 'declareBlockers' as const,
      player: 0 as const,
      blocks: [
        { blocker: oidOf(blockers.state, DEFENDER.name), attacker: oidOf(blockers.state, ODRIC.name) },
      ],
    };
    expect(validateAction(blockers.state, legal)).toBeNull();
    expect(
      validateAction(blockers.state, {
        ...legal,
        blocks: [
          { blocker: oidOf(blockers.state, SOLDIER.name), attacker: oidOf(blockers.state, ODRIC.name) },
        ],
      }),
    ).not.toBeNull();
    const blocked = reduce(blockers.state, legal);
    expect(advanceToStep(blocked, 'postcombatMain').state.combat.blockDeclarationAuthority).toBeUndefined();
  });

  it('does not transfer the defending player damage-order decision', () => {
    const start = scenario({
      battlefield: [
        { card: ODRIC, controller: 0 },
        { card: SOLDIER, controller: 0 },
        { card: SECOND, controller: 0 },
        { card: THIRD, controller: 0 },
        { card: PALACE_GUARD, controller: 1 },
      ],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacks = [ODRIC, SOLDIER, SECOND, THIRD].map((card) => ({
      oid: oidOf(start, card.name),
      defender: 1 as const,
    }));
    const declared = reduce(start, { type: 'declareAttackers', player: 0, attackers: attacks });
    const resolved = passPriority(declared, (state) => state.stack.length === 0);
    const blockers = passPriority(resolved, (state) => pendingDecision(state)?.kind === 'declareBlockers');
    const guard = oidOf(blockers.state, PALACE_GUARD.name);
    const blocked = reduce(blockers.state, {
      type: 'declareBlockers',
      player: 0,
      blocks: [
        { blocker: guard, attacker: oidOf(blockers.state, ODRIC.name) },
        { blocker: guard, attacker: oidOf(blockers.state, SOLDIER.name) },
      ],
    });
    expect(pendingDecision(blocked.state)).toEqual(
      expect.objectContaining({ kind: 'orderAttackers', player: 1 }),
    );
  });
});
