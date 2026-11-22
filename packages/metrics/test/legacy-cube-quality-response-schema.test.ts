import { beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_ADVISOR_WEIGHTS } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import catalogJson from '../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { buildQualityReviewPair } from '../src/legacy-cube-calibration/quality-pair';
import { qualityJudgmentSchema } from '../src/legacy-cube-calibration/quality-response-schema';

let arm: ReturnType<typeof buildQualityReviewPair>['baseline'];
beforeAll(() => {
  arm = buildQualityReviewPair(parsePrintedCardCatalog(catalogJson), {
    root: 'response-schema-contract',
    split: 'tuning',
    index: 0,
    policy: 'current',
    baseline: DEFAULT_ADVISOR_WEIGHTS,
    candidate: DEFAULT_ADVISOR_WEIGHTS,
    runtimeSha256: 'a'.repeat(64),
  }).baseline;
});

it('binds deck review references and task identity without restricting the verdict', () => {
  const task = arm.deck;
  const schema = qualityJudgmentSchema(task);
  for (const assessment of ['pass', 'fail', 'uncertain']) {
    const judgment = {
      taskSha256: task.sha256,
      criteria: ['coherence', 'castability', 'pool-alternatives'].map((criterion) => ({
        criterion,
        assessment,
        rationale: 'Synthetic schema contract, not strategic evidence.',
        cards: [task.payload.pool[0]!.physicalId],
        improvements: [],
      })),
      uncertainty: [],
    };
    expect(schema.safeParse(judgment).success).toBe(true);
    expect(schema.safeParse({ ...judgment, taskSha256: 'b'.repeat(64) }).success).toBe(false);
    expect(
      schema.safeParse({
        ...judgment,
        criteria: judgment.criteria.map((row) => ({
          ...row,
          cards: ['mistyped-card-id'],
        })),
      }).success,
    ).toBe(false);
  }
});

it('constrains advice citations to visible cards, actual claims, and actual paths', () => {
  const task = arm.advice[0]!;
  const schema = qualityJudgmentSchema(task);
  const judgment = {
    taskSha256: task.sha256,
    criteria: ['explanation-accuracy', 'exploration-usefulness'].map((criterion) => ({
      criterion,
      assessment: 'uncertain',
      rationale: 'Synthetic schema contract, not strategic evidence.',
      cards: task.payload.context.observedCards.slice(0, 1).map((card) => card.physicalId),
      claims: task.payload.advice.claims.slice(0, 1).map((claim) => claim.id),
      archetypes: task.payload.advice.paths.slice(0, 1).map((path) => path.id),
      corrections: [],
    })),
    uncertainty: [],
  };
  expect(schema.safeParse(judgment).success).toBe(true);
  for (const field of ['cards', 'claims', 'archetypes']) {
    expect(
      schema.safeParse({
        ...judgment,
        criteria: judgment.criteria.map((row) => ({
          ...row,
          [field]: ['unknown-reference'],
        })),
      }).success,
    ).toBe(false);
  }
});

it('exports exact card choices into the model-facing JSON schema', () => {
  const task = arm.deck;
  const json = z.toJSONSchema(qualityJudgmentSchema(task));
  expect(json).toHaveProperty('properties.taskSha256.enum', [task.sha256]);
  expect(json).toHaveProperty(
    'properties.criteria.items.properties.cards.items.enum',
    task.payload.pool.map((card) => card.physicalId),
  );
});

it('allows only empty citations when a task has no claims or paths', () => {
  const original = arm.advice[0]!;
  const task = {
    ...original,
    payload: {
      ...original.payload,
      advice: {
        ...original.payload.advice,
        claims: [],
        paths: [],
      },
    },
  };
  const schema = qualityJudgmentSchema(task);
  const judgment = {
    taskSha256: task.sha256,
    criteria: ['explanation-accuracy', 'exploration-usefulness'].map((criterion) => ({
      criterion,
      assessment: 'uncertain',
      rationale: 'Synthetic empty-reference contract.',
      cards: [],
      claims: [],
      archetypes: [],
      corrections: [],
    })),
    uncertainty: [],
  };
  expect(schema.safeParse(judgment).success).toBe(true);
  expect(
    schema.safeParse({
      ...judgment,
      criteria: judgment.criteria.map((row) => ({
        ...row,
        claims: ['invented'],
      })),
    }).success,
  ).toBe(false);
  expect(z.toJSONSchema(schema)).toHaveProperty('properties.criteria.items.properties.claims.maxItems', 0);
});
