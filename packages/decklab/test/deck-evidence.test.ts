import { afterEach, describe, expect, it } from 'vitest';
import {
  BotEvidenceEpisodeSchema,
  botEvidenceSha256,
  serializedBotEvidenceEpisode,
  type BotEvidenceEpisode,
} from '@mtg/bot-evidence';
import { closeStore, type DataStore } from '@mtg/data';
import { toJsonSchema } from '@mtg/llm';
import {
  buildInformedDeck,
  DeckProposalSchema,
  DeckbuildingEvidenceError,
  storeDeckPool,
  type DeckbuildingEvidenceRequest,
} from '@mtg/decklab';
import { DeckCriteriaSchema } from '../src/criteria';
import { createFakeStore, SAMPLE_CARDS } from './support/fake-store';
import { scriptedProvider } from './support/scripted-provider';

const DIGEST = 'a'.repeat(64);
const CRITERIA = {
  prompt: 'aggressive red deck',
  format: 'modern' as const,
  colors: ['R' as const],
  archetype: 'aggro',
  size: 60,
  landCount: 24,
};
const PROPOSAL = {
  plan: 'burn them out',
  cards: [{ name: 'Lightning Bolt', count: 4, criteria: ['archetype'], reason: 'reach' }],
};

let store: DataStore | undefined;

afterEach(() => {
  if (store !== undefined) closeStore(store);
  store = undefined;
});

function request(): DeckbuildingEvidenceRequest {
  const config = { policy: 'decklab-scripted-test' };
  return {
    id: 'constructed-evidence-build',
    runtime: { version: 'decklab-test', buildSha256: DIGEST },
    subject: { formatId: 'modern-red', formatSha256: DIGEST, cardsSha256: DIGEST },
    features: { schemaId: 'decklab-model-request-v1', schemaSha256: DIGEST },
    behavior: {
      policyId: 'decklab-scripted-test',
      config,
      configSha256: botEvidenceSha256(config),
      modelSha256: DIGEST,
      dataSha256: null,
    },
    lineage: { poolId: 'modern-red-pool' },
    splitGroup: { kind: 'pool', id: 'modern-red-pool' },
  };
}

async function build(evidence?: DeckbuildingEvidenceRequest) {
  store = createFakeStore(SAMPLE_CARDS);
  const provider = scriptedProvider([PROPOSAL]);
  const built = await buildInformedDeck({
    pool: storeDeckPool(store, DeckCriteriaSchema.parse(CRITERIA)),
    provider,
    criteria: CRITERIA,
    maxRounds: 1,
    ...(evidence === undefined ? {} : { evidence }),
  });
  return { built, provider };
}

describe('constructed deck evidence', () => {
  it('does not alter the ordinary result shape when collection is disabled', async () => {
    expect('evidence' in (await build()).built).toBe(false);
  });

  it('records the exact model request, proposal, and completed deck outcome', async () => {
    const { built, provider } = await build(request());
    const evidence = built.evidence as BotEvidenceEpisode;
    expect(BotEvidenceEpisodeSchema.parse(evidence)).toEqual(evidence);
    expect(evidence.episode).toMatchObject({
      stage: 'deckbuilding',
      seed: null,
      runtime: { kind: 'analysis' },
      lineage: { poolId: 'modern-red-pool' },
      splitGroup: { kind: 'pool', id: 'modern-red-pool' },
    });
    expect(evidence.decisions).toHaveLength(provider.prompts.length);
    expect(evidence.decisions[0]).toMatchObject({
      sequence: 0,
      observation: {
        value: {
          system: expect.stringContaining('Magic: the Gathering deck builder'),
          prompt: provider.prompts[0],
          jsonSchema: toJsonSchema(DeckProposalSchema),
          schemaEncoding: 'inline',
        },
      },
      candidates: {
        status: 'incomplete',
        reason: 'combinatorial deck proposal space is not enumerable',
        values: [{ value: PROPOSAL }],
      },
      choice: { status: 'chosen' },
    });
    expect(evidence.outcome).toMatchObject({
      status: 'completed',
      value: {
        construction: {
          format: { id: 'decklab-constructed-format/v1', deckSize: 60, copyLimit: 4 },
          selection: {
            id: 'decklab-model-repair/v1',
            fallbackId: 'decklab-verified-partial/v1',
          },
        },
        deck: {
          spells: [{ id: expect.any(String), name: 'Lightning Bolt', count: 4 }],
          totalCards: built.deck.totalCards,
        },
        landPlan: built.landPlan,
        rounds: built.rounds,
        shortBy: built.shortBy,
        stop: built.stop,
        spend: built.spend,
        rejections: built.rejections,
        adjustments: built.adjustments,
      },
    });
  });

  it('records the land-count call before every card-selection call', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([{ landCount: 20, reason: 'the curve is low' }, PROPOSAL]);
    const criteria = { ...CRITERIA, landCount: undefined };
    const built = await buildInformedDeck({
      pool: storeDeckPool(store, DeckCriteriaSchema.parse(criteria)),
      provider,
      criteria,
      maxRounds: 1,
      evidence: request(),
    });
    const evidence = built.evidence as BotEvidenceEpisode;
    expect(evidence.decisions).toHaveLength(provider.prompts.length);
    expect(evidence.decisions.map((decision) => decision.sequence)).toEqual([0, 1, 2]);
    expect(evidence.decisions[0]?.candidates.values[0]?.value).toEqual({
      landCount: 20,
      reason: 'the curve is low',
    });
    expect(evidence.decisions[1]?.candidates.values[0]?.value).toEqual(PROPOSAL);
  });

  it('serializes byte-identically for repeated fixture-provider builds', async () => {
    const first = (await build(request())).built.evidence as BotEvidenceEpisode;
    const second = (await build(request())).built.evidence as BotEvidenceEpisode;
    expect(serializedBotEvidenceEpisode(first)).toBe(serializedBotEvidenceEpisode(second));
  });

  it('rejects non-pool/set grouping before the provider is called', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([PROPOSAL]);
    const invalid = {
      ...request(),
      lineage: { gameId: 'wrong' },
      splitGroup: { kind: 'game', id: 'wrong' },
    } as unknown as DeckbuildingEvidenceRequest;
    await expect(
      buildInformedDeck({
        pool: storeDeckPool(store, DeckCriteriaSchema.parse(CRITERIA)),
        provider,
        criteria: CRITERIA,
        evidence: invalid,
      }),
    ).rejects.toThrow(/pool or set split group/);
    expect(provider.prompts).toEqual([]);
  });

  it('preserves a failed model attempt in a schema-valid partial episode', async () => {
    store = createFakeStore(SAMPLE_CARDS);
    const provider = scriptedProvider([new Error('model unavailable')]);
    let error: DeckbuildingEvidenceError | undefined;
    try {
      await buildInformedDeck({
        pool: storeDeckPool(store, DeckCriteriaSchema.parse(CRITERIA)),
        provider,
        criteria: CRITERIA,
        evidence: request(),
      });
    } catch (cause: unknown) {
      expect(cause).toBeInstanceOf(DeckbuildingEvidenceError);
      error = cause as DeckbuildingEvidenceError;
    }
    expect(error).toBeDefined();
    if (error === undefined) throw new Error('expected the evidence-enabled build to fail');
    expect(BotEvidenceEpisodeSchema.parse(error.evidence)).toEqual(error.evidence);
    expect(error.evidence.outcome).toEqual({ status: 'engine-failure', error: 'model unavailable' });
    expect(error.evidence.decisions).toHaveLength(1);
    expect(error.evidence.decisions[0]?.choice).toEqual({
      status: 'engine-failure',
      error: 'model unavailable',
    });
  });
});
