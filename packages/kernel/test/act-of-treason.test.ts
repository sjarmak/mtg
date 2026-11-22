/** Act of Treason: one target, three composed instructions, two timed layers. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  cleanupTurnEffects,
  controllerOf,
  eligibleAttackers,
  eventsOfType,
  hasKeyword,
  legalActions,
  moveObject,
  reduce,
  reduceAll,
  scenario,
} from '@mtg/kernel';
import { creature, MOUNTAIN, sorcery } from './cards';
import { handOidOf, oidOf } from './helpers';

const ACT: Card = sorcery(
  'Act of Treason',
  [
    { kind: 'gainControlUntilEndOfTurn', target: { kind: 'targetCreature' } },
    { kind: 'untapPermanent', target: { kind: 'thatCreature' } },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'haste', target: { kind: 'thatCreature' } },
  ],
  { generic: 2, R: 1 },
);

const PASSES = [
  { type: 'passPriority' as const, player: 0 as const },
  { type: 'passPriority' as const, player: 1 as const },
];

function lands(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as const }));
}

function target(state: GameState, name: string): { kind: 'permanent'; oid: ObjectId } {
  return { kind: 'permanent', oid: oidOf(state, name) };
}

function board(): ReduceResult {
  return scenario({
    battlefield: [
      { card: creature('Stolen Bear', 2, 2), controller: 1, tapped: true, summoningSick: true },
      { card: creature('Other Bear', 2, 2), controller: 1, tapped: true },
      ...lands(3),
    ],
    hands: [[ACT], []],
  });
}

function cast(start: ReduceResult): ReduceResult {
  const action = legalActions(start.state).find(
    (candidate) => candidate.type === 'castSpell' && candidate.oid === handOidOf(start.state, 0, ACT.name),
  );
  expect(action).toEqual(
    expect.objectContaining({
      targets: [target(start.state, 'Stolen Bear'), null, null],
    }),
  );
  return reduce(start.state, action as never);
}

function resolve(castResult: ReduceResult): ReduceResult {
  const resolved = reduceAll(castResult.state, PASSES);
  return { state: resolved.state, events: [...castResult.events, ...resolved.events] };
}

describe('Act of Treason in the kernel', () => {
  it('takes, untaps, and gives haste to the one chosen creature until cleanup', () => {
    const start = board();
    const stolen = oidOf(start.state, 'Stolen Bear');
    const other = oidOf(start.state, 'Other Bear');

    const done = resolve(cast(start));

    expect(controllerOf(done.state, stolen)).toBe(0);
    expect(done.state.objects[stolen]?.tapped).toBe(false);
    expect(hasKeyword(done.state, stolen, 'haste')).toBe(true);
    expect(controllerOf(done.state, other)).toBe(1);
    expect(done.state.objects[other]?.tapped).toBe(true);
    expect(hasKeyword(done.state, other, 'haste')).toBe(false);
    expect(eventsOfType(done.events, 'controlEffectAdded')).toEqual([
      expect.objectContaining({ targetOid: stolen, controller: 0, layer: '2' }),
    ]);

    const combat = { ...done.state, turn: { ...done.state.turn, step: 'declareAttackers' as const } };
    expect(eligibleAttackers(combat)).toContain(stolen);

    const cleaned = cleanupTurnEffects(beginTrace(done.state));
    expect(controllerOf(cleaned.state, stolen)).toBe(1);
    expect(hasKeyword(cleaned.state, stolen, 'haste')).toBe(false);
  });

  it('does nothing when the only chosen target leaves before resolution', () => {
    const start = board();
    const stolen = oidOf(start.state, 'Stolen Bear');
    const announced = cast(start);
    const bounced = moveObject(beginTrace(announced.state), stolen, 'hand');
    const resolved = reduceAll(bounced.state, PASSES);
    const events = [...announced.events, ...bounced.events, ...resolved.events];

    expect(eventsOfType(events, 'spellFizzled')).toHaveLength(1);
    expect(eventsOfType(events, 'controlEffectAdded')).toEqual([]);
    expect(eventsOfType(events, 'permanentUntapped')).toEqual([]);
    expect(eventsOfType(events, 'keywordGranted')).toEqual([]);
  });

  it('does not follow the card through a new battlefield incarnation', () => {
    const start = board();
    const stolen = oidOf(start.state, 'Stolen Bear');
    const done = resolve(cast(start));

    const bounced = moveObject(beginTrace(done.state), stolen, 'hand');
    const returned = moveObject(bounced, stolen, 'battlefield', { controller: 1 });

    expect(controllerOf(returned.state, stolen)).toBe(1);
    expect(hasKeyword(returned.state, stolen, 'haste')).toBe(false);
    expect(eventsOfType(returned.events, 'continuousEffectsExpired')).toEqual([
      expect.objectContaining({ ids: expect.arrayContaining([expect.any(String), expect.any(String)]) }),
    ]);
  });
});
