/**
 * The keyword rider on `pumpUntilEndOfTurn`: Mighty Leap in the kernel.
 *
 * `@mtg/dsl`'s file of the same name argues why the rider is a field on the
 * pump rather than a second effect — two effects are two target slots, so
 * "target creature gets +2/+2 and gains flying" cannot be written as a pump
 * beside a grant without becoming a card that names two creatures. This file
 * is the half that argument cannot make on its own: that the two continuous
 * records the one resolution writes really do land on the one chosen body, in
 * their two different layers, and leave together.
 *
 * Four claims, and the third and fourth are the ones a wrong implementation
 * passes the first two on:
 *
 *  1. Both modifications reach the target. `powerOf`/`toughnessOf` move and
 *     `hasKeyword` flips, and the log names the same object twice — once from
 *     layer 7c and once from layer 6.
 *  2. The seatmate gets neither. A rider written over the battlefield instead
 *     of over the resolved group would pass claim 1 and fail here.
 *  3. Both are gone next turn. Two `endOfTurn` records were written, so both
 *     have to be swept; a rider parked in a field `cleanupTurnEffects` does not
 *     walk would grant flying for the rest of the game.
 *  4. A fizzled spell writes neither (CR 608.2b). The rider rides the pump, so
 *     it has no independent path to the battlefield, and this is the run that
 *     proves it — a grant applied before the target recheck would hand flying
 *     to a creature that is already in the graveyard's place in the log.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  eventsOfType,
  hasKeyword,
  pendingDecision,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { PLAINS, creature, instant } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

/** Mighty Leap (M11 common): the whole card, in one effect. */
const MIGHTY_LEAP: Card = instant(
  'Test Mighty Leap',
  [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 2,
      toughness: 2,
      keyword: 'flying',
      target: { kind: 'targetCreature' },
    },
  ],
  { generic: 1, W: 1 },
);

/** The answer that takes the leap's only target away under it. */
const SMITE: Card = instant(
  'Test Smite',
  [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  { generic: 1, W: 1 },
);

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: ObjectId } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

function plains(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller: 0 as const }));
}

/** Casts an instant from player 0's hand and resolves it. */
function castAndResolve(start: ReduceResult, name: string, targets: readonly unknown[]): ReduceResult {
  const oid = handOidOf(start.state, 0, name);
  const cast = reduce(start.state, { type: 'castSpell', player: 0, oid, targets: targets as never });
  const resolved = reduceAll(cast.state, [
    { type: 'passPriority', player: 0 },
    { type: 'passPriority', player: 1 },
  ]);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

/** Idles forward, `grant-keyword-until-end-of-turn.test.ts`'s helper verbatim. */
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

function openBoard(extra: readonly { card: Card; controller: 0 | 1 }[] = []): ReduceResult {
  return scenario({
    battlefield: [{ card: creature('Test Bear', 2, 2), controller: 0 }, ...plains(4), ...extra],
    hands: [[MIGHTY_LEAP, SMITE], []],
  });
}

describe('one resolution, two records, one body', () => {
  it('moves the stats and grants the keyword to the creature it named', () => {
    const start = openBoard();
    const bear = oidOf(start.state, 'Test Bear');
    expect(powerOf(start.state, bear)).toBe(2);
    expect(hasKeyword(start.state, bear, 'flying')).toBe(false);

    const done = castAndResolve(start, 'Test Mighty Leap', [permanentNamed(start.state, 'Test Bear')]);

    expect(powerOf(done.state, bear)).toBe(4);
    expect(toughnessOf(done.state, bear)).toBe(4);
    expect(hasKeyword(done.state, bear, 'flying')).toBe(true);
  });

  it('writes the two records in their two layers, naming the one object twice', () => {
    const start = openBoard();
    const bear = oidOf(start.state, 'Test Bear');

    const done = castAndResolve(start, 'Test Mighty Leap', [permanentNamed(start.state, 'Test Bear')]);

    const pumped = eventsOfType(done.events, 'continuousEffectAdded');
    expect(pumped.map((event) => ({ oid: event.targetOid, layer: event.layer }))).toEqual([
      { oid: bear, layer: '7c' },
    ]);
    const granted = eventsOfType(done.events, 'keywordGranted');
    expect(
      granted.map((event) => ({ oid: event.targetOid, keyword: event.keyword, layer: event.layer })),
    ).toEqual([{ oid: bear, keyword: 'flying', layer: '6' }]);
    // Two records, two ids: a rider folded into the pump's own entry would
    // report one, and layer 6 and layer 7c cannot share a `ContinuousEffect`.
    const ids = new Set([...pumped.map((event) => event.id), ...granted.map((event) => event.id)]);
    expect(ids.size).toBe(2);
  });

  it('gives the creature standing beside the target neither half', () => {
    const start = openBoard([{ card: creature('Test Other Bear', 2, 2), controller: 0 }]);
    const other = oidOf(start.state, 'Test Other Bear');

    const done = castAndResolve(start, 'Test Mighty Leap', [permanentNamed(start.state, 'Test Bear')]);

    expect(powerOf(done.state, other)).toBe(2);
    expect(toughnessOf(done.state, other)).toBe(2);
    expect(hasKeyword(done.state, other, 'flying')).toBe(false);
  });
});

describe('and both halves leave together', () => {
  it('is off the creature on the following turn, stats and keyword alike', () => {
    const start = openBoard();
    const bear = oidOf(start.state, 'Test Bear');

    const done = castAndResolve(start, 'Test Mighty Leap', [permanentNamed(start.state, 'Test Bear')]);
    expect(powerOf(done.state, bear)).toBe(4);
    expect(hasKeyword(done.state, bear, 'flying')).toBe(true);

    const later = passUntilTurn(done, done.state.turn.number + 1);

    expect(powerOf(later.state, bear)).toBe(2);
    expect(toughnessOf(later.state, bear)).toBe(2);
    expect(hasKeyword(later.state, bear, 'flying')).toBe(false);
    expect(later.state.continuous).toEqual([]);
  });
});

describe('a leap whose target is gone', () => {
  it('writes neither record, because the rider has no path of its own (CR 608.2b)', () => {
    const start = openBoard();
    const bear = oidOf(start.state, 'Test Bear');
    const leap = handOidOf(start.state, 0, 'Test Mighty Leap');
    const smite = handOidOf(start.state, 0, 'Test Smite');

    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: leap,
      targets: [{ kind: 'permanent', oid: bear }],
    });
    const answered = reduce(cast.state, {
      type: 'castSpell',
      player: 0,
      oid: smite,
      targets: [{ kind: 'permanent', oid: bear }],
    });
    const done = reduceAll(answered.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);

    expect(eventsOfType(done.events, 'spellFizzled').map((event) => event.oid)).toEqual([leap]);
    expect(eventsOfType(done.events, 'keywordGranted')).toEqual([]);
    expect(eventsOfType(done.events, 'continuousEffectAdded')).toEqual([]);
    expect(done.state.continuous).toEqual([]);
  });
});
