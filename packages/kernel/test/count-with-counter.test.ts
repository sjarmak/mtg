/**
 * `countWithCounter`: the kernel counting permanents by what is sitting on
 * them rather than by what they are.
 *
 * `count-matching.test.ts` is the sibling for a count over characteristics, and
 * the difference between the two files is the whole reason this amount is a
 * member of its own. A characteristic is layer output and `matchesFilter` reads
 * it off `Characteristics`; a counter is on the `GameObject`, and layer 7d
 * derives power *from* it, so the count has to reach past the characteristic
 * map to `state.objects` exactly as `conditionHolds`'s `anyCreatureHasCounter`
 * arm already does. Both halves are asserted here — the one-shot amount an
 * effect reads at resolution, and the CR 613 rate a `statBonusPer` static
 * charges on every layer walk.
 *
 * The counter's own contribution is the trap this file is written around. A
 * horn counter is +1/+1 and first strike by declaration (`@mtg/dsl`'s
 * `COUNTER_DECLARATIONS`), so a creature carrying one is already bigger before
 * the anthem reads it; the expected numbers below carry both terms, and a
 * bearer and a non-bearer stand side by side in every board so no assertion can
 * be satisfied by the counter alone.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Amount, Card } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import { playerOf, powerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { artifact, creature, SWAMP, sorcery } from './cards';
import { withCounters } from './continuous-helpers';
import { oidOf } from './helpers';

/** "Creatures you control with a horn or a hide counter on them." */
const PART_BEARERS: Amount = {
  kind: 'countWithCounter',
  filter: { cardTypes: ['creature'] },
  counters: ['horn', 'hide'],
};

const ARMORY_STATIC: AbilityInput = {
  kind: 'static',
  scope: 'creaturesYouControl',
  modification: { kind: 'statBonusPer', power: 1, toughness: 1, each: PART_BEARERS },
};

const ARMORY = artifact('Trophy Rack', { generic: 3 }, [ARMORY_STATIC]);

/** "Deals damage to target opponent equal to the number of part bearers." */
const TALLY = sorcery(
  'Count the Trophies',
  [{ kind: 'dealDamage', amount: PART_BEARERS, target: { kind: 'targetOpponent' } }],
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

function castAtOpponent(start: GameState): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'player', player: 1 }],
  });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

/**
 * Four bodies with one counter each where the board wants one: a horn bearer,
 * a hide bearer, a creature carrying a counter this amount does not name, and a
 * horn bearer across the table.
 */
function board(extra: readonly { card: Card; controller: 0 | 1 }[] = []): GameState {
  const start = scenario({
    battlefield: [
      ...swamps(3, 0),
      { card: creature('Horned Ally', 2, 2), controller: 0 },
      { card: creature('Hided Ally', 2, 2), controller: 0 },
      { card: creature('Gloomed Ally', 2, 2), controller: 0 },
      { card: creature('Bare Ally', 2, 2), controller: 0 },
      { card: creature('Horned Foe', 2, 2), controller: 1 },
      ...extra,
    ],
    hands: [[TALLY], []],
  }).state;
  let state = withCounters(start, oidOf(start, 'Horned Ally'), 'horn', 1);
  state = withCounters(state, oidOf(state, 'Hided Ally'), 'hide', 1);
  state = withCounters(state, oidOf(state, 'Gloomed Ally'), 'gloom', 1);
  return withCounters(state, oidOf(state, 'Horned Foe'), 'horn', 1);
}

describe('a one-shot quantity counted off the counters on a board', () => {
  it('counts a permanent once for each named counter it carries, and skips the rest', () => {
    // Two bearers: the horn and the hide. The gloom counter is a counter this
    // amount does not name and the opposing horn is on the wrong side.
    expect(playerOf(castAtOpponent(board()), 1).life).toBe(18);
  });

  it('counts a permanent once however many named counters sit on it', () => {
    const start = board();
    const both = withCounters(start, oidOf(start, 'Horned Ally'), 'hide', 1);

    // Still two: the horn bearer now carries a hide as well, and a tally of
    // permanents is not a tally of counters.
    expect(playerOf(castAtOpponent(both), 1).life).toBe(18);
  });

  it('is zero when nothing on the board carries one, not an error', () => {
    const start = scenario({
      battlefield: [...swamps(3, 0), { card: creature('Bare Ally', 2, 2), controller: 0 }],
      hands: [[TALLY], []],
    }).state;

    expect(playerOf(castAtOpponent(start), 1).life).toBe(20);
  });
});

describe('a CR 613 rate charged per counter-bearing permanent', () => {
  it('scales every creature its controller has by the number of bearers', () => {
    const state = board([{ card: ARMORY, controller: 0 }]);

    // Two bearers, so +2/+2 from the anthem. The horn bearer is 2/2 printed,
    // +1/+1 from the counter itself (layer 7d), +2/+2 from the rate.
    expect(powerOf(state, oidOf(state, 'Horned Ally'))).toBe(5);
    // A creature carrying nothing is still an anthem beneficiary: the rate says
    // which permanents are *counted*, not which are affected.
    expect(powerOf(state, oidOf(state, 'Bare Ally'))).toBe(4);
    // The gloom counter subtracts its own -1/-1 and adds nothing to the count.
    expect(powerOf(state, oidOf(state, 'Gloomed Ally'))).toBe(3);
  });

  it('reads only its controller’s side, so an opposing bearer neither counts nor benefits', () => {
    const state = board([{ card: ARMORY, controller: 0 }]);

    // 2/2 printed, +1/+1 from its own horn counter, and nothing from an anthem
    // scoped to the other player's creatures.
    expect(powerOf(state, oidOf(state, 'Horned Foe'))).toBe(3);
  });

  it('follows the board: a counter added after the walk moves the rate', () => {
    const before = board([{ card: ARMORY, controller: 0 }]);
    const after = withCounters(before, oidOf(before, 'Bare Ally'), 'horn', 1);

    expect(powerOf(before, oidOf(before, 'Bare Ally'))).toBe(4);
    // Three bearers now, and the newest one carries its own counter too.
    expect(powerOf(after, oidOf(after, 'Bare Ally'))).toBe(6);
  });
});
