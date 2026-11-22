import { describe, expect, it } from 'vitest';
import {
  BotEvidenceEpisodeSchema,
  botEvidenceArraySha256,
  botEvidenceSha256,
  partitionBotEvidenceEpisode,
  serializedBotEvidenceEpisode,
} from '../src';

const SHA = 'a'.repeat(64);

function episode() {
  const observation = { turn: 1, hand: ['known-card'] };
  const config = { depth: 1, evaluator: 'material/v1' };
  return {
    schemaVersion: 1 as const,
    episode: {
      id: 'game-17',
      stage: 'gameplay' as const,
      seed: 'run:17',
      runtime: { kind: 'native' as const, version: 'kernel/v1', buildSha256: SHA },
      subject: { formatId: 'fixture', formatSha256: SHA, cardsSha256: SHA },
      features: { schemaId: 'agent-observation/v1', schemaSha256: SHA },
      behavior: {
        policyId: 'search/v1',
        configSha256: botEvidenceSha256(config),
        config,
        modelSha256: null,
        dataSha256: null,
      },
      lineage: { setId: 'fixture', gameId: 'game-17' },
      splitGroup: { kind: 'game' as const, id: 'game-17' },
    },
    decisions: [
      {
        sequence: 0,
        observation: { sha256: botEvidenceSha256(observation), value: observation },
        candidates: {
          status: 'complete' as const,
          values: [
            { id: 'pass', value: { type: 'passPriority' } },
            { id: 'cast:1', value: { type: 'castSpell', oid: 1 } },
          ],
        },
        choice: { status: 'chosen' as const, candidateId: 'cast:1' },
      },
    ],
    outcome: { status: 'completed' as const, value: { winner: 0, reason: 'life' } },
  };
}

describe('bot evidence episode', () => {
  it('hashes a one-pass iterable exactly like its canonical array', () => {
    const values = [{ z: 3, a: 1 }, ['two', null], { nested: { b: false } }];

    expect(botEvidenceArraySha256(values.values())).toBe(botEvidenceSha256(values));
  });

  it('preserves canonical array semantics for undefined entries', () => {
    const values = [undefined, { optional: undefined }];

    expect(botEvidenceArraySha256(values.values())).toBe(botEvidenceSha256(values));
  });

  it('round-trips a complete decision with exact behavior and source provenance', () => {
    const parsed = BotEvidenceEpisodeSchema.parse(episode());

    expect(JSON.parse(serializedBotEvidenceEpisode(parsed))).toEqual(parsed);
    expect(parsed.decisions[0]?.choice).toEqual({ status: 'chosen', candidateId: 'cast:1' });
  });

  it('requires a reason whenever candidate enumeration is truncated', () => {
    const base = episode();
    const decision = base.decisions[0]!;
    const input = {
      ...base,
      decisions: [
        {
          ...decision,
          candidates: { status: 'truncated', reason: '', values: decision.candidates.values },
        },
      ],
    };

    expect(() => BotEvidenceEpisodeSchema.parse(input)).toThrow();
  });

  it('requires a chosen identity to name an enumerated candidate', () => {
    const base = episode();
    const input = {
      ...base,
      decisions: [{ ...base.decisions[0]!, choice: { status: 'chosen', candidateId: 'missing' } }],
    };

    expect(() => BotEvidenceEpisodeSchema.parse(input)).toThrow(/missing/);
  });

  it.each(['incomplete', 'timeout', 'illegal-action', 'unsupported', 'engine-failure'] as const)(
    'keeps %s as an explicit decision and episode status',
    (status) => {
      const base = episode();
      const input = {
        ...base,
        decisions: [
          {
            ...base.decisions[0]!,
            choice:
              status === 'illegal-action'
                ? {
                    status,
                    error: `${status} detail`,
                    attempted: { id: 'illegal-candidate', value: { type: 'illegal' } },
                  }
                : { status, error: `${status} detail` },
          },
        ],
        outcome: { status, error: `${status} detail` },
      };

      expect(BotEvidenceEpisodeSchema.parse(input).outcome.status).toBe(status);
    },
  );

  it('requires an illegal decision to retain the exact attempted action', () => {
    const base = episode();
    const input = {
      ...base,
      decisions: [{ ...base.decisions[0]!, choice: { status: 'illegal-action', error: 'illegal detail' } }],
    };
    expect(() => BotEvidenceEpisodeSchema.parse(input)).toThrow(/attempted/);
  });

  it('rejects an unfinished episode without an explicit terminal status', () => {
    const { outcome: _outcome, ...input } = episode();
    expect(() => BotEvidenceEpisodeSchema.parse(input)).toThrow();
  });

  it.each(['incomplete', 'truncated'] as const)(
    'retains a reason and observed candidates for %s enumeration',
    (status) => {
      const base = episode();
      const decision = base.decisions[0]!;
      const input = {
        ...base,
        decisions: [
          {
            ...decision,
            candidates: {
              status,
              reason: 'backend returned only the first page',
              values: decision.candidates.values.slice(1),
            },
          },
        ],
      };

      expect(BotEvidenceEpisodeSchema.parse(input).decisions[0]?.candidates).toMatchObject({
        status,
        reason: 'backend returned only the first page',
      });
    },
  );

  it('requires behavior, feature, format, card, and runtime source hashes', () => {
    const base = episode();
    const input = {
      ...base,
      episode: {
        ...base.episode,
        behavior: { ...base.episode.behavior, configSha256: 'search/v1' },
      },
    };

    expect(() => BotEvidenceEpisodeSchema.parse(input)).toThrow(/SHA-256/);
  });

  it('accepts a decision that kept only its observation digest', () => {
    const base = episode();
    const decision = base.decisions[0]!;
    const digestOnly = {
      ...base,
      decisions: [{ ...decision, observation: { sha256: decision.observation.sha256 } }],
    };
    expect(BotEvidenceEpisodeSchema.parse(digestOnly)).toEqual(digestOnly);
  });

  it('rejects observation and behavior hashes that do not match their embedded values', () => {
    const base = episode();
    const decision = base.decisions[0]!;
    const observation = {
      ...base,
      decisions: [{ ...decision, observation: { ...decision.observation, sha256: SHA } }],
    };
    expect(() => BotEvidenceEpisodeSchema.parse(observation)).toThrow(/observation SHA-256/);

    const behavior = {
      ...base,
      episode: {
        ...base.episode,
        behavior: { ...base.episode.behavior, configSha256: SHA },
      },
    };
    expect(() => BotEvidenceEpisodeSchema.parse(behavior)).toThrow(/behavior config SHA-256/);
  });

  it('rejects row-level split groups and groups that disagree with lineage', () => {
    const base = episode();
    const row = { ...base, episode: { ...base.episode, splitGroup: { kind: 'decision', id: '0' } } };
    expect(() => BotEvidenceEpisodeSchema.parse(row)).toThrow();

    const mismatched = {
      ...base,
      episode: { ...base.episode, splitGroup: { kind: 'game', id: 'another-game' } },
    };
    expect(() => BotEvidenceEpisodeSchema.parse(mismatched)).toThrow(/lineage/);
  });

  it.each(['set', 'pool', 'draft', 'game'] as const)(
    'assigns every episode in one %s group to the same deterministic partition',
    (kind) => {
      const base = episode();
      const id = `${kind}-17`;
      const grouped = {
        ...base,
        episode: {
          ...base.episode,
          lineage: { ...base.episode.lineage, [`${kind}Id`]: id },
          splitGroup: { kind, id },
        },
      };
      const first = BotEvidenceEpisodeSchema.parse(grouped);
      const second = BotEvidenceEpisodeSchema.parse({
        ...grouped,
        episode: { ...grouped.episode, id: 'another-episode' },
        decisions: [{ ...grouped.decisions[0]!, sequence: 99 }],
      });

      expect(partitionBotEvidenceEpisode(first, { salt: 'campaign-v1', evaluationPermille: 200 })).toBe(
        partitionBotEvidenceEpisode(second, { salt: 'campaign-v1', evaluationPermille: 200 }),
      );
    },
  );

  it('rejects duplicate decision sequences and duplicate candidate identities', () => {
    const base = episode();
    const duplicateSequence = {
      ...base,
      decisions: [base.decisions[0]!, { ...base.decisions[0]! }],
    };
    expect(() => BotEvidenceEpisodeSchema.parse(duplicateSequence)).toThrow(/sequence/);

    const decision = base.decisions[0]!;
    const candidate = decision.candidates.values[0]!;
    const duplicateCandidate = {
      ...base,
      decisions: [
        {
          ...decision,
          candidates: { ...decision.candidates, values: [...decision.candidates.values, candidate] },
        },
      ],
    };
    expect(() => BotEvidenceEpisodeSchema.parse(duplicateCandidate)).toThrow(/candidate/);
  });
});
