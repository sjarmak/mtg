/** Safe Passage through the state-aware damage replacement pipeline. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import {
  applyDamage,
  applyReplacements,
  beginTrace,
  cleanupTurnEffects,
  controllerOf,
  counterCount,
  eventsOfType,
  reduce,
  reduceAll,
  scenario,
  type DamageInstance,
  type GameState,
  type ObjectId,
  type ReplacementEffect,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { creature, instant, planeswalker, PLAINS, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const SAFE_PASSAGE: Card = instant(
  'Safe Passage',
  [{ kind: 'preventAllDamageToYouAndCreaturesYouControl' }],
  { generic: 2, W: 1 },
);

const ACT: Card = sorcery(
  'Safe Passage Control Shift',
  [{ kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } }],
  { generic: 1 },
);

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function lands(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller: 0 as const }));
}

function castAndResolve(start: ReduceResult, card: Card, targets: readonly (Target | null)[]): ReduceResult {
  const cast = reduce(start.state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, card.name),
    targets,
  });
  const resolved = reduceAll(cast.state, PASSES);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function damage(
  sourceOid: ObjectId,
  recipient: DamageInstance['recipient'],
  amount = 3,
  combat = false,
): DamageInstance {
  return {
    sourceOid,
    controller: 1,
    recipient,
    amount,
    deathtouch: false,
    lifelink: false,
    preventable: true,
    combat,
  };
}

function permanent(state: GameState, name: string): DamageInstance['recipient'] {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

function shieldedBoard(extraHand: readonly Card[] = []): ReduceResult {
  return scenario({
    battlefield: [
      { card: creature('Safe Bear', 2, 5), controller: 0 },
      { card: planeswalker('Safe Walker', 5, []), controller: 0 },
      { card: creature('Outside Bear', 2, 5), controller: 1 },
      { card: creature('Damage Source', 1, 1), controller: 1 },
      ...lands(4),
    ],
    hands: [[SAFE_PASSAGE, ...extraHand], []],
  });
}

describe('Safe Passage in the kernel', () => {
  it('prevents combat and noncombat damage to its controller and their creatures, but nobody else', () => {
    const shielded = castAndResolve(shieldedBoard(), SAFE_PASSAGE, [null]);
    const source = oidOf(shielded.state, 'Damage Source');
    const safeBear = oidOf(shielded.state, 'Safe Bear');
    const safeWalker = oidOf(shielded.state, 'Safe Walker');
    const outsideBear = oidOf(shielded.state, 'Outside Bear');
    const done = applyDamage(beginTrace(shielded.state), [
      damage(source, { kind: 'player', player: 0 }),
      damage(source, { kind: 'player', player: 1 }),
      damage(source, { kind: 'permanent', oid: safeBear }, 3, true),
      damage(source, { kind: 'permanent', oid: safeWalker }),
      damage(source, { kind: 'permanent', oid: outsideBear }),
    ]);
    const safeWalkerObject = done.state.objects[safeWalker];
    if (safeWalkerObject === undefined) throw new Error('Safe Walker left the state');

    expect(done.state.players.map((player) => player.life)).toEqual([20, 17]);
    expect(done.state.objects[safeBear]?.damage).toBe(0);
    expect(counterCount(safeWalkerObject.counters, 'loyalty')).toBe(2);
    expect(done.state.objects[outsideBear]?.damage).toBe(3);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(2);
    expect(eventsOfType(done.events, 'damageDealt')).toHaveLength(3);
  });

  it('reads creature control when damage happens instead of freezing the board at resolution', () => {
    const shielded = castAndResolve(shieldedBoard([ACT]), SAFE_PASSAGE, [null]);
    const outside = oidOf(shielded.state, 'Outside Bear');
    const stolen = castAndResolve(shielded, ACT, [{ kind: 'permanent', oid: outside }]);
    expect(controllerOf(stolen.state, outside)).toBe(0);

    const source = oidOf(stolen.state, 'Damage Source');
    const done = applyDamage(beginTrace(stolen.state), [
      damage(source, permanent(stolen.state, 'Outside Bear')),
    ]);
    expect(done.state.objects[outside]?.damage).toBe(0);
    expect(eventsOfType(done.events, 'damagePrevented')).toHaveLength(1);
  });

  it('joins the CR 616 loop when an earlier replacement redirects damage into its live scope', () => {
    const shielded = castAndResolve(shieldedBoard(), SAFE_PASSAGE, [null]);
    const source = oidOf(shielded.state, 'Damage Source');
    const safeBear = oidOf(shielded.state, 'Safe Bear');
    const outsideBear = oidOf(shielded.state, 'Outside Bear');
    const redirect: ReplacementEffect = {
      id: 'safe-passage-test-redirect',
      sourceOid: source,
      controller: 0,
      timestamp: shielded.state.nextId,
      duration: 'endOfTurn',
      selfReplacement: false,
      trigger: {
        kind: 'damage',
        toPlayer: null,
        toPermanent: outsideBear,
        toController: null,
        toPermanentCardType: null,
        fromSource: null,
        fromSpellSource: null,
        combatOnly: false,
      },
      modification: { kind: 'redirectDamage', to: { kind: 'permanent', oid: safeBear } },
    };
    const state = {
      ...shielded.state,
      replacements: [...shielded.state.replacements, redirect],
    };
    const safePassageEffect = state.replacements.find(
      (effect) =>
        effect.trigger.kind === 'damage' &&
        effect.trigger.toController === 0 &&
        effect.trigger.toPermanentCardType === 'creature',
    );
    if (safePassageEffect === undefined) throw new Error('Safe Passage did not install its shield');
    const outcome = applyReplacements(state, {
      kind: 'damage',
      ...damage(source, { kind: 'permanent', oid: outsideBear }),
    });

    expect(outcome.appliedIds).toEqual(['safe-passage-test-redirect', safePassageEffect.id]);
    expect(outcome.event).toBeNull();
  });

  it('expires at cleanup with the rest of the turn-long replacement effects', () => {
    const shielded = castAndResolve(shieldedBoard(), SAFE_PASSAGE, [null]);
    const cleaned = cleanupTurnEffects(beginTrace(shielded.state));
    const source = oidOf(cleaned.state, 'Damage Source');
    const safeBear = oidOf(cleaned.state, 'Safe Bear');
    const done = applyDamage(beginTrace(cleaned.state), [
      damage(source, { kind: 'permanent', oid: safeBear }),
    ]);

    expect(done.state.objects[safeBear]?.damage).toBe(3);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
  });
});
