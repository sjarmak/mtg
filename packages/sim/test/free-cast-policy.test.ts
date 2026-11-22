/** Bot-policy coverage for a compulsory, effect-instructed free cast. */
import { parseCard } from '@mtg/dsl';
import { scenario, type Action, type AgentView } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy, randomBot } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { bestTargetingPerCard } from '../src/policies/cast';

const BLAST = parseCard({
  kind: 'sorcery',
  id: 'free-cast-policy-blast',
  name: 'Free Cast Policy Blast',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 160 },
  colors: ['R'],
  manaCost: { generic: 11, R: 1 },
  effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
});

function view(): AgentView {
  const state = scenario({ active: 0, step: 'upkeep', hands: [[BLAST], []] }).state;
  const oid = state.players[0].hand[0];
  if (oid === undefined) throw new Error('free-cast policy fixture lost its spell');
  const options: readonly Extract<Action, { type: 'castSpell' }>[] = [0, 1].map((player) => ({
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'player', player: player as 0 | 1 }],
    castingCost: 'withoutMana',
  }));
  return {
    state: observeState(state, 0, 'test/free-cast-policy.test.ts:31'),
    player: 0,
    decision: { kind: 'freeCast', player: 0, oid, optional: false, options, complete: true },
  };
}

describe('free-cast bot policy', () => {
  it('values the cast at zero mana and keeps target choice live', () => {
    const candidates = bestTargetingPerCard(view(), DEFAULT_GREEDY_CONFIG);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.cost).toBe(0);
    expect(candidates[0]?.action.targets[0]).toEqual({ kind: 'player', player: 1 });
  });

  it('makes the compulsory declaration in both maintained bot implementations', () => {
    const current = view();
    expect(decideGreedy(current, DEFAULT_GREEDY_CONFIG).type).toBe('castSpell');
    expect(randomBot('wild-random', 'wild-seed').decide(current).type).toBe('castSpell');
  });
});
