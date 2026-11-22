/** A typed alternative casting route through the tier-one cast policy. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import type { Action, AgentView } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { bestTargetingPerCard } from '../src/policies/cast';

const DEMON = parseCard({
  kind: 'creature',
  id: 'm11-92-demon-policy',
  name: "Demon of Death's Gate",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 92 },
  manaCost: { generic: 6, B: 3 },
  colors: ['B'],
  subtypes: ['Demon'],
  power: 9,
  toughness: 9,
  keywords: ['flying', 'trample'],
  alternativeCost: {
    payLife: 6,
    sacrificeMatching: { count: 3, filter: { cardTypes: ['creature'], colors: ['B'] } },
  },
} as CardInput);

describe('alternative-cost cast policy', () => {
  it('budgets no mana for the only legal alternative route', () => {
    const state = scenario({ hands: [[DEMON], []] }).state;
    const oid = state.players[0].hand[0];
    if (oid === undefined) throw new Error('Demon was not placed in hand');
    const sacrifices = ['o10', 'o11', 'o12'];
    const options: readonly Extract<Action, { type: 'castSpell' }>[] = [
      { type: 'castSpell', player: 0, oid, targets: [], castingCost: 'alternative', sacrifices },
    ];
    const view: AgentView = {
      state: observeState(state, 0, 'test/alternative-cost-policy.test.ts:37'),
      player: 0,
      decision: { kind: 'priority', player: 0, options, complete: true },
    };

    const [candidate] = bestTargetingPerCard(view, DEFAULT_GREEDY_CONFIG);
    expect(candidate?.action.castingCost).toBe('alternative');
    expect(candidate?.cost).toBe(0);
  });

  it('keeps the printed route when mana is available instead of treating life and creatures as free', () => {
    const state = scenario({ hands: [[DEMON], []] }).state;
    const oid = state.players[0].hand[0];
    if (oid === undefined) throw new Error('Demon was not placed in hand');
    const options: readonly Extract<Action, { type: 'castSpell' }>[] = [
      { type: 'castSpell', player: 0, oid, targets: [], castingCost: 'mana' },
      {
        type: 'castSpell',
        player: 0,
        oid,
        targets: [],
        castingCost: 'alternative',
        sacrifices: ['o10', 'o11', 'o12'],
      },
    ];
    const view: AgentView = {
      state: observeState(state, 0, 'test/alternative-cost-policy.test.ts:63'),
      player: 0,
      decision: { kind: 'priority', player: 0, options, complete: true },
    };

    const [candidate] = bestTargetingPerCard(view, DEFAULT_GREEDY_CONFIG);
    expect(candidate?.action.castingCost).toBe('mana');
    expect(candidate?.cost).toBe(9);
  });
});
