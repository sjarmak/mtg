/** Discard targeting scores cards that can actually leave the named hands. */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import { scenario, type GameState, type Target } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, scoreEffectTargets } from '@mtg/sim';
import { creature } from './cards';

const ONE = {
  kind: 'discardCards',
  count: 1,
  target: { kind: 'targetPlayer' },
} satisfies Effect;
const TWO = { ...ONE, count: 2 } satisfies Effect;
const EACH_TWO = {
  kind: 'discardCards',
  count: 2,
  target: { kind: 'noTarget' },
  players: 'eachPlayer',
} satisfies Effect;

function score(state: GameState, effect: Effect, target: Target | null): number {
  const config = DEFAULT_GREEDY_CONFIG;
  return scoreEffectTargets(state, 0, [effect], [target], config.cast, config.target, config.race);
}

describe('discard target policy', () => {
  it('does not price cards beyond a targeted player’s actual hand', () => {
    const state = scenario({ hands: [[], [creature('Only Card', 1, 1)]] }).state;
    const opponent = { kind: 'player' as const, player: 1 as const };
    expect(score(state, TWO, opponent)).toBe(score(state, ONE, opponent));
  });

  it('prices an each-player discard by the cards each seat can actually lose', () => {
    const state = scenario({
      hands: [[], [creature('First Card', 1, 1), creature('Second Card', 1, 1)]],
    }).state;
    expect(score(state, EACH_TWO, null)).toBeGreaterThan(0);
  });
});
