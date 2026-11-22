import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import type { StageStrengthCampaignPlan } from '@mtg/metrics';
import { greedySpec } from '@mtg/sim';
import { describe, expect, it } from 'vitest';
import { buildInformedDeck } from '../src/build';
import { constructedFormatContract } from '../src/constructed-policy';
import {
  constructedDeckList,
  constructedPoolSha256,
  runConstructedTrialGames,
} from '../src/constructed-runtime';
import { DeckCriteriaSchema } from '../src/criteria';
import { resolveCriteria } from '../src/land-plan';
import { setDeckPool, type PoolSet } from '../src/pool';
import { scriptedProvider } from './support/scripted-provider';

const DIGEST = 'a'.repeat(64);

function creature(index: number): Card {
  return parseCard({
    kind: 'creature',
    id: `runtime-creature-${String(index)}`,
    name: `Runtime Creature ${String(index)}`,
    rarity: 'common',
    set: { code: 'RUN', collectorNumber: index },
    manaCost: { generic: index % 3, G: 1 },
    colors: ['G'],
    subtypes: ['Beast'],
    power: 2,
    toughness: 2,
  } as CardInput);
}

const SET: PoolSet = {
  code: 'RUN',
  name: 'runtime fixture',
  cards: Array.from({ length: 9 }, (_unused, index) => creature(index + 1)),
};

const CRITERIA = DeckCriteriaSchema.parse({
  prompt: 'a green constructed deck',
  sets: ['RUN'],
  colors: ['G'],
  size: 60,
  landCount: 24,
  archetype: 'midrange',
});

async function builtDeck() {
  const pool = setDeckPool([SET], CRITERIA);
  const poolSha256 = constructedPoolSha256(pool);
  const resolved = resolveCriteria(CRITERIA, {
    count: 24,
    source: 'stated',
    reason: 'as the player stated',
  });
  const formatSha256 = botEvidenceSha256(constructedFormatContract(pool, resolved));
  const provider = scriptedProvider([
    {
      plan: 'fill the curve',
      cards: SET.cards.map((card) => ({
        name: card.name,
        count: 4,
        criteria: ['sets', 'archetype'],
        reason: 'curve role',
      })),
    },
  ]);
  const built = await buildInformedDeck({
    pool,
    provider,
    criteria: CRITERIA,
    maxRounds: 1,
    evidence: {
      id: 'constructed-runtime/build/candidate',
      runtime: { version: 'decklab-test', buildSha256: DIGEST },
      subject: { formatId: 'run', formatSha256, cardsSha256: poolSha256 },
      features: { schemaId: 'decklab-request/v1', schemaSha256: DIGEST },
      behavior: {
        policyId: 'decklab-model-repair/v1',
        config: { arm: 'candidate' },
        configSha256: botEvidenceSha256({ arm: 'candidate' }),
        modelSha256: null,
        dataSha256: null,
      },
      lineage: { setId: 'run', poolId: 'build' },
      splitGroup: { kind: 'pool', id: 'build' },
    },
  });
  return { pool, built };
}

describe('constructed runtime deck', () => {
  it('resolves the exact evidence-backed 60-card build to executable DSL cards', async () => {
    const { pool, built } = await builtDeck();
    const deck = constructedDeckList('candidate', pool, built);

    expect(deck.name).toBe('candidate');
    expect(deck.cards).toHaveLength(60);
    expect(deck.cards.filter((card) => card.kind === 'land')).toHaveLength(24);
    expect(new Set(deck.cards.filter((card) => card.kind !== 'land').map((card) => card.id))).toEqual(
      new Set(SET.cards.map((card) => card.id)),
    );
  });

  it('refuses a build whose attached evidence no longer describes that deck', async () => {
    const { pool, built } = await builtDeck();
    const evidence = built.evidence!;
    if (evidence.outcome.status !== 'completed') throw new Error('expected completed evidence');
    const changed = {
      ...built,
      evidence: {
        ...evidence,
        outcome: {
          ...evidence.outcome,
          value: { ...(evidence.outcome.value as Record<string, unknown>), plan: 'substituted plan' },
        },
      },
    };
    expect(() => constructedDeckList('candidate', pool, changed)).toThrow(/evidence.*build/i);
  });

  it('refuses executable cards substituted under an attested oracle id', async () => {
    const { pool, built } = await builtDeck();
    const first = SET.cards[0]!;
    const substituted = parseCard({
      ...first,
      name: 'Substituted Runtime Card',
      power: 20,
      toughness: 20,
    } as CardInput);
    const changedPool = {
      ...pool,
      playable: new Map(pool.playable).set(first.id, substituted),
    };

    expect(() => constructedDeckList('candidate', changedPool, built)).toThrow(/pool.*sha-256/i);
  });

  it('plays the preregistered seat-balanced games and accounts for their decisions', async () => {
    const { pool, built } = await builtDeck();
    const opponent = constructedDeckList('field-midrange', pool, built);
    const bot = greedySpec('constructed-greedy');
    const opponentSha256 = botEvidenceSha256(opponent);
    const policySha256 = botEvidenceSha256(bot);
    const plan: StageStrengthCampaignPlan = {
      version: 'stage-strength-campaign-plan/v1',
      id: 'constructed-runtime',
      split: 'tuning',
      stage: 'constructed-construction',
      evidenceStage: 'deckbuilding',
      engine: 'native',
      runtime: { kind: 'analysis', version: 'decklab-test', buildSha256: DIGEST },
      features: {
        baseline: { schemaId: 'decklab-request/v1', schemaSha256: DIGEST },
        candidate: { schemaId: 'decklab-request/v1', schemaSha256: DIGEST },
      },
      subjects: [
        {
          id: 'run',
          formatSha256: built.evidence!.episode.subject.formatSha256,
          cardsSha256: constructedPoolSha256(pool),
        },
      ],
      primaryOutcome: 'candidate-downstream-game-score-minus-baseline',
      downstream: {
        runtime: { kind: 'native', version: 'kernel-test', buildSha256: DIGEST },
        features: { schemaId: 'native-gameplay/v1', schemaSha256: DIGEST },
        focalPolicy: {
          policyId: 'native-greedy/v1',
          configSha256: policySha256,
          modelSha256: null,
          dataSha256: null,
        },
        opponentPolicy: {
          policyId: 'native-greedy/v1',
          configSha256: policySha256,
          modelSha256: null,
          dataSha256: null,
        },
        opponents: [{ id: 'field-midrange', artifactSha256: opponentSha256 }],
      },
      smallestUsefulEffect: 1,
      regressionMargin: 0,
      maximumFailureRate: 0,
      minimumIndependentUnits: 2,
      stoppingRule: { kind: 'fixed-independent-units', count: 2 },
      powerPlan: {
        method: 'paired-normal-approximation',
        alpha: 0.05,
        targetPower: 0.8,
        anticipatedStandardDeviation: 0.25,
        requiredIndependentUnits: 2,
      },
      policies: {
        baseline: {
          policyId: 'generic-model/v1',
          configSha256: botEvidenceSha256({ arm: 'baseline' }),
          modelSha256: null,
          dataSha256: null,
        },
        candidate: {
          policyId: 'decklab-model-repair/v1',
          configSha256: botEvidenceSha256({ arm: 'candidate' }),
          modelSha256: null,
          dataSha256: null,
        },
      },
      segmentDimensions: [{ id: 'opponent-archetype', values: ['midrange'] }],
      schedule: ['build', 'unused-power-unit'].map((unitId) => ({
        unitId,
        subjectId: 'run',
        seed: unitId,
        evidenceSeed: null,
        outcomeSchedule: ([0, 1] as const).map((focalSeat) => ({
          gameId: `${unitId}-game-${String(focalSeat)}`,
          seed: `${unitId}-game`,
          focalSeat,
          opponentId: 'field-midrange',
        })),
        segments: { 'opponent-archetype': 'midrange' },
      })),
    };

    const trial = runConstructedTrialGames({
      plan,
      unitId: 'build',
      arm: 'candidate',
      pool,
      built,
      buildElapsedMs: 0,
      opponents: new Map([['field-midrange', opponent]]),
      focalBot: bot,
      opponentBot: bot,
    });

    expect(trial.outcomeEvidence).toMatchObject({ status: 'completed', games: [{}, {}] });
    expect(trial.cost.decisions).toBe(built.evidence!.decisions.length);
    expect(trial.cost.downstreamDecisions).toBeGreaterThan(0);
    expect(trial.outcomeEvidenceSha256).toBe(botEvidenceSha256(trial.outcomeEvidence));
  }, 20_000);
});
