/**
 * A one-shot effect scope, which is the first time a DSL effect reaches more
 * than one object.
 *
 * Every primitive before this one moved exactly what it targeted, so "which
 * objects" and "in what order" were not questions the kernel had to answer. A
 * scope asks both, and both have a wrong answer that no assertion elsewhere
 * would catch:
 *
 *  - Re-deriving the group between moves reads a battlefield the earlier moves
 *    already shortened, so a sweep over four creatures takes two of them. The
 *    fourth test below is that shape exactly, and it fails on any implementation
 *    that filters inside the loop rather than before it (CR 609.2).
 *  - Iterating a Set, a Map or a per-player list makes the order an accident of
 *    the container. In this engine seed plus choice list is the entire record
 *    and `stateFingerprint` is how a replay is checked, so an order that is not
 *    a function of state is a game that stops replaying.
 *
 * The targeting half is CR 115.1: the player is the target and the creatures are
 * not, which is why the whole sweep records one choice.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '@mtg/kernel';
import {
  objectsInEffectScope,
  playerOf,
  reduce,
  reduceAll,
  scenario,
  stateFingerprint,
  targetChoicesFor,
} from '@mtg/kernel';
import { creature, SWAMP, sorcery } from './cards';

const RECKONING = sorcery(
  'Void Reckoning',
  [
    {
      kind: 'exileTarget',
      scope: 'creaturesThatPlayerControls',
      target: { kind: 'targetOpponent' },
    },
  ],
  { generic: 2, B: 1 },
);

function swamps(count: number, controller: 0 | 1): { card: typeof SWAMP; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: SWAMP, controller }));
}

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts the sweep at seat 1 and lets it resolve. */
function sweep(start: GameState): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'player', player: 1 }],
  });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

function named(state: GameState, name: string): string {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

describe('exiling every creature a player controls', () => {
  it('takes every creature the targeted player controls and none the caster does', () => {
    const theirs = creature('Void Whelp', 2, 2);
    const mine = creature('Hearth Sentry', 1, 3);
    const start = scenario({
      battlefield: [...swamps(3, 0), { card: mine, controller: 0 }, { card: theirs, controller: 1 }],
      hands: [[RECKONING], []],
    }).state;
    const victim = named(start, 'Void Whelp');
    const survivor = named(start, 'Hearth Sentry');

    const after = sweep(start);
    expect(after.objects[victim]?.zone).toBe('exile');
    expect(after.objects[survivor]?.zone).toBe('battlefield');
    expect(after.battlefield).toContain(survivor);
    expect(playerOf(after, 1).graveyard).not.toContain(victim);
  });

  /**
   * The regression the whole design turns on. Four creatures, and a sweep that
   * re-derives its group after each move walks an array that just lost an entry
   * while holding an index into the old one — which takes the first, skips the
   * second, takes the third. Four is the smallest board where "every other one"
   * and "the first half" are distinguishable from "all of them".
   */
  it('takes the whole group rather than every other member of it', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Void Scout', 1, 1), controller: 1 },
        { card: creature('Void Brute', 3, 3), controller: 1 },
        { card: creature('Void Runner', 2, 1), controller: 1 },
        { card: creature('Void Vanguard', 4, 4), controller: 1 },
      ],
      hands: [[RECKONING], []],
    }).state;
    const group = objectsInEffectScope(start, 'creaturesThatPlayerControls', 1);
    expect(group).toHaveLength(4);

    const after = sweep(start);
    for (const oid of group) {
      expect(after.objects[oid]?.zone, oid).toBe('exile');
    }
    expect(after.battlefield.filter((oid) => group.includes(oid))).toEqual([]);
    // Only the caster's lands are left standing.
    expect(after.battlefield).toHaveLength(3);
  });

  /**
   * Battlefield order, and it is a claim about the *record* rather than about
   * taste: `state.battlefield` is appended in the order objects entered, so an
   * order read off it is a function of state and replays. The second half is the
   * same scenario built twice — identical fingerprints, which is what a session
   * replay checks one layer up.
   */
  it('exiles in battlefield order, so two identical games stay identical', () => {
    // The cards are minted once and the state twice: `creature()` hands out a
    // fresh card id per call, so rebuilding the cards would change the
    // fingerprint for a reason that has nothing to do with the sweep.
    const bodies = [creature('First In', 1, 1), creature('Second In', 2, 2), creature('Third In', 3, 3)];
    const build = (): GameState =>
      scenario({
        battlefield: [...swamps(3, 0), ...bodies.map((card) => ({ card, controller: 1 as const }))],
        hands: [[RECKONING], []],
      }).state;

    const start = build();
    const expected = objectsInEffectScope(start, 'creaturesThatPlayerControls', 1);
    expect(expected.map((oid) => start.objects[oid]?.card.name)).toEqual([
      'First In',
      'Second In',
      'Third In',
    ]);

    const after = sweep(start);
    const exiled = after.exile.filter((oid) => expected.includes(oid));
    expect(exiled).toEqual([...expected]);
    expect(stateFingerprint(sweep(build()))).toBe(stateFingerprint(after));
  });

  /**
   * The reason the primitive is exile rather than a mass destroy, multiplied by
   * the size of the group: three death triggers that do not fire. A wipe that
   * paid the opponent three cards for the privilege would be the opposite of
   * what this card is for.
   */
  it('fires no death trigger, however many creatures it took', () => {
    const dropper = (name: string) =>
      creature(name, 2, 2, {
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfDies',
            effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
          },
        ],
      });
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: dropper('Hollow One'), controller: 1 },
        { card: dropper('Hollow Two'), controller: 1 },
        { card: dropper('Hollow Three'), controller: 1 },
      ],
      hands: [[RECKONING], []],
    }).state;
    const before = playerOf(start, 1).hand.length;

    const after = sweep(start);
    expect(after.stack).toHaveLength(0);
    expect(playerOf(after, 1).hand).toHaveLength(before);
    expect(after.exile).toHaveLength(3);
  });

  /**
   * CR 115.1. The creatures are not targets, so the spell records one choice for
   * the whole sweep and the enumeration offers exactly the one player it may
   * name — not a choice per creature, and not the caster.
   */
  it('records one target, and it is a player', () => {
    const start = scenario({
      battlefield: [
        ...swamps(3, 0),
        { card: creature('Void Whelp', 2, 2), controller: 1 },
        { card: creature('Void Brute', 3, 3), controller: 1 },
      ],
      hands: [[RECKONING], []],
    }).state;
    expect(targetChoicesFor(start, RECKONING, 0)).toEqual([[{ kind: 'player', player: 1 }]]);
  });

  /** An empty board is a legal cast that exiles nothing, not a crash. */
  it('resolves against a player with no creatures', () => {
    const start = scenario({
      battlefield: swamps(3, 0),
      hands: [[RECKONING], []],
    }).state;
    const after = sweep(start);
    expect(after.exile).toEqual([]);
    expect(playerOf(after, 1).life).toBe(20);
  });
});
