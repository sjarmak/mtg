/**
 * Budget behavior.
 *
 * A mass run must fail loudly rather than hang, and must never quietly drop the
 * game that went wrong — an aggregate computed over "whichever games happened
 * to finish" is a silently wrong number. Both limits are tested, and so is the
 * propagation out of a worker thread.
 */
import { describe, expect, it } from 'vitest';
import type { AgentView, PlayerAgent } from '@mtg/kernel';
import {
  createBot,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  GameBudgetExceededError,
  greedySpec,
  playSimGame,
  runMatch,
  runMatchSerial,
} from '@mtg/sim';
import type { AgentFactory, MatchSpec } from '@mtg/sim';

function baseSpec(runSeed: string): MatchSpec {
  return {
    runSeed,
    games: 4,
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    bots: [greedySpec('a'), greedySpec('b')],
  };
}

/** Wraps an agent so each decision burns wall-clock time. */
const slowFactory: AgentFactory = (spec, seed, seat) => {
  const inner = createBot(spec, seed, seat);
  const agent: PlayerAgent = {
    name: `slow-${inner.name}`,
    decide(view: AgentView) {
      const until = Date.now() + 2;
      while (Date.now() < until) {
        // Deliberate busy wait: the time budget must trip on wall clock, and a
        // timer would not be observable from a synchronous decision loop.
      }
      return inner.decide(view);
    },
  };
  return agent;
};

describe('per-game budget', () => {
  it('aborts on the decision limit with the game seed in the message', () => {
    expect(() =>
      playSimGame({
        index: 0,
        seed: 'budget/decisions',
        decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
        agents: [createBot(greedySpec('a'), 'a', 0), createBot(greedySpec('b'), 'b', 1)],
        startingPlayer: 0,
        budget: { maxDecisions: 5, maxMillis: 30_000 },
      }),
    ).toThrowError(GameBudgetExceededError);
  });

  it('names the limit it blew', () => {
    try {
      playSimGame({
        index: 3,
        seed: 'budget/named',
        decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
        agents: [createBot(greedySpec('a'), 'a', 0), createBot(greedySpec('b'), 'b', 1)],
        startingPlayer: 0,
        budget: { maxDecisions: 3, maxMillis: 30_000 },
      });
      throw new Error('expected the budget to trip');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GameBudgetExceededError);
      if (!(error instanceof GameBudgetExceededError)) return;
      expect(error.limit).toBe('decisions');
      expect(error.seed).toBe('budget/named');
      expect(error.message).toContain('budget/named');
    }
  });

  it('aborts on the wall-clock limit', () => {
    expect(() =>
      runMatchSerial(
        { ...baseSpec('budget/time'), budget: { maxDecisions: 100_000, maxMillis: 5 } },
        {
          agentFactory: slowFactory,
        },
      ),
    ).toThrowError(/exceeded its time budget/);
  });

  it('kills the whole run rather than dropping the game that blew up', async () => {
    await expect(
      runMatch(
        { ...baseSpec('budget/worker'), games: 8, budget: { maxDecisions: 4, maxMillis: 30_000 } },
        {
          workers: 2,
        },
      ),
    ).rejects.toThrow(/exceeded its decisions budget/);
  }, 60_000);

  it('refuses a custom agent factory on a worker run instead of silently ignoring it', async () => {
    await expect(
      runMatch(baseSpec('budget/factory'), { workers: 4, agentFactory: slowFactory }),
    ).rejects.toThrow(/cannot cross a worker boundary/);
  });

  it('rejects a nonsensical match spec up front', () => {
    expect(() => runMatchSerial({ ...baseSpec('bad'), games: 0 })).toThrowError(
      /positive integer game count/,
    );
    expect(() => runMatchSerial({ ...baseSpec('bad'), runSeed: '' })).toThrowError(/non-empty run seed/);
  });
});
