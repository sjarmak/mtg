/** Bloodcrazed Goblin through damage, attack legality, and turn reset. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  legalActions,
  pendingDecision,
  scenario,
  validateAction,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const GOBLIN = parseCard({
  kind: 'creature',
  id: 'tst-bloodcrazed-goblin',
  name: 'Bloodcrazed Goblin',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 125 },
  colors: ['R'],
  manaCost: { R: 1 },
  power: 2,
  toughness: 2,
  subtypes: ['Goblin', 'Berserker'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: { kind: 'opponentUndamagedThisTurn' },
      modification: { kind: 'cantAttack' },
    },
  ],
});

const SPARK = parseCard({
  kind: 'instant',
  id: 'tst-bloodcrazed-spark',
  name: 'Bloodcrazed Spark',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  colors: ['R'],
  manaCost: { R: 1 },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetOpponent' } }],
});

const ESCORT = creature('Bloodcrazed Escort', 1, 1);

function settleStack(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 8; guard += 1) {
    if (walked.state.stack.length === 0) return walked;
    const decision = pendingDecision(walked.state);
    if (decision?.kind !== 'priority') throw new Error('Bloodcrazed stack stalled');
    walked = apply(walked, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Bloodcrazed Spark did not resolve');
}

function advanceToAttack(current: ReduceResult): ReduceResult {
  let walked = current;
  for (let guard = 0; guard < 120; guard += 1) {
    const decision = pendingDecision(walked.state);
    if (decision?.kind === 'declareAttackers') return walked;
    if (decision === null) throw new Error('Bloodcrazed game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`Bloodcrazed has no ${decision.kind} option`);
    walked = apply(walked, option);
  }
  throw new Error('Bloodcrazed never reached attackers');
}

function attackIsOffered(current: ReduceResult, goblin: ObjectId): boolean {
  return legalActions(current.state).some(
    (action) =>
      action.type === 'declareAttackers' && action.attackers.some((attack) => attack.oid === goblin),
  );
}

describe('Bloodcrazed Goblin', () => {
  it('rejects a direct illegal attack submission before opposing damage', () => {
    const start = advanceToAttack(
      scenario({
        battlefield: [
          { card: GOBLIN, controller: 0 },
          { card: ESCORT, controller: 0 },
        ],
      }),
    );
    const goblin = oidOf(start.state, GOBLIN.name);

    expect(
      validateAction(start.state, {
        type: 'declareAttackers',
        player: 0,
        attackers: [{ oid: goblin, defender: 1 }],
      }),
    ).toBe(`${goblin} cannot attack`);
  });

  it('does not unlock for damage to its controller and records repeated opposing damage once', () => {
    const start = advanceToAttack(
      scenario({
        battlefield: [
          { card: GOBLIN, controller: 0 },
          { card: ESCORT, controller: 0 },
        ],
      }),
    );
    const goblin = oidOf(start.state, GOBLIN.name);
    const damage = (player: 0 | 1) => ({
      sourceOid: goblin,
      controller: 0 as const,
      recipient: { kind: 'player' as const, player },
      amount: 1,
      preventable: true,
      deathtouch: false,
      lifelink: false,
      combat: false,
    });

    const selfDamaged = applyDamage(start, [damage(0)]);
    expect(selfDamaged.state.turn.playersDealtDamageThisTurn).toEqual([0]);
    expect(attackIsOffered(selfDamaged, goblin)).toBe(false);

    const opposingDamaged = applyDamage(selfDamaged, [damage(1), damage(1)]);
    expect(opposingDamaged.state.turn.playersDealtDamageThisTurn).toEqual([0, 1]);
    expect(attackIsOffered(opposingDamaged, goblin)).toBe(true);
  });

  it('cannot attack before opposing damage, can after it, and is restricted again next turn', () => {
    const untouched = scenario({
      battlefield: [
        { card: GOBLIN, controller: 0 },
        { card: ESCORT, controller: 0 },
      ],
    });
    const untouchedGoblin = oidOf(untouched.state, GOBLIN.name);
    expect(attackIsOffered(advanceToAttack(untouched), untouchedGoblin)).toBe(false);

    const opened = scenario({
      battlefield: [
        { card: GOBLIN, controller: 0 },
        { card: ESCORT, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[SPARK], []],
    });
    const goblin = oidOf(opened.state, GOBLIN.name);
    const cast = apply(opened, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(opened.state, 0, SPARK.name),
      targets: [{ kind: 'player', player: 1 }],
    });
    const damaged = settleStack(cast);
    expect(damaged.state.turn.playersDealtDamageThisTurn).toEqual([1]);
    const firstAttack = advanceToAttack(damaged);
    expect(attackIsOffered(firstAttack, goblin)).toBe(true);

    const declared = apply(firstAttack, { type: 'declareAttackers', player: 0, attackers: [] });
    const nextAttack = advanceToAttack(declared);
    expect(nextAttack.state.turn.number).toBeGreaterThan(firstAttack.state.turn.number);
    expect(nextAttack.state.turn.playersDealtDamageThisTurn).toEqual([]);
    expect(attackIsOffered(nextAttack, goblin)).toBe(false);
  });
});
