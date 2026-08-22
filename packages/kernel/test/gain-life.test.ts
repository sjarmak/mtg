/**
 * `youGainLife`: CR 119.3's life-total increase, read off `lifeChanged`.
 *
 * `combat-keywords.test.ts`'s lifelink describe already proves lifelink is a
 * `lifeChanged` event with `reason: 'lifelink'` (CR 702.15e: lifelink is a
 * form of life gain, not a trigger of its own), so this file's job is the
 * condition, not the event — it has to fire off both `'gainLife'` and
 * `'lifelink'` reasons, and stay silent on `'damage'`, which is a life *loss*
 * riding the same event type. The reward effect below is `drawCards` rather
 * than another `gainLife`: a trigger whose own payoff is the condition it
 * watches for would refire itself forever, and that bug would be invisible to
 * an assertion that only reads whether the condition fired once.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { eventsOfType, reduce, reduceAll, scenario, type ObjectId, type ReduceResult } from '@mtg/kernel';
import { creature, MOUNTAIN, sorcery } from './cards';
import { handOidOf, oidOf, playCombat } from './helpers';

const LIFE_WARDEN: Card = creature('Life Warden', 2, 2, {
  cost: { generic: 2 },
  abilities: [
    {
      kind: 'triggered',
      condition: 'youGainLife',
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

const REFRESH: Card = sorcery(
  'Test Refresh',
  [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
  {
    generic: 1,
  },
);

function conditionsFiredBy(result: ReduceResult, source: ObjectId): readonly string[] {
  return eventsOfType(result.events, 'abilityTriggered')
    .filter((event) => event.source === source)
    .map((event) => event.condition);
}

describe('whenever you gain life', () => {
  it('fires when its controller gains life from a spell', () => {
    const start = scenario({
      battlefield: [
        { card: LIFE_WARDEN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[REFRESH], []],
    }).state;
    const oid = handOidOf(start, 0, 'Test Refresh');
    const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets: [null] });
    const resolved = reduceAll(cast.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]);
    const result: ReduceResult = { state: resolved.state, events: [...cast.events, ...resolved.events] };

    const warden = oidOf(result.state, 'Life Warden');
    expect(conditionsFiredBy(result, warden)).toEqual(['youGainLife']);
    expect(result.state.players[0].life).toBe(23);
  });

  it('fires when its controller gains life via lifelink combat damage', () => {
    const knight = creature('Test Lifelink Knight', 3, 3, { cost: { generic: 3 }, keywords: ['lifelink'] });
    const start = scenario({
      battlefield: [
        { card: LIFE_WARDEN, controller: 0 },
        { card: knight, controller: 0 },
      ],
      step: 'declareAttackers',
    });
    const warden = oidOf(start.state, 'Life Warden');
    const knightOid = oidOf(start.state, 'Test Lifelink Knight');

    const done = playCombat(start, { attackers: [knightOid], blocks: [] });

    expect(conditionsFiredBy(done, warden)).toEqual(['youGainLife']);
    expect(done.state.players[0].life).toBe(23);
  });

  it('does not fire when its controller loses life to combat damage', () => {
    const raider = creature('Test Raider', 2, 2, { cost: { generic: 2 } });
    const start = scenario({
      battlefield: [
        { card: LIFE_WARDEN, controller: 0 },
        { card: raider, controller: 1 },
      ],
      active: 1,
      step: 'declareAttackers',
    });
    const warden = oidOf(start.state, 'Life Warden');
    const raiderOid = oidOf(start.state, 'Test Raider');

    const done = playCombat(start, { attackers: [raiderOid], blocks: [] });

    expect(done.state.players[0].life).toBe(18);
    expect(conditionsFiredBy(done, warden)).toEqual([]);
  });

  it('does not fire for life gained by the opponent', () => {
    const start = scenario({
      battlefield: [
        { card: LIFE_WARDEN, controller: 0 },
        { card: MOUNTAIN, controller: 1 },
      ],
      hands: [[], [REFRESH]],
      active: 1,
    }).state;
    const oid = handOidOf(start, 1, 'Test Refresh');
    const cast = reduce(start, { type: 'castSpell', player: 1, oid, targets: [null] });
    const resolved = reduceAll(cast.state, [
      { type: 'passPriority', player: 1 },
      { type: 'passPriority', player: 0 },
    ]);
    const result: ReduceResult = { state: resolved.state, events: [...cast.events, ...resolved.events] };

    const warden = oidOf(result.state, 'Life Warden');
    expect(result.state.players[1].life).toBe(23);
    expect(conditionsFiredBy(result, warden)).toEqual([]);
  });
});
