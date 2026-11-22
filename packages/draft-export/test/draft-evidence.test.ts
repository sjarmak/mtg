import { describe, expect, it } from 'vitest';
import {
  BotEvidenceEpisodeSchema,
  botEvidenceSha256,
  serializedBotEvidenceEpisode,
  type BotEvidenceEpisode,
} from '@mtg/bot-evidence';
import { EXAMPLE_SET } from '@mtg/dsl';
import {
  DEFAULT_NATIVE_DRAFT_BOT_POLICY,
  draftDecisionEvidence,
  runDraft,
  type DraftEvidenceRequest,
} from '@mtg/draft-export';

const DIGEST = 'a'.repeat(64);

function request(): DraftEvidenceRequest {
  const config = { policy: DEFAULT_NATIVE_DRAFT_BOT_POLICY };
  return {
    id: 'draft-evidence-pod',
    runtime: { version: 'draft-export-test', buildSha256: DIGEST },
    subject: { formatId: 'example', formatSha256: DIGEST, cardsSha256: DIGEST },
    features: { schemaId: 'draft-observation-v1', schemaSha256: DIGEST },
    behavior: {
      policyId: DEFAULT_NATIVE_DRAFT_BOT_POLICY,
      config,
      configSha256: botEvidenceSha256(config),
      modelSha256: null,
      dataSha256: null,
    },
    lineage: { setId: 'example', draftId: 'draft-evidence-pod' },
    splitGroup: { kind: 'draft', id: 'draft-evidence-pod' },
  };
}

function run(): ReturnType<typeof runDraft> {
  return runDraft(EXAMPLE_SET, {
    seed: 'draft-evidence-seed',
    seats: 2,
    packs: 1,
    evidence: request(),
  });
}

describe('native draft evidence collection', () => {
  it('does not alter the ordinary result shape when collection is disabled', () => {
    expect('evidence' in runDraft(EXAMPLE_SET, { seed: 'without-evidence', seats: 2, packs: 1 })).toBe(false);
  });

  it('records a complete, draft-isolated episode', () => {
    const result = run();
    const evidence = result.evidence as BotEvidenceEpisode;
    expect(BotEvidenceEpisodeSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.episode).toMatchObject({
      stage: 'draft',
      seed: result.seed,
      runtime: { kind: 'native' },
      lineage: { draftId: 'draft-evidence-pod' },
      splitGroup: { kind: 'draft', id: 'draft-evidence-pod' },
    });

    const picks = result.seats.flatMap((seat) => seat.picks);
    expect(evidence.decisions).toHaveLength(picks.length);
    expect(evidence.decisions.map((decision) => decision.sequence)).toEqual(
      Array.from({ length: picks.length }, (_unused, index) => index),
    );
    expect(evidence.outcome).toEqual({
      status: 'completed',
      value: {
        rounds: 1,
        directions: [1],
        seats: result.seats.map((seat) => ({
          seat: seat.seat,
          picks: seat.picks.map((pick) => pick.card.id),
        })),
      },
    });
  });

  it('shows each bot only its current pack and its own prior picks', () => {
    const evidence = run().evidence as BotEvidenceEpisode;
    const priorBySeat = new Map<number, string[]>();

    for (const decision of evidence.decisions) {
      const observation = decision.observation.value as {
        round: number;
        pickNumber: number;
        seat: number;
        openedBy: number;
        pack: readonly { id: string }[];
        pool: readonly { id: string }[];
      };
      expect(Object.keys(observation).sort()).toEqual([
        'openedBy',
        'pack',
        'pickNumber',
        'pool',
        'round',
        'seat',
      ]);
      const candidateIds = decision.candidates.values.map((candidate) => candidate.id);
      expect(decision.candidates.status).toBe('complete');
      expect(candidateIds).toEqual(observation.pack.map((card) => card.id));
      expect(new Set(candidateIds).size).toBe(candidateIds.length);
      expect(observation.pool.map((card) => card.id)).toEqual(priorBySeat.get(observation.seat) ?? []);
      expect(decision.choice.status).toBe('chosen');
      if (decision.choice.status !== 'chosen') throw new Error('draft bot did not choose a card');
      expect(candidateIds).toContain(decision.choice.candidateId);
      priorBySeat.set(observation.seat, [
        ...(priorBySeat.get(observation.seat) ?? []),
        decision.choice.candidateId,
      ]);
    }
  });

  it('serializes byte-identically for the same seed and policy', () => {
    expect(serializedBotEvidenceEpisode(run().evidence as BotEvidenceEpisode)).toBe(
      serializedBotEvidenceEpisode(run().evidence as BotEvidenceEpisode),
    );
  });

  it('rejects provenance that could split one draft across datasets', () => {
    const invalid = request();
    expect(() =>
      runDraft(EXAMPLE_SET, {
        seed: 'invalid-provenance',
        seats: 2,
        packs: 1,
        evidence: { ...invalid, splitGroup: { kind: 'draft', id: 'another-draft' } },
      }),
    ).toThrow(/split group must name its matching lineage identity/);
  });

  it('rejects evidence labeled as a different policy from the bot that made the picks', () => {
    const invalid = request();
    expect(() =>
      runDraft(EXAMPLE_SET, {
        seed: 'wrong-policy-label',
        seats: 2,
        packs: 1,
        evidence: {
          ...invalid,
          behavior: { ...invalid.behavior, policyId: 'some-other-policy' },
        },
      }),
    ).toThrow(/policy/);
  });

  it('rejects a non-draft split group from an untyped caller', () => {
    const invalid = {
      ...request(),
      splitGroup: { kind: 'set', id: 'example' },
    } as unknown as DraftEvidenceRequest;
    expect(() =>
      runDraft(EXAMPLE_SET, {
        seed: 'wrong-split-kind',
        seats: 2,
        packs: 1,
        evidence: invalid,
      }),
    ).toThrow(/draft evidence must use a draft split group/);
  });
});

describe('draft decision mapping', () => {
  const first = EXAMPLE_SET[0];
  const second = EXAMPLE_SET[1];
  if (first === undefined || second === undefined) throw new Error('example set needs two cards');

  it('refuses duplicate candidate identities', () => {
    expect(() =>
      draftDecisionEvidence(
        { round: 1, pickNumber: 1, seat: 0, openedBy: 0, pack: [first, first], pool: [] },
        first,
        0,
      ),
    ).toThrow(/duplicate card identities/);
  });

  it('refuses a choice outside the observed pack', () => {
    expect(() =>
      draftDecisionEvidence(
        { round: 1, pickNumber: 1, seat: 0, openedBy: 0, pack: [first], pool: [] },
        second,
        0,
      ),
    ).toThrow(/chosen card is absent/);
  });
});
