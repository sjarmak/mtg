/** RTR #109: one retained creature through control, untap, pump, haste, and cleanup. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  cleanupTurnEffects,
  controllerOf,
  eventsOfType,
  hasKeyword,
  legalActions,
  moveObject,
  reduce,
  reduceAll,
  scenario,
  powerOf,
  toughnessOf,
} from '@mtg/kernel';
import { creature, MOUNTAIN, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const CARD: Card = sorcery(
  'Traitorous Instinct',
  [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    {
      kind: 'pumpUntilEndOfTurn',
      power: 2,
      toughness: 0,
      keyword: 'haste',
      target: { kind: 'thatCreature' },
    },
  ],
  { generic: 3, R: 1 },
);

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function target(oid: ObjectId) {
  return { kind: 'permanent' as const, oid };
}

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: creature('Instinct Target', 3, 4), controller: 1, tapped: true, summoningSick: true },
      ...Array.from({ length: 4 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    ],
    hands: [[CARD], []],
  });
}

function cast(start: ReduceResult): { readonly announced: ReduceResult; readonly oid: ObjectId } {
  const oid = oidOf(start.state, 'Instinct Target');
  const action = legalActions(start.state).find(
    (candidate) => candidate.type === 'castSpell' && candidate.oid === handOidOf(start.state, 0, CARD.name),
  );
  expect(action).toEqual(expect.objectContaining({ targets: [target(oid), null, null] }));
  return { announced: reduce(start.state, action as never), oid };
}

describe('RTR Traitorous Instinct in the kernel', () => {
  it('takes, untaps, pumps, and grants haste until cleanup without retapping', () => {
    const { announced, oid } = cast(board());
    const done = reduceAll(announced.state, PASSES);

    expect(controllerOf(done.state, oid)).toBe(0);
    expect(done.state.objects[oid]?.tapped).toBe(false);
    expect({ power: powerOf(done.state, oid), toughness: toughnessOf(done.state, oid) }).toEqual({
      power: 5,
      toughness: 4,
    });
    expect(hasKeyword(done.state, oid, 'haste')).toBe(true);

    const cleaned = cleanupTurnEffects(beginTrace(done.state));
    expect(controllerOf(cleaned.state, oid)).toBe(1);
    expect(cleaned.state.objects[oid]?.tapped).toBe(false);
    expect({ power: powerOf(cleaned.state, oid), toughness: toughnessOf(cleaned.state, oid) }).toEqual({
      power: 3,
      toughness: 4,
    });
    expect(hasKeyword(cleaned.state, oid, 'haste')).toBe(false);
  });

  it('fizzles the whole chain when its sole target leaves in response', () => {
    const { announced, oid } = cast(board());
    const moved = moveObject(beginTrace(announced.state), oid, 'hand');
    const done = reduceAll(moved.state, PASSES);
    const events = [...announced.events, ...moved.events, ...done.events];

    expect(eventsOfType(events, 'spellFizzled')).toHaveLength(1);
    expect(eventsOfType(events, 'controlEffectAdded')).toEqual([]);
    expect(eventsOfType(events, 'permanentUntapped')).toEqual([]);
    expect(eventsOfType(events, 'continuousEffectAdded')).toEqual([]);
  });
});
