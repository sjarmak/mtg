import { describe, expect, it } from 'vitest';
import type { BotEvidenceEpisode } from '@mtg/bot-evidence';
import { BotEvidenceEpisodeSchema, botEvidenceSha256, serializedBotEvidenceEpisode } from '@mtg/bot-evidence';
import type { Action, PlayerAgent } from '@mtg/kernel';
import { playSimGame } from '../src/driver';
import { NativeGameplayEvidenceError, type NativeGameplayEvidenceRequest } from '../src/native-game-evidence';
import { FIXTURE_DECK_RW } from '../src/fixtures';
import { greedyBot } from '../src/greedy-bot';

const DIGEST = 'a'.repeat(64);

function request(): NativeGameplayEvidenceRequest {
  const config = { policy: 'greedy-test' };
  return {
    id: 'native-evidence-game',
    runtime: { version: 'kernel-test', buildSha256: DIGEST },
    subject: { formatId: 'fixture', formatSha256: DIGEST, cardsSha256: DIGEST },
    features: { schemaId: 'agent-observation-v1', schemaSha256: DIGEST },
    behavior: {
      policyId: 'greedy-test',
      config,
      configSha256: botEvidenceSha256(config),
      modelSha256: null,
      dataSha256: null,
    },
    lineage: { gameId: 'native-evidence-game' },
    splitGroup: { kind: 'game', id: 'native-evidence-game' },
  };
}

function play(
  evidence?: NativeGameplayEvidenceRequest,
  observations?: 'retained' | 'digest',
): ReturnType<typeof playSimGame> {
  return playSimGame({
    index: 0,
    seed: 'native-evidence-seed',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_RW],
    startingPlayer: 0,
    agents: [greedyBot('left'), greedyBot('right')],
    ...(evidence === undefined ? {} : { evidence }),
    ...(observations === undefined ? {} : { observations }),
  });
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected call to throw');
}

describe('native game evidence collection', { timeout: 20_000 }, () => {
  it('does not alter the ordinary outcome shape when collection is disabled', () => {
    expect('evidence' in play()).toBe(false);
  });

  it('keeps only observation digests when asked and plays the same game', () => {
    const retained = play(request()).evidence as BotEvidenceEpisode;
    const digest = play(request(), 'digest').evidence as BotEvidenceEpisode;
    expect(BotEvidenceEpisodeSchema.parse(digest)).toEqual(digest);
    expect(digest.decisions.length).toBe(retained.decisions.length);
    expect(digest.decisions.every((decision) => !('value' in decision.observation))).toBe(true);
    expect(digest.decisions.map((decision) => decision.observation.sha256)).toEqual(
      retained.decisions.map((decision) => decision.observation.sha256),
    );
    expect(digest.outcome).toEqual(retained.outcome);
    expect(serializedBotEvidenceEpisode(digest).length * 10).toBeLessThan(
      serializedBotEvidenceEpisode(retained).length,
    );
  });

  it('records every decision and the completed outcome in the shared contract', () => {
    const outcome = play(request());
    const evidence = outcome.evidence as BotEvidenceEpisode;
    expect(BotEvidenceEpisodeSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.episode).toMatchObject({
      stage: 'gameplay',
      seed: outcome.seed,
      runtime: { kind: 'native' },
    });
    expect(evidence.decisions).toHaveLength(outcome.decisions);
    expect(evidence.decisions.map((decision) => decision.sequence)).toEqual(
      Array.from({ length: outcome.decisions }, (_, index) => index),
    );
    expect(evidence.outcome).toEqual({
      status: 'completed',
      value: {
        winner: outcome.winner,
        reason: outcome.reason,
        turns: outcome.turns,
        decisions: outcome.decisions,
        startingPlayer: outcome.startingPlayer,
      },
    });
  });

  it('serializes byte-identically for the same seed and policies', () => {
    const first = play(request()).evidence as BotEvidenceEpisode;
    const second = play(request()).evidence as BotEvidenceEpisode;
    expect(serializedBotEvidenceEpisode(first)).toBe(serializedBotEvidenceEpisode(second));
  });

  it('rejects invalid provenance before starting a game', () => {
    const invalid = request();
    const bad: NativeGameplayEvidenceRequest = {
      ...invalid,
      behavior: { ...invalid.behavior, configSha256: DIGEST },
    };
    expect(() => play(bad)).toThrow(/behavior config SHA-256/);
  });

  it('carries the exact attempted action when an agent answers for the wrong seat', () => {
    const wrongSeat: PlayerAgent = {
      name: 'wrong-seat',
      decide(view): Action {
        return { type: 'passPriority', player: view.player === 0 ? 1 : 0 };
      },
    };
    const error = thrownBy(() =>
      playSimGame({
        index: 0,
        seed: 'native-evidence-seed',
        decks: [FIXTURE_DECK_RW, FIXTURE_DECK_RW],
        startingPlayer: 0,
        agents: [wrongSeat, wrongSeat],
        evidence: request(),
      }),
    );
    expect(error).toBeInstanceOf(NativeGameplayEvidenceError);
    const evidence = (error as NativeGameplayEvidenceError).evidence;
    expect(BotEvidenceEpisodeSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.outcome.status).toBe('illegal-action');
    expect(evidence.decisions).toHaveLength(1);
    expect(evidence.decisions[0]?.choice).toMatchObject({
      status: 'illegal-action',
      attempted: { value: { type: 'passPriority', player: 1 } },
    });
  });

  it('keeps a partial episode when the decision budget is exhausted', () => {
    const error = thrownBy(() =>
      playSimGame({
        index: 0,
        seed: 'native-evidence-seed',
        decks: [FIXTURE_DECK_RW, FIXTURE_DECK_RW],
        startingPlayer: 0,
        agents: [greedyBot('left'), greedyBot('right')],
        budget: { maxDecisions: 0, maxMillis: 30_000 },
        evidence: request(),
      }),
    );
    expect(error).toBeInstanceOf(NativeGameplayEvidenceError);
    const evidence = (error as NativeGameplayEvidenceError).evidence;
    expect(BotEvidenceEpisodeSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.decisions).toEqual([]);
    expect(evidence.outcome).toMatchObject({ status: 'incomplete', error: expect.any(String) });
  });
});
