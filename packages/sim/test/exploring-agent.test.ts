/**
 * The exploring generator's two load-bearing properties.
 *
 * It exists to give an outcome-trained evaluator coverage of actions the
 * reference policy would never take, so the rate has to be the rate asked for -
 * a wrapper that silently explored at zero would regenerate exactly the
 * greedy-only dataset that produced a 95.9% copy of greedy (mtg-bw8z.1), and
 * every downstream campaign would measure the same thing again without saying
 * so. And it has to replay: `packages/engine/src/determinism.ts` makes seed plus
 * choice list the entire record of a kernel game, so a generator whose
 * deviations drifted between runs would make every game it produced
 * unreproducible and every regression in it unattributable.
 */
import { describe, expect, it } from 'vitest';
import { actionKey, type PlayerAgent } from '@mtg/kernel';
import { playSimGame } from '../src/driver';
import { greedyBot } from '../src/greedy-bot';
import { DEFAULT_GREEDY_CONFIG } from '../src/config';
import { FIXTURE_DECK_RW, FIXTURE_DECK_UB } from '../src/fixtures';
import { exploringAgent, type ExploringAgent } from '../src/exploring-agent';

function play(agents: readonly [PlayerAgent, PlayerAgent], index = 0) {
  return playSimGame({
    index,
    seed: `exploring-agent/test:${String(index)}`,
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    startingPlayer: 0,
    agents,
    log: null,
    collectEvents: true,
  });
}

function seats(epsilon: number, streamSeed: string): readonly [ExploringAgent, ExploringAgent] {
  return [
    exploringAgent(greedyBot('left', DEFAULT_GREEDY_CONFIG), { epsilon, streamSeed }),
    exploringAgent(greedyBot('right', DEFAULT_GREEDY_CONFIG), { epsilon, streamSeed }),
  ];
}

describe('exploring agent', () => {
  it('is exactly the reference policy at epsilon zero', () => {
    const plain = play([greedyBot('left', DEFAULT_GREEDY_CONFIG), greedyBot('right', DEFAULT_GREEDY_CONFIG)]);
    const wrapped = seats(0, 'zero');
    const explored = play(wrapped);
    expect(explored.winner).toBe(plain.winner);
    expect(explored.turns).toBe(plain.turns);
    expect(wrapped.every((seat) => seat.census().explored === 0)).toBe(true);
    expect(wrapped.reduce((total, seat) => total + seat.census().owned, 0)).toBeGreaterThan(0);
  });

  it('replays bit-exactly on the same stream seed', () => {
    const first = play(seats(0.25, 'replay'));
    const second = play(seats(0.25, 'replay'));
    expect(second.winner).toBe(first.winner);
    expect(second.turns).toBe(first.turns);
    expect((second.events ?? []).map((event) => JSON.stringify(event))).toEqual(
      (first.events ?? []).map((event) => JSON.stringify(event)),
    );
  });

  it('draws a different game from a different stream seed', () => {
    const a = play(seats(0.25, 'stream-a'));
    const b = play(seats(0.25, 'stream-b'));
    expect((b.events ?? []).length === (a.events ?? []).length && b.winner === a.winner).toBe(false);
  });

  it('deviates at about the rate it was given', () => {
    for (const epsilon of [0.1, 0.5] as const) {
      let owned = 0;
      let explored = 0;
      for (let index = 0; index < 6; index += 1) {
        const wrapped = seats(epsilon, `rate/${String(epsilon)}`);
        play(wrapped, index);
        for (const seat of wrapped) {
          owned += seat.census().owned;
          explored += seat.census().explored;
        }
      }
      expect(owned).toBeGreaterThan(200);
      // Drawing uniformly over the options includes the reference's own action,
      // so the observed rate sits below epsilon rather than at it.
      expect(explored / owned).toBeGreaterThan(epsilon * 0.4);
      expect(explored / owned).toBeLessThan(epsilon);
    }
  });

  it('refuses a rate outside zero to one, and an unnamed stream', () => {
    const greedy = greedyBot('left', DEFAULT_GREEDY_CONFIG);
    expect(() => exploringAgent(greedy, { epsilon: 1.5, streamSeed: 's' })).toThrow('epsilon');
    expect(() => exploringAgent(greedy, { epsilon: -0.1, streamSeed: 's' })).toThrow('epsilon');
    expect(() => exploringAgent(greedy, { epsilon: 0.1, streamSeed: '' })).toThrow('streamSeed');
  });

  it('only ever returns an action the decision offered', () => {
    let checked = 0;
    const watched = (name: string): PlayerAgent => {
      const inner = exploringAgent(greedyBot(name, DEFAULT_GREEDY_CONFIG), {
        epsilon: 1,
        streamSeed: 'coverage',
      });
      return {
        name,
        decide(view) {
          const action = inner.decide(view);
          if (view.decision.complete && view.decision.options.length >= 2) {
            const offered = new Set(view.decision.options.map((option) => actionKey(option)));
            expect(offered.has(actionKey(action))).toBe(true);
            checked += 1;
          }
          return action;
        },
      };
    };
    play([watched('left'), watched('right')]);
    expect(checked).toBeGreaterThan(50);
  });
});
