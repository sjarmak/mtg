import { describe, expect, it, vi } from 'vitest';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckList } from '@mtg/kernel';
import {
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  NativeGameplayEvidenceError,
  completedNativeGameplayEvidence,
  failedNativeGameplayEvidence,
  greedyConfig,
  greedySpec,
  learnedSpec,
  nativeGameplayEvidenceIdentity,
  type BotSpec,
  type GameOutcome,
  type PlayGameOptions,
} from '@mtg/sim';
import {
  nativeBotPolicyIdentity,
  nativeGameplayFeatureIdentity,
  runNativeBotStrengthCampaign,
  type BotStrengthCampaignPlan,
  type NativeBotStrengthOpponent,
} from '../src';

const SHA = 'a'.repeat(64);
const DATA_SHA = 'd'.repeat(64);
const baseline = greedySpec('Baseline');
const candidate = greedySpec('Candidate', greedyConfig({ target: { faceDamageWeight: 1.01 } }));
const opponent = greedySpec('Frozen opponent');
const focalDeckSha256 = botEvidenceSha256(FIXTURE_DECK_RW);
const opponentDeckSha256 = botEvidenceSha256(FIXTURE_DECK_UB);

function plan(): BotStrengthCampaignPlan {
  const features = nativeGameplayFeatureIdentity();
  return {
    version: 'bot-strength-campaign-plan/v1',
    id: 'native-campaign',
    split: 'tuning',
    stage: 'gameplay',
    engine: 'native',
    runtime: { version: 'native-test', buildSha256: SHA },
    features: { baseline: features, candidate: features },
    formats: [{ id: 'fixture', formatSha256: SHA, cardsSha256: SHA }],
    primaryOutcome: 'candidate-game-score-minus-baseline',
    smallestUsefulEffect: 0.1,
    regressionMargin: 0.1,
    maximumFailureRate: 0.1,
    minimumIndependentUnits: 2,
    stoppingRule: { kind: 'fixed-independent-units', count: 2 },
    powerPlan: {
      method: 'paired-normal-approximation',
      alpha: 0.05,
      targetPower: 0.8,
      anticipatedStandardDeviation: 0.05,
      requiredIndependentUnits: 2,
    },
    policies: {
      baseline: nativeBotPolicyIdentity(baseline),
      candidate: nativeBotPolicyIdentity(candidate),
    },
    opponents: [
      {
        id: 'frozen/ub',
        ...nativeBotPolicyIdentity(opponent),
        deckSha256: opponentDeckSha256,
      },
    ],
    schedule: ['one', 'two'].flatMap((unitId) =>
      ([0, 1] as const).map((focalSeat) => ({
        unitId,
        formatId: 'fixture',
        opponentId: 'frozen/ub',
        seed: `seed-${unitId}`,
        focalSeat,
        focalDeckSha256,
      })),
    ),
  };
}

function opponents(spec: BotSpec = opponent, deck: DeckList = FIXTURE_DECK_UB) {
  return new Map<string, NativeBotStrengthOpponent>([['frozen/ub', { spec, deck }]]);
}

function completedGame(options: PlayGameOptions): GameOutcome {
  const identity = nativeGameplayEvidenceIdentity(options.evidence!, options.seed);
  const completed = {
    winner: options.startingPlayer,
    reason: 'lifeZero' as const,
    turns: 4,
    decisions: 0,
    startingPlayer: options.startingPlayer,
  };
  return {
    index: options.index,
    seed: options.seed,
    ...completed,
    log: null,
    events: null,
    triggerCensus: null,
    activationCensus: null,
    evidence: completedNativeGameplayEvidence(identity, [], completed),
  };
}

describe('native bot strength campaign adapter', () => {
  it('binds a learned policy to both its model and training data', () => {
    const learned = learnedSpec('Candidate', { sha256: SHA } as never, DATA_SHA);

    expect(nativeBotPolicyIdentity(learned)).toMatchObject({
      modelSha256: SHA,
      dataSha256: DATA_SHA,
    });
  });

  it('runs evidence-enabled games through the native kernel', async () => {
    const result = await runNativeBotStrengthCampaign({
      plan: plan(),
      policies: { baseline, candidate },
      decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
      opponents: opponents(),
      maximumTurns: 4,
      budget: { maxDecisions: 5_000, maxMillis: 10_000 },
    });

    expect(result.trials).toHaveLength(8);
    expect(result.trials.every((trial) => trial.episode.outcome.status === 'completed')).toBe(true);
    expect(result.trials.every((trial) => trial.cost.decisions === trial.episode.decisions.length)).toBe(
      true,
    );
    // Promotion reads outcomes and choices; the observation values stay out of the trial by default.
    expect(
      result.trials.every((trial) =>
        trial.episode.decisions.every((decision) => !('value' in decision.observation)),
      ),
    ).toBe(true);
  });

  it('retains observation values only when the campaign asks for them', async () => {
    const result = await runNativeBotStrengthCampaign({
      plan: plan(),
      policies: { baseline, candidate },
      decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
      opponents: opponents(),
      maximumTurns: 4,
      budget: { maxDecisions: 5_000, maxMillis: 10_000 },
      observations: 'retained',
    });

    expect(result.trials.length).toBeGreaterThan(0);
    expect(
      result.trials.every((trial) =>
        trial.episode.decisions.every((decision) => decision.observation.value !== undefined),
      ),
    ).toBe(true);
  });

  it('executes the exact seat-balanced schedule with executable native bots and decks', async () => {
    const games: PlayGameOptions[] = [];
    const runGame = vi.fn((options: PlayGameOptions) => {
      games.push(options);
      return completedGame(options);
    });

    const result = await runNativeBotStrengthCampaign(
      {
        plan: plan(),
        policies: { baseline, candidate },
        decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
        opponents: opponents(),
        maximumTurns: 40,
        budget: { maxDecisions: 5_000, maxMillis: 10_000 },
      },
      runGame,
    );

    expect(result.trials).toHaveLength(8);
    expect(games.map((game) => game.seed)).toEqual([
      'seed-one',
      'seed-one',
      'seed-one',
      'seed-one',
      'seed-two',
      'seed-two',
      'seed-two',
      'seed-two',
    ]);
    expect(games[0]!.decks).toEqual([FIXTURE_DECK_RW, FIXTURE_DECK_UB]);
    expect(games[0]!.agents.map((agent) => agent.name)).toEqual(['Baseline', 'Frozen opponent']);
    expect(games[2]!.decks).toEqual([FIXTURE_DECK_UB, FIXTURE_DECK_RW]);
    expect(games[2]!.agents.map((agent) => agent.name)).toEqual(['Frozen opponent', 'Baseline']);
    expect(games.every((game) => game.startingPlayer === 0)).toBe(true);
    expect(
      result.trials.every(
        (trial) =>
          trial.episode.episode.lineage.gameId ===
          `native-campaign/${trial.unitId}/${String(trial.focalSeat)}/${trial.arm}`,
      ),
    ).toBe(true);
  });

  it('rejects policy, opponent, and deck drift before playing any game', async () => {
    const runGame = vi.fn(completedGame);
    const common = {
      plan: plan(),
      policies: { baseline, candidate },
      decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
      opponents: opponents(),
      maximumTurns: 40,
      budget: { maxDecisions: 5_000, maxMillis: 10_000 },
    };

    await expect(
      runNativeBotStrengthCampaign(
        { ...common, policies: { ...common.policies, candidate: greedySpec('Drifted') } },
        runGame,
      ),
    ).rejects.toThrow(/candidate policy identity/i);
    await expect(
      runNativeBotStrengthCampaign(
        { ...common, opponents: opponents(greedySpec('Changed opponent')) },
        runGame,
      ),
    ).rejects.toThrow(/opponent policy/i);
    await expect(
      runNativeBotStrengthCampaign(
        { ...common, decks: new Map([[focalDeckSha256, { ...FIXTURE_DECK_RW, name: 'Substituted' }]]) },
        runGame,
      ),
    ).rejects.toThrow(/focal deck/i);
    await expect(
      runNativeBotStrengthCampaign(
        { ...common, opponents: opponents(opponent, { ...FIXTURE_DECK_UB, name: 'Substituted' }) },
        runGame,
      ),
    ).rejects.toThrow(/opponent deck/i);
    expect(runGame).not.toHaveBeenCalled();
  });

  it.each([
    ['priority', 0],
    ['priority', 1.5],
    ['declaration', Number.POSITIVE_INFINITY],
  ] as const)('rejects an invalid %s cap before playing any game', async (kind, value) => {
    const runGame = vi.fn(completedGame);

    await expect(
      runNativeBotStrengthCampaign(
        {
          plan: plan(),
          policies: { baseline, candidate },
          decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
          opponents: opponents(),
          maximumTurns: 40,
          budget: { maxDecisions: 5_000, maxMillis: 10_000 },
          caps: { priority: 512, declaration: 512, [kind]: value },
        },
        runGame,
      ),
    ).rejects.toThrow(new RegExp(`${kind} cap`, 'i'));
    expect(runGame).not.toHaveBeenCalled();
  });

  it('retains partial evidence and cost when a native game fails', async () => {
    const runGame = vi.fn((options: PlayGameOptions): GameOutcome => {
      const identity = nativeGameplayEvidenceIdentity(options.evidence!, options.seed);
      throw new NativeGameplayEvidenceError(
        failedNativeGameplayEvidence(identity, [], 'engine-failure', 'deliberate failure'),
        new Error('deliberate failure'),
      );
    });

    const result = await runNativeBotStrengthCampaign(
      {
        plan: plan(),
        policies: { baseline, candidate },
        decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
        opponents: opponents(),
        maximumTurns: 40,
        budget: { maxDecisions: 5_000, maxMillis: 10_000 },
      },
      runGame,
    );

    expect(result.trials).toHaveLength(8);
    expect(result.comparison.completion.baseline.failures).toBe(4);
    expect(result.comparison.completion.candidate.failures).toBe(4);
    expect(result.comparison.promotion.status).toBe('retain-baseline');
  });

  it('rejects incomplete decision sequences before checkpointing a trial', async () => {
    const onTrial = vi.fn();
    const runGame = vi.fn((options: PlayGameOptions): GameOutcome => {
      const game = completedGame(options);
      const observation = { safe: true };
      const decision = (sequence: number) => ({
        sequence,
        observation: { sha256: botEvidenceSha256(observation), value: observation },
        candidates: {
          status: 'complete' as const,
          values: [{ id: 'pass', value: { type: 'pass' } }],
        },
        choice: { status: 'chosen' as const, candidateId: 'pass' },
      });
      const identity = nativeGameplayEvidenceIdentity(options.evidence!, options.seed);
      const completed = {
        winner: game.winner,
        reason: game.reason,
        turns: game.turns,
        decisions: 2,
        startingPlayer: game.startingPlayer,
      };
      return {
        ...game,
        decisions: 2,
        evidence: completedNativeGameplayEvidence(identity, [decision(0), decision(2)], completed),
      };
    });

    await expect(
      runNativeBotStrengthCampaign(
        {
          plan: plan(),
          policies: { baseline, candidate },
          decks: new Map([[focalDeckSha256, FIXTURE_DECK_RW]]),
          opponents: opponents(),
          maximumTurns: 40,
          budget: { maxDecisions: 5_000, maxMillis: 10_000 },
          onTrial,
        },
        runGame,
      ),
    ).rejects.toThrow(/decision sequence/i);
    expect(runGame).toHaveBeenCalledTimes(1);
    expect(onTrial).not.toHaveBeenCalled();
  });
});
