import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import {
  eventsOfType,
  legalActions,
  pendingDecision,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { creature, instant, ISLAND, MOUNTAIN, sorcery } from './cards';

const bolt = instant('Test Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
  generic: 1,
  R: 1,
});
const counter = instant('Test Counter', [{ kind: 'counterSpell' }], { generic: 1, U: 1 });
const ritualDraw = sorcery('Test Study', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }], {
  generic: 1,
  U: 1,
});
const bear = creature('Test Bear', 2, 2, { cost: { generic: 1, G: 1 } });
const blueTrick = instant('Test Respite', [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }], {
  generic: 1,
  U: 1,
});

function mountains(count: number): { card: typeof MOUNTAIN; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as const }));
}

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

describe('priority', () => {
  it('alternates and returns to the caster after they put a spell on the stack', () => {
    const start = scenario({
      battlefield: [...mountains(2), { card: ISLAND, controller: 1 }, { card: ISLAND, controller: 1 }],
      hands: [[bolt], []],
    });
    expect(start.state.turn.priority).toBe(0);
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [{ kind: 'player', player: 1 }],
    });
    // CR 117.3c: the caster keeps priority after casting.
    expect(cast.state.turn.priority).toBe(0);
    expect(cast.state.stack).toHaveLength(1);

    const passed = reduce(cast.state, pass(cast.state));
    expect(passed.state.turn.priority).toBe(1);
    expect(passed.state.stack).toHaveLength(1);
  });

  it('resolves the top of the stack when both players pass in succession', () => {
    const start = scenario({
      battlefield: mountains(2),
      hands: [[bolt], []],
      life: [20, 20],
    });
    const oid = playerOf(start.state, 0).hand[0] ?? '';
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [{ kind: 'player', player: 1 }],
    });
    const both = reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]);
    expect(both.state.stack).toHaveLength(0);
    expect(both.state.players[1].life).toBe(17);
    expect(eventsOfType(both.events, 'resolutionBegan')).toHaveLength(1);
  });

  it('advances the step when both players pass with an empty stack', () => {
    const start = scenario({ battlefield: mountains(1) });
    expect(start.state.turn.step).toBe('precombatMain');
    const advanced = reduceAll(start.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(advanced.state.turn.step).toBe('beginCombat');
    expect(advanced.state.turn.priority).toBe(0);
  });
});

describe('stack', () => {
  it('resolves last in, first out', () => {
    const start = scenario({
      battlefield: [
        ...mountains(4),
        { card: ISLAND, controller: 1 },
        { card: ISLAND, controller: 1 },
        { card: ISLAND, controller: 1 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[bolt, bolt], []],
      life: [20, 20],
    });
    const [first, second] = playerOf(start.state, 0).hand;
    const one = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: first ?? '',
      targets: [{ kind: 'player', player: 1 }],
    });
    const two = reduce(one.state, {
      type: 'castSpell',
      player: 0,
      oid: second ?? '',
      targets: [{ kind: 'player', player: 1 }],
    });
    expect(two.state.stack.map((entry) => entry.oid)).toEqual([first, second]);

    const resolved = reduceAll(two.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    // Only the top object resolves; the first spell is still waiting.
    expect(resolved.state.stack.map((entry) => entry.oid)).toEqual([first]);
    const order = eventsOfType(resolved.events, 'resolutionBegan').map((event) => event.oid);
    expect(order).toEqual([second]);
  });

  it('lets a counterspell answer the spell beneath it', () => {
    const start = scenario({
      battlefield: [...mountains(2), { card: ISLAND, controller: 1 }, { card: ISLAND, controller: 1 }],
      hands: [[bolt], [counter]],
      life: [20, 20],
    });
    const boltOid = playerOf(start.state, 0).hand[0] ?? '';
    const counterOid = playerOf(start.state, 1).hand[0] ?? '';
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: boltOid,
      targets: [{ kind: 'player', player: 1 }],
    });
    const passed = reduce(cast.state, { type: 'passPriority', player: 0 });
    const countered = reduce(passed.state, {
      type: 'castSpell',
      player: 1,
      oid: counterOid,
      targets: [{ kind: 'spell', oid: boltOid }],
    });
    const done = reduceAll(countered.state, [
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(eventsOfType(done.events, 'spellCountered').map((event) => event.oid)).toEqual([boltOid]);
    expect(done.state.players[1].life).toBe(20);
    expect(done.state.players[0].graveyard).toContain(boltOid);
  });

  it('fizzles a spell whose only target became illegal', () => {
    const start = scenario({
      battlefield: [
        ...mountains(4),
        { card: ISLAND, controller: 1 },
        { card: ISLAND, controller: 1 },
        { card: bear, controller: 1 },
      ],
      hands: [[bolt, bolt], []],
      life: [20, 20],
    });
    const bearOid = start.state.battlefield.find(
      (oid) => start.state.objects[oid]?.card.name === 'Test Bear',
    );
    const [firstBolt, secondBolt] = playerOf(start.state, 0).hand;
    const one = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: firstBolt ?? '',
      targets: [{ kind: 'permanent', oid: bearOid ?? '' }],
    });
    const two = reduce(one.state, {
      type: 'castSpell',
      player: 0,
      oid: secondBolt ?? '',
      targets: [{ kind: 'permanent', oid: bearOid ?? '' }],
    });
    // Top bolt kills the bear; the bottom bolt has nothing left to hit.
    const done = reduceAll(two.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    expect(eventsOfType(done.events, 'spellFizzled').map((event) => event.oid)).toEqual([firstBolt]);
    expect(done.state.players[1].life).toBe(20);
  });
});

describe('timing', () => {
  it('allows instants but not sorceries when the opponent has priority', () => {
    const start = scenario({
      battlefield: [
        { card: ISLAND, controller: 1 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[], [blueTrick, ritualDraw]],
    });
    const passed = reduce(start.state, { type: 'passPriority', player: 0 });
    const [instantOid, sorceryOid] = playerOf(passed.state, 1).hand;
    const casts = legalActions(passed.state).filter((action) => action.type === 'castSpell');
    expect(casts.map((action) => action.oid)).toContain(instantOid);
    expect(casts.map((action) => action.oid)).not.toContain(sorceryOid);
    expect(
      validateAction(passed.state, { type: 'castSpell', player: 1, oid: sorceryOid ?? '', targets: [null] }),
    ).toMatch(/timing/);
  });

  it('offers exactly one land drop per turn', () => {
    const start = scenario({ hands: [[MOUNTAIN, MOUNTAIN], []] });
    const landOptions = legalActions(start.state).filter((action) => action.type === 'playLand');
    expect(landOptions).toHaveLength(2);
    const played = reduce(start.state, {
      type: 'playLand',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
    });
    expect(legalActions(played.state).filter((action) => action.type === 'playLand')).toHaveLength(0);
    expect(played.state.turn.landsPlayed).toBe(1);
  });

  it('reports the decision it is waiting on', () => {
    const start = scenario({ battlefield: mountains(1) });
    const decision = pendingDecision(start.state);
    expect(decision?.kind).toBe('priority');
    expect(decision?.player).toBe(0);
    expect(decision?.options.some((action) => action.type === 'passPriority')).toBe(true);
    // Conceding is legal but never enumerated, so a uniform sampler cannot pick it.
    expect(decision?.options.some((action) => action.type === 'concede')).toBe(false);
    expect(validateAction(start.state, { type: 'concede', player: 0 })).toBeNull();
  });
});
