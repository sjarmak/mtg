/**
 * `grantKeywordUntilEndOfTurn`: CR 613.1f, layer 6, for one turn.
 *
 * `@mtg/dsl`'s file of the same name covers the schema, the printed sentence
 * and the containment invariant. This file covers what the kernel does, and
 * the four claims are the four ways a granted keyword has to be
 * indistinguishable from a printed one:
 *
 *  1. It reaches `hasKeyword`, and the log says so once, naming layer 6.
 *  2. It reaches the *rules*, not just the flag: a bear handed flying cannot
 *     be blocked by the ground creature that could have blocked it a moment
 *     earlier. `canBlock` is the same function combat asks, so this is the
 *     claim that the record went through the layer walk rather than into a
 *     field nobody reads.
 *  3. It is gone next turn, expired by `cleanupTurnEffects` like any other
 *     `endOfTurn` record.
 *  4. It is aimed: a second creature beside the target gains nothing.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  canBlock,
  eventsOfType,
  hasKeyword,
  pendingDecision,
  reduce,
  reduceAll,
  scenario,
} from '@mtg/kernel';
import { creature, instant, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const UPDRAFT: Card = instant('Test Updraft', [
  { kind: 'grantKeywordUntilEndOfTurn', keyword: 'flying', target: { kind: 'targetCreature' } },
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

/** Idles forward, `prevent-all-damage-to-target.test.ts`'s helper verbatim. */
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

describe('the creature gains the ability', () => {
  it('reaches hasKeyword and reports the grant once, in layer 6', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(2, 0)],
      hands: [[UPDRAFT], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    expect(hasKeyword(start.state, bearOid, 'flying')).toBe(false);

    const done = castAndResolve(start, 'Test Updraft', [permanentNamed(start.state, 'Test Bear')]);

    expect(hasKeyword(done.state, bearOid, 'flying')).toBe(true);
    const granted = eventsOfType(done.events, 'keywordGranted');
    expect(granted).toHaveLength(1);
    expect(granted[0]?.targetOid).toBe(bearOid);
    expect(granted[0]?.keyword).toBe('flying');
    expect(granted[0]?.layer).toBe('6');
  });

  /**
   * The claim the flag alone would not carry. `canBlock` is the function combat
   * itself asks, so an answer that changes here is an answer that changes in a
   * real block.
   */
  it('changes what may block it, which is what the layer is for', () => {
    const bear = creature('Test Bear', 2, 2);
    const ground = creature('Test Ground Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, { card: ground, controller: 1 }, ...lands(2, 0)],
      hands: [[UPDRAFT], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    const groundOid = oidOf(start.state, 'Test Ground Bear');
    expect(canBlock(start.state, groundOid, bearOid)).toBe(true);

    const done = castAndResolve(start, 'Test Updraft', [permanentNamed(start.state, 'Test Bear')]);

    expect(canBlock(done.state, groundOid, bearOid)).toBe(false);
  });

  it('gives nothing to the creature standing beside the target', () => {
    const bear = creature('Test Bear', 2, 2);
    const other = creature('Test Other Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, { card: other, controller: 0 }, ...lands(2, 0)],
      hands: [[UPDRAFT], []],
    });
    const otherOid = oidOf(start.state, 'Test Other Bear');

    const done = castAndResolve(start, 'Test Updraft', [permanentNamed(start.state, 'Test Bear')]);

    expect(hasKeyword(done.state, otherOid, 'flying')).toBe(false);
  });
});

describe('and loses it again', () => {
  it('is off the creature on the following turn', () => {
    const bear = creature('Test Bear', 2, 2);
    const start = scenario({
      battlefield: [{ card: bear, controller: 0 }, ...lands(2, 0)],
      hands: [[UPDRAFT], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');

    const done = castAndResolve(start, 'Test Updraft', [permanentNamed(start.state, 'Test Bear')]);
    expect(hasKeyword(done.state, bearOid, 'flying')).toBe(true);

    const later = passUntilTurn(done, done.state.turn.number + 1);

    expect(hasKeyword(later.state, bearOid, 'flying')).toBe(false);
    expect(eventsOfType(later.events, 'continuousEffectsExpired').length).toBeGreaterThan(0);
  });
});

/**
 * The group form: Overwhelming Stampede's second clause (M11 189), where the
 * grant reads a region of the board instead of a creature somebody chose.
 *
 * Three claims, and the third is the one the shape argues about. A one-shot
 * continuous effect fixes the set of objects it affects when it resolves (CR
 * 611.2c), so this kernel freezes the group into an oid list at resolution
 * rather than storing the region and re-reading it. A creature that walks in
 * afterward is therefore not part of the set, and it does not get the keyword
 * — which is what the printed card does, and the test below says so out loud
 * so a later rewrite of the sweep into a live filter fails here rather than
 * quietly changing a rule.
 */
const STAMPEDE: Card = instant('Test Stampede', [
  {
    kind: 'grantKeywordUntilEndOfTurn',
    keyword: 'flying',
    target: { kind: 'noTarget' },
    scope: 'permanentsYouControl',
    scopeFilter: { cardTypes: ['creature'] },
  },
]);

describe('the group a scope reaches', () => {
  it('grants to every creature its controller had out, and to no opponent', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Test Bear', 2, 2), controller: 0 },
        { card: creature('Test Ox', 1, 4), controller: 0 },
        { card: creature('Test Rival Bear', 2, 2), controller: 1 },
        ...lands(4, 0),
      ],
      hands: [[STAMPEDE], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    const oxOid = oidOf(start.state, 'Test Ox');
    const rivalOid = oidOf(start.state, 'Test Rival Bear');
    const landOid = start.state.battlefield.find(
      (oid) => start.state.objects[oid]?.card.name === MOUNTAIN.name,
    );
    expect(landOid).toBeDefined();

    const done = castAndResolve(start, 'Test Stampede', [null]);

    expect(hasKeyword(done.state, bearOid, 'flying')).toBe(true);
    expect(hasKeyword(done.state, oxOid, 'flying')).toBe(true);
    expect(hasKeyword(done.state, rivalOid, 'flying')).toBe(false);
    // The filter's own assertion: the region holds the lands too, and a land
    // that gained flying would mean the scope resolved without it.
    expect(hasKeyword(done.state, landOid as ObjectId, 'flying')).toBe(false);
    expect(eventsOfType(done.events, 'keywordGranted')).toHaveLength(2);
  });

  it('is off the whole group on the following turn', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Test Bear', 2, 2), controller: 0 },
        { card: creature('Test Ox', 1, 4), controller: 0 },
        ...lands(4, 0),
      ],
      hands: [[STAMPEDE], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');
    const oxOid = oidOf(start.state, 'Test Ox');

    const done = castAndResolve(start, 'Test Stampede', [null]);
    const later = passUntilTurn(done, done.state.turn.number + 1);

    expect(hasKeyword(later.state, bearOid, 'flying')).toBe(false);
    expect(hasKeyword(later.state, oxOid, 'flying')).toBe(false);
  });

  /**
   * CR 611.2c, stated as a game rather than as a comment: the second bear is
   * cast after the sweep has already resolved, on the same turn, under the same
   * controller, and it is still standing on the battlefield when the assertion
   * runs — so the only thing separating it from the bear that did gain flying
   * is that it was not there when the set was fixed.
   */
  it('gives nothing to a creature that arrives after it resolved', () => {
    const latecomer = creature('Test Latecomer', 2, 2);
    const start = scenario({
      battlefield: [{ card: creature('Test Bear', 2, 2), controller: 0 }, ...lands(4, 0)],
      hands: [[STAMPEDE, latecomer], []],
    });
    const bearOid = oidOf(start.state, 'Test Bear');

    const swept = castAndResolve(start, 'Test Stampede', [null]);
    const done = castAndResolve(swept, 'Test Latecomer', []);
    const latecomerOid = oidOf(done.state, 'Test Latecomer');

    expect(hasKeyword(done.state, bearOid, 'flying')).toBe(true);
    expect(hasKeyword(done.state, latecomerOid, 'flying')).toBe(false);
  });
});
