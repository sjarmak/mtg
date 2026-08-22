/**
 * The kernel half of the two Blood Moon primitives.
 *
 * The gloom sweeper is a scoped `putCounters`, and it inherits the scope
 * machinery `exileTarget` proved out — so the interesting assertions here are
 * the ones a shared helper does *not* give you for free: that the counters land
 * on the targeted player's creatures and not the caster's, and that the group is
 * fixed before the loop (CR 609.2) rather than re-derived as it shrinks. Gloom
 * is not an alias of -1/-1 (CR 704.5q pairs only the two annihilating kinds), so
 * a swept creature keeps its counter and its shrunken toughness.
 *
 * Reanimation is the first effect that moves a card *out* of a graveyard, and
 * CR 400.7 is the whole of why it needs its own assertions: the card that
 * returns is a NEW object with a new id, not the graveyard object relabeled.
 * The art pipeline keys a basic land's illustration to a copy number fixed when
 * the object comes into existence, so an implementation that reused the old
 * object would be invisible here and wrong there. The other decision under test
 * is ownership: `moveObject` hands an entering object back to its owner, which
 * is what makes "under their owner's control" free, and it means reanimating
 * your opponent's graveyard fills *their* board, not yours.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { counterCount, objectsInEffectScope, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';

/** A counter tally omits zero-valued kinds, so a missing gloom is no gloom. */
function gloomOn(state: GameState, oid: string): number {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`no object ${oid}`);
  return counterCount(object.counters, 'gloom');
}
import { creature, SWAMP, sorcery } from './cards';

const GLOOM_MOON = sorcery(
  'Gloom of the Blood Moon',
  [
    {
      kind: 'putCounters',
      counter: 'gloom',
      count: 1,
      scope: 'creaturesThatPlayerControls',
      target: { kind: 'targetOpponent' },
    },
  ],
  { generic: 2, B: 1 },
);

const RISING_MOON = sorcery(
  'Rise of the Blood Moon',
  [
    {
      kind: 'returnFromGraveyard',
      scope: 'creatureCardsInPlayerGraveyard',
      target: { kind: 'targetPlayer' },
    },
  ],
  { generic: 3, B: 2 },
);

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts seat 0's only card at `at` and lets it resolve. */
function cast(start: GameState, at: 0 | 1): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const spell = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'player', player: at }],
  });
  return reduceAll(spell.state, [pass(spell.state), { type: 'passPriority', player: 1 }]).state;
}

function swamps(count: number, controller: 0 | 1): { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller }));
}

describe('the mass gloom sweeper', () => {
  it('glooms every creature the targeted player controls and none the caster does', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Hearth Sentry', 1, 3), controller: 0 },
        { card: creature('Moonlit Scout', 1, 2), controller: 1 },
        { card: creature('Moonlit Brute', 3, 3), controller: 1 },
      ],
      hands: [[GLOOM_MOON], []],
    }).state;
    const group = objectsInEffectScope(start, 'creaturesThatPlayerControls', 1);
    const mine = objectsInEffectScope(start, 'creaturesThatPlayerControls', 0);
    expect(group).toHaveLength(2);
    expect(mine).toHaveLength(1);

    const after = cast(start, 1);
    for (const oid of group) {
      expect(gloomOn(after, oid), oid).toBe(1);
    }
    for (const oid of mine) {
      expect(gloomOn(after, oid), oid).toBe(0);
    }
  });

  /**
   * Four bodies, because "every other one" and "the first half" are only
   * distinguishable from "all of them" at four. Nothing leaves the battlefield
   * here, so this is the weaker version of the exile sweeper's regression — but
   * it is the one that catches a loop that re-reads the board through a filter
   * that a placed counter changed.
   */
  it('reaches the whole group', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Moon Scout', 1, 2), controller: 1 },
        { card: creature('Moon Brute', 3, 3), controller: 1 },
        { card: creature('Moon Runner', 2, 2), controller: 1 },
        { card: creature('Moon Vanguard', 4, 4), controller: 1 },
      ],
      hands: [[GLOOM_MOON], []],
    }).state;
    const group = objectsInEffectScope(start, 'creaturesThatPlayerControls', 1);
    expect(group).toHaveLength(4);

    const after = cast(start, 1);
    expect(group.map((oid) => gloomOn(after, oid))).toEqual([1, 1, 1, 1]);
  });

  /**
   * Gloom is deliberately not an alias of -1/-1 — CR 704.5q annihilates only
   * the two paired kinds, so a gloom counter outlives a later +1/+1 — but it is
   * a real -1/-1 for the layer that computes toughness, and a swept 1/1 is
   * therefore a dead 1/1.
   */
  it('kills what it shrinks to nothing', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Moonlit Wisp', 1, 1), controller: 1 },
        { card: creature('Moonlit Brute', 3, 3), controller: 1 },
      ],
      hands: [[GLOOM_MOON], []],
    }).state;
    const wisp = objectsInEffectScope(start, 'creaturesThatPlayerControls', 1).find(
      (oid) => start.objects[oid]?.card.name === 'Moonlit Wisp',
    );
    if (wisp === undefined) throw new Error('no wisp');

    const after = cast(start, 1);
    expect(after.battlefield).not.toContain(wisp);
    expect(playerOf(after, 1).graveyard).toContain(wisp);
  });
});

describe('mass reanimation', () => {
  it('returns every creature card as a new object under its owner`s control', () => {
    const fallen = creature('Fallen Herald', 2, 2);
    const other = creature('Fallen Acolyte', 1, 1);
    const start = scenario({
      battlefield: swamps(5, 0),
      hands: [[RISING_MOON], []],
      graveyards: [[fallen, other], []],
    }).state;
    const buried = [...playerOf(start, 0).graveyard];
    expect(buried).toHaveLength(2);

    const after = cast(start, 0);
    // CR 400.7 as this kernel spells it: the id is stable across the move (a
    // replay is checked by `stateFingerprint`, and a fresh id per zone change
    // would make every id a function of history rather than of state), and
    // everything that makes an object *that* object on the battlefield is reset
    // by `moveObject` — status, damage, counters, and summoning sickness. The
    // assertions below are that reset, not the id.
    const returned = after.battlefield.filter((oid) => after.objects[oid]?.card.kind === 'creature');
    expect(returned).toHaveLength(2);
    expect(returned.map((oid) => after.objects[oid]?.card.name).sort()).toEqual([
      'Fallen Acolyte',
      'Fallen Herald',
    ]);
    for (const oid of returned) {
      expect(after.objects[oid]?.owner, oid).toBe(0);
      expect(after.objects[oid]?.controller, oid).toBe(0);
      // A new object has not been controlled since the turn began.
      expect(after.objects[oid]?.summoningSick, oid).toBe(true);
    }
    expect(returned.every((oid) => buried.includes(oid))).toBe(true);
    for (const oid of returned) {
      const object = after.objects[oid];
      if (object === undefined) throw new Error(`no object ${oid}`);
      expect(counterCount(object.counters, 'plusOnePlusOne'), oid).toBe(0);
      expect(object.damage, oid).toBe(0);
      expect(object.tapped, oid).toBe(false);
    }
    expect(playerOf(after, 0).graveyard.filter((oid) => buried.includes(oid))).toEqual([]);
  });

  /**
   * The ownership decision, seen from the side that makes it a real choice:
   * pointing the spell at an opponent's graveyard rebuilds their board. That is
   * the flavor ("the moon raises the dead and does not care whose they were")
   * and it is also what stops this being a strictly one-sided reanimator.
   */
  it('fills the targeted player`s board, not the caster`s', () => {
    const theirs = creature('Fallen Warden', 2, 3);
    const start = scenario({
      battlefield: swamps(5, 0),
      hands: [[RISING_MOON], []],
      graveyards: [[], [theirs]],
    }).state;

    const after = cast(start, 1);
    const returned = after.battlefield.filter((oid) => after.objects[oid]?.card.name === 'Fallen Warden');
    expect(returned).toHaveLength(1);
    const oid = returned[0] ?? '';
    expect(after.objects[oid]?.controller).toBe(1);
    expect(after.objects[oid]?.owner).toBe(1);
  });

  it('leaves noncreature cards where they lie', () => {
    const start = scenario({
      battlefield: swamps(5, 0),
      hands: [[RISING_MOON], []],
      graveyards: [[creature('Fallen Herald', 2, 2), SWAMP], []],
    }).state;
    const buried = [...playerOf(start, 0).graveyard];
    const land = buried.find((oid) => start.objects[oid]?.card.kind === 'land') ?? '';

    const after = cast(start, 0);
    expect(playerOf(after, 0).graveyard).toContain(land);
    expect(after.objects[land]?.zone).toBe('graveyard');
  });
});
