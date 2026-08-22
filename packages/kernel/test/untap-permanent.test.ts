/**
 * `untapPermanent`: CR 701.20a, the action the effect vocabulary had no word
 * for until `mtg-2qyk`.
 *
 * `@mtg/dsl`'s `untap-permanent.test.ts` covers the schema, the printed
 * sentence and the containment invariant. This file covers what the kernel
 * does, and the four claims are the four ways this primitive is not simply
 * `tapPermanent` pointed backwards:
 *
 *  1. A tapped permanent turns, and the log says so once.
 *  2. A permanent that was already untapped reports nothing — `untapObject`
 *     no-ops rather than emitting an event for a turn that did not happen.
 *  3. The space really is every permanent: a `targetPermanent` slot filtered to
 *     artifacts untaps Voltaic Key's artifact, which no creature-shaped kind
 *     could have named.
 *  4. A `doesNotUntap` hold survives it. The hold is a debt against an untap
 *     *step* and `untapStep` is the only place it is spent, so a spell that
 *     hands the body back in the middle of a turn settles none of it.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import { eventsOfType, reduce, reduceAll, scenario } from '@mtg/kernel';
import { artifact, creature, instant, MOUNTAIN } from './cards';
import { handOidOf, oidOf } from './helpers';

const SECOND_WIND: Card = instant('Test Second Wind', [
  { kind: 'untapPermanent', target: { kind: 'targetCreatureYouControl' } },
]);

const KEYTURN: Card = instant('Test Keyturn', [
  {
    kind: 'untapPermanent',
    target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } },
  },
]);

const FROSTBIND: Card = instant('Test Frostbind', [
  { kind: 'tapPermanent', target: { kind: 'targetCreature' }, doesNotUntap: true },
]);

function permanentNamed(state: GameState, name: string): { kind: 'permanent'; oid: ObjectId } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

function lands(count: number, controller: 0 | 1): readonly { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

/** Casts an instant from player 0's hand and resolves it. */
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

describe('the permanent turns', () => {
  it('untaps a tapped creature and reports it once', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0, tapped: true }, ...lands(2, 0)],
      hands: [[SECOND_WIND], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    expect(start.state.objects[bearOid]?.tapped).toBe(true);

    const done = castAndResolve(start, 'Test Second Wind', [permanentNamed(start.state, 'Test Bear')]);

    expect(done.state.objects[bearOid]?.tapped).toBe(false);
    expect(eventsOfType(done.events, 'permanentUntapped')).toEqual([
      { type: 'permanentUntapped', oid: bearOid },
    ]);
  });

  it('says nothing about a permanent that was already untapped', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(2, 0)],
      hands: [[SECOND_WIND], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');

    const done = castAndResolve(start, 'Test Second Wind', [permanentNamed(start.state, 'Test Bear')]);

    expect(done.state.objects[bearOid]?.tapped).toBe(false);
    expect(eventsOfType(done.events, 'permanentUntapped')).toEqual([]);
  });
});

describe('the space is every permanent', () => {
  /**
   * Voltaic Key's line. The slot is `targetPermanent` wearing a card-type
   * filter, which is the whole argument for the wide space: `TARGET_KINDS` has
   * no artifact member, and this card does not need one.
   */
  it('untaps a tapped artifact through the card-type filter', () => {
    const key = artifact('Test Cog');
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [
        { card: key, controller: 0, tapped: true },
        { card: bear, controller: 0, tapped: true },
        ...lands(2, 0),
      ],
      hands: [[KEYTURN], []],
    });
    const keyOid = oidOf(start.state, 'Test Cog');
    const bearOid = oidOf(start.state, 'Test Bear');

    const done = castAndResolve(start, 'Test Keyturn', [permanentNamed(start.state, 'Test Cog')]);

    expect(done.state.objects[keyOid]?.tapped).toBe(false);
    // The filter is a narrowing, not a sweep: the tapped creature beside it is
    // untouched, and it was never a legal choice for this slot either.
    expect(done.state.objects[bearOid]?.tapped).toBe(true);
  });
});

describe('the hold is not what this spell spends', () => {
  it('hands the body back and leaves the skipped untap step owed', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(4, 0)],
      hands: [[FROSTBIND, SECOND_WIND], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');

    const held = castAndResolve(start, 'Test Frostbind', [permanentNamed(start.state, 'Test Bear')]);
    expect(held.state.objects[bearOid]?.tapped).toBe(true);
    expect(held.state.objects[bearOid]?.skipsNextUntap).toBe(true);

    const freed = castAndResolve(held, 'Test Second Wind', [permanentNamed(held.state, 'Test Bear')]);

    expect(freed.state.objects[bearOid]?.tapped).toBe(false);
    // The debt survives the untap: it is against the untap *step*, and
    // `untapStep` is the only place that spends it.
    expect(freed.state.objects[bearOid]?.skipsNextUntap).toBe(true);
  });
});
