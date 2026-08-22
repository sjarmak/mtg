import { describe, expect, it } from 'vitest';
import type { DamageInstance, PlayerId, ReduceResult } from '@mtg/kernel';
import {
  applyDamage,
  beginTrace,
  checkStateBasedActions,
  eventsOfType,
  isDraw,
  pendingDecision,
  scenario,
} from '@mtg/kernel';
import { creature, instant, lands, MOUNTAIN, PLAINS } from './cards';
import { apply, handOidOf, inGraveyard, oidOf } from './helpers';

const shrink = instant(
  'Test Shrink',
  [{ kind: 'pumpUntilEndOfTurn', power: 0, toughness: -3, target: { kind: 'targetCreature' } }],
  { generic: 1, R: 1 },
);
const drain = instant('Test Drain', [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetPlayer' } }], {
  generic: 1,
  R: 1,
});
const study = instant('Test Study', [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }], {
  generic: 1,
  W: 1,
});

/**
 * One instant that kills its own controller and decks the opponent — two
 * effects with independently chosen player targets, which the pinned slice
 * vocabulary already allows. Both resolve before state-based actions run, so it
 * is the shortest legal route to a simultaneous loss with two different causes.
 */
const mutualRuin = instant(
  'Test Mutual Ruin',
  [
    { kind: 'dealDamage', amount: 3, target: { kind: 'targetPlayer' } },
    { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
  ],
  { generic: 1, R: 1 },
);

function resolveTopSpell(from: ReturnType<typeof apply>): ReturnType<typeof apply> {
  const first = apply(from, { type: 'passPriority', player: 0 });
  return apply(first, { type: 'passPriority', player: 1 });
}

function burn(sourceOid: string, player: PlayerId, amount: number): DamageInstance {
  return {
    sourceOid,
    controller: 0,
    recipient: { kind: 'player', player },
    amount,
    deathtouch: false,
    lifelink: false,
    combat: false,
  };
}

/**
 * Deals a batch of damage as one simultaneous event and then runs the SBA
 * check — the shape any symmetric damage or life-loss effect will have.
 */
function damageThenCheck(start: ReduceResult, instances: readonly DamageInstance[]): ReduceResult {
  const damaged = applyDamage(beginTrace(start.state), instances);
  const checked = checkStateBasedActions(damaged);
  return { state: checked.state, events: checked.events };
}

describe('state-based actions', () => {
  it('puts a creature with zero toughness into the graveyard', () => {
    const bear = creature('SBA Bear', 2, 2);
    const start = scenario({
      battlefield: [
        { card: bear, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[shrink], []],
    });
    const bearOid = oidOf(start.state, 'SBA Bear');
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Shrink'),
      targets: [{ kind: 'permanent', oid: bearOid }],
    });
    const done = resolveTopSpell(cast);
    expect(inGraveyard(done.state, bearOid)).toBe(true);
    const reasons = eventsOfType(done.events, 'permanentDestroyed').map((event) => event.reason);
    expect(reasons).toEqual(['zeroToughness']);
  });

  it('destroys a creature only once damage reaches its toughness', () => {
    const bear = creature('Damaged Bear', 2, 2);
    const nudge = instant('Nudge', [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }], {
      generic: 1,
      R: 1,
    });
    const start = scenario({
      battlefield: [
        { card: bear, controller: 1, damage: 1 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[nudge], []],
    });
    const bearOid = oidOf(start.state, 'Damaged Bear');
    // One damage already marked is survivable; the second point is lethal.
    expect(inGraveyard(start.state, bearOid)).toBe(false);
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Nudge'),
      targets: [{ kind: 'permanent', oid: bearOid }],
    });
    const done = resolveTopSpell(cast);
    expect(inGraveyard(done.state, bearOid)).toBe(true);
    expect(eventsOfType(done.events, 'permanentDestroyed').map((event) => event.reason)).toEqual([
      'lethalDamage',
    ]);
  });

  it('ends the game when a player hits zero life', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[drain], []],
      life: [20, 3],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Drain'),
      targets: [{ kind: 'player', player: 1 }],
    });
    const done = resolveTopSpell(cast);
    expect(done.state.result).toEqual({ winner: 0, loser: 1, reason: 'lifeZero', endedOnTurn: 2 });
    expect(pendingDecision(done.state)).toBeNull();
    expect(eventsOfType(done.events, 'gameEnded')).toHaveLength(1);
  });

  it('ends the game when a player tries to draw from an empty library', () => {
    const start = scenario({
      battlefield: [
        { card: PLAINS, controller: 0 },
        { card: PLAINS, controller: 0 },
      ],
      hands: [[study], []],
      libraries: [[], lands(PLAINS, 5)],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Study'),
      targets: [null],
    });
    const done = resolveTopSpell(cast);
    expect(eventsOfType(done.events, 'drawFromEmptyLibrary')).toHaveLength(1);
    expect(done.state.result?.loser).toBe(0);
    expect(done.state.result?.reason).toBe('emptyLibrary');
  });

  it('scores a simultaneous loss with two different causes as a draw (CR 104.4b)', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[mutualRuin], []],
      life: [3, 20],
      libraries: [lands(MOUNTAIN, 5), []],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Mutual Ruin'),
      targets: [
        { kind: 'player', player: 0 },
        { kind: 'player', player: 1 },
      ],
    });
    const done = resolveTopSpell(cast);

    // Seat 0 is dead on life, seat 1 is dead on the empty draw, both at the
    // same SBA check: nobody wins.
    expect(done.state.result).toEqual({
      winner: null,
      loser: null,
      reason: 'lifeZero',
      endedOnTurn: 2,
    });
    const result = done.state.result;
    expect(result === null ? null : isDraw(result)).toBe(true);
    expect(done.state.players.map((seat) => seat.lost)).toEqual([true, true]);
    expect(pendingDecision(done.state)).toBeNull();

    // The summary reason is lossy by design; the per-seat causes survive here.
    expect(eventsOfType(done.events, 'playerLost').map((event) => [event.player, event.reason])).toEqual([
      [0, 'lifeZero'],
      [1, 'emptyLibrary'],
    ]);
    const ended = eventsOfType(done.events, 'gameEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.winner).toBeNull();
  });

  it('scores simultaneous lethal damage to both players as a draw', () => {
    const start = scenario({
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      life: [2, 2],
    });
    const source = oidOf(start.state, 'Mountain');
    const done = damageThenCheck(start, [burn(source, 0, 2), burn(source, 1, 2)]);

    expect(done.state.result).toEqual({
      winner: null,
      loser: null,
      reason: 'lifeZero',
      endedOnTurn: 2,
    });
    expect(done.state.players.map((seat) => seat.lost)).toEqual([true, true]);
    expect(eventsOfType(done.events, 'playerLost').map((event) => event.player)).toEqual([0, 1]);
    expect(eventsOfType(done.events, 'gameEnded')).toHaveLength(1);
  });

  it('still awards the win when the same damage batch is lethal to one player only', () => {
    const start = scenario({
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
      life: [2, 2],
    });
    const source = oidOf(start.state, 'Mountain');
    const done = damageThenCheck(start, [burn(source, 0, 1), burn(source, 1, 2)]);

    expect(done.state.result).toEqual({
      winner: 0,
      loser: 1,
      reason: 'lifeZero',
      endedOnTurn: 2,
    });
    const result = done.state.result;
    expect(result === null ? null : isDraw(result)).toBe(false);
    expect(done.state.players.map((seat) => seat.lost)).toEqual([false, true]);
    expect(eventsOfType(done.events, 'playerLost').map((event) => event.player)).toEqual([1]);
  });

  it('marks a conceding player as lost so the seat flags mean one thing', () => {
    const start = scenario({
      battlefield: [{ card: MOUNTAIN, controller: 0 }],
    });
    const done = apply(start, { type: 'concede', player: 1 });
    expect(done.state.result).toEqual({ winner: 0, loser: 1, reason: 'concede', endedOnTurn: 2 });
    expect(done.state.players.map((seat) => seat.lost)).toEqual([false, true]);
  });

  it('refuses any further action once the game is over', () => {
    const start = scenario({
      battlefield: [
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[drain], []],
      life: [20, 3],
    });
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, 'Test Drain'),
      targets: [{ kind: 'player', player: 1 }],
    });
    const done = resolveTopSpell(cast);
    expect(() => apply(done, { type: 'passPriority', player: 0 })).toThrow(/already over/);
  });
});
