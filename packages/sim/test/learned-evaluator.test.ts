import { botEvidenceSha256, type BotEvidenceEpisode, type JsonValue } from '@mtg/bot-evidence';
import { actionKey, agentView, createGame, pendingDecision, type Action } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { playSimGame } from '../src/driver';
import { FIXTURE_DECK_RW, fixtureDeck } from '../src/fixtures';
import { greedyBot } from '../src/greedy-bot';
import { learnedAdvantageBot, learnedAdvantagePolicySha256 } from '../src/learned-advantage-policy';
import {
  LEARNED_FEATURE_SCHEMA,
  createLearnedModel,
  learnedBot,
  encodeLearnedCandidate,
  learnedModelSha256,
  sparsifyLearnedFeatures,
} from '../src/learned-evaluator';
import { learnedExamplesFromEpisode, learnedPreferenceExamplesFromEpisode } from '../src/learned-dataset';
import { learnedFeatureSize } from '../src/learned-features';
import { fineTuneLearnedModel, trainLearnedModel, trainLearnedRankingModel } from '../src/learned-training';

function openingView() {
  const created = createGame({
    seed: 'learned-feature-test',
    decks: [fixtureDeck('WU', ['W', 'U']), fixtureDeck('BR', ['B', 'R'])],
    startingPlayer: 0,
    maximumTurns: 20,
  });
  const decision = pendingDecision(created.state);
  if (decision === null) throw new Error('fixture game did not expose an opening decision');
  return agentView(created.state, decision.player, decision, 'learned-feature-test');
}

describe('learned gameplay evaluator', () => {
  it('encodes a fixed finite feature vector without mutating the observation', () => {
    const view = openingView();
    const action = view.decision.options[0];
    if (action === undefined) throw new Error('opening decision had no option');
    const before = JSON.stringify(view.state);

    const first = encodeLearnedCandidate(view, action);
    const second = encodeLearnedCandidate(view, action);

    expect(first).toEqual(second);
    expect(first).toHaveLength(LEARNED_FEATURE_SCHEMA.size);
    expect([...first].every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(view.state)).toBe(before);
  });

  it('distinguishes alternatives that select different players', () => {
    const view = openingView();
    const selfTarget = { kind: 'player' as const, player: view.player };
    const opponentTarget = {
      kind: 'player' as const,
      player: view.player === 0 ? (1 as const) : (0 as const),
    };
    const self = {
      type: 'castSpell',
      player: view.player,
      oid: 'absent',
      targets: [selfTarget],
    } as Action;
    const opponent = {
      ...self,
      targets: [opponentTarget],
    } as Action;

    expect(encodeLearnedCandidate(view, self)).not.toEqual(encodeLearnedCandidate(view, opponent));

    const selfThenOpponent = { ...self, targets: [selfTarget, opponentTarget] } as Action;
    const opponentThenSelf = { ...self, targets: [opponentTarget, selfTarget] } as Action;
    expect(encodeLearnedCandidate(view, selfThenOpponent)).not.toEqual(
      encodeLearnedCandidate(view, opponentThenSelf),
    );

    const [oid] = view.state.players[view.player].hand;
    if (oid === undefined) throw new Error('fixture needs a visible card');
    const permanentThenPlayer = {
      ...self,
      targets: [{ kind: 'permanent', oid }, opponentTarget],
    } as Action;
    const playerThenPermanent = {
      ...self,
      targets: [opponentTarget, { kind: 'permanent', oid }],
    } as Action;
    expect(encodeLearnedCandidate(view, permanentThenPlayer)).not.toEqual(
      encodeLearnedCandidate(view, playerThenPermanent),
    );
  });

  it('distinguishes action-specific scalar choices', () => {
    const view = openingView();
    const oneDamage = { type: 'allocateDividedDamage', player: view.player, amount: 1 } as Action;
    const twoDamage = { ...oneDamage, amount: 2 } as Action;
    expect(encodeLearnedCandidate(view, oneDamage)).not.toEqual(encodeLearnedCandidate(view, twoDamage));

    const decline = {
      type: 'chooseEntryPayLife',
      player: view.player,
      oid: 'absent',
      life: 2,
      pay: false,
    } as Action;
    expect(encodeLearnedCandidate(view, decline)).not.toEqual(
      encodeLearnedCandidate(view, { ...decline, pay: true } as Action),
    );
  });

  it('distinguishes different relationships among the same selected objects', () => {
    const view = openingView();
    const [first, second, third, fourth] = view.state.players[view.player].hand;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
      throw new Error('fixture needs four visible cards');
    }
    const parallel = {
      type: 'declareBlockers',
      player: view.player,
      blocks: [
        { blocker: first, attacker: third },
        { blocker: second, attacker: fourth },
      ],
    } as Action;
    const crossed = {
      ...parallel,
      blocks: [
        { blocker: first, attacker: fourth },
        { blocker: second, attacker: third },
      ],
    } as Action;

    expect(encodeLearnedCandidate(view, parallel)).not.toEqual(encodeLearnedCandidate(view, crossed));
  });

  it('pins model loading to the exact feature vocabulary and dimensions', () => {
    const inputWeights = Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, () => 0);
    const unsigned = {
      schemaVersion: 2 as const,
      featureSchemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
      inputSize: LEARNED_FEATURE_SCHEMA.size,
      hiddenSize: 1,
      directWeights: inputWeights,
      inputWeights,
      hiddenBias: [2],
      outputWeights: [3],
      outputBias: -1,
    };
    const artifact = { ...unsigned, sha256: learnedModelSha256(unsigned) };
    const model = createLearnedModel(artifact);

    expect(model.score(Float64Array.from(inputWeights))).toBe(5);
    (artifact as { outputBias: number }).outputBias = 100;
    expect(model.score(Float64Array.from(inputWeights))).toBe(5);
    expect(() => createLearnedModel({ ...artifact, featureSchemaSha256: '0'.repeat(64) })).toThrow(
      /feature schema/u,
    );
    expect(() => createLearnedModel({ ...artifact, sha256: '0'.repeat(64) })).toThrow(/digest/u);

    const overflowing = {
      ...unsigned,
      inputWeights: Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, () => 1e308),
      hiddenBias: [1e308],
      outputWeights: [0],
    };
    const overflowingModel = createLearnedModel({
      ...overflowing,
      sha256: learnedModelSha256(overflowing),
    });
    const features = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
    features[0] = 1;
    expect(() => overflowingModel.score(features)).toThrow(/non-finite activation/u);
  });

  it('scores sparse features exactly like their dense representation', () => {
    const dense = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
    dense[0] = 2;
    dense[37] = -3;
    dense[LEARNED_FEATURE_SCHEMA.size - 1] = 0.5;
    const payload = {
      schemaVersion: 2 as const,
      featureSchemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
      inputSize: LEARNED_FEATURE_SCHEMA.size,
      hiddenSize: 2,
      directWeights: Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, (_, index) => index / 10_000),
      inputWeights: Array.from(
        { length: LEARNED_FEATURE_SCHEMA.size * 2 },
        (_, index) => ((index % 17) - 8) / 100,
      ),
      hiddenBias: [0.25, -0.25],
      outputWeights: [0.5, -0.75],
      outputBias: 0.125,
    };
    const model = createLearnedModel({ ...payload, sha256: learnedModelSha256(payload) });

    expect(model.score(sparsifyLearnedFeatures(dense))).toBe(model.score(dense));
  });

  it('trains deterministic outcome values independent of input ordering', () => {
    const loss = (value: number) => {
      const features = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
      features[0] = value;
      return features;
    };
    const examples = [
      {
        episodeId: 'g1',
        sequence: 0,
        candidateId: 'a',
        actionType: 'castSpell' as const,
        features: loss(1),
        return: 1 as const,
        weight: 1,
      },
      {
        episodeId: 'g2',
        sequence: 0,
        candidateId: 'a',
        actionType: 'castSpell' as const,
        features: loss(-1),
        return: -1 as const,
        weight: 1,
      },
      {
        episodeId: 'g1',
        sequence: 1,
        candidateId: 'a',
        actionType: 'castSpell' as const,
        features: loss(0.8),
        return: 1 as const,
        weight: 1,
      },
      {
        episodeId: 'g2',
        sequence: 1,
        candidateId: 'a',
        actionType: 'castSpell' as const,
        features: loss(-0.8),
        return: -1 as const,
        weight: 1,
      },
    ];
    const config = { hiddenSize: 4, epochs: 30, learningRate: 0.02, l2: 0, seed: 7 };
    const first = trainLearnedModel(examples, config);
    const second = trainLearnedModel(examples.toReversed(), config);

    expect(first).toEqual(second);
    const model = createLearnedModel(first);
    expect(model.score(loss(1))).toBeGreaterThan(model.score(loss(-1)));
    expect(() => trainLearnedModel([], config)).toThrow(/at least one example/u);
    expect(() => trainLearnedModel([{ ...examples[0]!, return: 1.1 }], config)).toThrow(
      /return must be finite and between -1 and 1/u,
    );
    expect(() =>
      trainLearnedModel(
        [
          { ...examples[0]!, episodeId: 'g:1', sequence: 2, candidateId: 'x' },
          { ...examples[1]!, episodeId: 'g', sequence: 1, candidateId: '2:x' },
        ],
        config,
      ),
    ).not.toThrow();
  });

  it('trains deterministic multicandidate preferences by decision', () => {
    const features = (value: number): Float64Array => {
      const result = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
      result[0] = value;
      return result;
    };
    const examples = [
      {
        episodeId: 'g1',
        sequence: 2,
        candidateId: 'chosen',
        actionType: 'castSpell' as const,
        features: features(1),
        return: 1 as const,
        weight: 1,
      },
      {
        episodeId: 'g1',
        sequence: 2,
        candidateId: 'rejected-negative',
        actionType: 'passPriority' as const,
        features: features(-1),
        return: -1 as const,
        weight: 1,
      },
      {
        episodeId: 'g1',
        sequence: 2,
        candidateId: 'rejected-nearby',
        actionType: 'playLand' as const,
        features: features(0.5),
        return: -1 as const,
        weight: 1,
      },
    ];
    const config = { hiddenSize: 4, epochs: 30, learningRate: 0.02, l2: 0, seed: 7 };
    const first = trainLearnedRankingModel(examples, config);
    const second = trainLearnedRankingModel(examples.toReversed(), config);
    const sparse = trainLearnedRankingModel(
      examples.map((example) => ({ ...example, features: sparsifyLearnedFeatures(example.features) })),
      config,
    );

    expect(first).toEqual(second);
    expect(sparse).toEqual(first);
    const model = createLearnedModel(first);
    expect(model.score(features(1))).toBeGreaterThan(model.score(features(-1)));
    expect(model.score(features(1))).toBeGreaterThan(model.score(features(0.5)));
    expect(() =>
      trainLearnedRankingModel(
        examples.filter((example) => example.return === -1),
        config,
      ),
    ).toThrow(/exactly one chosen candidate/u);
    expect(() =>
      trainLearnedRankingModel(
        examples.map((example, index) => ({ ...example, weight: index === 0 ? 2 : 1 })),
        config,
      ),
    ).toThrow(/one decision weight/u);
    expect(
      trainLearnedRankingModel(
        examples.map((example) => ({ ...example, weight: 2 })),
        config,
      ),
    ).not.toEqual(first);
  });

  it('trains an identical artifact from sparse features when regularization is zero', () => {
    const dense = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
    dense[4] = 1;
    dense[91] = -0.5;
    const example = {
      episodeId: 'sparse-training',
      sequence: 0,
      candidateId: 'chosen',
      actionType: 'castSpell' as const,
      features: dense,
      return: 0.75,
      weight: 1,
    };
    const config = { hiddenSize: 2, epochs: 3, learningRate: 0.01, l2: 0, seed: 17 };

    expect(trainLearnedModel([{ ...example, features: sparsifyLearnedFeatures(dense) }], config)).toEqual(
      trainLearnedModel([example], config),
    );
  });

  it('fine-tunes a validated checkpoint deterministically without mutating it', () => {
    const features = (value: number): Float64Array => {
      const result = new Float64Array(LEARNED_FEATURE_SCHEMA.size);
      result[0] = value;
      return result;
    };
    const training = { hiddenSize: 2, epochs: 4, learningRate: 0.01, l2: 0, seed: 9 };
    const initial = trainLearnedModel(
      [
        {
          episodeId: 'pretrain',
          sequence: 0,
          candidateId: 'positive',
          actionType: 'castSpell',
          features: features(1),
          return: 1,
          weight: 1,
        },
      ],
      training,
    );
    const before = JSON.stringify(initial);
    const outcomes = [
      {
        episodeId: 'outcome',
        sequence: 0,
        candidateId: 'negative',
        actionType: 'castSpell' as const,
        features: features(-1),
        return: 0.75,
        weight: 1,
      },
    ];
    const config = { ...training, anchor: 0.5 };

    const first = fineTuneLearnedModel(initial, outcomes, config);
    const second = fineTuneLearnedModel(initial, outcomes.toReversed(), config);

    expect(first).toEqual(second);
    expect(first).not.toEqual(initial);
    expect(JSON.stringify(initial)).toBe(before);
    expect(() => fineTuneLearnedModel({ ...initial, sha256: '0'.repeat(64) }, outcomes, config)).toThrow(
      /digest/u,
    );
    expect(() => fineTuneLearnedModel(initial, outcomes, { ...config, hiddenSize: 3 })).toThrow(
      /hidden size/u,
    );
    expect(() => fineTuneLearnedModel(initial, outcomes, { ...config, anchor: -1 })).toThrow(/anchor/u);
  });

  it('scores complete alternatives and deterministically selects the highest one', () => {
    const view = openingView();
    const actions = view.decision.options.slice(0, 2);
    const first = actions[0];
    const second = actions[1];
    if (first === undefined || second === undefined) throw new Error('fixture needs two mulligan options');
    const firstFeatures = encodeLearnedCandidate(view, first);
    const secondFeatures = encodeLearnedCandidate(view, second);
    const preferredIndex = [...secondFeatures].findIndex(
      (value, index) => value > (firstFeatures[index] ?? 0),
    );
    if (preferredIndex < 0) throw new Error('fixture alternatives need a positive distinguishing feature');
    const inputWeights = Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, (_, index) =>
      index === preferredIndex ? 1 : 0,
    );
    const unsigned = {
      schemaVersion: 2 as const,
      featureSchemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
      inputSize: LEARNED_FEATURE_SCHEMA.size,
      hiddenSize: 1,
      directWeights: Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, () => 0),
      inputWeights,
      hiddenBias: [0],
      outputWeights: [1],
      outputBias: 0,
    };
    const agent = learnedBot('learned-test', { ...unsigned, sha256: learnedModelSha256(unsigned) });

    expect(agent.decide(view)).toEqual(second);
    expect(agent.decide(view)).toEqual(second);
  });

  it('keeps the greedy action until the learned score advantage clears its calibrated margin', () => {
    const view = openingView();
    const reference = greedyBot('reference').decide(view);
    const alternative = view.decision.options.find((action) => actionKey(action) !== actionKey(reference));
    if (alternative === undefined) throw new Error('fixture needs an alternative to the greedy action');
    const referenceFeatures = encodeLearnedCandidate(view, reference);
    const alternativeFeatures = encodeLearnedCandidate(view, alternative);
    const preferredIndex = [...alternativeFeatures].findIndex(
      (value, index) => value > (referenceFeatures[index] ?? 0),
    );
    if (preferredIndex < 0) throw new Error('fixture alternative needs a positive distinguishing feature');
    const unsigned = {
      schemaVersion: 2 as const,
      featureSchemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
      inputSize: LEARNED_FEATURE_SCHEMA.size,
      hiddenSize: 1,
      directWeights: Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, (_, index) =>
        index === preferredIndex ? 1 : 0,
      ),
      inputWeights: Array.from({ length: LEARNED_FEATURE_SCHEMA.size }, () => 0),
      hiddenBias: [0],
      outputWeights: [0],
      outputBias: 0,
    };
    const model = { ...unsigned, sha256: learnedModelSha256(unsigned) };
    const policy = (minimumScoreAdvantage: number) => {
      const payload = { schemaVersion: 1 as const, model, minimumScoreAdvantage };
      return { ...payload, sha256: learnedAdvantagePolicySha256(payload) };
    };

    expect(learnedAdvantageBot('abstaining', policy(10)).decide(view)).toEqual(reference);
    expect(learnedAdvantageBot('departing', policy(0)).decide(view)).toEqual(alternative);
  });

  it('emits only complete non-forced chosen decisions with the final seat-relative return', () => {
    const view = openingView();
    const actions = view.decision.options.slice(0, 2);
    const first = actions[0];
    const second = actions[1];
    if (first === undefined || second === undefined) throw new Error('fixture needs two mulligan options');
    const observation = JSON.parse(JSON.stringify(view.state)) as JsonValue;
    const candidates = actions.map((action) => ({
      id: actionKey(action),
      value: JSON.parse(JSON.stringify(action)) as JsonValue,
    }));
    const baseDecision = {
      observation: { sha256: botEvidenceSha256(observation), value: observation },
      candidates: { status: 'complete' as const, values: candidates },
    };
    const episode = {
      schemaVersion: 1,
      episode: {
        id: 'learned-example',
        stage: 'gameplay',
        seed: 'learned-feature-test',
        runtime: { kind: 'native', version: 'test', buildSha256: '1'.repeat(64) },
        subject: {
          formatId: 'fixture',
          formatSha256: '2'.repeat(64),
          cardsSha256: '3'.repeat(64),
        },
        features: { schemaId: LEARNED_FEATURE_SCHEMA.id, schemaSha256: LEARNED_FEATURE_SCHEMA.sha256 },
        behavior: {
          policyId: 'fixture',
          configSha256: botEvidenceSha256({}),
          config: {},
          modelSha256: null,
          dataSha256: null,
        },
        lineage: { gameId: 'g1' },
        splitGroup: { kind: 'game', id: 'g1' },
      },
      decisions: [
        { ...baseDecision, sequence: 0, choice: { status: 'chosen', candidateId: candidates[0]!.id } },
        {
          ...baseDecision,
          sequence: 1,
          candidates: { status: 'truncated' as const, reason: 'cap', values: candidates },
          choice: { status: 'chosen', candidateId: candidates[1]!.id },
        },
      ],
      outcome: {
        status: 'completed',
        value: { winner: view.player, reason: 'lifeZero', turns: 8, decisions: 2, startingPlayer: 0 },
      },
    } satisfies BotEvidenceEpisode;

    const dataset = learnedExamplesFromEpisode(episode);

    expect(dataset.skipped).toEqual({ failed: 0, forced: 0, incomplete: 1 });
    expect(dataset.examples).toHaveLength(1);
    expect(dataset.examples[0]?.return).toBe(1);
    expect(learnedFeatureSize(dataset.examples[0]!.features)).toBe(LEARNED_FEATURE_SCHEMA.size);

    const preferences = learnedPreferenceExamplesFromEpisode(episode);
    expect(preferences.examples).toHaveLength(actions.length);
    expect(preferences.examples.filter((example) => example.return === 1)).toHaveLength(1);
    expect(preferences.examples.filter((example) => example.return === -1)).toHaveLength(actions.length - 1);
    expect(preferences.examples.every((example) => example.weight === 1)).toBe(true);

    const corrupt = JSON.parse(JSON.stringify(episode)) as BotEvidenceEpisode;
    const corruptCandidate = corrupt.decisions[0]?.candidates.values[0];
    if (corruptCandidate === undefined) throw new Error('fixture needs a candidate to corrupt');
    (corruptCandidate as { value: JsonValue }).value = { type: 'unknown', player: view.player };
    expect(() => learnedExamplesFromEpisode(corrupt)).toThrow(/candidate set does not match/u);

    const falseForced = JSON.parse(JSON.stringify(episode)) as BotEvidenceEpisode;
    const firstDecision = falseForced.decisions[0];
    if (firstDecision === undefined) throw new Error('fixture needs a decision to truncate');
    (firstDecision.candidates as { values: typeof candidates }).values = [candidates[0]!];
    expect(() => learnedExamplesFromEpisode(falseForced)).toThrow(/candidate set does not match/u);

    const privileged = JSON.parse(JSON.stringify(episode)) as BotEvidenceEpisode;
    const privilegedObservation = privileged.decisions[0]?.observation;
    if (privilegedObservation === undefined) throw new Error('fixture needs an observation to corrupt');
    const privilegedValue = privilegedObservation.value as unknown as { config: { seed: string } };
    privilegedValue.config.seed = 'leaked-seed';
    (privilegedObservation as { sha256: string }).sha256 = botEvidenceSha256(privilegedObservation.value);
    expect(() => learnedExamplesFromEpisode(privileged)).toThrow(/safe agent observation/u);
  });

  it('projects a completed recorded self-play game into deterministic training examples', () => {
    const config = { policy: 'greedy-self-play' };
    const outcome = playSimGame({
      index: 0,
      seed: 'learned-self-play-round-trip',
      decks: [FIXTURE_DECK_RW, FIXTURE_DECK_RW],
      startingPlayer: 0,
      agents: [greedyBot('left'), greedyBot('right')],
      evidence: {
        id: 'learned-self-play-round-trip',
        runtime: { version: 'kernel-test', buildSha256: '1'.repeat(64) },
        subject: {
          formatId: 'fixture',
          formatSha256: '2'.repeat(64),
          cardsSha256: '3'.repeat(64),
        },
        features: {
          schemaId: LEARNED_FEATURE_SCHEMA.id,
          schemaSha256: LEARNED_FEATURE_SCHEMA.sha256,
        },
        behavior: {
          policyId: 'greedy-self-play',
          config,
          configSha256: botEvidenceSha256(config),
          modelSha256: null,
          dataSha256: null,
        },
        lineage: { gameId: 'learned-self-play-round-trip' },
        splitGroup: { kind: 'game', id: 'learned-self-play-round-trip' },
      },
    });
    const evidence = outcome.evidence;
    if (evidence === undefined) throw new Error('self-play game did not return evidence');

    const first = learnedExamplesFromEpisode(evidence);
    const second = learnedExamplesFromEpisode(evidence);
    expect(first).toEqual(second);
    expect(first.examples.length).toBeGreaterThan(0);
    expect(
      first.examples.every((example) => learnedFeatureSize(example.features) === LEARNED_FEATURE_SCHEMA.size),
    ).toBe(true);
  }, 20_000);
});
