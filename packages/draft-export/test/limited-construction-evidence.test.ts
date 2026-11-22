import { BotEvidenceEpisodeSchema, botEvidenceSha256, serializedBotEvidenceEpisode } from '@mtg/bot-evidence';
import {
  LimitedConstructionEvidenceError,
  limitedSelectionEvidenceConfig,
  suggestLimitedDeckWithEvidence,
  type LimitedConstructionEvidenceRequest,
} from '@mtg/draft-export';
import {
  prepareLimitedDeck,
  suggestLimitedDeckWithReport,
  type LimitedCardFacts,
  type LimitedSelectionOptions,
  type PhysicalPoolCard,
} from '@mtg/limited';
import { describe, expect, it } from 'vitest';

const DIGEST = 'c'.repeat(64);

interface Printing {
  readonly oracleId: string;
  readonly facts: LimitedCardFacts;
}

function card(
  physicalId: string,
  oracleId: string,
  score: number,
  overrides: Partial<LimitedCardFacts> = {},
): PhysicalPoolCard<Printing> {
  const facts: LimitedCardFacts = {
    name: oracleId,
    colors: ['R'],
    manaValue: 2,
    type: 'creature',
    score,
    roles: [],
    ...overrides,
  };
  return { physicalId, payload: { oracleId, facts } };
}

const POOL = [
  card('copy-bolt-1', 'bolt', 8, { type: 'noncreature-spell', roles: ['interaction'] }),
  card('copy-bolt-2', 'bolt', 7, { type: 'noncreature-spell', roles: ['interaction'] }),
  card('copy-bear', 'bear', 6),
  card('copy-giant', 'giant', 5, { manaValue: 5 }),
  card('copy-blue', 'blue-card', 20, { colors: ['U'] }),
] as const;

const DECK_OPTIONS = { minimumDeckSize: 5, suggestedBasicLands: 2 } as const;
const SELECTION = {
  policy: 'deck-conditioned/v1',
  colors: ['R'],
  targets: { creatures: 1, interaction: 1, earlyPlays: 2 },
} as const satisfies LimitedSelectionOptions;

function request(
  options: LimitedSelectionOptions = SELECTION,
  splitGroup: LimitedConstructionEvidenceRequest['splitGroup'] = {
    kind: 'pool',
    id: 'pool-1',
  },
): LimitedConstructionEvidenceRequest {
  const config = limitedSelectionEvidenceConfig(prepared(), options);
  return {
    id: 'limited-construction-1',
    runtime: { version: 'limited-test', buildSha256: DIGEST },
    subject: { formatId: 'fixture', formatSha256: DIGEST, cardsSha256: DIGEST },
    features: { schemaId: 'limited-card-facts-v1', schemaSha256: DIGEST },
    behavior: {
      policyId: options.policy ?? 'score-ranked/v1',
      config,
      configSha256: botEvidenceSha256(config),
      modelSha256: null,
      dataSha256: null,
    },
    lineage:
      splitGroup.kind === 'pool' ? { poolId: splitGroup.id, draftId: 'draft-1' } : { draftId: splitGroup.id },
    splitGroup,
  };
}

function prepared() {
  return prepareLimitedDeck(POOL, (entry) => entry.payload.facts, DECK_OPTIONS);
}

describe('Limited construction evidence', () => {
  it('records a deterministic whole-deck outcome without fabricated decisions', () => {
    const first = suggestLimitedDeckWithEvidence(prepared(), SELECTION, request());
    const second = suggestLimitedDeckWithEvidence(prepared(), SELECTION, request());
    const evidence = BotEvidenceEpisodeSchema.parse(first.evidence);

    expect(evidence.episode).toMatchObject({
      stage: 'deckbuilding',
      seed: null,
      runtime: { kind: 'analysis' },
      splitGroup: { kind: 'pool', id: 'pool-1' },
      behavior: {
        config: {
          policy: 'deck-conditioned/v1',
          minimumDeckSize: 5,
          suggestedBasicLands: 2,
        },
      },
    });
    expect(evidence.decisions).toEqual([]);
    expect(evidence.outcome).toMatchObject({
      status: 'completed',
      value: {
        input: {
          pool: expect.any(Array),
          minimumDeckSize: 5,
          suggestedBasicLands: 2,
        },
        deck: {
          selectedPhysicalIds: ['copy-bolt-1', 'copy-bolt-2', 'copy-bear'],
          basics: { Mountain: 2 },
        },
        selection: { policy: 'deck-conditioned/v1' },
        validation: { legal: true, cards: 5 },
      },
    });
    if (evidence.outcome.status !== 'completed') throw new Error('expected completed evidence');
    const outcome = evidence.outcome.value as { readonly input: { readonly pool: readonly unknown[] } };
    expect(outcome.input.pool).toHaveLength(POOL.length);
    expect(outcome.input.pool.slice(0, 2)).toEqual([
      { physicalId: 'copy-bolt-1', facts: POOL[0].payload.facts },
      { physicalId: 'copy-bolt-2', facts: POOL[1].payload.facts },
    ]);
    expect(first.deck).toEqual(second.deck);
    expect(serializedBotEvidenceEpisode(second.evidence)).toBe(serializedBotEvidenceEpisode(first.evidence));
  });

  it('supports whole-draft grouping for Cube-derived pools', () => {
    const splitGroup = { kind: 'draft', id: 'cube-draft-9' } as const;
    const result = suggestLimitedDeckWithEvidence(prepared(), SELECTION, request(SELECTION, splitGroup));
    expect(BotEvidenceEpisodeSchema.parse(result.evidence).episode).toMatchObject({
      lineage: { draftId: 'cube-draft-9' },
      splitGroup,
    });
  });

  it('rejects behavior provenance before selecting a deck', () => {
    const evidence = request();
    expect(() =>
      suggestLimitedDeckWithEvidence(prepared(), SELECTION, {
        ...evidence,
        behavior: { ...evidence.behavior, policyId: 'score-ranked/v1' },
      }),
    ).toThrow(/evidence policy/);
    const otherConfig = limitedSelectionEvidenceConfig(prepared(), { policy: 'score-ranked/v1' });
    expect(() =>
      suggestLimitedDeckWithEvidence(prepared(), SELECTION, {
        ...evidence,
        behavior: {
          ...evidence.behavior,
          config: otherConfig,
          configSha256: botEvidenceSha256(otherConfig),
        },
      }),
    ).toThrow(/evidence configuration/);
  });

  it('retains a schema-valid failed episode after identity validation', () => {
    const invalid = { ...SELECTION, colors: ['R', 'R'] } as unknown as LimitedSelectionOptions;
    const evidence = request(invalid);
    let caught: unknown;
    try {
      suggestLimitedDeckWithEvidence(prepared(), invalid, evidence);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LimitedConstructionEvidenceError);
    const episode = (caught as LimitedConstructionEvidenceError).evidence;
    expect(BotEvidenceEpisodeSchema.parse(episode)).toEqual(episode);
    expect(episode.decisions).toEqual([]);
    expect(episode.outcome).toMatchObject({
      status: 'engine-failure',
      error: expect.stringContaining('color'),
    });
  });

  it('leaves the existing selection API shape unchanged', () => {
    const ordinary = suggestLimitedDeckWithReport(prepared(), SELECTION);
    const result = suggestLimitedDeckWithEvidence(prepared(), SELECTION, request());
    expect(Object.keys(ordinary).sort()).toEqual(['deck', 'report']);
    expect(result.deck).toEqual(ordinary.deck);
    expect(result.report).toEqual(ordinary.report);
    expect(Object.keys(result).sort()).toEqual(['deck', 'evidence', 'report']);
  });
});
