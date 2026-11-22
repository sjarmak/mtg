/** Native depleting prevention and linked retaliation for Vengeful Archon. */
import { describe, expect, it } from 'vitest';
import type { Action, DamageInstance, GameState, ObjectId, ReduceResult, Target } from '@mtg/kernel';
import {
  abilityObjectId,
  applyDamage,
  beginTrace,
  cleanupTurnEffects,
  counterCount,
  enterStep,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  serializeEvents,
  stateFingerprint,
  type ReplacementEffect,
} from '@mtg/kernel';
import { creature, lands, PLAINS, planeswalker } from './cards';
import { apply, oidOf } from './helpers';

const VENGEFUL_ARCHON = creature('Vengeful Archon', 7, 7, {
  cost: { generic: 4, W: 3 },
  keywords: ['flying'],
  subtypes: ['Archon'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { hasX: true } },
      effects: [
        {
          kind: 'preventNextDamageToYouAndRetaliate',
          amount: { kind: 'chosenX' },
          target: { kind: 'targetPlayerOrPlaneswalker' },
        },
      ],
    },
  ],
});

const WALKER = planeswalker('Archon Target Walker', 6, []);
const BURN_SOURCE = creature('Archon Burn Source', 1, 1);
const LIFELINK_SOURCE = creature('Archon Lifelink Source', 5, 5, { keywords: ['lifelink'] });

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: VENGEFUL_ARCHON, controller: 0 },
      { card: WALKER, controller: 1 },
      { card: BURN_SOURCE, controller: 1 },
      { card: LIFELINK_SOURCE, controller: 1 },
      ...lands(PLAINS, 7).map((card) => ({ card, controller: 0 as const })),
    ],
  });
}

function activation(
  from: ReduceResult,
  x: number,
  target: Target = { kind: 'player', player: 1 },
): Extract<Action, { type: 'activateAbility' }> {
  return {
    type: 'activateAbility',
    player: 0,
    oid: oidOf(from.state, VENGEFUL_ARCHON.name),
    abilityIndex: 0,
    targets: [target],
    sacrifices: [],
    x,
  };
}

function resolve(from: ReduceResult): ReduceResult {
  return PASSES.reduce(apply, from);
}

function activateAndResolve(x: number, target: Target = { kind: 'player', player: 1 }): ReduceResult {
  const start = board();
  return resolve(apply(start, activation(start, x, target)));
}

function damage(state: GameState, amount: number, source = BURN_SOURCE, lifelink = false): DamageInstance {
  return {
    sourceOid: oidOf(state, source.name),
    controller: 1,
    recipient: { kind: 'player', player: 0 },
    amount,
    deathtouch: false,
    lifelink,
    combat: false,
    preventable: true,
  };
}

function moved(from: ReduceResult, oid: ObjectId, destination: 'battlefield' | 'graveyard'): ReduceResult {
  const result = moveObject(beginTrace(from.state), oid, destination);
  return { state: result.state, events: [...from.events, ...result.events] };
}

function archonDamage(state: GameState, amounts: readonly number[]): ReturnType<typeof applyDamage> {
  return applyDamage(
    beginTrace(state),
    amounts.map((amount) => damage(state, amount)),
  );
}

describe('Vengeful Archon activation', () => {
  it('offers X=0, players, and planeswalkers but never creatures', () => {
    const start = board();
    const source = oidOf(start.state, VENGEFUL_ARCHON.name);
    const walker = oidOf(start.state, WALKER.name);
    const burnSource = oidOf(start.state, BURN_SOURCE.name);
    const choices = legalActions(start.state).filter(
      (action): action is Extract<Action, { type: 'activateAbility' }> =>
        action.type === 'activateAbility' && action.oid === source,
    );

    expect(choices.some((choice) => choice.x === 0)).toBe(true);
    expect(choices.some((choice) => choice.targets[0]?.kind === 'player')).toBe(true);
    expect(
      choices.some((choice) => choice.targets[0]?.kind === 'permanent' && choice.targets[0].oid === walker),
    ).toBe(true);
    expect(
      choices.some(
        (choice) => choice.targets[0]?.kind === 'permanent' && choice.targets[0].oid === burnSource,
      ),
    ).toBe(false);
  });

  it('makes X=0 a paid no-op and rejects a creature target', () => {
    const zero = activateAndResolve(0);
    expect(zero.state.replacements).toEqual([]);
    const damaged = archonDamage(zero.state, [2]);
    expect(damaged.state.players.map((player) => player.life)).toEqual([18, 20]);

    const start = board();
    expect(() =>
      reduce(
        start.state,
        activation(start, 1, { kind: 'permanent', oid: oidOf(start.state, BURN_SOURCE.name) }),
      ),
    ).toThrow(/target|legal/i);
  });

  it('fizzles when its sole planeswalker target leaves before resolution', () => {
    const start = board();
    const walker = oidOf(start.state, WALKER.name);
    const activated = apply(start, activation(start, 3, { kind: 'permanent', oid: walker }));
    const gone = moved(activated, walker, 'graveyard');
    const resolved = resolve(gone);

    expect(resolved.state.replacements).toEqual([]);
    expect(eventsOfType(resolved.events, 'effectSkipped').at(-1)?.why).toMatch(/target/);
  });
});

describe('Vengeful Archon shield', () => {
  it('depletes across full and partial damage events and retaliates once per prevented amount', () => {
    const resolved = activateAndResolve(5);
    const source = oidOf(resolved.state, VENGEFUL_ARCHON.name);
    const first = applyDamage(beginTrace(resolved.state), [damage(resolved.state, 2)]);
    const done = applyDamage(first, [damage(first.state, 4)]);
    const retaliation = eventsOfType(done.events, 'damageDealt').filter(
      (event) => event.sourceOid === source,
    );

    expect(done.state.players.map((player) => player.life)).toEqual([19, 15]);
    expect(retaliation.map((event) => event.amount)).toEqual([2, 3]);
    expect(done.state.replacements).toEqual([]);
  });

  it('asks the protected player how to allocate one shield across simultaneous sources', () => {
    const resolved = activateAndResolve(3);
    const ordinary = oidOf(resolved.state, BURN_SOURCE.name);
    const lifelink = oidOf(resolved.state, LIFELINK_SOURCE.name);
    const instances = [
      damage(resolved.state, 2, BURN_SOURCE),
      damage(resolved.state, 5, LIFELINK_SOURCE, true),
    ];
    const paused = applyDamage(beginTrace(resolved.state), instances);
    const decision = pendingDecision(paused.state);

    expect(decision).toEqual(
      expect.objectContaining({
        kind: 'damagePrevention',
        player: 0,
        effectId: resolved.state.replacements[0]?.id,
        source: { sourceOid: ordinary, damage: 2 },
        remaining: 3,
        options: [
          { type: 'allocateDamagePrevention', player: 0, sourceOid: ordinary, amount: 0 },
          { type: 'allocateDamagePrevention', player: 0, sourceOid: ordinary, amount: 1 },
          { type: 'allocateDamagePrevention', player: 0, sourceOid: ordinary, amount: 2 },
        ],
        complete: true,
      }),
    );

    const lifelinkFirst = reduce(paused.state, {
      type: 'allocateDamagePrevention',
      player: 0,
      sourceOid: ordinary,
      amount: 0,
    });
    const ordinaryFirst = reduce(paused.state, {
      type: 'allocateDamagePrevention',
      player: 0,
      sourceOid: ordinary,
      amount: 2,
    });

    expect(lifelinkFirst.state.players.map((player) => player.life)).toEqual([16, 19]);
    expect(ordinaryFirst.state.players.map((player) => player.life)).toEqual([16, 21]);
    expect(
      eventsOfType(lifelinkFirst.events, 'damagePrevented').map((event) => [event.sourceOid, event.amount]),
    ).toEqual([[lifelink, 3]]);
    expect(
      eventsOfType(ordinaryFirst.events, 'damagePrevented').map((event) => [event.sourceOid, event.amount]),
    ).toEqual([
      [ordinary, 2],
      [lifelink, 1],
    ]);
  });

  it('canonicalizes the simultaneous batch for stable replay and rejects malformed allocations', () => {
    const resolved = activateAndResolve(3);
    const ordinary = oidOf(resolved.state, BURN_SOURCE.name);
    const instances = [
      damage(resolved.state, 2, BURN_SOURCE),
      damage(resolved.state, 5, LIFELINK_SOURCE, true),
    ];
    const forward = applyDamage(beginTrace(resolved.state), instances);
    const reversed = applyDamage(beginTrace(resolved.state), [...instances].reverse());
    const answer = {
      type: 'allocateDamagePrevention' as const,
      player: 0 as const,
      sourceOid: ordinary,
      amount: 2,
    };

    expect(stateFingerprint(forward.state)).toBe(stateFingerprint(reversed.state));
    expect(pendingDecision(forward.state)).toEqual(pendingDecision(reversed.state));
    const forwardAnswer = reduce(forward.state, answer);
    const reversedAnswer = reduce(reversed.state, answer);
    expect(stateFingerprint(forwardAnswer.state)).toBe(stateFingerprint(reversedAnswer.state));
    expect(serializeEvents(forwardAnswer.events)).toBe(serializeEvents(reversedAnswer.events));

    expect(() =>
      reduce(forward.state, { ...answer, sourceOid: oidOf(resolved.state, LIFELINK_SOURCE.name) }),
    ).toThrow(/source/i);
    expect(() => reduce(forward.state, { ...answer, amount: 3 })).toThrow(/between 0 and 2/i);
    expect(() => reduce(forward.state, { ...answer, amount: 1.5 })).toThrow(/integer/i);
  });

  it('keeps the allocation stop through a combat damage step and resumes with active-player priority', () => {
    const resolved = activateAndResolve(3);
    const ordinary = oidOf(resolved.state, BURN_SOURCE.name);
    const lifelink = oidOf(resolved.state, LIFELINK_SOURCE.name);
    const combatState: GameState = {
      ...resolved.state,
      turn: { ...resolved.state.turn, active: 1 },
      combat: {
        ...resolved.state.combat,
        attacks: [
          { oid: ordinary, defender: 0 },
          { oid: lifelink, defender: 0 },
        ],
      },
    };

    const paused = enterStep(beginTrace(combatState), 'combatDamage');
    expect(pendingDecision(paused.state)?.kind).toBe('damagePrevention');

    const answered = reduce(paused.state, {
      type: 'allocateDamagePrevention',
      player: 0,
      sourceOid: ordinary,
      amount: 1,
    });
    expect(answered.state.turn).toEqual(
      expect.objectContaining({ priority: 1, awaiting: null, awaitingPlayer: null }),
    );
    expect(eventsOfType(answered.events, 'priorityGained')).toEqual([{ type: 'priorityGained', player: 1 }]);
    expect(answered.state.players[0].life).toBe(17);
  });

  it('does not grant priority until a noncombat resolution continuation finishes', () => {
    const resolved = activateAndResolve(3);
    const ordinary = oidOf(resolved.state, BURN_SOURCE.name);
    const instances = [
      damage(resolved.state, 2, BURN_SOURCE),
      damage(resolved.state, 5, LIFELINK_SOURCE, true),
    ];
    const paused = applyDamage(beginTrace(resolved.state), instances);
    const pending = paused.state.pendingDamagePrevention;
    if (pending === undefined) throw new Error('the damage batch did not pause');
    const resolving: GameState = {
      ...paused.state,
      pendingDamagePrevention: {
        ...pending,
        resumePriority: null,
        resolution: {
          sourceOid: oidOf(resolved.state, VENGEFUL_ARCHON.name),
          controller: 0,
          remaining: [{ effect: { kind: 'scry', count: 1 }, target: null }],
          x: 3,
          objectToGraveyard: null,
          tally: { exiled: 0, exiledPermanents: 0, damage: 0, lifeLost: 0 },
          deferredTriggers: [],
        },
      },
    };

    const allocated = reduce(resolving, {
      type: 'allocateDamagePrevention',
      player: 0,
      sourceOid: ordinary,
      amount: 2,
    });
    expect(pendingDecision(allocated.state)?.kind).toBe('scry');
    expect(allocated.state.turn.priority).toBeNull();
    expect(eventsOfType(allocated.events, 'priorityGained')).toEqual([]);

    const scry = pendingDecision(allocated.state);
    if (scry?.kind !== 'scry') throw new Error('the continuation did not reach scry');
    const choice = scry.options[0];
    if (choice === undefined) throw new Error('the scry offered no option');
    const completed = reduce(allocated.state, choice);
    expect(eventsOfType(completed.events, 'priorityGained')).toEqual([{ type: 'priorityGained', player: 0 }]);
  });

  it('expires at cleanup without preventing or retaliating', () => {
    const resolved = activateAndResolve(3);
    const cleaned = cleanupTurnEffects(beginTrace(resolved.state));
    const done = archonDamage(cleaned.state, [2]);

    expect(done.state.players.map((player) => player.life)).toEqual([18, 20]);
    expect(cleaned.state.replacements).toEqual([]);
  });

  it('does not spend or retaliate when an earlier shield prevents the damage', () => {
    const resolved = activateAndResolve(3);
    const archonShield = resolved.state.replacements[0];
    if (archonShield === undefined) throw new Error('Vengeful Archon made no shield');
    const prior: ReplacementEffect = {
      id: 'archon-prior-shield',
      sourceOid: oidOf(resolved.state, BURN_SOURCE.name),
      controller: 0,
      timestamp: archonShield.timestamp - 1,
      duration: 'endOfTurn',
      selfReplacement: false,
      trigger: {
        kind: 'damage',
        toPlayer: 0,
        toPermanent: null,
        toController: null,
        toPermanentCardType: null,
        fromSource: null,
        fromSpellSource: null,
        combatOnly: false,
      },
      modification: { kind: 'preventDamage', amount: 'all' },
    };
    const done = archonDamage(
      { ...resolved.state, replacements: [prior, ...resolved.state.replacements] },
      [2],
    );

    expect(done.state.players.map((player) => player.life)).toEqual([20, 20]);
    expect(done.state.replacements.find((effect) => effect.id === archonShield.id)?.modification).toEqual({
      kind: 'preventDamage',
      amount: 3,
    });
  });

  it('does not spend or retaliate when damage cannot be prevented', () => {
    const resolved = activateAndResolve(3);
    const shield = resolved.state.replacements[0];
    if (shield === undefined) throw new Error('Vengeful Archon made no shield');
    const done = applyDamage(beginTrace(resolved.state), [
      { ...damage(resolved.state, 2), preventable: false },
    ]);
    const archon = oidOf(resolved.state, VENGEFUL_ARCHON.name);

    expect(done.state.players.map((player) => player.life)).toEqual([18, 20]);
    expect(done.state.replacements.find((effect) => effect.id === shield.id)?.modification).toEqual({
      kind: 'preventDamage',
      amount: 3,
    });
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
    expect(eventsOfType(done.events, 'damageDealt').some((event) => event.sourceOid === archon)).toBe(false);
  });

  it('retains the activated source after departure without binding to its new incarnation', () => {
    const start = board();
    const source = oidOf(start.state, VENGEFUL_ARCHON.name);
    const originalIncarnation = start.state.objects[source]?.incarnation ?? 0;
    const activated = apply(start, activation(start, 3));
    const returned = moved(moved(activated, source, 'graveyard'), source, 'battlefield');
    const newIncarnation = returned.state.objects[source]?.incarnation ?? 0;
    const resolved = resolve(returned);
    const shield = resolved.state.replacements[0];
    const done = archonDamage(resolved.state, [3]);

    expect(newIncarnation).toBeGreaterThan(originalIncarnation);
    expect(shield?.damageReplacementFollowUp?.sourceBattlefieldIncarnation).toBe(originalIncarnation);
    expect(done.state.players.map((player) => player.life)).toEqual([20, 17]);
  });

  it('gives a copied stack ability an independent shield and deterministic fingerprint', () => {
    const copiedState = (): GameState => {
      const start = board();
      const activated = apply(start, activation(start, 2));
      const entry = activated.state.stack.at(-1);
      if (entry === undefined) throw new Error('Vengeful Archon activation never reached the stack');
      const copy = { ...entry, oid: abilityObjectId(activated.state.nextId) };
      return {
        ...activated.state,
        nextId: activated.state.nextId + 1,
        stack: [...activated.state.stack, copy],
      };
    };
    const resolveCopies = (state: GameState): ReduceResult => resolve(resolve({ state, events: [] }));
    const first = resolveCopies(copiedState());
    const second = resolveCopies(copiedState());
    const source = oidOf(first.state, VENGEFUL_ARCHON.name);
    const done = archonDamage(first.state, [2, 2]);

    expect(first.state.replacements).toHaveLength(2);
    expect(
      eventsOfType(done.events, 'damageDealt').filter((event) => event.sourceOid === source),
    ).toHaveLength(2);
    expect(done.state.players[1].life).toBe(16);
    expect(stateFingerprint(first.state)).toBe(stateFingerprint(second.state));
  });

  it('damages a retained planeswalker target instead of its controller', () => {
    const start = board();
    const walker = oidOf(start.state, WALKER.name);
    const resolved = resolve(apply(start, activation(start, 3, { kind: 'permanent', oid: walker })));
    const done = archonDamage(resolved.state, [2]);
    const current = done.state.objects[walker];
    if (current === undefined) throw new Error('Archon target walker vanished');

    expect(counterCount(current.counters, 'loyalty')).toBe(4);
    expect(done.state.players[1].life).toBe(20);
  });

  it('does not bind retaliation to a planeswalker incarnation that entered later', () => {
    const start = board();
    const walker = oidOf(start.state, WALKER.name);
    const resolved = resolve(apply(start, activation(start, 2, { kind: 'permanent', oid: walker })));
    const returned = moved(moved(resolved, walker, 'graveyard'), walker, 'battlefield');
    const done = archonDamage(returned.state, [2]);
    const current = done.state.objects[walker];
    if (current === undefined) throw new Error('Archon target walker vanished');

    expect(counterCount(current.counters, 'loyalty')).toBe(6);
    expect(done.state.players[0].life).toBe(20);
    expect(done.state.replacements).toEqual([]);
  });
});
