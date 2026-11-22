/** Copiable-value, payment, and live subtype-count probes for RTR #73. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import type { Action, GameState, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  scenario,
} from '@mtg/kernel';
import { creature, lands, SWAMP } from './cards';
import { apply, oidOf } from './helpers';

const PACK_RAT = parseCard({
  kind: 'creature',
  id: 'rtr-073-pack-rat-kernel',
  name: 'Pack Rat',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 73 },
  colors: ['B'],
  manaCost: { generic: 1, B: 1 },
  power: 0,
  toughness: 0,
  subtypes: ['Rat'],
  characteristicPowerToughness: { kind: 'controlledSubtype', subtype: 'Rat' },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, B: 1 }, discard: 1 },
      effects: [{ kind: 'createTokenCopyOfSelf' }],
    },
  ],
});
const OTHER_RAT = creature('Other Rat', 1, 1, { subtypes: ['Rat'] });
const HELD = creature('Pack Rat payment', 1, 1);

function activation(state: GameState, source: string): Extract<Action, { type: 'activateAbility' }> {
  const found = legalActions(state).find(
    (action): action is Extract<Action, { type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  );
  if (found === undefined) throw new Error('Pack Rat activation was not offered');
  return found;
}

function settleAbility(start: ReduceResult): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 8; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority' || current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Pack Rat ability did not settle');
}

function opened(withCard = true): { readonly result: ReduceResult; readonly source: string } {
  const result = scenario({
    battlefield: [
      { card: PACK_RAT, controller: 0 },
      { card: OTHER_RAT, controller: 0 },
      ...lands(SWAMP, 3).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [withCard ? [HELD] : [], []],
  });
  return { result, source: oidOf(result.state, PACK_RAT.name) };
}

describe('RTR Pack Rat in the kernel', () => {
  it('pays one discard, copies only copiable values, and reevaluates every Rat at three', () => {
    const run = opened();
    expect(powerOf(run.result.state, run.source)).toBe(2);
    const paid = reduce(run.result.state, activation(run.result.state, run.source));
    expect(paid.state.players[0].hand).toEqual([]);
    const done = settleAbility(paid);
    const packRats = done.state.battlefield.filter(
      (oid) => done.state.objects[oid]?.card.name === PACK_RAT.name,
    );
    expect(packRats).toHaveLength(2);
    expect(packRats.map((oid) => done.state.objects[oid]?.token)).toContain(true);
    expect(packRats.map((oid) => powerOf(done.state, oid))).toEqual([3, 3]);
  });

  it('retains the activating creature copy after source departure and does not copy counters', () => {
    const run = opened();
    const paid = reduce(run.result.state, activation(run.result.state, run.source));
    const departed = moveObject(beginTrace(paid.state), run.source, 'graveyard');
    const done = settleAbility({ state: departed.state, events: [...paid.events, ...departed.events] });
    const token = done.state.battlefield.find(
      (oid) =>
        done.state.objects[oid]?.token === true && done.state.objects[oid]?.card.name === PACK_RAT.name,
    );
    expect(token).toBeDefined();
    expect(token === undefined ? null : powerOf(done.state, token)).toBe(2);
    expect(token === undefined ? null : done.state.objects[token]?.counters.plusOnePlusOne).toBe(0);
  });

  it('offers no activation without the card its discard cost requires', () => {
    const run = opened(false);
    expect(legalActions(run.result.state).some((action) => action.type === 'activateAbility')).toBe(false);
  });
});
