/**
 * The clock on a rate-bearing one-shot: Mutilate counts the Swamps once, as it
 * resolves, and the creatures stay that size for the rest of the turn
 * (`mtg-nhyv.16`).
 *
 * CR 609.2 is the whole file. A one-shot effect determines its result when it
 * resolves and does not look again, so a Swamp sacrificed in response to the
 * deaths Mutilate caused takes nothing back. The kernel already had that
 * behavior for every other computed amount — `evaluateAmount` runs inside
 * `applyEffect` and the number it returns is written into a `ptMod` as a plain
 * integer — and the rate rides the same path rather than a new one. This file
 * is the proof that it does, because "evaluated once" is a property nothing in
 * the type system states.
 *
 * The second half is the contrast, and it is the reason `ratePer` is a separate
 * record from `statBonusPer` rather than one kind read two ways: the same
 * arithmetic charged as a CR 613.4c static *does* move when a Swamp leaves,
 * because the layer walk multiplies it out again on every pass. Both cards sit
 * on the same board below and disagree about the same removed land.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, PermanentTally, RatePer } from '@mtg/dsl';
import type { Action, GameState } from '@mtg/kernel';
import {
  beginTrace,
  destroyPermanent,
  opponentOf,
  playerOf,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { artifact, creature, SWAMP, sorcery } from './cards';
import { oidOf, oidsOf } from './helpers';

const SWAMPS: PermanentTally = { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' };

const PER_SWAMP: RatePer = { kind: 'ratePer', rate: -1, each: SWAMPS };

/** `All creatures get -1/-1 until end of turn for each Swamp you control.` — Mutilate (M13 102). */
const MUTILATE = sorcery(
  'Mutilate',
  [
    {
      kind: 'pumpUntilEndOfTurn',
      power: PER_SWAMP,
      toughness: PER_SWAMP,
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: { kind: 'noTarget' },
    },
  ],
  { generic: 2, B: 2 },
);

/** The same arithmetic as a CR 613 static, which is a different card. */
const MARSH_RACK_STATIC: AbilityInput = {
  kind: 'static',
  scope: 'creaturesYouControl',
  modification: { kind: 'statBonusPer', power: 1, toughness: 1, each: SWAMPS },
};

const MARSH_RACK = artifact('Marsh Rack', { generic: 3 }, [MARSH_RACK_STATIC]);

/** Big enough that four Swamps' worth of shrinking leaves a body behind. */
const OGRE = creature('Marsh Ogre', 6, 6, { cost: { generic: 4, B: 1 } });
const TROLL = creature('Bog Troll', 6, 6, { cost: { generic: 4, G: 1 } });

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts the caster's only card at nothing, and lets it resolve. */
function castAndResolve(start: GameState, caster: 0 | 1 = 0): GameState {
  const oid = playerOf(start, caster).hand[0] ?? '';
  const cast = reduce(start, { type: 'castSpell', player: caster, oid, targets: [null] });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: opponentOf(caster) }])
    .state;
}

/** Four Swamps, a 6/6 on each side, and Mutilate in hand. */
function board(extra: readonly { card: Card; controller: 0 | 1 }[] = []): GameState {
  return scenario({
    battlefield: [
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: SWAMP, controller: 0 },
      { card: OGRE, controller: 0 },
      { card: TROLL, controller: 1 },
      ...extra,
    ],
    hands: [[MUTILATE], []],
  }).state;
}

/** Takes `count` Swamps off the battlefield, the way a sacrifice outlet would. */
function removeSwamps(state: GameState, count: number): GameState {
  return oidsOf(state, 'Swamp')
    .slice(0, count)
    .reduce((trace, oid) => destroyPermanent(trace, oid, 'destroyEffect'), beginTrace(state)).state;
}

describe('a one-shot stat change charged per permanent', () => {
  it('multiplies the rate by the tally and reaches both sides of the table', () => {
    const after = castAndResolve(board());

    // Four Swamps at -1 each, off a printed 6/6.
    expect(powerOf(after, oidOf(after, 'Marsh Ogre'))).toBe(2);
    expect(toughnessOf(after, oidOf(after, 'Marsh Ogre'))).toBe(2);
    expect(powerOf(after, oidOf(after, 'Bog Troll'))).toBe(2);
    expect(toughnessOf(after, oidOf(after, 'Bog Troll'))).toBe(2);
  });

  it('does not look at the board again when the counted lands leave', () => {
    const after = removeSwamps(castAndResolve(board()), 3);

    // One Swamp left and the creatures are still -4/-4: CR 609.2 fixed the
    // number as the spell resolved, and nothing re-reads it. A rate that had
    // been folded into `statBonusPer` would read 7/7 here.
    expect(powerOf(after, oidOf(after, 'Marsh Ogre'))).toBe(2);
    expect(toughnessOf(after, oidOf(after, 'Marsh Ogre'))).toBe(2);
    expect(powerOf(after, oidOf(after, 'Bog Troll'))).toBe(2);
  });

  it('holds when every counted land is gone, which is the same statement at zero', () => {
    const after = removeSwamps(castAndResolve(board()), 4);

    expect(powerOf(after, oidOf(after, 'Marsh Ogre'))).toBe(2);
    expect(powerOf(after, oidOf(after, 'Bog Troll'))).toBe(2);
  });
});

describe('the same arithmetic as a CR 613 static, on the same board', () => {
  it('moves when a counted land leaves, which is the difference the two records exist for', () => {
    const start = board([{ card: MARSH_RACK, controller: 0 }]);

    // 6/6 printed, +4/+4 from four Swamps.
    expect(powerOf(start, oidOf(start, 'Marsh Ogre'))).toBe(10);

    const fewer = removeSwamps(start, 3);
    expect(powerOf(fewer, oidOf(fewer, 'Marsh Ogre'))).toBe(7);
  });

  it('leaves the resolved one-shot alone while it moves', () => {
    const after = removeSwamps(castAndResolve(board([{ card: MARSH_RACK, controller: 0 }])), 3);

    // The static is down to +1/+1 and the resolved pump is still -4/-4, on one
    // creature, in one layer, from one board: 6 + 1 - 4.
    expect(powerOf(after, oidOf(after, 'Marsh Ogre'))).toBe(3);
    // The opposing 6/6 gets no anthem, so it shows the pump alone.
    expect(powerOf(after, oidOf(after, 'Bog Troll'))).toBe(2);
  });
});
