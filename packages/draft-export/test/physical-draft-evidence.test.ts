import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BotEvidenceEpisodeSchema,
  botEvidenceSha256,
  serializedBotEvidenceEpisode,
  type BotEvidenceEpisode,
} from '@mtg/bot-evidence';
import {
  runPhysicalCubeDraft,
  runPhysicalPackDraft,
  preparePrintedLimitedFormat,
  runPrintedLimitedDraft,
  type DraftEvidenceRequest,
  type PhysicalCubePack,
  type PrintedLimitedDraftOptions,
} from '@mtg/draft-export';
import { digest, printedFixture } from './printed-limited-fixture';

const DIGEST = 'b'.repeat(64);
const seatIds = ['north', 'south'];
const score = ({ card }: { readonly card: { readonly payload: { readonly rank: number } } }): number =>
  card.payload.rank;
const packs: readonly PhysicalCubePack<{ readonly printingId: string; readonly rank: number }>[] = [
  {
    round: 1,
    openedBy: 'north',
    cards: [
      { physicalId: 'copy-a', payload: { printingId: 'same-printing', rank: 4 } },
      { physicalId: 'copy-b', payload: { printingId: 'same-printing', rank: 1 } },
    ],
  },
  {
    round: 1,
    openedBy: 'south',
    cards: [
      { physicalId: 'copy-c', payload: { printingId: 'other-printing', rank: 3 } },
      { physicalId: 'copy-d', payload: { printingId: 'last-printing', rank: 2 } },
    ],
  },
];

function evidenceRequest(): DraftEvidenceRequest {
  const config = { policy: 'physical-rank-test' };
  return {
    id: 'physical-draft-evidence',
    runtime: { version: 'physical-test', buildSha256: DIGEST },
    subject: { formatId: 'physical-fixture', formatSha256: DIGEST, cardsSha256: DIGEST },
    features: { schemaId: 'physical-card-observation-v1', schemaSha256: DIGEST },
    behavior: {
      policyId: 'rank',
      config,
      configSha256: botEvidenceSha256(config),
      modelSha256: null,
      dataSha256: null,
    },
    lineage: { draftId: 'physical-draft-1' },
    splitGroup: { kind: 'draft', id: 'physical-draft-1' },
  };
}

describe('physical draft evidence', () => {
  it('declares evidence on the printed Limited public options', () => {
    expectTypeOf<PrintedLimitedDraftOptions['evidence']>().toEqualTypeOf<
      DraftEvidenceRequest | null | undefined
    >();
  });

  it('does not change the ordinary progress or result shape when disabled', () => {
    const progress = runPhysicalPackDraft(packs, { seatIds, score });
    expect('evidence' in progress).toBe(false);
    expect(progress.result).not.toBeNull();
  });

  it('records complete physical-copy choices from only the acting seat view', () => {
    const progress = runPhysicalPackDraft(packs, { seatIds, score, evidence: evidenceRequest() });
    const evidence = progress.evidence as BotEvidenceEpisode;
    expect(BotEvidenceEpisodeSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.episode).toMatchObject({
      stage: 'draft',
      seed: 'physical-packs/v1',
      runtime: { kind: 'native' },
      splitGroup: { kind: 'draft', id: 'physical-draft-1' },
    });
    expect(evidence.decisions).toHaveLength(4);
    expect(evidence.decisions.map((decision) => decision.sequence)).toEqual([0, 1, 2, 3]);
    expect(evidence.decisions[0]).toMatchObject({
      observation: {
        value: {
          seatId: 'north',
          round: 1,
          pickNumber: 1,
          openedBy: 'north',
          pool: [],
          pack: packs[0]?.cards,
        },
      },
      candidates: {
        status: 'complete',
        values: [
          { id: 'copy-a', value: packs[0]?.cards[0] },
          { id: 'copy-b', value: packs[0]?.cards[1] },
        ],
      },
      choice: { status: 'chosen', candidateId: 'copy-a' },
    });
    expect(JSON.stringify(evidence.decisions[0]?.observation.value)).not.toContain('copy-c');
    expect(evidence.outcome).toMatchObject({
      status: 'completed',
      value: {
        seats: [
          { seatId: 'north', picks: expect.any(Array) },
          { seatId: 'south', picks: expect.any(Array) },
        ],
      },
    });
  });

  it('keeps a human-paused replay as explicit incomplete evidence with prior bot choices', () => {
    const initial = runPhysicalPackDraft(packs, {
      seatIds,
      score,
      humanSeatIds: ['north'],
      evidence: evidenceRequest(),
    });
    expect(initial.evidence?.outcome).toEqual({
      status: 'incomplete',
      error: 'awaiting human draft picks',
    });
    const first = initial.owed[0]?.cards[0]?.physicalId;
    if (first === undefined) throw new Error('human seat was not offered a card');
    const resumed = runPhysicalPackDraft(packs, {
      seatIds,
      score,
      humanSeatIds: ['north'],
      picks: { north: [first] },
      evidence: evidenceRequest(),
    });
    expect(resumed.evidence?.decisions).toHaveLength(1);
    expect(resumed.evidence?.outcome.status).toBe('incomplete');
    expect(JSON.stringify(resumed.evidence)).not.toContain('copy-b');
  });

  it('serializes repeated physical drafts byte-identically and supports shuffled Cube input', () => {
    const first = runPhysicalPackDraft(packs, { seatIds, score, evidence: evidenceRequest() })
      .evidence as BotEvidenceEpisode;
    const second = runPhysicalPackDraft([...packs].reverse(), {
      seatIds,
      score,
      evidence: evidenceRequest(),
    }).evidence as BotEvidenceEpisode;
    expect(serializedBotEvidenceEpisode(second)).toBe(serializedBotEvidenceEpisode(first));

    const cube = packs.flatMap((pack) => pack.cards);
    const cubeProgress = runPhysicalCubeDraft(cube, {
      seed: 'cube-evidence',
      seatIds,
      rounds: 1,
      packSize: 2,
      score,
      evidence: evidenceRequest(),
    });
    expect(BotEvidenceEpisodeSchema.parse(cubeProgress.evidence)).toEqual(cubeProgress.evidence);
    expect(cubeProgress.evidence?.episode.seed).toBe('cube-evidence');
  });

  it('records the actual printed Limited entry point with distinct booster copies', async () => {
    const fixture = await printedFixture();
    const prepared = await preparePrintedLimitedFormat(fixture.format, fixture.catalogs, digest);
    const config = { policy: 'fixture-v1' };
    const printedEvidence = {
      ...evidenceRequest(),
      subject: {
        ...evidenceRequest().subject,
        formatId: prepared.format.id,
        formatSha256: prepared.format.contentSha256,
      },
      behavior: {
        ...evidenceRequest().behavior,
        policyId: 'fixture-v1',
        config,
        configSha256: botEvidenceSha256(config),
      },
    };
    const progress = runPrintedLimitedDraft(prepared, {
      seed: 'printed-evidence',
      botPolicy: 'fixture-v1',
      score: () => 0,
      evidence: printedEvidence,
    });
    const evidence = BotEvidenceEpisodeSchema.parse(progress.evidence);
    expect(evidence.decisions).toHaveLength(12);
    expect(evidence.episode.seed).toBe('printed-evidence');
    expect(
      new Set(
        evidence.decisions.flatMap((decision) => decision.candidates.values.map((candidate) => candidate.id)),
      ).size,
    ).toBeGreaterThan(3);

    let called = false;
    expect(() =>
      runPrintedLimitedDraft(prepared, {
        seed: 'wrong-provenance',
        botPolicy: 'fixture-v1',
        score: () => {
          called = true;
          return 0;
        },
        evidence: { ...printedEvidence, subject: evidenceRequest().subject },
      }),
    ).toThrow(/format provenance/);
    expect(called).toBe(false);
    expect(() =>
      runPrintedLimitedDraft(prepared, {
        seed: 'wrong-policy',
        botPolicy: 'different-policy',
        score: () => {
          called = true;
          return 0;
        },
        evidence: printedEvidence,
      }),
    ).toThrow(/evidence policy/);
    expect(called).toBe(false);
  });
});
