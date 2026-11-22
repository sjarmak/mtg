/** Bot policy coverage for the mandatory Populate choice. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { AgentView, Decision } from '@mtg/kernel';
import { scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy, randomBot } from '@mtg/sim';

function token(name: string, power: number, toughness: number, collectorNumber: number) {
  return parseCard({
    kind: 'creature',
    id: `populate-policy-${String(collectorNumber)}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber },
    manaCost: {},
    colors: [],
    subtypes: ['Citizen'],
    power,
    toughness,
  });
}

describe('Populate bot policy', () => {
  it('keeps random play legal and makes greedy play copy the largest body', () => {
    const state = scenario({
      battlefield: [
        { card: token('Small Citizen', 1, 1, 1), controller: 0, token: true },
        { card: token('Large Citizen', 3, 3, 2), controller: 0, token: true },
      ],
    }).state;
    const [small, large] = state.battlefield;
    if (small === undefined || large === undefined) throw new Error('Populate policy board is incomplete');
    const decision: Extract<Decision, { kind: 'populate' }> = {
      kind: 'populate',
      player: 0,
      tokens: [small, large],
      options: [
        { type: 'choosePopulateToken', player: 0, token: small },
        { type: 'choosePopulateToken', player: 0, token: large },
      ],
      complete: true,
    };
    const view: AgentView = {
      state: observeState(state, 0, 'test/rtr-populate-policy.test.ts:43'),
      player: 0,
      decision,
    };

    expect(decideGreedy(view, DEFAULT_GREEDY_CONFIG)).toEqual(decision.options[1]);
    expect(decision.options).toContainEqual(randomBot('populate', 'populate-seed').decide(view));
  });
});
