/**
 * `preventAllDamageToTarget`: CR 615.1's other printed shape, Dawn Charm's
 * first mode ("Until end of turn, prevent all damage to target creature").
 *
 * `preventCombatDamage`'s own kernel test (`life-and-prevention.test.ts`,
 * `'prevented combat damage'`) already proves the blanket Fog. This file
 * proves the two ways this sibling differs from it: the shield is aimed at
 * one object rather than at the whole table, and it stops every source of
 * damage rather than only combat. Three claims:
 *
 *  1. The shield stops non-combat damage — a burn spell — which
 *     `preventCombatDamage`'s `combatOnly: true` trigger never would.
 *  2. The shield is aimed: a second creature with no shield of its own still
 *     takes damage in the same turn.
 *  3. The shield is gone next turn, exactly as `cleanupTurnEffects` expires
 *     any other `endOfTurn` replacement record.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, pendingDecision, reduce, reduceAll } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { creature, instant, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf, playCombat } from './helpers';

const SHIELD: Card = instant('Test Shield', [
  { kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } },
]);

const BOLT_CREATURE: Card = instant(
  'Test Bolt Creature',
  [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }],
  { generic: 1, R: 1 },
);

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: ObjectId } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

/** Casts an instant-speed spell from player 0's hand and resolves it. */
function castAndResolve(start: ReduceResult, name: string, targets: readonly unknown[]): ReduceResult {
  const oid = handOidOf(start.state, 0, name);
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: targets as never,
  });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function lands(count: number, controller: 0 | 1): readonly { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

/** Passes priority until attackers are being declared, `life-and-prevention.test.ts`'s helper. */
function walkToDeclareAttackers(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 50; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('walkToDeclareAttackers: the game ended first');
    if (decision.kind === 'declareAttackers') return current;
    if (decision.kind !== 'priority') {
      throw new Error(`walkToDeclareAttackers: unexpected decision ${decision.kind}`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('walkToDeclareAttackers: never reached the declare step');
}

/** Idles forward: passes priority and takes the null option on every other decision. */
function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${turn}`);
}

describe('a targeted shield stops damage a blanket Fog would not', () => {
  it('prevents a burn spell aimed at the shielded creature', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(1, 0), ...lands(2, 0)],
      hands: [[SHIELD, BOLT_CREATURE], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    const shielded = castAndResolve(start, 'Test Shield', [permanentNamed(start.state, 'Test Bear')]);
    const done = castAndResolve(shielded, 'Test Bolt Creature', [
      permanentNamed(shielded.state, 'Test Bear'),
    ]);

    expect(eventsOfType(done.events, 'damageDealt')).toEqual([]);
    expect(done.state.objects[bearOid]?.damage).toBe(0);
    const prevented = eventsOfType(done.events, 'damagePrevented');
    expect(prevented).toHaveLength(1);
    expect(prevented[0]).toMatchObject({ amount: 3 });
  });

  it('prevents combat damage to the shielded creature exactly as a Fog would', () => {
    const bear = creature('Test Bear', 2, 2);
    const wall = creature('Test Wall', 0, 4);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, { card: wall, controller: 1 }, ...lands(1, 0)],
      hands: [[SHIELD], []],
    });
    const shielded = castAndResolve(start, 'Test Shield', [permanentNamed(start.state, 'Test Wall')]);
    const attacker = oidOf(shielded.state, 'Test Bear');
    const defender = oidOf(shielded.state, 'Test Wall');
    const done = playCombat(walkToDeclareAttackers(shielded), {
      attackers: [attacker],
      blocks: [{ blocker: defender, attacker }],
    });

    expect(
      eventsOfType(done.events, 'damageDealt').filter((event) => event.target.kind === 'permanent'),
    ).toEqual([]);
    expect(done.state.objects[defender]?.damage).toBe(0);
    const prevented = eventsOfType(done.events, 'damagePrevented');
    expect(prevented.some((event) => event.sourceOid === attacker)).toBe(true);
  });

  it('leaves a second, unshielded creature exposed in the same turn', () => {
    const bear = creature('Test Bear', 2, 2);
    // Toughness 5 rather than 2: a lethal hit would let the state-based action
    // move the object to the graveyard, and this test wants to read the
    // *damage marked* on the survivor, not referee a death it did not ask for.
    const target = creature('Test Target', 2, 5);
    const start = scenario({
      battlefield: [
        { card: bear, controller: 0 },
        { card: target, controller: 0 },
        ...lands(1, 0),
        ...lands(2, 0),
      ],
      hands: [[SHIELD, BOLT_CREATURE], []],
    });
    const targetOid = oidOf(start.state, 'Test Target');
    // The shield names the bear, not the second creature.
    const shielded = castAndResolve(start, 'Test Shield', [permanentNamed(start.state, 'Test Bear')]);
    const done = castAndResolve(shielded, 'Test Bolt Creature', [
      permanentNamed(shielded.state, 'Test Target'),
    ]);

    const dealt = eventsOfType(done.events, 'damageDealt');
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.amount).toBe(3);
    expect(done.state.objects[targetOid]?.damage).toBe(3);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
  });
});

describe('the shield is gone next turn', () => {
  it('lets the same burn spell through once end of turn has passed', () => {
    // Toughness 5, `'leaves a second, unshielded creature exposed'`'s reason:
    // 3 damage against a 2-toughness body is lethal, and this test wants the
    // damage marked on a survivor rather than a state-based destruction.
    const bear = creature('Test Bear', 2, 5);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(1, 0), ...lands(2, 0)],
      hands: [[SHIELD, BOLT_CREATURE], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    const shielded = castAndResolve(start, 'Test Shield', [permanentNamed(start.state, 'Test Bear')]);
    // The record is live immediately after casting, before any turn has passed.
    expect(
      shielded.state.replacements.some(
        (effect) =>
          effect.duration === 'endOfTurn' &&
          effect.trigger.kind === 'damage' &&
          effect.trigger.toPermanent === bearOid,
      ),
    ).toBe(true);

    // +2 rather than +1: two players alternate turns, and this test wants
    // player 0 holding priority again to cast the second spell, which is the
    // start of player 0's own next turn rather than the opponent's. The
    // shield does not care which of those two turn boundaries is asked for —
    // `cleanupTurnEffects` already swept it during turn 1's own cleanup step,
    // well before either.
    const nextTurn = passUntilTurn(shielded, shielded.state.turn.number + 2);
    // `cleanupTurnEffects` already swept the record; nothing aimed at the bear
    // remains in `state.replacements`.
    expect(
      nextTurn.state.replacements.some(
        (effect) => effect.trigger.kind === 'damage' && effect.trigger.toPermanent === bearOid,
      ),
    ).toBe(false);

    const done = castAndResolve(nextTurn, 'Test Bolt Creature', [
      permanentNamed(nextTurn.state, 'Test Bear'),
    ]);
    const dealt = eventsOfType(done.events, 'damageDealt');
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.amount).toBe(3);
    expect(done.state.objects[bearOid]?.damage).toBe(3);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
  });
});
